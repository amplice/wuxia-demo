import * as THREE from 'three';
import { ModelLoader } from '../entities/ModelLoader.js';

export class AnimationSandbox {
  constructor({ scene, camera, cameraController, environment, input, ui }) {
    this.scene = scene;
    this.camera = camera;
    this.cameraController = cameraController;
    this.environment = environment;
    this.input = input;
    this.ui = ui;

    this.onExit = null;

    this.animPlayerEntries = null;
    this.animPlayerModel = null;
    this.animPlayerMixer = null;
    this.animPlayerUI = null;

    this._orbitYaw = 0.7;
    this._orbitPitch = 0.35;
    this._orbitRadius = 4.5;
    this._orbitTarget = new THREE.Vector3(0, 0.9, 0);
    this._isOrbitDragging = false;
    this._lastPointerX = 0;
    this._lastPointerY = 0;

    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);
  }

  async start() {
    if (!this.animPlayerEntries) {
      this.animPlayerEntries = await ModelLoader.loadAnimPlayerEntries([
        '/spearman.glb',
        '/ronin.glb',
      ]);
    }

    this.animPlayerModel = null;
    this.animPlayerMixer = null;

    for (const entry of this.animPlayerEntries) {
      entry.label = entry.fileName
        .replace(/[_-]+/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase());
      for (const [name, action] of Object.entries(entry.actions)) {
        action._animEntry = entry;
        action._displayName = `${entry.label} - ${name}`;
      }
    }

    this.animPlayerUI = await this.ui.showAnimPlayer();
    this.cameraController.stopKillCam();

    this.animPlayerUI.onBack = () => {
      if (this.onExit) this.onExit();
    };
    this.animPlayerUI.onClipSwitch = (action) => {
      this._switchModel(action._animEntry);
    };
    this.animPlayerUI.setEntries(this.animPlayerEntries);

    this._bindOrbitControls();
  }

  stop() {
    this._unbindOrbitControls();
    if (this.animPlayerModel) {
      this.scene.remove(this.animPlayerModel);
      this.animPlayerModel = null;
    }
    if (this.animPlayerEntries) {
      for (const entry of this.animPlayerEntries) {
        entry.mixer.stopAllAction();
      }
    }
    this.animPlayerMixer = null;
  }

  update(dt) {
    if (this.animPlayerMixer) {
      this.animPlayerMixer.update(dt);
    }

    if (this.animPlayerUI) {
      this.animPlayerUI.updateDisplay();
    }

    const cosPitch = Math.cos(this._orbitPitch);
    this.camera.position.set(
      this._orbitTarget.x + Math.sin(this._orbitYaw) * cosPitch * this._orbitRadius,
      this._orbitTarget.y + Math.sin(this._orbitPitch) * this._orbitRadius,
      this._orbitTarget.z + Math.cos(this._orbitYaw) * cosPitch * this._orbitRadius
    );
    this.camera.lookAt(this._orbitTarget);

    this.environment.update(dt);
  }

  _switchModel(entry) {
    if (this.animPlayerModel) {
      this.scene.remove(this.animPlayerModel);
    }

    this.animPlayerModel = entry.root;
    this.animPlayerMixer = entry.mixer;

    this.scene.add(this.animPlayerModel);
    this._fitOrbitToModel(entry.root);
  }

  _fitOrbitToModel(root) {
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const height = size.y || 1.8;
    const depth = Math.max(size.z, size.x, 1.5);

    this._orbitTarget.set(center.x, box.min.y + height * 0.55, center.z);
    this._orbitRadius = THREE.MathUtils.clamp(Math.max(height * 1.6, depth * 1.8), 2.5, 8.0);
  }

  _bindOrbitControls() {
    window.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointercancel', this._onPointerUp);
    window.addEventListener('wheel', this._onWheel, { passive: false });
  }

  _unbindOrbitControls() {
    this._isOrbitDragging = false;
    window.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointercancel', this._onPointerUp);
    window.removeEventListener('wheel', this._onWheel);
  }

  _handlePointerDown(e) {
    if (e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest('#anim-player-screen')) return;
    this._isOrbitDragging = true;
    this._lastPointerX = e.clientX;
    this._lastPointerY = e.clientY;
  }

  _handlePointerMove(e) {
    if (!this._isOrbitDragging) return;
    const dx = e.clientX - this._lastPointerX;
    const dy = e.clientY - this._lastPointerY;
    this._lastPointerX = e.clientX;
    this._lastPointerY = e.clientY;

    this._orbitYaw -= dx * 0.01;
    this._orbitPitch = THREE.MathUtils.clamp(this._orbitPitch - dy * 0.008, -0.25, 1.15);
  }

  _handlePointerUp() {
    this._isOrbitDragging = false;
  }

  _handleWheel(e) {
    if (e.target && e.target.closest && e.target.closest('#anim-player-screen')) return;
    e.preventDefault();
    const zoomScale = Math.exp(e.deltaY * 0.001);
    this._orbitRadius = THREE.MathUtils.clamp(this._orbitRadius * zoomScale, 2.0, 10.0);
  }
}
