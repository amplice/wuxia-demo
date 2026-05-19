import * as THREE from 'three';
import { HitResolver } from '../combat/HitResolver.js';
import { getBodyRadius, getImpactSlideScale, getImpactStunScale } from '../combat/CombatTuning.js';
import {
  FRAME_DURATION,
  FighterState,
  AttackType,
  HitResult,
  FIGHT_START_DISTANCE,
  KNOCKBACK_SLIDE_SPEED,
  BLOCK_KNOCKBACK_SLIDE_SPEED,
  HEAVY_ADVANTAGE_STUN_MULT,
  HEAVY_CLASH_STUN_MULT,
  HEAVY_CLASH_WINNER_STUN_MULT,
  CLASH_SLIDE_MULT,
  CLASH_PUSHBACK_FRAMES,
  BLOCK_STUN_FRAMES,
  HIT_STUN_FRAMES,
  PARRIED_STUN_FRAMES,
} from '../core/Constants.js';
import { clampPointToArena, getCurrentArenaStage, isPointInsideArena } from '../arena/ArenaBounds.js';

const _pairBodyA = new THREE.Vector3();
const _pairBodyB = new THREE.Vector3();
const ATTACK_BODY_SEPARATION_MULT = 0.5;
const ATTACK_BODY_SEPARATION_RESTORE_FRAMES = 8;

export class MatchSim {
  constructor({ fighter1, fighter2, hitResolver = new HitResolver(), stageId = null }) {
    this.fighter1 = fighter1;
    this.fighter2 = fighter2;
    this.hitResolver = hitResolver;
    this.stageId = stageId ?? getCurrentArenaStage();

    this.frameCount = 0;
    this.roundOver = false;
    this.winner = null;
    this.killReason = null;
    this.events = [];
    this._attackSeparationRestoreFrames = 0;
  }

  startRound(startDistance = FIGHT_START_DISTANCE, options = {}) {
    const swapSides = Boolean(options.swapSides);
    this.frameCount = 0;
    this.roundOver = false;
    this.winner = null;
    this.killReason = null;
    this.events.length = 0;

    this.fighter1.resetForRound((swapSides ? 1 : -1) * startDistance / 2);
    this.fighter2.resetForRound((swapSides ? -1 : 1) * startDistance / 2);
  }

  step(dt = FRAME_DURATION, options = {}) {
    if (this.roundOver) {
      return this._flushStepResult();
    }

    this.frameCount++;

    const {
      input1 = null,
      input2 = null,
      controller1 = null,
      controller2 = null,
    } = options;

    if (controller1) {
      controller1(this.fighter1, this.fighter2, this, dt);
    } else if (input1) {
      this.applyInputFrame(this.fighter1, this.fighter2, input1, dt);
    }

    if (controller2) {
      controller2(this.fighter2, this.fighter1, this, dt);
    } else if (input2) {
      this.applyInputFrame(this.fighter2, this.fighter1, input2, dt);
    }

    this.fighter1.update(dt, this.fighter2);
    this.fighter2.update(dt, this.fighter1);

    this._applyKnockbackSlide(this.fighter1, this.fighter2, dt);
    this._enforceFighterSeparation(this.fighter1, this.fighter2);
    this._checkHits();
    this.fighter1.syncStatePresentation();
    this.fighter2.syncStatePresentation();
    this._checkRingOut();
    this._clampToArenaIfNeeded(this.fighter1);
    this._clampToArenaIfNeeded(this.fighter2);

    return this._flushStepResult();
  }

  applyInputFrame(fighter, opponent, input, dt) {
    if (!input || fighter.state === FighterState.DEAD || fighter.state === FighterState.DYING) return;

    const moveDirection = input.held.right ? 1 : (input.held.left ? -1 : 0);
    fighter.applyMovementInput(moveDirection, opponent, dt);

    if (input.pressed.sidestepUp) {
      fighter.sidestep(-1);
    } else if (input.pressed.sidestepDown) {
      fighter.sidestep(1);
    }

    if (input.pressed.backstep) {
      fighter.backstep();
    }

    if (input.pressed.quick) {
      fighter.attack(AttackType.QUICK);
    } else if (input.pressed.heavy) {
      fighter.attack(AttackType.HEAVY);
    } else if (input.pressed.thrust) {
      fighter.attack(AttackType.THRUST);
    }

    if (input.pressed.block) {
      fighter.guard();
    } else if (input.held.block) {
      if (fighter.fsm.isActionable) {
        fighter.block();
      }
    } else if (fighter.state === FighterState.BLOCK) {
      fighter.fsm.transition(FighterState.IDLE);
    }
  }

