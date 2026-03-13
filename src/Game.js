import * as THREE from 'three';
import { Renderer } from './core/Renderer.js';
import { Clock } from './core/Clock.js';
import { InputManager } from './core/InputManager.js';
import { Arena } from './arena/Arena.js';
import { Environment } from './arena/Environment.js';
import { CameraController } from './camera/CameraController.js';
import { Fighter } from './entities/Fighter.js';
import { ModelLoader } from './entities/ModelLoader.js';
import { CHARACTER_DEFS, DEFAULT_CHAR } from './entities/CharacterDefs.js';
import { HitResolver } from './combat/HitResolver.js';
import { ParticleSystem } from './vfx/ParticleSystem.js';
import { ScreenEffects } from './vfx/ScreenEffects.js';
import { AIController } from './ai/AIController.js';
import { DebugOverlay } from './debug/DebugOverlay.js';
import { UIManager } from './ui/UIManager.js';
import {
  GameState, FighterState, AttackType, HitResult,
  FIGHT_START_DISTANCE, ROUNDS_TO_WIN, ROUND_INTRO_DURATION,
  ROUND_END_DELAY, ARENA_RADIUS, BLOCK_PUSHBACK_SPEED,
  KNOCKBACK_SLIDE_SPEED, HEAVY_ADVANTAGE_MULT,
  CLASH_PUSHBACK_FRAMES, BLOCK_STUN_FRAMES, PARRIED_STUN_FRAMES,
} from './core/Constants.js';

