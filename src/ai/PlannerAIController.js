import { AIController } from './AIController.js';
import { FighterSim } from '../sim/FighterSim.js';
import { MatchSim } from '../sim/MatchSim.js';
import { createEmptyInputFrame } from '../sim/InputFrame.js';
import { FRAME_DURATION, FighterState, AttackType, HitResult } from '../core/Constants.js';
import { getAttackData } from '../combat/AttackData.js';
import { getArenaEdgeDistance } from '../arena/ArenaBounds.js';

const PLANNER_HORIZON_FRAMES = 28;
const ACTION_CANDIDATES = Object.freeze([
  'idle',
  'moveForward',
  'moveBack',
  'block',
  'sidestepUp',
  'sidestepDown',
  'backstep',
  'quickAttack',
  'thrustAttack',
  'heavyAttack',
]);

function getFighterClassId(fighter) {
  return fighter?.charDef?.id ?? fighter?.charId ?? null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeWeights(entries) {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) {
    const uniform = 1 / Math.max(entries.length, 1);
    return entries.map((entry) => ({ ...entry, weight: uniform }));
  }
  return entries.map((entry) => ({ ...entry, weight: entry.weight / total }));
}

function isSidestepAction(action) {
  return action === 'sidestepUp' || action === 'sidestepDown';
}

function isHeavyOrThrustAction(action) {
  return action === 'heavyAttack' || action === 'thrustAttack';
}

function getWorldSidestepLocalDirection(fighter, action) {
  const wantsWorldUp = action === 'sidestepUp';
  const facingSin = Math.sin(fighter.group.rotation.y);
  const localDirForWorldUp = facingSin >= 0 ? -1 : 1;
  return wantsWorldUp ? localDirForWorldUp : -localDirForWorldUp;
}

function pressSidestepInput(input, localDirection) {
  if (localDirection < 0) input.pressed.sidestepUp = true;
  else input.pressed.sidestepDown = true;
}

export class PlannerAIController extends AIController {
  constructor(profile = 'medium') {
    super(profile);
    this.controllerKind = 'planner';
    this.lastChosenAction = null;
    this._plannerDecisionSeq = 0;
    this._plannerRecentActions = [];
    this._plannerBundle = null;
    this._plannerDebug = {
      decisionSeq: 0,
      frameCount: 0,
      lastChosenAction: null,
      lastCandidates: [],
      lastResponses: [],
    };
  }

  _makeDecision(fighter, opponent, dt, frameCount, p) {
    const classId = getFighterClassId(fighter);
    const canPlan =
      (classId === 'spearman' || classId === 'ronin' || classId === 'knight' || classId === 'huscarl') &&
      fighter?.fsm?.isActionable &&
      fighter.state !== FighterState.PARRY_SUCCESS;

    if (!canPlan) {
      this._plannerDebug = {
        ...this._plannerDebug,
        frameCount,
      };
      super._makeDecision(fighter, opponent, dt, frameCount, p);
      return;
    }

    if (fighter.state === FighterState.BLOCK) {
      fighter.fsm.transition(FighterState.IDLE);
      this.currentAction = null;
    }

    const dist = fighter.distanceTo(opponent);
    const motionRead = this._getOpponentMotionRead(frameCount);
    const planningContext = this._buildPlanningContext(fighter, opponent, dist, motionRead);
    const responses = this._buildLikelyResponses(fighter, opponent, dist, motionRead);
    const candidateActions = this._buildCandidateActions(fighter, opponent, planningContext);

    const scored = candidateActions.map((action) => {
      const rolloutScores = responses.map((response) => ({
        response: response.action,
        weight: response.weight,
        score: this._evaluateActionAgainstResponse(fighter, opponent, frameCount, action, response.action),
      }));
      const weightedAverage = rolloutScores.reduce((sum, entry) => sum + (entry.score * entry.weight), 0);
      const worst = rolloutScores.reduce((min, entry) => Math.min(min, entry.score), Infinity);
      const robustScore =
        (0.6 * worst) +
        (0.4 * weightedAverage) -
        this._getPlannerRepeatPenalty(action) +
        this._getActionPriorBias(classId, action, planningContext);
      return {
        action,
        robustScore,
        worst,
        weightedAverage,
        rolloutScores,
      };
    }).sort((a, b) => b.robustScore - a.robustScore);

    const best = this._choosePlannerAction(scored) ?? { action: 'idle', robustScore: 0 };
    this._plannerDecisionSeq += 1;
    this._plannerDebug = {
      decisionSeq: this._plannerDecisionSeq,
      frameCount,
      lastChosenAction: best.action,
      lastCandidates: scored.slice(0, 4).map((entry) => ({
        action: entry.action,
        robustScore: Number(entry.robustScore.toFixed(3)),
        worst: Number(entry.worst.toFixed(3)),
        weightedAverage: Number(entry.weightedAverage.toFixed(3)),
      })),
      lastResponses: scored[0]?.rolloutScores?.map((entry) => ({
        response: entry.response,
        weight: Number(entry.weight.toFixed(3)),
        score: Number(entry.score.toFixed(3)),
      })) ?? [],
    };
    this.lastChosenAction = best.action;
    this._plannerRecentActions.push(best.action);
    if (this._plannerRecentActions.length > 8) this._plannerRecentActions.shift();

    this.pendingAction = best.action;
    this._executePending(fighter, dt);
  }

  _buildPlanningContext(fighter, opponent, dist, motionRead) {
    const closeRange = dist <= (fighter.charDef?.aiRanges?.close ?? 2.5);
    const engageRange = dist <= (fighter.charDef?.aiRanges?.engage ?? 3.0);
    const edgeDistance = getArenaEdgeDistance(fighter.position.x, fighter.position.z);
    const opponentClassId = getFighterClassId(opponent);
    const blocking = opponent.state === FighterState.BLOCK || opponent.state === FighterState.BLOCK_STUN;
    const recentBlock = (this._opponentLastBlockFrame ?? -9999) > -9999 && ((this.lastDecisionFrame - this._opponentLastBlockFrame) <= 36);
    const blockRatio = this._getOpponentBlockRatio?.() ?? 0.3;
    const vulnerable =
      opponent.state === FighterState.HIT_STUN ||
      opponent.state === FighterState.PARRIED_STUN ||
      opponent.state === FighterState.CLASH;
    const recentClash = !motionRead.recentlyPunishedBySidestep && (this._selfLastClashFrame > -9999);
    const stableLane = !motionRead.recentApproach && !motionRead.recentLateralThreat;
    const defensiveNeed =
      opponent.fsm.isAttacking ||
      blocking ||
      vulnerable ||
      dist <= 2.15;
    const passiveTarget = motionRead.passiveTarget && !blocking && !vulnerable && !opponent.fsm.isAttacking;
    return {
      dist,
      closeRange,
      engageRange,
      edgeDistance,
      opponentClassId,
      blocking,
      recentBlock,
      blockRatio,
      vulnerable,
      recentClash,
      stableLane,
      defensiveNeed,
      passiveTarget,
      motionRead,
    };
  }

  _getPlannerRepeatPenalty(action) {
    let streak = 0;
    for (let i = this._plannerRecentActions.length - 1; i >= 0; i--) {
      if (this._plannerRecentActions[i] !== action) break;
      streak++;
    }
    if (streak <= 0) return 0;
    if (action === 'block') return streak * 0.42;
    if (action === 'idle') return streak * 0.28;
    if (action === 'moveForward') return streak * 0.08;
    return streak * 0.12;
  }

  _choosePlannerAction(scored) {
    if (!Array.isArray(scored) || scored.length === 0) return null;
    const topScore = scored[0].robustScore;
    const viable = scored.filter((entry) => entry.robustScore >= topScore - 0.5).slice(0, 4);
    if (viable.length === 1) return viable[0];

    const weighted = viable.map((entry, index) => {
      const novelty =
        this._plannerRecentActions[this._plannerRecentActions.length - 1] === entry.action
          ? 0.72
          : 1;
      const rankBias = Math.max(0.18, 1 - (index * 0.14));
      const weight = Math.max(0.05, (entry.robustScore - (topScore - 0.6)) + 0.1) * novelty * rankBias;
      return { entry, weight };
    });
    const total = weighted.reduce((sum, item) => sum + item.weight, 0);
    let roll = this._random() * total;
    for (const item of weighted) {
      roll -= item.weight;
      if (roll <= 0) return item.entry;
    }
    return weighted[0].entry;
  }

  _buildCandidateActions(fighter, opponent, context) {
    const classId = getFighterClassId(fighter);
    const actions = new Set(ACTION_CANDIDATES);

    this._applyGenericCandidateFilters(actions, fighter, opponent, context);
    if (classId === 'knight') {
      this._applyKnightCandidateFilters(actions, opponent, context);
    } else if (classId === 'ronin') {
      this._applyRoninCandidateFilters(actions, opponent, context);
    } else if (classId === 'spearman') {
      this._applySpearmanCandidateFilters(actions, opponent, context);
    } else if (classId === 'huscarl') {
      this._applyHuscarlCandidateFilters(actions, opponent, context);
    }
    this._applyPassiveTargetCandidateFilters(actions, context);

    return [...actions];
  }

