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
      // Item can be a string URL or { url, splits } object
      const url = typeof item === 'string' ? item : item.url;
      const splits = typeof item === 'object' && item.splits ? item.splits : null;
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

        for (const split of splits) {
          const startTime = split.startFrame / fps;
          const endTime = split.endFrame / fps;
          const duration = endTime - startTime;

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

          // Walk-in-place: lock root bone X/Z to first frame, keep Y for natural bob
          if (split.inPlace) {
            for (const track of subTracks) {
              // Root bone position track (spine is the root)
              if (track.name.match(/^spine\.position$/)) {
                const vpk = track.values.length / track.times.length; // 3 for vec3
                if (vpk === 3) {
                  // Use the very first split's first-frame position as the anchor
                  // so all splits share the same center point
                  const srcTrack = srcClip.tracks.find(t => t.name === track.name);
                  const anchorFrame = splits[0].startFrame;
                  const x0 = srcTrack.values[anchorFrame * 3];
                  const z0 = srcTrack.values[anchorFrame * 3 + 2];
                  for (let i = 0; i < track.times.length; i++) {
                    track.values[i * 3] = x0;     // lock X
                    track.values[i * 3 + 2] = z0;  // lock Z
                  }
                }
              }
            }
          }

          const subClip = new THREE.AnimationClip(split.name, duration, subTracks);

          // Clone the model for this split
          const clonedRoot = SkeletonUtils.clone(root);
          prepareRoot(clonedRoot);

          const mixer = new THREE.AnimationMixer(clonedRoot);
          const actions = {};
          actions[split.name] = mixer.clipAction(subClip);

          allEntries.push({ fileName: split.name, root: clonedRoot, mixer, actions });
        }
      } else {
        // No splits — single entry
        for (const clip of clips) {
          clip.name = fileName;
          clip.trim();
        }
        prepareRoot(root);
        const mixer = new THREE.AnimationMixer(root);
        const actions = {};
        for (const clip of clips) {
          actions[clip.name] = mixer.clipAction(clip);
        }
        allEntries.push({ fileName, root, mixer, actions });
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
    const [videoGltf, attackGltf, texture] = await Promise.all([
      ModelLoader._loadGLB('/video.glb'),
      ModelLoader._loadGLB('/dao_attack1_cartwheel.glb'),
      ModelLoader._loadTexture('/Color_B_Gradient.jpg'),
    ]);

    const model = videoGltf.scene;
    const srcClip = videoGltf.animations[0];
    srcClip.trim();

    // Split walk_right (frames 0-160) and walk_left (frames 161-326)
    const walkRight = ModelLoader._sliceClip(srcClip, 'walk_right', 0, 161, true);
    const walkLeft = ModelLoader._sliceClip(srcClip, 'walk_left', 161, 327, true);

    // Create idle clip: single-frame extract at frame 32 of walk_right
    const idle = ModelLoader._sliceClip(srcClip, 'idle', 32, 33, true);

    // Attack clip
    const attackClip = attackGltf.animations[0];
    attackClip.name = 'attack';
    attackClip.trim();

    console.log('Fight animations loaded:', { idle: idle.duration, walkRight: walkRight.duration, walkLeft: walkLeft.duration, attack: attackClip.duration });

    return { model, texture, clips: { idle, walk_right: walkRight, walk_left: walkLeft, attack: attackClip } };
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
   * Create a fighter instance from a GLB model with fight animation clips.
   * @param {THREE.Object3D} model - the GLB scene to clone
   * @param {Object} clips - { idle, walk_right, walk_left, attack }
   * @param {number|null} tintColor - hex color for tinting
   * @param {THREE.Texture|null} texture - gradient texture to apply as diffuse map
   */
  static createFighterFromGLB(model, clips, tintColor = null, texture = null) {
    const clone = SkeletonUtils.clone(model);

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
        if (n === 'hand.r' || n === 'handr' || n === 'hand_r' || n === 'righthand' || n === 'hand.r.001') {
          joints.handR = child;
        }
        if (n === 'hand.l' || n === 'handl' || n === 'hand_l' || n === 'lefthand' || n === 'hand.l.001') {
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