const _pairBodyA = new THREE.Vector3();
const _pairBodyB = new THREE.Vector3();

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
    this._charCache = {};

    this.gameState = GameState.TITLE;
    this.stateTimer = 0;

    // Match state
    this.mode = 'ai';
    this.difficulty = 'medium';
    this.p1Score = 0;
    this.p2Score = 0;
    this.currentRound = 1;
    this.killSlowMoTimer = 0;
    this.animationSandbox = null;
    this.debugOverlay = null;
    this._lastFrameStats = { steps: 0, rawDelta: 0 };
  }

  async init() {
    await this.renderer.init();

    this.scene = new THREE.Scene();
    this.cameraController = new CameraController();
    this.camera = this.cameraController.camera;

    this.arena = new Arena(this.scene);
    this.environment = new Environment(this.scene);
    this.particles = new ParticleSystem(this.scene);
    this.debugOverlay = new DebugOverlay(this.scene);

    // Preload all characters
    for (const [id, def] of Object.entries(CHARACTER_DEFS)) {
      try {
        this._charCache[id] = await ModelLoader.loadCharacter(def);
      } catch (err) {
        console.warn(`Failed to load character '${id}':`, err);
      }
    }


    // UI
    this.ui.showTitle();

    this.ui.title.onStart = () => {
      this.gameState = GameState.SELECT;
      this.ui.showSelect();
    };

    this.ui.title.onAnimPlayer = async () => {
      await this._startAnimationSandbox();
    };

    this.ui.select.onConfirm = (config) => {
      this.mode = config.mode;
      this.difficulty = config.difficulty;
      this._startMatch(config.p1Char, config.p2Char);
    };

    this.ui.victory.onContinue = () => {
      this.gameState = GameState.TITLE;
      this._cleanupFighters();
      this.ui.showTitle();
    };

    this.clock.start();
    this._loop();
  }

  _getCharData(charId) {
    const id = CHARACTER_DEFS[charId] ? charId : DEFAULT_CHAR;
    const def = CHARACTER_DEFS[id];
    return { animData: this._charCache[id], charDef: def };
  }

  _startMatch(p1Char, p2Char) {
    this.p1Score = 0;
    this.p2Score = 0;
    this.currentRound = 1;

    this._cleanupFighters();

    const p1 = this._getCharData(p1Char);
    const p2 = this._getCharData(p2Char);
    this.fighter1 = new Fighter(0, 0x991111, p1.charDef, p1.animData);
    this.fighter2 = new Fighter(1, 0x112266, p2.charDef, p2.animData);
    this.fighter1.addToScene(this.scene);
    this.fighter2.addToScene(this.scene);

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
    // Skip if weapon is baked into the model (e.g. spearman GLB includes the spear)
    if (fighter.charDef.bakeWeapon) return;

    let handBone = null;
    fighter.root.traverse((child) => {
      if (child.isBone) {
        const n = ModelLoader._normalizeBoneName(child.name);
        if (ModelLoader.RIGHT_HAND_BONE_NAMES.includes(n)) {
          handBone = child;
        }
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
    this._killRealStart = null;

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

  async _startAnimationSandbox() {
    this._cleanupFighters();
    this.gameState = GameState.ANIM_PLAYER;

    if (!this.animationSandbox) {
      const { AnimationSandbox } = await import('./tools/AnimationSandbox.js');
      this.animationSandbox = new AnimationSandbox({
        scene: this.scene,
        camera: this.camera,
        cameraController: this.cameraController,
        environment: this.environment,
        input: this.input,
        ui: this.ui,
      });
      this.animationSandbox.onExit = () => {
        this._stopAnimationSandbox();
        this.gameState = GameState.TITLE;
        this.ui.showTitle();
      };
    }

    await this.animationSandbox.start();
  }

  _stopAnimationSandbox() {
    if (!this.animationSandbox) return;
    this.animationSandbox.stop();
  }

  _loop() {
    requestAnimationFrame(() => this._loop());

    const { steps, dt, rawDelta } = this.clock.update();
    this._lastFrameStats.steps = steps;
    this._lastFrameStats.rawDelta = rawDelta;

    for (let i = 0; i < steps; i++) {
      const frozen = this.screenEffects.update();
      if (frozen) continue;

      this._fixedUpdate(dt);
    }

    this._renderUpdate(rawDelta);
    this._updateDebugOverlay();
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
      if (this.animationSandbox) {
        this.animationSandbox.update(dt);
      }
      return;
    }


    if (this.fighter1 && this.fighter2) {
      this.cameraController.update(dt, this.fighter1, this.fighter2);
    }

    if (this.gameState === GameState.KILL_CAM) {
      // Use real time for kill cam phases (not affected by time scale)
      const now = performance.now() / 1000;
      if (!this._killRealStart) this._killRealStart = now;
      const elapsed = now - this._killRealStart;

      // Phased slowmo: freeze → ultra slow → slow → end
      const FREEZE_END = 0.15;
      const ULTRA_SLOW_END = 1.0;
      const SLOW_END = 3.0;

      if (elapsed < FREEZE_END) {
        this.clock.setTimeScale(0.0);
      } else if (elapsed < ULTRA_SLOW_END) {
        // Ease from 0 to 0.1
        const t = (elapsed - FREEZE_END) / (ULTRA_SLOW_END - FREEZE_END);
        this.clock.setTimeScale(t * 0.1);
      } else if (elapsed < SLOW_END) {
        // Ease from 0.1 to 0.4
        const t = (elapsed - ULTRA_SLOW_END) / (SLOW_END - ULTRA_SLOW_END);
        this.clock.setTimeScale(0.1 + t * 0.3);
      } else {
        // Kill cam done
        this.clock.setTimeScale(1.0);
        this.cameraController.stopKillCam();
        this.screenEffects.stopKillEffects();
        this._killRealStart = null;

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

    // Knockback slide: fighters slide apart during stun states
    this._applyKnockbackSlide(this.fighter1, this.fighter2, dt);

    // Fighter collision — push apart if too close
    this._enforceFighterSeparation(this.fighter1, this.fighter2);

    // Check combat hits
    this._checkHits();

    // Ring-out check
    this._checkRingOut();

    // Arena bounds — don't clamp fighters being pushed back (block/block stun)
    // so block pushback can cause ring out
    const noClamp = (s) => s === FighterState.BLOCK || s === FighterState.BLOCK_STUN || s === FighterState.CLASH || s === FighterState.HIT_STUN || s === FighterState.PARRIED_STUN;
    if (!noClamp(this.fighter1.state)) {
      this.arena.clampToArena(this.fighter1.position);
    }
    if (!noClamp(this.fighter2.state)) {
      this.arena.clampToArena(this.fighter2.position);
    }

    // Update HUD
    this._updateHUD();
  }

  _applyBlockPushback(attacker, defender, dt) {
    if (attacker.state !== FighterState.ATTACK_ACTIVE) return;
    if (defender.state !== FighterState.BLOCK && defender.state !== FighterState.BLOCK_STUN) return;

    // Only push if defender is within attack reach + small buffer
    const { dx, dz, dist } = this._getFighterPairDelta(attacker, defender);
    const reach = attacker.currentAttackData ? attacker.currentAttackData.reach : 2.0;
    if (dist > reach + 0.2) return;

    // Transition blocker to BLOCK_STUN so block_knockback animation plays during pushback
    if (defender.state === FighterState.BLOCK) {
      const isHeavy = attacker.fsm.currentAttackType === AttackType.HEAVY;
      const mult = isHeavy ? HEAVY_ADVANTAGE_MULT : 1;
      defender.fsm.applyBlockStun(Math.round(BLOCK_STUN_FRAMES * mult));
      defender.knockbackMult = mult;
    }

    // Push defender away from attacker
    const nx = dx / (dist || 0.01);
    const nz = dz / (dist || 0.01);

    defender.position.x += nx * BLOCK_PUSHBACK_SPEED * dt;
    defender.position.z += nz * BLOCK_PUSHBACK_SPEED * dt;
  }

  _applyKnockbackSlide(a, b, dt) {
    const stunStates = [FighterState.CLASH, FighterState.HIT_STUN, FighterState.PARRIED_STUN, FighterState.BLOCK_STUN];
    const aStun = stunStates.includes(a.state);
    const bStun = stunStates.includes(b.state);
    if (!aStun && !bStun) return;

    const { dx, dz, dist } = this._getFighterPairDelta(a, b);
    const nx = dx / dist;
    const nz = dz / dist;

    if (aStun) {
      const slide = KNOCKBACK_SLIDE_SPEED * (a.knockbackMult || 1) * dt;
      a.position.x -= nx * slide;
      a.position.z -= nz * slide;
    }
    if (bStun) {
      const slide = KNOCKBACK_SLIDE_SPEED * (b.knockbackMult || 1) * dt;
      b.position.x += nx * slide;
      b.position.z += nz * slide;
    }
  }

  _processPlayerInput(fighter, playerIndex, dt) {
    if (fighter.state === FighterState.DEAD || fighter.state === FighterState.DYING) return;

    const frame = this.clock.frameCount;
    const opponent = (fighter === this.fighter1) ? this.fighter2 : this.fighter1;
    const moveDirection = this.input.isHeld(playerIndex, 'right')
      ? 1
      : (this.input.isHeld(playerIndex, 'left') ? -1 : 0);
    fighter.applyMovementInput(moveDirection, opponent, dt);

    // W/S = committed sidestep (tap to dash on Z axis)
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
    } else if (this.input.consumeBuffer(playerIndex, 'thrust', frame)) {
      fighter.attack(AttackType.THRUST);
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
      case HitResult.CLASH: {
        // Heavy beats light/thrust — loser gets 1.5x stun & knockback
        const atkType = result.attackerType;
        const defType = result.defenderType;
        const atkHeavy = atkType === AttackType.HEAVY;
        const defHeavy = defType === AttackType.HEAVY;
        const atkMult = (defHeavy && !atkHeavy) ? HEAVY_ADVANTAGE_MULT : 1;
        const defMult = (atkHeavy && !defHeavy) ? HEAVY_ADVANTAGE_MULT : 1;
        attacker.fsm.applyClash(Math.round(CLASH_PUSHBACK_FRAMES * atkMult));
        defender.fsm.applyClash(Math.round(CLASH_PUSHBACK_FRAMES * defMult));
        attacker.knockbackMult = atkMult;
        defender.knockbackMult = defMult;
        this.particles.emitClashSparks(contactPoint);
        this.cameraController.shake(0.2);
        this.screenEffects.startHitstop(5);
        break;
      }

      case HitResult.WHIFF:
        break;

      case HitResult.PARRIED:
        attacker.fsm.applyParriedStun();
        defender.fsm.applyParrySuccess();
        this.particles.emitSparks(contactPoint, 10);
        this.cameraController.shake(0.15);
        this.screenEffects.startHitstop(8);
        break;

      case HitResult.BLOCKED: {
        // Heavy attacks cause 1.5x block stun & knockback
        const isHeavy = result.attackerType === AttackType.HEAVY;
        const blockMult = isHeavy ? HEAVY_ADVANTAGE_MULT : 1;
        attacker.fsm.applyBlockStun();
        defender.fsm.applyBlockStun(Math.round(BLOCK_STUN_FRAMES * blockMult));
        defender.knockbackMult = blockMult;
        this.particles.emitSparks(contactPoint, 6);
        this.cameraController.shake(0.1);
        this.screenEffects.startHitstop(3);
        break;
      }

      case HitResult.CLEAN_HIT: {
        const isKill = defender.damageSystem.applyDamage();
        defender.fsm.applyHitStun();
        this.particles.emitSparks(contactPoint, 8);
        this.particles.emitBlood(contactPoint, 15);
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

    // Ragdoll the victim away from killer
    const dx = victim.position.x - killer.position.x;
    const dz = victim.position.z - killer.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
    victim.startRagdoll(dx / dist, dz / dist);

    const pos = victim.position.clone();
    pos.y += 1.0;
    this.particles.emitBloodGush(pos, 50);

    // Phase 1: Impact freeze — complete time stop
    this.clock.setTimeScale(0.0);
    this.killSlowMoTimer = 0;
    this.killPhase = 'freeze';

    this.cameraController.startKillCam(victim, killer);
    this.cameraController.shake(0.6);
    this.screenEffects.startKillEffects();

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

  _updateDebugOverlay() {
    if (!this.debugOverlay) return;
    this.debugOverlay.update(this._buildDebugSnapshot());
  }

  _buildDebugSnapshot() {
    const fighter1 = this.fighter1?.getDebugSnapshot(this.fighter2) ?? null;
    const fighter2 = this.fighter2?.getDebugSnapshot(this.fighter1) ?? null;
    const distance = (this.fighter1 && this.fighter2)
      ? this.fighter1.distanceTo(this.fighter2)
      : 0;

    return {
      gameState: this.gameState,
      frameCount: this.clock.frameCount,
      timeScale: this.clock.timeScale,
      rawDelta: this._lastFrameStats.rawDelta,
      steps: this._lastFrameStats.steps,
      stateTimer: this.stateTimer,
      mode: this.mode,
      difficulty: this.difficulty,
      currentRound: this.currentRound,
      p1Score: this.p1Score,
      p2Score: this.p2Score,
      distance,
      animSandbox: Boolean(this.animationSandbox && this.gameState === GameState.ANIM_PLAYER),
      screen: {
        hitstopFrames: this.screenEffects.hitstopFrames,
        onHitstop: this.screenEffects.onHitstop,
      },
      camera: {
        killCamActive: this.cameraController.killCamActive,
        killCamPhase: this.cameraController.killCamPhase,
        orbitAngle: this.cameraController.orbitAngle,
        shakeIntensity: this.cameraController.shakeIntensity,
        killCamTime: this.cameraController.killCamTime,
      },
      ai: this.aiController?.getDebugSnapshot() ?? null,
      fighter1,
      fighter2,
    };
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

  _enforceFighterSeparation(a, b) {
    const getBodyRadius = (fighter) => {
      if (typeof fighter.charDef.bodyRadius === 'number') return fighter.charDef.bodyRadius;
      if (typeof fighter.charDef.bodySeparation === 'number') return fighter.charDef.bodySeparation * 0.5;
      return 0.4;
    };
    const MIN_DIST = getBodyRadius(a) + getBodyRadius(b);
    const { dx, dz, dist } = this._getFighterPairDelta(a, b);
    if (dist < MIN_DIST) {
      const overlap = (MIN_DIST - dist) / 2;
      const nx = dx / dist;
      const nz = dz / dist;
      a.position.x -= nx * overlap;
      a.position.z -= nz * overlap;
      b.position.x += nx * overlap;
      b.position.z += nz * overlap;
    }
  }

  _pushApart(a, b, force) {
    const { dx, dz, dist } = this._getFighterPairDelta(a, b);
    const nx = dx / dist;
    const nz = dz / dist;

    a.position.x -= nx * force * 0.5;
    a.position.z -= nz * force * 0.5;
    b.position.x += nx * force * 0.5;
    b.position.z += nz * force * 0.5;
  }

  _pushDefender(attacker, defender, force) {
    const { dx, dz, dist } = this._getFighterPairDelta(attacker, defender);
    const nx = dx / dist;
    const nz = dz / dist;

    defender.position.x += nx * force;
    defender.position.z += nz * force;
  }

  _updateHUD() {
    if (!this.fighter1 || !this.fighter2) return;
    this.ui.hud.updateRoundPips(this.p1Score, this.p2Score);
  }

  _getFighterPairDelta(a, b) {
    a.getBodyCollisionPosition(_pairBodyA);
    b.getBodyCollisionPosition(_pairBodyB);

    let dx = _pairBodyB.x - _pairBodyA.x;
    let dz = _pairBodyB.z - _pairBodyA.z;
    let distSq = dx * dx + dz * dz;

    if (distSq < 1e-6) {
      dx = b.position.x - a.position.x;
      dz = b.position.z - a.position.z;
      distSq = dx * dx + dz * dz;
    }

    if (distSq < 1e-6) {
      dx = a.playerIndex < b.playerIndex ? 1 : -1;
      dz = 0;
      distSq = 1;
    }

    return {
      dx,
      dz,
      dist: Math.sqrt(distSq),
    };
  }
}
