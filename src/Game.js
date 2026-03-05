import * as THREE from 'three';
import { Renderer } from './core/Renderer.js';
import { Clock } from './core/Clock.js';
import { InputManager } from './core/InputManager.js';
import { Arena } from './arena/Arena.js';
import { Environment } from './arena/Environment.js';
import { CameraController } from './camera/CameraController.js';
import { Fighter } from './entities/Fighter.js';
import { ModelLoader } from './entities/ModelLoader.js';
import { Weapon } from './entities/Weapon.js';
import { HitResolver } from './combat/HitResolver.js';
import { ParticleSystem } from './vfx/ParticleSystem.js';
import { ScreenEffects } from './vfx/ScreenEffects.js';
import { AIController } from './ai/AIController.js';
import { UIManager } from './ui/UIManager.js';
import {
  GameState, FighterState, AttackType, HitResult, WeaponType,
  FIGHT_START_DISTANCE, ROUNDS_TO_WIN, ROUND_INTRO_DURATION,
  ROUND_END_DELAY, KILL_SLOWMO_SCALE, KILL_SLOWMO_DURATION,
  FRAME_DURATION, ARENA_RADIUS, BLOCK_PUSHBACK_SPEED,
} from './core/Constants.js';

export class Game {
  constructor() {
    this.renderer = new Renderer();
    this.clock = new Clock();
    this.input = new InputManager();
    this.ui = new UIManager();
    this.hitResolver = new HitResolver();
    this.screenEffects = new ScreenEffects();

    this.scene = null;
    this.camera = null;
    this.arena = null;
    this.environment = null;
    this.particles = null;

    this.fighter1 = null;
    this.fighter2 = null;
    this.aiController = null;
    this.modelData = null;
    this.fightAnimData = null;

    this.gameState = GameState.TITLE;
    this.stateTimer = 0;

    // Match state
    this.mode = 'ai';
    this.difficulty = 'medium';
    this.p1Score = 0;
    this.p2Score = 0;
    this.currentRound = 1;
    this.killSlowMoTimer = 0;

    // Animation player state
    this.animPlayerModel = null;
    this.animPlayerMixer = null;
    this.animPlayerArrow = null;

    // Animation editor state
    this.animEditorTestMode = false;
    this.animEditorDummy = null;
    this.animEditorGrid = null;
    this.animEditorModelPos = new THREE.Vector3();
    this.animEditorModelRotY = 0;
    this._animPlayerBaseScale = null;
    this._testModeKeys = {};
  }

  async init() {
    await this.renderer.init();

    this.scene = new THREE.Scene();
    this.cameraController = new CameraController();
    this.camera = this.cameraController.camera;

    this.arena = new Arena(this.scene);
    this.environment = new Environment(this.scene);
    this.particles = new ParticleSystem(this.scene);

    // Preload fight animation GLBs
    try {
      this.fightAnimData = await ModelLoader.loadFightAnimations();
      console.log('Fight animations loaded successfully');
    } catch (err) {
      console.warn('Failed to load fight animations, falling back:', err);
      this.fightAnimData = null;
    }

    if (!this.fightAnimData) {
      try {
        this.modelData = await ModelLoader.load();
        console.log('FBX model loaded successfully');
      } catch (err) {
        console.warn('Failed to load FBX model, using procedural fighters:', err);
        this.modelData = null;
      }
    }

    // UI
    this.ui.showTitle();

    this.ui.title.onStart = () => {
      this.gameState = GameState.SELECT;
      this.ui.showSelect();
    };

    this.ui.select.onConfirm = (config) => {
      this.mode = config.mode;
      this.difficulty = config.difficulty;
      this._startMatch(config.p1Weapon, config.p2Weapon);
    };

    this.ui.victory.onContinue = () => {
      this.gameState = GameState.TITLE;
      this._cleanupFighters();
      this.ui.showTitle();
    };

    this.ui.title.onAnimPlayer = () => {
      this._startAnimPlayer();
    };

    this.ui.animPlayer.onBack = () => {
      this._stopAnimPlayer();
      this.gameState = GameState.TITLE;
      this.ui.showTitle();
    };

    this.ui.animPlayer.onTransformUpdate = (transform) => {
      this._applyAnimPlayerTransform(transform);
    };
    this.ui.animPlayer.onTestModeToggle = (enabled) => {
      this._setAnimPlayerTestMode(enabled);
    };

    this.clock.start();
    this._loop();
  }

