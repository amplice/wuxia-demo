import * as THREE from 'three';
import { WEAPON_STATS } from './WeaponData.js';
import { WeaponType } from '../core/Constants.js';

export class Weapon {
  constructor(weaponType) {
    this.type = weaponType;
    this.stats = WEAPON_STATS[weaponType];
    this.group = new THREE.Group();
    this.bladeMesh = null;
    this.tipPosition = new THREE.Vector3();
    this._build();
  }

  _build() {
    const s = this.stats;

    if (this.type === WeaponType.SPEAR) {
      // Spear - thin long cylinder
      const geo = new THREE.CylinderGeometry(0.01, 0.01, s.length, 6);
      geo.translate(0, s.length / 2, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: s.color,
        roughness: 0.7,
        metalness: 0.2,
      });
      this.bladeMesh = new THREE.Mesh(geo, mat);
      this.group.add(this.bladeMesh);
    } else if (this.type === WeaponType.STAFF) {
      // Staff - long cylinder
      const geo = new THREE.CylinderGeometry(s.width, s.width * 0.8, s.length, 6);
      geo.translate(0, s.length / 2, 0);
      const mat = new THREE.MeshStandardMaterial({
        color: s.color,
        roughness: 0.7,
        metalness: 0.1,
      });
      this.bladeMesh = new THREE.Mesh(geo, mat);
      this.group.add(this.bladeMesh);
    } else {
      // Sword - handle + guard + blade
      // Handle
      const handleGeo = new THREE.CylinderGeometry(0.015, 0.018, 0.15, 6);
      handleGeo.translate(0, 0.075, 0);
      const handleMat = new THREE.MeshStandardMaterial({ color: 0x332211, roughness: 0.8 });
      const handle = new THREE.Mesh(handleGeo, handleMat);
      this.group.add(handle);

      // Guard
      if (s.guardSize > 0) {
        const guardGeo = new THREE.BoxGeometry(s.guardSize * 2, 0.015, 0.03);
        guardGeo.translate(0, 0.155, 0);
        const guardMat = new THREE.MeshStandardMaterial({ color: 0xaa8844, metalness: 0.6, roughness: 0.3 });
        const guard = new THREE.Mesh(guardGeo, guardMat);
        this.group.add(guard);
      }

      // Blade
      const bladeLength = s.length - 0.15;
      let bladeGeo;
      if (this.type === WeaponType.DAO) {
        // Curved blade approximation - slightly wider, tapered
        bladeGeo = new THREE.BoxGeometry(s.width, bladeLength, 0.005);
        bladeGeo.translate(0, 0.16 + bladeLength / 2, 0);
      } else {
        // Jian - straight double-edged
        bladeGeo = new THREE.BoxGeometry(s.width, bladeLength, 0.004);
        bladeGeo.translate(0, 0.16 + bladeLength / 2, 0);
      }

      const bladeMat = new THREE.MeshStandardMaterial({
        color: s.color,
        metalness: 0.8,
        roughness: 0.2,
      });
      this.bladeMesh = new THREE.Mesh(bladeGeo, bladeMat);
      this.group.add(this.bladeMesh);
    }
  }

  getTipWorldPosition() {
    if (this.bladeMesh) {
      const tip = new THREE.Vector3(0, this.stats.length, 0);
      this.bladeMesh.localToWorld(tip);
      return tip;
    }
    return this.group.getWorldPosition(new THREE.Vector3());
  }

  get mesh() {
    return this.group;
  }
}
