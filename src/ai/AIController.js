import { resolveAIPersonality } from './AIPersonality.js';
import { FighterState, AttackType } from '../core/Constants.js';
import { getAttackData } from '../combat/AttackData.js';
import { getDefensiveTimingWindow } from './TimingRead.js';
import { getArenaEdgeDistance } from '../arena/ArenaBounds.js';

const MAX_BLOCK_FRAMES = 40; // ~0.67s max block hold
const ATTACK_FRONT_DOT_MIN = 0.55;
const ATTACK_FRONT_DOT_STRONG = 0.85;
const ATTACK_RANGE_MARGIN = 0.15;
const FLANKED_FRONT_DOT = 0.35;
const RECENT_WHIFF_FRAMES = 48;
const RECENT_OPPONENT_SIDESTEP_FRAMES = 36;
const REPEAT_MOBILITY_FRAMES = 32;
const SPEARMAN_HEAVY_CONFIRM_FRAMES = 5;
const SPEARMAN_THRUST_CONFIRM_FRAMES = 3;
const SIDESTEP_PUNISH_MEMORY_FRAMES = 240;
const ACTION_SCORE_MIN = 0.02;
const ATTACK_SCORE_MIN = 0.06;
const SPEARMAN_HEAVY_SCORE_MIN = 0.2;
const AI_PARRY_PUNISH_DELAY_MIN = 2;
const AI_PARRY_PUNISH_DELAY_MAX = 5;
const PASSIVE_TARGET_FRAMES = 42;
const PASSIVE_TARGET_STRONG_FRAMES = 96;
let AI_RNG_SEQUENCE = 0;

function isOpponentActiveState(state) {
  return state === FighterState.WALK_FORWARD ||
    state === FighterState.WALK_BACK ||
    state === FighterState.BLOCK ||
    state === FighterState.BLOCK_STUN ||
    state === FighterState.PARRY ||
    state === FighterState.PARRY_SUCCESS ||
    state === FighterState.SIDESTEP ||
    state === FighterState.DODGE ||
    state === FighterState.ATTACK_ACTIVE ||
    state === FighterState.ATTACK_RECOVERY ||
    state === FighterState.HIT_STUN ||
    state === FighterState.PARRIED_STUN ||
    state === FighterState.CLASH;
}

