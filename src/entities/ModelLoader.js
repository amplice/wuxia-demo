import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

let cachedModel = null;
let cachedTexture = null;
let cachedAnimations = [];
let loadPromise = null;

const ANIM_FILES = [
  '/dao_attack1_cartwheel.glb',
];

export class ModelLoader {
  static async load() {
    if (cachedModel && cachedTexture) {
      return { model: cachedModel, texture: cachedTexture, animations: cachedAnimations };
    }
    if (loadPromise) return loadPromise;

    loadPromise = ModelLoader._doLoad();
    return loadPromise;
  }

  static async _doLoad() {
    const [model, texture, ...animResults] = await Promise.all([
      ModelLoader._loadFBX('/Char_Ronin_01.fbx'),
      ModelLoader._loadTexture('/Color_B_Gradient.jpg'),
      ...ANIM_FILES.map(f => ModelLoader._loadGLB(f)),
    ]);

    const clips = [];
    for (const gltf of animResults) {
      if (gltf.animations && gltf.animations.length > 0) {
        clips.push(...gltf.animations);
      }
    }

    cachedModel = model;
    cachedTexture = texture;
    cachedAnimations = clips;

    return { model, texture, animations: clips };
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

  /**
   * Prepare a model root: scale to 1.8 units, center, configure meshes.
   */
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
  }

  /**
   * Load multiple animation files for the animation player.
   * Returns an array of { fileName, root, mixer, actions } entries.
   */
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

          // Walk-in-place: lock root bone X/Z position
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
          clip.name = fileName;
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

  static createFighterFromModel(model, texture, animations, tintColor = null) {
    const clone = SkeletonUtils.clone(model);

    clone.traverse((child) => {
      if (child.isMesh) {
        const applyToMat = (mat) => {
          const m = mat.clone();
          m.map = texture;
          m.needsUpdate = true;
          if (tintColor) m.color.set(tintColor);
          return m;
        };

        if (Array.isArray(child.material)) {
          child.material = child.material.map(applyToMat);
        } else {
          child.material = applyToMat(child.material);
        }

        child.castShadow = true;
        child.receiveShadow = true;

        if (child.isSkinnedMesh) {
          child.frustumCulled = false;
        }
      }
    });

    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const height = size.y;
    const scale = 1.8 / height;
    clone.scale.setScalar(scale);

    box.setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    clone.position.x -= center.x;
    clone.position.z -= center.z;
    clone.position.y -= box.min.y;

    const joints = {};
    clone.traverse((child) => {
      if (child.isBone) {
        if (child.name === 'hand.L') joints.handL = child;
        if (child.name === 'hand.R') joints.handR = child;
      }
    });

    const mixer = new THREE.AnimationMixer(clone);
    const actions = {};

    for (const clip of animations) {
      const action = mixer.clipAction(clip);
      actions[clip.name] = action;
    }

    return { root: clone, joints, mixer, actions };
  }

  /**
   * Load fight animation GLBs and prepare all clips for the game.
   */
  static async loadFightAnimations() {
    const [gltf, texture] = await Promise.all([
      ModelLoader._loadGLB('/character_all.glb'),
      ModelLoader._loadTexture('/Color_B_Gradient.jpg'),
    ]);

    const model = gltf.scene;
    const clips = {};
    const ATTACK_SPEED = 3.5;
    for (const clip of gltf.animations) {
      if (clip.name === 'attack') {
        ModelLoader._speedUpClips({ attack: clip }, ['attack'], ATTACK_SPEED);
      }
      clips[clip.name] = clip;
    }

    return { model, texture, clips };
  }

