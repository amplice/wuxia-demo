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

    window.addEventListener('resize', () => this.onResize());
  }

  onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  update(dt, fighter1, fighter2) {
    if (this.killCamActive && this.killCamTarget) {
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
    // Perpendicular angle: we want to look from the side
    // atan2(dz, dx) gives the fighter line angle; add PI/2 for perpendicular
    const fighterLineAngle = Math.atan2(dz, dx);
    const targetOrbit = fighterLineAngle + Math.PI / 2;

    // Smoothly rotate camera orbit to match (using shortest-path angle lerp)
    this.orbitAngle = this._lerpAngle(this.orbitAngle, targetOrbit, 0.03);

    // Position camera using orbit angle
    this.targetPosition.set(
      midX + Math.cos(this.orbitAngle) * zoomDist * 0.3,
      midY + 2.5,
      midZ + Math.sin(this.orbitAngle) * zoomDist
    );

    this.targetLookAt.set(midX, midY, midZ);

    // Snap on first frame, then smooth follow
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
    // Shortest-path angle interpolation
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  _updateKillCam(dt) {
    this.killCamAngle += dt * 0.5;
    const target = this.killCamTarget;
    const radius = 4;

    this.camera.position.set(
      target.x + Math.cos(this.killCamAngle) * radius,
      target.y + 2,
      target.z + Math.sin(this.killCamAngle) * radius
    );
    this.camera.lookAt(target.x, target.y + 1, target.z);
  }

  startKillCam(targetPos) {
    this.killCamActive = true;
    this.killCamAngle = Math.atan2(
      this.camera.position.z - targetPos.z,
      this.camera.position.x - targetPos.x
    );
    this.killCamTarget = targetPos.clone();
  }

  stopKillCam() {
    this.killCamActive = false;
    this.killCamTarget = null;
  }

  shake(intensity = 0.3) {
    this.shakeIntensity = intensity;
  }

  reset() {
    this.shakeIntensity = 0;
    this.killCamActive = false;
    this.killCamTarget = null;
    this.orbitAngle = 0;
    this._needsSnap = true;
  }
}
