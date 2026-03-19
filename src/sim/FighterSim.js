import * as THREE from 'three';
import { FighterStateMachine } from '../combat/FighterStateMachine.js';
import { DamageSystem } from '../combat/DamageSystem.js';
import { getAttackData } from '../combat/AttackData.js';
import { AUTHORITATIVE_TRACKS } from '../data/authoritativeTracks.js';
import {
  BODY_COLLISION,
  FACING_TUNING,
  HURT_CYLINDER,
  WEAPON_FALLBACKS,
  getBodyRadius,
  getDefaultWeaponClashRadius,
} from '../combat/CombatTuning.js';
import { WEAPON_STATS } from '../entities/WeaponData.js';
import {
  FighterState,
  AttackType,
  SIDESTEP_DASH_FRAMES,
  SIDESTEP_DASH_DISTANCE,
  BACKSTEP_FRAMES,
  BACKSTEP_DISTANCE,
  STEP_DISTANCE,
  STEP_FRAMES,
  STEP_COOLDOWN_FRAMES,
} from '../core/Constants.js';
import { angleDelta, distance2D, moveAngleTowards } from '../utils/MathUtils.js';

const _relativeVelocity = new THREE.Vector3();
const _pointVelocity = new THREE.Vector3();
const _pointToTarget = new THREE.Vector3();
const _selfBodyPosition = new THREE.Vector3();
const _opponentBodyPosition = new THREE.Vector3();
const _weaponBase = new THREE.Vector3();
const _weaponTip = new THREE.Vector3();
const _sampledBase = new THREE.Vector3();
const _sampledTip = new THREE.Vector3();

const SIM_ATTACK_FRAMES = Object.freeze({
  spearman: Object.freeze({
    [AttackType.QUICK]: 37,
    [AttackType.HEAVY]: 43,
    [AttackType.THRUST]: 34,
  }),
  ronin: Object.freeze({
    [AttackType.QUICK]: 37,
    [AttackType.HEAVY]: 47,
    [AttackType.THRUST]: 27,
  }),
});

const SIM_WEAPON_POSE = Object.freeze({
  idle: Object.freeze({
    [AttackType.QUICK]: { yawStart: 0, yawEnd: 0, reachStart: 0.85, reachEnd: 0.85, liftStart: 0.12, liftEnd: 0.12 },
    [AttackType.HEAVY]: { yawStart: 0, yawEnd: 0, reachStart: 0.85, reachEnd: 0.85, liftStart: 0.12, liftEnd: 0.12 },
    [AttackType.THRUST]: { yawStart: 0, yawEnd: 0, reachStart: 0.85, reachEnd: 0.85, liftStart: 0.12, liftEnd: 0.12 },
  }),
  katana: Object.freeze({
    [AttackType.QUICK]: {
      yawStart: -0.95, yawEnd: 0.55, reachStart: 0.95, reachEnd: 1.25, liftStart: 0.20, liftEnd: 0.08,
      windupLead: 0.08, recoveryEnd: 0.42,
    },
    [AttackType.HEAVY]: {
      yawStart: -1.25, yawEnd: 0.95, reachStart: 1.00, reachEnd: 1.35, liftStart: 0.45, liftEnd: 0.15,
      windupLead: 0.10, recoveryEnd: 0.30,
    },
    [AttackType.THRUST]: {
      yawStart: -0.10, yawEnd: 0.08, reachStart: 1.15, reachEnd: 1.75, liftStart: 0.18, liftEnd: 0.10,
      windupLead: 0.22, recoveryEnd: 0.60,
    },
  }),
  spear: Object.freeze({
    [AttackType.QUICK]: {
      yawStart: -0.45, yawEnd: 0.32, reachStart: 1.80, reachEnd: 2.05, liftStart: 0.08, liftEnd: 0.02,
      windupLead: 0.10, recoveryEnd: 0.55,
    },
    [AttackType.HEAVY]: {
      yawStart: -0.82, yawEnd: 0.82, reachStart: 1.90, reachEnd: 2.20, liftStart: 0.28, liftEnd: 0.08,
      windupLead: 0.12, recoveryEnd: 0.34,
    },
    [AttackType.THRUST]: {
      yawStart: -0.04, yawEnd: 0.04, reachStart: 2.00, reachEnd: 2.50, liftStart: 0.04, liftEnd: 0.00,
      windupLead: 0.18, recoveryEnd: 0.72,
    },
  }),
});

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeOutCubic(t) {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return 1 - ((1 - clamped) ** 3);
}

