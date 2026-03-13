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
  }

  async start() {
    if (!this.animPlayerEntries) {
      this.animPlayerEntries = await ModelLoader.loadAnimPlayerEntries([
        '/spearman.glb',
      ]);
    }

    this.animPlayerModel = null;
    this.animPlayerMixer = null;

    const allActions = {};
    for (const entry of this.animPlayerEntries) {
      for (const [name, action] of Object.entries(entry.actions)) {
        allActions[name] = action;
        action._animEntry = entry;
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
    this.animPlayerUI.setMixerAndActions(null, allActions);
  }

  stop() {
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

    this.camera.position.set(3, 2.5, 4);
    this.camera.lookAt(0, 0.9, 0);

    this.environment.update(dt);
  }

  _switchModel(entry) {
    if (this.animPlayerModel) {
      this.scene.remove(this.animPlayerModel);
    }

    this.animPlayerModel = entry.root;
    this.animPlayerMixer = entry.mixer;

    this.scene.add(this.animPlayerModel);
  }
}
