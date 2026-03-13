import * as THREE from 'three';

/**
 * Animation browser UI — loads generated-animations.json,
 * converts Euler keyframe data to THREE.AnimationClip objects,
 * and plays them on a provided mixer.
 */
export class PoseBrowser {
  constructor() {
    this.el = document.getElementById('pose-browser');
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.id = 'pose-browser';
      document.body.appendChild(this.el);
    }

    this.data = null;
    this.categories = [];
    this.currentCategory = 0;
    this.currentVariation = 0;

    /** @type {THREE.AnimationMixer|null} */
    this.mixer = null;
    /** @type {THREE.AnimationAction|null} */
    this.currentAction = null;
    /** @type {Map<string, THREE.AnimationClip>} */
    this.clips = new Map();

    this.onBack = null;
    this.paused = false;

    this._build();
  }

  _build() {
    this.el.innerHTML = `
      <style>
        #pose-browser {
          position: fixed; top: 0; left: 0; right: 0;
          z-index: 100; pointer-events: none;
          font-family: monospace; color: #fff;
        }
        #pose-browser .pb-panel {
          pointer-events: auto;
          background: rgba(0,0,0,0.85);
          padding: 12px 18px;
          margin: 10px;
          border-radius: 8px;
          display: flex; flex-direction: column; gap: 8px;
          max-width: 500px;
        }
        #pose-browser .pb-row {
          display: flex; align-items: center; gap: 10px;
        }
        #pose-browser button {
          background: #333; color: #fff; border: 1px solid #555;
          padding: 6px 14px; border-radius: 4px; cursor: pointer;
          font-family: monospace; font-size: 13px;
        }
        #pose-browser button:hover { background: #555; }
        #pose-browser button.active { background: #664; border-color: #aa8; }
        #pose-browser .pb-title {
          font-size: 16px; font-weight: bold; color: #ffa;
        }
        #pose-browser .pb-info {
          font-size: 12px; color: #aaa;
        }
        #pose-browser .pb-meta {
          font-size: 11px; color: #888;
        }
        #pose-browser .pb-cats {
          display: flex; flex-wrap: wrap; gap: 4px;
        }
        #pose-browser .pb-cats button {
          font-size: 11px; padding: 3px 8px;
        }
        #pose-browser .pb-nav button {
          font-size: 16px; padding: 6px 16px;
        }
        #pose-browser .pb-bottom {
          position: fixed; bottom: 10px; left: 10px;
          pointer-events: auto;
        }
      </style>
      <div class="pb-panel">
        <div class="pb-row">
          <span class="pb-title" id="pb-title">Animation Browser</span>
          <button id="pb-pause">Pause</button>
          <button id="pb-back" style="margin-left:auto">Back</button>
        </div>
        <div class="pb-cats" id="pb-cats"></div>
        <div class="pb-row pb-nav">
          <button id="pb-prev">&larr; Prev</button>
          <span id="pb-counter" class="pb-info">1/30</span>
          <button id="pb-next">Next &rarr;</button>
        </div>
        <div id="pb-name" class="pb-info"></div>
        <div id="pb-meta" class="pb-meta"></div>
      </div>
      <div class="pb-bottom">
        <span class="pb-info">A/D or Arrow Keys: prev/next | W/S: category | Space: pause/play</span>
      </div>
    `;

    this.el.querySelector('#pb-back').onclick = () => this.onBack?.();
    this.el.querySelector('#pb-prev').onclick = () => this._navigate(-1);
    this.el.querySelector('#pb-next').onclick = () => this._navigate(1);
    this.el.querySelector('#pb-pause').onclick = () => this._togglePause();

    this._keyHandler = (e) => {
      if (e.code === 'KeyD' || e.code === 'ArrowRight') this._navigate(1);
      if (e.code === 'KeyA' || e.code === 'ArrowLeft') this._navigate(-1);
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this._changeCategory(-1);
      if (e.code === 'KeyS' || e.code === 'ArrowDown') this._changeCategory(1);
      if (e.code === 'Space') { e.preventDefault(); this._togglePause(); }
    };
  }

  /**
   * Load animation data and build clips for the given mixer.
   * @param {THREE.AnimationMixer} mixer
   * @param {THREE.Object3D} modelRoot - the model root to extract bind pose from
   */
  async loadData(mixer, modelRoot) {
    this.mixer = mixer;

    // Extract bind-pose quaternions from the skeleton so we can compose
    // our animation rotations on top of them (not replace them)
    this._bindPose = {};
    modelRoot.traverse((child) => {
      if (child.isBone) {
        this._bindPose[child.name] = child.quaternion.clone();
      }
    });

    const resp = await fetch('/src/data/generated-animations.json');
    this.data = await resp.json();
    this.categories = this.data.categories;

    // Convert all animation entries to THREE.AnimationClip
    for (const anim of this.data.animations) {
      const clip = this._buildClip(anim);
      this.clips.set(anim.name, clip);
    }

    this._buildCategoryButtons();
    this._playCurrentAnim();
  }

  /**
   * Convert JSON animation data (Euler keyframes) → THREE.AnimationClip.
   * Euler values are treated as deltas composed onto the bind pose quaternion.
   */
  _buildClip(anim) {
    const tracks = [];
    const euler = new THREE.Euler();
    const deltaQuat = new THREE.Quaternion();
    const resultQuat = new THREE.Quaternion();

    for (const trackData of anim.tracks) {
      const boneName = trackData.bone;
      const keyframes = trackData.keyframes;
      const times = new Float32Array(keyframes.length);
      const values = new Float32Array(keyframes.length * 4);

      const bindQuat = this._bindPose[boneName] || new THREE.Quaternion();

      for (let i = 0; i < keyframes.length; i++) {
        const kf = keyframes[i];
        times[i] = kf.t;
        // Convert Euler delta to quaternion, then premultiply onto bind pose
        // Premultiply applies the delta in parent space (intuitive world axes)
        euler.set(kf.rx, kf.ry, kf.rz, 'YXZ');
        deltaQuat.setFromEuler(euler);
        resultQuat.copy(bindQuat).premultiply(deltaQuat);
        values[i * 4] = resultQuat.x;
        values[i * 4 + 1] = resultQuat.y;
        values[i * 4 + 2] = resultQuat.z;
        values[i * 4 + 3] = resultQuat.w;
      }

      tracks.push(new THREE.QuaternionKeyframeTrack(
        `${boneName}.quaternion`, times, values
      ));
    }

    return new THREE.AnimationClip(anim.name, anim.duration, tracks);
  }

  _buildCategoryButtons() {
    const container = this.el.querySelector('#pb-cats');
    container.innerHTML = '';
    this.categories.forEach((cat, i) => {
      const btn = document.createElement('button');
      btn.textContent = cat.replace(/_/g, ' ');
      btn.onclick = () => {
        this.currentCategory = i;
        this.currentVariation = 0;
        this._playCurrentAnim();
      };
      container.appendChild(btn);
    });
  }

  _getAnimsForCategory() {
    const cat = this.categories[this.currentCategory];
    return this.data.animations.filter(a => a.category === cat);
  }

  _getCurrentAnimData() {
    const anims = this._getAnimsForCategory();
    return anims[this.currentVariation] || null;
  }

  _navigate(dir) {
    const anims = this._getAnimsForCategory();
    this.currentVariation = (this.currentVariation + dir + anims.length) % anims.length;
    this._playCurrentAnim();
  }

  _changeCategory(dir) {
    this.currentCategory = (this.currentCategory + dir + this.categories.length) % this.categories.length;
    this.currentVariation = 0;
    this._playCurrentAnim();
  }

  _togglePause() {
    if (!this.currentAction) return;
    this.paused = !this.paused;
    this.currentAction.paused = this.paused;
    this.el.querySelector('#pb-pause').textContent = this.paused ? 'Play' : 'Pause';
  }

  _playCurrentAnim() {
    const animData = this._getCurrentAnimData();
    if (!animData || !this.mixer) return;

    // Stop previous
    if (this.currentAction) {
      this.currentAction.stop();
    }

    const clip = this.clips.get(animData.name);
    if (!clip) return;

    const action = this.mixer.clipAction(clip);
    action.reset();
    action.setLoop(animData.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = !animData.loop;
    action.play();
    this.paused = false;

    this.currentAction = action;

    this._updateDisplay(animData);
  }

  _updateDisplay(anim) {
    if (!anim) anim = this._getCurrentAnimData();
    if (!anim) return;

    const anims = this._getAnimsForCategory();
    const cat = this.categories[this.currentCategory];
    this.el.querySelector('#pb-title').textContent = cat.replace(/_/g, ' ').toUpperCase();
    this.el.querySelector('#pb-counter').textContent = `${this.currentVariation + 1}/${anims.length}`;
    this.el.querySelector('#pb-name').textContent = `${anim.name}  (${anim.duration.toFixed(2)}s${anim.loop ? ', loop' : ''})`;
    this.el.querySelector('#pb-meta').textContent = anim.metadata
      ? JSON.stringify(anim.metadata)
      : '';
    this.el.querySelector('#pb-pause').textContent = this.paused ? 'Play' : 'Pause';

    // Category buttons highlight
    const catBtns = this.el.querySelectorAll('#pb-cats button');
    catBtns.forEach((btn, i) => btn.classList.toggle('active', i === this.currentCategory));
  }

  show() {
    this.el.style.display = '';
    window.addEventListener('keydown', this._keyHandler);
  }

  hide() {
    this.el.style.display = 'none';
    window.removeEventListener('keydown', this._keyHandler);
    if (this.currentAction) {
      this.currentAction.stop();
      this.currentAction = null;
    }
  }
}
