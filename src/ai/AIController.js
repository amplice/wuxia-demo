import { resolveAIPersonality } from './AIPersonality.js';
import { FighterState, AttackType } from '../core/Constants.js';
import { getAttackData } from '../combat/AttackData.js';

const MAX_BLOCK_FRAMES = 40; // ~0.67s max block hold
const ATTACK_FRONT_DOT_MIN = 0.55;
const ATTACK_FRONT_DOT_STRONG = 0.85;
const ATTACK_RANGE_MARGIN = 0.15;
const FLANKED_FRONT_DOT = 0.35;
const RECENT_WHIFF_FRAMES = 48;
const RECENT_OPPONENT_SIDESTEP_FRAMES = 36;
const REPEAT_MOBILITY_FRAMES = 32;

export class AIController {
  constructor(profile = 'medium') {
    this.profileName = 'medium';
    this.baseProfileName = 'punisher';
    this.personality = {};
    this.setDifficulty(profile);
    this.lastDecisionFrame = 0;
    this.pendingAction = null;
    this.currentAction = null;
    this.sideDir = 1;
    this.blockHeldFrames = 0;

    this._opponentLastState = null;
    this._opponentBlockCount = 0;
    this._opponentAttackCount = 0;
    this._decayTimer = 0;
    this._selfLastState = null;
    this._selfWasAttacking = false;
    this._lastWhiffFrame = -9999;
    this._opponentLastSidestepFrame = -9999;
    this._selfLastSidestepFrame = -9999;
    this._selfLastBackstepFrame = -9999;
    this._mobilityFatigue = 0;
  }

  setDifficulty(profile) {
    const resolved = resolveAIPersonality(profile);
    this.profileName = resolved.name;
    this.baseProfileName = resolved.baseProfile || resolved.name;
    this.personality = resolved.personality;
  }

  update(fighter, opponent, frameCount, dt) {
    this._opponent = opponent;
    this._mobilityFatigue = Math.max(0, this._mobilityFatigue - dt * 3.2);

    this._trackOpponent(opponent, frameCount);
    this._trackSelf(fighter, frameCount);

    if (this.currentAction === 'block') {
      this.blockHeldFrames++;
      if (this.blockHeldFrames >= MAX_BLOCK_FRAMES) {
        if (fighter.state === FighterState.BLOCK) {
          fighter.fsm.transition(FighterState.IDLE);
        }
        this.currentAction = null;
        this.blockHeldFrames = 0;
      }
    } else {
      this.blockHeldFrames = 0;
    }

    if (this.currentAction === 'block' && fighter.state === FighterState.BLOCK) {
      const opponentThreat = opponent.fsm.isAttacking;
      if (!opponentThreat) {
        fighter.fsm.transition(FighterState.IDLE);
        this.currentAction = null;
      }
    }

    const shouldInterrupt = this._checkReactiveInterrupt(fighter, opponent);

    if (shouldInterrupt) {
      this.lastDecisionFrame = frameCount;
      this._makeDecision(fighter, opponent, dt, frameCount);
    } else if (frameCount - this.lastDecisionFrame < this.personality.reactionFrames) {
      this._executePersistent(fighter, dt);
    } else {
      this.lastDecisionFrame = frameCount;
      this._makeDecision(fighter, opponent, dt, frameCount);
    }

    this._applyMovement(fighter, dt);
  }

  _trackOpponent(opponent, frameCount) {
    const state = opponent.state;
    if (state !== this._opponentLastState) {
      if (state === FighterState.BLOCK || state === FighterState.BLOCK_STUN) {
        this._opponentBlockCount++;
      }
      if (state === FighterState.ATTACK_ACTIVE) {
        this._opponentAttackCount++;
      }
      if (state === FighterState.SIDESTEP) {
        this._opponentLastSidestepFrame = frameCount;
      }
      this._opponentLastState = state;
    }

    this._decayTimer++;
    if (this._decayTimer > 300) {
      this._opponentBlockCount = Math.floor(this._opponentBlockCount * 0.7);
      this._opponentAttackCount = Math.floor(this._opponentAttackCount * 0.7);
      this._decayTimer = 0;
    }
  }