function easeInOutQuad(t) {
  const clamped = THREE.MathUtils.clamp(t, 0, 1);
  return clamped < 0.5
    ? 2 * clamped * clamped
    : 1 - (((-2 * clamped + 2) ** 2) / 2);
}

export class FighterSim {
  constructor(playerIndex, charId, charDef) {
    this.playerIndex = playerIndex;
    this.isP2 = playerIndex === 1;
    this.charId = charId;
    this.charDef = charDef;
    this.weaponType = charDef.weaponType;

    this.group = new THREE.Group();
    this.root = new THREE.Group();
    this.visualRoot = new THREE.Group();
    this.position = this.group.position;
    this.facingRight = !this.isP2;

    this.mixer = null;
    this.clipActions = {};
    this.activeClipName = 'idle';

    this.damageSystem = new DamageSystem();
    this.fsm = new FighterStateMachine(this);

    this.walkPhase = 0;
    this._stepping = false;
    this._stepFrames = 0;
    this._stepDirection = 0;
    this._stepCooldown = 0;
    this.knockbackMult = 1;
    this._debugCollision = null;
    this._wasAttacking = false;
    this._postAttackTurnTime = 0;

    this._tipWorldPosition = new THREE.Vector3();
    this._tipVelocity = new THREE.Vector3();
    this._baseWorldPosition = new THREE.Vector3();
    this._baseVelocity = new THREE.Vector3();
    this._tipMotionInitialized = false;
    this.authoritativeTracks = AUTHORITATIVE_TRACKS.characters?.[charId] ?? null;

    this.resetForRound(playerIndex === 0 ? -2.5 : 2.5);
  }

  get state() { return this.fsm.state; }
  get stateFrames() { return this.fsm.stateFrames; }
  get currentAttackData() { return this.fsm.currentAttackData; }
  get currentAttackType() { return this.fsm.currentAttackType; }
  get hitApplied() { return this.fsm.hitApplied; }
  set hitApplied(v) { this.fsm.hitApplied = v; }

