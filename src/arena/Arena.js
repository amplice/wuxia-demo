import * as THREE from 'three';
import { clampPointToArena, getArenaBoundaryDistance, getArenaBounds } from './ArenaBounds.js';
import { getStageDef } from './StageDefs.js';

const OCTAGON_VERTEX_ANGLES = Array.from({ length: 8 }, (_, i) => (Math.PI / 4) * i);

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
    const { arena, bounds } = stage;
    const ui = stage.ui ?? null;
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
      roughness: 0.46,
      metalness: 0.22,
      emissive: arena.trim,
      emissiveIntensity: 0.04,
    });
    const detailMat = new THREE.MeshStandardMaterial({
      color: arena.detail,
      roughness: 0.82,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const markerMat = new THREE.MeshStandardMaterial({
      color: arena.marker,
      roughness: 0.6,
      metalness: 0.18,
    });

    const platformShape = createStageShape(bounds, arena.outerInset ?? 0.12);
    const platformGeo = new THREE.ExtrudeGeometry(platformShape, {
      depth: 0.48,
      bevelEnabled: false,
      curveSegments: 48,
      steps: 1,
    });

    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const underShadow = new THREE.Mesh(new THREE.ShapeGeometry(createStageShape(bounds, -0.5), 56), shadowMat);
    underShadow.rotation.x = -Math.PI / 2;
    underShadow.position.y = -0.5;
    this.group.add(underShadow);

    const platform = new THREE.Mesh(platformGeo, [capMat, sideMat]);
    platform.rotation.x = Math.PI / 2;
    platform.receiveShadow = true;
    this.group.add(platform);

    const trimShape = createRingShape(bounds, 0.14, 0.34);
    const trim = new THREE.Mesh(new THREE.ShapeGeometry(trimShape, 56), trimMat);
    trim.rotation.x = -Math.PI / 2;
    trim.position.y = 0.024;
    this.group.add(trim);

    const accentRing = new THREE.Mesh(
      new THREE.ShapeGeometry(createRingShape(bounds, 0.48, 0.7), 56),
      new THREE.MeshBasicMaterial({
        color: arena.accentGlow,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    accentRing.rotation.x = -Math.PI / 2;
    accentRing.position.y = 0.026;
    this.group.add(accentRing);

    const ringShape = createRingShape(bounds, arena.ringOuterInset ?? 2.6, arena.ringInnerInset ?? 3.2);
    const ringMat = new THREE.MeshStandardMaterial({
      color: arena.ring,
      roughness: 0.74,
      metalness: 0.08,
      side: THREE.DoubleSide,
      emissive: arena.accentGlow,
      emissiveIntensity: 0.025,
    });
    const ring = new THREE.Mesh(new THREE.ShapeGeometry(ringShape, 56), ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.014;
    this.group.add(ring);

    const centerShape = createStageShape(bounds, arena.centerInset ?? 6.0);
    const centerMat = new THREE.MeshStandardMaterial({
      color: arena.center,
      roughness: 0.68,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });
    const center = new THREE.Mesh(new THREE.ShapeGeometry(centerShape, 48), centerMat);
    center.rotation.x = -Math.PI / 2;
    center.position.y = 0.016;
    this.group.add(center);

    this._addMotif(stage, detailMat, markerMat);
    this._addInsetPips(stage, ui?.accent ?? null);
    this._addEdgeMarkers(stage, markerMat);

    const groundGeo = new THREE.PlaneGeometry(64, 64);
    const groundMat = new THREE.MeshStandardMaterial({
      color: arena.ground,
      roughness: 1,
      metalness: 0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.56;
    ground.receiveShadow = true;
    this.group.add(ground);

    this._addDecor(stage);
  }

  _addMotif(stage, detailMat, markerMat) {
    const motif = stage.arena.motif;
    if (motif === 'rings') {
      const innerShape = createRingShape(stage.bounds, 5.15, 5.55);
      const inner = new THREE.Mesh(new THREE.ShapeGeometry(innerShape, 40), detailMat);
      inner.rotation.x = -Math.PI / 2;
      inner.position.y = 0.015;
      this.group.add(inner);
      const medallion = new THREE.Mesh(
        new THREE.CircleGeometry(1.2, 32),
        new THREE.MeshStandardMaterial({
          color: stage.arena.marker,
          roughness: 0.52,
          metalness: 0.22,
          emissive: stage.arena.accentGlow,
          emissiveIntensity: 0.05,
        }),
      );
      medallion.rotation.x = -Math.PI / 2;
      medallion.position.y = 0.02;
      this.group.add(medallion);
      return;
    }

    if (motif === 'facets') {
      for (let i = 0; i < 8; i++) {
        const angle = (Math.PI / 4) * i;
        const len = getArenaBoundaryDistance(Math.cos(angle), Math.sin(angle), stage.id, -1.35);
        const panel = new THREE.Mesh(new THREE.BoxGeometry(len * 0.72, 0.018, 0.09), detailMat);
        panel.position.y = 0.017;
        panel.rotation.y = angle;
        this.group.add(panel);
      }
      return;
    }

    if (motif === 'aisle') {
      const laneLength = getArenaBoundaryDistance(1, 0, stage.id, -1.6) * 2;
      const stripGeo = new THREE.BoxGeometry(laneLength, 0.02, 0.16);
      const leftStrip = new THREE.Mesh(stripGeo, detailMat);
      const rightStrip = new THREE.Mesh(stripGeo, detailMat);
      leftStrip.position.set(0, 0.017, -1.25);
      rightStrip.position.set(0, 0.017, 1.25);
      this.group.add(leftStrip, rightStrip);
      const spine = new THREE.Mesh(new THREE.BoxGeometry(laneLength, 0.018, 0.08), markerMat);
      spine.position.set(0, 0.018, 0);
      this.group.add(spine);
      const shrineEnds = [-laneLength * 0.42, laneLength * 0.42];
      for (const x of shrineEnds) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.03, 3.15), detailMat);
        cap.position.set(x, 0.017, 0);
        this.group.add(cap);
      }
      return;
    }

    if (motif === 'cross') {
      const lenX = getArenaBoundaryDistance(1, 0, stage.id, -1.25) * 2;
      const lenZ = getArenaBoundaryDistance(0, 1, stage.id, -1.25) * 2;
      const barX = new THREE.Mesh(new THREE.BoxGeometry(lenX, 0.02, 0.22), detailMat);
      const barZ = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.02, lenZ), detailMat);
      barX.position.y = 0.017;
      barZ.position.y = 0.017;
      this.group.add(barX, barZ);
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const sigil = new THREE.Mesh(new THREE.CircleGeometry(0.18, 18), markerMat);
          sigil.rotation.x = -Math.PI / 2;
          sigil.position.set(sx * (lenX * 0.28), 0.018, sz * (lenZ * 0.28));
          this.group.add(sigil);
        }
      }
    }
  }

  _addInsetPips(stage, accentHex) {
    const pipMat = new THREE.MeshBasicMaterial({
      color: accentHex ?? stage.arena.marker,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    const pipGeo = new THREE.CircleGeometry(0.08, 12);
    const count = stage.bounds.type === 'octagon' ? 8 : 6;
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count;
      const radius = getArenaBoundaryDistance(Math.cos(angle), Math.sin(angle), stage.id, -1.35);
      const pip = new THREE.Mesh(pipGeo, pipMat);
      pip.rotation.x = -Math.PI / 2;
      pip.position.set(Math.cos(angle) * radius, 0.019, Math.sin(angle) * radius);
      this.group.add(pip);
    }
  }

  _addEdgeMarkers(stage, markerMat) {
    const inset = stage.arena.markerInset ?? 0.6;
    const bounds = stage.bounds;
    const markerGeo = new THREE.BoxGeometry(0.38, 0.06, 0.14);
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const boundary = getArenaBoundaryDistance(Math.cos(angle), Math.sin(angle), stage.id, -inset);
      const marker = new THREE.Mesh(markerGeo, markerMat);
      marker.position.set(Math.cos(angle) * boundary, 0.03, Math.sin(angle) * boundary);
      marker.rotation.y = angle;
      this.group.add(marker);
    }

    if (bounds.type === 'octagon' || bounds.type === 'roundedRect') {
      const smallGeo = new THREE.BoxGeometry(0.26, 0.05, 0.12);
      for (let i = 0; i < 4; i++) {
        const angle = Math.PI / 4 + (i * Math.PI) / 2;
        const boundary = getArenaBoundaryDistance(Math.cos(angle), Math.sin(angle), stage.id, -(inset + 0.08));
        const marker = new THREE.Mesh(smallGeo, markerMat);
        marker.position.set(Math.cos(angle) * boundary, 0.028, Math.sin(angle) * boundary);
        marker.rotation.y = angle;
        this.group.add(marker);
      }
    }
  }

  _addDecor(stage) {
    const { decorKind, accentGlow, detail, trim, perimeterOffset = 2.8 } = stage.arena;
    switch (decorKind) {
      case 'braziers':
        this._addBraziers(stage, accentGlow, detail, trim, perimeterOffset);
        break;
      case 'lanterns':
        this._addLanterns(stage, accentGlow, detail, trim, perimeterOffset);
        break;
      case 'obelisks':
        this._addObelisks(stage, accentGlow, detail, trim, perimeterOffset);
        break;
      case 'shrines':
        this._addShrines(stage, accentGlow, detail, trim, perimeterOffset);
        break;
      default:
        break;
    }
  }

  _forEachPerimeterNode(stage, fn) {
    for (let i = 0; i < 4; i++) {
      const angle = Math.PI / 4 + (Math.PI / 2) * i;
      const boundary = getArenaBoundaryDistance(Math.cos(angle), Math.sin(angle), stage.id, stage.arena.perimeterOffset ?? 2.8);
      const x = Math.cos(angle) * boundary;
      const z = Math.sin(angle) * boundary;
      fn({ angle, x, z });
    }
  }

  _addBraziers(stage, glowColor, baseColor, trimColor) {
    const stoneMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.9, metalness: 0.05 });
    const metalMat = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.45, metalness: 0.3 });
    const glowMat = new THREE.MeshBasicMaterial({ color: glowColor });
    this._forEachPerimeterNode(stage, ({ x, z }) => {
      const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.72, 16), stoneMat);
      pedestal.position.set(x, 0.1, z);
      const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.22, 0.16, 18), metalMat);
      bowl.position.set(x, 0.56, z);
      const ember = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), glowMat);
      ember.position.set(x, 0.64, z);
      this.group.add(pedestal, bowl, ember);
    });
  }

  _addLanterns(stage, glowColor, baseColor, trimColor) {
    const postMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.82, metalness: 0.1 });
    const frameMat = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.42, metalness: 0.24 });
    const glowMat = new THREE.MeshBasicMaterial({ color: glowColor });
    this._forEachPerimeterNode(stage, ({ x, z, angle }) => {
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

  _addObelisks(stage, glowColor, baseColor, trimColor) {
    const stoneMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.92, metalness: 0.02 });
    const trimMat = new THREE.MeshStandardMaterial({
      color: trimColor,
      roughness: 0.5,
      metalness: 0.16,
      emissive: glowColor,
      emissiveIntensity: 0.04,
    });
    this._forEachPerimeterNode(stage, ({ x, z, angle }) => {
      const obelisk = new THREE.Mesh(new THREE.BoxGeometry(0.34, 1.6, 0.34), stoneMat);
      obelisk.position.set(x, 0.3, z);
      obelisk.rotation.y = angle;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.24, 0.2), trimMat);
      cap.position.set(x, 1.2, z);
      this.group.add(obelisk, cap);
    });
  }

  _addShrines(stage, glowColor, baseColor, trimColor) {
    const pillarMat = new THREE.MeshStandardMaterial({ color: baseColor, roughness: 0.88, metalness: 0.06 });
    const accentMat = new THREE.MeshStandardMaterial({ color: trimColor, roughness: 0.48, metalness: 0.25 });
    const glowMat = new THREE.MeshBasicMaterial({ color: glowColor });
    this._forEachPerimeterNode(stage, ({ x, z, angle }) => {
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
    return Math.hypot(x, z) > getArenaBoundaryDistance(x, z, this.stageId, 0.5);
  }

  clampToArena(pos) {
    return clampPointToArena(pos, this.stageId, 0.3);
  }
}

function createRingShape(bounds, outerInset, innerInset) {
  const outer = createStageShape(bounds, outerInset);
  outer.holes.push(createStagePath(bounds, innerInset));
  return outer;
}

function createStageShape(bounds, inset = 0) {
  const shape = createStagePath(bounds, inset);
  shape.autoClose = true;
  return shape;
}

function createStagePath(bounds, inset = 0) {
  switch (bounds.type) {
    case 'circle':
      return createCirclePath(Math.max(0.15, bounds.radius - inset));
    case 'ellipse':
      return createEllipsePath(Math.max(0.2, bounds.radiusX - inset), Math.max(0.2, bounds.radiusZ - inset));
    case 'octagon':
      return createOctagonPath(Math.max(0.2, bounds.radius - inset));
    case 'roundedRect':
      return createRoundedRectPath(
        Math.max(0.25, bounds.halfWidth - inset),
        Math.max(0.25, bounds.halfDepth - inset),
        Math.max(0.08, bounds.cornerRadius - inset * 0.6),
      );
    default:
      return createCirclePath(8);
  }
}

function createCirclePath(radius) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, radius, 0, Math.PI * 2, false);
  return shape;
}

