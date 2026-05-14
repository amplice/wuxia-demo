import * as THREE from 'three';

const STYLE_IDS = new Set(['off', 'arcade_steel', 'ink_duel', 'dream_fever', 'crt_blood']);

export class CharacterStyleController {
  constructor() {
    this.styleId = 'off';
    this._animatedUniforms = [];
    this._toonGradient = createToonGradient();
  }

  setStyle(styleId = 'off', fighters = [], extraRoots = []) {
    const nextStyle = STYLE_IDS.has(styleId) ? styleId : 'off';
    this.styleId = nextStyle;
    this._animatedUniforms = [];
    for (const root of extraRoots) {
      if (!root) continue;
      this._setOutlineOnRoot(root, false);
      this._applyToRoot(root, nextStyle);
    }
    for (const fighter of fighters) {
      if (!fighter) continue;
      this._applyToRoot(fighter.root, nextStyle);
      if (fighter.weapon?.mesh) {
        this._applyToRoot(fighter.weapon.mesh, nextStyle);
      }
      const outlineEnabled = nextStyle === 'ink_duel';
      this._setOutlineOnRoot(fighter.root, outlineEnabled);
      if (fighter.weapon?.mesh) {
        this._setOutlineOnRoot(fighter.weapon.mesh, outlineEnabled);
      }
    }
  }

  update(dt) {
    if (!this._animatedUniforms.length) return;
    for (const entry of this._animatedUniforms) {
      entry.uniforms.uStyleTime.value += dt * entry.speed;
    }
  }

  _applyToRoot(root, styleId) {
    root.traverse((child) => {
      if (child.userData.isVisualOutline) return;
      if (!child.isMesh) return;
      this._applyToMesh(child, styleId);
    });
  }

  _applyToMesh(mesh, styleId) {
    const base = getBaseMaterial(mesh);
    disposeStyledMaterial(mesh);

    if (styleId === 'off') {
      mesh.material = base;
      return;
    }

    const styled = materialArrayFromBase(base, (material) => this._styleMaterial(material, styleId, mesh));
    mesh.userData.visualStyledMaterial = styled;
    mesh.material = styled;
  }

  _styleMaterial(baseMaterial, styleId, mesh) {
    switch (styleId) {
      case 'ink_duel':
        return this._createInkMaterial(baseMaterial, mesh);
      case 'arcade_steel':
        return this._createRimStyledMaterial(baseMaterial, mesh, {
          rimColor: new THREE.Color(0x9fdcff),
          rimStrength: 0.14,
          highlightColor: new THREE.Color(0xffd49b),
          highlightStrength: 0.08,
          pulseSpeed: 0.0,
        });
      case 'dream_fever':
        return this._createRimStyledMaterial(baseMaterial, mesh, {
          rimColor: new THREE.Color(0xc796ff),
          rimStrength: 0.55,
          highlightColor: new THREE.Color(0x8cf7ff),
          highlightStrength: 0.22,
          pulseSpeed: 0.75,
        });
      case 'crt_blood':
        return baseMaterial;
      default:
        return baseMaterial;
    }
  }