  _applyGenericCandidateFilters(actions, fighter, opponent, context) {
    const { dist, edgeDistance, opponentClassId, blocking, vulnerable, recentClash, defensiveNeed } = context;

    if (edgeDistance < 1.4 && !defensiveNeed) {
      actions.delete('backstep');
    }

    if (dist > 2.8 && !vulnerable && !blocking && !recentClash) {
      actions.delete('quickAttack');
    }

    if (dist > 3.05 && !vulnerable && !blocking && !opponent.fsm.isAttacking) {
      actions.delete('thrustAttack');
    }

    if (dist > 2.85 && !vulnerable && !blocking && !recentClash) {
      actions.delete('heavyAttack');
    }

    if (
      opponentClassId === 'huscarl' &&
      dist <= 2.1 &&
      !opponent.fsm.isAttacking &&
      !vulnerable &&
      !blocking &&
      !recentClash
    ) {
      actions.delete('sidestepUp');
      actions.delete('sidestepDown');
    }
  }

  _applyKnightCandidateFilters(actions, opponent, context) {
    const { dist, opponentClassId, blocking, vulnerable, recentClash, stableLane, defensiveNeed, motionRead } = context;

    if (dist > 2.45 && !defensiveNeed) {
      actions.delete('backstep');
    }

    if (
      !(
        blocking ||
        vulnerable ||
        recentClash ||
        opponent.fsm.isAttacking ||
        (
          opponentClassId === 'ronin' &&
          dist >= 1.58 &&
          dist <= 2.05 &&
          (motionRead.recentApproach || motionRead.recentLateralThreat)
        ) ||
        (motionRead.recentApproach && dist <= 2.05) ||
        (stableLane && dist >= 1.65 && dist <= 1.95)
      )
    ) {
      actions.delete('heavyAttack');
    }

    if (
      dist > 2.25 &&
      !blocking &&
      !vulnerable &&
      !opponent.fsm.isAttacking &&
      !recentClash
    ) {
      actions.delete('thrustAttack');
    }

    if (
      opponentClassId === 'spearman' &&
      dist > 1.7 &&
      !blocking &&
      !vulnerable &&
      !recentClash &&
      !opponent.fsm.isAttacking
    ) {
      actions.delete('quickAttack');
    }

    if (
      opponentClassId === 'spearman' &&
      dist > 1.65 &&
      !blocking &&
      !vulnerable &&
      !recentClash &&
      !opponent.fsm.isAttacking
    ) {
      actions.delete('thrustAttack');
      actions.delete('heavyAttack');
    }

    if (
      opponentClassId === 'spearman' &&
      dist > 1.55 &&
      motionRead.recentLateralThreat &&
      !blocking &&
      !vulnerable
    ) {
      actions.delete('quickAttack');
      actions.delete('thrustAttack');
      actions.delete('heavyAttack');
    }

    if (
      opponentClassId === 'ronin' &&
      opponent.fsm.isAttacking &&
      !blocking &&
      !vulnerable &&
      !recentClash
    ) {
      actions.delete('quickAttack');
      actions.delete('thrustAttack');
      actions.delete('heavyAttack');
      actions.delete('moveForward');
      actions.delete('sidestepUp');
      actions.delete('sidestepDown');
    }

    if (
      opponentClassId === 'huscarl' &&
      !blocking &&
      !vulnerable &&
      !recentClash &&
      !opponent.fsm.isAttacking
    ) {
      actions.delete('block');
      if (dist > 2.05) {
        actions.delete('quickAttack');
        actions.delete('thrustAttack');
      }
      if (!(motionRead.recentApproach && dist >= 1.65 && dist <= 2.15)) {
        actions.delete('heavyAttack');
      }
      if (dist <= 2.75 && (motionRead.recentApproach || dist <= 2.35)) {
        actions.delete('sidestepUp');
        actions.delete('sidestepDown');
      }
    }

    if (
      opponentClassId === 'huscarl' &&
      opponent.fsm.isAttacking &&
      !blocking &&
      !vulnerable &&
      !recentClash
    ) {
      actions.delete('block');
    }
  }

  _executePending(fighter, dt) {
    if (this.pendingAction !== 'sidestepUp' && this.pendingAction !== 'sidestepDown') {
      super._executePending(fighter, dt);
      return;
    }
    if (!fighter.fsm.isActionable) {
      this.pendingAction = null;
      return;
    }

    const action = this.pendingAction;
    this.pendingAction = null;
    this.currentAction = action;
    this.sideDir = getWorldSidestepLocalDirection(fighter, action);
    fighter.sidestep(this.sideDir);
    this.currentAction = null;
  }

  _applySpearmanCandidateFilters(actions, opponent, context) {
    const { dist, opponentClassId, blocking, vulnerable, recentClash, motionRead } = context;
    const rushClass = opponentClassId === 'ronin' || opponentClassId === 'huscarl';
    const opponentBusy = opponent.fsm.isAttacking || blocking || vulnerable || recentClash;

    const sidestepLockoutRange = opponentClassId === 'huscarl' ? 3.0 : 2.2;
    const advanceLockoutRange = opponentClassId === 'huscarl' ? 2.25 : 1.9;

    if (rushClass && !opponentBusy && dist <= sidestepLockoutRange) {
      actions.delete('sidestepUp');
      actions.delete('sidestepDown');
    }

    if (rushClass && !opponentBusy && dist <= advanceLockoutRange) {
      actions.delete('moveForward');
    }

    if (opponentClassId === 'huscarl' && motionRead.recentApproach && dist >= 1.75 && dist <= 2.55) {
      actions.delete('heavyAttack');
    }

    if (rushClass && !opponentBusy && motionRead.recentLateralThreat && dist > 1.65) {
      actions.delete('heavyAttack');
      if (dist > 2.15) actions.delete('quickAttack');
    }

    if (opponentClassId === 'ronin' && !opponentBusy && dist <= 2.35) {
      actions.delete('quickAttack');
    }

    if (rushClass && !opponentBusy && dist < 1.45) {
      actions.delete('thrustAttack');
      actions.delete('heavyAttack');
    }
  }

  _applyRoninCandidateFilters(actions, opponent, context) {
    const { dist, opponentClassId, blocking, vulnerable, recentClash, motionRead } = context;
    const opponentBusy = opponent.fsm.isAttacking || blocking || vulnerable || recentClash;
    if (opponentClassId === 'spearman' && !opponentBusy) {
      if (dist <= 3.05 && dist > 1.75) actions.delete('moveForward');
      if (dist > 2.65 && !motionRead.recentApproach) actions.delete('quickAttack');
      if (dist > 3.0 && !motionRead.recentApproach) actions.delete('thrustAttack');
    }

    if (opponentClassId === 'knight') {
      if (!opponentBusy && dist > 2.0 && !motionRead.recentApproach) actions.delete('quickAttack');
      actions.delete('heavyAttack');
      if (!vulnerable && !blocking && !motionRead.recentLateralThreat) actions.delete('thrustAttack');
      if (!vulnerable && !blocking && !motionRead.recentApproach && this._random() < 0.2) actions.delete('quickAttack');
    }

    if (opponentClassId !== 'huscarl') return;

    if (!opponentBusy && dist <= 2.1 && dist > 1.45) {
      actions.delete('moveForward');
    }

    if (!opponentBusy && dist <= 1.75) {
      actions.delete('sidestepUp');
      actions.delete('sidestepDown');
    }

    if (!opponentBusy && dist > 2.35) {
      actions.delete('quickAttack');
    }

    if (!opponentBusy && dist > 2.6 && !motionRead.recentApproach) {
      actions.delete('heavyAttack');
      actions.delete('thrustAttack');
    }
  }

  _applyHuscarlCandidateFilters(actions, opponent, context) {
    const { dist, opponentClassId, blocking, vulnerable, recentClash, defensiveNeed, motionRead, edgeDistance } = context;
    const opponentBusy = opponent.fsm.isAttacking || blocking || vulnerable || recentClash;
    const lateralPunish = motionRead.recentLateralThreat || opponent.state === FighterState.SIDESTEP;

    if (opponentClassId === 'spearman' && dist <= 2.75 && !opponent.fsm.isAttacking && !vulnerable) {
      actions.delete('sidestepUp');
      actions.delete('sidestepDown');
    }

    if (opponentClassId === 'spearman' && dist > 1.7 && !vulnerable) {
      actions.delete('block');
    }

    if (!defensiveNeed && edgeDistance < 1.7) {
      actions.delete('moveBack');
      actions.delete('backstep');
    }

    if (dist > 1.3 && !opponent.fsm.isAttacking && !vulnerable) {
      actions.delete('moveBack');
      actions.delete('backstep');
    }

    if (!opponentBusy) {
      if (dist > 1.78) {
        actions.delete('quickAttack');
      }
      if (!lateralPunish && !vulnerable && !recentClash) {
        actions.delete('thrustAttack');
      }
      if (dist > 1.92) actions.delete('thrustAttack');
      const closeGuardBreaker = opponentClassId === 'knight' && dist <= 1.85 && !motionRead.recentLateralThreat;
      if (!(blocking || vulnerable || recentClash || closeGuardBreaker) && dist > 1.55) {
        actions.delete('heavyAttack');
      }
    }

    if (dist > 2.2 && !opponent.fsm.isAttacking) {
      actions.delete('sidestepUp');
      actions.delete('sidestepDown');
      actions.delete('backstep');
    }

    if (dist > 1.95 && !opponent.fsm.isAttacking && !blocking && !vulnerable) {
      actions.delete('block');
    }
  }