  update(dt, opponent) {
    this.fsm.update();

    if (opponent) {
      this.getBodyCollisionPosition(_selfBodyPosition);
      opponent.getBodyCollisionPosition(_opponentBodyPosition);
      const dx = _opponentBodyPosition.x - _selfBodyPosition.x;
      const dz = _opponentBodyPosition.z - _selfBodyPosition.z;
      if ((dx * dx + dz * dz) > 1e-6) {
        const desiredYaw = Math.atan2(dx, dz);
        const yawDelta = Math.abs(angleDelta(this.group.rotation.y, desiredYaw));
        const justExitedAttack = this._wasAttacking && !this.fsm.isAttacking;

        if (justExitedAttack && yawDelta >= FACING_TUNING.postAttackTurnMinDelta) {
          this._postAttackTurnTime = FACING_TUNING.postAttackTurnMaxDuration;
        }

        this.facingRight = dx >= 0;

        if (!this.fsm.isAttacking) {
          if (this._postAttackTurnTime > 0) {
            const maxStep = FACING_TUNING.postAttackTurnRate * dt;
            this.group.rotation.y = moveAngleTowards(this.group.rotation.y, desiredYaw, maxStep);
            this._postAttackTurnTime = Math.max(0, this._postAttackTurnTime - dt);
            if (Math.abs(angleDelta(this.group.rotation.y, desiredYaw)) <= FACING_TUNING.postAttackTurnStopDelta) {
              this.group.rotation.y = desiredYaw;
              this._postAttackTurnTime = 0;
            }
          } else {
            this.group.rotation.y = desiredYaw;
          }
        }
      } else {
        this._postAttackTurnTime = 0;
      }
    } else {
      this._postAttackTurnTime = 0;
    }

    this._updateVirtualClipName();

    if (this.state === FighterState.ATTACK_ACTIVE && this.currentAttackData) {
      const atk = this.currentAttackData;
      const startFrac = atk.lungeStart ?? 0;
      const endFrac = atk.lungeEnd ?? (atk.lungeRatio || 1);
      const attackFrames = Math.max(this.fsm.stateDuration, 1);
      const startFrame = attackFrames * startFrac;
      const endFrame = attackFrames * endFrac;
      const lungeFrames = endFrame - startFrame;
      if (lungeFrames > 0 && this.stateFrames >= startFrame && this.stateFrames < endFrame) {
        const lungeSpeed = atk.lunge / lungeFrames * 60;
        const angle = this.group.rotation.y;
        this.position.x += Math.sin(angle) * lungeSpeed * dt;
        this.position.z += Math.cos(angle) * lungeSpeed * dt;
      }
    }

    if (this.state === FighterState.SIDESTEP && this.fsm.sidestepPhase === 'dash') {
      const sidestepDistance = this.charDef.sidestepDistance ?? SIDESTEP_DASH_DISTANCE;
      const sidestepFrames = this.charDef.sidestepFrames ?? SIDESTEP_DASH_FRAMES;
      const speed = sidestepDistance / sidestepFrames * 60;
      const angle = this.group.rotation.y;
      const perpX = -Math.cos(angle) * this.fsm.sidestepDirection;
      const perpZ = Math.sin(angle) * this.fsm.sidestepDirection;
      this.position.x += perpX * speed * dt;
      this.position.z += perpZ * speed * dt;
    }

    if (this.state === FighterState.DODGE) {
      const backstepDistance = this.charDef.backstepDistance ?? BACKSTEP_DISTANCE;
      const backstepFrames = this.charDef.backstepFrames ?? BACKSTEP_FRAMES;
      const speed = backstepDistance / backstepFrames * 60;
      const angle = this.group.rotation.y;
      this.position.x -= Math.sin(angle) * speed * dt;
      this.position.z -= Math.cos(angle) * speed * dt;
    }

    if (this.state === FighterState.WALK_FORWARD || this.state === FighterState.WALK_BACK) {
      this.walkPhase += dt * 8;
    }

    this._updateTipMotion();
    this._wasAttacking = this.fsm.isAttacking;
  }

  syncStatePresentation() {}

  applyMovementInput(direction, opponent, dt) {
    if (!opponent) return false;
    if (this.state === FighterState.DEAD || this.state === FighterState.DYING) return false;

    this.getBodyCollisionPosition(_selfBodyPosition);
    opponent.getBodyCollisionPosition(_opponentBodyPosition);
    const dx = _opponentBodyPosition.x - _selfBodyPosition.x;
    const dz = _opponentBodyPosition.z - _selfBodyPosition.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
    const nx = dx / dist;
    const nz = dz / dist;
    const desiredDirection = Math.sign(direction);

    let isMoving = false;

    if (this._stepping) {
      const stepDistance = this.charDef.stepDistance ?? STEP_DISTANCE;
      const stepFrames = this.charDef.stepFrames ?? STEP_FRAMES;
      const stepSpeed = stepDistance / stepFrames * 60;
      this.position.x += nx * this._stepDirection * stepSpeed * dt;
      this.position.z += nz * this._stepDirection * stepSpeed * dt;
      this._stepFrames++;
      isMoving = true;

      if (this._stepFrames >= stepFrames) {
        this._stepping = false;
        this._stepFrames = 0;
        this._stepCooldown = STEP_COOLDOWN_FRAMES;
      }
    }

    if (this._stepCooldown > 0) {
      this._stepCooldown--;
    }

    if (!this._stepping && desiredDirection !== 0 && this._stepCooldown <= 0 && this.fsm.isActionable) {
      this._stepping = true;
      this._stepFrames = 0;
      this._stepDirection = desiredDirection;
      this.fsm.transition(desiredDirection > 0 ? FighterState.WALK_FORWARD : FighterState.WALK_BACK);
      isMoving = true;
    }

    if (!isMoving && !this._stepping && this._stepCooldown <= 0 && this.fsm.isActionable) {
      this.stopMoving();
    }

    return isMoving;
  }

