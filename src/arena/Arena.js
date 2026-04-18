import * as THREE from 'three';
import { ARENA_RADIUS } from '../core/Constants.js';
import { getStageDef } from './StageDefs.js';

export class Arena {
  constructor(scene, stageId = null) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.stageId = null;
    this.applyStage(stageId);
  }

  applyStage(stageId) {
    const stage = getStageDef(typeof stageId === 'string' ? stageId : stageId?.id);
    if (this.stageId === stage.id) return stage;
    this.stageId = stage.id;
    this._disposeGroup(this.group);
    this.group.clear();
    this._build(stage);
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

  _build(stage) {
    const { arena } = stage;
    const sideMat = new THREE.MeshStandardMaterial({
      color: arena.platformSide,
      roughness: arena.roughness,
      metalness: arena.metalness,
    });
    const capMat = new THREE.MeshStandardMaterial({
      color: arena.platformTop,
      roughness: Math.max(0.55, arena.roughness - 0.08),
      metalness: arena.metalness,
    });
    const trimMat = new THREE.MeshStandardMaterial({
      color: arena.trim,
      roughness: 0.48,
      metalness: 0.22,
      emissive: arena.trim,
      emissiveIntensity: 0.03,
    });
    const detailMat = new THREE.MeshStandardMaterial({
      color: arena.detail,
      roughness: 0.82,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });

    const platformGeo = new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS + 0.42, 0.48, 56, 1, false);
    const platform = new THREE.Mesh(platformGeo, [sideMat, capMat, sideMat]);
    platform.position.y = -0.24;
    platform.receiveShadow = true;
    this.group.add(platform);

    const trimGeo = new THREE.TorusGeometry(ARENA_RADIUS - 0.12, 0.065, 14, 72);
    const trim = new THREE.Mesh(trimGeo, trimMat);
    trim.rotation.x = Math.PI / 2;
    trim.position.y = 0.035;
    this.group.add(trim);

    const ringGeo = new THREE.RingGeometry(ARENA_RADIUS * 0.54, ARENA_RADIUS * 0.615, 72);
    const ringMat = new THREE.MeshStandardMaterial({
      color: arena.ring,
      roughness: 0.74,
      metalness: 0.08,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.012;
    this.group.add(ring);

    const innerGeo = new THREE.RingGeometry(1.05, 1.2, 48);
    const inner = new THREE.Mesh(innerGeo, detailMat);
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.013;
    this.group.add(inner);

    const centerGeo = new THREE.CircleGeometry(0.84, 36);
    const centerMat = new THREE.MeshStandardMaterial({
      color: arena.center,
      roughness: 0.68,
      metalness: 0.1,
    });
    const center = new THREE.Mesh(centerGeo, centerMat);
    center.rotation.x = -Math.PI / 2;
    center.position.y = 0.014;
    this.group.add(center);

    const spokeGeo = new THREE.BoxGeometry(ARENA_RADIUS * 0.54, 0.018, 0.11);
    const spokeMat = new THREE.MeshStandardMaterial({
      color: arena.marker,
      roughness: 0.6,
      metalness: 0.18,
    });
    for (let i = 0; i < 4; i++) {
      const spoke = new THREE.Mesh(spokeGeo, spokeMat);
      spoke.position.y = 0.015;
      spoke.rotation.y = (Math.PI / 2) * i;
      this.group.add(spoke);
    }

    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const markerGeo = new THREE.BoxGeometry(0.34, 0.06, 0.14);
      const marker = new THREE.Mesh(markerGeo, spokeMat);
      marker.position.set(
        Math.cos(angle) * (ARENA_RADIUS - 0.34),
        0.03,
        Math.sin(angle) * (ARENA_RADIUS - 0.34)
      );
      marker.rotation.y = angle;
      this.group.add(marker);
    }

    const groundGeo = new THREE.PlaneGeometry(60, 60);
    const groundMat = new THREE.MeshStandardMaterial({
      color: arena.ground,
      roughness: 1,
      metalness: 0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.54;
    ground.receiveShadow = true;
    this.group.add(ground);

    this._addDecor(stage);
  }

  _addDecor(stage) {
    const { decorKind, accentGlow, detail, trim } = stage.arena;
    switch (decorKind) {
      case 'braziers':
        this._addBraziers(accentGlow, detail, trim);
        break;
      case 'lanterns':
        this._addLanterns(accentGlow, detail, trim);
        break;
      case 'obelisks':
        this._addObelisks(accentGlow, detail, trim);
        break;
      case 'shrines':
        this._addShrines(accentGlow, detail, trim);
        break;
      default:
        break;
    }
  }

  _forEachPerimeterNode(fn) {
    const radius = ARENA_RADIUS + 2.4;
    for (let i = 0; i < 4; i++) {
      const angle = Math.PI / 4 + (Math.PI / 2) * i;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      fn({ angle, x, z });
    }
  }

  _addBraziers(glowColor, baseColor, trimColor) {
    const stoneMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.9, metalness: 0.05 });
    const metalMat = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.45, metalness: 0.3 });
    const glowMat = new THREE.MeshBasicMaterial({ color: glowColor });
    this._forEachPerimeterNode(({ x, z }) => {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.72, 16), stoneMat);
      pedestal.position.set(x, 0.1, z);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.16, 18), metalMat);
      bowl.position.set(x, 0.56, z);
      const ember = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), glowMat);
      ember.position.set(x, 0.64, z);
      this.group.add(pedestal, bowl, ember);
    });
  }

  _addLanterns(glowColor, baseColor, trimColor) {
    const postMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.82, metalness: 0.1 });
    const frameMat = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.42, metalness: 0.24 });
    const glowMat = new THREE.MeshBasicMaterial({ color: glowColor });
    this._forEachPerimeterNode(({ x, z, angle }) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 1.45, 12), postMat);
      post.position.set(x, 0.25, z);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.05, 0.05), frameMat);
      arm.position.set(x, 0.88, z);
      arm.rotation.y = angle + Math.PI / 2;
      const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.24, 0.18), glowMat);
      lantern.position.set(x + Math.cos(angle) * 0.18, 0.74, z + Math.sin(angle) * 0.18);
      this.group.add(post, arm, lantern);
    });
  }

  _addObelisks(glowColor, baseColor, trimColor) {
    const stoneMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.92, metalness: 0.02 });
    const trimMat = new THREE.MeshStandardMaterial({
      color: trimColor,
      roughness: 0.5,
      metalness: 0.16,
      emissive: glowColor,
      emissiveIntensity: 0.04,
    });
    this._forEachPerimeterNode(({ x, z, angle }) => {
      const obelisk = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.6, 0.34), stoneMat);
      obelisk.position.set(x, 0.3, z);
      obelisk.rotation.y = angle;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.2), trimMat);
      cap.position.set(x, 1.2, z);
      this.group.add(obelisk, cap);
    });
  }

  _addShrines(glowColor, baseColor, trimColor) {
    const pillarMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.88, metalness: 0.06 });
    const accentMat = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.48, metalness: 0.25 });
    const glowMat = new THREE.MeshBasicMaterial({ color: glowColor });
    this._forEachPerimeterNode(({ x, z, angle }) => {
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.25, 0.16), pillarMat);
      const right = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.25, 0.16), pillarMat);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.12, 0.18), accentMat);
      const glow = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), glowMat);
      const dx = Math.cos(angle + Math.PI / 2) * 0.22;
      const dz = Math.sin(angle + Math.PI / 2) * 0.22;
      left.position.set(x - dx, 0.12, z - dz);
      right.position.set(x + dx, 0.12, z + dz);
      lintel.position.set(x, 0.78, z);
      lintel.rotation.y = angle;
      glow.position.set(x, 0.52, z);
      this.group.add(left, right, lintel, glow);
    });
  }

  isOutOfBounds(x, z) {
    return Math.sqrt(x * x + z * z) > ARENA_RADIUS + 0.5;
  }

  clampToArena(pos) {
    const dist = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
    if (dist > ARENA_RADIUS - 0.3) {
      const scale = (ARENA_RADIUS - 0.3) / dist;
      pos.x *= scale;
      pos.z *= scale;
    }
    return pos;
  }
}
