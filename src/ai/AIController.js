import { AI_PRESETS } from './AIPersonality.js';
import { FighterState, AttackType } from '../core/Constants.js';

const MAX_BLOCK_FRAMES = 40; // ~0.67s max block hold

export class AIController {
  constructor(difficulty = 'medium') {
    this.personality = { ...AI_PRESETS[difficulty] };
    this.lastDecisionFrame = 0;
    this.pendingAction = null;
    this.currentAction = null;
    this.sideDir = 1;
    this.blockHeldFrames = 0;

    // Opponent tracking
    this._opponentLastState = null;
    this._opponentBlockCount = 0;    // how often opponent blocks (informs heavy usage)
    this._opponentAttackCount = 0;   // how often opponent attacks
    this._decayTimer = 0;
  }

  setDifficulty(difficulty) {
    this.personality = { ...AI_PRESETS[difficulty] };
  }

  update(fighter, opponent, frameCount, dt) {
    this._opponent = opponent;

    // Track opponent behavior patterns
    this._trackOpponent(opponent);

    // Track block duration and force release when too long
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

    // Release block if opponent is no longer threatening
    if (this.currentAction === 'block' && fighter.state === FighterState.BLOCK) {
      const opponentThreat = opponent.state === FighterState.ATTACK_STARTUP ||
                              opponent.state === FighterState.ATTACK_ACTIVE;
      if (!opponentThreat) {
        fighter.fsm.transition(FighterState.IDLE);
        this.currentAction = null;
      }
    }

    // === REACTIVE INTERRUPTS ===
    // Break decision cooldown for high-priority situations
    const shouldInterrupt = this._checkReactiveInterrupt(fighter, opponent);

    if (shouldInterrupt) {
      this.lastDecisionFrame = frameCount;
      this._makeDecision(fighter, opponent, dt);
    } else if (frameCount - this.lastDecisionFrame < this.personality.reactionFrames) {
      this._executePersistent(fighter, dt);
    } else {
      this.lastDecisionFrame = frameCount;
      this._makeDecision(fighter, opponent, dt);
    }

    this._applyMovement(fighter, dt);
  }

  _trackOpponent(opponent) {
    const state = opponent.state;
    if (state !== this._opponentLastState) {
      if (state === FighterState.BLOCK || state === FighterState.BLOCK_STUN) {
        this._opponentBlockCount++;
      }
      if (state === FighterState.ATTACK_STARTUP || state === FighterState.ATTACK_ACTIVE) {
        this._opponentAttackCount++;
      }
      this._opponentLastState = state;
    }

    // Decay counters over time so AI adapts to changing behavior
    this._decayTimer++;
    if (this._decayTimer > 300) { // every ~5 seconds
      this._opponentBlockCount = Math.floor(this._opponentBlockCount * 0.7);
      this._opponentAttackCount = Math.floor(this._opponentAttackCount * 0.7);
      this._decayTimer = 0;
    }
  }

  _checkReactiveInterrupt(fighter, opponent) {
    if (!fighter.fsm.isActionable) return false;

    const p = this.personality;

    // React to opponent starting an attack (defensive interrupt)
    if (opponent.state === FighterState.ATTACK_STARTUP && this._opponentLastState !== FighterState.ATTACK_STARTUP) {
      // Higher skill = more likely to react immediately
      return Math.random() < (p.parryRate + p.dodgeRate) * 0.5;
    }

    // React to parry success (counter-attack window)
    if (fighter.state === FighterState.PARRY_SUCCESS) {
      return Math.random() < p.counterRate;
    }

    return false;
  }

