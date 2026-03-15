import * as THREE from 'three';
import {
  FighterState, HitResult, PARRY_WINDOW_FRAMES,
  BACKSTEP_INVULN_FRAMES,
  WeaponType,
} from '../core/Constants.js';

const HURT_RADIUS = 0.5;
const HURT_HEIGHT = 1.8;
const TIP_TOWARD_TARGET_THRESHOLD = 0.001;
const TIP_RELATIVE_SPEED_THRESHOLD = 0.002;
const WEAPON_CLASH_MOTION_THRESHOLD = 0.0025;

const _defenderCenter = new THREE.Vector3();
const _lineDir = new THREE.Vector3();
const _toPoint = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _candidatePoint = new THREE.Vector3();
const _segP1 = new THREE.Vector3();
const _segQ1 = new THREE.Vector3();
const _segP2 = new THREE.Vector3();
const _segQ2 = new THREE.Vector3();
const _segD1 = new THREE.Vector3();
const _segD2 = new THREE.Vector3();
const _segR = new THREE.Vector3();
const _segC1 = new THREE.Vector3();
const _segC2 = new THREE.Vector3();
const _aMid = new THREE.Vector3();
const _bMid = new THREE.Vector3();

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
    if (this._isInActiveFrames(defender) && this.checkWeaponClash(attacker, defender)) {
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

  checkWeaponOverlap(attacker, defender) {
    const tip = attacker.getWeaponTipWorldPosition(new THREE.Vector3());
    const base = attacker.getWeaponBaseWorldPosition(new THREE.Vector3());
    defender.getHurtCenterWorldPosition(_defenderCenter);
    return this._distToVerticalCylinder(base, tip, _defenderCenter, HURT_RADIUS, HURT_HEIGHT) <= 0;
  }

  checkWeaponClash(attacker, defender) {
    const aBase = attacker.getWeaponBaseWorldPosition(_segP1);
    const aTip = attacker.getWeaponTipWorldPosition(_segQ1);
    const bBase = defender.getWeaponBaseWorldPosition(_segP2);
    const bTip = defender.getWeaponTipWorldPosition(_segQ2);
    _aMid.addVectors(aBase, aTip).multiplyScalar(0.5);
    _bMid.addVectors(bBase, bTip).multiplyScalar(0.5);

    const aRadius = attacker.charDef?.weaponClashRadius ?? 0.09;
    const bRadius = defender.charDef?.weaponClashRadius ?? 0.09;
    const dist = this._distBetweenSegments(aBase, aTip, bBase, bTip);
    const overlap = dist <= (aRadius + bRadius);
    const closingDrive =
      attacker.getTipRelativeVelocityToward(_bMid) +
      defender.getTipRelativeVelocityToward(_aMid);
    const motionGatePassed = closingDrive > WEAPON_CLASH_MOTION_THRESHOLD;

    const aCollision = attacker._debugCollision || (attacker._debugCollision = {});
    const bCollision = defender._debugCollision || (defender._debugCollision = {});
    aCollision.weaponClashRadius = aRadius;
    bCollision.weaponClashRadius = bRadius;
    aCollision.weaponClashDistance = dist;
    bCollision.weaponClashDistance = dist;
    aCollision.weaponClashOverlap = overlap;
    bCollision.weaponClashOverlap = overlap;
    aCollision.weaponClashClosingDrive = closingDrive;
    bCollision.weaponClashClosingDrive = closingDrive;
    aCollision.weaponClashMotionGate = motionGatePassed;
    bCollision.weaponClashMotionGate = motionGatePassed;

    return overlap && motionGatePassed;
  }

  checkSwordCollision(attacker, defender) {
    const tip = attacker.getWeaponTipWorldPosition(new THREE.Vector3());
    const base = attacker.getWeaponBaseWorldPosition(new THREE.Vector3());

    defender.getHurtCenterWorldPosition(_defenderCenter);

    const collision = attacker._debugCollision || (attacker._debugCollision = {});
    collision.distance = Infinity;
    collision.hurtRadius = HURT_RADIUS;
    collision.hurtHeight = HURT_HEIGHT;
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

    const dist = this._distToVerticalCylinder(base, tip, _defenderCenter, HURT_RADIUS, HURT_HEIGHT);
    collision.distance = dist;
    collision.segmentHit = dist <= 0;
    collision.lastCheckResult = collision.segmentHit ? 'cylinder_hit' : 'out_of_range';
    return collision.segmentHit;
  }

  _distToVerticalCylinder(lineStart, lineEnd, center, radius, height) {
    const yMin = center.y - (height * 0.5);
    const yMax = center.y + (height * 0.5);

    // Check the endpoints directly first.
    const startDist = this._pointToCylinderDistance(lineStart, center, radius, yMin, yMax);
    if (startDist <= 0) return 0;
    const endDist = this._pointToCylinderDistance(lineEnd, center, radius, yMin, yMax);
    if (endDist <= 0) return 0;

    const dx = lineEnd.x - lineStart.x;
    const dz = lineEnd.z - lineStart.z;
    const lenSqXZ = dx * dx + dz * dz;

    let bestDist = Math.min(startDist, endDist);

    // Closest horizontal approach to the cylinder axis.
    if (lenSqXZ > 1e-8) {
      const tClosest = THREE.MathUtils.clamp(
        ((center.x - lineStart.x) * dx + (center.z - lineStart.z) * dz) / lenSqXZ,
        0,
        1,
      );
      _candidatePoint.lerpVectors(lineStart, lineEnd, tClosest);
      bestDist = Math.min(bestDist, this._pointToCylinderDistance(_candidatePoint, center, radius, yMin, yMax));
      if (bestDist <= 0) return 0;
    }

    // Check where the segment crosses the top/bottom planes of the cylinder caps.
    const dy = lineEnd.y - lineStart.y;
    if (Math.abs(dy) > 1e-8) {
      for (const planeY of [yMin, yMax]) {
        const tPlane = (planeY - lineStart.y) / dy;
        if (tPlane >= 0 && tPlane <= 1) {
          _candidatePoint.lerpVectors(lineStart, lineEnd, tPlane);
          bestDist = Math.min(bestDist, this._pointToCylinderDistance(_candidatePoint, center, radius, yMin, yMax));
          if (bestDist <= 0) return 0;
        }
      }
    }

    return bestDist;
  }

  _pointToCylinderDistance(point, center, radius, yMin, yMax) {
    const dx = point.x - center.x;
    const dz = point.z - center.z;
    const horizontalDist = Math.sqrt(dx * dx + dz * dz);
    const radialOutside = Math.max(0, horizontalDist - radius);
    const verticalOutside = point.y < yMin ? (yMin - point.y) : (point.y > yMax ? (point.y - yMax) : 0);

    if (radialOutside === 0 && verticalOutside === 0) {
      return 0;
    }
    return Math.hypot(radialOutside, verticalOutside);
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

  _distBetweenSegments(p1, q1, p2, q2) {
    _segD1.subVectors(q1, p1);
    _segD2.subVectors(q2, p2);
    _segR.subVectors(p1, p2);

    const a = _segD1.dot(_segD1);
    const e = _segD2.dot(_segD2);
    const f = _segD2.dot(_segR);
    const EPS = 1e-8;
    let s;
    let t;

    if (a <= EPS && e <= EPS) {
      return p1.distanceTo(p2);
    }

    if (a <= EPS) {
      s = 0;
      t = THREE.MathUtils.clamp(f / e, 0, 1);
    } else {
      const c = _segD1.dot(_segR);
      if (e <= EPS) {
        t = 0;
        s = THREE.MathUtils.clamp(-c / a, 0, 1);
      } else {
        const b = _segD1.dot(_segD2);
        const denom = a * e - b * b;

        if (denom !== 0) {
          s = THREE.MathUtils.clamp((b * f - c * e) / denom, 0, 1);
        } else {
          s = 0;
        }

        const tNom = b * s + f;
        if (tNom < 0) {
          t = 0;
          s = THREE.MathUtils.clamp(-c / a, 0, 1);
        } else if (tNom > e) {
          t = 1;
          s = THREE.MathUtils.clamp((b - c) / a, 0, 1);
        } else {
          t = tNom / e;
        }
      }
    }

    _segC1.copy(_segD1).multiplyScalar(s).add(p1);
    _segC2.copy(_segD2).multiplyScalar(t).add(p2);
    return _segC1.distanceTo(_segC2);
  }

}
