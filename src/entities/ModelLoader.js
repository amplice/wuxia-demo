import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

let cachedModel = null;
let cachedTexture = null;
let cachedAnimations = [];
let loadPromise = null;

// Animation GLB files to load (Cartwheel.ai exports use matching metarig bone names)
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
    // Load model, texture, and animation files in parallel
    const [model, texture, ...animResults] = await Promise.all([
      ModelLoader._loadFBX('/Char_Ronin_01.fbx'),
      ModelLoader._loadTexture('/Color_B_Gradient.jpg'),
      ...ANIM_FILES.map(f => ModelLoader._loadGLB(f)),
    ]);

    // Collect animation clips directly from GLB files
    // (Cartwheel.ai exports already use the same metarig bone names as the ronin)
    const clips = [];
    for (const gltf of animResults) {
      if (gltf.animations && gltf.animations.length > 0) {
        clips.push(...gltf.animations);
      }
    }

    cachedModel = model;
    cachedTexture = texture;
    cachedAnimations = clips;

    console.log(`Loaded ${clips.length} animation clips:`, clips.map(c => c.name));

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
   * Load a complete GLB or FBX file (mesh + animations) for the animation player.
   * Can also merge in extra animation files.
   * Returns the scene root, mixer, and actions ready to play.
   */
  /**
   * Load multiple animation files for the animation player.
   * Each file group shares a coordinate space (GLB=Y-up, FBX=Z-up).
   * We load each file as its own model+mixer to avoid coordinate mismatches.
   * Returns an array of { name, root, mixer, actions } entries.
   */
  static async loadAnimPlayerEntries(items) {
    const allEntries = [];

    await Promise.all(items.map(async (item) => {
      try {
      // Item can be a string URL or { url, splits } object
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

      // Prepare the model
      const prepareRoot = (r) => {
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
      };

      if (splits && clips.length > 0) {
        // Split the first clip into multiple sub-clips, each with its own model clone
        const srcClip = clips[0];
        srcClip.trim();
        const fps = 60;
        console.log(`[AnimPlayer] Splitting '${url}': srcClip duration=${srcClip.duration.toFixed(2)}s, tracks=${srcClip.tracks.length}, splits=${splits.length}`);

        for (const split of splits) {
          try {
          const startTime = split.startFrame / fps;
          const endTime = split.endFrame / fps;
          const duration = endTime - startTime;
          console.log(`[AnimPlayer] Split '${split.name}': frames ${split.startFrame}-${split.endFrame}, time ${startTime.toFixed(2)}-${endTime.toFixed(2)}s`);

          // Create sub-clip by slicing each track
          const subTracks = [];
          for (const track of srcClip.tracks) {
            const times = track.times;
            const valuesPerKey = track.values.length / times.length;

            // Find keyframe range
            let iStart = 0, iEnd = times.length;
            for (let i = 0; i < times.length; i++) {
              if (times[i] < startTime) iStart = i;
              if (times[i] <= endTime) iEnd = i + 1;
            }

            const count = iEnd - iStart;
            if (count <= 0) continue; // skip empty tracks

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
          console.log(`[AnimPlayer] Split '${split.name}': created ${subTracks.length} sub-tracks`);

          const subClip = new THREE.AnimationClip(split.name, duration, subTracks);

          // Clone the model for this split
          console.log(`[AnimPlayer] Split '${split.name}': cloning model...`);
          const clonedRoot = SkeletonUtils.clone(root);
          prepareRoot(clonedRoot);

          // Walk-in-place: lock root bone X/Z position
          if (split.inPlace) {
            // Find the root bone position track and lock X/Z
            clonedRoot.traverse((child) => {
              if (child.isBone && child.name === 'spine') {
                // Will be handled by the mixer — we lock it in the clip tracks instead
              }
            });
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

          console.log(`[AnimPlayer] Split '${split.name}': OK, duration=${duration.toFixed(2)}s`);
          allEntries.push({ fileName: split.name, root: clonedRoot, mixer, actions });
          } catch (splitErr) {
            console.error(`[AnimPlayer] Split '${split.name}' FAILED:`, splitErr);
          }
        }
      } else {
        // No splits — single entry
        for (const clip of clips) {
          clip.name = fileName;
          clip.trim();

          // Trim leading frames (e.g. skip T-pose at frame 0)
          if (trimStartFrames > 0) {
            const skipTime = trimStartFrames / 60;
            for (const track of clip.tracks) {
              const vpk = track.values.length / track.times.length;
              // Find first keyframe at or after skipTime
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
        prepareRoot(root);
        const mixer = new THREE.AnimationMixer(root);
        const actions = {};
        for (const clip of clips) {
          actions[clip.name] = mixer.clipAction(clip);
        }
        console.log(`[AnimPlayer] Loaded '${fileName}': ${clips.length} clips, actions=[${Object.keys(actions)}]`);
        allEntries.push({ fileName, root, mixer, actions });
      }
      } catch (err) {
        console.error(`[AnimPlayer] FAILED to load '${typeof item === 'string' ? item : item.url}':`, err);
        alert(`Animation load error: ${err.message}`);
      }
    }));

    return allEntries;
  }

  /**
   * Load a complete GLB file (mesh + animations) for the animation player.
   * Returns the scene root, mixer, and actions ready to play.
   */
  static async loadGLBDirect(url) {
    const gltf = await ModelLoader._loadGLB(url);
    const root = gltf.scene;

    // Scale to ~1.8 units tall
    const box = new THREE.Box3().setFromObject(root);
    const height = box.getSize(new THREE.Vector3()).y;
    if (height > 0) {
      const scale = 1.8 / height;
      root.scale.setScalar(scale);
    }

    // Re-center
    box.setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y;

    // Disable frustum culling on skinned meshes
    root.traverse((child) => {
      if (child.isSkinnedMesh) child.frustumCulled = false;
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    // Set up mixer + actions
    const mixer = new THREE.AnimationMixer(root);
    const actions = {};
    for (const clip of gltf.animations) {
      actions[clip.name] = mixer.clipAction(clip);
    }

    return { root, mixer, actions };
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

    // Apply texture to all meshes
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

    // Scale the model to target height (~1.8 units)
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const height = size.y;
    const targetHeight = 1.8;
    const scale = targetHeight / height;
    clone.scale.setScalar(scale);

    // Recalculate bounds after scaling
    box.setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    clone.position.x -= center.x;
    clone.position.z -= center.z;
    clone.position.y -= box.min.y;

    // Find hand bones for weapon attachment
    const joints = {};
    clone.traverse((child) => {
      if (child.isBone) {
        if (child.name === 'hand.L') joints.handL = child;
        if (child.name === 'hand.R') joints.handR = child;
      }
    });

    // Set up AnimationMixer for this clone
    const mixer = new THREE.AnimationMixer(clone);
    const actions = {};

    for (const clip of animations) {
      const action = mixer.clipAction(clip);
      actions[clip.name] = action;
    }

    console.log('Available animation actions:', Object.keys(actions));

    return { root: clone, joints, mixer, actions };
  }

  /**
   * Load both GLB fight animation files and prepare all clips for the game.
   * Returns { model, clips: { idle, walk_right, walk_left, attack } }
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
      // Speed up attack by compressing keyframe times
      if (clip.name === 'attack') {
        const origDuration = clip.duration;
        for (const track of clip.tracks) {
          const newTimes = new Float32Array(track.times.length);
          for (let i = 0; i < track.times.length; i++) {
            newTimes[i] = track.times[i] / ATTACK_SPEED;
          }
          track.times = newTimes;
        }
        clip.duration = origDuration / ATTACK_SPEED;
        clip.resetDuration();
        console.log(`Attack clip sped up ${ATTACK_SPEED}x: ${origDuration.toFixed(3)}s → ${clip.duration.toFixed(3)}s`);
      }
      clips[clip.name] = clip;
    }

    console.log('Fight animations loaded:', Object.keys(clips).map(k => `${k} (${clips[k].duration.toFixed(2)}s)`));

    return { model, texture, clips };
  }

  /**
   * Load spearman GLB with all animations.
   * Maps spearman clip names to standard names used by Fighter.
   * Returns { model, clips }
   */
  static async loadSpearmanAnimations() {
    const gltf = await ModelLoader._loadGLB('/spearman_all.glb');
    const model = gltf.scene;

    const clips = {};

    for (const clip of gltf.animations) {
      // Strip armature prefix (Blender exports as "Armature|actionName")
      let name = clip.name.includes('|') ? clip.name.split('|').pop() : clip.name;
      // idle_alt available as fallback
      // if (name === 'idle_alt') name = 'idle';
      // else if (name === 'idle') name = 'idle_orig';
      clips[name] = clip;
    }

    console.log('Spearman animations loaded:', Object.keys(clips).map(k => `${k} (${clips[k].duration.toFixed(2)}s)`));

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

    // Speed up walk animations 2x for gameplay feel
    ModelLoader._speedUpClips(clips, ['walk_forward', 'walk_backward'], 2);
    ModelLoader._speedUpClips(clips, ['strafe_left', 'strafe_right'], 2);

    // Pre-process: ensure skinned meshes are properly configured
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
   * Slice a sub-clip from a source clip by frame range.
   * @param {THREE.AnimationClip} srcClip - source clip
   * @param {string} name - name for the new clip
   * @param {number} startFrame - start frame (inclusive)
   * @param {number} endFrame - end frame (exclusive)
   * @param {boolean} inPlace - lock root bone X/Z for walk-in-place
   */
  static _sliceClip(srcClip, name, startFrame, endFrame, inPlace = false) {
    const fps = 60;
    const startTime = startFrame / fps;
    const endTime = endFrame / fps;
    const duration = endTime - startTime;

    const subTracks = [];
    for (const track of srcClip.tracks) {
      const times = track.times;
      const valuesPerKey = track.values.length / times.length;

      // Find keyframe range
      let iStart = 0, iEnd = times.length;
      for (let i = 0; i < times.length; i++) {
        if (times[i] < startTime) iStart = i;
        if (times[i] <= endTime) iEnd = i + 1;
      }

      const newTimes = new Float32Array(iEnd - iStart);
      const newValues = new Float32Array((iEnd - iStart) * valuesPerKey);
      for (let i = iStart; i < iEnd; i++) {
        newTimes[i - iStart] = times[i] - startTime;
        for (let v = 0; v < valuesPerKey; v++) {
          newValues[(i - iStart) * valuesPerKey + v] = track.values[i * valuesPerKey + v];
        }
      }

      const SubTrackType = track.constructor;
      subTracks.push(new SubTrackType(track.name, newTimes, newValues));
    }

    // Walk-in-place: lock root bone X/Z to first frame
    if (inPlace) {
      for (const track of subTracks) {
        if (track.name.match(/^spine\.position$/)) {
          const vpk = track.values.length / track.times.length;
          if (vpk === 3) {
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

    return new THREE.AnimationClip(name, duration, subTracks);
  }

  /**
   * Trim N frames from the start of a clip (e.g. to skip T-pose at frame 0).
   */
  static _trimStartFrames(clip, numFrames) {
    const skipTime = numFrames / 60;
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

  /**
   * Lock Y-rotation on all spine/torso bones to first-frame values so the
   * attack animation doesn't rotate the character. Keeps X/Z rotation for
   * natural body tilt during the swing.
   */
  static _lockRootRotation(clip) {
    const q = new THREE.Quaternion();
    const euler = new THREE.Euler();

    for (const track of clip.tracks) {
      // Lock Y-rotation on all spine bones (spine, spine.001, spine.002, etc.)
      if (!track.name.match(/^spine(\.\d+)?\.quaternion$/)) continue;
      const vpk = track.values.length / track.times.length;
      if (vpk !== 4) continue;

      // Get first frame Y rotation
      q.set(track.values[0], track.values[1], track.values[2], track.values[3]);
      euler.setFromQuaternion(q, 'YXZ');
      const lockedY = euler.y;

      // Apply locked Y to all frames
      for (let i = 0; i < track.times.length; i++) {
        const off = i * 4;
        q.set(track.values[off], track.values[off+1], track.values[off+2], track.values[off+3]);
        euler.setFromQuaternion(q, 'YXZ');
        euler.y = lockedY;
        q.setFromEuler(euler);
        track.values[off] = q.x;
        track.values[off+1] = q.y;
        track.values[off+2] = q.z;
        track.values[off+3] = q.w;
      }
      console.log(`Locked Y-rotation on ${track.name.replace('.quaternion','')} to ${(lockedY * 180/Math.PI).toFixed(1)}° for attack clip`);
    }
  }

  /**
   * Create a fighter instance from a GLB model with fight animation clips.
   * @param {THREE.Object3D} model - the GLB scene to clone
   * @param {Object} clips - { idle, walk_right, walk_left, attack }
   * @param {number|null} tintColor - hex color for tinting
   * @param {THREE.Texture|null} texture - gradient texture to apply as diffuse map
   */
  static createFighterFromGLB(model, clips, tintColor = null, texture = null) {
    // Debug: check source model before cloning
    let srcMeshes = 0;
    model.traverse((c) => { if (c.isMesh || c.isSkinnedMesh) srcMeshes++; });
    console.log(`[createFighterFromGLB] Source model meshes: ${srcMeshes}`);

    const clone = SkeletonUtils.clone(model);

    // Debug: check clone
    let cloneMeshes = 0;
    clone.traverse((c) => {
      if (c.isMesh || c.isSkinnedMesh) {
        cloneMeshes++;
        console.log(`[createFighterFromGLB] Cloned mesh: ${c.name}, skinned: ${c.isSkinnedMesh}, visible: ${c.visible}`);
      }
    });
    console.log(`[createFighterFromGLB] Cloned meshes: ${cloneMeshes}`);

    // Apply gradient texture and tint color to all meshes
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
    console.log(`[createFighterFromGLB] raw height=${height.toFixed(3)}, box min=${box.min.y.toFixed(3)} max=${box.max.y.toFixed(3)}`);
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

    // Find hand bones for weapon attachment
    const joints = {};
    const allBoneNames = [];
    clone.traverse((child) => {
      if (child.isBone) {
        allBoneNames.push(child.name);
        const n = child.name.toLowerCase();
        if (n === 'hand.r' || n === 'handr' || n === 'hand_r' || n === 'righthand' || n === 'hand.r.001' || n === 'mixamorig:righthand') {
          joints.handR = child;
        }
        if (n === 'hand.l' || n === 'handl' || n === 'hand_l' || n === 'lefthand' || n === 'hand.l.001' || n === 'mixamorig:lefthand') {
          joints.handL = child;
        }
      }
    });
    console.log('GLB bones found:', allBoneNames);
    console.log('Hand joints:', { handR: joints.handR?.name, handL: joints.handL?.name });

    // Set up AnimationMixer and register all clips as actions
    const mixer = new THREE.AnimationMixer(clone);
    const actions = {};
    for (const [name, clip] of Object.entries(clips)) {
      actions[name] = mixer.clipAction(clip);
    }

    console.log('GLB fighter created, actions:', Object.keys(actions));

    return { root: clone, joints, mixer, actions };
  }

  /**
   * Fix FBX animation clips to work on a GLB (Y-up) model.
   * 1. Rename bone references: strip dots to match GLB naming (spine.001 → spine001, hand.R → handR)
   * 2. Apply -90° X correction to root bone quaternion (Z-up → Y-up)
   * 3. Zero out root bone position to prevent flying off
   */
  static _fixFBXAnimForGLB(clips) {
    const correction = new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(1, 0, 0), -Math.PI / 2
    );

    for (const clip of clips) {
      const keepTracks = [];

      for (const track of clip.tracks) {
        const lastDot = track.name.lastIndexOf('.');
        const boneName = track.name.substring(0, lastDot);
        const property = track.name.substring(lastDot + 1);

        // Strip dots from bone name to match GLB naming (spine.001 → spine001)
        const fixedBone = boneName.replace(/\./g, '');
        track.name = fixedBone + '.' + property;

        // Only keep quaternion tracks — position/scale from FBX cause problems
        if (property !== 'quaternion') continue;

        // Fix root bone quaternion — Z-up to Y-up
        if (fixedBone === 'spine') {
          const values = track.values;
          for (let i = 0; i < values.length; i += 4) {
            const q = new THREE.Quaternion(values[i], values[i + 1], values[i + 2], values[i + 3]);
            q.premultiply(correction);
            values[i] = q.x;
            values[i + 1] = q.y;
            values[i + 2] = q.z;
            values[i + 3] = q.w;
          }
        }

        keepTracks.push(track);
      }

      clip.tracks = keepTracks;
    }
  }
}
