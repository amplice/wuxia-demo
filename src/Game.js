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
  FRAME_DURATION, ARENA_RADIUS,
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
    this.modelData = null; // Loaded FBX model + texture
    this.fightAnimData = null; // Loaded GLB fight animations

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
    this.animPlayerModel = null;  // THREE.Group for the preview model
    this.animPlayerMixer = null;  // AnimationMixer for the preview
    this.animPlayerAngle = 0;     // Orbit angle
    this.animPlayerOrbitPaused = false;
  }

  async init() {
    await this.renderer.init();

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.cameraController = new CameraController();
    this.camera = this.cameraController.camera;

    // Arena & Environment
    this.arena = new Arena(this.scene);
    this.environment = new Environment(this.scene);

    // Particles
    this.particles = new ParticleSystem(this.scene);

    // Preload fight animation GLBs
    try {
      this.fightAnimData = await ModelLoader.loadFightAnimations();
      console.log('Fight animations loaded successfully');
    } catch (err) {
      console.warn('Failed to load fight animations, falling back:', err);
      this.fightAnimData = null;
    }

    // Preload FBX model + texture (fallback if GLB fails)
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

    // Title screen callback
    this.ui.title.onStart = () => {
      this.gameState = GameState.SELECT;
      this.ui.showSelect();
    };

    // Select screen callback
    this.ui.select.onConfirm = (config) => {
      this.mode = config.mode;
      this.difficulty = config.difficulty;
      this._startMatch(config.p1Weapon, config.p2Weapon);
    };

    // Victory screen callback
    this.ui.victory.onContinue = () => {
      this.gameState = GameState.TITLE;
      this._cleanupFighters();
      this.ui.showTitle();
    };

    // Animation player callbacks
    this.ui.title.onAnimPlayer = () => {
      this._startAnimPlayer();
    };

    this.ui.animPlayer.onBack = () => {
      this._stopAnimPlayer();
      this.gameState = GameState.TITLE;
      this.ui.showTitle();
    };

    this.ui.animPlayer.onToggleOrbit = () => {
      this.animPlayerOrbitPaused = !this.animPlayerOrbitPaused;
      document.getElementById('anim-btn-orbit').textContent =
        this.animPlayerOrbitPaused ? 'START ORBIT' : 'STOP ORBIT';
    };

    // Start loop
    this.clock.start();
    this._loop();
  }

  _startMatch(p1Weapon, p2Weapon) {
    this.p1Score = 0;
    this.p2Score = 0;
    this.currentRound = 1;

    // Create fighters
    this._cleanupFighters();

    this.fighter1 = new Fighter(0, 0x991111, p1Weapon, this.modelData, this.fightAnimData);
    this.fighter2 = new Fighter(1, 0x112266, p2Weapon, this.modelData, this.fightAnimData);
    this.fighter1.addToScene(this.scene);
    this.fighter2.addToScene(this.scene);

    // Attach swords — same approach as animation player (_startAnimPlayer)
    this._attachWeapon(this.fighter1);
    this._attachWeapon(this.fighter2);

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
    // Attach sword to hand bone — mirrors the animation player approach exactly
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
      console.log(`Weapon attached to bone: ${handBone.name}, scale: ${s}`);
    } else {
      // Fallback: attach to root at approximate hand position
      console.warn('No hand bone found, attaching weapon to root');
      fighter.weapon.mesh.position.set(0.3, 1.2, 0);
      fighter.root.add(fighter.weapon.mesh);
    }
  }

  _startRound() {
    this.gameState = GameState.ROUND_INTRO;
    this.stateTimer = 0;
    this.clock.setTimeScale(1.0);
    this.killSlowMoTimer = 0;

    // Reset fighter positions
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
  }

  _loop() {
    requestAnimationFrame(() => this._loop());

    const { steps, dt, rawDelta } = this.clock.update();

    // Fixed timestep game logic
    for (let i = 0; i < steps; i++) {
      // Check hitstop
      const frozen = this.screenEffects.update();
      if (frozen) continue;

      this._fixedUpdate(dt);
    }

    // Variable rate visual updates
    this._renderUpdate(rawDelta);

    // Render
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
    // Animation player mode
    if (this.gameState === GameState.ANIM_PLAYER) {
      this._updateAnimPlayer(dt);
      return;
    }

    // Camera
    if (this.fighter1 && this.fighter2) {
      this.cameraController.update(dt, this.fighter1, this.fighter2);
    }

    // Kill cam real-time timer (tracks wall-clock independent of timeScale)
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

    // Environment particles
    this.environment.update(dt);

    // VFX particles
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

    // Check combat hits
    this._checkHits();

    // Arena bounds
    this.arena.clampToArena(this.fighter1.position);
    this.arena.clampToArena(this.fighter2.position);

    // Ring-out check
    this._checkRingOut();

    // Update HUD
    this._updateHUD();
  }

  _processPlayerInput(fighter, playerIndex, dt) {
    if (fighter.state === FighterState.DEAD || fighter.state === FighterState.DYING) return;

    const opponent = playerIndex === 0 ? this.fighter2 : this.fighter1;
    const frame = this.clock.frameCount;
    let isMoving = false;

    // D = move toward opponent, A = move away from opponent
    if (this.input.isHeld(playerIndex, 'right')) {
      fighter.moveForward(dt, opponent);
      isMoving = true;
    } else if (this.input.isHeld(playerIndex, 'left')) {
      fighter.moveBack(dt, opponent);
      isMoving = true;
    }

    // W/S = sidestep (orbit around opponent)
    if (this.input.isHeld(playerIndex, 'sideUp')) {
      fighter.sidestep(dt, -1, opponent);
      isMoving = true;
    } else if (this.input.isHeld(playerIndex, 'sideDown')) {
      fighter.sidestep(dt, 1, opponent);
      isMoving = true;
    }

    if (!isMoving && fighter.fsm.isActionable) {
      fighter.stopMoving();
    }

    // Attacks (buffered)
    if (this.input.consumeBuffer(playerIndex, 'quick', frame)) {
      fighter.attack(AttackType.QUICK);
    } else if (this.input.consumeBuffer(playerIndex, 'heavy', frame)) {
      fighter.attack(AttackType.HEAVY);
    } else if (this.input.consumeBuffer(playerIndex, 'thrust', frame)) {
      fighter.attack(AttackType.THRUST);
    }

    // Stance change
    if (this.input.consumeBuffer(playerIndex, 'stance', frame)) {
      fighter.changeStance();
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

    // Dodge
    if (this.input.consumeBuffer(playerIndex, 'dodge', frame)) {
      fighter.dodge(opponent);
    }
  }

  _checkHits() {
    // Check sword collision during any attack phase (startup/active/recovery)
    const isAttacking = (f) =>
      f.state === FighterState.ATTACK_STARTUP ||
      f.state === FighterState.ATTACK_ACTIVE ||
      f.state === FighterState.ATTACK_RECOVERY;

    // Check if fighter1's sword hits fighter2
    if (isAttacking(this.fighter1) && !this.fighter1.hitApplied) {
      if (this.hitResolver.checkSwordCollision(this.fighter1, this.fighter2)) {
        this._resolveHit(this.fighter1, this.fighter2);
        this.fighter1.hitApplied = true;
      }
    }

    // Check if fighter2's sword hits fighter1
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
        // Push both back
        this._pushApart(attacker, defender, 1.0);
        this.particles.emitSparks(contactPoint, 15);
        this.cameraController.shake(0.2);
        this.screenEffects.flashWhite();
        this.screenEffects.startHitstop(5);
        break;

      case HitResult.WHIFF:
        // Nothing happens, attack missed
        break;

      case HitResult.PARRIED:
        attacker.fsm.applyParriedStun();
        this.particles.emitSparks(contactPoint, 10);
        this.cameraController.shake(0.15);
        this.screenEffects.flashWhite();
        this.screenEffects.startHitstop(8);
        break;

      case HitResult.BLOCKED:
        attacker.fsm.applyBlockStun();
        defender.fsm.applyBlockStun();
        this._pushApart(attacker, defender, 0.5);
        this.particles.emitSparks(contactPoint, 6);
        this.cameraController.shake(0.1);
        this.screenEffects.startHitstop(3);
        break;

      case HitResult.CLEAN_HIT: {
        const isKill = defender.damageSystem.applyDamage(result.zone);
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

    // Ink splash VFX
    const pos = victim.position.clone();
    pos.y += 1.0;
    this.particles.emitInkSplash(pos, 40);

    // Slow-mo
    this.clock.setTimeScale(KILL_SLOWMO_SCALE);
    this.killSlowMoTimer = 0;

    // Kill cam
    this.cameraController.startKillCam(victim.position);
    this.cameraController.shake(0.5);
    this.screenEffects.flashRed();

    this.gameState = GameState.KILL_CAM;
  }

  _updateKillCam(dt) {
    // Just update fighters for animation during slow-mo
    // Timer is handled in _renderUpdate for wall-clock accuracy
    this.fighter1.update(dt, this.fighter2);
    this.fighter2.update(dt, this.fighter1);
  }

  _updateRoundEnd(dt) {
    this.stateTimer += dt;

    if (this.stateTimer >= ROUND_END_DELAY) {
      // Check for match winner
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
    const checkFighter = (fighter, otherFighter, fighterIsP1) => {
      const dist = Math.sqrt(
        fighter.position.x * fighter.position.x +
        fighter.position.z * fighter.position.z
      );
      if (dist > ARENA_RADIUS + 0.5 && fighter.state !== FighterState.DYING && fighter.state !== FighterState.DEAD) {
        // Ring out = instant kill
        fighter.damageSystem.applyDamage('mid');
        fighter.damageSystem.applyDamage('mid');
        this._onKill(otherFighter, fighter);
      }
    };

    checkFighter(this.fighter1, this.fighter2, true);
    checkFighter(this.fighter2, this.fighter1, false);
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

  _updateHUD() {
    if (!this.fighter1 || !this.fighter2) return;

    this.ui.hud.updateStance(0, this.fighter1.stanceSystem.stance);
    this.ui.hud.updateStance(1, this.fighter2.stanceSystem.stance);
    this.ui.hud.updateDamage(0, this.fighter1.damageSystem.zones);
    this.ui.hud.updateDamage(1, this.fighter2.damageSystem.zones);
    this.ui.hud.updateRoundPips(this.p1Score, this.p2Score);
  }

  // ── Animation Player Mode ──────────────────────────────

  async _startAnimPlayer() {
    this._cleanupFighters();
    this.gameState = GameState.ANIM_PLAYER;

    // Load all animation files — each gets its own model + mixer
    this.animPlayerEntries = await ModelLoader.loadAnimPlayerEntries([
      '/dao_attack1_cartwheel.glb',
      { url: '/video.glb', splits: [
        { name: 'walk_right', startFrame: 0, endFrame: 161, inPlace: true },
        { name: 'walk_left', startFrame: 161, endFrame: 327, inPlace: true },
      ]},
    ]);

    // Attach a sword to the right hand of each model
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
    this.animPlayerAngle = 0;

    // Build a combined actions map that the UI can use
    // Each action knows which entry it belongs to
    const allActions = {};
    for (const entry of this.animPlayerEntries) {
      for (const [name, action] of Object.entries(entry.actions)) {
        allActions[name] = action;
        action._animEntry = entry; // tag so we can switch models
      }
    }

    // Create a dummy mixer for the UI (it will be swapped per-clip)
    this.ui.animPlayer.setMixerAndActions(null, allActions);
    this.ui.animPlayer.onClipSwitch = (action) => {
      this._switchAnimPlayerModel(action._animEntry);
    };
    this.ui.showAnimPlayer();

    this.cameraController.stopKillCam();
  }

  _switchAnimPlayerModel(entry) {
    // Remove old model
    if (this.animPlayerModel) {
      this.scene.remove(this.animPlayerModel);
    }

    // Add new model
    this.animPlayerModel = entry.root;
    this.animPlayerMixer = entry.mixer;
    this.animPlayerModel.position.set(0, 0, 0);
    this.scene.add(this.animPlayerModel);
  }

  _stopAnimPlayer() {
    if (this.animPlayerModel) {
      this.scene.remove(this.animPlayerModel);
      this.animPlayerModel = null;
    }
    // Stop all mixers
    if (this.animPlayerEntries) {
      for (const entry of this.animPlayerEntries) {
        entry.mixer.stopAllAction();
      }
      this.animPlayerEntries = null;
    }
    this.animPlayerMixer = null;
  }

  _updateAnimPlayer(dt) {
    // Update active mixer
    if (this.animPlayerMixer) {
      this.animPlayerMixer.update(dt);
    }

    // Update UI display (time, progress bar)
    this.ui.animPlayer.updateDisplay();

    // Orbit camera around model
    if (!this.animPlayerOrbitPaused) this.animPlayerAngle += dt * 0.3;
    const radius = 5;
    const camY = 2.5;
    this.camera.position.set(
      Math.cos(this.animPlayerAngle) * radius,
      camY,
      Math.sin(this.animPlayerAngle) * radius
    );
    this.camera.lookAt(0, 0.9, 0);

    // Environment particles
    this.environment.update(dt);
  }
}