  _trackSelf(fighter, frameCount) {
    const state = fighter.state;
    if (state !== this._selfLastState) {
      if (state === FighterState.SIDESTEP) {
        this._selfLastSidestepFrame = frameCount;
        this._mobilityFatigue += 1.0;
      }
      if (state === FighterState.DODGE) {
        this._selfLastBackstepFrame = frameCount;
        this._mobilityFatigue += 0.75;
      }
      this._selfLastState = state;
    }

    if (this._selfWasAttacking && !fighter.fsm.isAttacking && !fighter.hitApplied) {
      this._lastWhiffFrame = frameCount;
    }
    this._selfWasAttacking = fighter.fsm.isAttacking;
  }

  _checkReactiveInterrupt(fighter, opponent) {
    if (!fighter.fsm.isActionable) return false;

    const p = this.personality;

    if (opponent.state === FighterState.ATTACK_ACTIVE && this._opponentLastState !== FighterState.ATTACK_ACTIVE) {
      return Math.random() < (p.parryRate + p.dodgeRate) * 0.5;
    }

    if (fighter.state === FighterState.PARRY_SUCCESS) {
      return Math.random() < p.counterRate;
    }

    return false;
  }

  _makeDecision(fighter, opponent, dt, frameCount) {
    if (fighter.state === FighterState.BLOCK) {
      fighter.fsm.transition(FighterState.IDLE);
      this.currentAction = null;
    }

    if (!fighter.fsm.isActionable) return;

    const dist = fighter.distanceTo(opponent);
    const p = this.personality;
    const noise = () => (Math.random() - 0.5) * p.decisionNoise;
    const engagement = this._getEngagementContext(fighter, opponent, dist);

    const edgeDist = Math.sqrt(fighter.position.x ** 2 + fighter.position.z ** 2);
    const nearEdge = edgeDist > 4.0;
    const dangerEdge = edgeDist > 6.0;

    const scores = {};

    const ranges = fighter.charDef?.aiRanges || { engage: 2.5, close: 1.8 };
    const inRange = dist < ranges.engage;
    const closeRange = dist < ranges.close;
    const offAngle = engagement.forwardDot < ATTACK_FRONT_DOT_MIN;
    const badlyFlanked = engagement.forwardDot < FLANKED_FRONT_DOT;
    const recentOwnWhiff = frameCount - this._lastWhiffFrame <= RECENT_WHIFF_FRAMES;
    const recentOpponentSidestep = frameCount - this._opponentLastSidestepFrame <= RECENT_OPPONENT_SIDESTEP_FRAMES;
    const repeatedSidestep = frameCount - this._selfLastSidestepFrame <= REPEAT_MOBILITY_FRAMES;
    const repeatedBackstep = frameCount - this._selfLastBackstepFrame <= REPEAT_MOBILITY_FRAMES;

    const opponentAttacking = opponent.fsm.isAttacking;
    const opponentRecovering = false;
    const opponentStunned = opponent.state === FighterState.HIT_STUN ||
      opponent.state === FighterState.PARRIED_STUN ||
      opponent.state === FighterState.BLOCK_STUN ||
      opponent.state === FighterState.CLASH;
    const opponentVulnerable = opponentRecovering || opponentStunned;

    if (fighter.state === FighterState.PARRY_SUCCESS) {
      if (Math.random() < p.counterRate) {
        scores.quickAttack = this._scoreAttackOpportunity(fighter, AttackType.QUICK, engagement, 2.0 + (p.quickBias || 0));
        scores.thrustAttack = this._scoreAttackOpportunity(fighter, AttackType.THRUST, engagement, 1.5 + (p.thrustBias || 0));
      }
    }

    if (opponentVulnerable && inRange) {
      if (Math.random() < p.punishRate) {
        scores.quickAttack = (scores.quickAttack || 0) +
          this._scoreAttackOpportunity(fighter, AttackType.QUICK, engagement, 1.5 + (p.quickBias || 0) + noise());
        scores.thrustAttack = (scores.thrustAttack || 0) +
          this._scoreAttackOpportunity(fighter, AttackType.THRUST, engagement, 1.0 + (p.thrustBias || 0) + noise());
      }
    }

    if (opponentVulnerable && !inRange && dist < ranges.engage + 1.5) {
      if (Math.random() < p.punishRate) {
        scores.moveForward = (scores.moveForward || 0) + 1.2 + (p.moveForwardBias || 0);
      }
    }

    if (inRange) {
      scores.quickAttack = (scores.quickAttack || 0) +
        this._scoreAttackOpportunity(fighter, AttackType.QUICK, engagement, 0.4 + p.aggression * 0.3 + (p.quickBias || 0) + noise());
      scores.thrustAttack = (scores.thrustAttack || 0) +
        this._scoreAttackOpportunity(fighter, AttackType.THRUST, engagement, 0.2 + p.aggression * 0.2 + (p.thrustBias || 0) + noise());

      const blockRatio = this._getOpponentBlockRatio();
      const heavyBonus = blockRatio * p.heavyMixup;
      scores.heavyAttack = (scores.heavyAttack || 0) +
        this._scoreAttackOpportunity(fighter, AttackType.HEAVY, engagement, 0.15 + p.aggression * 0.2 + heavyBonus + (p.heavyBias || 0) + noise());

      if (closeRange) {
        scores.quickAttack += this._scoreAttackOpportunity(fighter, AttackType.QUICK, engagement, 0.2 + (p.quickBias || 0));
      }
    }

    if (opponentAttacking) {
      scores.block = 0.5 + (p.blockBias || 0) + noise();
      scores.parry = p.parryRate + (p.parryBias || 0) + noise();
      scores.sidestep = 0.3 + p.dodgeRate * 0.5 + (p.sidestepBias || 0) + noise();

      if (!nearEdge) {
        scores.backstep = 0.15 + p.dodgeRate * 0.3 + (p.backstepBias || 0) + noise();
      }

      if (badlyFlanked) {
        scores.block *= 0.3;
        scores.parry *= 0.2;
        scores.sidestep += 0.35;
        if (!nearEdge) {
          scores.backstep = (scores.backstep || 0) + 0.25;
        }
      }
    }

    scores.sidestep = (scores.sidestep || 0) - 0.06 + (p.sidestepBias || 0) + noise();

    if (!inRange) {
      scores.moveForward = (scores.moveForward || 0) + 0.6 + p.aggression * 0.3 + (p.moveForwardBias || 0) + noise();
    }

    if (closeRange && !nearEdge && !opponentVulnerable) {
      const backoffDesire = p.spacingAwareness * 0.4;
      scores.moveBack = (scores.moveBack || 0) + backoffDesire + (p.moveBackBias || 0) + noise();
      scores.sidestep = (scores.sidestep || 0) + backoffDesire * 0.5 + (p.sidestepBias || 0) + noise();
    } else if (closeRange && !nearEdge) {
      scores.moveBack = (scores.moveBack || 0) + 0.1 + (p.moveBackBias || 0) + noise();
    }

    if (offAngle) {
      scores.sidestep = (scores.sidestep || 0) + 0.08 + p.spacingAwareness * 0.1 + (p.sidestepBias || 0);
      scores.moveForward = (scores.moveForward || 0) + 0.15 + (p.moveForwardBias || 0);
      if (closeRange && !nearEdge) {
        scores.moveBack = (scores.moveBack || 0) + 0.28 + (p.moveBackBias || 0);
      }
    }

    if (badlyFlanked) {
      scores.quickAttack = 0;
      scores.heavyAttack = 0;
      scores.thrustAttack = 0;
      scores.sidestep = (scores.sidestep || 0) + 0.05;
      scores.moveBack = (scores.moveBack || 0) + 0.35;
      scores.moveForward = (scores.moveForward || 0) + 0.15;
    }

    if (recentOpponentSidestep) {
      scores.quickAttack = (scores.quickAttack || 0) * 0.25;
      scores.heavyAttack = (scores.heavyAttack || 0) * 0.2;
      scores.thrustAttack = (scores.thrustAttack || 0) * 0.2;
      scores.sidestep = (scores.sidestep || 0) + 0.05;
      scores.moveBack = (scores.moveBack || 0) + 0.28;
      scores.moveForward = (scores.moveForward || 0) + 0.12;
      scores.backstep = (scores.backstep || 0) + 0.18;
      scores.block = (scores.block || 0) * 0.6;
    }

    if (recentOwnWhiff) {
      scores.quickAttack = (scores.quickAttack || 0) * 0.3;
      scores.heavyAttack = (scores.heavyAttack || 0) * 0.2;
      scores.thrustAttack = (scores.thrustAttack || 0) * 0.25;
      scores.sidestep = (scores.sidestep || 0) + 0.03;
      scores.moveBack = (scores.moveBack || 0) + 0.22;
      scores.moveForward = (scores.moveForward || 0) + 0.08;
      scores.idle = (scores.idle || 0) + 0.08;
    }

    if (repeatedSidestep) {
      scores.sidestep = (scores.sidestep || 0) - 0.9;
      scores.moveForward = (scores.moveForward || 0) + 0.12;
      scores.moveBack = (scores.moveBack || 0) + 0.08;
      scores.quickAttack = (scores.quickAttack || 0) + 0.06;
    }

    if (repeatedBackstep) {
      scores.backstep = (scores.backstep || 0) - 0.55;
      scores.sidestep = (scores.sidestep || 0) + 0.03;
      scores.block = (scores.block || 0) + 0.05;
    }

    if (this._mobilityFatigue > 0) {
      scores.sidestep = (scores.sidestep || 0) - this._mobilityFatigue * 0.28;
      scores.backstep = (scores.backstep || 0) - this._mobilityFatigue * 0.2;
      scores.moveForward = (scores.moveForward || 0) + this._mobilityFatigue * 0.06;
    }

    if (nearEdge) {
      scores.moveForward = (scores.moveForward || 0) + 0.4;
      scores.moveBack = 0;
      scores.backstep = 0;
    }
    if (dangerEdge) {
      scores.moveForward = (scores.moveForward || 0) + 0.6;
    }

    scores.idle = 0.1 + (p.idleBias || 0) + noise();

    let bestAction = 'idle';
    let bestScore = -Infinity;
    for (const [action, score] of Object.entries(scores)) {
      if (score > bestScore) {
        bestScore = score;
        bestAction = action;
      }
    }

    this.pendingAction = bestAction;
    this._executePending(fighter, dt);
  }

