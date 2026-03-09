import * as THREE from 'three';
import {
  FighterState, HitResult, PARRY_WINDOW_FRAMES,
  BACKSTEP_INVULN_FRAMES,
} from '../core/Constants.js';

const HIT_RADIUS = 0.5;

const _defenderCenter = new THREE.Vector3();
const _lineDir = new THREE.Vector3();
const _toPoint = new THREE.Vector3();
const _closest = new THREE.Vector3();

export class HitResolver {
  resolve(attacker, defender) {
    // Priority 1: Both attacking -> Clash
    if (this._isInActiveFrames(defender)) {
      return { result: HitResult.CLASH };
    }

    // Priority 2: Sidestep dash phase -> Whiff (invulnerable during dash)
    if (defender.state === FighterState.SIDESTEP && defender.fsm.sidestepPhase === 'dash') {
      return { result: HitResult.WHIFF };
    }

    // Priority 3: Backstep i-frames -> Whiff
    if (defender.state === FighterState.DODGE && defender.stateFrames <= BACKSTEP_INVULN_FRAMES) {
      return { result: HitResult.WHIFF };
    }

    // Priority 4: Parry -> Parried (within window), or Blocked (past window but still in parry state)
    if (defender.state === FighterState.PARRY) {
      if (defender.stateFrames <= PARRY_WINDOW_FRAMES) {
        return { result: HitResult.PARRIED };
      }
      // Past parry window but still in PARRY state — treat as block
      return { result: HitResult.BLOCKED };
    }

    // Priority 5: Block -> Blocked (no zone check, blocks everything)
    if (defender.state === FighterState.BLOCK) {
      return { result: HitResult.BLOCKED };
    }

    // Priority 6: Clean Hit
    return { result: HitResult.CLEAN_HIT };
  }

  _isInActiveFrames(fighter) {
    return fighter.state === FighterState.ATTACK_ACTIVE;
  }

  checkSwordCollision(attacker, defender) {
    // Get weapon tip: prefer SpearTip bone (baked spear), else procedural weapon mesh
    const tip = attacker.joints.spearTip
      ? attacker.joints.spearTip.getWorldPosition(new THREE.Vector3())
      : attacker.weapon.getTipWorldPosition();

    const handJoint = attacker.joints.handR || attacker.joints.handL;
    const base = new THREE.Vector3();
    if (handJoint) {
      handJoint.getWorldPosition(base);
    } else {
      base.copy(attacker.position).setY(1.2);
    }

    _defenderCenter.copy(defender.position);
    _defenderCenter.y += 0.9;

    const dist = this._distToLineSegment(_defenderCenter, base, tip);
    return dist < HIT_RADIUS;
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