  _makeDecision(fighter, opponent, dt) {
    // Allow re-evaluation while blocking
    if (fighter.state === FighterState.BLOCK) {
      fighter.fsm.transition(FighterState.IDLE);
      this.currentAction = null;
    }

    if (!fighter.fsm.isActionable) return;

    const dist = fighter.distanceTo(opponent);
    const p = this.personality;
    const noise = () => (Math.random() - 0.5) * p.decisionNoise;

    // Arena position awareness
    const edgeDist = Math.sqrt(fighter.position.x ** 2 + fighter.position.z ** 2);
    const nearEdge = edgeDist > 4.0;
    const dangerEdge = edgeDist > 6.0;

    const scores = {};

    const ranges = fighter.charDef?.aiRanges || { engage: 2.5, close: 1.8 };
    const inRange = dist < ranges.engage;
    const closeRange = dist < ranges.close;

    // Opponent state analysis
    const opponentAttacking = opponent.state === FighterState.ATTACK_STARTUP ||
                               opponent.state === FighterState.ATTACK_ACTIVE;
    const opponentRecovering = opponent.state === FighterState.ATTACK_RECOVERY;
    const opponentStunned = opponent.state === FighterState.HIT_STUN ||
                             opponent.state === FighterState.PARRIED_STUN ||
                             opponent.state === FighterState.BLOCK_STUN ||
                             opponent.state === FighterState.CLASH;
    const opponentVulnerable = opponentRecovering || opponentStunned;

    // === COUNTER-ATTACK after parry success ===
    if (fighter.state === FighterState.PARRY_SUCCESS) {
      if (Math.random() < p.counterRate) {
        scores.quickAttack = 2.0; // very high priority
        scores.thrustAttack = 1.5;
      }
    }

    // === PUNISH recovery/stun windows ===
    if (opponentVulnerable && inRange) {
      if (Math.random() < p.punishRate) {
        scores.quickAttack = (scores.quickAttack || 0) + 1.5 + noise();
        scores.thrustAttack = (scores.thrustAttack || 0) + 1.0 + noise();
      }
    }

    // === PUNISH with approach when opponent is recovering out of range ===
    if (opponentVulnerable && !inRange && dist < ranges.engage + 1.5) {
      if (Math.random() < p.punishRate) {
        scores.moveForward = (scores.moveForward || 0) + 1.2;
      }
    }

    // === Normal attack scoring ===
    if (inRange) {
      scores.quickAttack = (scores.quickAttack || 0) + 0.4 + p.aggression * 0.3 + noise();
      scores.thrustAttack = (scores.thrustAttack || 0) + 0.2 + p.aggression * 0.2 + noise();

      // Heavy attack scoring — influenced by opponent's blocking tendency
      const blockRatio = this._getOpponentBlockRatio();
      const heavyBonus = blockRatio * p.heavyMixup; // more heavy attacks vs frequent blockers
      scores.heavyAttack = (scores.heavyAttack || 0) + 0.15 + p.aggression * 0.2 + heavyBonus + noise();

      if (closeRange) {
        scores.quickAttack += 0.2;
      }
    }

    // === Defense scoring ===
    if (opponentAttacking) {
      scores.block = 0.5 + noise();
      scores.parry = p.parryRate + noise();

      // Sidestep — use dodgeRate
      scores.sidestep = 0.3 + p.dodgeRate * 0.5 + noise();

      // Only backstep if not near edge
      if (!nearEdge) {
        scores.backstep = 0.15 + p.dodgeRate * 0.3 + noise();
      }
    }

    // Random sidestep for repositioning
    scores.sidestep = (scores.sidestep || 0) + 0.05 + noise();

    // === Movement / spacing ===
    if (!inRange) {
      scores.moveForward = (scores.moveForward || 0) + 0.6 + p.aggression * 0.3 + noise();
    }

    // Spacing awareness: back off at close range to maintain fighting distance
    if (closeRange && !nearEdge && !opponentVulnerable) {
      const backoffDesire = p.spacingAwareness * 0.4;
      scores.moveBack = (scores.moveBack || 0) + backoffDesire + noise();
      scores.sidestep = (scores.sidestep || 0) + backoffDesire * 0.5 + noise();
    } else if (closeRange && !nearEdge) {
      scores.moveBack = (scores.moveBack || 0) + 0.1 + noise();
    }

    // Center pull: the further from center, the more AI wants to move forward
    if (nearEdge) {
      scores.moveForward = (scores.moveForward || 0) + 0.4;
      scores.moveBack = 0;
      scores.backstep = 0;
    }
    if (dangerEdge) {
      scores.moveForward = (scores.moveForward || 0) + 0.6;
    }

    // Idle
    scores.idle = 0.1 + noise();

    // Pick highest scoring action
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
    if (total < 3) return 0.3; // not enough data, assume moderate blocking
    return this._opponentBlockCount / total;
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
    this._opponentLastState = null;
    this._opponentBlockCount = 0;
    this._opponentAttackCount = 0;
    this._decayTimer = 0;
  }
}
