export class AnimPlayerScreen {
  constructor() {
    this.el = document.getElementById('anim-player-screen');
    this.onBack = null;
    this.onClipSwitch = null;

    this._clipListEl = document.getElementById('anim-clip-list');
    this._clipNameEl = document.getElementById('anim-current-name');
    this._timeEl = document.getElementById('anim-time');
    this._frameEl = document.getElementById('anim-frame');
    this._progressEl = document.getElementById('anim-progress');
    this._speedEl = document.getElementById('anim-speed-value');

    this._btnPlay = document.getElementById('anim-btn-play');
    this._btnPause = document.getElementById('anim-btn-pause');
    this._btnRestart = document.getElementById('anim-btn-restart');
    this._btnBack = document.getElementById('anim-btn-back');
    this._btnSpeedDown = document.getElementById('anim-btn-speed-down');
    this._btnSpeedUp = document.getElementById('anim-btn-speed-up');

    this.actions = {};
    this.currentAction = null;
    this.currentClipName = '';
    this.speed = 1.0;

    this._setupControls();
  }

  _setupControls() {
    this._btnPlay.addEventListener('click', () => this._play());
    this._btnPause.addEventListener('click', () => this._pause());
    this._btnRestart.addEventListener('click', () => this._restart());
    this._btnBack.addEventListener('click', () => {
      if (this.onBack) this.onBack();
    });
    this._btnSpeedDown.addEventListener('click', () => this._changeSpeed(-0.25));
    this._btnSpeedUp.addEventListener('click', () => this._changeSpeed(0.25));

    this._progressEl.addEventListener('input', () => {
      if (this.currentAction) {
        const clip = this.currentAction.getClip();
        const time = (this._progressEl.value / 100) * clip.duration;
        this.currentAction.time = time;
        if (this.currentAction._animEntry) {
          this.currentAction._animEntry.mixer.update(0);
        }
      }
    });
  }

  setMixerAndActions(mixer, actions) {
    this.actions = actions;
    this._buildClipList();
  }

  _buildClipList() {
    this._clipListEl.innerHTML = '';
    const names = Object.keys(this.actions);

    if (names.length === 0) {
      this._clipListEl.innerHTML = '<div style="color:#666;font-style:italic;">No animations loaded</div>';
      return;
    }

    for (const name of names) {
      const btn = document.createElement('button');
      btn.className = 'anim-clip-btn';
      btn.textContent = name;
      btn.addEventListener('click', () => this._selectClip(name));
      this._clipListEl.appendChild(btn);
    }

    this._selectClip(names[0]);
  }

  _selectClip(name) {
    this._clipListEl.querySelectorAll('.anim-clip-btn').forEach(btn => {
      btn.classList.toggle('active', btn.textContent === name);
    });

    if (this.currentAction) {
      this.currentAction.stop();
    }

    this.currentClipName = name;
    this.currentAction = this.actions[name];
    this._clipNameEl.textContent = name;

    if (this.currentAction) {
      if (this.onClipSwitch) {
        this.onClipSwitch(this.currentAction);
      }

      this.currentAction.reset();
      this.currentAction.setLoop(2201, Infinity); // THREE.LoopRepeat
      this.currentAction.clampWhenFinished = true;
      this.currentAction.timeScale = this.speed;
      this.currentAction.play();

      if (this.currentAction._animEntry) {
        this.currentAction._animEntry.mixer.update(0);
      }
    }
  }

  _play() {
    if (this.currentAction) {
      this.currentAction.paused = false;
      this.currentAction.timeScale = this.speed;
      if (!this.currentAction.isRunning()) {
        this.currentAction.reset();
        this.currentAction.play();
      }
    }
  }

  _pause() {
    if (this.currentAction) {
      this.currentAction.paused = true;
    }
  }

  _restart() {
    if (this.currentAction) {
      this.currentAction.reset();
      this.currentAction.timeScale = this.speed;
      this.currentAction.play();
    }
  }

  _changeSpeed(delta) {
    this.speed = Math.max(0.25, Math.min(3.0, this.speed + delta));
    this._speedEl.textContent = this.speed.toFixed(2) + 'x';
    if (this.currentAction) {
      this.currentAction.timeScale = this.speed;
    }
  }

  updateDisplay() {
    if (!this.currentAction) return;

    const clip = this.currentAction.getClip();
    const time = this.currentAction.time;
    const frame = Math.round(time * 60);
    const totalFrames = Math.round(clip.duration * 60);
    this._timeEl.textContent = `${time.toFixed(2)}s / ${clip.duration.toFixed(2)}s`;
    this._frameEl.textContent = `Frame ${frame} / ${totalFrames}`;
    this._progressEl.value = (time / clip.duration) * 100;
  }

  show() {
    this.el.style.display = 'flex';
  }

  hide() {
    this.el.style.display = 'none';
    if (this.currentAction) {
      this.currentAction.stop();
      this.currentAction = null;
    }
  }
}
