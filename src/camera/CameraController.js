import * as THREE from 'three';
import { lerp, clamp } from '../utils/MathUtils.js';

export class CameraController {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 100);
    this.camera.position.set(0, 3, 10);

    // Tracking state
    this.targetPosition = new THREE.Vector3();
    this.targetLookAt = new THREE.Vector3();
    this.currentLookAt = new THREE.Vector3();

    // Camera orbit angle (radians, 0 = +Z side)
    this.orbitAngle = 0;

    // Shake
    this.shakeIntensity = 0;
    this.shakeDecay = 0.9;

    // Kill cam
    this.killCamActive = false;
    this.killCamAngle = 0;
    this.killCamTarget = null;
    this.killCamVictim = null;
    this.killCamKiller = null;
    this.killCamTime = 0;
    this.killCamPhase = 'freeze'; // 'freeze' | 'zoom' | 'orbit'

    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  update(dt, fighter1, fighter2) {
    if (this.killCamActive) {
      this._updateKillCam(dt);
      return;
    }

    if (!fighter1 || !fighter2) return;

    // Midpoint between fighters
    const midX = (fighter1.position.x + fighter2.position.x) / 2;
    const midY = (fighter1.position.y + fighter2.position.y) / 2 + 1.0;
    const midZ = (fighter1.position.z + fighter2.position.z) / 2;

    // Distance-based zoom
    const dist = fighter1.distanceTo(fighter2);
    const zoomDist = clamp(5 + dist * 0.8, 5, 14);

    // Compute the angle of the line between fighters
    const dx = fighter2.position.x - fighter1.position.x;
    const dz = fighter2.position.z - fighter1.position.z;
    const fighterLineAngle = Math.atan2(dz, dx);
    const targetOrbit = fighterLineAngle + Math.PI / 2;

    this.orbitAngle = this._lerpAngle(this.orbitAngle, targetOrbit, 0.03);

    this.targetPosition.set(
      midX + Math.cos(this.orbitAngle) * zoomDist * 0.3,
      midY + 2.5,
      midZ + Math.sin(this.orbitAngle) * zoomDist
    );

    this.targetLookAt.set(midX, midY, midZ);

    if (this._needsSnap) {
      this.camera.position.copy(this.targetPosition);
      this.currentLookAt.copy(this.targetLookAt);
      this._needsSnap = false;
    } else {
      this.camera.position.lerp(this.targetPosition, 0.08);
      this.currentLookAt.lerp(this.targetLookAt, 0.1);
    }

    // Apply shake
    if (this.shakeIntensity > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= this.shakeDecay;
    }

    this.camera.lookAt(this.currentLookAt);
  }

  _lerpAngle(a, b, t) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  _updateKillCam(dt) {
    // Use real time so camera moves during time-freeze
    const now = performance.now() / 1000;
    const realDt = this._killLastTime ? Math.min(now - this._killLastTime, 0.05) : dt;
    this._killLastTime = now;
    this.killCamTime += realDt;

    // Track the victim's current position (follows ragdoll)
    const victimPos = this.killCamVictim
      ? this.killCamVictim.position
      : this.killCamTarget;
    const lookY = (victimPos.y || 0) + 1.0;

    const FREEZE_DUR = 0.15;
    const ZOOM_DUR = 0.6;

    if (this.killCamTime < FREEZE_DUR) {
      // Phase 1: FREEZE — camera holds, dramatic pause
      // Camera stays where it was, just look at victim
      this.currentLookAt.lerp(
        new THREE.Vector3(victimPos.x, lookY, victimPos.z), 0.3
      );
      this.camera.lookAt(this.currentLookAt);
    } else if (this.killCamTime < FREEZE_DUR + ZOOM_DUR) {
      // Phase 2: ZOOM — camera rapidly moves to dramatic close-up
      const t = (this.killCamTime - FREEZE_DUR) / ZOOM_DUR;
      const ease = 1 - Math.pow(1 - t, 3); // ease-out cubic

      // Target: close low-angle shot from the side
      const closeRadius = 2.5;
      const closeHeight = 0.8;
      const closePos = new THREE.Vector3(
        victimPos.x + Math.cos(this.killCamAngle) * closeRadius,
        lookY - 0.2 + closeHeight,
        victimPos.z + Math.sin(this.killCamAngle) * closeRadius
      );

      this.camera.position.lerp(closePos, ease * 0.15 + 0.02);
      this.currentLookAt.lerp(
        new THREE.Vector3(victimPos.x, lookY, victimPos.z), 0.15
      );
      this.camera.lookAt(this.currentLookAt);
    } else {
      // Phase 3: ORBIT — slow orbit pulling back, tracking ragdoll
      const orbitTime = this.killCamTime - FREEZE_DUR - ZOOM_DUR;
      this.killCamAngle += realDt * 0.4;

      // Gradually pull back from close to medium distance
      const pullback = Math.min(orbitTime * 0.8, 2.0);
      const radius = 2.5 + pullback;
      const height = 0.8 + pullback * 0.5;

      const orbitPos = new THREE.Vector3(
        victimPos.x + Math.cos(this.killCamAngle) * radius,
        lookY + height,
        victimPos.z + Math.sin(this.killCamAngle) * radius
      );

      this.camera.position.lerp(orbitPos, 0.06);
      this.currentLookAt.lerp(
        new THREE.Vector3(victimPos.x, lookY, victimPos.z), 0.08
      );
      this.camera.lookAt(this.currentLookAt);
    }

    // Shake during kill cam (diminishing)
    if (this.shakeIntensity > 0.001) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity;
      this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity;
      this.shakeIntensity *= this.shakeDecay;
    }
  }

  startKillCam(victim, killer) {
    this.killCamActive = true;
    this.killCamVictim = victim;
    this.killCamKiller = killer;
    this.killCamTarget = victim.position.clone();
    this.killCamTime = 0;
    this._killLastTime = null;

    // Start orbit angle from current camera direction toward victim
    this.killCamAngle = Math.atan2(
      this.camera.position.z - victim.position.z,
      this.camera.position.x - victim.position.x
    );
  }

  stopKillCam() {
    this.killCamActive = false;
    this.killCamTarget = null;
    this.killCamVictim = null;
    this.killCamKiller = null;
    this._killLastTime = null;
  }

  shake(intensity = 0.3) {
    this.shakeIntensity = intensity;
  }

  reset() {
    this.shakeIntensity = 0;
    this.killCamActive = false;
    this.killCamTarget = null;
    this.killCamVictim = null;
    this.killCamKiller = null;
    this._killLastTime = null;
    this.orbitAngle = 0;
    this._needsSnap = true;
  }
}