  sidestep(direction) {
    return this.fsm.startSidestep(direction);
  }

  backstep() {
    return this.fsm.startBackstep();
  }

  stopMoving() {
    if (this.state === FighterState.WALK_FORWARD || this.state === FighterState.WALK_BACK) {
      this.fsm.transition(FighterState.IDLE);
    }
  }

  attack(type) {
    const frames = this._getAttackFrameCount(type);
    return this.fsm.startAttack(type, frames);
  }

  block() {
    return this.fsm.startBlock();
  }

  parry() {
    return this.fsm.startParry();
  }

  distanceTo(other) {
    this.getBodyCollisionPosition(_selfBodyPosition);
    other.getBodyCollisionPosition(_opponentBodyPosition);
    return distance2D(
      _selfBodyPosition.x, _selfBodyPosition.z,
      _opponentBodyPosition.x, _opponentBodyPosition.z,
    );
  }

  getBodyAnchorWorldPosition(target = new THREE.Vector3()) {
    return target.copy(this.position).setY(this.position.y + BODY_COLLISION.centerHeight);
  }

  getBodyCollisionPosition(target = new THREE.Vector3()) {
    return target.copy(this.position).setY(this.position.y);
  }

  getHurtCenterWorldPosition(target = new THREE.Vector3()) {
    return target.copy(this.position).setY(this.position.y + BODY_COLLISION.centerHeight);
  }

  getWeaponBaseWorldPosition(target = new THREE.Vector3()) {
    this._computeWeaponPose(_weaponBase, _weaponTip);
    return target.copy(_weaponBase);
  }

  getWeaponTipWorldPosition(target = new THREE.Vector3()) {
    this._computeWeaponPose(_weaponBase, _weaponTip);
    return target.copy(_weaponTip);
  }

  getWeaponPointWorldPosition(target = new THREE.Vector3(), t = 1) {
    const clampedT = THREE.MathUtils.clamp(t, 0, 1);
    this._computeWeaponPose(_weaponBase, _weaponTip);
    return target.lerpVectors(_weaponBase, _weaponTip, clampedT);
  }

  getWeaponPointVelocityToward(target, t = 1, relativeToBase = false) {
    _pointVelocity.lerpVectors(this._baseVelocity, this._tipVelocity, THREE.MathUtils.clamp(t, 0, 1));
    if (relativeToBase) _pointVelocity.sub(this._baseVelocity);
    _pointToTarget.subVectors(target, this.getWeaponPointWorldPosition(new THREE.Vector3(), t));
    if (_pointToTarget.lengthSq() < 1e-6) return 0;
    _pointToTarget.normalize();
    return _pointVelocity.dot(_pointToTarget);
  }

  getWeaponPointSpeed(t = 1, relativeToBase = false) {
    _pointVelocity.lerpVectors(this._baseVelocity, this._tipVelocity, THREE.MathUtils.clamp(t, 0, 1));
    if (relativeToBase) _pointVelocity.sub(this._baseVelocity);
    return _pointVelocity.length();
  }

  getTipRelativeVelocityToward(target) {
    _relativeVelocity.subVectors(this._tipVelocity, this._baseVelocity);
    _pointToTarget.subVectors(target, this._tipWorldPosition);
    if (_pointToTarget.lengthSq() < 1e-6) return 0;
    _pointToTarget.normalize();
    return _relativeVelocity.dot(_pointToTarget);
  }

