import * as THREE from 'three';
import { getStageDef } from './StageDefs.js';

export class Environment {
  constructor(scene, stageId = null) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.particles = null;
    this.stageId = null;
    this.applyStage(stageId);
  }

  applyStage(stageId) {
    const stage = getStageDef(typeof stageId === 'string' ? stageId : stageId?.id);
    if (this.stageId === stage.id) return stage;
    this.stageId = stage.id;
    this._disposeGroup(this.group);
    this.group.clear();
    this._setupLighting(stage);
    this._setupFog(stage);
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
    if (!this.particles) return;
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
}
