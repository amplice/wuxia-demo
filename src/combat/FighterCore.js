import * as THREE from 'three';
import { FighterStateMachine } from './FighterStateMachine.js';
import { DamageSystem } from './DamageSystem.js';
import {
  BODY_COLLISION,
  FACING_TUNING,
  HURT_CYLINDER,
  getBodyRadius,
  getDefaultWeaponClashRadius,
} from './CombatTuning.js';
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

export class FighterCore {
  constructor(playerIndex, charId, charDef) {
    this.playerIndex = playerIndex;
    this.isP2 = playerIndex === 1;
    this.charId = charId;
    this.charDef = charDef;
    this.weaponType = charDef.weaponType;

    this.group = new THREE.Group();
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
  }

  get state() { return this.fsm.state; }
  get stateFrames() { return this.fsm.stateFrames; }
  get currentAttackData() { return this.fsm.currentAttackData; }
  get currentAttackType() { return this.fsm.currentAttackType; }
  get hitApplied() { return this.fsm.hitApplied; }
  set hitApplied(v) { this.fsm.hitApplied = v; }

  _beginUpdateCore(dt, opponent) {
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
  }

  _finishUpdateCore() {
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

    if (
      !this._stepping &&
      this._stepCooldown > 0 &&
      this.charDef.idleDuringStepCooldown &&
      this.fsm.isActionable
    ) {
      this.stopMoving();
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
    this.getBodyAnchorWorldPosition(target);
    target.y = this.position.y;
    return target;
  }

  getHurtCenterWorldPosition(target = new THREE.Vector3()) {
    this.getBodyAnchorWorldPosition(target);
    target.y = this.position.y + BODY_COLLISION.centerHeight;
    return target;
  }

  getWeaponBaseWorldPosition(target = new THREE.Vector3()) {
    return target.copy(this.position).setY(this.position.y + BODY_COLLISION.centerHeight);
  }

  getWeaponTipWorldPosition(target = new THREE.Vector3()) {
    return target.copy(this.position).setY(this.position.y + BODY_COLLISION.centerHeight);
  }

  getWeaponPointWorldPosition(target = new THREE.Vector3(), t = 1) {
    const clampedT = THREE.MathUtils.clamp(t, 0, 1);
    const base = this.getWeaponBaseWorldPosition(_weaponBase);
    const tip = this.getWeaponTipWorldPosition(_weaponTip);
    return target.lerpVectors(base, tip, clampedT);
  }

  getWeaponPointVelocityToward(target, t = 1, relativeToBase = false) {
    _pointVelocity.lerpVectors(this._baseVelocity, this._tipVelocity, THREE.MathUtils.clamp(t, 0, 1));
    if (relativeToBase) _pointVelocity.sub(this._baseVelocity);
    _pointToTarget.subVectors(target, this.getWeaponPointWorldPosition(_weaponTip, t));
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
    const bodyCollision = this.getBodyCollisionPosition(new THREE.Vector3());
    const hurtCenter = this.getHurtCenterWorldPosition(new THREE.Vector3());
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
      ...this._getDebugSnapshotExtras(),
    };
  }

  _getDebugSnapshotExtras() {
    return {};
  }

  _resetCoreState(xPos) {
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
  }

  _applySnapshotCore(snapshot, getAttackDataForType = null, options = {}) {
    if (!snapshot) return;
    const { applyTransform = true } = options;

    if (applyTransform) {
      this.position.set(
        snapshot.position?.x ?? this.position.x,
        snapshot.position?.y ?? this.position.y,
        snapshot.position?.z ?? this.position.z,
      );
      this.group.rotation.y = snapshot.rotationY ?? this.group.rotation.y;
    }
    this.facingRight = snapshot.facingRight ?? this.facingRight;

    this.fsm.state = snapshot.state ?? this.fsm.state;
    this.fsm.stateFrames = snapshot.stateFrames ?? this.fsm.stateFrames;
    this.fsm.stateDuration = snapshot.stateDuration ?? this.fsm.stateDuration;
    this.fsm.currentAttackType = snapshot.currentAttackType ?? null;
    this.fsm.currentAttackData = (this.fsm.currentAttackType && getAttackDataForType)
      ? getAttackDataForType(this.fsm.currentAttackType)
      : null;
    this.fsm.hitApplied = Boolean(snapshot.hitApplied);

    this.damageSystem.alive = !snapshot.dead;
  }

  _updateTipMotion() {
    const tip = this.getWeaponTipWorldPosition(_weaponTip);
    const base = this.getWeaponBaseWorldPosition(_weaponBase);
    if (this._tipMotionInitialized) {
      this._tipVelocity.subVectors(tip, this._tipWorldPosition);
      this._baseVelocity.subVectors(base, this._baseWorldPosition);
    } else {
      this._tipVelocity.set(0, 0, 0);
      this._baseVelocity.set(0, 0, 0);
      this._tipMotionInitialized = true;
    }
    this._tipWorldPosition.copy(tip);
    this._baseWorldPosition.copy(base);
  }

  _getAttackFrameCount() {
    return 30;
  }

  _getPresentationClip(resolveClipName) {
    const resolve = resolveClipName ?? ((...names) => names[names.length - 1]);
    let clipName = 'idle';
    let loopOnce = false;

    switch (this.state) {
      case FighterState.IDLE:
        clipName = resolve('idle');
        break;
      case FighterState.BLOCK:
        clipName = resolve('block_parry', 'idle');
        loopOnce = true;
        break;
      case FighterState.BLOCK_STUN:
        clipName = resolve('block_knockback', 'idle');
        loopOnce = true;
        break;
      case FighterState.PARRY:
        clipName = resolve('block_parry', 'idle');
        loopOnce = true;
        break;
      case FighterState.PARRY_SUCCESS:
        clipName = resolve('block_parry', 'idle');
        loopOnce = true;
        break;
      case FighterState.PARRIED_STUN:
        clipName = resolve('clash_knockback', 'idle');
        loopOnce = true;
        break;
      case FighterState.HIT_STUN:
        clipName = resolve('clash_knockback', 'idle');
        loopOnce = true;
        break;
      case FighterState.DODGE:
        clipName = resolve('backstep', 'idle');
        loopOnce = true;
        break;
      case FighterState.CLASH:
        clipName = resolve('clash_knockback', 'idle');
        loopOnce = true;
        break;
      case FighterState.WALK_FORWARD:
        clipName = resolve('walk_forward', 'walk_right');
        break;
      case FighterState.WALK_BACK:
        clipName = resolve('walk_backward', 'walk_left');
        break;
      case FighterState.SIDESTEP:
        clipName = this.fsm.sidestepDirection > 0
          ? resolve('strafe_right', 'walk_right', 'walk_forward')
          : resolve('strafe_left', 'walk_left', 'walk_backward');
        break;
      case FighterState.ATTACK_ACTIVE:
        if (this.fsm.currentAttackType === AttackType.THRUST) {
          clipName = resolve('attack_thrust', 'attack');
        } else if (this.fsm.currentAttackType === AttackType.HEAVY) {
          clipName = resolve('attack_heavy', 'attack');
        } else {
          clipName = resolve('attack_quick', 'attack');
        }
        loopOnce = true;
        break;
      case FighterState.DYING:
      case FighterState.DEAD:
        clipName = resolve('idle');
        break;
    }

    return { clipName, loopOnce };
  }
}
