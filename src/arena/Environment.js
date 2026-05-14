import * as THREE from 'three';
import { getStageDef } from './StageDefs.js';

export class Environment {
  constructor(scene, stageId = null) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.particles = null;
    this.floaters = [];
    this.stageId = null;
    this.applyStage(stageId);
  }

  applyStage(stageId) {
    const stage = getStageDef(typeof stageId === 'string' ? stageId : stageId?.id);
    if (this.stageId === stage.id) return stage;
    this.stageId = stage.id;
    this.floaters = [];
    this._disposeGroup(this.group);
    this.group.clear();
    this._setupLighting(stage);
    this._setupFog(stage);
    this._setupBackdrop(stage);
    this._setupParticles(stage);
    return stage;
  }

  _disposeGroup(group) {
    group.traverse((child) => {
      if (child.geometry?.dispose) child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material?.dispose?.());
      } else if (child.material?.dispose) {
        child.material.dispose();
      }
    });
  }

  _setupLighting(stage) {
    const env = stage.environment;

    const hemi = new THREE.HemisphereLight(env.hemiSky, env.hemiGround, env.hemiIntensity);
    this.group.add(hemi);

    const dir = new THREE.DirectionalLight(env.mainLightColor, env.mainLightIntensity);
    dir.position.set(...env.mainLightPosition);
    dir.castShadow = true;
    dir.shadow.mapSize.width = 2048;
    dir.shadow.mapSize.height = 2048;
    dir.shadow.camera.near = 1;
    dir.shadow.camera.far = 32;
    dir.shadow.camera.left = -12;
    dir.shadow.camera.right = 12;
    dir.shadow.camera.top = 12;
    dir.shadow.camera.bottom = -12;
    dir.shadow.bias = -0.00035;
    dir.shadow.normalBias = 0.008;
    this.group.add(dir);

    const rim = new THREE.DirectionalLight(env.rimLightColor, env.rimLightIntensity);
    rim.position.set(...env.rimLightPosition);
    this.group.add(rim);

    const ambient = new THREE.AmbientLight(env.ambientColor, env.ambientIntensity);
    this.group.add(ambient);
  }

  _setupFog(stage) {
    const env = stage.environment;
    this.scene.fog = new THREE.FogExp2(env.fogColor, env.fogDensity);
    this.scene.background = new THREE.Color(env.background);
  }

  _setupBackdrop(stage) {
    const env = stage.environment;
    const backdrop = new THREE.Group();

    if (env.horizonColor) {
      const horizon = new THREE.Mesh(
        new THREE.CylinderGeometry(24, 24, env.horizonHeight ?? 5.2, 64, 1, true),
        new THREE.MeshBasicMaterial({
          color: env.horizonColor,
          transparent: true,
          opacity: env.horizonOpacity ?? 0.65,
          side: THREE.BackSide,
          depthWrite: false,
        }),
      );
      horizon.position.y = (env.horizonHeight ?? 5.2) * 0.5 - 0.2;
      backdrop.add(horizon);
    }

    if (env.skyDiscColor) {
      const skyDisc = new THREE.Mesh(
        new THREE.CircleGeometry(env.skyDiscSize ?? 5.5, 48),
        new THREE.MeshBasicMaterial({
          color: env.skyDiscColor,
          transparent: true,
          opacity: env.skyDiscOpacity ?? 0.4,
          depthWrite: false,
        }),
      );
      skyDisc.position.set(...(env.skyDiscPosition ?? [-12, 8, -18]));
      skyDisc.lookAt(0, skyDisc.position.y, 0);
      backdrop.add(skyDisc);

      const halo = new THREE.Mesh(
        new THREE.RingGeometry((env.skyDiscSize ?? 5.5) * 0.95, (env.skyDiscSize ?? 5.5) * 1.45, 48),
        new THREE.MeshBasicMaterial({
          color: env.skyDiscColor,
          transparent: true,
          opacity: (env.skyDiscOpacity ?? 0.4) * 0.28,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      halo.position.copy(skyDisc.position);
      halo.lookAt(0, skyDisc.position.y, 0);
      backdrop.add(halo);
      this.floaters.push({ mesh: halo, speed: 0.18, baseY: halo.position.y, amplitude: 0.12, phase: Math.random() * Math.PI * 2 });
    }

    switch (env.backdropKind) {
      case 'keep':
        this._addKeepBackdrop(backdrop, env);
        break;
      case 'garden':
        this._addGardenBackdrop(backdrop, env);
        break;
      case 'sanctum':
        this._addSanctumBackdrop(backdrop, env);
        break;
      case 'shrine':
        this._addShrineBackdrop(backdrop, env);
        break;
      default:
        break;
    }

    this.group.add(backdrop);
  }

  _addKeepBackdrop(group, env) {
    const wallMat = new THREE.MeshStandardMaterial({
      color: env.backdropColor,
      roughness: 0.92,
      metalness: 0.03,
      emissive: env.backdropAccent,
      emissiveIntensity: 0.02,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: env.backdropGlow,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
    });

    for (let i = 0; i < 8; i++) {
      const angle = (Math.PI * 2 * i) / 8;
      const radius = 17.2;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(1.15, 3.8, 1.15), wallMat);
      tower.position.set(Math.cos(angle) * radius, 1.5, Math.sin(angle) * radius);
      tower.rotation.y = angle + Math.PI / 4;
      group.add(tower);

      const brazierGlow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 10), glowMat);
      brazierGlow.position.set(tower.position.x, 3.4, tower.position.z);
      group.add(brazierGlow);
    }

    for (let i = 0; i < 4; i++) {
      const angle = (Math.PI * i) / 2;
      const wall = new THREE.Mesh(new THREE.BoxGeometry(8.8, 2.4, 0.7), wallMat);
      wall.position.set(Math.cos(angle) * 15.9, 0.82, Math.sin(angle) * 15.9);
      wall.rotation.y = angle;
      group.add(wall);
    }
  }

  _addGardenBackdrop(group, env) {
    const stoneMat = new THREE.MeshStandardMaterial({
      color: env.backdropColor,
      roughness: 0.88,
      metalness: 0.04,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: env.backdropGlow,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    });

    for (let i = 0; i < 6; i++) {
      const angle = (Math.PI * 2 * i) / 6;
      const radius = 17.6;
      const arch = new THREE.Group();
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.5, 0.32), stoneMat);
      const right = new THREE.Mesh(new THREE.BoxGeometry(0.32, 2.5, 0.32), stoneMat);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.24, 0.34), stoneMat);
      left.position.set(-0.82, 1.0, 0);
      right.position.set(0.82, 1.0, 0);
      lintel.position.set(0, 2.15, 0);
      arch.add(left, right, lintel);
      arch.position.set(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
      arch.lookAt(0, 0.7, 0);
      group.add(arch);

      const lantern = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 10), glowMat);
      lantern.position.set(arch.position.x, 1.85, arch.position.z);
      group.add(lantern);
    }

    const waterRing = new THREE.Mesh(
      new THREE.RingGeometry(15.1, 19.6, 64),
      new THREE.MeshBasicMaterial({
        color: 0x3a5f7d,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    waterRing.rotation.x = -Math.PI / 2;
    waterRing.position.y = -0.48;
    group.add(waterRing);
  }

  _addSanctumBackdrop(group, env) {
    const stoneMat = new THREE.MeshStandardMaterial({
      color: env.backdropColor,
      roughness: 0.9,
      metalness: 0.04,
      emissive: env.backdropAccent,
      emissiveIntensity: 0.024,
    });
    const bannerMat = new THREE.MeshBasicMaterial({
      color: env.backdropGlow,
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    });

    for (const side of [-1, 1]) {
      for (let i = -3; i <= 3; i++) {
        const column = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.4, 0.5), stoneMat);
        column.position.set(i * 3.2, 1.25, side * 11.8);
        group.add(column);

        const banner = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 2.6), bannerMat);
        banner.position.set(i * 3.2, 2.1, side * 10.95);
        banner.rotation.y = side > 0 ? Math.PI : 0;
        group.add(banner);
        this.floaters.push({ mesh: banner, speed: 0.36, baseY: banner.position.y, amplitude: 0.05, phase: i * 0.6 + (side > 0 ? 1 : 0) });
      }
    }

    const gate = new THREE.Group();
    const left = new THREE.Mesh(new THREE.BoxGeometry(0.65, 4.2, 0.65), stoneMat);
    const right = new THREE.Mesh(new THREE.BoxGeometry(0.65, 4.2, 0.65), stoneMat);
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(6.2, 0.4, 0.8), stoneMat);
    left.position.set(-2.8, 1.6, -18.8);
    right.position.set(2.8, 1.6, -18.8);
    lintel.position.set(0, 3.55, -18.8);
    gate.add(left, right, lintel);
    group.add(gate);
  }

  _addShrineBackdrop(group, env) {
    const timberMat = new THREE.MeshStandardMaterial({
      color: env.backdropColor,
      roughness: 0.86,
      metalness: 0.06,
      emissive: env.backdropAccent,
      emissiveIntensity: 0.025,
    });
    const glowMat = new THREE.MeshBasicMaterial({
      color: env.backdropGlow,
      transparent: true,
      opacity: 0.26,
      depthWrite: false,
    });

    for (let i = 0; i < 3; i++) {
      const z = -16.8 - i * 3.4;
      const gate = new THREE.Group();
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.34, 2.8, 0.34), timberMat);
      const right = new THREE.Mesh(new THREE.BoxGeometry(0.34, 2.8, 0.34), timberMat);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.24, 0.38), timberMat);
      left.position.set(-1.4, 0.95, z);
      right.position.set(1.4, 0.95, z);
      lintel.position.set(0, 2.12, z);
      gate.add(left, right, lintel);
      gate.rotation.y = (i - 1) * 0.1;
      group.add(gate);
    }

    for (let i = 0; i < 7; i++) {
      const angle = (Math.PI * 2 * i) / 7;
      const radius = 16.7 + (i % 2) * 0.9;
      const shard = new THREE.Mesh(new THREE.BoxGeometry(0.44, 3.1 + (i % 3) * 0.45, 0.44), timberMat);
      shard.position.set(Math.cos(angle) * radius, 1.0, Math.sin(angle) * radius);
      shard.rotation.y = angle + 0.35;
      group.add(shard);

      const ember = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 10), glowMat);
      ember.position.set(shard.position.x, 1.1 + (i % 3) * 0.35, shard.position.z);
      group.add(ember);
    }
  }

  _setupParticles(stage) {
    const env = stage.environment;
    const count = env.particleCount;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * env.particleSpread;
      positions[i * 3 + 1] = Math.random() * env.particleHeight;
      positions[i * 3 + 2] = (Math.random() - 0.5) * env.particleSpread;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: env.particleColor,
      size: env.particleSize,
      transparent: true,
      opacity: env.particleOpacity,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.particles = new THREE.Points(geo, mat);
    this.group.add(this.particles);
  }

  update(dt) {
    if (this.particles) {
      const env = getStageDef(this.stageId).environment;
      const posAttr = this.particles.geometry.getAttribute('position');
      for (let i = 0; i < posAttr.count; i++) {
        let y = posAttr.getY(i);
        y += dt * env.particleRiseSpeed;
        if (y > env.particleHeight) y = 0;
        posAttr.setY(i, y);

        const sway = Math.sin(y * 0.55 + i * 0.75);
        const x = posAttr.getX(i) + sway * dt * env.particleDrift;
        posAttr.setX(i, x);
      }
      posAttr.needsUpdate = true;
    }

    if (!this.floaters.length) return;
    const now = performance.now() * 0.001;
    for (const floater of this.floaters) {
      floater.mesh.position.y = floater.baseY + Math.sin(now * floater.speed + floater.phase) * floater.amplitude;
    }
  }
}