  getTipRelativeForwardSpeed() {
    _relativeVelocity.subVectors(this._tipVelocity, this._baseVelocity);
    _pointToTarget.subVectors(this._tipWorldPosition, this._baseWorldPosition);
    if (_pointToTarget.lengthSq() < 1e-6) return 0;
    _pointToTarget.normalize();
    return _relativeVelocity.dot(_pointToTarget);
  }

  getTipRelativeSpeed() {
    _relativeVelocity.subVectors(this._tipVelocity, this._baseVelocity);
    return _relativeVelocity.length();
  }

  getDebugSnapshot(opponent = null) {
    const weaponTip = this.getWeaponTipWorldPosition(new THREE.Vector3());
    const weaponBase = this.getWeaponBaseWorldPosition(new THREE.Vector3());
    const hurtCenter = this.getHurtCenterWorldPosition(new THREE.Vector3());
    const bodyCollision = this.getBodyCollisionPosition(new THREE.Vector3());
    let tipRelativeToward = 0;
    if (opponent) {
      opponent.getHurtCenterWorldPosition(_opponentBodyPosition);
      tipRelativeToward = this.getTipRelativeVelocityToward(_opponentBodyPosition);
    }

    return {
      charName: this.charDef.displayName || 'Unknown',
      weaponType: this.weaponType,
      state: this.state,
      stateFrames: this.stateFrames,
      attackType: this.currentAttackType,
      activeClip: this.activeClipName,
      hitApplied: this.hitApplied,
      position: { x: this.position.x, y: this.position.y, z: this.position.z },
      rotationY: this.group.rotation.y,
      facingRight: this.facingRight,
      stepping: this._stepping,
      stepDirection: this._stepDirection,
      stepFrames: this._stepFrames,
      stepCooldown: this._stepCooldown,
      actionable: this.fsm.isActionable,
      attacking: this.fsm.isAttacking,
      sidestepPhase: this.fsm.sidestepPhase,
      dead: this.damageSystem.isDead(),
      tipSpeed: this._tipVelocity.length(),
      baseSpeed: this._baseVelocity.length(),
      tipRelativeToward,
      tipRelativeForward: this.getTipRelativeForwardSpeed(),
      tipRelativeSpeed: this.getTipRelativeSpeed(),
      weaponBase: { x: weaponBase.x, y: weaponBase.y, z: weaponBase.z },
      weaponTip: { x: weaponTip.x, y: weaponTip.y, z: weaponTip.z },
      bodyCollision: { x: bodyCollision.x, y: bodyCollision.y, z: bodyCollision.z },
      hurtCenter: { x: hurtCenter.x, y: hurtCenter.y, z: hurtCenter.z },
      weaponClashRadius: this.charDef.weaponClashRadius ?? getDefaultWeaponClashRadius(this.weaponType),
      hurtRadius: this._debugCollision?.hurtRadius ?? HURT_CYLINDER.radius,
      hurtHeight: this._debugCollision?.hurtHeight ?? HURT_CYLINDER.height,
      bodyRadius: getBodyRadius(this.charDef),
      collision: this._debugCollision ? { ...this._debugCollision } : null,
      headless: true,
    };
  }

  resetForRound(xPos) {
    this.position.set(xPos, 0, 0);
    this.group.rotation.y = xPos < 0 ? Math.PI / 2 : -Math.PI / 2;
    this.fsm.reset();
    this.damageSystem.reset();
    this.walkPhase = 0;
    this.knockbackMult = 1;
    this.activeClipName = 'idle';
    this._stepping = false;
    this._stepFrames = 0;
    this._stepDirection = 0;
    this._stepCooldown = 0;
    this._debugCollision = null;
    this._wasAttacking = false;
    this._postAttackTurnTime = 0;
    this._tipMotionInitialized = false;
    this._tipVelocity.set(0, 0, 0);
    this._baseVelocity.set(0, 0, 0);
    this._updateTipMotion();
  }