  _getOpponentBlockRatio() {
    const total = this._opponentBlockCount + this._opponentAttackCount;
    if (total < 3) return 0.3;
    return this._opponentBlockCount / total;
  }

  _getEngagementContext(fighter, opponent, dist) {
    const self = fighter.getBodyCollisionPosition();
    const other = opponent.getBodyCollisionPosition();
    const dx = other.x - self.x;
    const dz = other.z - self.z;
    const len = Math.max(Math.hypot(dx, dz), 1e-5);
    const nx = dx / len;
    const nz = dz / len;
    const forwardX = Math.sin(fighter.group.rotation.y);
    const forwardZ = Math.cos(fighter.group.rotation.y);
    return {
      dist,
      forwardDot: forwardX * nx + forwardZ * nz,
      sideDot: forwardX * nz - forwardZ * nx,
    };
  }

  _scoreAttackOpportunity(fighter, attackType, engagement, baseScore) {
    const attack = getAttackData(attackType, fighter.weaponType);
    const effectiveReach = attack.reach + attack.lunge + ATTACK_RANGE_MARGIN;
    if (engagement.dist > effectiveReach) return 0;
    if (engagement.forwardDot <= ATTACK_FRONT_DOT_MIN) return 0;

    const facingWeight = Math.min(
      1,
      Math.max(0, (engagement.forwardDot - ATTACK_FRONT_DOT_MIN) / (ATTACK_FRONT_DOT_STRONG - ATTACK_FRONT_DOT_MIN)),
    );
    const farPenalty = Math.max(0, engagement.dist - attack.reach);
    const penaltySpan = Math.max(effectiveReach * 0.35, 0.4);
    const rangeWeight = Math.max(0.35, 1 - (farPenalty / penaltySpan));
    return baseScore * facingWeight * rangeWeight;
  }