  _applyPassiveTargetCandidateFilters(actions, context) {
    const { dist, stableLane, defensiveNeed, passiveTarget } = context;

    if (passiveTarget && !defensiveNeed) {
      actions.delete('block');
      actions.delete('moveBack');
      actions.delete('backstep');
      if (stableLane && dist > 1.55) {
        actions.delete('sidestepUp');
        actions.delete('sidestepDown');
      }
    }
  }

  _buildLikelyResponses(fighter, opponent, dist, motionRead) {
    const classId = getFighterClassId(fighter);
    const opponentClassId = getFighterClassId(opponent);
    const recentBlock = (this._opponentLastBlockFrame ?? -9999) > -9999 && ((this.lastDecisionFrame - this._opponentLastBlockFrame) <= 36);
    if (motionRead.passiveTarget && !opponent.fsm.isAttacking && opponent.state === FighterState.IDLE) {
      const responses = [
        { action: 'idle', weight: dist > 1.9 ? 0.62 : 0.54 },
        { action: 'moveForward', weight: dist > 2.0 ? 0.22 : 0.08 },
        { action: 'block', weight: dist <= 1.95 ? 0.08 : 0.03 },
      ];
      if (dist <= 1.85) {
        responses.push({ action: 'quickAttack', weight: 0.06 });
      }
      if (dist <= 2.1) {
        responses.push({ action: 'moveBack', weight: 0.04 });
      }
      return normalizeWeights(responses);
    }
    const responses = [];
    const sidestepWeightBase = motionRead.recentlyPunishedBySidestep || motionRead.recentApproach ? 0.38 : 0.24;
    const sidestepWeight =
      classId === 'spearman' || classId === 'knight'
        ? sidestepWeightBase + 0.04
        : sidestepWeightBase - 0.03;
    const blockRatio = this._getOpponentBlockRatio?.() ?? 0.3;
    let sidestepScale = 1;
    if (classId === 'ronin' && opponentClassId === 'knight' && dist <= 2.2) sidestepScale = 0.78;
    if (classId === 'ronin' && opponentClassId === 'huscarl' && dist <= 2.8) sidestepScale = 0.38;
    if (classId === 'ronin' && opponentClassId === 'spearman' && dist <= 3.1) sidestepScale = 0.55;
    if (classId === 'ronin' && opponentClassId === 'knight' && dist > 2.2 && dist <= 3.0) sidestepScale = 0.55;
    responses.push({ action: 'sidestepUp', weight: sidestepWeight * sidestepScale });
    responses.push({ action: 'sidestepDown', weight: sidestepWeight * sidestepScale });
    let moveForwardWeight = dist > 2.1 ? 0.18 : 0.1;
    if (classId === 'ronin' && opponentClassId === 'huscarl') {
      moveForwardWeight += dist > 1.6 ? 0.2 : 0.08;
    }
    if (classId === 'ronin' && (opponentClassId === 'spearman' || opponentClassId === 'knight') && dist <= 3.1) {
      moveForwardWeight += opponentClassId === 'spearman' ? 0.16 : 0.12;
    }
    responses.push({ action: 'moveForward', weight: moveForwardWeight });
    let blockWeight = opponent.state === FighterState.BLOCK ? 0.22 : 0.14;
    if (classId === 'knight' && opponentClassId === 'spearman' && dist <= 2.25) {
      blockWeight += 0.12;
    }
    if (classId === 'knight' && opponentClassId === 'huscarl' && dist <= 2.35) {
      blockWeight += 0.18;
      responses[0].weight *= 0.7;
      responses[1].weight *= 0.7;
    }
    if (classId === 'knight' && dist <= 2.3) {
      blockWeight += Math.max(0, blockRatio - 0.28) * 0.45;
    }
    if (classId === 'knight' && opponentClassId === 'spearman' && dist <= 2.35 && (recentBlock || blockRatio >= 0.48)) {
      const turtleBias = (recentBlock ? 0.12 : 0) + Math.max(0, blockRatio - 0.48) * 0.65;
      responses[0].weight *= 0.72;
      responses[1].weight *= 0.72;
      blockWeight += 0.18 + turtleBias;
    }
    responses.push({ action: 'block', weight: blockWeight });
    let quickWeight = dist < 2.1 ? 0.18 : 0.08;
    if (classId === 'knight' && opponentClassId === 'ronin' && dist <= 2.2) {
      quickWeight += 0.08;
    }
    if (classId === 'knight' && opponentClassId === 'spearman' && dist <= 2.05) {
      quickWeight += 0.06;
      responses[0].weight *= 1.28;
      responses[1].weight *= 1.28;
    }
    if (classId === 'ronin' && opponentClassId === 'knight' && dist <= 1.95) {
      quickWeight += 0.06;
    }
    responses.push({ action: 'quickAttack', weight: quickWeight });
    if (classId === 'knight' && opponentClassId === 'ronin' && dist <= 2.25) {
      responses.push({ action: 'thrustAttack', weight: 0.12 });
    }
    if (classId === 'knight' && opponentClassId === 'huscarl') {
      if (dist <= 2.35) {
        responses.push({ action: 'quickAttack', weight: 0.2 });
      }
      if (dist >= 1.55 && dist <= 2.2) {
        responses.push({ action: 'thrustAttack', weight: 0.08 });
        responses.push({ action: 'heavyAttack', weight: 0.08 });
      }
    }
    if (classId === 'spearman' && opponentClassId === 'ronin') {
      if (dist >= 1.45 && dist <= 2.25) {
        responses.push({ action: 'heavyAttack', weight: 0.24 });
      }
      if (dist <= 2.05) {
        responses.push({ action: 'quickAttack', weight: 0.14 });
      }
    }
    if (classId === 'spearman' && opponentClassId === 'huscarl') {
      if (dist >= 1.45 && dist <= 2.15) {
        responses.push({ action: 'thrustAttack', weight: 0.24 });
        responses.push({ action: 'quickAttack', weight: 0.16 });
      }
      if (dist <= 1.85) {
        responses.push({ action: 'heavyAttack', weight: 0.1 });
      }
    }
    if (classId === 'huscarl' && opponentClassId === 'knight') {
      if (dist <= 1.95) {
        responses.push({ action: 'moveBack', weight: 0.14 });
        responses.push({ action: 'backstep', weight: 0.1 });
      }
      if (dist <= 1.75) {
        responses.push({ action: 'block', weight: 0.38 });
      }
    }
    if (classId === 'ronin' && opponentClassId === 'knight') {
      if (dist <= 2.15) {
        responses.push({ action: 'thrustAttack', weight: 0.13 });
      }
      if (dist >= 1.55 && dist <= 2.15) {
        responses.push({ action: 'heavyAttack', weight: 0.18 });
      }
      if (dist <= 2.75) {
        responses.push({ action: 'quickAttack', weight: 0.18 });
      }
    }
    if (classId === 'ronin' && opponentClassId === 'spearman') {
      if (dist <= 3.0) {
        responses.push({ action: 'thrustAttack', weight: 0.22 });
      }
      if (dist <= 2.45) {
        responses.push({ action: 'quickAttack', weight: 0.18 });
      }
    }
    if (classId === 'ronin' && opponentClassId === 'huscarl') {
      if (dist <= 2.45) {
        responses.push({ action: 'quickAttack', weight: 0.3 });
        responses.push({ action: 'thrustAttack', weight: 0.22 });
      }
      if (dist <= 2.05) {
        responses.push({ action: 'heavyAttack', weight: 0.14 });
        responses.push({ action: 'block', weight: 0.16 });
      }
    }
    if (dist <= 2.2) {
      responses.push({ action: 'moveBack', weight: classId === 'ronin' ? 0.12 : 0.06 });
      responses.push({ action: 'backstep', weight: classId === 'ronin' ? 0.09 : 0.04 });
    }
    return normalizeWeights(responses);
  }