  /**
   * Load spearman GLB with all animations.
   */
  static async loadSpearmanAnimations() {
    const gltf = await ModelLoader._loadGLB('/spearman.glb');
    const model = gltf.scene;

    const clips = {};

    for (const clip of gltf.animations) {
      let name = clip.name.includes('|') ? clip.name.split('|').pop() : clip.name;
      clips[name] = clip;
    }

    // Swap idle_alt to be the main idle (looks better in game)
    if (clips['idle_alt']) {
      clips['idle_orig'] = clips['idle'];
      clips['idle'] = clips['idle_alt'];
      delete clips['idle_alt'];
    }

    // Lean animations slightly forward by rotating Hips X
    const WALK_LEAN = 0.08; // radians (~4.5 degrees forward lean)
    for (const clipName of ['walk_forward', 'walk_backward', 'idle', 'strafe_left', 'strafe_right']) {
      const clip = clips[clipName];
      if (!clip) continue;
      for (const track of clip.tracks) {
        const n = track.name.toLowerCase();
        if (n.includes('hips') && n.endsWith('.quaternion')) {
          const q = new THREE.Quaternion();
          const lean = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), WALK_LEAN);
          for (let i = 0; i < track.values.length; i += 4) {
            q.set(track.values[i], track.values[i+1], track.values[i+2], track.values[i+3]);
            q.premultiply(lean);
            track.values[i] = q.x;
            track.values[i+1] = q.y;
            track.values[i+2] = q.z;
            track.values[i+3] = q.w;
          }
        }
      }
    }

    ModelLoader._speedUpClips(clips, ['walk_forward', 'walk_backward'], 2);
    ModelLoader._speedUpClips(clips, ['strafe_left', 'strafe_right'], 2);
    ModelLoader._speedUpClips(clips, ['attack_quick', 'attack_heavy', 'attack_thrust'], 2);

    // Zero out Hips root motion on attacks (keep character in place)
    for (const clipName of ['attack_quick', 'attack_heavy', 'attack_thrust']) {
      const clip = clips[clipName];
      if (!clip) continue;
      for (const track of clip.tracks) {
        const n = track.name.toLowerCase();
        if (n.includes('hips') && n.endsWith('.position')) {
          const vpk = track.values.length / track.times.length;
          if (vpk === 3 && track.times.length > 0) {
            const x0 = track.values[0];
            const y0 = track.values[1];
            const z0 = track.values[2];
            for (let i = 0; i < track.times.length; i++) {
              track.values[i * 3] = x0;
              track.values[i * 3 + 1] = y0;
              track.values[i * 3 + 2] = z0;
            }
          }
        }
      }
    }

    model.traverse((child) => {
      if (child.isSkinnedMesh) {
        child.frustumCulled = false;
      }
    });

    return { model, clips };
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

  /**
   * Create a fighter instance from a GLB model with fight animation clips.
   */
  static createFighterFromGLB(model, clips, tintColor = null, texture = null) {
    const clone = SkeletonUtils.clone(model);

    // Apply gradient texture and tint color
    clone.traverse((child) => {
      if (child.isMesh) {
        const applyMat = (mat) => {
          const m = mat.clone();
          if (texture) m.map = texture;
          if (tintColor) m.color.set(tintColor);
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

    // Scale to ~1.8 units tall
    const box = new THREE.Box3().setFromObject(clone);
    const height = box.getSize(new THREE.Vector3()).y;
    if (height > 0) clone.scale.setScalar(1.8 / height);

    // Re-center
    box.setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    clone.position.x -= center.x;
    clone.position.z -= center.z;
    clone.position.y -= box.min.y;

    // Disable frustum culling on skinned meshes, enable shadows
    clone.traverse((child) => {
      if (child.isSkinnedMesh) child.frustumCulled = false;
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // Find hand bones for weapon attachment, and SpearControl for baked spear
    const joints = {};
    clone.traverse((child) => {
      if (child.isBone) {
        const n = child.name.toLowerCase();
        if (n === 'hand.r' || n === 'handr' || n === 'hand_r' || n === 'righthand' || n === 'hand.r.001' || n === 'mixamorig:righthand') {
          joints.handR = child;
        }
        if (n === 'hand.l' || n === 'handl' || n === 'hand_l' || n === 'lefthand' || n === 'hand.l.001' || n === 'mixamorig:lefthand') {
          joints.handL = child;
        }
        if (n === 'speartip') {
          joints.spearTip = child;
        }
      }
    });

    // Set up AnimationMixer and register all clips as actions
    const mixer = new THREE.AnimationMixer(clone);
    const actions = {};
    for (const [name, clip] of Object.entries(clips)) {
      actions[name] = mixer.clipAction(clip);
    }

    return { root: clone, joints, mixer, actions };
  }
}