function getFighterClassId(fighter) {
  return fighter?.charDef?.id ?? fighter?.charId ?? null;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

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
    this._opponentLastBlockFrame = -9999;
    this._decayTimer = 0;
    this._selfLastState = null;
    this._selfWasAttacking = false;
    this._lastWhiffFrame = -9999;
    this._opponentLastSidestepFrame = -9999;
    this._selfLastSidestepFrame = -9999;
    this._selfLastBackstepFrame = -9999;
    this._selfLastClashFrame = -9999;
    this._mobilityFatigue = 0;
    this._lastObservedDist = null;
    this._lastObservedSideDot = 0;
    this._opponentLastPosition = null;
    this._opponentLastMotionFrame = -9999;
    this._opponentLastActiveFrame = -9999;
    this._recentApproachFrame = -9999;
    this._recentLateralThreatFrame = -9999;
    this._sidestepPunishCount = 0;
    this._lastSidestepPunishFrame = -9999;
    this._recentAttackCommitFrame = -9999;
    this._recentAttackCommitType = null;
    this._intent = 'neutral';
    this._intentLockUntil = 0;
    this._plannedAttack = null;
    this._parryPunishReadyFrame = -9999;
    this._parryPunishDelayFrames = 0;
    this._rngState = (
      Math.floor(Math.random() * 0x100000000) ^
      hashString(String(profile)) ^
      Math.imul(++AI_RNG_SEQUENCE, 0x9e3779b9)
    ) >>> 0;
    if (this._rngState === 0) this._rngState = 0x6d2b79f5;
  }

  _random() {
    this._rngState = (Math.imul(1664525, this._rngState) + 1013904223) >>> 0;
    return this._rngState / 0x100000000;
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
    this._trackReactiveRead(fighter, opponent, frameCount);

    if (fighter.state === FighterState.PARRY_SUCCESS && frameCount < this._parryPunishReadyFrame) {
      this.currentAction = null;
      this.pendingAction = null;
      this._applyMovement(fighter, dt);
      return;
    }

    if (this._processPlannedAttack(fighter, opponent, frameCount, dt)) {
      this._applyMovement(fighter, dt);
      return;
    }

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

    const shouldInterrupt = this._checkReactiveInterrupt(fighter, opponent, this.personality);

    if (shouldInterrupt) {
      this.lastDecisionFrame = frameCount;
      this._makeDecision(fighter, opponent, dt, frameCount, this.personality);
    } else if (frameCount - this.lastDecisionFrame < this.personality.reactionFrames) {
      this._executePersistent(fighter, dt);
    } else {
      this.lastDecisionFrame = frameCount;
      this._makeDecision(fighter, opponent, dt, frameCount, this.personality);
    }

    this._applyMovement(fighter, dt);
  }

  _trackOpponent(opponent, frameCount) {
    const currentPos = { x: opponent.position.x, z: opponent.position.z };
    if (!this._opponentLastPosition) {
      this._opponentLastPosition = currentPos;
      this._opponentLastMotionFrame = frameCount;
      this._opponentLastActiveFrame = frameCount;
    }

    const dx = currentPos.x - this._opponentLastPosition.x;
    const dz = currentPos.z - this._opponentLastPosition.z;
    const moved = (dx * dx + dz * dz) >= (0.02 * 0.02);
    const state = opponent.state;
    if (moved) {
      this._opponentLastMotionFrame = frameCount;
      this._opponentLastActiveFrame = frameCount;
    }
    if (opponent.fsm.isAttacking || isOpponentActiveState(state)) {
      this._opponentLastActiveFrame = frameCount;
    }
    if (state !== this._opponentLastState) {
      if (state === FighterState.BLOCK || state === FighterState.BLOCK_STUN) {
        this._opponentBlockCount++;
        this._opponentLastBlockFrame = frameCount;
      }
      if (state === FighterState.ATTACK_ACTIVE) {
        this._opponentAttackCount++;
      }
      if (state === FighterState.SIDESTEP) {
        this._opponentLastSidestepFrame = frameCount;
      }
      this._opponentLastState = state;
    }
    this._opponentLastPosition = currentPos;

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
      if (state === FighterState.DYING) {
        const punishedBySidestep =
          frameCount - this._recentAttackCommitFrame <= 80 &&
          frameCount - this._opponentLastSidestepFrame <= 45;
        if (punishedBySidestep) {
          this._sidestepPunishCount = Math.min(3, this._sidestepPunishCount + 1);
          this._lastSidestepPunishFrame = frameCount;
        }
      }
      if (state === FighterState.SIDESTEP) {
        this._selfLastSidestepFrame = frameCount;
        this._mobilityFatigue += 1.0;
      }
      if (state === FighterState.DODGE) {
        this._selfLastBackstepFrame = frameCount;
        this._mobilityFatigue += 0.75;
      }
      if (state === FighterState.CLASH) {
        this._selfLastClashFrame = frameCount;
      }
      if (state === FighterState.PARRY_SUCCESS) {
        // The combat layer keeps PARRY_SUCCESS mostly as an explicit AI hook.
        // Human-facing punish advantage mostly comes from the opponent's
        // PARRIED_STUN, but the AI still uses this state to time ripostes.
        this._parryPunishDelayFrames =
          AI_PARRY_PUNISH_DELAY_MIN + Math.floor(this._random() * (AI_PARRY_PUNISH_DELAY_MAX - AI_PARRY_PUNISH_DELAY_MIN + 1));
        this._parryPunishReadyFrame = frameCount + this._parryPunishDelayFrames;
      }
      this._selfLastState = state;
    }

    if (this._selfWasAttacking && !fighter.fsm.isAttacking && !fighter.hitApplied) {
      this._lastWhiffFrame = frameCount;
    }
    this._selfWasAttacking = fighter.fsm.isAttacking;
  }

  _trackReactiveRead(fighter, opponent, frameCount) {
    const dist = fighter.distanceTo(opponent);
    const engagement = this._getEngagementContext(fighter, opponent, dist);
    const lastDist = this._lastObservedDist;
    const lastSideAbs = Math.abs(this._lastObservedSideDot || 0);
    const sideAbs = Math.abs(engagement.sideDot);

    if (lastDist != null) {
      const distClosing = lastDist - dist;
      const lateralGrowth = sideAbs - lastSideAbs;
      const frontalApproach =
        engagement.forwardDot >= 0.84 &&
        (opponent.state === FighterState.WALK_FORWARD || distClosing >= 0.035);
      const lateralThreat =
        opponent.state === FighterState.SIDESTEP ||
        (sideAbs >= 0.22 && lateralGrowth >= 0.035) ||
        (sideAbs >= 0.3 && distClosing >= 0);

      if (frontalApproach) this._recentApproachFrame = frameCount;
      if (lateralThreat) this._recentLateralThreatFrame = frameCount;
    }

    if (frameCount - this._lastSidestepPunishFrame > SIDESTEP_PUNISH_MEMORY_FRAMES) {
      this._sidestepPunishCount = 0;
    }

    this._lastObservedDist = dist;
    this._lastObservedSideDot = engagement.sideDot;
  }

  _checkReactiveInterrupt(fighter, opponent, p) {
    if (!fighter.fsm.isActionable) return false;

    if (opponent.state === FighterState.ATTACK_ACTIVE && this._opponentLastState !== FighterState.ATTACK_ACTIVE) {
      return this._random() < (p.parryRate + p.dodgeRate) * 0.5;
    }

    if (fighter.state === FighterState.PARRY_SUCCESS) {
      return this._random() < p.counterRate;
    }

    return false;
  }

  _processPlannedAttack(fighter, opponent, frameCount, dt) {
    if (!this._plannedAttack) return false;
    if (!fighter.fsm.isActionable) return true;

    const plan = this._plannedAttack;
    const dist = fighter.distanceTo(opponent);
    const engagement = this._getEngagementContext(fighter, opponent, dist);
    const motionRead = this._getOpponentMotionRead(frameCount);
    const passiveTarget = motionRead.passiveTarget;
    const defensiveWindow = getDefensiveTimingWindow(fighter, opponent);

    if (!this._isPlannedAttackStillValid(fighter, opponent, plan, engagement, dist, motionRead, defensiveWindow)) {
      this._plannedAttack = null;
      this._intent = 'hold_line';
      this._intentLockUntil = frameCount + 8;
      return false;
    }

    if (frameCount >= plan.confirmUntil) {
      fighter.attack(plan.attackType);
      this._recentAttackCommitFrame = frameCount;
      this._recentAttackCommitType = plan.attackType;
      this._plannedAttack = null;
    }

    return true;
  }

  _isPlannedAttackStillValid(fighter, opponent, plan, engagement, dist, motionRead, defensiveWindow) {
    const decisionReach = this._getAttackDecisionReach(fighter, plan.attackType);
    const recentLateralThreat = motionRead.recentLateralThreat;
    const stableFront = engagement.forwardDot >= (plan.attackType === AttackType.HEAVY ? 0.92 : 0.86);
    const withinReach = dist <= decisionReach - (plan.attackType === AttackType.HEAVY ? 0.06 : 0.03);

    if (!stableFront || !withinReach) return false;
    if (recentLateralThreat || opponent.state === FighterState.SIDESTEP) return false;
    if (defensiveWindow.opponentAttack.phase === 'active' && plan.attackType === AttackType.HEAVY) return false;

    if (plan.attackType === AttackType.HEAVY) {
      const heavyLegal =
        defensiveWindow.canImmediatePunish ||
        opponent.state === FighterState.BLOCK ||
        opponent.state === FighterState.BLOCK_STUN ||
        (dist < (fighter.charDef?.aiRanges?.close || 1.8) && opponent.state !== FighterState.WALK_FORWARD && opponent.state !== FighterState.WALK_BACK);
      if (!heavyLegal) return false;
    }

    return true;
  }

  _makeDecision(fighter, opponent, dt, frameCount, p) {
    if (fighter.state === FighterState.BLOCK) {
      fighter.fsm.transition(FighterState.IDLE);
      this.currentAction = null;
    }

    if (!fighter.fsm.isActionable) return;

    const dist = fighter.distanceTo(opponent);
    const noise = () => (this._random() - 0.5) * p.decisionNoise;
    const engagement = this._getEngagementContext(fighter, opponent, dist);

    const edgeRoom = getArenaEdgeDistance(fighter.position.x, fighter.position.z);
    const nearEdge = edgeRoom < 4.0;
    const dangerEdge = edgeRoom < 2.0;

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
    const recentOpponentBlock = frameCount - this._opponentLastBlockFrame <= 42;
    const recentSelfClash = frameCount - this._selfLastClashFrame <= 45;
    const heavySpecialist = (p.heavyBias || 0) >= 0.3 || p.heavyMixup >= 0.7;
    const motionRead = this._getOpponentMotionRead(frameCount);
    const passiveTarget = motionRead.passiveTarget;
    const defensiveWindow = getDefensiveTimingWindow(fighter, opponent);
    const fighterClassId = getFighterClassId(fighter);

    const opponentAttacking = opponent.fsm.isAttacking;
    const opponentRecovering = defensiveWindow.opponentAttack.phase === 'recovery' || defensiveWindow.opponentAttack.lateRecovery;
    const opponentStunned = opponent.state === FighterState.HIT_STUN ||
      opponent.state === FighterState.PARRIED_STUN ||
      opponent.state === FighterState.BLOCK_STUN ||
      opponent.state === FighterState.CLASH;
    const opponentVulnerable = opponentRecovering || opponentStunned;

    if (fighter.state === FighterState.PARRY_SUCCESS) {
      this._makeParryPunishDecision(fighter, opponent, dt, frameCount, p, engagement, dist);
      return;
    }

    const spearmanSafeHeavyWindow =
      getFighterClassId(fighter) === 'spearman' &&
      !opponentAttacking &&
      !opponentVulnerable &&
      !motionRead.recentApproach &&
      !motionRead.recentLateralThreat &&
      !motionRead.recentlyPunishedBySidestep &&
      engagement.forwardDot >= 0.97 &&
      (
        opponent.state === FighterState.IDLE ||
        opponent.state === FighterState.BLOCK ||
        opponent.state === FighterState.BLOCK_STUN
      ) &&
      dist >= 2.18 &&
      dist <= 2.38;
    const spearmanHeavyCommitAllowed =
      getFighterClassId(fighter) !== 'spearman' ||
      opponentVulnerable ||
      recentSelfClash ||
      opponent.state === FighterState.BLOCK ||
      opponent.state === FighterState.BLOCK_STUN ||
      recentOpponentBlock ||
      spearmanSafeHeavyWindow ||
      (
        closeRange &&
        engagement.forwardDot >= ATTACK_FRONT_DOT_STRONG &&
        opponent.state !== FighterState.WALK_FORWARD &&
        opponent.state !== FighterState.WALK_BACK &&
        opponent.state !== FighterState.SIDESTEP &&
        !recentOpponentSidestep &&
        !motionRead.recentLateralThreat &&
        !motionRead.recentlyPunishedBySidestep
      );

    if (fighter.state === FighterState.PARRY_SUCCESS) {
      if (this._random() < p.counterRate) {
        scores.quickAttack = this._scoreAttackOpportunity(fighter, AttackType.QUICK, engagement, 2.0 + (p.quickBias || 0));
        scores.thrustAttack = this._scoreAttackOpportunity(fighter, AttackType.THRUST, engagement, 1.5 + (p.thrustBias || 0));
      }
    }

    if (opponentVulnerable && inRange) {
      if (this._random() < p.punishRate) {
        scores.quickAttack = (scores.quickAttack || 0) +
          this._scoreAttackOpportunity(fighter, AttackType.QUICK, engagement, 1.5 + (p.quickBias || 0) + noise());
        scores.thrustAttack = (scores.thrustAttack || 0) +
          this._scoreAttackOpportunity(fighter, AttackType.THRUST, engagement, 1.0 + (p.thrustBias || 0) + noise());
        scores.heavyAttack = (scores.heavyAttack || 0) +
          this._scoreAttackOpportunity(fighter, AttackType.HEAVY, engagement, 0.9 + (p.heavyBias || 0) + noise());
      }
    }

    if (opponentVulnerable && !inRange && dist < ranges.engage + 1.5) {
      if (this._random() < p.punishRate) {
        scores.moveForward = (scores.moveForward || 0) + 1.2 + (p.moveForwardBias || 0);
      }
    }

    const quickDecisionReach = this._getAttackDecisionReach(fighter, AttackType.QUICK);
    const heavyDecisionReach = this._getAttackDecisionReach(fighter, AttackType.HEAVY);
    const thrustDecisionReach = this._getAttackDecisionReach(fighter, AttackType.THRUST);
    const anyAttackReady = dist <= Math.max(quickDecisionReach, heavyDecisionReach, thrustDecisionReach);
    const spearmanApproachLaneThreat =
      getFighterClassId(fighter) === 'spearman' &&
      !opponentAttacking &&
      !opponentVulnerable &&
      !nearEdge &&
      engagement.forwardDot >= 0.88 &&
      opponent.state === FighterState.WALK_FORWARD &&
      dist >= quickDecisionReach + 0.12 &&
      dist <= thrustDecisionReach + 0.12;
    const spearmanMobileApproachBand =
      getFighterClassId(fighter) === 'spearman' &&
      !opponentAttacking &&
      !opponentVulnerable &&
      !nearEdge &&
      engagement.forwardDot >= 0.82 &&
      (
        opponent.state === FighterState.WALK_FORWARD ||
        opponent.state === FighterState.WALK_BACK ||
        opponent.state === FighterState.SIDESTEP
      ) &&
      dist > quickDecisionReach + 0.04 &&
      dist <= thrustDecisionReach + 0.18;
    const spearmanNoCommitStepBand =
      getFighterClassId(fighter) === 'spearman' &&
      !opponentAttacking &&
      !opponentVulnerable &&
      !nearEdge &&
      engagement.forwardDot >= 0.78 &&
      (
        opponent.state === FighterState.WALK_FORWARD ||
        opponent.state === FighterState.WALK_BACK ||
        opponent.state === FighterState.SIDESTEP ||
        recentOpponentSidestep
      ) &&
      dist > quickDecisionReach - 0.06 &&
      dist <= Math.max(heavyDecisionReach, thrustDecisionReach) + 0.12;

    if (inRange) {
      scores.quickAttack = (scores.quickAttack || 0) +
        this._scoreAttackOpportunity(fighter, AttackType.QUICK, engagement, 0.4 + p.aggression * 0.3 + (p.quickBias || 0) + noise());
      scores.thrustAttack = (scores.thrustAttack || 0) +
        this._scoreAttackOpportunity(fighter, AttackType.THRUST, engagement, 0.2 + p.aggression * 0.2 + (p.thrustBias || 0) + noise());

      if (spearmanHeavyCommitAllowed) {
        const blockRatio = this._getOpponentBlockRatio();
        const heavyBonus = blockRatio * p.heavyMixup;
        const heavyContextBonus =
          (opponentVulnerable ? 0.35 : 0) +
          (recentSelfClash ? 0.45 : 0) +
          ((opponent.state === FighterState.BLOCK || opponent.state === FighterState.BLOCK_STUN || recentOpponentBlock) ? 0.28 : 0) +
          (heavySpecialist ? 0.18 : 0);
        scores.heavyAttack = (scores.heavyAttack || 0) +
          this._scoreAttackOpportunity(
            fighter,
            AttackType.HEAVY,
            engagement,
            0.15 + p.aggression * 0.2 + heavyBonus + heavyContextBonus + (p.heavyBias || 0) + noise(),
          );
      } else if (getFighterClassId(fighter) === 'spearman') {
        scores.block = (scores.block || 0) + 0.1;
        scores.moveForward = (scores.moveForward || 0) + 0.12;
        scores.idle = (scores.idle || 0) + 0.08;
      }

      if (closeRange) {
        scores.quickAttack += this._scoreAttackOpportunity(fighter, AttackType.QUICK, engagement, 0.2 + (p.quickBias || 0));
      }
    }

    if (!anyAttackReady && dist <= (ranges.engage + 0.15) && !opponentVulnerable) {
      scores.moveForward = (scores.moveForward || 0) + (getFighterClassId(fighter) === 'spearman' ? 0.52 : 0.16);
      scores.idle = (scores.idle || 0) + (getFighterClassId(fighter) === 'spearman' ? 0.08 : 0.02);
      if (getFighterClassId(fighter) === 'spearman') {
        scores.block = (scores.block || 0) + 0.1;
        scores.quickAttack = (scores.quickAttack || 0) * 0.15;
        scores.heavyAttack = (scores.heavyAttack || 0) * 0.08;
        scores.thrustAttack = (scores.thrustAttack || 0) * 0.2;
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

    if (defensiveWindow.shouldDefendNow) {
      scores.block = (scores.block || 0) + 0.32;
      scores.parry = (scores.parry || 0) + 0.18;
      scores.quickAttack = (scores.quickAttack || 0) * 0.4;
      scores.heavyAttack = (scores.heavyAttack || 0) * 0.1;
      scores.thrustAttack = (scores.thrustAttack || 0) * 0.2;
    } else if (defensiveWindow.shouldPreemptMovement) {
      scores.sidestep = (scores.sidestep || 0) + 0.16;
      scores.block = (scores.block || 0) + 0.08;
    }

    scores.sidestep = (scores.sidestep || 0) - 0.06 + (p.sidestepBias || 0) + noise();

    if (!inRange) {
      scores.moveForward = (scores.moveForward || 0) + 0.6 + p.aggression * 0.3 + (p.moveForwardBias || 0) + noise();
      if (heavySpecialist && dist < ranges.engage + 0.9) {
        scores.moveForward += 0.2;
      }
    }

    if (passiveTarget && !opponentAttacking && !opponentVulnerable) {
      const passiveBoost = motionRead.strongPassiveTarget ? 0.42 : 0.24;
      scores.block = (scores.block || 0) - (0.36 + passiveBoost * 0.2);
      scores.sidestep = (scores.sidestep || 0) - (0.24 + passiveBoost * 0.15);
      scores.backstep = (scores.backstep || 0) - (0.34 + passiveBoost * 0.2);
      scores.moveBack = (scores.moveBack || 0) - (0.28 + passiveBoost * 0.2);
      scores.idle = (scores.idle || 0) - (0.2 + passiveBoost * 0.15);

      if (dist > Math.min(quickDecisionReach, thrustDecisionReach) + 0.03) {
        scores.moveForward = (scores.moveForward || 0) + 0.5 + passiveBoost;
      }

      if (engagement.forwardDot >= 0.9) {
        if (dist <= quickDecisionReach + 0.02) {
          scores.quickAttack = (scores.quickAttack || 0) + 0.22 + passiveBoost * 0.2;
        }
        if (dist <= thrustDecisionReach + 0.04) {
          scores.thrustAttack = (scores.thrustAttack || 0) + 0.26 + passiveBoost * 0.24;
        }
        if (dist <= heavyDecisionReach && engagement.forwardDot >= 0.94) {
          scores.heavyAttack = (scores.heavyAttack || 0) + 0.16 + passiveBoost * 0.16;
        }
      }
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

    if (fighterClassId === 'huscarl') {
      const committedAngle = engagement.forwardDot >= 0.72;
      const axeReady = committedAngle && dist <= Math.max(quickDecisionReach, thrustDecisionReach) + 0.03;
      const pressureBand = committedAngle && dist <= ranges.engage + 0.25;
      const opponentGuarding =
        opponent.state === FighterState.PARRY ||
        opponent.state === FighterState.PARRY_SUCCESS ||
        opponent.state === FighterState.BLOCK ||
        opponent.state === FighterState.BLOCK_STUN;

      if (pressureBand && !opponentAttacking && !opponentVulnerable) {
        scores.moveBack = (scores.moveBack || 0) * 0.25 - 0.12;
        scores.backstep = (scores.backstep || 0) * 0.25 - 0.18;
        scores.sidestep = (scores.sidestep || 0) * 0.55;
        scores.idle = (scores.idle || 0) - 0.16;

        if (dist > Math.min(quickDecisionReach, thrustDecisionReach) - 0.08) {
          scores.moveForward = (scores.moveForward || 0) + 0.42 + (p.moveForwardBias || 0);
        }
      }

      if (axeReady && !defensiveWindow.shouldDefendNow) {
        const quickPressure = opponentGuarding ? 0.18 : 0.72;
        const thrustPressure = opponentGuarding ? 0.16 : 0.48;
        scores.quickAttack = (scores.quickAttack || 0) +
          this._scoreAttackOpportunity(fighter, AttackType.QUICK, engagement, quickPressure + (p.quickBias || 0));
        scores.thrustAttack = (scores.thrustAttack || 0) +
          this._scoreAttackOpportunity(fighter, AttackType.THRUST, engagement, thrustPressure + (p.thrustBias || 0));

        if (opponent.state === FighterState.BLOCK || opponent.state === FighterState.BLOCK_STUN || recentSelfClash) {
          scores.heavyAttack = (scores.heavyAttack || 0) +
            this._scoreAttackOpportunity(fighter, AttackType.HEAVY, engagement, 0.68 + (p.heavyBias || 0));
        } else if (opponentGuarding) {
          scores.moveForward = (scores.moveForward || 0) + 0.18;
          scores.idle = (scores.idle || 0) + 0.1;
        }
      }

      if (recentOpponentSidestep && dist <= quickDecisionReach + 0.1 && committedAngle) {
        scores.quickAttack = (scores.quickAttack || 0) + 0.24;
        scores.moveForward = (scores.moveForward || 0) + 0.22;
      }
    }

    if (getFighterClassId(fighter) === 'spearman' && inRange && engagement.forwardDot >= 0.72 && !nearEdge && recentOpponentSidestep) {
      scores.quickAttack = (scores.quickAttack || 0) * 0.12;
      scores.heavyAttack = (scores.heavyAttack || 0) * 0.06;
      scores.thrustAttack = (scores.thrustAttack || 0) * 0.18;
      scores.block = (scores.block || 0) + 0.22;
      scores.moveForward = (scores.moveForward || 0) + 0.3;
      scores.idle = (scores.idle || 0) + 0.14;
      scores.sidestep = (scores.sidestep || 0) - 0.28;
      scores.backstep = (scores.backstep || 0) - 0.14;
    }

    if (spearmanApproachLaneThreat) {
      scores.thrustAttack = (scores.thrustAttack || 0) * 0.08;
      scores.heavyAttack = (scores.heavyAttack || 0) * 0.4;
      scores.quickAttack = dist <= quickDecisionReach ? (scores.quickAttack || 0) * 0.85 : (scores.quickAttack || 0) * 0.2;
      scores.block = (scores.block || 0) + 0.16;
      scores.moveForward = (scores.moveForward || 0) + 0.26;
      scores.idle = (scores.idle || 0) + 0.18;
      scores.sidestep = (scores.sidestep || 0) - 0.12;
      scores.backstep = (scores.backstep || 0) - 0.08;
    }

    if (spearmanMobileApproachBand) {
      scores.quickAttack = (scores.quickAttack || 0) * 0.08;
      scores.heavyAttack = (scores.heavyAttack || 0) * 0.16;
      scores.thrustAttack = (scores.thrustAttack || 0) * 0.03;
      scores.block = (scores.block || 0) + 0.24;
      scores.moveForward = (scores.moveForward || 0) + 0.34;
      scores.idle = (scores.idle || 0) + 0.24;
      scores.sidestep = (scores.sidestep || 0) - 0.18;
      scores.backstep = (scores.backstep || 0) - 0.12;
    }

    if (spearmanNoCommitStepBand) {
      scores.quickAttack = 0;
      scores.heavyAttack = 0;
      scores.thrustAttack = 0;
      scores.block = (scores.block || 0) + 0.32;
      scores.moveForward = (scores.moveForward || 0) + 0.42;
      scores.idle = (scores.idle || 0) + 0.28;
      scores.moveBack = (scores.moveBack || 0) + 0.06;
      scores.sidestep = (scores.sidestep || 0) - 0.24;
      scores.backstep = (scores.backstep || 0) - 0.16;
    }

    if (getFighterClassId(fighter) === 'spearman' && !spearmanHeavyCommitAllowed && !opponentAttacking) {
      scores.heavyAttack = 0;
    }

    if (getFighterClassId(fighter) === 'spearman') {
      const intent = this._selectSpearmanIntent(
        fighter,
        opponent,
        frameCount,
        engagement,
        dist,
        motionRead,
        defensiveWindow,
        opponentVulnerable,
        closeRange,
        nearEdge,
      );
      switch (intent) {
        case 'hold_line':
          scores.heavyAttack = 0;
          scores.thrustAttack = (scores.thrustAttack || 0) * 0.45;
          scores.quickAttack = closeRange ? (scores.quickAttack || 0) * 0.75 : 0;
          scores.block = (scores.block || 0) + 0.22;
          scores.moveForward = (scores.moveForward || 0) + 0.28;
          scores.idle = (scores.idle || 0) + 0.16;
          break;
        case 'intercept':
          scores.heavyAttack = spearmanSafeHeavyWindow ? (scores.heavyAttack || 0) * 0.5 : 0;
          scores.thrustAttack = (scores.thrustAttack || 0) + 0.28;
          scores.quickAttack = (scores.quickAttack || 0) + (closeRange ? 0.14 : 0.02);
          scores.block = (scores.block || 0) + 0.08;
          break;
        case 'punish':
          scores.quickAttack = (scores.quickAttack || 0) + 0.2;
          scores.thrustAttack = (scores.thrustAttack || 0) + 0.12;
          scores.heavyAttack = (scores.heavyAttack || 0) + 0.18;
          break;
        case 'pressure':
          scores.quickAttack = (scores.quickAttack || 0) + 0.08;
          scores.heavyAttack = spearmanHeavyCommitAllowed ? (scores.heavyAttack || 0) + 0.1 : 0;
          break;
        case 'reset':
          scores.quickAttack = 0;
          scores.heavyAttack = 0;
          scores.thrustAttack = 0;
          scores.moveForward = (scores.moveForward || 0) + 0.18;
          scores.moveBack = (scores.moveBack || 0) + 0.22;
          scores.block = (scores.block || 0) + 0.18;
          break;
        default:
          break;
      }
    }

    if (recentOwnWhiff) {
      scores.quickAttack = (scores.quickAttack || 0) * 0.3;
      scores.heavyAttack = (scores.heavyAttack || 0) * (heavySpecialist ? 0.45 : 0.2);
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

    const bestAction = this._pickAction(scores, fighter, p);
    this.pendingAction = bestAction;
    this._executePending(fighter, dt);
  }

  _makeParryPunishDecision(fighter, opponent, dt, frameCount, p, engagement, dist) {
    const quickDecisionReach = this._getAttackDecisionReach(fighter, AttackType.QUICK);
    const heavyDecisionReach = this._getAttackDecisionReach(fighter, AttackType.HEAVY);
    const thrustDecisionReach = this._getAttackDecisionReach(fighter, AttackType.THRUST);
    const remainingParryFrames = Math.max(0, (fighter.fsm.stateDuration || 0) - fighter.stateFrames);
    const strongFront = engagement.forwardDot >= 0.94;
    const perfectFront = engagement.forwardDot >= 0.975;
    const cleanClose = dist <= quickDecisionReach + 0.02;
    const cleanMid = dist <= thrustDecisionReach - 0.04;
    const heavyConfirmed =
      perfectFront &&
      dist <= heavyDecisionReach - 0.08 &&
      remainingParryFrames >= 11 &&
      opponent.state !== FighterState.SIDESTEP &&
      opponent.state !== FighterState.WALK_BACK;

    const scores = {};
    if (cleanClose) {
      scores.quickAttack =
        this._scoreAttackOpportunity(fighter, AttackType.QUICK, engagement, 2.1 + (p.quickBias || 0));
    }
    if (cleanMid) {
      scores.thrustAttack =
        this._scoreAttackOpportunity(fighter, AttackType.THRUST, engagement, 1.7 + (p.thrustBias || 0));
    }
    if (heavyConfirmed) {
      scores.heavyAttack =
        this._scoreAttackOpportunity(fighter, AttackType.HEAVY, engagement, 0.95 + (p.heavyBias || 0));
    }

    if (!cleanClose && dist <= thrustDecisionReach + 0.2) {
      scores.moveForward = 0.55 + (p.moveForwardBias || 0);
    }

    const bestAction = this._pickAction(scores, fighter, p);
    this.pendingAction = bestAction;
    this._executePending(fighter, dt);
  }

  _getOpponentBlockRatio() {
    const total = this._opponentBlockCount + this._opponentAttackCount;
    if (total < 3) return 0.3;
    return this._opponentBlockCount / total;
  }

  _getOpponentMotionRead(frameCount) {
    const passiveFrames = frameCount - this._opponentLastActiveFrame;
    return {
      recentApproach: frameCount - this._recentApproachFrame <= 18,
      recentLateralThreat: frameCount - this._recentLateralThreatFrame <= 22,
      sidestepPunishCount: this._sidestepPunishCount,
      recentlyPunishedBySidestep: frameCount - this._lastSidestepPunishFrame <= SIDESTEP_PUNISH_MEMORY_FRAMES,
      passiveTarget: passiveFrames >= PASSIVE_TARGET_FRAMES,
      strongPassiveTarget: passiveFrames >= PASSIVE_TARGET_STRONG_FRAMES,
      passiveFrames,
    };
  }

  _selectSpearmanIntent(fighter, opponent, frameCount, engagement, dist, motionRead, defensiveWindow, opponentVulnerable, closeRange, nearEdge) {
    if (frameCount < this._intentLockUntil && this._intent && this._intent !== 'neutral') {
      return this._intent;
    }

    let nextIntent = 'hold_line';

    if (nearEdge || engagement.forwardDot < ATTACK_FRONT_DOT_MIN) {
      nextIntent = 'reset';
    } else if (opponentVulnerable || defensiveWindow.canImmediatePunish) {
      nextIntent = 'punish';
    } else if (defensiveWindow.shouldDefendNow || motionRead.recentLateralThreat || motionRead.recentlyPunishedBySidestep) {
      nextIntent = 'hold_line';
    } else if (opponent.state === FighterState.BLOCK || opponent.state === FighterState.BLOCK_STUN) {
      nextIntent = closeRange ? 'pressure' : 'hold_line';
    } else if (motionRead.recentApproach && engagement.forwardDot >= 0.9 && dist <= this._getAttackDecisionReach(fighter, AttackType.THRUST) - 0.04) {
      nextIntent = 'intercept';
    } else if (closeRange && engagement.forwardDot >= ATTACK_FRONT_DOT_STRONG) {
      nextIntent = 'pressure';
    }

    this._intent = nextIntent;
    this._intentLockUntil = frameCount + (nextIntent === 'punish' ? 8 : 6);
    return nextIntent;
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

  _getAttackOverreachAllowance(fighter, attackType, attack) {
    if (getFighterClassId(fighter) === 'spearman') {
      switch (attackType) {
        case AttackType.QUICK:
          return 0;
        case AttackType.HEAVY:
          return 0;
        case AttackType.THRUST:
          return 0.04;
        default:
          return 0;
      }
    }

    return ATTACK_RANGE_MARGIN + Math.min(Math.max(attack.lunge || 0, 0) * 0.35, 0.18);
  }

  _getAttackDecisionReach(fighter, attackType) {
    const attack = getAttackData(attackType, fighter.charDef);
    let decisionReach = attack.aiRange + this._getAttackOverreachAllowance(fighter, attackType, attack);

    if (getFighterClassId(fighter) === 'spearman') {
      switch (attackType) {
        case AttackType.QUICK:
          decisionReach = attack.aiRange - 0.42;
          break;
        case AttackType.HEAVY:
          decisionReach = attack.aiRange - 0.5;
          break;
        case AttackType.THRUST:
          decisionReach = attack.aiRange - 0.56;
          break;
        default:
          break;
      }
      decisionReach = Math.max(attack.aiRange * 0.62, decisionReach);
    }

    return decisionReach;
  }

  _scoreAttackOpportunity(fighter, attackType, engagement, baseScore) {
    const attack = getAttackData(attackType, fighter.charDef);
    const decisionReach = this._getAttackDecisionReach(fighter, attackType);
    if (engagement.dist > decisionReach) return 0;
    if (engagement.forwardDot <= ATTACK_FRONT_DOT_MIN) return 0;

    const facingWeight = Math.min(
      1,
      Math.max(0, (engagement.forwardDot - ATTACK_FRONT_DOT_MIN) / (ATTACK_FRONT_DOT_STRONG - ATTACK_FRONT_DOT_MIN)),
    );
    const farPenalty = Math.max(0, engagement.dist - decisionReach);
    const penaltySpan = Math.max(this._getAttackOverreachAllowance(fighter, attackType, attack), 0.08);
    const minRangeWeight = getFighterClassId(fighter) === 'spearman' ? 0 : 0.35;
    const rangeWeight = Math.max(minRangeWeight, 1 - (farPenalty / penaltySpan));
    return baseScore * facingWeight * rangeWeight;
  }

  _pickAction(scores, fighter, p) {
    const entries = Object.entries(scores)
      .filter(([action, score]) => {
        if (!Number.isFinite(score)) return false;
        if (this._isAttackAction(action)) {
          if (getFighterClassId(fighter) === 'spearman' && action === 'heavyAttack') return score >= SPEARMAN_HEAVY_SCORE_MIN;
          return score >= ATTACK_SCORE_MIN;
        }
        return score >= ACTION_SCORE_MIN;
      })
      .sort((a, b) => b[1] - a[1]);

    if (!entries.length) return 'idle';
    if (getFighterClassId(fighter) !== 'spearman') return entries[0][0];

    const bestScore = entries[0][1];
    const candidates = entries.filter(([, score]) => score >= bestScore - 0.12).slice(0, 3);
    if (candidates.length === 1) return candidates[0][0];

    const weights = candidates.map(([, score]) => Math.max(0.01, score - (bestScore - 0.12) + 0.02));
    const total = weights.reduce((sum, value) => sum + value, 0);
    let roll = this._random() * total;
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return candidates[i][0];
    }
    return candidates[0][0];
  }

  _isAttackAction(action) {
    return action === 'quickAttack' || action === 'heavyAttack' || action === 'thrustAttack';
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
        this._recentAttackCommitFrame = fighter?.match?.frameCount || this.lastDecisionFrame;
        this._recentAttackCommitType = AttackType.QUICK;
        this.currentAction = null;
        break;
      case 'heavyAttack':
        if (getFighterClassId(fighter) === 'spearman') {
          this._plannedAttack = {
            action,
            attackType: AttackType.HEAVY,
            confirmUntil: this.lastDecisionFrame + SPEARMAN_HEAVY_CONFIRM_FRAMES,
          };
          this.currentAction = null;
          break;
        }
        fighter.attack(AttackType.HEAVY);
        this._recentAttackCommitFrame = fighter?.match?.frameCount || this.lastDecisionFrame;
        this._recentAttackCommitType = AttackType.HEAVY;
        this.currentAction = null;
        break;
      case 'thrustAttack':
        if (getFighterClassId(fighter) === 'spearman') {
          this._plannedAttack = {
            action,
            attackType: AttackType.THRUST,
            confirmUntil: this.lastDecisionFrame + SPEARMAN_THRUST_CONFIRM_FRAMES,
          };
          this.currentAction = null;
          break;
        }
        fighter.attack(AttackType.THRUST);
        this._recentAttackCommitFrame = fighter?.match?.frameCount || this.lastDecisionFrame;
        this._recentAttackCommitType = AttackType.THRUST;
        this.currentAction = null;
        break;
      case 'block':
        fighter.guard();
        this.blockHeldFrames = 0;
        break;
      case 'parry':
        fighter.parry();
        this.currentAction = null;
        break;
      case 'sidestep':
        this.sideDir = this._random() > 0.5 ? 1 : -1;
        fighter.sidestep(this.sideDir);
        this.currentAction = null;
        break;
      case 'sidestepUp':
        this.sideDir = -1;
        fighter.sidestep(this.sideDir);
        this.currentAction = null;
        break;
      case 'sidestepDown':
        this.sideDir = 1;
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
      intent: this._intent,
      intentLockUntil: this._intentLockUntil,
      plannedAttack: this._plannedAttack,
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
      sidestepPunishCount: this._sidestepPunishCount,
      recentApproachFrame: this._recentApproachFrame,
      recentLateralThreatFrame: this._recentLateralThreatFrame,
      opponentLastActiveFrame: this._opponentLastActiveFrame,
      parryPunishReadyFrame: this._parryPunishReadyFrame,
      parryPunishDelayFrames: this._parryPunishDelayFrames,
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
    this._opponentLastBlockFrame = -9999;
    this._decayTimer = 0;
    this._selfLastState = null;
    this._selfWasAttacking = false;
    this._lastWhiffFrame = -9999;
    this._opponentLastSidestepFrame = -9999;
    this._selfLastSidestepFrame = -9999;
    this._selfLastBackstepFrame = -9999;
    this._selfLastClashFrame = -9999;
    this._mobilityFatigue = 0;
    this._lastObservedDist = null;
    this._lastObservedSideDot = 0;
    this._opponentLastPosition = null;
    this._opponentLastMotionFrame = -9999;
    this._opponentLastActiveFrame = -9999;
    this._recentApproachFrame = -9999;
    this._recentLateralThreatFrame = -9999;
    this._sidestepPunishCount = 0;
    this._lastSidestepPunishFrame = -9999;
    this._recentAttackCommitFrame = -9999;
    this._recentAttackCommitType = null;
    this._intent = 'neutral';
    this._intentLockUntil = 0;
    this._plannedAttack = null;
    this._parryPunishReadyFrame = -9999;
    this._parryPunishDelayFrames = 0;
  }
}