  addToScene() {}
  removeFromScene() {}
  startRagdoll() {}

  _updateVirtualClipName() {
    switch (this.state) {
      case FighterState.BLOCK:
      case FighterState.PARRY:
      case FighterState.PARRY_SUCCESS:
        this.activeClipName = 'block_parry';
        break;
      case FighterState.BLOCK_STUN:
        this.activeClipName = 'block_knockback';
        break;
      case FighterState.CLASH:
      case FighterState.HIT_STUN:
      case FighterState.PARRIED_STUN:
        this.activeClipName = 'clash_knockback';
        break;
      case FighterState.WALK_FORWARD:
        this.activeClipName = 'walk_forward';
        break;
      case FighterState.WALK_BACK:
        this.activeClipName = 'walk_backward';
        break;
      case FighterState.SIDESTEP:
        this.activeClipName = this.fsm.sidestepDirection > 0 ? 'strafe_right' : 'strafe_left';
        break;
      case FighterState.DODGE:
        this.activeClipName = 'backstep';
        break;
      case FighterState.ATTACK_ACTIVE:
        this.activeClipName = this.currentAttackType === AttackType.HEAVY
          ? 'attack_heavy'
          : this.currentAttackType === AttackType.THRUST
            ? 'attack_thrust'
            : 'attack_quick';
        break;
      default:
        this.activeClipName = 'idle';
        break;
    }
  }

  _updateTipMotion() {
    this._computeWeaponPose(_weaponBase, _weaponTip);
    if (this._tipMotionInitialized) {
      this._tipVelocity.subVectors(_weaponTip, this._tipWorldPosition);
      this._baseVelocity.subVectors(_weaponBase, this._baseWorldPosition);
    } else {
      this._tipVelocity.set(0, 0, 0);
      this._baseVelocity.set(0, 0, 0);
      this._tipMotionInitialized = true;
    }
    this._tipWorldPosition.copy(_weaponTip);
    this._baseWorldPosition.copy(_weaponBase);
  }

  _computeWeaponPose(baseTarget, tipTarget) {
    if (this._applyAuthoritativeWeaponPose(baseTarget, tipTarget)) {
      return;
    }

    const yaw = this.group.rotation.y;
    const stats = WEAPON_STATS[this.weaponType];
    const attackType = this.currentAttackType || AttackType.QUICK;
    const progress = this.fsm.isAttacking && this.fsm.stateDuration > 0
      ? THREE.MathUtils.clamp(this.stateFrames / this.fsm.stateDuration, 0, 1)
      : 0;
    const poseSet = this.weaponType === 'katana' ? SIM_WEAPON_POSE.katana : SIM_WEAPON_POSE.spear;
    const idlePose = SIM_WEAPON_POSE.idle[attackType];
    const pose = this.fsm.isAttacking ? poseSet[attackType] : idlePose;
    const attackData = this.currentAttackData ?? getAttackData(attackType, this.weaponType);
    const poseProgress = this.fsm.isAttacking
      ? this._getAttackPoseProgress(progress, attackData, pose)
      : 0;
    const yawOffset = lerp(pose.yawStart, pose.yawEnd, poseProgress);
    const reach = lerp(pose.reachStart, pose.reachEnd, poseProgress);
    const lift = lerp(pose.liftStart, pose.liftEnd, poseProgress);

    const sideOffset = this.weaponType === 'katana' ? 0.16 : 0.08;
    const sideSign = this.isP2 ? -1 : 1;
    const baseForward = this.weaponType === 'katana' ? 0.14 : 0.22;
    const baseHeight = WEAPON_FALLBACKS.baseHeight;

    const forwardX = Math.sin(yaw);
    const forwardZ = Math.cos(yaw);
    const rightX = Math.sin(yaw + Math.PI * 0.5);
    const rightZ = Math.cos(yaw + Math.PI * 0.5);

    baseTarget.copy(this.position);
    baseTarget.x += forwardX * baseForward + rightX * sideOffset * sideSign;
    baseTarget.z += forwardZ * baseForward + rightZ * sideOffset * sideSign;
    baseTarget.y = this.position.y + baseHeight;

    tipTarget.copy(baseTarget);
    tipTarget.x += Math.sin(yaw + yawOffset) * reach;
    tipTarget.z += Math.cos(yaw + yawOffset) * reach;
    tipTarget.y += lift;

    if (!this.fsm.isAttacking) {
      tipTarget.y += this.weaponType === 'katana' ? 0.12 : 0.04;
      tipTarget.x += forwardX * (stats.length * 0.12);
      tipTarget.z += forwardZ * (stats.length * 0.12);
    }
  }