  _startMatch(p1Weapon, p2Weapon) {
    this.p1Score = 0;
    this.p2Score = 0;
    this.currentRound = 1;

    this._cleanupFighters();

    this.fighter1 = new Fighter(0, 0x991111, p1Weapon, this.modelData, this.fightAnimData);
    this.fighter2 = new Fighter(1, 0x112266, p2Weapon, this.modelData, this.fightAnimData);
    this.fighter1.addToScene(this.scene);
    this.fighter2.addToScene(this.scene);

    this._attachWeapon(this.fighter1);
    this._attachWeapon(this.fighter2);

    // Debug facing arrows
    this._debugArrow1 = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 1.5, 0x44cc44, 0.3, 0.15
    );
    this._debugArrow2 = new THREE.ArrowHelper(
      new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 1.5, 0x4444cc, 0.3, 0.15
    );
    this.scene.add(this._debugArrow1);
    this.scene.add(this._debugArrow2);

    // AI
    if (this.mode === 'ai') {
      this.aiController = new AIController(this.difficulty);
    } else {
      this.aiController = null;
    }

    this.ui.showHUD();
    this.ui.hud.updateRoundPips(0, 0);
    this._startRound();
  }

  _attachWeapon(fighter) {
    let handBone = null;
    fighter.root.traverse((child) => {
      if (child.isBone && (child.name === 'hand.R' || child.name === 'handR')) {
        handBone = child;
      }
    });
    if (handBone) {
      const s = 1 / fighter.root.scale.x;
      fighter.weapon.mesh.scale.setScalar(s);
      handBone.add(fighter.weapon.mesh);
    } else {
      fighter.weapon.mesh.position.set(0.3, 1.2, 0);
      fighter.root.add(fighter.weapon.mesh);
    }
  }

  _startRound() {
    this.gameState = GameState.ROUND_INTRO;
    this.stateTimer = 0;
    this.clock.setTimeScale(1.0);
    this.killSlowMoTimer = 0;

    this.fighter1.resetForRound(-FIGHT_START_DISTANCE / 2);
    this.fighter2.resetForRound(FIGHT_START_DISTANCE / 2);

    this.cameraController.stopKillCam();
    this.cameraController.reset();

    this.particles.reset();
    this.screenEffects.reset();

    this.ui.hud.reset();
    this.ui.hud.updateRoundPips(this.p1Score, this.p2Score);
    this.ui.hud.showRoundAnnounce(this.currentRound);

    this.input.clearBuffers();
  }

  _cleanupFighters() {
    if (this.fighter1) {
      this.fighter1.removeFromScene(this.scene);
      this.fighter1 = null;
    }
    if (this.fighter2) {
      this.fighter2.removeFromScene(this.scene);
      this.fighter2 = null;
    }
    if (this._debugArrow1) {
      this.scene.remove(this._debugArrow1);
      this._debugArrow1 = null;
    }
    if (this._debugArrow2) {
      this.scene.remove(this._debugArrow2);
      this._debugArrow2 = null;
    }
  }

  _loop() {
    requestAnimationFrame(() => this._loop());

    const { steps, dt, rawDelta } = this.clock.update();

    for (let i = 0; i < steps; i++) {
      const frozen = this.screenEffects.update();
      if (frozen) continue;

      this._fixedUpdate(dt);
    }

    this._renderUpdate(rawDelta);
    this.renderer.render(this.scene, this.camera);
  }

  _fixedUpdate(dt) {
    this.input.update(this.clock.frameCount);

    switch (this.gameState) {
      case GameState.ROUND_INTRO:
        this._updateRoundIntro(dt);
        break;
      case GameState.FIGHTING:
        this._updateFighting(dt);
        break;
      case GameState.KILL_CAM:
        this._updateKillCam(dt);
        break;
      case GameState.ROUND_END:
        this._updateRoundEnd(dt);
        break;
    }
  }

  _renderUpdate(dt) {
    if (this.gameState === GameState.ANIM_PLAYER) {
      this._updateAnimPlayer(dt);
      return;
    }

    if (this.fighter1 && this.fighter2) {
      this.cameraController.update(dt, this.fighter1, this.fighter2);
    }

    if (this.gameState === GameState.KILL_CAM) {
      this.killSlowMoTimer += dt;
      if (this.killSlowMoTimer >= KILL_SLOWMO_DURATION) {
        this.clock.setTimeScale(1.0);
        this.cameraController.stopKillCam();

        if (this.fighter2 && this.fighter2.damageSystem.isDead()) {
          this.p1Score++;
        }
        if (this.fighter1 && this.fighter1.damageSystem.isDead()) {
          this.p2Score++;
        }

        this.gameState = GameState.ROUND_END;
        this.stateTimer = 0;
      }
    }

    this.environment.update(dt);
    this.particles.update(dt);
  }

  _updateRoundIntro(dt) {
    this.stateTimer += dt;

    if (this.stateTimer > ROUND_INTRO_DURATION * 0.6) {
      this.ui.hud.showFight();
    }

    if (this.stateTimer >= ROUND_INTRO_DURATION) {
      this.gameState = GameState.FIGHTING;
      this.ui.hud.hideRoundAnnounce();
    }
  }

  _updateFighting(dt) {
    // Process P1 input
    this._processPlayerInput(this.fighter1, 0, dt);

    // Process P2 input (human or AI)
    if (this.aiController) {
      this.aiController.update(this.fighter2, this.fighter1, this.clock.frameCount, dt);
    } else {
      this._processPlayerInput(this.fighter2, 1, dt);
    }

    // Update fighters
    this.fighter1.update(dt, this.fighter2);
    this.fighter2.update(dt, this.fighter1);

    // Block pushback: push defender back while attacker is in ATTACK_ACTIVE and defender is blocking
    this._applyBlockPushback(this.fighter1, this.fighter2, dt);
    this._applyBlockPushback(this.fighter2, this.fighter1, dt);

    // Check combat hits
    this._checkHits();

    // Ring-out check
    this._checkRingOut();

    // Arena bounds — don't clamp fighters being pushed back (block/block stun)
    // so block pushback can cause ring out
    const noClamp = (s) => s === FighterState.BLOCK || s === FighterState.BLOCK_STUN || s === FighterState.CLASH;
    if (!noClamp(this.fighter1.state)) {
      this.arena.clampToArena(this.fighter1.position);
    }
    if (!noClamp(this.fighter2.state)) {
      this.arena.clampToArena(this.fighter2.position);
    }

    // Update debug facing arrows
    this._updateDebugArrows();

    // Update HUD
    this._updateHUD();
  }

  _applyBlockPushback(attacker, defender, dt) {
    if (attacker.state !== FighterState.ATTACK_ACTIVE) return;
    if (defender.state !== FighterState.BLOCK && defender.state !== FighterState.BLOCK_STUN) return;

    // Push defender away from attacker
    const dx = defender.position.x - attacker.position.x;
    const dz = defender.position.z - attacker.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
    const nx = dx / dist;
    const nz = dz / dist;

    defender.position.x += nx * BLOCK_PUSHBACK_SPEED * dt;
    defender.position.z += nz * BLOCK_PUSHBACK_SPEED * dt;
  }

  _processPlayerInput(fighter, playerIndex, dt) {
    if (fighter.state === FighterState.DEAD || fighter.state === FighterState.DYING) return;

    const frame = this.clock.frameCount;
    let isMoving = false;

    // D = move right (+X), A = move left (-X)
    if (this.input.isHeld(playerIndex, 'right')) {
      fighter.moveForward(dt);
      isMoving = true;
    } else if (this.input.isHeld(playerIndex, 'left')) {
      fighter.moveBack(dt);
      isMoving = true;
    }

    if (!isMoving && fighter.fsm.isActionable) {
      fighter.stopMoving();
    }

    // W/S = sidestep (committed dash, consumed from buffer)
    if (this.input.consumeBuffer(playerIndex, 'sidestepUp', frame)) {
      fighter.sidestep(-1);
    } else if (this.input.consumeBuffer(playerIndex, 'sidestepDown', frame)) {
      fighter.sidestep(1);
    }

    // Space = backstep (committed, consumed from buffer)
    if (this.input.consumeBuffer(playerIndex, 'backstep', frame)) {
      fighter.backstep();
    }

    // Attacks
    if (this.input.consumeBuffer(playerIndex, 'quick', frame)) {
      fighter.attack(AttackType.QUICK);
    } else if (this.input.consumeBuffer(playerIndex, 'heavy', frame)) {
      fighter.attack(AttackType.HEAVY);
    }

    // Block (hold) / Parry (tap)
    if (this.input.consumeBuffer(playerIndex, 'block', frame)) {
      fighter.parry();
    } else if (this.input.isHeld(playerIndex, 'block')) {
      if (fighter.fsm.isActionable) {
        fighter.block();
      }
    } else if (fighter.state === FighterState.BLOCK) {
      fighter.fsm.transition(FighterState.IDLE);
    }
  }

  _checkHits() {
    const isAttacking = (f) =>
      f.state === FighterState.ATTACK_STARTUP ||
      f.state === FighterState.ATTACK_ACTIVE ||
      f.state === FighterState.ATTACK_RECOVERY;

    if (isAttacking(this.fighter1) && !this.fighter1.hitApplied) {
      if (this.hitResolver.checkSwordCollision(this.fighter1, this.fighter2)) {
        this._resolveHit(this.fighter1, this.fighter2);
        this.fighter1.hitApplied = true;
      }
    }

    if (isAttacking(this.fighter2) && !this.fighter2.hitApplied) {
      if (this.hitResolver.checkSwordCollision(this.fighter2, this.fighter1)) {
        this._resolveHit(this.fighter2, this.fighter1);
        this.fighter2.hitApplied = true;
      }
    }
  }

  _resolveHit(attacker, defender) {
    const result = this.hitResolver.resolve(attacker, defender);

    const contactPoint = new THREE.Vector3().lerpVectors(
      attacker.position, defender.position, 0.6
    );
    contactPoint.y += 1.2;

    switch (result.result) {
      case HitResult.CLASH:
        attacker.fsm.applyClash();
        defender.fsm.applyClash();
        this._pushApart(attacker, defender, 1.0);
        this.particles.emitSparks(contactPoint, 15);
        this.cameraController.shake(0.2);
        this.screenEffects.flashWhite();
        this.screenEffects.startHitstop(5);
        break;

      case HitResult.WHIFF:
        break;

      case HitResult.PARRIED:
        attacker.fsm.applyParriedStun();
        defender.fsm.applyParrySuccess();
        this.particles.emitSparks(contactPoint, 10);
        this.cameraController.shake(0.15);
        this.screenEffects.flashWhite();
        this.screenEffects.startHitstop(8);
        break;

      case HitResult.BLOCKED: {
        attacker.fsm.applyBlockStun();
        defender.fsm.applyBlockStun();
        // Push defender back based on attack's blockPush
        const blockPush = attacker.currentAttackData ? attacker.currentAttackData.blockPush : 0.5;
        this._pushDefender(attacker, defender, blockPush);
        this.particles.emitSparks(contactPoint, 6);
        this.cameraController.shake(0.1);
        this.screenEffects.startHitstop(3);
        break;
      }

      case HitResult.CLEAN_HIT: {
        const isKill = defender.damageSystem.applyDamage();
        defender.fsm.applyHitStun();
        this._pushApart(attacker, defender, 0.3);
        this.particles.emitSparks(contactPoint, 8);
        this.cameraController.shake(0.25);
        this.screenEffects.flashRed();
        this.screenEffects.startHitstop(6);

        if (isKill) {
          this._onKill(attacker, defender);
        }
        break;
      }
    }
  }

  _onKill(killer, victim) {
    victim.fsm.startDying();

    const pos = victim.position.clone();
    pos.y += 1.0;
    this.particles.emitInkSplash(pos, 40);

    this.clock.setTimeScale(KILL_SLOWMO_SCALE);
    this.killSlowMoTimer = 0;

    this.cameraController.startKillCam(victim.position);
    this.cameraController.shake(0.5);
    this.screenEffects.flashRed();

    this.gameState = GameState.KILL_CAM;
  }

  _updateKillCam(dt) {
    this.fighter1.update(dt, this.fighter2);
    this.fighter2.update(dt, this.fighter1);
  }

  _updateRoundEnd(dt) {
    this.stateTimer += dt;

    if (this.stateTimer >= ROUND_END_DELAY) {
      if (this.p1Score >= ROUNDS_TO_WIN) {
        this._showVictory('PLAYER 1');
      } else if (this.p2Score >= ROUNDS_TO_WIN) {
        const name = this.mode === 'ai' ? 'COMPUTER' : 'PLAYER 2';
        this._showVictory(name);
      } else {
        this.currentRound++;
        this._startRound();
      }
    }
  }

  _showVictory(winnerName) {
    this.gameState = GameState.VICTORY;
    this.ui.showVictory(winnerName, this.p1Score, this.p2Score);
  }

  _checkRingOut() {
    const checkFighter = (fighter, otherFighter) => {
      const dist = Math.sqrt(
        fighter.position.x * fighter.position.x +
        fighter.position.z * fighter.position.z
      );
      if (dist > ARENA_RADIUS + 0.5 && fighter.state !== FighterState.DYING && fighter.state !== FighterState.DEAD) {
        fighter.damageSystem.applyDamage();
        this._onKill(otherFighter, fighter);
      }
    };

    checkFighter(this.fighter1, this.fighter2);
    checkFighter(this.fighter2, this.fighter1);
  }

  _updateDebugArrows() {
    if (!this._debugArrow1 || !this.fighter1 || !this.fighter2) return;

    const d1 = new THREE.Vector3().subVectors(this.fighter2.position, this.fighter1.position);
    d1.y = 0;
    if (d1.lengthSq() > 0.001) d1.normalize();
    else d1.set(1, 0, 0);
    this._debugArrow1.setDirection(d1);
    this._debugArrow1.position.copy(this.fighter1.position);
    this._debugArrow1.position.y = 0.05;

    const d2 = new THREE.Vector3().subVectors(this.fighter1.position, this.fighter2.position);
    d2.y = 0;
    if (d2.lengthSq() > 0.001) d2.normalize();
    else d2.set(-1, 0, 0);
    this._debugArrow2.setDirection(d2);
    this._debugArrow2.position.copy(this.fighter2.position);
    this._debugArrow2.position.y = 0.05;
  }

  _pushApart(a, b, force) {
    const dx = b.position.x - a.position.x;
    const dz = b.position.z - a.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
    const nx = dx / dist;
    const nz = dz / dist;

    a.position.x -= nx * force * 0.5;
    a.position.z -= nz * force * 0.5;
    b.position.x += nx * force * 0.5;
    b.position.z += nz * force * 0.5;
  }

  _pushDefender(attacker, defender, force) {
    const dx = defender.position.x - attacker.position.x;
    const dz = defender.position.z - attacker.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
    const nx = dx / dist;
    const nz = dz / dist;

    defender.position.x += nx * force;
    defender.position.z += nz * force;
  }

  _updateHUD() {
    if (!this.fighter1 || !this.fighter2) return;
    this.ui.hud.updateRoundPips(this.p1Score, this.p2Score);
  }

  // ── Animation Player Mode ──────────────────────────────

  async _startAnimPlayer() {
    this._cleanupFighters();
    this.gameState = GameState.ANIM_PLAYER;

    this.animPlayerEntries = await ModelLoader.loadAnimPlayerEntries([
      { url: '/dao_attack1_cartwheel.glb', trimStartFrames: 1 },
      { url: '/video.glb', splits: [
        { name: 'walk_right', startFrame: 2, endFrame: 161, inPlace: true },
        { name: 'walk_left', startFrame: 161, endFrame: 327, inPlace: true },
      ]},
    ]);

    for (const entry of this.animPlayerEntries) {
      let handBone = null;
      entry.root.traverse((child) => {
        if (child.isBone && (child.name === 'hand.R' || child.name === 'handR')) handBone = child;
      });
      if (handBone) {
        const wpn = new Weapon(WeaponType.DAO);
        const s = 1 / entry.root.scale.x;
        wpn.mesh.scale.setScalar(s);
        handBone.add(wpn.mesh);
      }
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

    this.ui.showAnimPlayer();
    this.cameraController.stopKillCam();

    this.ui.animPlayer.onClipSwitch = (action) => {
      this._switchAnimPlayerModel(action._animEntry);
    };
    this.ui.animPlayer.setMixerAndActions(null, allActions);
  }

  _switchAnimPlayerModel(entry) {
    if (this.animPlayerModel) {
      this.scene.remove(this.animPlayerModel);
    }

    if (this.animPlayerArrow) {
      this.scene.remove(this.animPlayerArrow);
      this.animPlayerArrow = null;
    }

    this.animPlayerModel = entry.root;
    this.animPlayerMixer = entry.mixer;

    this._animPlayerBaseScale = this.animPlayerModel.scale.x;
    this._animPlayerBasePos = this.animPlayerModel.position.clone();

    this.scene.add(this.animPlayerModel);

    const arrowDir = new THREE.Vector3(0, 0, 1);
    const arrowOrigin = new THREE.Vector3(0, 0.05, 0);
    this.animPlayerArrow = new THREE.ArrowHelper(arrowDir, arrowOrigin, 1.5, 0x44cc44, 0.3, 0.15);
    this.scene.add(this.animPlayerArrow);
  }

  _stopAnimPlayer() {
    if (this.animEditorTestMode) {
      this._setAnimPlayerTestMode(false);
    }

    if (this.animPlayerModel) {
      this.scene.remove(this.animPlayerModel);
      this.animPlayerModel = null;
    }
    if (this.animPlayerArrow) {
      this.scene.remove(this.animPlayerArrow);
      this.animPlayerArrow = null;
    }
    if (this.animPlayerEntries) {
      for (const entry of this.animPlayerEntries) {
        entry.mixer.stopAllAction();
      }
      this.animPlayerEntries = null;
    }
    this.animPlayerMixer = null;
    this._animPlayerBaseScale = null;
  }

  _updateAnimPlayer(dt) {
    if (this.animPlayerMixer) {
      this.animPlayerMixer.update(dt);
    }

    if (this.animEditorTestMode) {
      this._updateAnimPlayerTestMode(dt);
    }

    this.ui.animPlayer.updateDisplay();

    if (this.animPlayerArrow && this.animPlayerModel) {
      let dir;
      if (this.animEditorTestMode && this.animEditorDummy) {
        dir = new THREE.Vector3().subVectors(
          this.animEditorDummy.position,
          this.animPlayerModel.position
        );
        dir.y = 0;
        if (dir.lengthSq() > 0.001) dir.normalize();
        else dir.set(1, 0, 0);
      } else {
        dir = new THREE.Vector3(1, 0, 0);
      }
      this.animPlayerArrow.setDirection(dir);
      this.animPlayerArrow.position.copy(this.animPlayerModel.position);
      this.animPlayerArrow.position.y = 0.05;
    }

    if (this.animEditorTestMode) {
      const followDist = 5;
      const tx = this.animEditorModelPos.x;
      const tz = this.animEditorModelPos.z;
      this.camera.position.set(
        tx - Math.sin(this.animEditorModelRotY) * followDist,
        2.5,
        tz - Math.cos(this.animEditorModelRotY) * followDist
      );
      this.camera.lookAt(tx, 0.9, tz);
    } else {
      this.camera.position.set(3, 2.5, 4);
      this.camera.lookAt(0, 0.9, 0);
    }

    this.environment.update(dt);
  }

  _applyAnimPlayerTransform(transform) {
    if (!this.animPlayerModel) return;

    this._animPlayerKeyframedRotY = (transform.rotY * Math.PI) / 180;

    if (this.animEditorTestMode) {
      return;
    }

    if (!this._animPlayerBasePos || this._animPlayerBaseScale == null) return;

    const model = this.animPlayerModel;
    model.rotation.y = this._animPlayerKeyframedRotY;
    model.position.set(
      this._animPlayerBasePos.x + transform.posX,
      this._animPlayerBasePos.y + transform.posY,
      this._animPlayerBasePos.z + transform.posZ
    );
    model.scale.setScalar(this._animPlayerBaseScale * transform.scale);
  }

  _setAnimPlayerTestMode(enabled) {
    this.animEditorTestMode = enabled;

    if (enabled) {
      this.animEditorGrid = new THREE.GridHelper(20, 20, 0x444444, 0x333333);
      this.animEditorGrid.position.y = 0.01;
      this.scene.add(this.animEditorGrid);

      const geo = new THREE.BoxGeometry(0.6, 1.8, 0.6);
      const mat = new THREE.MeshStandardMaterial({ color: 0xcc4444, roughness: 0.8 });
      this.animEditorDummy = new THREE.Mesh(geo, mat);
      this.animEditorDummy.position.set(3, 0.9, 0);
      this.animEditorDummy.castShadow = true;
      this.scene.add(this.animEditorDummy);

      this.animEditorModelPos.set(0, 0, 0);
      this.animEditorModelRotY = 0;
      if (this.animPlayerModel) {
        this.animPlayerModel.position.set(0, 0, 0);
        this.animPlayerModel.rotation.y = 0;
      }
      this._testModeKeys = {};
    } else {
      if (this.animEditorGrid) {
        this.scene.remove(this.animEditorGrid);
        this.animEditorGrid = null;
      }
      if (this.animEditorDummy) {
        this.scene.remove(this.animEditorDummy);
        this.animEditorDummy = null;
      }
      if (this.animPlayerModel) {
        this.animPlayerModel.position.set(0, 0, 0);
        this.animPlayerModel.rotation.y = 0;
      }
    }
  }

  _updateAnimPlayerTestMode(dt) {
    if (!this.animPlayerModel) return;

    const moveSpeed = 3.0;
    const rotSpeed = 2.0;
    const keys = this.input.keysDown;

    if (keys.has('KeyA')) this.animEditorModelRotY += rotSpeed * dt;
    if (keys.has('KeyD')) this.animEditorModelRotY -= rotSpeed * dt;

    if (keys.has('KeyW')) {
      this.animEditorModelPos.x += Math.sin(this.animEditorModelRotY) * moveSpeed * dt;
      this.animEditorModelPos.z += Math.cos(this.animEditorModelRotY) * moveSpeed * dt;
    }
    if (keys.has('KeyS')) {
      this.animEditorModelPos.x -= Math.sin(this.animEditorModelRotY) * moveSpeed * dt;
      this.animEditorModelPos.z -= Math.cos(this.animEditorModelRotY) * moveSpeed * dt;
    }

    this.animPlayerModel.position.copy(this.animEditorModelPos);
    const keyframedOffset = this._animPlayerKeyframedRotY || 0;
    this.animPlayerModel.rotation.y = this.animEditorModelRotY + keyframedOffset;

    for (const key of ['KeyJ', 'KeyK', 'KeyL']) {
      if (keys.has(key) && !this._testModeKeys[key]) {
        this._testModeKeys[key] = true;
        const animScreen = this.ui.animPlayer;
        if (animScreen.currentAction) {
          animScreen.currentAction.reset();
          animScreen.currentAction.play();
        }
      } else if (!keys.has(key)) {
        this._testModeKeys[key] = false;
      }
    }
  }
}