  getSnapshot() {
    return {
      frameCount: this.frameCount,
      roundOver: this.roundOver,
      winner: this.winner,
      killReason: this.killReason,
      fighters: [
        this._serializeFighter(this.fighter1),
        this._serializeFighter(this.fighter2),
      ],
    };
  }

  _serializeFighter(fighter) {
    return {
      playerIndex: fighter.playerIndex,
      state: fighter.state,
      stateFrames: fighter.stateFrames,
      stateDuration: fighter.fsm.stateDuration,
      currentAttackType: fighter.currentAttackType,
      sidestepDirection: fighter.fsm.sidestepDirection,
      sidestepPhase: fighter.fsm.sidestepPhase,
      hitApplied: fighter.hitApplied,
      position: {
        x: fighter.position.x,
        y: fighter.position.y,
        z: fighter.position.z,
      },
      rotationY: fighter.group.rotation.y,
      facingRight: fighter.facingRight,
      dead: fighter.damageSystem.isDead(),
    };
  }

  _flushStepResult() {
    const events = this.events.slice();
    this.events.length = 0;
    return {
      frameCount: this.frameCount,
      roundOver: this.roundOver,
      winner: this.winner,
      killReason: this.killReason,
      events,
      snapshot: this.getSnapshot(),
    };
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
      let slide;
      if (a.state === FighterState.BLOCK_STUN) {
        const remaining = a.blockPushRemaining || 0;
        if (remaining <= 0) {
          slide = 0;
        } else {
          const maxSlide = BLOCK_KNOCKBACK_SLIDE_SPEED * (a.slideMult || 1) * dt;
          slide = Math.min(maxSlide, remaining);
          a.blockPushRemaining = Math.max(0, remaining - slide);
        }
      } else {
        slide = KNOCKBACK_SLIDE_SPEED * (a.slideMult || 1) * dt;
      }
      a.position.x -= nx * slide;
      a.position.z -= nz * slide;
    }
    if (bStun) {
      let slide;
      if (b.state === FighterState.BLOCK_STUN) {
        const remaining = b.blockPushRemaining || 0;
        if (remaining <= 0) {
          slide = 0;
        } else {
          const maxSlide = BLOCK_KNOCKBACK_SLIDE_SPEED * (b.slideMult || 1) * dt;
          slide = Math.min(maxSlide, remaining);
          b.blockPushRemaining = Math.max(0, remaining - slide);
        }
      } else {
        slide = KNOCKBACK_SLIDE_SPEED * (b.slideMult || 1) * dt;
      }
      b.position.x += nx * slide;
      b.position.z += nz * slide;
    }
  }

  _checkHits() {
    if (
      this.fighter1.fsm.isAttacking &&
      this.fighter2.fsm.isAttacking &&
      !this.fighter1.hitApplied &&
      !this.fighter2.hitApplied &&
      this.hitResolver.checkWeaponClash(this.fighter1, this.fighter2)
    ) {
      this._applyResolvedHit(this.fighter1, this.fighter2, {
        result: HitResult.CLASH,
        attackerType: this.fighter1.fsm.currentAttackType,
        defenderType: this.fighter2.fsm.currentAttackType,
      });
      this.fighter1.hitApplied = true;
      this.fighter2.hitApplied = true;
      return;
    }

    if (this.fighter1.fsm.isAttacking && !this.fighter1.hitApplied) {
      if (
        (this.fighter2.fsm.isGuarding && this.hitResolver.checkBlockContact(this.fighter1, this.fighter2)) ||
        this.hitResolver.checkSwordCollision(this.fighter1, this.fighter2)
      ) {
        this._resolveHit(this.fighter1, this.fighter2);
        this.fighter1.hitApplied = true;
      }
    }

    if (this.fighter2.fsm.isAttacking && !this.fighter2.hitApplied) {
      if (
        (this.fighter1.fsm.isGuarding && this.hitResolver.checkBlockContact(this.fighter2, this.fighter1)) ||
        this.hitResolver.checkSwordCollision(this.fighter2, this.fighter1)
      ) {
        this._resolveHit(this.fighter2, this.fighter1);
        this.fighter2.hitApplied = true;
      }
    }
  }

  _resolveHit(attacker, defender) {
    const result = this.hitResolver.resolve(attacker, defender);
    this._applyResolvedHit(attacker, defender, result);
  }

  _applyResolvedHit(attacker, defender, result) {
    const contactPoint = {
      x: attacker.position.x + (defender.position.x - attacker.position.x) * 0.6,
      y: 1.2,
      z: attacker.position.z + (defender.position.z - attacker.position.z) * 0.6,
    };

    switch (result.result) {
      case HitResult.CLASH: {
        const atkType = result.attackerType;
        const defType = result.defenderType;
        const atkHeavy = atkType === AttackType.HEAVY;
        const defHeavy = defType === AttackType.HEAVY;
        const atkClashAdvantage = attacker.fsm.currentAttackData?.clashAdvantage;
        const defClashAdvantage = defender.fsm.currentAttackData?.clashAdvantage;
        const atkStunBonus = (defHeavy && !atkHeavy)
          ? (defClashAdvantage?.targetStunMult ?? HEAVY_CLASH_STUN_MULT)
          : ((atkHeavy && !defHeavy) ? (atkClashAdvantage?.selfStunMult ?? HEAVY_CLASH_WINNER_STUN_MULT) : 1);
        const defStunBonus = (atkHeavy && !defHeavy)
          ? (atkClashAdvantage?.targetStunMult ?? HEAVY_CLASH_STUN_MULT)
          : ((defHeavy && !atkHeavy) ? (defClashAdvantage?.selfStunMult ?? HEAVY_CLASH_WINNER_STUN_MULT) : 1);
        const atkStunScale = this._getImpactStunScale(defender, attacker, atkStunBonus);
        const defStunScale = this._getImpactStunScale(attacker, defender, defStunBonus);
        const atkSlideScale = this._getImpactSlideScale(defender, attacker) * CLASH_SLIDE_MULT;
        const defSlideScale = this._getImpactSlideScale(attacker, defender) * CLASH_SLIDE_MULT;
        attacker.fsm.applyClash(Math.round(CLASH_PUSHBACK_FRAMES * atkStunScale));
        defender.fsm.applyClash(Math.round(CLASH_PUSHBACK_FRAMES * defStunScale));
        attacker.slideMult = atkSlideScale;
        defender.slideMult = defSlideScale;
        this.events.push({
          type: 'combat_result',
          result: HitResult.CLASH,
          attackerIndex: attacker.playerIndex,
          defenderIndex: defender.playerIndex,
          attackerType: result.attackerType,
          defenderType: result.defenderType,
          hitstopFrames: 5,
          contactPoint,
        });
        break;
      }

      case HitResult.WHIFF:
        break;

      case HitResult.PARRIED: {
        const parryStunScale = this._getImpactStunScale(defender, attacker);
        const parrySlideScale = this._getImpactSlideScale(defender, attacker);
        const attackType = result.attackerType;
        const baseParryFrames =
          attackType === AttackType.QUICK ? Math.round(PARRIED_STUN_FRAMES * 1.25) :
          attackType === AttackType.HEAVY ? Math.round(PARRIED_STUN_FRAMES * 0.9) :
          PARRIED_STUN_FRAMES;
        const parryFrames = Math.round(baseParryFrames * parryStunScale);
        attacker.fsm.applyParriedStun(parryFrames);
        attacker.slideMult = parrySlideScale;
        // PARRY_SUCCESS is kept as an explicit post-parry state mostly for AI
        // and instrumentation. The actual mechanical punish window is driven
        // primarily by the attacker entering PARRIED_STUN.
        defender.fsm.applyParrySuccess(undefined, attackType);
        this.events.push({
          type: 'combat_result',
          result: HitResult.PARRIED,
          attackerIndex: attacker.playerIndex,
          defenderIndex: defender.playerIndex,
          attackerType: attackType,
          hitstopFrames: 8,
          contactPoint,
        });
        break;
      }

      case HitResult.BLOCKED: {
        const isHeavy = result.attackerType === AttackType.HEAVY;
        const stunBonus = isHeavy ? HEAVY_ADVANTAGE_STUN_MULT : 1;
        const attackBlockPush = attacker.fsm.currentAttackData?.blockPush ?? 0.8;
        const blockStunScale = this._getImpactStunScale(attacker, defender, stunBonus);
        const blockPushDistance = attackBlockPush * this._getImpactSlideScale(
          attacker,
          defender,
          1,
        );
        attacker.fsm.applyBlockStun();
        defender.fsm.applyBlockStun(Math.round(BLOCK_STUN_FRAMES * blockStunScale));
        defender.blockPushRemaining = blockPushDistance;
        defender.slideMult = 1;
        this.events.push({
          type: 'combat_result',
          result: HitResult.BLOCKED,
          blockPushDistance,
          attackerIndex: attacker.playerIndex,
          defenderIndex: defender.playerIndex,
          attackerType: result.attackerType,
          hitstopFrames: 3,
          contactPoint,
        });
        break;
      }

      case HitResult.LETHAL_HIT: {
        const isKill = defender.damageSystem.applyDamage();
        const hitStunScale = this._getImpactStunScale(attacker, defender);
        const hitSlideScale = this._getImpactSlideScale(attacker, defender);
        defender.fsm.applyHitStun(Math.round(HIT_STUN_FRAMES * hitStunScale));
        defender.slideMult = hitSlideScale;
        this.events.push({
          type: 'combat_result',
          result: HitResult.LETHAL_HIT,
          attackerIndex: attacker.playerIndex,
          defenderIndex: defender.playerIndex,
          attackerType: result.attackerType,
          hitstopFrames: 6,
          contactPoint,
          kill: isKill,
        });

        if (isKill) {
          defender.fsm.startDying();
          this.roundOver = true;
          this.winner = attacker.playerIndex + 1;
          this.killReason = 'lethal_hit';
        }
        break;
      }
    }
  }

  _checkRingOut() {
    const checkFighter = (fighter, otherFighter) => {
      if (!isPointInsideArena(fighter.position.x, fighter.position.z, this.stageId, 0.5) && fighter.state !== FighterState.DYING && fighter.state !== FighterState.DEAD) {
        fighter.damageSystem.applyDamage();
        fighter.fsm.startDying();
        this.roundOver = true;
        this.winner = otherFighter.playerIndex + 1;
        this.killReason = 'ring_out';
        this.events.push({
          type: 'ring_out',
          winnerIndex: otherFighter.playerIndex,
          loserIndex: fighter.playerIndex,
        });
      }
    };

    if (!this.roundOver) checkFighter(this.fighter1, this.fighter2);
    if (!this.roundOver) checkFighter(this.fighter2, this.fighter1);
  }

  _clampToArenaIfNeeded(fighter) {
    const noClamp = (s) =>
      s === FighterState.BLOCK ||
      s === FighterState.BLOCK_STUN ||
      s === FighterState.CLASH ||
      s === FighterState.HIT_STUN ||
      s === FighterState.PARRIED_STUN;

    if (noClamp(fighter.state)) return;
    clampPointToArena(fighter.position, this.stageId, 0.3);
  }

  _enforceFighterSeparation(a, b) {
    let separationMult = 1;
    if (a.fsm.isAttacking || b.fsm.isAttacking) {
      separationMult = ATTACK_BODY_SEPARATION_MULT;
      this._attackSeparationRestoreFrames = ATTACK_BODY_SEPARATION_RESTORE_FRAMES;
    } else if (this._attackSeparationRestoreFrames > 0) {
      const t = (
        ATTACK_BODY_SEPARATION_RESTORE_FRAMES - this._attackSeparationRestoreFrames + 1
      ) / ATTACK_BODY_SEPARATION_RESTORE_FRAMES;
      separationMult = ATTACK_BODY_SEPARATION_MULT + (1 - ATTACK_BODY_SEPARATION_MULT) * t;
      this._attackSeparationRestoreFrames--;
    }

    const minDist = (getBodyRadius(a.charDef) + getBodyRadius(b.charDef)) * separationMult;
    const { dx, dz, dist } = this._getFighterPairDelta(a, b);
    if (dist < minDist) {
      const overlap = (minDist - dist) / 2;
      const nx = dx / dist;
      const nz = dz / dist;
      a.position.x -= nx * overlap;
      a.position.z -= nz * overlap;
      b.position.x += nx * overlap;
      b.position.z += nz * overlap;
    }
  }

  _getImpactScale(attacker, defender, bonus = 1) {
    return this._getImpactStunScale(attacker, defender, bonus);
  }

  _getImpactStunScale(attacker, defender, bonus = 1) {
    return getImpactStunScale(attacker?.charDef, defender?.charDef, bonus);
  }

  _getImpactSlideScale(attacker, defender, bonus = 1) {
    return getImpactSlideScale(attacker?.charDef, defender?.charDef, bonus);
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

    return { dx, dz, dist: Math.sqrt(distSq) };
  }
}