  _createInkMaterial(baseMaterial, mesh) {
    const toon = new THREE.MeshToonMaterial({
      color: baseMaterial.color?.clone?.() ?? new THREE.Color(0xffffff),
      map: baseMaterial.map ?? null,
      transparent: baseMaterial.transparent ?? false,
      opacity: baseMaterial.opacity ?? 1,
      side: baseMaterial.side ?? THREE.FrontSide,
      emissive: baseMaterial.emissive?.clone?.() ?? new THREE.Color(0x000000),
      emissiveMap: baseMaterial.emissiveMap ?? null,
      gradientMap: this._toonGradient,
      skinning: Boolean(mesh.isSkinnedMesh),
    });
    copyCommonMaterialProps(baseMaterial, toon, mesh);
    toon.userData.visualStyle = 'ink_duel';
    toon.onBeforeCompile = (shader) => {
      shader.uniforms.uInkEdgeColor = { value: new THREE.Color(0x18141a) };
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <output_fragment>',
        `
          vec3 styledOutgoing = outgoingLight;
          float inkFacing = 1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          float inkEdge = smoothstep(0.64, 0.94, inkFacing);
          styledOutgoing = mix(styledOutgoing, uInkEdgeColor, inkEdge * 0.12);
          #ifdef OPAQUE
            diffuseColor.a = 1.0;
          #endif
          gl_FragColor = vec4(styledOutgoing, diffuseColor.a);
        `
      );
    };
    toon.customProgramCacheKey = () => 'ink_duel';
    toon.needsUpdate = true;
    return toon;
  }

  _createRimStyledMaterial(baseMaterial, mesh, config) {
    const mat = baseMaterial.clone();
    copyCommonMaterialProps(baseMaterial, mat, mesh);
    mat.userData.visualStyle = 'rim';
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRimColor = { value: config.rimColor.clone() };
      shader.uniforms.uRimStrength = { value: config.rimStrength };
      shader.uniforms.uHighlightColor = { value: config.highlightColor.clone() };
      shader.uniforms.uHighlightStrength = { value: config.highlightStrength };
      shader.uniforms.uStyleTime = { value: 0 };
      shader.uniforms.uPulseSpeed = { value: config.pulseSpeed ?? 0 };
      shader.uniforms.uQuantize = { value: config.quantize ?? 0 };
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <output_fragment>',
        `
          vec3 styledOutgoing = outgoingLight;
          vec3 viewDir = normalize(vViewPosition);
          float fresnel = pow(1.0 - clamp(dot(normalize(normal), viewDir), 0.0, 1.0), 2.4);
          float pulse = 0.75 + 0.25 * sin(uStyleTime * (uPulseSpeed * 5.0));
          styledOutgoing += uRimColor * fresnel * uRimStrength * pulse;
          float highlightLuma = dot(styledOutgoing, vec3(0.2126, 0.7152, 0.0722));
          styledOutgoing = mix(styledOutgoing, styledOutgoing * uHighlightColor, clamp(highlightLuma * uHighlightStrength, 0.0, 1.0));
          if (uQuantize > 1.0) {
            styledOutgoing = floor(styledOutgoing * uQuantize) / max(uQuantize - 1.0, 1.0);
          }
          #ifdef OPAQUE
            diffuseColor.a = 1.0;
          #endif
          gl_FragColor = vec4(styledOutgoing, diffuseColor.a);
        `
      );
      this._animatedUniforms.push({
        uniforms: shader.uniforms,
        speed: Math.max(config.pulseSpeed ?? 0, 0.35),
      });
    };
    mat.customProgramCacheKey = () => `rim_${config.rimColor.getHexString()}_${config.quantize ?? 0}_${config.pulseSpeed ?? 0}`;
    mat.needsUpdate = true;
    return mat;
  }

  _setOutlineOnRoot(root, enabled) {
    root.traverse((child) => {
      if (!child.isMesh || child.userData.isVisualOutline) return;
      this._setOutlineOnMesh(child, enabled);
    });
  }

  _setOutlineOnMesh(mesh, enabled) {
    const existing = mesh.userData.visualOutlineMesh ?? null;
    if (!enabled) {
      if (existing) {
        existing.removeFromParent();
        disposeMaterial(existing.material);
        mesh.userData.visualOutlineMesh = null;
      }
      return;
    }

    if (existing) return;

    const outline = createOutlineMesh(mesh);
    if (!outline) return;
    mesh.add(outline);
    mesh.userData.visualOutlineMesh = outline;
  }
}

function getBaseMaterial(mesh) {
  if (!mesh.userData.visualBaseMaterial) {
    mesh.userData.visualBaseMaterial = mesh.material;
  }
  return mesh.userData.visualBaseMaterial;
}

