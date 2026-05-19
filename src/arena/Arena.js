import * as THREE from 'three';
import { ARENA_RADIUS } from '../core/Constants.js';

export class Arena {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this._build();
    scene.add(this.group);
  }

  _build() {
    // Main platform - circular stone
    const platformGeo = new THREE.CylinderGeometry(ARENA_RADIUS, ARENA_RADIUS + 0.3, 0.4, 48);
    const platformMat = new THREE.MeshStandardMaterial({
      color: 0x555555,
      roughness: 0.85,
      metalness: 0.05,
    });
    const platform = new THREE.Mesh(platformGeo, platformMat);
    platform.position.y = -0.2;
    platform.receiveShadow = true;
    this.group.add(platform);

    // Surface detail - concentric ring
    const ringGeo = new THREE.RingGeometry(ARENA_RADIUS * 0.6, ARENA_RADIUS * 0.62, 48);
    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x666666,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    this.group.add(ring);

    // Center circle
    const centerGeo = new THREE.CircleGeometry(0.5, 24);
    const centerMat = new THREE.MeshStandardMaterial({
      color: 0x776644,
      roughness: 0.7,
    });
    const center = new THREE.Mesh(centerGeo, centerMat);
    center.rotation.x = -Math.PI / 2;
    center.position.y = 0.01;
    this.group.add(center);

    // Edge markers - cardinal directions
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const markerGeo = new THREE.BoxGeometry(0.3, 0.05, 0.1);
      const marker = new THREE.Mesh(markerGeo, ringMat);
      marker.position.set(
        Math.cos(angle) * (ARENA_RADIUS - 0.3),
        0.02,
        Math.sin(angle) * (ARENA_RADIUS - 0.3)
      );
      marker.rotation.y = angle;
      this.group.add(marker);
    }

    // Ground plane beneath (visible if you look under the platform)
    const groundGeo = new THREE.PlaneGeometry(50, 50);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 1,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.5;
    ground.receiveShadow = true;
    this.group.add(ground);
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
