import { AI_PRESETS } from './AIPersonality.js';
import { FighterState, AttackType, Stance } from '../core/Constants.js';

export class AIController {
  constructor(difficulty = 'medium') {
    this.personality = { ...AI_PRESETS[difficulty] };
    this.lastDecisionFrame = 0;
    this.pendingAction = null;
    this.currentAction = null;
    this.sideDir = 1;
  }

  setDifficulty(difficulty) {
    this.personality = { ...AI_PRESETS[difficulty] };
  }

  update(fighter, opponent, frameCount, dt) {
    this._opponent = opponent;
    // Throttle decisions by reaction time
    if (frameCount - this.lastDecisionFrame < this.personality.reactionFrames) {
      // Continue executing persistent actions (movement)
      this._executePersistent(fighter, dt);
      return;
    }

    this.lastDecisionFrame = frameCount;
    this._makeDecision(fighter, opponent, dt);
  }

  _makeDecision(fighter, opponent, dt) {
    if (!fighter.fsm.isActionable) return;

    const dist = fighter.distanceTo(opponent);
    const p = this.personality;
    const noise = () => (Math.random() - 0.5) * p.decisionNoise;

    // Score each possible action
    const scores = {};

    // Attack scoring
    const inRange = dist < 2.5;
    const closeRange = dist < 1.8;

    if (inRange) {
      scores.quickAttack = 0.4 + p.aggression * 0.3 + noise();
      scores.heavyAttack = 0.15 + p.aggression * 0.2 + noise();
      scores.thrust = 0.25 + p.aggression * 0.2 + noise();

      if (closeRange) {
        scores.quickAttack += 0.2;
      }
    }

    // Defense scoring - react to opponent attacking
    if (opponent.state === FighterState.ATTACK_STARTUP ||
        opponent.state === FighterState.ATTACK_ACTIVE) {
      scores.block = 0.5 + noise();
      scores.parry = p.parryRate + noise();
      scores.dodge = p.dodgeRate + noise();

      // Check if our guard zone matches their attack
      if (opponent.currentAttackType) {
        const attackZone = opponent.stanceSystem.getAttackTargetZone(opponent.currentAttackType);
        const guardZone = fighter.stanceSystem.getGuardZone();
        if (attackZone !== guardZone) {
          // Wrong guard! Dodge is better
          scores.dodge += 0.3;
          scores.stanceChange = 0.3 + noise();
        }
      }
    }

    // Movement
    if (!inRange) {
      scores.moveForward = 0.6 + p.aggression * 0.3 + noise();
    } else if (closeRange) {
      scores.moveBack = 0.2 + noise();
    }

    // Stance change
    scores.stanceChange = (scores.stanceChange || 0) + p.stanceChangeRate + noise();

    // Sidestep occasionally
    scores.sidestep = 0.05 + noise();

    // Idle (do nothing)
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

  _executePersistent(fighter, dt) {
    // Continue movement actions between decisions
    if (!this.currentAction || !fighter.fsm.isActionable) return;

    switch (this.currentAction) {
      case 'moveForward': fighter.moveForward(dt, this._opponent); break;
      case 'moveBack': fighter.moveBack(dt, this._opponent); break;
      case 'sidestep': fighter.sidestep(dt, this.sideDir, this._opponent); break;
      case 'block':
        if (fighter.fsm.isActionable) fighter.block();
        break;
      default: fighter.stopMoving(); break;
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
      case 'thrust':
        fighter.attack(AttackType.THRUST);
        this.currentAction = null;
        break;
      case 'block':
        fighter.block();
        break;
      case 'parry':
        fighter.parry();
        this.currentAction = null;
        break;
      case 'dodge':
        fighter.dodge(this._opponent);
        this.currentAction = null;
        break;
      case 'stanceChange':
        fighter.changeStance();
        this.currentAction = null;
        break;
      case 'moveForward':
        fighter.moveForward(dt, this._opponent);
        break;
      case 'moveBack':
        fighter.moveBack(dt, this._opponent);
        break;
      case 'sidestep':
        this.sideDir = Math.random() > 0.5 ? 1 : -1;
        fighter.sidestep(dt, this.sideDir, this._opponent);
        break;
      case 'idle':
      default:
        fighter.stopMoving();
        this.currentAction = null;
        break;
    }
  }

  reset() {
    this.lastDecisionFrame = 0;
    this.pendingAction = null;
    this.currentAction = null;
  }
}