  _evaluateActionAgainstResponse(fighter, opponent, frameCount, aiAction, responseAction) {
    const classId = getFighterClassId(fighter);
    const opponentClassId = getFighterClassId(opponent);
    const opponentBlockRatio = this._getOpponentBlockRatio?.() ?? 0.3;
    const sim = this._preparePlannerSim(fighter, opponent, frameCount);
    const aiSim = sim.fighter1._plannerSourcePlayerIndex === fighter.playerIndex ? sim.fighter1 : sim.fighter2;
    const opponentSim = aiSim === sim.fighter1 ? sim.fighter2 : sim.fighter1;
    const aiIsFighter1 = aiSim === sim.fighter1;
    const aiSimIndex = aiSim.playerIndex;
    const initialEngagement = this._getEngagementContext(aiSim, opponentSim, aiSim.distanceTo(opponentSim));
    const initialEdgeDistance = getArenaEdgeDistance(aiSim.position.x, aiSim.position.z);

    let sidestepExposureFrames = 0;
    let offAngleAttackFrames = 0;
    let unsafeCommitFrames = 0;
    let passiveFrames = 0;
    let edgeRetreatFrames = 0;
    let score = 0;

    for (let i = 0; i < PLANNER_HORIZON_FRAMES && !sim.roundOver; i++) {
      const aiInput = this._buildPlannerInput(aiAction, i, aiSim);
      const opponentInput = this._buildPlannerInput(responseAction, i, opponentSim);

      const step = aiIsFighter1
        ? sim.step(FRAME_DURATION, { input1: aiInput, input2: opponentInput })
        : sim.step(FRAME_DURATION, { input1: opponentInput, input2: aiInput });

      const engagement = this._getEngagementContext(aiSim, opponentSim, aiSim.distanceTo(opponentSim));
      if (aiSim.state === FighterState.ATTACK_ACTIVE && opponentSim.state === FighterState.SIDESTEP) {
        sidestepExposureFrames++;
      }
      if (aiSim.state === FighterState.ATTACK_ACTIVE && engagement.forwardDot < 0.88) {
        offAngleAttackFrames++;
      }
      if (
        aiSim.state === FighterState.ATTACK_ACTIVE &&
        !opponentSim.fsm.isAttacking &&
        opponentSim.state !== FighterState.BLOCK &&
        engagement.forwardDot < 0.96
      ) {
        unsafeCommitFrames++;
      }
      if (
        (aiAction === 'block' || aiAction === 'idle') &&
        !opponentSim.fsm.isAttacking &&
        opponentSim.state !== FighterState.ATTACK_ACTIVE &&
        opponentSim.state !== FighterState.PARRY_SUCCESS
      ) {
        passiveFrames++;
      }
      if (getArenaEdgeDistance(aiSim.position.x, aiSim.position.z) < initialEdgeDistance - 0.12) {
        edgeRetreatFrames++;
      }

      for (const event of step.events || []) {
        if (event.type !== 'combat_result') continue;
        if (event.result === HitResult.LETHAL_HIT) {
          score += event.attackerIndex === aiSimIndex ? 100 : -100;
        } else if (event.result === HitResult.PARRIED) {
          score += event.attackerIndex === aiSimIndex ? -14 : 10;
        } else if (event.result === HitResult.BLOCKED) {
          score += event.attackerIndex === aiSimIndex ? -3 : 2;
        } else if (event.result === HitResult.CLASH) {
          score += event.attackerIndex === aiSimIndex ? 1 : 0;
        }
      }
    }

    const finalEngagement = this._getEngagementContext(aiSim, opponentSim, aiSim.distanceTo(opponentSim));
    const finalEdgeDistance = getArenaEdgeDistance(aiSim.position.x, aiSim.position.z);
    const initialSideAbs = Math.abs(initialEngagement.sideDot);
    const finalSideAbs = Math.abs(finalEngagement.sideDot);
    const angleGain = finalSideAbs - initialSideAbs;
    if (aiSim.damageSystem.isDead()) score -= 120;
    if (opponentSim.damageSystem.isDead()) score += 120;

    score -= sidestepExposureFrames * 1.8;
    score -= offAngleAttackFrames * 1.1;
    score -= unsafeCommitFrames * 1.4;
    score -= passiveFrames * (aiAction === 'block' ? 0.62 : 0.3);
    score -= edgeRetreatFrames * 0.35;

    if (aiAction === 'heavyAttack' || aiAction === 'thrustAttack') {
      score -= sidestepExposureFrames * 1.5;
    }

    if (aiSim.state === FighterState.ATTACK_ACTIVE && finalEngagement.forwardDot < 0.85) {
      score -= 18;
    }

    if (aiAction === 'moveForward' || aiAction === 'block' || aiAction === 'idle') {
      score += clamp((finalEngagement.forwardDot - 0.9) * 10, -2, 2);
    }

    if (opponentSim.state === FighterState.BLOCK && aiAction === 'heavyAttack') score += 5;
    if (aiAction === 'quickAttack' && finalEngagement.forwardDot > 0.95 && aiSim.distanceTo(opponentSim) <= 1.8) score += 4;
    if (responseAction.startsWith('sidestep') && aiSim.state !== FighterState.ATTACK_ACTIVE) score += 3;
    if ((aiAction === 'heavyAttack' || aiAction === 'thrustAttack') && responseAction.startsWith('sidestep')) score -= 14;
    if ((aiAction === 'heavyAttack' || aiAction === 'thrustAttack') && responseAction === 'moveForward' && aiSim.distanceTo(opponentSim) > 2.0) score -= 6;
    if ((aiAction === 'block' || aiAction === 'idle') && finalEdgeDistance < initialEdgeDistance - 0.2) score -= 8;
    if (aiAction === 'moveForward' && finalEdgeDistance > initialEdgeDistance + 0.08) score += 4;
    if (responseAction === 'idle') {
      if (aiAction === 'moveForward' && aiSim.distanceTo(opponentSim) < initialEngagement.dist - 0.18 && finalEngagement.forwardDot > 0.94) {
        score += 6.2;
      }
      if (aiAction === 'quickAttack' && finalEngagement.forwardDot > 0.93 && aiSim.distanceTo(opponentSim) <= 1.85) score += 8.6;
      if (aiAction === 'thrustAttack' && finalEngagement.forwardDot > 0.94 && aiSim.distanceTo(opponentSim) <= 2.1) score += 8.2;
      if (aiAction === 'heavyAttack' && finalEngagement.forwardDot > 0.95 && aiSim.distanceTo(opponentSim) <= 2.0) score += 5.8;
      if (aiAction === 'block' || aiAction === 'idle') score -= 5.0;
      if (aiAction === 'moveBack' || aiAction === 'backstep') score -= 6.0;
      if (aiAction === 'sidestepUp' || aiAction === 'sidestepDown') score -= 3.8;
    }
    if ((aiAction === 'sidestepUp' || aiAction === 'sidestepDown')) {
      score += clamp(angleGain * 14, -2, 5);
      if (finalSideAbs >= 0.18 && finalSideAbs <= 0.58 && finalEngagement.forwardDot >= 0.76) score += 4;
      if (responseAction === 'moveForward' || responseAction === 'quickAttack') score += 2.5;
      if (finalEdgeDistance < initialEdgeDistance - 0.16) score -= 5;
      if (opponentSim.state === FighterState.SIDESTEP && finalEngagement.forwardDot < 0.72) score -= 3;
    }

    score = this._applyClassSpecificScore(score, {
      classId,
      opponentClassId,
      opponentBlockRatio,
      aiAction,
      responseAction,
      aiSim,
      opponentSim,
      initialEngagement,
      finalEngagement,
      angleGain,
      finalSideAbs,
    });

    return score;
  }

  _applyClassSpecificScore(score, context) {
    const {
      classId,
      opponentClassId,
      opponentBlockRatio,
      aiAction,
      responseAction,
      aiSim,
      opponentSim,
      initialEngagement,
      finalEngagement,
      angleGain,
      finalSideAbs,
    } = context;

    if (classId === 'spearman') {
      score = this._applySpearmanSpecificScore(score, context);
    } else if (classId === 'ronin') {
      score = this._applyRoninSpecificScore(score, context);
    } else if (classId === 'knight') {
      score = this._applyKnightSpecificScore(score, context);
    } else if (classId === 'huscarl') {
      score = this._applyHuscarlSpecificScore(score, context);
    }

    return score;
  }

  _applySpearmanSpecificScore(score, context) {
    const {
      opponentClassId,
      aiAction,
      responseAction,
      aiSim,
      opponentSim,
      initialEngagement,
      finalEngagement,
      finalSideAbs,
    } = context;
    const dist = initialEngagement.dist;
    const finalDist = aiSim.distanceTo(opponentSim);
    const rushClass = opponentClassId === 'ronin' || opponentClassId === 'huscarl';
    const aligned = finalEngagement.forwardDot > 0.93;
    const opponentVulnerable =
      opponentSim.state === FighterState.HIT_STUN ||
      opponentSim.state === FighterState.PARRIED_STUN ||
      opponentSim.state === FighterState.CLASH;

    if (aiAction === 'block' && !opponentSim.fsm.isAttacking) score -= rushClass ? 2.0 : 1.3;
    if (aiAction === 'moveForward' && finalEngagement.forwardDot > 0.94 && finalDist < dist - 0.12) score += rushClass ? -1.0 : 2.4;

    if (rushClass) {
      const approachResponse = responseAction === 'moveForward' || responseAction === 'quickAttack' || responseAction === 'thrustAttack';
      const keepoutScale = opponentClassId === 'ronin' ? 0.45 : 1.0;
      if (aiAction === 'moveBack') {
        if (dist <= 2.45 && finalDist > dist + 0.08) score += 3.0 * keepoutScale;
        if (approachResponse) score += 1.2 * keepoutScale;
      }
      if (aiAction === 'backstep') {
        if (dist <= 2.2) score += 2.4 * keepoutScale;
        if (responseAction === 'quickAttack' || responseAction === 'moveForward' || responseAction === 'heavyAttack' || responseAction === 'thrustAttack') score += 1.0 * keepoutScale;
      }
      if (aiAction === 'quickAttack') {
        if (aligned && dist >= 1.45 && dist <= 2.15 && finalDist <= 2.15) score += 3.8 * keepoutScale;
        if (approachResponse && dist >= 1.55 && dist <= 2.25) score += 2.0 * keepoutScale;
        if (isSidestepAction(responseAction)) score -= opponentClassId === 'huscarl' ? 4.6 : 2.8;
      }
      if (aiAction === 'thrustAttack') {
        if (aligned && dist >= 1.95 && dist <= 2.7 && finalDist <= 2.65) score += 3.8 * keepoutScale;
        if (approachResponse && dist >= 2.0 && dist <= 2.75) score += 2.0 * keepoutScale;
        if ((responseAction === 'heavyAttack' || responseAction === 'thrustAttack') && dist >= 2.05 && dist <= 2.75) score += 1.6 * keepoutScale;
        if (dist < 1.7 && !opponentVulnerable) score -= 6.0;
        if (isSidestepAction(responseAction)) score -= 5.8;
      }
      if (aiAction === 'heavyAttack' && !opponentVulnerable && dist > 1.65) score -= 5.0;
      if (isSidestepAction(aiAction)) score -= opponentClassId === 'huscarl' ? 3.0 : 1.6;
      if (aiAction === 'idle') score -= 2.6;
    } else {
      if (isSidestepAction(aiAction) && finalSideAbs >= 0.16 && finalSideAbs <= 0.52) score += 2.8;
    }

    return score;
  }

