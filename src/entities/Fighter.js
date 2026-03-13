import * as THREE from 'three';
import { ModelLoader } from './ModelLoader.js';
import { Weapon } from './Weapon.js';
import { FighterStateMachine } from '../combat/FighterStateMachine.js';
import { DamageSystem } from '../combat/DamageSystem.js';
import { TrailEffect } from '../animation/TrailEffect.js';
import {
  FighterState, AttackType, WeaponType,
  SIDESTEP_DASH_FRAMES, SIDESTEP_DASH_DISTANCE,
  BACKSTEP_FRAMES, BACKSTEP_DISTANCE,
  STEP_DISTANCE, STEP_FRAMES, STEP_COOLDOWN_FRAMES,
} from '../core/Constants.js';
import { distance2D } from '../utils/MathUtils.js';

const _relativeVelocity = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _spearForward = new THREE.Vector3();
const _debugOpponentCenter = new THREE.Vector3();
const _selfBodyPosition = new THREE.Vector3();
const _opponentBodyPosition = new THREE.Vector3();

export class Fighter {
  constructor(playerIndex, color, charDef, animData) {
    this.playerIndex = playerIndex;
    this.isP2 = playerIndex === 1;
    this.charDef = charDef;
    this.weaponType = charDef.weaponType;

    this.mixer = null;
    this.clipActions = {};
    this.activeClipName = null;

    const tint = this.isP2 ? 0xaabbff : 0xffcccc;
    const result = ModelLoader.createFighterFromGLB(
      animData.model, animData.clips, tint, animData.texture
    );
    const root = result.root;
    const joints = result.joints;
    this.mixer = result.mixer;
    this.clipActions = result.actions;

    // Apply model-specific root rotation (e.g. Mixamo models face -Z, need PI flip)
    if (charDef.rootRotationY) {
      root.rotation.y = charDef.rootRotationY;
    }

    this.root = root;
    this.joints = joints;

    this.group = new THREE.Group();
    this.group.add(this.root);

    this.weapon = new Weapon(this.weaponType);

    const trailColor = this.isP2 ? 0x4488ff : 0xff4444;
    this.trail = new TrailEffect(trailColor);

    // Systems
    this.damageSystem = new DamageSystem();
    this.fsm = new FighterStateMachine(this);

    // State indicators (floating shapes above head)
    this._stateIndicator = this._createStateIndicators();
    this.group.add(this._stateIndicator.group);

    // Position
    this.position = this.group.position;
    this.facingRight = !this.isP2;

    // Walk cycle timer
    this.walkPhase = 0;

    // Discrete step state
    this._stepping = false;
    this._stepFrames = 0;
    this._stepDirection = 0; // +1 = toward, -1 = away
    this._stepCooldown = 0;

    // Knockback multiplier (set by Game on clash/block for heavy advantage)
    this.knockbackMult = 1;

    // Ragdoll state
    this._ragdoll = null;

    this._tipWorldPosition = new THREE.Vector3();
    this._tipVelocity = new THREE.Vector3();
    this._baseWorldPosition = new THREE.Vector3();
    this._baseVelocity = new THREE.Vector3();
    this._tipMotionInitialized = false;
    this._debugCollision = null;
  }

