import {
  FighterState, AttackType,
  BLOCK_STUN_FRAMES, HIT_STUN_FRAMES, PARRIED_STUN_FRAMES,
  CLASH_PUSHBACK_FRAMES,
  SIDESTEP_DASH_FRAMES, SIDESTEP_RECOVERY_FRAMES,
  BACKSTEP_FRAMES, BACKSTEP_INVULN_FRAMES,
} from '../core/Constants.js';
import { getAttackData } from './AttackData.js';

export class FighterStateMachine {
  constructor(fighter) {
    this.fighter = fighter;
    this.state = FighterState.IDLE;
    this.stateFrames = 0;
    this.stateDuration = 0;
    this.currentAttackData = null;
    this.currentAttackType = null;
    this.hitApplied = false;

    // Sidestep state
    this.sidestepDirection = 0;    // +1 or -1 (Z axis)
    this.sidestepPhase = null;     // 'dash' | 'recovery'
  }

  get isActionable() {
    return this.state === FighterState.IDLE ||
           this.state === FighterState.WALK_FORWARD ||
           this.state === FighterState.WALK_BACK ||
           this.state === FighterState.PARRY_SUCCESS ||
           this.isSidestepRecovery;
  }

  get isSidestepRecovery() {
    return this.state === FighterState.SIDESTEP && this.sidestepPhase === 'recovery';
  }

  get isAttacking() {
    return this.state === FighterState.ATTACK_STARTUP ||
           this.state === FighterState.ATTACK_ACTIVE ||
           this.state === FighterState.ATTACK_RECOVERY;
  }

  transition(newState, duration = 0) {
    this.state = newState;
    this.stateFrames = 0;
    this.stateDuration = duration;
  }

  startAttack(attackType) {
    if (!this.isActionable) return false;

    const data = getAttackData(attackType, this.fighter.weaponType);

    this.currentAttackData = data;
    this.currentAttackType = attackType;
    this.hitApplied = false;
    this.transition(FighterState.ATTACK_STARTUP, data.startup);
    return true;
  }

  startBlock() {
    if (!this.isActionable) return false;
    this.transition(FighterState.BLOCK);
    return true;
  }

  startParry() {
    if (!this.isActionable) return false;
    this.transition(FighterState.PARRY);
    return true;
  }

  startSidestep(direction) {
    if (!this.isActionable || this.isSidestepRecovery) return false;
    this.sidestepDirection = direction;
    this.sidestepPhase = 'dash';
    this.transition(FighterState.SIDESTEP, SIDESTEP_DASH_FRAMES + SIDESTEP_RECOVERY_FRAMES);
    return true;
  }

  startBackstep() {
    if (!this.isActionable) return false;
    this.transition(FighterState.DODGE, BACKSTEP_FRAMES);
    return true;
  }

  applyBlockStun() {
    this.transition(FighterState.BLOCK_STUN, BLOCK_STUN_FRAMES);
  }

  applyHitStun() {
    this.transition(FighterState.HIT_STUN, HIT_STUN_FRAMES);
  }

  applyParriedStun() {
    this.transition(FighterState.PARRIED_STUN, PARRIED_STUN_FRAMES);
  }

  applyParrySuccess() {
    this.transition(FighterState.PARRY_SUCCESS, PARRIED_STUN_FRAMES);
  }

  applyClash() {
    this.transition(FighterState.CLASH, CLASH_PUSHBACK_FRAMES);
  }

  startDying() {
    this.transition(FighterState.DYING, 360);
  }

  update() {
    this.stateFrames++;

    switch (this.state) {
      case FighterState.ATTACK_STARTUP:
        if (this.stateFrames >= this.currentAttackData.startup) {
          this.transition(FighterState.ATTACK_ACTIVE, this.currentAttackData.active);
        }
        break;

      case FighterState.ATTACK_ACTIVE:
        if (this.stateFrames >= this.currentAttackData.active) {
          this.transition(FighterState.ATTACK_RECOVERY, this.currentAttackData.recovery);
        }
        break;

      case FighterState.ATTACK_RECOVERY:
        if (this.stateFrames >= this.currentAttackData.recovery) {
          this.currentAttackData = null;
          this.currentAttackType = null;
          this.transition(FighterState.IDLE);
        }
        break;

      case FighterState.BLOCK:
        // Block persists while held — released externally
        break;

      case FighterState.PARRY:
        // Parry window expires after 10 frames, then auto-transition to BLOCK (safe fallback)
        if (this.stateFrames >= 10) {
          this.transition(FighterState.BLOCK);
        }
        break;

      case FighterState.PARRY_SUCCESS:
        // Actionable state — defender can counter-attack during this window
        if (this.stateFrames >= this.stateDuration) {
          this.transition(FighterState.IDLE);
        }
        break;

      case FighterState.BLOCK_STUN:
      case FighterState.HIT_STUN:
      case FighterState.PARRIED_STUN:
      case FighterState.CLASH:
        if (this.stateFrames >= this.stateDuration) {
          this.transition(FighterState.IDLE);
        }
        break;

      case FighterState.SIDESTEP:
        if (this.sidestepPhase === 'dash' && this.stateFrames >= SIDESTEP_DASH_FRAMES) {
          this.sidestepPhase = 'recovery';
          this.stateFrames = 0;
        } else if (this.sidestepPhase === 'recovery' && this.stateFrames >= SIDESTEP_RECOVERY_FRAMES) {
          this.sidestepDirection = 0;
          this.sidestepPhase = null;
          this.transition(FighterState.IDLE);
        }
        break;

      case FighterState.DODGE:
        // Backstep
        if (this.stateFrames >= BACKSTEP_FRAMES) {
          this.transition(FighterState.IDLE);
        }
        break;

      case FighterState.DYING:
        if (this.stateFrames >= this.stateDuration) {
          this.transition(FighterState.DEAD);
        }
        break;
    }
  }

  reset() {
    this.state = FighterState.IDLE;
    this.stateFrames = 0;
    this.stateDuration = 0;
    this.currentAttackData = null;
    this.currentAttackType = null;
    this.hitApplied = false;
    this.sidestepDirection = 0;
    this.sidestepPhase = null;
  }
}
