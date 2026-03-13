import * as THREE from 'three';
import {
  FighterState, HitResult, PARRY_WINDOW_FRAMES,
  BACKSTEP_INVULN_FRAMES,
  WeaponType,
} from '../core/Constants.js';

const HIT_RADIUS = 0.5;
const TIP_TOWARD_TARGET_THRESHOLD = 0.001;
const TIP_RELATIVE_SPEED_THRESHOLD = 0.002;

const _defenderCenter = new THREE.Vector3();
const _lineDir = new THREE.Vector3();
const _toPoint = new THREE.Vector3();
const _closest = new THREE.Vector3();

export class HitResolver {
  resolve(attacker, defender) {
    const collision = attacker._debugCollision || (attacker._debugCollision = {});
    const finish = (result) => {
      collision.lastResolve = result;
      collision.defenderState = defender.state;
      return {
        result,
        attackerType: attacker.fsm.currentAttackType,
        defenderType: defender.fsm.currentAttackType,
      };
    };

    // Priority 1: Both attacking -> Clash
    if (this._isInActiveFrames(defender)) {
      return finish(HitResult.CLASH);
    }

    // Priority 2: Sidestep dash phase -> Whiff (invulnerable during dash)
    if (defender.state === FighterState.SIDESTEP && defender.fsm.sidestepPhase === 'dash') {
      return finish(HitResult.WHIFF);
    }

    // Priority 3: Backstep i-frames -> Whiff
    if (defender.state === FighterState.DODGE && defender.stateFrames <= BACKSTEP_INVULN_FRAMES) {
      return finish(HitResult.WHIFF);
    }

    // Priority 4: Parry -> Parried (within window), or Blocked (past window but still in parry state)
    if (defender.state === FighterState.PARRY) {
      if (defender.stateFrames <= PARRY_WINDOW_FRAMES) {
        return finish(HitResult.PARRIED);
      }
      // Past parry window but still in PARRY state — treat as block
      return finish(HitResult.BLOCKED);
    }

    // Priority 5: Block -> Blocked (no zone check, blocks everything)
    if (defender.state === FighterState.BLOCK) {
      return finish(HitResult.BLOCKED);
    }

    // Priority 6: Clean Hit
    return finish(HitResult.CLEAN_HIT);
  }

  _isInActiveFrames(fighter) {
    return fighter.state === FighterState.ATTACK_ACTIVE;
  }

  checkSwordCollision(attacker, defender) {
    const tip = attacker.getWeaponTipWorldPosition(new THREE.Vector3());
    const base = attacker.getWeaponBaseWorldPosition(new THREE.Vector3());

    defender.getHurtCenterWorldPosition(_defenderCenter);

    const collision = attacker._debugCollision || (attacker._debugCollision = {});
    collision.distance = Infinity;
    collision.hitRadius = HIT_RADIUS;
    collision.forwardDrive = 0;
    collision.towardTarget = 0;
    collision.motionGatePassed = false;
    collision.segmentHit = false;
    collision.lastCheckResult = 'pending';
    collision.defenderState = defender.state;

    const towardTarget = attacker.getTipRelativeVelocityToward(_defenderCenter);
    const relativeSpeed = attacker.getTipRelativeSpeed();
    collision.forwardDrive = relativeSpeed;
    collision.towardTarget = towardTarget;
    collision.motionGatePassed =
      relativeSpeed > TIP_RELATIVE_SPEED_THRESHOLD &&
      towardTarget > TIP_TOWARD_TARGET_THRESHOLD;
    if (
      relativeSpeed <= TIP_RELATIVE_SPEED_THRESHOLD ||
      towardTarget <= TIP_TOWARD_TARGET_THRESHOLD
    ) {
      collision.lastCheckResult = 'blocked_motion';
      return false;
    }

    const dist = this._distToLineSegment(_defenderCenter, base, tip);
    collision.distance = dist;
    collision.segmentHit = dist < HIT_RADIUS;
    collision.lastCheckResult = collision.segmentHit ? 'segment_hit' : 'out_of_range';
    return collision.segmentHit;
  }

  _distToLineSegment(point, lineStart, lineEnd) {
    _lineDir.subVectors(lineEnd, lineStart);
    const len = _lineDir.length();
    if (len < 0.001) return point.distanceTo(lineStart);

    _lineDir.divideScalar(len);
    _toPoint.subVectors(point, lineStart);
    const proj = _toPoint.dot(_lineDir);
    const t = Math.max(0, Math.min(len, proj));

    _closest.copy(_lineDir).multiplyScalar(t).add(lineStart);
    return point.distanceTo(_closest);
  }

}