  _createStateIndicators() {
    const g = new THREE.Group();
    g.position.y = 2.2;

    const blockGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const blockMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.8 });
    const block = new THREE.Mesh(blockGeo, blockMat);
    block.visible = false;
    g.add(block);

    const parryGeo = new THREE.ConeGeometry(0.15, 0.25, 4);
    const parryMat = new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 0.9 });
    const parry = new THREE.Mesh(parryGeo, parryMat);
    parry.visible = false;
    g.add(parry);

    const successGeo = new THREE.OctahedronGeometry(0.15);
    const successMat = new THREE.MeshBasicMaterial({ color: 0x44ff44, transparent: true, opacity: 0.9 });
    const success = new THREE.Mesh(successGeo, successMat);
    success.visible = false;
    g.add(success);

    return { group: g, block, parry, success };
  }

  get state() { return this.fsm.state; }
  get stateFrames() { return this.fsm.stateFrames; }
  get currentAttackData() { return this.fsm.currentAttackData; }
  get currentAttackType() { return this.fsm.currentAttackType; }
  get hitApplied() { return this.fsm.hitApplied; }
  set hitApplied(v) { this.fsm.hitApplied = v; }

  _syncWorldMatrices() {
    this.group.updateWorldMatrix(true, true);
  }

  update(dt, opponent) {
    // Ragdoll physics override
    if (this._ragdoll) {
      this._updateRagdoll(dt);
      if (this.mixer) this.mixer.update(dt);
      this._updateTrail();
      this._updateTipMotion();
      return;
    }

    // Face toward opponent — but lock facing and rotation during attacks
    if (opponent && !this.fsm.isAttacking) {
      this.getBodyCollisionPosition(_selfBodyPosition);
      opponent.getBodyCollisionPosition(_opponentBodyPosition);
      const dx = _opponentBodyPosition.x - _selfBodyPosition.x;
      const dz = _opponentBodyPosition.z - _selfBodyPosition.z;
      if ((dx * dx + dz * dz) > 1e-6) {
        this.facingRight = dx >= 0;
        this.group.rotation.y = Math.atan2(dx, dz);
      }
    }

    // Update FSM
    this.fsm.update();

    // Update animation based on state
    this._updateClipAnimation();

    // Attack lunge — move toward opponent during active frames
    if (this.state === FighterState.ATTACK_ACTIVE && this.currentAttackData) {
      const atk = this.currentAttackData;
      const startFrac = atk.lungeStart ?? 0;
      const endFrac = atk.lungeEnd ?? (atk.lungeRatio || 1.0);
      const startFrame = atk.active * startFrac;
      const endFrame = atk.active * endFrac;
      const lungeFrames = endFrame - startFrame;
      if (lungeFrames > 0 && this.stateFrames >= startFrame && this.stateFrames < endFrame) {
        const lungeSpeed = atk.lunge / lungeFrames * 60;
        const angle = this.group.rotation.y;
        this.position.x += Math.sin(angle) * lungeSpeed * dt;
        this.position.z += Math.cos(angle) * lungeSpeed * dt;
      }
    }

    // Sidestep movement — perpendicular to facing direction
    if (this.state === FighterState.SIDESTEP && this.fsm.sidestepPhase === 'dash') {
      const sidestepDistance = this.charDef.sidestepDistance ?? SIDESTEP_DASH_DISTANCE;
      const speed = sidestepDistance / SIDESTEP_DASH_FRAMES * 60;
      const angle = this.group.rotation.y;
      const perpX = -Math.cos(angle) * this.fsm.sidestepDirection;
      const perpZ = Math.sin(angle) * this.fsm.sidestepDirection;
      this.position.x += perpX * speed * dt;
      this.position.z += perpZ * speed * dt;
    }

    // Backstep movement — away from opponent
    if (this.state === FighterState.DODGE) {
      const speed = BACKSTEP_DISTANCE / BACKSTEP_FRAMES * 60;
      const angle = this.group.rotation.y;
      this.position.x -= Math.sin(angle) * speed * dt;
      this.position.z -= Math.cos(angle) * speed * dt;
    }

    // Update mixer for clip-based animations
    if (this.mixer) {
      this.mixer.update(dt);
    }

    // Update trail
    this._updateTrail();

    // Update state indicators
    this._updateStateIndicators();

    this._updateTipMotion();

    // Walk animation phase
    if (this.state === FighterState.WALK_FORWARD || this.state === FighterState.WALK_BACK) {
      this.walkPhase += dt * 8;
    }
  }

  getWeaponTipWorldPosition(target = new THREE.Vector3()) {
    this._syncWorldMatrices();
    const tipJoint = this.joints.weaponTip || this.joints.spearTip;
    if (tipJoint) {
      return tipJoint.getWorldPosition(target);
    }
    return target.copy(this.weapon.getTipWorldPosition());
  }

  getWeaponBaseWorldPosition(target = new THREE.Vector3()) {
    this._syncWorldMatrices();
    const handJoint = this.joints.handR || this.joints.handL;
    if (handJoint) {
      return handJoint.getWorldPosition(target);
    }
    return target.copy(this.position).setY(1.2);
  }

  getBodyAnchorWorldPosition(target = new THREE.Vector3()) {
    this._syncWorldMatrices();
    const bodyAnchorLocalOffset = this.joints.bodyAnchorLocalOffset;
    if (bodyAnchorLocalOffset) {
      return this.root.localToWorld(target.copy(bodyAnchorLocalOffset));
    }
    const bodyAnchor = this.joints.bodyAnchor;
    if (bodyAnchor) {
      return bodyAnchor.getWorldPosition(target);
    }
    return target.copy(this.position).setY(0.9);
  }

  getBodyCollisionPosition(target = new THREE.Vector3()) {
    this.getBodyAnchorWorldPosition(target);
    target.y = this.position.y;
    return target;
  }

  getHurtCenterWorldPosition(target = new THREE.Vector3()) {
    this.getBodyAnchorWorldPosition(target);
    target.y = this.position.y + 0.9;
    return target;
  }

  getTipRelativeVelocityToward(target) {
    _relativeVelocity.subVectors(this._tipVelocity, this._baseVelocity);
    _toTarget.subVectors(target, this._tipWorldPosition);
    if (_toTarget.lengthSq() < 1e-6) return 0;
    _toTarget.normalize();
    return _relativeVelocity.dot(_toTarget);
  }

  getTipRelativeForwardSpeed() {
    _relativeVelocity.subVectors(this._tipVelocity, this._baseVelocity);
    _spearForward.subVectors(this._tipWorldPosition, this._baseWorldPosition);
    if (_spearForward.lengthSq() < 1e-6) return 0;
    _spearForward.normalize();
    return _relativeVelocity.dot(_spearForward);
  }

  getTipRelativeSpeed() {
    _relativeVelocity.subVectors(this._tipVelocity, this._baseVelocity);
    return _relativeVelocity.length();
  }

  _updateTipMotion() {
    const tip = this.getWeaponTipWorldPosition(new THREE.Vector3());
    const base = this.getWeaponBaseWorldPosition(new THREE.Vector3());
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
      const stepSpeed = STEP_DISTANCE / STEP_FRAMES * 60;
      this.position.x += nx * this._stepDirection * stepSpeed * dt;
      this.position.z += nz * this._stepDirection * stepSpeed * dt;
      this._stepFrames++;
      isMoving = true;

      if (this._stepFrames >= STEP_FRAMES) {
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

  _updateClipAnimation() {
    const state = this.state;
    let clipName = 'idle';
    let loopOnce = false;

    const pick = (...names) => {
      for (const n of names) {
        if (this.clipActions[n]) return n;
      }
      return names[names.length - 1];
    };

    switch (state) {
      case FighterState.IDLE:
        clipName = 'idle';
        break;

      case FighterState.BLOCK:
        clipName = pick('block_parry', 'idle');
        loopOnce = true;
        break;

      case FighterState.BLOCK_STUN:
        clipName = pick('block_knockback', 'idle');
        loopOnce = true;
        break;

      case FighterState.PARRY:
        clipName = pick('block_parry', 'idle');
        loopOnce = true;
        break;

      case FighterState.PARRY_SUCCESS:
        clipName = pick('block_parry', 'idle');
        loopOnce = true;
        break;

      case FighterState.PARRIED_STUN:
        clipName = pick('clash_knockback', 'idle');
        loopOnce = true;
        break;

      case FighterState.HIT_STUN:
        clipName = pick('clash_knockback', 'idle');
        loopOnce = true;
        break;

      case FighterState.DODGE:
        clipName = pick('backstep', 'idle');
        loopOnce = true;
        break;

      case FighterState.CLASH:
        clipName = pick('clash_knockback', 'idle');
        loopOnce = true;
        break;

      case FighterState.WALK_FORWARD:
        clipName = pick('walk_forward', 'walk_right');
        break;

      case FighterState.WALK_BACK:
        clipName = pick('walk_backward', 'walk_left');
        break;

      case FighterState.SIDESTEP:
        if (this.fsm.sidestepDirection > 0) {
          clipName = pick('strafe_right', 'walk_right', 'walk_forward');
        } else {
          clipName = pick('strafe_left', 'walk_left', 'walk_backward');
        }
        break;

      case FighterState.ATTACK_STARTUP:
      case FighterState.ATTACK_ACTIVE:
      case FighterState.ATTACK_RECOVERY: {
        const atkType = this.fsm.currentAttackType;
        if (atkType === AttackType.THRUST) {
          clipName = pick('attack_thrust', 'attack');
        } else if (atkType === AttackType.HEAVY) {
          clipName = pick('attack_heavy', 'attack');
        } else {
          clipName = pick('attack_quick', 'attack');
        }
        loopOnce = true;
        break;
      }

      case FighterState.DYING:
      case FighterState.DEAD:
        clipName = 'idle';
        break;
    }

    const action = this.clipActions[clipName];
    if (!action) return;

    if (clipName !== this.activeClipName) {
      const prevAction = this.clipActions[this.activeClipName];

      if (loopOnce) {
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat);
        action.clampWhenFinished = false;
      }

      action.reset();
      action.setEffectiveWeight(1);
      if (prevAction) {
        action.crossFadeFrom(prevAction, 0.15, true);
      }
      action.play();

      this.activeClipName = clipName;
    }
  }

  _updateTrail() {
    const isAttacking = this.state === FighterState.ATTACK_ACTIVE ||
                        this.state === FighterState.ATTACK_STARTUP ||
                        this.state === FighterState.ATTACK_RECOVERY;
    if (isAttacking && !this.trail.active) {
      this.trail.start();
    } else if (!isAttacking && this.trail.active) {
      this.trail.stop();
    }

    if (this.trail.active) {
      const tip = this.getWeaponTipWorldPosition(new THREE.Vector3());
      const base = this.getWeaponBaseWorldPosition(new THREE.Vector3());
      this.trail.update(tip, base);
    }
  }

  _updateStateIndicators() {
    const ind = this._stateIndicator;
    const s = this.state;

    const parryActive = s === FighterState.PARRY && this.fsm.stateFrames <= 5;
    const parryFallback = s === FighterState.PARRY && this.fsm.stateFrames > 5;
    ind.block.visible = (s === FighterState.BLOCK || s === FighterState.BLOCK_STUN || parryFallback);
    ind.parry.visible = parryActive;
    ind.success.visible = (s === FighterState.PARRY_SUCCESS);

    const time = performance.now() * 0.003;
    if (ind.parry.visible) ind.parry.rotation.y = time * 3;
    if (ind.success.visible) {
      ind.success.rotation.y = time * 4;
      ind.success.position.y = Math.sin(time * 5) * 0.05;
    }
    if (ind.block.visible) ind.block.rotation.y = time * 2;

    ind.group.rotation.y = -this.group.rotation.y;
  }

  sidestep(direction) {
    return this.fsm.startSidestep(direction);
  }

  backstep() {
    return this.fsm.startBackstep();
  }

  stopMoving() {
    if (this.state === FighterState.WALK_FORWARD ||
        this.state === FighterState.WALK_BACK) {
      this.fsm.transition(FighterState.IDLE);
    }
  }

  attack(type) {
    const result = this.fsm.startAttack(type);
    if (result) {
      let clipName;
      if (type === AttackType.THRUST) {
        clipName = this.clipActions.attack_thrust ? 'attack_thrust' : 'attack';
      } else if (type === AttackType.HEAVY) {
        clipName = this.clipActions.attack_heavy ? 'attack_heavy' : 'attack';
      } else {
        clipName = this.clipActions.attack_quick ? 'attack_quick' : 'attack';
      }
      const action = this.clipActions[clipName];
      if (action) {
        const hasSeparateClips = this.clipActions.attack_quick || this.clipActions.attack_heavy || this.clipActions.attack_thrust;
        const timeScale = (!hasSeparateClips && type === AttackType.HEAVY) ? 0.5 : 1.0;
        action.timeScale = timeScale;
        const clipDuration = action.getClip().duration / timeScale;
        const fsmFrames = Math.ceil(clipDuration * 60);
        this.fsm.currentAttackData = {
          ...this.fsm.currentAttackData,
          startup: 1,
          active: fsmFrames,
          recovery: 1,
        };
      }
    }
    return result;
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
      _opponentBodyPosition.x, _opponentBodyPosition.z
    );
  }

  getDebugSnapshot(opponent = null) {
    let tipRelativeToward = 0;
    const weaponTip = this.getWeaponTipWorldPosition(new THREE.Vector3());
    const weaponBase = this.getWeaponBaseWorldPosition(new THREE.Vector3());
    const bodyRadius = typeof this.charDef.bodyRadius === 'number'
      ? this.charDef.bodyRadius
      : ((typeof this.charDef.bodySeparation === 'number' ? this.charDef.bodySeparation : 0.8) * 0.5);
    const hurtCenter = this.getHurtCenterWorldPosition(new THREE.Vector3());
    const bodyCollision = this.getBodyCollisionPosition(new THREE.Vector3());
    if (opponent) {
      opponent.getHurtCenterWorldPosition(_debugOpponentCenter);
      tipRelativeToward = this.getTipRelativeVelocityToward(_debugOpponentCenter);
    }

    return {
      charName: this.charDef.displayName || 'Unknown',
      weaponType: this.weaponType,
      state: this.state,
      stateFrames: this.stateFrames,
      attackType: this.currentAttackType,
      activeClip: this.activeClipName,
      hitApplied: this.hitApplied,
      position: {
        x: this.position.x,
        y: this.position.y,
        z: this.position.z,
      },
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
      weaponBase: {
        x: weaponBase.x,
        y: weaponBase.y,
        z: weaponBase.z,
      },
      weaponTip: {
        x: weaponTip.x,
        y: weaponTip.y,
        z: weaponTip.z,
      },
      bodyCollision: {
        x: bodyCollision.x,
        y: bodyCollision.y,
        z: bodyCollision.z,
      },
      hurtCenter: {
        x: hurtCenter.x,
        y: hurtCenter.y,
        z: hurtCenter.z,
      },
      hurtRadius: this._debugCollision?.hurtRadius ?? 0.5,
      hurtHeight: this._debugCollision?.hurtHeight ?? 1.8,
      bodyRadius,
      collision: this._debugCollision ? { ...this._debugCollision } : null,
    };
  }

  startRagdoll(dirX, dirZ) {
    const bones = [];
    this.root.traverse((child) => {
      if (child.isBone) {
        const snapshot = child.rotation.clone();
        const n = child.name.toLowerCase();
        const isLimb = n.includes('arm') || n.includes('hand') || n.includes('leg') ||
                       n.includes('foot') || n.includes('shin') || n.includes('thigh') ||
                       n.includes('forearm') || n.includes('elbow') || n.includes('knee') ||
                       n.includes('shoulder') || n.includes('calf') || n.includes('wrist');
        const strength = isLimb ? 3.0 : 0.3;
        bones.push({
          bone: child,
          startRot: snapshot,
          velX: (Math.random() - 0.5) * strength,
          velY: (Math.random() - 0.5) * strength * 0.6,
          velZ: (Math.random() - 0.5) * strength,
          damping: isLimb ? 0.96 : 0.94,
          isLimb,
        });
      }
    });

    if (this.mixer) {
      this.mixer.stopAllAction();
    }
    for (const b of bones) {
      b.bone.rotation.copy(b.startRot);
    }

    this._ragdoll = {
      velX: dirX * 0.8,
      velY: 0,
      velZ: dirZ * 0.8,
      rootStartX: this.root.rotation.x,
      rootStartZ: this.root.rotation.z,
      rootTargetX: this.root.rotation.x + (Math.PI / 2 + Math.random() * 0.3) * (Math.random() > 0.5 ? 1 : -1),
      rootTargetZ: this.root.rotation.z + (Math.random() - 0.5) * 0.8,
      rootProgress: 0,
      bones,
      time: 0,
    };
  }

  _updateRagdoll(dt) {
    const r = this._ragdoll;
    const now = performance.now() / 1000;
    const realDt = r.lastTime ? Math.min(now - r.lastTime, 0.05) : dt;
    r.lastTime = now;
    r.time += realDt;

    this.position.x += r.velX * realDt;
    this.position.z += r.velZ * realDt;
    r.velX *= (1 - 3 * realDt);
    r.velZ *= (1 - 3 * realDt);

    r.rootProgress = Math.min(r.rootProgress + realDt * 0.8, 1);
    const ease = r.rootProgress * r.rootProgress;
    this.root.rotation.x = r.rootStartX + (r.rootTargetX - r.rootStartX) * ease;
    this.root.rotation.z = r.rootStartZ + (r.rootTargetZ - r.rootStartZ) * ease;

    const forwardTilt = Math.max(0, this.root.rotation.x) * 0.4;
    const backwardTilt = Math.max(0, -this.root.rotation.x) * 0.2;
    const sideTilt = Math.abs(this.root.rotation.z) * 0.15;
    this.position.y = Math.max(0, forwardTilt + backwardTilt + sideTilt);

    for (const b of r.bones) {
      b.bone.rotation.x += b.velX * realDt;
      b.bone.rotation.y += b.velY * realDt;
      b.bone.rotation.z += b.velZ * realDt;
      if (b.isLimb) {
        b.velX += (Math.random() - 0.5) * 2 * realDt;
        b.velZ += (Math.random() - 0.5) * 2 * realDt;
      }
      b.velX *= Math.pow(b.damping, realDt * 60);
      b.velY *= Math.pow(b.damping, realDt * 60);
      b.velZ *= Math.pow(b.damping, realDt * 60);
    }
  }

  resetForRound(xPos) {
    this.position.set(xPos, 0, 0);
    this.group.rotation.y = xPos < 0 ? Math.PI / 2 : -Math.PI / 2;
    this.fsm.reset();
    this.damageSystem.reset();
    this.trail.stop();
    this.walkPhase = 0;
    this._ragdoll = null;
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
    this.position.y = 0;

    if (this.mixer) {
      this.mixer.stopAllAction();
      this.activeClipName = null;
      const idleAction = this.clipActions['idle'];
      if (idleAction) {
        idleAction.reset();
        idleAction.timeScale = 1;
        idleAction.setLoop(THREE.LoopRepeat);
        idleAction.setEffectiveWeight(1);
        idleAction.play();
        this.activeClipName = 'idle';
      }
    }

    this._tipMotionInitialized = false;
    this._tipVelocity.set(0, 0, 0);
    this._baseVelocity.set(0, 0, 0);
    this._debugCollision = null;
    this._updateTipMotion();
  }

  addToScene(scene) {
    scene.add(this.group);
    scene.add(this.trail.mesh);
  }

  removeFromScene(scene) {
    scene.remove(this.group);
    scene.remove(this.trail.mesh);
  }
}
