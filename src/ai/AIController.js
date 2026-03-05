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
  }

  setDifficulty(difficulty) {
    this.personality = { ...AI_PRESETS[difficulty] };
  }

  update(fighter, opponent, frameCount, dt) {
    this._opponent = opponent;

    // Track block duration and force release when too long
    if (this.currentAction === 'block') {
      this.blockHeldFrames++;
      if (this.blockHeldFrames >= MAX_BLOCK_FRAMES) {
        // Force release block
        if (fighter.state === FighterState.BLOCK) {
          fighter.fsm.transition(FighterState.IDLE);
        }
        this.currentAction = null;
        this.blockHeldFrames = 0;
      }
    } else {
      this.blockHeldFrames = 0;
    }

    // Release block between decisions if opponent isn't attacking anymore
    if (this.currentAction === 'block' && fighter.state === FighterState.BLOCK) {
      const opponentThreat = opponent.state === FighterState.ATTACK_STARTUP ||
                              opponent.state === FighterState.ATTACK_ACTIVE;
      if (!opponentThreat) {
        fighter.fsm.transition(FighterState.IDLE);
        this.currentAction = null;
      }
    }

    if (frameCount - this.lastDecisionFrame < this.personality.reactionFrames) {
      this._executePersistent(fighter, dt);
      return;
    }

    this.lastDecisionFrame = frameCount;
    this._makeDecision(fighter, opponent, dt);
  }

  _makeDecision(fighter, opponent, dt) {
    // Allow re-evaluation even while blocking
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

    const inRange = dist < 2.5;
    const closeRange = dist < 1.8;

    // Attack scoring
    if (inRange) {
      scores.quickAttack = 0.4 + p.aggression * 0.3 + noise();
      scores.heavyAttack = 0.15 + p.aggression * 0.2 + noise();
      if (closeRange) {
        scores.quickAttack += 0.2;
      }
    }

    // Defense scoring
    const opponentAttacking = opponent.state === FighterState.ATTACK_STARTUP ||
                               opponent.state === FighterState.ATTACK_ACTIVE;
    if (opponentAttacking) {
      scores.block = 0.5 + noise();
      scores.parry = p.parryRate + noise();
      scores.sidestep = 0.3 + noise();
      // Only backstep if not near edge
      if (!nearEdge) {
        scores.backstep = 0.2 + noise();
      }
    }

    // Sidestep — good defensive option, lateral so safe near edge
    if (opponentAttacking) {
      scores.sidestep = (scores.sidestep || 0) + 0.4 + noise();
    }
    scores.sidestep = (scores.sidestep || 0) + 0.15 + noise();

    // Movement — prefer staying at fighting distance, not retreating
    if (!inRange) {
      scores.moveForward = 0.6 + p.aggression * 0.3 + noise();
    }
    // Only retreat at close range if far from edge
    if (closeRange && !nearEdge) {
      scores.moveBack = 0.1 + noise();
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

  _executePersistent(fighter, dt) {
    if (!this.currentAction || !fighter.fsm.isActionable) return;

    switch (this.currentAction) {
      case 'moveForward': fighter.moveForward(dt); break;
      case 'moveBack': fighter.moveBack(dt); break;
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
        fighter.moveForward(dt);
        break;
      case 'moveBack':
        fighter.moveBack(dt);
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
    this.blockHeldFrames = 0;
  }
}
