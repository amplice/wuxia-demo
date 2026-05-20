import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARENA_RADIUS } from '../core/Constants.js';
import { DEFAULT_STAGE, STAGE_DEFS, normalizeStageId } from './StageDefs.js';
import { setCurrentArenaStage } from './ArenaBounds.js';

export class Arena {
  constructor(scene, stageId = DEFAULT_STAGE) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.loader = new GLTFLoader();
    this.stageId = normalizeStageId(stageId);
    this._loadToken = 0;
    scene.add(this.group);
  }

  async setStage(stageId = DEFAULT_STAGE) {
    const normalized = normalizeStageId(stageId);
    const token = ++this._loadToken;
    this.stageId = normalized;
    setCurrentArenaStage(normalized);
    this._clearGroup();

    const stage = STAGE_DEFS[normalized];
    if (stage.builder === 'low_poly_arena') {
      this._buildLowPolyArena(stage);
      return normalized;
    }

    if (!stage.modelPath) {
      this._buildTestArena();
      return normalized;
    }

    try {
      const gltf = await this.loader.loadAsync(stage.modelPath);
      if (token !== this._loadToken) return this.stageId;
      this._buildModelArena(gltf.scene, stage);
      return normalized;
    } catch (error) {
      console.warn(`[arena] Failed to load stage '${normalized}', falling back to test arena`, error);
      if (token === this._loadToken) {
        this.stageId = DEFAULT_STAGE;
        setCurrentArenaStage(DEFAULT_STAGE);
        this._buildTestArena();
      }
      return DEFAULT_STAGE;
    }
  }

  _clearGroup() {
    while (this.group.children.length) {
      const child = this.group.children.pop();
      this._disposeObject(child);
    }
  }

  _disposeObject(object) {
    object.traverse?.((child) => {
      child.geometry?.dispose?.();
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) continue;
        for (const value of Object.values(material)) {
          if (value?.isTexture) value.dispose();
        }
        material.dispose?.();
      }
    });
  }

  _buildModelArena(model, stage) {
    const root = new THREE.Group();
    root.name = `stage_${stage.id}`;
    model.name = `${stage.id}_model`;
    model.scale.setScalar(stage.modelScale ?? 1);
    model.position.y = stage.modelYOffset ?? 0;
    model.traverse((child) => {
      if (!child.isMesh) return;
      child.castShadow = true;
      child.receiveShadow = true;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (!material) continue;
        material.roughness = Math.max(material.roughness ?? 0.8, 0.72);
        material.metalness = Math.min(material.metalness ?? 0, 0.12);
      }
    });
    root.add(model);
    this.group.add(root);
    this._addPitFloor(stage);
    if (stage.showBoundaryMarkers !== false) {
      this._addFightBoundaryMarkers(0.035, 0xb88d55);
    }
  }

  _addPitFloor(stage) {
    if (!stage.pitFloor) return;
    const floorGeo = new THREE.CircleGeometry(stage.pitFloor.radius ?? ARENA_RADIUS, 96);
    const floorMat = new THREE.MeshStandardMaterial({
      color: stage.pitFloor.color ?? 0x8b7354,
      roughness: 0.92,
      metalness: 0.02,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.name = `${stage.id}_fight_pit_floor`;
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = stage.pitFloor.y ?? 0.015;
    floor.receiveShadow = true;
    this.group.add(floor);
  }

  _buildTestArena() {
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

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0x666666,
      roughness: 0.8,
      side: THREE.DoubleSide,
    });
    this._addFightBoundaryMarkers(0.01, 0x666666, ringMat);

    const centerGeo = new THREE.CircleGeometry(0.5, 24);
    const centerMat = new THREE.MeshStandardMaterial({
      color: 0x776644,
      roughness: 0.7,
    });
    const center = new THREE.Mesh(centerGeo, centerMat);
    center.rotation.x = -Math.PI / 2;
    center.position.y = 0.01;
    this.group.add(center);

    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2;
      const markerGeo = new THREE.BoxGeometry(0.3, 0.05, 0.1);
      const marker = new THREE.Mesh(markerGeo, ringMat);
      marker.position.set(
        Math.cos(angle) * (ARENA_RADIUS - 0.3),
        0.02,
        Math.sin(angle) * (ARENA_RADIUS - 0.3),
      );
      marker.rotation.y = angle;
      this.group.add(marker);
    }

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

  _buildLowPolyArena(stage) {
    const root = new THREE.Group();
    root.name = `stage_${stage.id}`;
    this.group.add(root);

    const sandTexture = this._makeSandTexture();
    const stoneTexture = this._makeStoneTexture(0x746959, 0x463f37, 0x9b8e78);
    const stoneDarkTexture = this._makeStoneTexture(0x4a4238, 0x2b2622, 0x685d4f);
    const redBannerTexture = this._makeBannerTexture(0x79201c, 0xa42c25);
    const blueBannerTexture = this._makeBannerTexture(0x172a46, 0x25456d);

    const sandMat = this._mat(0xffffff, { map: sandTexture, roughness: 0.98, flatShading: true });
    const stoneMat = this._mat(0xffffff, { map: stoneTexture, roughness: 0.94, flatShading: true, side: THREE.DoubleSide });
    const stoneDarkMat = this._mat(0xffffff, { map: stoneDarkTexture, roughness: 0.98, flatShading: true, side: THREE.DoubleSide });
    const stoneLightMat = this._mat(0xb0a185, { map: stoneTexture, roughness: 0.9, flatShading: true, side: THREE.DoubleSide });
    const woodMat = this._mat(0x3e2418, { roughness: 0.82, flatShading: true });
    const redBannerMat = this._mat(0xffffff, { map: redBannerTexture, roughness: 0.92, side: THREE.DoubleSide });
    const blueBannerMat = this._mat(0xffffff, { map: blueBannerTexture, roughness: 0.92, side: THREE.DoubleSide });
    const emberMat = this._mat(0xff8a22, { emissive: 0xff4a00, emissiveIntensity: 1.7, flatShading: true });

    this._addGround(root);
    this._addStageLighting(root);

    const floor = new THREE.Mesh(
      new THREE.CylinderGeometry(ARENA_RADIUS + 0.22, ARENA_RADIUS + 0.58, 0.26, 40),
      sandMat,
    );
    floor.name = 'blood_sand_floor';
    floor.position.y = -0.13;
    floor.receiveShadow = true;
    root.add(floor);

    this._addLowPolyWall(root, stoneMat, stoneDarkMat, stoneLightMat);
    this._addLowPolyStands(root, stoneMat, stoneDarkMat, stoneLightMat);
    this._addMonumentArches(root, stoneMat, stoneDarkMat, stoneLightMat, redBannerMat, emberMat);
    this._addBanners(root, redBannerMat, blueBannerMat);
    this._addTorches(root, woodMat, emberMat);
    this._addBrokenStone(root, stoneMat, stoneDarkMat, stoneLightMat);
  }

  _mat(color, options = {}) {
    return new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      metalness: 0.03,
      ...options,
    });
  }

  _makeCanvasTexture(width, height, draw) {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    draw(ctx, width, height);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 2;
    texture.needsUpdate = true;
    return texture;
  }

  _colorStyle(color, alpha = 1) {
    const r = (color >> 16) & 255;
    const g = (color >> 8) & 255;
    const b = color & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  _makeRand(seed) {
    let state = seed >>> 0;
    return () => {
      state = (Math.imul(1664525, state) + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  }

  _makeSandTexture() {
    return this._makeCanvasTexture(512, 512, (ctx, width, height) => {
      const rand = this._makeRand(0x5a4d201d);
      ctx.fillStyle = this._colorStyle(0xa86f3e);
      ctx.fillRect(0, 0, width, height);

      for (let i = 0; i < 4200; i++) {
        const v = rand();
        ctx.fillStyle = v > 0.58
          ? this._colorStyle(0xc18a52, 0.13)
          : this._colorStyle(0x704831, 0.1);
        ctx.fillRect(rand() * width, rand() * height, 1, 1);
      }

      for (let i = 0; i < 18; i++) {
        const x = rand() * width;
        const y = rand() * height;
        ctx.strokeStyle = this._colorStyle(0x60402e, 0.07);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 28, y + (rand() - 0.5) * 8);
        ctx.stroke();
      }
    });
  }

  _makeStoneTexture(base = 0x696051, shadow = 0x3e3831, light = 0x8d816e) {
    return this._makeCanvasTexture(256, 256, (ctx, width, height) => {
      const rand = this._makeRand(base ^ shadow ^ light);
      ctx.fillStyle = this._colorStyle(base);
      ctx.fillRect(0, 0, width, height);

      for (let y = 0; y < height; y += 32) {
        for (let x = -16; x < width; x += 52) {
          const offset = (Math.floor(y / 32) % 2) * 24;
          ctx.fillStyle = this._colorStyle(rand() > 0.5 ? light : shadow, 0.18);
          ctx.fillRect(x + offset, y, 48 + rand() * 16, 28 + rand() * 8);
        }
      }

      ctx.strokeStyle = this._colorStyle(0x1c1916, 0.26);
      ctx.lineWidth = 2;
      for (let y = 32; y < height; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y + (rand() - 0.5) * 3);
        ctx.lineTo(width, y + (rand() - 0.5) * 3);
        ctx.stroke();
      }
      for (let i = 0; i < 32; i++) {
        const x = rand() * width;
        const y = rand() * height;
        ctx.strokeStyle = this._colorStyle(0x171412, 0.22);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rand() - 0.5) * 34, y + (rand() - 0.5) * 26);
        ctx.stroke();
      }
    });
  }

  _makeBannerTexture(base, highlight) {
    return this._makeCanvasTexture(128, 256, (ctx, width, height) => {
      const rand = this._makeRand(base ^ highlight ^ 0x9119);
      ctx.fillStyle = this._colorStyle(base);
      ctx.fillRect(0, 0, width, height);

      for (let x = 0; x < width; x += 18) {
        ctx.fillStyle = this._colorStyle(x % 36 === 0 ? highlight : 0x080706, x % 36 === 0 ? 0.18 : 0.12);
        ctx.fillRect(x, 0, 8 + rand() * 5, height);
      }

      for (let i = 0; i < 16; i++) {
        ctx.strokeStyle = this._colorStyle(0x0b0908, 0.18);
        ctx.lineWidth = 1;
        ctx.beginPath();
        const y = rand() * height;
        ctx.moveTo(rand() * width, y);
        ctx.lineTo(rand() * width, y + (rand() - 0.5) * 18);
        ctx.stroke();
      }
    });
  }

  _addGround(root) {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(18, 48),
      new THREE.MeshStandardMaterial({
        color: 0x171411,
        roughness: 1,
        flatShading: true,
      }),
    );
    ground.name = 'arena_dark_ground';
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.32;
    ground.receiveShadow = true;
    root.add(ground);
  }

  _addStageLighting(root) {
    const warmFill = new THREE.PointLight(0xffb06a, 1.75, 18, 1.65);
    warmFill.name = 'arena_warm_fill';
    warmFill.position.set(0, 5.4, 1.2);
    root.add(warmFill);

    const coolBack = new THREE.DirectionalLight(0x7f9dff, 0.34);
    coolBack.name = 'arena_cool_backlight';
    coolBack.position.set(-4, 5, -7);
    root.add(coolBack);

    const upperBounce = new THREE.HemisphereLight(0xffd2a2, 0x241713, 0.44);
    upperBounce.name = 'arena_upper_bounce';
    root.add(upperBounce);
  }

  _addLowPolyWall(root, stoneMat, stoneDarkMat, stoneLightMat) {
    const innerWall = new THREE.Mesh(
      new THREE.CylinderGeometry(8.28, 8.52, 0.92, 48, 1, true),
      stoneMat,
    );
    innerWall.name = 'continuous_inner_arena_wall';
    innerWall.position.y = 0.44;
    innerWall.castShadow = true;
    innerWall.receiveShadow = true;
    root.add(innerWall);

    for (const [radius, y, tube, mat] of [
      [8.4, 0.04, 0.05, stoneDarkMat],
      [8.5, 0.94, 0.08, stoneLightMat],
    ]) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 5, 48), mat);
      rail.name = 'arena_wall_rail';
      rail.rotation.x = Math.PI / 2;
      rail.position.y = y;
      rail.castShadow = true;
      rail.receiveShadow = true;
      root.add(rail);
    }

    for (let i = 0; i < 18; i++) {
      const angle = (i / 18) * Math.PI * 2;
      const inset = new THREE.Mesh(
        new THREE.BoxGeometry(0.48, 0.54, 0.06),
        stoneDarkMat,
      );
      inset.name = 'inner_wall_arch_shadow';
      this._placeRadial(inset, 8.22, angle, 0.44, true);
      inset.receiveShadow = true;
      root.add(inset);
    }

    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2 + Math.PI / 12;
      const buttress = new THREE.Mesh(new THREE.BoxGeometry(0.38, 1.12, 0.68), stoneDarkMat);
      buttress.name = 'arena_wall_buttress';
      this._placeRadial(buttress, 8.7, angle, 0.58, true);
      buttress.castShadow = true;
      buttress.receiveShadow = true;
      root.add(buttress);
    }
  }

  _addLowPolyStands(root, stoneMat, stoneDarkMat, stoneLightMat) {
    for (let row = 0; row < 5; row++) {
      const inner = 8.88 + row * 0.78;
      const outer = inner + 0.56;
      const step = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 48),
        row % 2 === 0 ? stoneLightMat : stoneMat,
      );
      step.name = 'continuous_stand_step';
      step.rotation.x = -Math.PI / 2;
      step.position.y = 0.96 + row * 0.22;
      step.receiveShadow = true;
      root.add(step);

      const riser = new THREE.Mesh(
        new THREE.CylinderGeometry(inner, inner, 0.28, 48, 1, true),
        stoneDarkMat,
      );
      riser.name = 'stand_riser';
      riser.position.y = 0.82 + row * 0.22;
      riser.receiveShadow = true;
      root.add(riser);
    }
  }

  _addMonumentArches(root, stoneMat, stoneDarkMat, stoneLightMat, redBannerMat, emberMat) {
    for (const [angle, width, height, broken] of [
      [-Math.PI / 2, 3.2, 2.0, false],
      [-Math.PI / 2 - 0.62, 1.9, 1.45, true],
      [-Math.PI / 2 + 0.62, 1.9, 1.45, true],
      [Math.PI / 2, 2.25, 1.45, true],
    ]) {
      const arch = new THREE.Group();
      arch.name = 'ruined_arena_arch';
      arch.position.set(Math.cos(angle) * 9.1, 0, Math.sin(angle) * 9.1);
      arch.rotation.y = -angle - Math.PI / 2;
      root.add(arch);

      for (const sx of [-1, 1]) {
        const column = new THREE.Mesh(
          new THREE.BoxGeometry(broken ? 0.38 : 0.5, height, 0.64),
          sx < 0 && broken ? stoneDarkMat : stoneMat,
        );
        column.name = 'ruined_arch_column';
        column.position.set(sx * width * 0.38, height * 0.5, 0);
        column.rotation.z = broken && sx < 0 ? -0.08 : 0;
        column.castShadow = true;
        column.receiveShadow = true;
        arch.add(column);
      }

      const lintel = new THREE.Mesh(
        new THREE.BoxGeometry(width, broken ? 0.28 : 0.34, 0.72),
        broken ? stoneDarkMat : stoneLightMat,
      );
      lintel.name = 'ruined_arch_lintel';
      lintel.position.set(broken ? 0.1 : 0, height + (broken ? 0.03 : 0.08), 0);
      lintel.rotation.z = broken ? 0.04 : 0;
      lintel.castShadow = true;
      lintel.receiveShadow = true;
      arch.add(lintel);

      if (!broken) {
        const cap = new THREE.Mesh(new THREE.BoxGeometry(width + 0.5, 0.18, 0.84), stoneDarkMat);
        cap.name = 'main_arch_capstone';
        cap.position.set(0, height + 0.36, 0);
        cap.castShadow = true;
        cap.receiveShadow = true;
        arch.add(cap);

        const banner = new THREE.Mesh(this._bannerGeometry(0.92, 1.38), redBannerMat);
        banner.name = 'main_arch_banner';
        banner.position.set(0, height * 0.48, 0.38);
        arch.add(banner);

        for (const sx of [-1.25, 1.25]) {
          const flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.42, 6), emberMat);
          flame.name = 'main_arch_flame';
          flame.position.set(sx, height + 0.36, 0.08);
          arch.add(flame);

          const light = new THREE.PointLight(0xff8a33, 0.45, 4.0, 2.1);
          light.name = 'main_arch_light';
          light.position.copy(flame.position);
          arch.add(light);
        }
      }
    }
  }

  _addBanners(root, redBannerMat, blueBannerMat) {
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const banner = new THREE.Mesh(
        this._bannerGeometry(0.52, 1.12),
        i % 2 === 0 ? redBannerMat : blueBannerMat,
      );
      banner.name = 'hanging_arena_banner';
      banner.position.set(Math.cos(angle) * 8.18, 0.66, Math.sin(angle) * 8.18);
      banner.rotation.y = -angle;
      banner.rotation.z = ((i % 3) - 1) * 0.06;
      banner.castShadow = true;
      root.add(banner);
    }

    for (const [angle, mat, y] of [
      [-0.98, redBannerMat, 0.98],
      [-2.16, blueBannerMat, 0.92],
    ]) {
      const longBanner = new THREE.Mesh(this._bannerGeometry(0.7, 1.42), mat);
      longBanner.name = 'tall_ruin_banner';
      longBanner.position.set(Math.cos(angle) * 8.18, y, Math.sin(angle) * 8.18);
      longBanner.rotation.y = -angle;
      longBanner.rotation.z = angle < -1 ? -0.08 : 0.06;
      root.add(longBanner);
    }
  }

  _bannerGeometry(width, height) {
    const half = width / 2;
    const shape = new THREE.Shape();
    shape.moveTo(-half, height / 2);
    shape.lineTo(half, height / 2);
    shape.lineTo(half, -height / 2 + 0.18);
    shape.lineTo(0, -height / 2);
    shape.lineTo(-half, -height / 2 + 0.18);
    shape.lineTo(-half, height / 2);
    return new THREE.ShapeGeometry(shape);
  }

  _addTorches(root, woodMat, emberMat) {
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.cos(angle) * 7.86;
      const z = Math.sin(angle) * 7.86;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.08, 1.16, 5), woodMat);
      post.name = 'torch_post';
      post.position.set(x, 0.76, z);
      post.castShadow = true;
      root.add(post);

      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.42, 6), emberMat);
      flame.name = 'torch_flame';
      flame.position.set(x, 1.42, z);
      flame.rotation.y = angle;
      root.add(flame);

      const light = new THREE.PointLight(0xff8a33, 0.42, 4.2, 2.1);
      light.name = 'torch_light';
      light.position.set(x, 1.35, z);
      root.add(light);
    }
  }

  _addBrokenStone(root, stoneMat, stoneDarkMat, stoneLightMat) {
    for (const [angle, height, lean] of [
      [0.55, 0.9, 0.16],
      [2.6, 0.62, -0.22],
      [4.05, 1.05, 0.1],
    ]) {
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, height, 7), stoneMat);
      column.name = 'broken_column';
      column.position.set(Math.cos(angle) * 9.45, height * 0.5 - 0.03, Math.sin(angle) * 9.45);
      column.rotation.z = lean;
      column.castShadow = true;
      column.receiveShadow = true;
      root.add(column);
    }
  }

  _placeRadial(object, radius, angle, y, tangent = false) {
    object.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    object.rotation.y = tangent ? -angle : 0;
  }

  _addFightBoundaryMarkers(y, color, material = null) {
    const ringGeo = new THREE.RingGeometry(ARENA_RADIUS * 0.6, ARENA_RADIUS * 0.62, 64);
    const ringMat = material ?? new THREE.MeshStandardMaterial({
      color,
      roughness: 0.85,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.name = 'fight_boundary_ring';
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = y;
    ring.receiveShadow = true;
    this.group.add(ring);
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