function disposeStyledMaterial(mesh) {
  const styled = mesh.userData.visualStyledMaterial;
  if (!styled) return;
  disposeMaterial(styled);
  mesh.userData.visualStyledMaterial = null;
}

function disposeMaterial(material) {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry?.dispose?.());
    return;
  }
  material?.dispose?.();
}

function materialArrayFromBase(base, transform) {
  if (Array.isArray(base)) return base.map(transform);
  return transform(base);
}

function copyCommonMaterialProps(base, target, mesh) {
  const copyIfDefined = (key) => {
    if (base[key] !== undefined) target[key] = base[key];
  };

  copyIfDefined('name');
  copyIfDefined('map');
  copyIfDefined('alphaMap');
  copyIfDefined('normalMap');
  copyIfDefined('roughnessMap');
  copyIfDefined('metalnessMap');
  copyIfDefined('aoMap');
  copyIfDefined('emissiveMap');
  copyIfDefined('lightMap');
  copyIfDefined('transparent');
  copyIfDefined('opacity');
  copyIfDefined('alphaTest');
  copyIfDefined('depthWrite');
  copyIfDefined('depthTest');
  copyIfDefined('side');
  copyIfDefined('fog');
  copyIfDefined('toneMapped');
  if (base.color && target.color) target.color.copy(base.color);
  if (base.emissive && target.emissive) target.emissive.copy(base.emissive);
  if (base.emissiveIntensity !== undefined && target.emissiveIntensity !== undefined) {
    target.emissiveIntensity = base.emissiveIntensity;
  }
  if (base.roughness !== undefined && target.roughness !== undefined) target.roughness = base.roughness;
  if (base.metalness !== undefined && target.metalness !== undefined) target.metalness = base.metalness;
  if (base.normalScale && target.normalScale) target.normalScale.copy(base.normalScale);
  target.skinning = Boolean(mesh.isSkinnedMesh);
  target.needsUpdate = true;
}

function createToonGradient() {
  const data = new Uint8Array([
    78, 82, 92, 255,
    142, 146, 156, 255,
    206, 210, 220, 255,
    246, 242, 234, 255,
  ]);
  const texture = new THREE.DataTexture(data, 4, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  return texture;
}

function createOutlineMesh(mesh) {
  const outlineMaterial = new THREE.MeshBasicMaterial({
    color: 0x161218,
    side: THREE.BackSide,
    fog: false,
    toneMapped: false,
    transparent: false,
    depthWrite: true,
    depthTest: true,
  });
  outlineMaterial.skinning = Boolean(mesh.isSkinnedMesh);
  outlineMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uOutlineWidth = { value: mesh.isSkinnedMesh ? 0.018 : 0.014 };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `
        #include <begin_vertex>
        transformed += normalize(objectNormal) * uOutlineWidth;
      `
    );
  };
  outlineMaterial.customProgramCacheKey = () => `ink_outline_${mesh.isSkinnedMesh ? 'skinned' : 'rigid'}`;
  outlineMaterial.needsUpdate = true;

  const outline = mesh.isSkinnedMesh
    ? new THREE.SkinnedMesh(mesh.geometry, outlineMaterial)
    : new THREE.Mesh(mesh.geometry, outlineMaterial);

  if (mesh.isSkinnedMesh) {
    outline.bind(mesh.skeleton, mesh.bindMatrix);
    outline.bindMode = mesh.bindMode;
  }

  outline.userData.isVisualOutline = true;
  outline.name = `${mesh.name || 'mesh'}__ink_outline`;
  outline.castShadow = false;
  outline.receiveShadow = false;
  outline.renderOrder = (mesh.renderOrder ?? 0) - 1;
  outline.frustumCulled = mesh.frustumCulled;
  outline.position.set(0, 0, 0);
  outline.rotation.set(0, 0, 0);
  outline.scale.set(1, 1, 1);
  return outline;
}