  _executePersistent(fighter, dt) {
    if (!this.currentAction || !fighter.fsm.isActionable) return;

    switch (this.currentAction) {
      case 'block':
        if (fighter.fsm.isActionable) fighter.block();
        break;
      default:
        break;
    }
  }

  _executePending(fighter, dt) {
    if (!this.pendingAction) return;
    if (!fighter.fsm.isActionable) {
      this.pendingAction = null;
      return;
    }

    const action = this.pendingAction;
    this.pendingAction = null;
    this.currentAction = action;

    switch (action) {
      case 'quickAttack':
        fighter.attack(AttackType.QUICK);
        this.currentAction = null;
        break;
      case 'heavyAttack':
        fighter.attack(AttackType.HEAVY);
        this.currentAction = null;
        break;
      case 'thrustAttack':
        fighter.attack(AttackType.THRUST);
        this.currentAction = null;
        break;
      case 'block':
        fighter.block();
        this.blockHeldFrames = 0;
        break;
      case 'parry':
        fighter.parry();
        this.currentAction = null;
        break;
      case 'sidestep':
        this.sideDir = Math.random() > 0.5 ? 1 : -1;
        fighter.sidestep(this.sideDir);
        this.currentAction = null;
        break;
      case 'backstep':
        fighter.backstep();
        this.currentAction = null;
        break;
      case 'moveForward':
        break;
      case 'moveBack':
        break;
      case 'idle':
      default:
        this.currentAction = null;
        break;
    }
  }

