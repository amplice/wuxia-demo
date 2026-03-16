import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export class ModelLoader {
  static RIGHT_HAND_BONE_NAMES = [
    'hand_r', 'handr', 'righthand', 'hand_r_001',
    'mixamorig_righthand', 'right_wrist', 'rightwrist',
    'wrist_r', 'mixamorig_rightwrist',
  ];

  static LEFT_HAND_BONE_NAMES = [
    'hand_l', 'handl', 'lefthand', 'hand_l_001',
    'mixamorig_lefthand', 'left_wrist', 'leftwrist',
    'wrist_l', 'mixamorig_leftwrist',
  ];

  static WEAPON_TIP_BONE_NAMES = [
    'speartip', 'katanatip', 'swordtip', 'bladetip', 'weapontip', 'tip',
  ];

  static WEAPON_BASE_BONE_NAMES = [
    'spearcontrol', 'katanacontrol', 'weaponcontrol', 'bladecontrol', 'swordcontrol',
  ];

  static BODY_ANCHOR_BONE_NAMES = [
    'pelvis', 'hips', 'mixamorig_hips',
    'spine', 'mixamorig_spine',
    'spine1', 'mixamorig_spine1',
    'spine2', 'mixamorig_spine2',
  ];

  /**
   * Load a character from its definition. Returns { model, clips, texture: null, charDef }.
   */
  static async loadCharacter(charDef) {
    const gltf = await ModelLoader._loadGLB(charDef.glbPath);
    const model = ModelLoader._pickBestScene(gltf);
    ModelLoader._pruneHelperNodes(model);

    const clips = {};
    for (const clip of gltf.animations) {
      let name = clip.name.includes('|') ? clip.name.split('|').pop() : clip.name;
      name = name.replace(/_(Character_All|Armature)$/, '');
      if (!clips[name]) {
        clips[name] = clip;
        continue;
      }

      const existingScore = ModelLoader._scoreClipQuality(clips[name]);
      const candidateScore = ModelLoader._scoreClipQuality(clip);
      if (candidateScore >= existingScore) {
        clips[name] = clip;
      }
    }

    // Swap idle if configured
    if (charDef.swapIdle) {
      const { from, to } = charDef.swapIdle;
      if (clips[from]) {
        clips[to + '_orig'] = clips[to];
        clips[to] = clips[from];
        delete clips[from];
      }
    }

    // Apply hips forward lean to walk/strafe/idle clips
    if (charDef.hipsLeanDeg) {
      const lean = charDef.hipsLeanDeg * (Math.PI / 180);
      const leanQ = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), lean);
      const q = new THREE.Quaternion();

      const leanClips = [
        ...(charDef.clipSpeedups.walk || []),
        ...(charDef.clipSpeedups.strafe || []),
        'idle',
      ];
      for (const clipName of leanClips) {
        const clip = clips[clipName];
        if (!clip) continue;
        for (const track of clip.tracks) {
          const n = track.name.toLowerCase();
          if (n.includes('hips') && n.endsWith('.quaternion')) {
            for (let i = 0; i < track.values.length; i += 4) {
              q.set(track.values[i], track.values[i+1], track.values[i+2], track.values[i+3]);
              q.premultiply(leanQ);
              track.values[i] = q.x;
              track.values[i+1] = q.y;
              track.values[i+2] = q.z;
              track.values[i+3] = q.w;
            }
          }
        }
      }
    }

    // Apply speed-ups from charDef.clipSpeedFactor to clip groups in charDef.clipSpeedups
    if (charDef.clipSpeedups && charDef.clipSpeedFactor) {
      for (const [group, names] of Object.entries(charDef.clipSpeedups)) {
        const factor = charDef.clipSpeedFactor[group];
        if (factor && factor !== 1) {
          ModelLoader._speedUpClips(clips, names, factor);
        }
      }
    }

    // Apply per-clip overrides after group speed-ups.
    if (charDef.clipSpeedOverrides) {
      for (const [clipName, factor] of Object.entries(charDef.clipSpeedOverrides)) {
        if (factor && factor !== 1) {
          ModelLoader._speedUpClips(clips, [clipName], factor);
        }
      }
    }

    // Zero out Hips horizontal root motion on attack clips (keep Y for vertical bob)
    const attackClips = charDef.clipSpeedups?.attack || [];
    for (const clipName of attackClips) {
      const clip = clips[clipName];
      if (!clip) continue;
      for (const track of clip.tracks) {
        const n = track.name.toLowerCase();
        if (n.includes('hips') && n.endsWith('.position')) {
          const vpk = track.values.length / track.times.length;
          if (vpk === 3 && track.times.length > 0) {
            const x0 = track.values[0];
            const z0 = track.values[2];
            for (let i = 0; i < track.times.length; i++) {
              track.values[i * 3] = x0;
              track.values[i * 3 + 2] = z0;
            }
          }
        }
      }
    }

    model.traverse((child) => {
      if (child.isSkinnedMesh) child.frustumCulled = false;
    });

    return { model, clips, texture: null, charDef };
  }

  static _pickBestScene(gltf) {
    const scenes = gltf.scenes && gltf.scenes.length ? gltf.scenes : [gltf.scene];
    let bestScene = gltf.scene || scenes[0];
    let bestScore = -Infinity;

    for (const scene of scenes) {
      let score = 0;
      scene.traverse((child) => {
        const name = child.name || '';
        const lower = name.toLowerCase();
        if (name === 'Character_All') score += 200;
        if (name === 'Character_Geo' || name === 'original_geo' || name === 'Katana') score += 40;
        if (child.isBone) score += 1;
        if (name.endsWith('.001')) score -= 80;
        if (lower.includes('griptarget') || lower.includes('poletarget')) score -= 60;
      });

      if (score > bestScore) {
        bestScore = score;
        bestScene = scene;
      }
    }

    return bestScene;
  }

  static _loadFBX(url) {
    return new Promise((resolve, reject) => {
      const loader = new FBXLoader();
      loader.load(url, resolve, undefined, reject);
    });
  }

  static _loadGLB(url) {
    return new Promise((resolve, reject) => {
      const loader = new GLTFLoader();
      loader.load(url, resolve, undefined, reject);
    });
  }

  static _prepareRoot(r) {
    const box = new THREE.Box3().setFromObject(r);
    const height = box.getSize(new THREE.Vector3()).y;
    if (height > 0) r.scale.setScalar(1.8 / height);
    box.setFromObject(r);
    const center = box.getCenter(new THREE.Vector3());
    r.position.x -= center.x;
    r.position.z -= center.z;
    r.position.y -= box.min.y;
    r.traverse((child) => {
      if (child.isSkinnedMesh) child.frustumCulled = false;
      if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
    });
    ModelLoader._alignRootToBodyAnchor(r);
  }

  static async loadAnimPlayerEntries(items) {
    const allEntries = [];

    await Promise.all(items.map(async (item) => {
      try {
      const url = typeof item === 'string' ? item : item.url;
      const splits = typeof item === 'object' && item.splits ? item.splits : null;
      const trimStartFrames = typeof item === 'object' && item.trimStartFrames ? item.trimStartFrames : 0;
      const lower = url.toLowerCase();
      const fileName = url.split('/').pop().replace(/\.(fbx|glb|gltf)$/i, '');

      let root, clips;
      if (lower.endsWith('.glb') || lower.endsWith('.gltf')) {
        const gltf = await ModelLoader._loadGLB(url);
        root = gltf.scene;
        clips = gltf.animations || [];
      } else {
        root = await ModelLoader._loadFBX(url);
        clips = root.animations || [];
      }

      if (splits && clips.length > 0) {
        const srcClip = clips[0];
        srcClip.trim();
        const fps = 60;

        for (const split of splits) {
          try {
          const startTime = split.startFrame / fps;
          const endTime = split.endFrame / fps;
          const duration = endTime - startTime;

          const subTracks = [];
          for (const track of srcClip.tracks) {
            const times = track.times;
            const valuesPerKey = track.values.length / times.length;

            let iStart = 0, iEnd = times.length;
            for (let i = 0; i < times.length; i++) {
              if (times[i] < startTime) iStart = i;
              if (times[i] <= endTime) iEnd = i + 1;
            }

            const count = iEnd - iStart;
            if (count <= 0) continue;

            const newTimes = new Float32Array(count);
            const newValues = new Float32Array(count * valuesPerKey);
            for (let i = iStart; i < iEnd; i++) {
              newTimes[i - iStart] = times[i] - startTime;
              for (let v = 0; v < valuesPerKey; v++) {
                newValues[(i - iStart) * valuesPerKey + v] = track.values[i * valuesPerKey + v];
              }
            }

            const SubTrackType = track.constructor;
            subTracks.push(new SubTrackType(track.name, newTimes, newValues));
          }

          const subClip = new THREE.AnimationClip(split.name, duration, subTracks);

          const clonedRoot = SkeletonUtils.clone(root);
          ModelLoader._prepareRoot(clonedRoot);

          if (split.inPlace) {
            for (const track of subClip.tracks) {
              if (track.name.match(/\.position$/) && track.name.startsWith('spine')) {
                const vpk = track.values.length / track.times.length;
                if (vpk === 3 && track.times.length > 0) {
                  const x0 = track.values[0];
                  const z0 = track.values[2];
                  for (let i = 0; i < track.times.length; i++) {
                    track.values[i * 3] = x0;
                    track.values[i * 3 + 2] = z0;
                  }
                }
              }
            }
          }

          const mixer = new THREE.AnimationMixer(clonedRoot);
          const actions = {};
          actions[split.name] = mixer.clipAction(subClip);

          allEntries.push({ fileName: split.name, root: clonedRoot, mixer, actions });
          } catch (splitErr) {
            console.error(`[AnimPlayer] Split '${split.name}' FAILED:`, splitErr);
          }
        }
      } else {
        for (const clip of clips) {
          if (clips.length === 1) {
            clip.name = fileName;
          } else if (clip.name.includes('|')) {
            clip.name = clip.name.split('|').pop();
          }
          clip.trim();

          if (trimStartFrames > 0) {
            const skipTime = trimStartFrames / 60;
            for (const track of clip.tracks) {
              const vpk = track.values.length / track.times.length;
              let startIdx = 0;
              for (let i = 0; i < track.times.length; i++) {
                if (track.times[i] < skipTime) startIdx = i + 1;
                else break;
              }
              if (startIdx > 0 && startIdx < track.times.length) {
                const newLen = track.times.length - startIdx;
                const newTimes = new Float32Array(newLen);
                const newValues = new Float32Array(newLen * vpk);
                for (let i = 0; i < newLen; i++) {
                  newTimes[i] = track.times[i + startIdx] - skipTime;
                  for (let v = 0; v < vpk; v++) {
                    newValues[i * vpk + v] = track.values[(i + startIdx) * vpk + v];
                  }
                }
                track.times = newTimes;
                track.values = newValues;
              }
            }
            clip.duration = Math.max(0, clip.duration - skipTime);
          }
        }
        ModelLoader._prepareRoot(root);
        const mixer = new THREE.AnimationMixer(root);
        const actions = {};
        for (const clip of clips) {
          actions[clip.name] = mixer.clipAction(clip);
        }
        allEntries.push({ fileName, root, mixer, actions });
      }
      } catch (err) {
        console.error(`[AnimPlayer] FAILED to load '${typeof item === 'string' ? item : item.url}':`, err);
      }
    }));

    return allEntries;
  }

  static _loadTexture(url) {
    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(url, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.NearestFilter;
        tex.magFilter = THREE.NearestFilter;
        resolve(tex);
      }, undefined, reject);
    });
  }

  /**
   * Speed up animation clips by compressing keyframe times.
   * Creates new Float32Arrays (in-place modification causes jerky playback).
   */
  static _speedUpClips(clips, names, speedFactor) {
    for (const name of names) {
      const clip = clips[name];
      if (!clip) continue;
      const origDuration = clip.duration;
      for (const track of clip.tracks) {
        const newTimes = new Float32Array(track.times.length);
        for (let i = 0; i < track.times.length; i++) {
          newTimes[i] = track.times[i] / speedFactor;
        }
        track.times = newTimes;
      }
      clip.duration = origDuration / speedFactor;
      clip.resetDuration();
    }
  }

  static _scoreClipQuality(clip) {
    let score = clip.tracks.length;
    for (const track of clip.tracks) {
      const lower = track.name.toLowerCase();
      if (lower.includes('right_shoulder')) score += 50;
      if (lower.includes('left_shoulder')) score += 10;
      if (/(^|[.\[])\d+([.\]]|$)/.test(lower)) score -= 100;
      if (lower.includes('.001')) score -= 25;
    }
    return score;
  }

  static _pruneRedundantTracks(clip) {
    clip.tracks = clip.tracks.filter((track) => {
      const lowerName = track.name.toLowerCase();
      if (!lowerName.endsWith('.position') && !lowerName.endsWith('.scale')) {
        return true;
      }

      const valuesPerKey = track.values.length / Math.max(track.times.length, 1);
      if (!Number.isFinite(valuesPerKey) || valuesPerKey <= 0) {
        return true;
      }

      for (let i = valuesPerKey; i < track.values.length; i++) {
        const base = track.values[i % valuesPerKey];
        if (Math.abs(track.values[i] - base) > 1e-4) {
          return true;
        }
      }

      // Keep animated root translation; strip all constant translations/scales.
      return false;
    });
    clip.resetDuration();
  }

  /**
   * Create a fighter instance from a GLB model with fight animation clips.
   */
  static createFighterFromGLB(model, clips, texture = null) {
    const clone = SkeletonUtils.clone(model);
    ModelLoader._pruneHelperNodes(clone);

    clone.traverse((child) => {
      if (child.isMesh) {
        const applyMat = (mat) => {
          const m = mat.clone();
            if (texture) m.map = texture;
            m.needsUpdate = true;
            return m;
        };
        if (Array.isArray(child.material)) {
          child.material = child.material.map(applyMat);
        } else {
          child.material = applyMat(child.material);
        }
      }
    });

    const box = new THREE.Box3().setFromObject(clone);
    const height = box.getSize(new THREE.Vector3()).y;
    if (height > 0) clone.scale.setScalar(1.8 / height);

    box.setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    clone.position.x -= center.x;
    clone.position.z -= center.z;
    clone.position.y -= box.min.y;

    clone.traverse((child) => {
      if (child.isSkinnedMesh) child.frustumCulled = false;
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    const joints = {};
    clone.traverse((child) => {
      if (child.isBone) {
        const n = ModelLoader._normalizeBoneName(child.name);
        if (!joints.handR && ModelLoader.RIGHT_HAND_BONE_NAMES.includes(n)) {
          joints.handR = child;
        }
        if (!joints.handL && ModelLoader.LEFT_HAND_BONE_NAMES.includes(n)) {
          joints.handL = child;
        }
        if (!joints.weaponTip && ModelLoader.WEAPON_TIP_BONE_NAMES.includes(n)) {
          joints.weaponTip = child;
        } else if (!joints.weaponTip && n.endsWith('tip')) {
          joints.weaponTip = child;
        }
        if (!joints.weaponBase && ModelLoader.WEAPON_BASE_BONE_NAMES.includes(n)) {
          joints.weaponBase = child;
        }
        if (!joints.spearTip && n === 'speartip') {
          joints.spearTip = child;
        }
        if (!joints.bodyAnchor && ModelLoader.BODY_ANCHOR_BONE_NAMES.includes(n)) {
          joints.bodyAnchor = child;
        }
      }
    });

    if (!joints.weaponTip && joints.spearTip) {
      joints.weaponTip = joints.spearTip;
    }

    ModelLoader._alignRootToBodyAnchor(clone, joints.bodyAnchor);

    clone.updateWorldMatrix(true, true);
    if (joints.bodyAnchor) {
      const anchorWorld = joints.bodyAnchor.getWorldPosition(new THREE.Vector3());
      joints.bodyAnchorLocalOffset = clone.worldToLocal(anchorWorld.clone());
    }

    const mixer = new THREE.AnimationMixer(clone);
    const actions = {};
    for (const [name, clip] of Object.entries(clips)) {
      actions[name] = mixer.clipAction(clip);
    }

    return { root: clone, joints, mixer, actions };
  }

  static _pruneHelperNodes(root) {
    const hasBaseName = new Set();
    root.traverse((child) => {
      hasBaseName.add(child.name);
    });

    const toRemove = [];
    root.traverse((child) => {
      const lower = child.name.toLowerCase();
      const baseName = child.name.replace(/\.\d+$/, '');
      const isDuplicateExportNode = (
        child.name !== baseName &&
        hasBaseName.has(baseName) &&
        (
          baseName === 'Character_All' ||
          baseName === 'Character_Geo' ||
          baseName === 'original_geo' ||
          baseName === 'Katana' ||
          baseName === 'LeftHandKatanaGripTarget' ||
          baseName === 'LeftHandKatanaPoleTarget'
        )
      );
      if (
        lower === 'icosphere' ||
        lower.includes('griptarget') ||
        lower.includes('poletarget') ||
        isDuplicateExportNode
      ) {
        toRemove.push(child);
      }
    });
    for (const child of toRemove) {
      if (child.parent) child.parent.remove(child);
    }
  }

  static _findBodyAnchor(root) {
    let bodyAnchor = null;
    root.traverse((child) => {
      if (bodyAnchor || !child.isBone) return;
      const n = ModelLoader._normalizeBoneName(child.name);
      if (ModelLoader.BODY_ANCHOR_BONE_NAMES.includes(n)) {
        bodyAnchor = child;
      }
    });
    return bodyAnchor;
  }

  static _alignRootToBodyAnchor(root, bodyAnchor = null) {
    const anchor = bodyAnchor || ModelLoader._findBodyAnchor(root);
    if (!anchor) return;
    root.updateWorldMatrix(true, true);
    const anchorWorld = anchor.getWorldPosition(new THREE.Vector3());
    root.position.x -= anchorWorld.x;
    root.position.z -= anchorWorld.z;
    root.updateWorldMatrix(true, true);
  }

  static _normalizeBoneName(name) {
    return name.toLowerCase().replace(/\s+/g, '').replace(/[\-:.]/g, '_');
  }
}