  _getAttackPoseProgress(progress, attackData, pose) {
    const contactStart = THREE.MathUtils.clamp(attackData?.contactStart ?? 0.25, 0.01, 0.95);
    const contactEnd = THREE.MathUtils.clamp(attackData?.contactEnd ?? 0.75, contactStart + 0.01, 0.99);
    const windupLead = pose?.windupLead ?? 0.1;
    const recoveryEnd = pose?.recoveryEnd ?? 0.4;

    if (progress <= contactStart) {
      const t = progress / contactStart;
      return lerp(0, windupLead, easeOutCubic(t));
    }

    if (progress <= contactEnd) {
      const t = (progress - contactStart) / (contactEnd - contactStart);
      return lerp(windupLead, 1, easeInOutQuad(t));
    }

    const recoverySpan = Math.max(1 - contactEnd, 1e-3);
    const t = (progress - contactEnd) / recoverySpan;
    return lerp(1, recoveryEnd, easeInOutQuad(t));
  }

  _getAttackFrameCount(attackType) {
    const clipName = this._getAttackClipName(attackType);
    const authoritativeClip = clipName ? this.authoritativeTracks?.clips?.[clipName] : null;
    if (authoritativeClip?.frameCount) {
      return authoritativeClip.frameCount;
    }
    return SIM_ATTACK_FRAMES[this.charId]?.[attackType] ?? 30;
  }

  _getAttackClipName(attackType = this.currentAttackType) {
    if (attackType === AttackType.HEAVY) return 'attack_heavy';
    if (attackType === AttackType.THRUST) return 'attack_thrust';
    return 'attack_quick';
  }

  _getSampledWeaponClip() {
    if (!this.authoritativeTracks?.clips) return null;
    if (this.fsm.isAttacking) {
      return this.authoritativeTracks.clips[this._getAttackClipName()];
    }
    return this.authoritativeTracks.clips.idle ?? null;
  }

  _applyAuthoritativeWeaponPose(baseTarget, tipTarget) {
    const clip = this._getSampledWeaponClip();
    if (!clip?.frames?.length) return false;

    const frameCount = clip.frames.length;
    const frameIndex = this.fsm.isAttacking
      ? THREE.MathUtils.clamp(this.stateFrames - 1, 0, frameCount - 1)
      : Math.floor((this.walkPhase * 60) % frameCount);
    const frame = clip.frames[frameIndex];
    if (!frame) return false;

    _sampledBase.fromArray(frame.base);
    _sampledTip.fromArray(frame.tip);
    this._localToWorld(_sampledBase, baseTarget);
    this._localToWorld(_sampledTip, tipTarget);
    return true;
  }

  _localToWorld(localPoint, target) {
    const yaw = this.group.rotation.y;
    const sinYaw = Math.sin(yaw);
    const cosYaw = Math.cos(yaw);
    const x = localPoint.x;
    const y = localPoint.y;
    const z = localPoint.z;
    target.set(
      this.position.x + (x * cosYaw) + (z * sinYaw),
      this.position.y + y,
      this.position.z - (x * sinYaw) + (z * cosYaw),
    );
    return target;
  }
}