  _applyRoninSpecificScore(score, context) {
    const {
      opponentClassId,
      aiAction,
      responseAction,
      aiSim,
      opponentSim,
      initialEngagement,
      finalEngagement,
      angleGain,
      finalSideAbs,
    } = context;

    const knightCatchBand =
      opponentClassId === 'knight' &&
      initialEngagement.dist >= 1.58 &&
      initialEngagement.dist <= 2.1;
    if (isSidestepAction(aiAction)) {
      score += clamp(angleGain * 18, -2, 7);
      if (finalSideAbs >= 0.2 && finalSideAbs <= 0.68 && finalEngagement.forwardDot >= 0.72) score += 5;
      if (responseAction === 'moveForward' || responseAction === 'quickAttack' || responseAction === 'block') score += 2.5;
    }
    if (aiAction === 'moveForward' && finalEngagement.forwardDot > 0.9 && aiSim.distanceTo(opponentSim) < initialEngagement.dist - 0.16) score += 3.2;
    if (aiAction === 'quickAttack' && finalSideAbs >= 0.14 && aiSim.distanceTo(opponentSim) <= 1.9) score += 4.5;
    if (aiAction === 'thrustAttack' && finalEngagement.forwardDot > 0.9 && aiSim.distanceTo(opponentSim) <= 2.05) score += 2.8;
    if (aiAction === 'heavyAttack' && finalSideAbs >= 0.1 && finalSideAbs <= 0.6) score += 3;
    if (
      opponentSim.state === FighterState.HIT_STUN ||
      opponentSim.state === FighterState.PARRIED_STUN ||
      opponentSim.state === FighterState.CLASH
    ) {
      const punishRange = aiSim.distanceTo(opponentSim);
      if (aiAction === 'quickAttack' && punishRange <= 2.05 && finalEngagement.forwardDot > 0.9) score += 12.0;
      if (aiAction === 'thrustAttack' && punishRange <= 2.4 && finalEngagement.forwardDot > 0.9) score += 10.0;
      if (aiAction === 'heavyAttack' && punishRange <= 2.15 && finalEngagement.forwardDot > 0.9) score += 7.0;
      if (aiAction === 'moveForward' && punishRange > 2.05 && finalEngagement.forwardDot > 0.9) score += 4.0;
      if (aiAction === 'moveBack' || aiAction === 'backstep' || isSidestepAction(aiAction) || aiAction === 'block') score -= 8.0;
    }
    if (aiAction === 'block') score -= 1.9;
    if (aiAction === 'idle') score -= 1.1;
    if (aiAction === 'moveBack') score += responseAction === 'quickAttack' || responseAction === 'moveForward' ? 1.5 : 0;
    if (aiAction === 'backstep') score += responseAction === 'quickAttack' ? 3 : 0;
    if (opponentClassId === 'knight') {
      if (isSidestepAction(aiAction) && responseAction === 'heavyAttack' && knightCatchBand) score -= 8.6;
      if (isSidestepAction(aiAction) && responseAction === 'thrustAttack' && initialEngagement.dist <= 2.15) score -= 4.0;
      if (aiAction === 'moveForward' && responseAction === 'heavyAttack' && knightCatchBand) score -= 4.4;
      if (aiAction === 'moveForward' && !opponentSim.fsm.isAttacking && initialEngagement.dist <= 2.75) score -= 3.6;
      if (aiAction === 'thrustAttack' && responseAction === 'heavyAttack' && knightCatchBand) score -= 5.0;
      if (aiAction === 'block' && isHeavyOrThrustAction(responseAction)) score += 4.0;
      if (aiAction === 'block' && responseAction === 'quickAttack' && initialEngagement.dist <= 2.35) score += 4.2;
      if (aiAction === 'moveBack' && responseAction === 'heavyAttack') score += 3.4;
      if (aiAction === 'moveBack' && responseAction === 'quickAttack') score += 2.6;
      if (aiAction === 'backstep' && (responseAction === 'heavyAttack' || responseAction === 'quickAttack')) score += 4.4;
      if (isSidestepAction(aiAction) && responseAction === 'moveForward' && initialEngagement.dist >= 2.0) score += 3.0;
      if (aiAction === 'thrustAttack' && responseAction === 'moveForward' && initialEngagement.dist >= 1.8 && initialEngagement.dist <= 2.45) score += 3.4;
    }
    if (opponentClassId === 'spearman') {
      const spearThreatBand = initialEngagement.dist >= 1.8 && initialEngagement.dist <= 3.0;
      if (aiAction === 'moveForward' && !opponentSim.fsm.isAttacking && initialEngagement.dist <= 3.05) score -= 4.0;
      if (isSidestepAction(aiAction) && spearThreatBand && responseAction !== 'heavyAttack') score += 4.2;
      if (aiAction === 'moveBack' && (responseAction === 'moveForward' || responseAction === 'quickAttack' || responseAction === 'thrustAttack')) score += 2.8;
      if (aiAction === 'backstep' && (responseAction === 'quickAttack' || responseAction === 'thrustAttack')) score += 3.6;
      if (aiAction === 'block' && (responseAction === 'quickAttack' || responseAction === 'thrustAttack') && initialEngagement.dist <= 2.45) score += 4.0;
      if (aiAction === 'thrustAttack' && responseAction === 'moveForward' && initialEngagement.dist >= 2.05 && initialEngagement.dist <= 2.75) score += 4.4;
      if (aiAction === 'quickAttack' && responseAction === 'moveForward' && initialEngagement.dist >= 1.65 && initialEngagement.dist <= 2.2) score += 3.6;
    }
    if (opponentClassId === 'huscarl') {
      const axeThreatBand = initialEngagement.dist <= 2.25;
      const keepoutBand = initialEngagement.dist >= 1.65 && initialEngagement.dist <= 2.35;
      const huscarlAttackResponse =
        responseAction === 'quickAttack' ||
        responseAction === 'thrustAttack' ||
        responseAction === 'heavyAttack';

      if (isSidestepAction(aiAction) && axeThreatBand && !opponentSim.fsm.isAttacking) score -= 3.6;
      if (aiAction === 'moveForward' && !opponentSim.fsm.isAttacking && initialEngagement.dist <= 2.55) score -= 4.0;
      if (aiAction === 'backstep' && huscarlAttackResponse) score += 6.2;
      if (aiAction === 'moveBack' && (responseAction === 'moveForward' || huscarlAttackResponse)) score += 4.0;
      if (aiAction === 'block' && huscarlAttackResponse && initialEngagement.dist <= 2.15) score += 5.5;
      if (aiAction === 'quickAttack' && keepoutBand && finalEngagement.forwardDot > 0.92 && aiSim.distanceTo(opponentSim) <= 2.12) score += 6.2;
      if (aiAction === 'thrustAttack' && keepoutBand && finalEngagement.forwardDot > 0.92 && aiSim.distanceTo(opponentSim) <= 2.35) score += 5.8;
      if (aiAction === 'heavyAttack' && responseAction === 'moveForward' && initialEngagement.dist >= 1.55 && initialEngagement.dist <= 2.05) score += 3.2;
      if ((aiAction === 'thrustAttack' || aiAction === 'heavyAttack') && isSidestepAction(responseAction)) score -= 4.0;
    }

    return score;
  }