  _applyMovement(fighter, dt) {
    const direction = this.currentAction === 'moveForward'
      ? 1
      : (this.currentAction === 'moveBack' ? -1 : 0);
    fighter.applyMovementInput(direction, this._opponent, dt);
  }

  getDebugSnapshot() {
    return {
      profileName: this.profileName,
      baseProfileName: this.baseProfileName,
      currentAction: this.currentAction,
      pendingAction: this.pendingAction,
      reactionFrames: this.personality.reactionFrames,
      decisionNoise: this.personality.decisionNoise,
      aggression: this.personality.aggression,
      parryRate: this.personality.parryRate,
      counterRate: this.personality.counterRate,
      punishRate: this.personality.punishRate,
      blockHeldFrames: this.blockHeldFrames,
      sideDir: this.sideDir,
      opponentBlockCount: this._opponentBlockCount,
      opponentAttackCount: this._opponentAttackCount,
    };
  }

  reset() {
    this.lastDecisionFrame = 0;
    this.pendingAction = null;
    this.currentAction = null;
    this.blockHeldFrames = 0;
    this._opponent = null;
    this._opponentLastState = null;
    this._opponentBlockCount = 0;
    this._opponentAttackCount = 0;
    this._decayTimer = 0;
    this._selfLastState = null;
    this._selfWasAttacking = false;
    this._lastWhiffFrame = -9999;
    this._opponentLastSidestepFrame = -9999;
    this._selfLastSidestepFrame = -9999;
    this._selfLastBackstepFrame = -9999;
    this._mobilityFatigue = 0;
  }
}