function createEllipsePath(radiusX, radiusZ) {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, radiusX, radiusZ, 0, Math.PI * 2, false, 0);
  return shape;
}

function createOctagonPath(radius) {
  const shape = new THREE.Shape();
  OCTAGON_VERTEX_ANGLES.forEach((angle, index) => {
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    if (index === 0) shape.moveTo(x, z);
    else shape.lineTo(x, z);
  });
  shape.closePath();
  return shape;
}

function createRoundedRectPath(halfWidth, halfDepth, cornerRadius) {
  const r = Math.min(cornerRadius, halfWidth - 0.05, halfDepth - 0.05);
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + r, -halfDepth);
  shape.lineTo(halfWidth - r, -halfDepth);
  shape.absarc(halfWidth - r, -halfDepth + r, r, -Math.PI / 2, 0, false);
  shape.lineTo(halfWidth, halfDepth - r);
  shape.absarc(halfWidth - r, halfDepth - r, r, 0, Math.PI / 2, false);
  shape.lineTo(-halfWidth + r, halfDepth);
  shape.absarc(-halfWidth + r, halfDepth - r, r, Math.PI / 2, Math.PI, false);
  shape.lineTo(-halfWidth, -halfDepth + r);
  shape.absarc(-halfWidth + r, -halfDepth + r, r, Math.PI, Math.PI * 1.5, false);
  shape.closePath();
  return shape;
}