  _applyKnightSpecificScore(score, context) {
    const {
      opponentClassId,
      opponentBlockRatio,
      aiAction,
      responseAction,
      aiSim,
      opponentSim,
      initialEngagement,
      finalEngagement,
      angleGain,
      finalSideAbs,
    } = context;

    const openNeutralHeavy =
      aiAction === 'heavyAttack' &&
      !opponentSim.fsm.isAttacking &&
      opponentSim.state !== FighterState.BLOCK &&
      opponentSim.state !== FighterState.BLOCK_STUN &&
      opponentSim.state !== FighterState.HIT_STUN &&
      opponentSim.state !== FighterState.PARRIED_STUN &&
      opponentSim.state !== FighterState.CLASH &&
      initialEngagement.dist > 1.9;
    const openNeutralThrust =
      aiAction === 'thrustAttack' &&
      !opponentSim.fsm.isAttacking &&
      opponentSim.state !== FighterState.BLOCK &&
      opponentSim.state !== FighterState.BLOCK_STUN &&
      opponentSim.state !== FighterState.HIT_STUN &&
      opponentSim.state !== FighterState.PARRIED_STUN &&
      opponentSim.state !== FighterState.CLASH &&
      initialEngagement.dist > 2.15;
    const closeGuardPressure =
      opponentClassId === 'spearman' &&
      opponentBlockRatio >= 0.48 &&
      initialEngagement.dist <= 2.25;
    const recentPressureChain =
      this._plannerRecentActions.slice(-2).filter((action) => action === 'moveForward' || action === 'quickAttack' || action === 'thrustAttack').length;

    if (opponentClassId === 'spearman') {
      score = this._applyKnightVsSpearmanScore(score, context, closeGuardPressure);
    } else if (opponentClassId === 'ronin') {
      score = this._applyKnightVsRoninScore(score, context);
    } else if (opponentClassId === 'huscarl') {
      score = this._applyKnightVsHuscarlScore(score, context);
    }

    if (aiAction === 'block' && !opponentSim.fsm.isAttacking) score -= 1.4;
    if (aiAction === 'block' && (responseAction === 'quickAttack' || responseAction === 'moveForward')) score += 1.8;
    if (aiAction === 'moveForward' && aiSim.distanceTo(opponentSim) < initialEngagement.dist - 0.2 && finalEngagement.forwardDot > 0.94) score += 4.2;
    if (aiAction === 'quickAttack' && finalEngagement.forwardDot > 0.92 && aiSim.distanceTo(opponentSim) <= 1.85) score += 2.4;
    if (aiAction === 'heavyAttack' && responseAction === 'block') score += 4;
    if (aiAction === 'heavyAttack' && finalEngagement.forwardDot > 0.95 && aiSim.distanceTo(opponentSim) >= 1.65 && aiSim.distanceTo(opponentSim) <= 2.05) score += 2.8;
    if (openNeutralHeavy) score -= 9.5;
    if (openNeutralThrust) score -= 8.5;
    if (aiAction === 'heavyAttack' && isSidestepAction(responseAction)) score -= 4.5;
    if (aiAction === 'thrustAttack' && isSidestepAction(responseAction)) score -= 3.2;
    if (aiAction === 'thrustAttack' && finalEngagement.forwardDot > 0.94 && aiSim.distanceTo(opponentSim) <= 2.1) score += 4.2;
    if (aiAction === 'idle') score -= 0.8;
    if (isSidestepAction(aiAction)) score -= 1.1;
    if (closeGuardPressure) {
      if (aiAction === 'moveForward') score += 2.4 + recentPressureChain * 0.8;
      if (aiAction === 'quickAttack') score += 2.8 + recentPressureChain * 1.0;
      if (aiAction === 'thrustAttack') score += 1.8 + recentPressureChain * 0.7;
      if (aiAction === 'moveBack') score -= 2.4;
      if (aiAction === 'idle') score -= 2.8;
    }

    return score;
  }

  _applyKnightVsSpearmanScore(score, context, closeGuardPressure) {
    const { aiAction, responseAction, aiSim, opponentSim, initialEngagement, finalEngagement, angleGain, finalSideAbs } = context;

    if (aiAction === 'block' && !opponentSim.fsm.isAttacking) score -= 1.8;
    if (aiAction === 'moveForward' && finalEngagement.forwardDot > 0.94 && aiSim.distanceTo(opponentSim) < initialEngagement.dist - 0.14) score += 2.2;
    if (aiAction === 'quickAttack' && finalEngagement.forwardDot > 0.92 && aiSim.distanceTo(opponentSim) <= 1.85) score += 2.6;
    if (aiAction === 'thrustAttack' && finalEngagement.forwardDot > 0.95 && aiSim.distanceTo(opponentSim) <= 2.1) score += 2.8;
    if (isSidestepAction(aiAction)) {
      score += clamp(angleGain * 14, -1, 5);
      if (finalSideAbs >= 0.16 && finalSideAbs <= 0.46 && finalEngagement.forwardDot >= 0.78) score += 3.2;
    }
    if (responseAction === 'quickAttack') {
      if (aiAction === 'block') score += 3.2;
      if (isSidestepAction(aiAction)) score += 2.6;
    }
    if (responseAction === 'moveForward') {
      if (aiAction === 'block') score += 1.4;
      if (isSidestepAction(aiAction)) score += 1.2;
    }
    if (isSidestepAction(responseAction)) {
      if (aiAction === 'quickAttack') score -= 4.6;
      if (aiAction === 'thrustAttack') score -= 3.2;
      if (aiAction === 'heavyAttack') score -= 5.4;
      if (aiAction === 'block') score += 1.4;
      if (isSidestepAction(aiAction)) score += 2.2;
    }
    if (responseAction === 'block') {
      if (aiAction === 'quickAttack' && finalEngagement.forwardDot > 0.92 && aiSim.distanceTo(opponentSim) <= 1.9) score += 5.2;
      if (aiAction === 'moveForward' && finalEngagement.forwardDot > 0.94 && aiSim.distanceTo(opponentSim) < initialEngagement.dist - 0.1) score += 3.4;
      if (aiAction === 'heavyAttack' && finalEngagement.forwardDot > 0.94 && aiSim.distanceTo(opponentSim) <= 2.0) score += 4.2;
      if (aiAction === 'thrustAttack' && finalEngagement.forwardDot > 0.95 && aiSim.distanceTo(opponentSim) <= 2.05) score += 3.6;
      if (closeGuardPressure) {
        if (aiAction === 'moveForward') score += 4.6;
        if (aiAction === 'quickAttack') score += 5.8;
        if (aiAction === 'thrustAttack') score += 4.4;
        if (aiAction === 'heavyAttack' && initialEngagement.dist <= 1.95) score += 2.6;
      }
    }

    return score;
  }

  _applyKnightVsRoninScore(score, context) {
    const { aiAction, responseAction, aiSim, opponentSim, initialEngagement, finalEngagement } = context;
    const heavyCatchBand = initialEngagement.dist >= 1.6 && initialEngagement.dist <= 2.05;

    if (aiAction === 'block' && (responseAction === 'quickAttack' || responseAction === 'thrustAttack' || responseAction === 'moveForward')) score += 4.2;
    if (aiAction === 'block' && responseAction === 'heavyAttack' && initialEngagement.dist <= 2.25) score += 6.0;
    if (aiAction === 'backstep' && responseAction === 'heavyAttack' && initialEngagement.dist <= 2.35) score += 4.0;
    if (aiAction === 'moveBack' && responseAction === 'heavyAttack' && initialEngagement.dist <= 2.35) score += 2.8;
    if (aiAction === 'quickAttack' && finalEngagement.forwardDot > 0.92 && aiSim.distanceTo(opponentSim) <= 1.85) score += 3.8;
    if (aiAction === 'thrustAttack' && finalEngagement.forwardDot > 0.94 && aiSim.distanceTo(opponentSim) <= 2.0) score += 2.4;
    if (aiAction === 'heavyAttack' && responseAction === 'moveForward' && heavyCatchBand) score += 6.2;
    if (aiAction === 'heavyAttack' && isSidestepAction(responseAction) && heavyCatchBand) score += 8.0;
    if (aiAction === 'heavyAttack' && (responseAction === 'quickAttack' || responseAction === 'thrustAttack') && heavyCatchBand) score += 4.2;
    if (aiAction === 'thrustAttack' && isSidestepAction(responseAction)) score -= 2.8;
    if (aiAction === 'moveForward' && isSidestepAction(responseAction)) score -= 1.2;

    return score;
  }

  _applyKnightVsHuscarlScore(score, context) {
    const { aiAction, responseAction, aiSim, opponentSim, initialEngagement, finalEngagement } = context;
    const dist = initialEngagement.dist;
    const catchBand = dist >= 1.65 && dist <= 2.15;
    const rushResponse = responseAction === 'moveForward' || responseAction === 'quickAttack' || responseAction === 'thrustAttack';

    if (aiAction === 'block' && rushResponse) score += 2.2;
    if (aiAction === 'backstep' && rushResponse) score += 3.2;
    if (aiAction === 'moveBack' && responseAction === 'moveForward') score += 2.2;
    if (aiAction === 'moveForward' && responseAction === 'moveForward' && dist <= 2.35) score -= 4.8;
    if (aiAction === 'quickAttack' && !opponentSim.fsm.isAttacking && dist > 1.95) score -= 12.0;
    if (aiAction === 'thrustAttack' && !opponentSim.fsm.isAttacking && dist > 2.05) score -= 10.0;
    if (aiAction === 'heavyAttack' && rushResponse && catchBand) score += 6.0;
    if (aiAction === 'heavyAttack' && responseAction === 'block') score -= 2.0;
    if (isSidestepAction(aiAction) && rushResponse && dist <= 2.25) score -= 5.5;
    if (aiAction === 'quickAttack' && finalEngagement.forwardDot > 0.92 && aiSim.distanceTo(opponentSim) <= 1.75) score += 3.0;
    if (aiAction === 'thrustAttack' && finalEngagement.forwardDot > 0.94 && aiSim.distanceTo(opponentSim) <= 1.95) score += 2.4;

    return score;
  }

  _applyHuscarlSpecificScore(score, context) {
    const {
      opponentClassId,
      aiAction,
      responseAction,
      aiSim,
      opponentSim,
      initialEngagement,
      finalEngagement,
      finalSideAbs,
    } = context;
    const dist = initialEngagement.dist;
    const finalDist = aiSim.distanceTo(opponentSim);
    const aligned = finalEngagement.forwardDot > 0.92;
    const opponentGuarding = opponentSim.state === FighterState.BLOCK || opponentSim.state === FighterState.BLOCK_STUN;
    const opponentVulnerable =
      opponentSim.state === FighterState.HIT_STUN ||
      opponentSim.state === FighterState.PARRIED_STUN ||
      opponentSim.state === FighterState.CLASH;

    if (aiAction === 'moveForward') {
      if (aligned && finalDist < dist - 0.16) score += dist > 1.45 ? 6.0 : 2.0;
      if (responseAction === 'idle' || responseAction === 'block' || responseAction === 'moveBack') score += 2.0;
      if (dist <= 1.25) score -= 1.8;
    }

    if (aiAction === 'block') {
      if (opponentSim.fsm.isAttacking || responseAction === 'quickAttack' || responseAction === 'thrustAttack' || responseAction === 'heavyAttack') score += 4.8;
      if (!opponentSim.fsm.isAttacking && dist > 1.75) score -= 3.5;
      if (opponentClassId === 'spearman' && dist <= 2.35 && responseAction === 'thrustAttack') score += 2.2;
    }

    if (opponentClassId === 'spearman') {
      const spearAttackResponse = responseAction === 'quickAttack' || responseAction === 'thrustAttack' || responseAction === 'heavyAttack';
      if (aiAction === 'moveForward' && dist > 1.45 && finalEngagement.forwardDot > 0.9 && finalDist < dist - 0.14) score += 5.4;
      if (aiAction === 'block' && spearAttackResponse && dist <= 2.7) score += 1.6;
      if (aiAction === 'backstep' || aiAction === 'moveBack') score -= dist > 1.7 ? 2.8 : 0.8;
      if (isSidestepAction(aiAction)) score -= 3.8;
      if (aiAction === 'heavyAttack' && (responseAction === 'block' || responseAction === 'thrustAttack') && dist <= 1.9) score += 3.0;
    }

    if (aiAction === 'quickAttack') {
      if (aligned && finalDist <= 1.58) score += 7.2;
      if (opponentClassId === 'knight' && (responseAction === 'block' || responseAction === 'backstep') && !opponentVulnerable) score -= 5.4;
      if (dist > 1.72 && !opponentVulnerable) score -= 5.8;
      if (responseAction === 'sidestepUp' || responseAction === 'sidestepDown') score -= 2.4;
    }

    if (aiAction === 'thrustAttack') {
      if ((responseAction === 'sidestepUp' || responseAction === 'sidestepDown') && aligned && finalDist <= 1.86) score += 8.0;
      if (finalSideAbs >= 0.14 && finalSideAbs <= 0.58 && aligned && finalDist <= 1.84) score += 3.2;
      if (responseAction !== 'sidestepUp' && responseAction !== 'sidestepDown' && !opponentVulnerable) score -= 4.8;
      if (dist > 1.9 && !opponentVulnerable) score -= 4.2;
    }

    if (aiAction === 'heavyAttack') {
      if (opponentGuarding) score += 7.0;
      if (opponentVulnerable) score += 5.0;
      if (aligned && finalDist <= 1.62 && (responseAction === 'block' || responseAction === 'idle')) score += 3.2;
      if (opponentClassId === 'knight' && dist <= 1.85 && (responseAction === 'block' || responseAction === 'moveBack' || responseAction === 'backstep')) score += 8.2;
      if (!opponentGuarding && !opponentVulnerable && dist > 1.5) score -= 8.0;
      if (responseAction === 'sidestepUp' || responseAction === 'sidestepDown') score -= 6.0;
    }

    if (isSidestepAction(aiAction)) {
      score += clamp((finalSideAbs - Math.abs(initialEngagement.sideDot)) * 10, -2, 3);
      if (dist > 1.9) score -= 2.6;
      if (responseAction === 'heavyAttack' || responseAction === 'thrustAttack') score += 2.0;
    }

    if (aiAction === 'moveBack' || aiAction === 'backstep') {
      score += opponentSim.fsm.isAttacking ? 1.8 : -4.0;
      if (opponentClassId === 'spearman' && dist > 1.7) score -= 2.2;
    }

    if (aiAction === 'idle') score -= 2.6;

    return score;
  }

  _getActionPriorBias(classId, action, context) {
    const { dist, opponentClassId, blocking, recentBlock, blockRatio, vulnerable, defensiveNeed, motionRead, stableLane, recentClash } = context;
    const profileBias = this._getProfileActionBias(action);
    switch (classId) {
      case 'spearman':
        switch (action) {
          case 'block':
            return (defensiveNeed ? -0.02 : -0.24) +
              ((opponentClassId === 'ronin' || opponentClassId === 'huscarl') && dist > 1.75 ? -0.18 : 0) +
              profileBias;
          case 'moveForward':
            return (motionRead.recentApproach ? 0.18 : 0.1) +
              ((opponentClassId === 'ronin' || opponentClassId === 'huscarl') && dist < 2.35 ? -0.32 : 0) +
              profileBias;
          case 'moveBack':
            return (-0.14 +
              ((opponentClassId === 'ronin' || opponentClassId === 'huscarl') && dist < 2.45 ? 0.42 : 0) +
              (motionRead.recentApproach ? 0.18 : 0)) + profileBias;
          case 'sidestepUp':
          case 'sidestepDown':
            return (defensiveNeed || motionRead.recentLateralThreat ? 0.1 : 0.02) +
              ((opponentClassId === 'ronin' || opponentClassId === 'huscarl') ? -0.28 : 0) +
              profileBias;
          case 'backstep':
            return ((defensiveNeed ? -0.08 : -0.2) +
              ((opponentClassId === 'ronin' || opponentClassId === 'huscarl') && dist < 2.15 ? 0.34 : 0)) +
              profileBias;
          case 'quickAttack':
            return (dist <= 1.8 || vulnerable ? 0.08 : -0.2) +
              ((opponentClassId === 'ronin' || opponentClassId === 'huscarl') && dist >= 1.45 && dist <= 2.2 ? 0.24 : 0) +
              profileBias;
          case 'thrustAttack':
            return ((stableLane && dist <= 2.0) || blocking || vulnerable || recentClash ? 0.06 : -0.22) +
              ((opponentClassId === 'ronin' || opponentClassId === 'huscarl') && stableLane && dist >= 1.9 && dist <= 2.75 ? 0.34 : 0) +
              profileBias;
          case 'heavyAttack':
            return ((blocking || vulnerable || recentClash) ? 0.06 : -0.26) +
              ((opponentClassId === 'ronin' || opponentClassId === 'huscarl') && !blocking && !vulnerable ? -0.22 : 0) +
              profileBias;
          default:
            return profileBias;
        }
      case 'ronin':
        switch (action) {
          case 'block':
            return (defensiveNeed ? 0.02 : (opponentClassId === 'knight' ? -0.1 : -0.28)) +
              (opponentClassId === 'huscarl' && dist <= 2.15 ? 0.18 : 0) +
              profileBias;
          case 'moveForward':
            return 0.12 + (opponentClassId === 'huscarl' && dist < 2.65 ? -0.42 : 0) + profileBias;
          case 'moveBack':
            return (opponentClassId === 'knight' ? 0.2 : 0.08) +
              (opponentClassId === 'huscarl' && dist < 2.55 ? 0.36 : 0) +
              profileBias;
          case 'sidestepUp':
          case 'sidestepDown':
            return (opponentClassId === 'knight' ? -0.02 : 0.2) +
              (opponentClassId === 'huscarl' && dist < 2.45 ? -0.3 : 0) +
              profileBias;
          case 'backstep':
            return (defensiveNeed ? 0.08 : (opponentClassId === 'knight' ? 0.12 : -0.04)) +
              (opponentClassId === 'huscarl' && dist < 2.35 ? 0.4 : 0) +
              profileBias;
          case 'quickAttack':
            return (dist <= 1.85 || vulnerable ? 0.1 : -0.1) +
              (vulnerable && dist <= 2.05 ? 0.45 : 0) +
              (opponentClassId === 'huscarl' && dist >= 1.65 && dist <= 2.22 ? 0.18 : 0) +
              profileBias;
          case 'thrustAttack':
            return ((stableLane && dist <= 2.1) || blocking || vulnerable ? 0.04 : -0.1) +
              (vulnerable && dist <= 2.45 ? 0.42 : 0) +
              ((opponentClassId === 'knight' && dist >= 1.65 && dist <= 2.05) ? -0.04 : 0) +
              ((opponentClassId === 'huscarl' && dist >= 1.8 && dist <= 2.42) ? 0.2 : 0) +
              profileBias;
          case 'heavyAttack':
            return (blocking || vulnerable || recentClash ? 0.08 : -0.08) +
              (vulnerable && dist <= 2.2 ? 0.28 : 0) +
              (opponentClassId === 'knight' ? -0.04 : 0) +
              profileBias;
          default:
            return profileBias;
        }
      case 'knight':
        switch (action) {
          case 'block':
            return (defensiveNeed ? 0.04 : -0.18) + (opponentClassId === 'ronin' && dist <= 2.35 ? 0.36 : 0) + (opponentClassId === 'spearman' && dist <= 2.0 ? 0.06 : 0) + profileBias;
          case 'moveForward':
            return (0.18 + ((blocking || recentBlock || blockRatio >= 0.42) ? 0.08 : 0) + ((blockRatio >= 0.5 && dist <= 2.25) ? 0.1 : 0)) + profileBias;
          case 'moveBack':
            return -0.18 + profileBias;
          case 'sidestepUp':
          case 'sidestepDown':
            return (motionRead.recentLateralThreat || motionRead.recentApproach ? -0.02 : -0.08) + (opponentClassId === 'spearman' && dist <= 2.05 ? 0.12 : 0) + profileBias;
          case 'backstep':
            return -0.16 + profileBias;
          case 'quickAttack':
            return (dist <= 1.8 || vulnerable ? 0.1 : -0.06) +
              ((blocking || recentBlock || blockRatio >= 0.42) && dist <= 1.95 ? 0.12 : 0) +
              ((opponentClassId === 'spearman' && !blocking && !vulnerable && !recentClash && dist > 1.68) ? -0.28 : 0) +
              ((opponentClassId === 'spearman' && !blocking && !vulnerable && dist >= 1.7 && dist <= 2.0) ? -0.12 : 0) +
              ((blockRatio >= 0.5 && dist <= 2.0) ? 0.08 : 0) +
              profileBias;
          case 'thrustAttack':
            return (dist <= 2.1 || blocking || vulnerable ? 0.14 : -0.08) +
              ((!blocking && !vulnerable && dist > 2.2) ? -0.12 : 0) +
              ((opponentClassId === 'ronin' && dist <= 2.0) ? 0.04 : 0) +
              ((blockRatio >= 0.5 && dist <= 2.1) ? 0.06 : 0) +
              profileBias;
          case 'heavyAttack':
            return (blocking || vulnerable || recentClash ? 0.18 : -0.16) +
              ((motionRead.recentApproach && dist <= 2.05) ? 0.08 : 0) +
              ((stableLane && dist >= 1.65 && dist <= 1.95) ? 0.08 : 0) +
              ((opponentClassId === 'ronin' && dist >= 1.58 && dist <= 2.05) ? 0.14 : 0) +
              ((blocking || recentBlock || blockRatio >= 0.5) && dist <= 2.05 ? 0.1 : 0) +
              profileBias;
          default:
            return profileBias;
        }
      case 'huscarl':
        switch (action) {
          case 'block':
            return (defensiveNeed ? 0.1 : -0.24) + profileBias;
          case 'moveForward':
            return (dist > 1.35 ? 0.34 : 0.06) + profileBias;
          case 'moveBack':
            return -0.34 + profileBias;
          case 'sidestepUp':
          case 'sidestepDown':
            return (motionRead.recentLateralThreat || defensiveNeed ? 0.0 : -0.12) + profileBias;
          case 'backstep':
            return (defensiveNeed ? -0.02 : -0.3) + profileBias;
          case 'quickAttack':
            return (dist <= 1.58 || vulnerable ? 0.18 : -0.18) + profileBias;
          case 'thrustAttack':
            return ((motionRead.recentLateralThreat && dist <= 1.9) || vulnerable ? 0.14 : -0.22) + profileBias;
          case 'heavyAttack':
            return ((blocking || vulnerable || recentClash) ? 0.2 : -0.24) + profileBias;
          case 'idle':
            return -0.24 + profileBias;
          default:
            return profileBias;
        }
      default:
        return profileBias;
    }
  }

  _getProfileActionBias(action) {
    const p = this.personality ?? {};
    const aggression = (p.aggression ?? 0.5) - 0.5;
    switch (action) {
      case 'block':
        return (p.blockBias ?? 0) * 0.65 - aggression * 0.06;
      case 'moveForward':
        return (p.moveForwardBias ?? 0) * 0.65 + aggression * 0.08;
      case 'moveBack':
        return (p.moveBackBias ?? 0) * 0.65 - aggression * 0.04;
      case 'sidestepUp':
      case 'sidestepDown':
        return (p.sidestepBias ?? 0) * 0.75;
      case 'backstep':
        return (p.backstepBias ?? 0) * 0.75;
      case 'quickAttack':
        return (p.quickBias ?? 0) * 0.75 + aggression * 0.03;
      case 'thrustAttack':
        return (p.thrustBias ?? 0) * 0.75 + aggression * 0.02;
      case 'heavyAttack':
        return (p.heavyBias ?? 0) * 0.75 + aggression * 0.02;
      case 'idle':
      default:
        return (p.idleBias ?? 0) * 0.6 - aggression * 0.04;
    }
  }

  _preparePlannerSim(fighter, opponent, frameCount) {
    const fighterIsPhysicalLeft = (fighter.position?.x ?? 0) <= (opponent.position?.x ?? 0);
    const leftLive = fighterIsPhysicalLeft ? fighter : opponent;
    const rightLive = fighterIsPhysicalLeft ? opponent : fighter;
    const needsNewBundle =
      !this._plannerBundle ||
      this._plannerBundle.ids[0] !== leftLive.charDef.id ||
      this._plannerBundle.ids[1] !== rightLive.charDef.id;

    if (needsNewBundle) {
      const left = new FighterSim(0, leftLive.charDef.id, leftLive.charDef);
      const right = new FighterSim(1, rightLive.charDef.id, rightLive.charDef);
      this._plannerBundle = {
        ids: [leftLive.charDef.id, rightLive.charDef.id],
        fighter1: left,
        fighter2: right,
        sim: new MatchSim({ fighter1: left, fighter2: right }),
      };
    }

    const { fighter1, fighter2, sim } = this._plannerBundle;
    this._restorePlannerFighter(fighter1, leftLive);
    this._restorePlannerFighter(fighter2, rightLive);
    fighter1._plannerSourcePlayerIndex = leftLive.playerIndex;
    fighter2._plannerSourcePlayerIndex = rightLive.playerIndex;
    sim.frameCount = frameCount;
    sim.roundOver = false;
    sim.winner = null;
    sim.killReason = null;
    sim.events.length = 0;
    return sim;
  }

  _restorePlannerFighter(target, source) {
    const snapshot = this._captureLiveSnapshot(source);
    target._resetCoreState(snapshot.position.x);
    target._applySnapshotCore(snapshot, (attackType) => getAttackData(attackType, target.charDef), { applyTransform: true });
    target.walkPhase = snapshot.walkPhase;
    target.slideMult = snapshot.slideMult;
    target.blockPushRemaining = snapshot.blockPushRemaining ?? 0;
    target._stepping = snapshot.stepping;
    target._stepDirection = snapshot.stepDirection;
    target._stepFrames = snapshot.stepFrames;
    target._stepCooldown = snapshot.stepCooldown;
    target._postAttackTurnTime = snapshot.postAttackTurnTime;
    target.activeClipName = source.activeClipName;
  }

  _captureLiveSnapshot(fighter) {
    const debug = fighter.getDebugSnapshot?.() ?? {};
    return {
      position: {
        x: fighter.position.x,
        y: fighter.position.y,
        z: fighter.position.z,
      },
      rotationY: fighter.group.rotation.y,
      facingRight: fighter.facingRight,
      state: fighter.state,
      stateFrames: fighter.stateFrames,
      stateDuration: fighter.fsm.stateDuration,
      currentAttackType: fighter.currentAttackType,
      sidestepDirection: fighter.fsm.sidestepDirection,
      sidestepPhase: fighter.fsm.sidestepPhase,
      hitApplied: fighter.hitApplied,
      dead: fighter.damageSystem.isDead?.() ?? false,
      walkPhase: fighter.walkPhase ?? 0,
      slideMult: fighter.slideMult ?? 1,
      blockPushRemaining: fighter.blockPushRemaining ?? 0,
      stepping: debug.stepping ?? false,
      stepDirection: debug.stepDirection ?? 0,
      stepFrames: debug.stepFrames ?? 0,
      stepCooldown: debug.stepCooldown ?? 0,
      postAttackTurnTime: fighter._postAttackTurnTime ?? 0,
    };
  }

  _buildPlannerInput(action, frameIndex, fighter = null) {
    const input = createEmptyInputFrame(frameIndex);
    switch (action) {
      case 'moveForward':
        input.held.right = true;
        break;
      case 'moveBack':
        input.held.left = true;
        break;
      case 'block':
        input.held.block = true;
        if (frameIndex === 0) input.pressed.block = true;
        break;
      case 'sidestepUp':
        if (frameIndex === 0) pressSidestepInput(input, fighter ? getWorldSidestepLocalDirection(fighter, action) : -1);
        break;
      case 'sidestepDown':
        if (frameIndex === 0) pressSidestepInput(input, fighter ? getWorldSidestepLocalDirection(fighter, action) : 1);
        break;
      case 'backstep':
        if (frameIndex === 0) input.pressed.backstep = true;
        break;
      case 'quickAttack':
        if (frameIndex === 0) input.pressed.quick = true;
        break;
      case 'heavyAttack':
        if (frameIndex === 0) input.pressed.heavy = true;
        break;
      case 'thrustAttack':
        if (frameIndex === 0) input.pressed.thrust = true;
        break;
      case 'idle':
      default:
        break;
    }
    return input;
  }

  getDebugSnapshot() {
    return {
      ...super.getDebugSnapshot(),
      controllerKind: this.controllerKind,
      lastChosenAction: this.lastChosenAction ?? this._plannerDebug.lastChosenAction,
      planner: this._plannerDebug,
    };
  }

  reset() {
    super.reset();
    this.lastChosenAction = null;
    this._plannerDecisionSeq = 0;
    this._plannerRecentActions = [];
    this._plannerDebug = {
      decisionSeq: 0,
      frameCount: 0,
      lastChosenAction: null,
      lastCandidates: [],
      lastResponses: [],
    };
  }
}
