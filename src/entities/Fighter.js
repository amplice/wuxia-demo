import * as THREE from 'three';
import { FighterBuilder } from './FighterBuilder.js';
import { ModelLoader } from './ModelLoader.js';
import { Weapon } from './Weapon.js';
import { FighterStateMachine } from '../combat/FighterStateMachine.js';
import { DamageSystem } from '../combat/DamageSystem.js';
import { ProceduralAnimator } from '../animation/ProceduralAnimator.js';
import { TrailEffect } from '../animation/TrailEffect.js';
import {
  getStancePose, getAttackPose, getBlockPose,
  getHitStunPose, getDyingPose, getDodgePose, getWalkPose,
} from '../animation/AnimationLibrary.js';
import {
  FighterState, AttackType, WeaponType,
  WALK_SPEED, FIGHT_START_DISTANCE,
  SIDESTEP_DASH_FRAMES, SIDESTEP_DASH_DISTANCE,
  BACKSTEP_FRAMES, BACKSTEP_DISTANCE,
} from '../core/Constants.js';
import { distance2D } from '../utils/MathUtils.js';

export class Fighter {
  constructor(playerIndex, color, weaponType = WeaponType.JIAN, modelData = null, fightAnimData = null) {
    this.playerIndex = playerIndex;
    this.isP2 = playerIndex === 1;
    this.weaponType = weaponType;
    this.useFBX = false;
    this.useClips = false;

    this.mixer = null;
    this.animActions = {};
    this.currentAnimAction = null;

    this.clipActions = {};
    this.activeClipName = null;

    let root, joints;

    if (fightAnimData) {
      const tint = this.isP2 ? 0xaabbff : 0xffcccc;
      const result = ModelLoader.createFighterFromGLB(
        fightAnimData.model, fightAnimData.clips, tint, fightAnimData.texture
      );
      root = result.root;
      joints = result.joints;
      this.mixer = result.mixer;
      this.clipActions = result.actions;
      this.useClips = true;
      // Apply model-specific root rotation (e.g. Mixamo models face -Z, need PI flip)
      if (fightAnimData.rootRotationY) {
        root.rotation.y = fightAnimData.rootRotationY;
      }
    } else if (modelData) {
      const tint = this.isP2 ? 0xaabbff : 0xffcccc;
      const result = ModelLoader.createFighterFromModel(
        modelData.model, modelData.texture, modelData.animations || [], tint
      );
      root = result.root;
      joints = result.joints;
      this.mixer = result.mixer || null;
      this.animActions = result.actions || {};
      this.useFBX = true;
    } else {
      const result = FighterBuilder.build(color, this.isP2);
      root = result.root;
      joints = result.joints;
    }

    this.root = root;
    this.joints = joints;

    this.group = new THREE.Group();
    this.group.add(this.root);

    this.weapon = new Weapon(weaponType);

    const trailColor = this.isP2 ? 0x4488ff : 0xff4444;
    this.trail = new TrailEffect(trailColor);

    // Systems
    this.damageSystem = new DamageSystem();
    this.fsm = new FighterStateMachine(this);
    this.animator = new ProceduralAnimator(joints, this.useFBX || this.useClips);

    // State indicators (floating shapes above head)
    this._stateIndicator = this._createStateIndicators();
    this.group.add(this._stateIndicator.group);

    // Position
    this.position = this.group.position;
    this.facingRight = !this.isP2;

    // Walk speed multiplier (per-character)
    this.walkSpeedMult = (weaponType === WeaponType.SPEAR) ? 0.25 : 1.0;

    // Walk cycle timer
    this.walkPhase = 0;
    this._sidestepDir = 0;


    // Ragdoll state
    this._ragdoll = null;
  }

  _createStateIndicators() {
    const g = new THREE.Group();
    g.position.y = 2.2; // float above head

    // Block: blue cube
    const blockGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const blockMat = new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.8 });
    const block = new THREE.Mesh(blockGeo, blockMat);
    block.visible = false;
    g.add(block);

    // Parry: yellow tetrahedron (cone with 4 sides)
    const parryGeo = new THREE.ConeGeometry(0.15, 0.25, 4);
    const parryMat = new THREE.MeshBasicMaterial({ color: 0xffdd00, transparent: true, opacity: 0.9 });
    const parry = new THREE.Mesh(parryGeo, parryMat);
    parry.visible = false;
    g.add(parry);

    // Parry success: green diamond (rotated cube)
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

  update(dt, opponent) {
    // Ragdoll physics override
    if (this._ragdoll) {
      this._updateRagdoll(dt);
      if (this.useClips && this.mixer) this.mixer.update(dt);
      this._updateTrail();
      return;
    }

    // Face toward opponent — but lock facing and rotation during attacks
    if (opponent) {
      if (!this.fsm.isAttacking) {
        const dx = opponent.position.x - this.position.x;
        const dz = opponent.position.z - this.position.z;
        this.facingRight = dx >= 0;
        this.group.rotation.y = Math.atan2(dx, dz);
      }
    }

    // Update FSM
    this.fsm.update();

    // Update animation based on state
    this._updateAnimation();

    // Attack lunge — move toward opponent during active frames
    if (this.state === FighterState.ATTACK_ACTIVE && this.currentAttackData) {
      const lungeSpeed = this.currentAttackData.lunge / this.currentAttackData.active * 60;
      const angle = this.group.rotation.y;
      this.position.x += Math.sin(angle) * lungeSpeed * dt;
      this.position.z += Math.cos(angle) * lungeSpeed * dt;
    }

    // Sidestep movement — Z axis dash during dash phase
    if (this.state === FighterState.SIDESTEP && this.fsm.sidestepPhase === 'dash') {
      const speed = SIDESTEP_DASH_DISTANCE / SIDESTEP_DASH_FRAMES * 60;
      this.position.z += this.fsm.sidestepDirection * speed * dt;
    }

    // Backstep movement — away from opponent
    if (this.state === FighterState.DODGE) {
      const speed = BACKSTEP_DISTANCE / BACKSTEP_FRAMES * 60;
      const angle = this.group.rotation.y;
      // Backward = opposite of facing
      this.position.x -= Math.sin(angle) * speed * dt;
      this.position.z -= Math.cos(angle) * speed * dt;
    }

    // Update mixer for clip-based animations
    if (this.useClips && this.mixer) {
      this.mixer.update(dt);
    }

    // Update trail
    this._updateTrail();

    // Update state indicators
    this._updateStateIndicators();

    // Walk animation phase
    if (this.state === FighterState.WALK_FORWARD || this.state === FighterState.WALK_BACK) {
      this.walkPhase += dt * 8;
    }
  }

  _mirrorPose(pose) {
    if (!this.isP2) return pose;
    const mirrored = {};
    for (const [joint, rot] of Object.entries(pose)) {
      let newJoint = joint;
      if (joint.endsWith('R')) newJoint = joint.slice(0, -1) + 'L';
      else if (joint.endsWith('L')) newJoint = joint.slice(0, -1) + 'R';
      mirrored[newJoint] = {
        rx: rot.rx,
        ry: rot.ry ? -rot.ry : 0,
        rz: rot.rz ? -rot.rz : 0,
      };
    }
    return mirrored;
  }

  _updateAnimation() {
    if (this.useClips) {
      this._updateClipAnimation();
      return;
    }
    if (this.useFBX) {
      this._updateFBXAnimation();
      return;
    }

    const state = this.state;
    let pose;
    let speed = 0.15;

    switch (state) {
      case FighterState.IDLE:
      case FighterState.WALK_FORWARD:
      case FighterState.WALK_BACK:
        pose = getStancePose();
        if (state === FighterState.WALK_FORWARD || state === FighterState.WALK_BACK) {
          const walkOffset = getWalkPose(state === FighterState.WALK_FORWARD);
          const phase = Math.sin(this.walkPhase);
          const blended = { ...pose };
          for (const [joint, rot] of Object.entries(walkOffset)) {
            if (blended[joint]) {
              blended[joint] = {
                rx: (blended[joint].rx || 0) + (rot.rx || 0) * phase,
                ry: (blended[joint].ry || 0) + (rot.ry || 0) * phase,
                rz: (blended[joint].rz || 0) + (rot.rz || 0) * phase,
              };
            }
          }
          pose = blended;
        }
        speed = 0.12;
        break;

      case FighterState.SIDESTEP:
        pose = getDodgePose();
        speed = 0.2;
        break;

      case FighterState.ATTACK_STARTUP: {
        const heavy = this.fsm.currentAttackType === AttackType.HEAVY;
        pose = getAttackPose(this.fsm.currentAttackType, 'startup');
        speed = heavy ? 0.12 : 0.25;
        break;
      }

      case FighterState.ATTACK_ACTIVE: {
        const heavy = this.fsm.currentAttackType === AttackType.HEAVY;
        pose = getAttackPose(this.fsm.currentAttackType, 'active');
        speed = heavy ? 0.18 : 0.35;
        break;
      }

      case FighterState.ATTACK_RECOVERY: {
        const heavy = this.fsm.currentAttackType === AttackType.HEAVY;
        pose = getStancePose();
        speed = heavy ? 0.05 : 0.1;
        break;
      }

      case FighterState.BLOCK:
      case FighterState.BLOCK_STUN:
        pose = getBlockPose();
        speed = 0.2;
        break;

      case FighterState.PARRY:
      case FighterState.PARRY_SUCCESS:
        pose = getBlockPose();
        speed = 0.3;
        break;

      case FighterState.HIT_STUN:
      case FighterState.PARRIED_STUN:
        pose = getHitStunPose();
        speed = 0.2;
        break;

      case FighterState.DODGE:
        pose = getDodgePose();
        speed = 0.25;
        break;

      case FighterState.CLASH:
        pose = getBlockPose();
        speed = 0.2;
        break;

      case FighterState.DYING:
      case FighterState.DEAD:
        pose = getDyingPose();
        speed = 0.08;
        break;

      default:
        pose = getStancePose();
    }

    this.animator.setTargetPose(this._mirrorPose(pose), speed);
    this.animator.update();
  }

  _updateFBXAnimation() {
    const state = this.state;
    const DEG = Math.PI / 180;
    const dir = this.facingRight ? 1 : -1;

    let tiltX = 0;
    let tiltZ = 0;
    let bobY = 0;
    let lungeX = 0;
    let squash = 1;

    switch (state) {
      case FighterState.IDLE:
        bobY = Math.sin(performance.now() * 0.003) * 0.02;
        break;

      case FighterState.WALK_FORWARD:
        tiltX = 8 * DEG;
        bobY = Math.sin(this.walkPhase) * 0.04;
        break;

      case FighterState.WALK_BACK:
        tiltX = -5 * DEG;
        bobY = Math.sin(this.walkPhase) * 0.03;
        break;

      case FighterState.SIDESTEP:
        tiltZ = 10 * DEG * dir;
        bobY = -0.05;
        break;

      case FighterState.ATTACK_STARTUP:
        tiltX = -12 * DEG;
        bobY = -0.04;
        lungeX = -0.15 * dir;
        break;

      case FighterState.ATTACK_ACTIVE:
        tiltX = 15 * DEG;
        lungeX = 0.4 * dir;
        bobY = -0.03;
        break;

      case FighterState.ATTACK_RECOVERY:
        tiltX = 3 * DEG;
        lungeX = 0.1 * dir;
        break;

      case FighterState.BLOCK:
      case FighterState.BLOCK_STUN:
        tiltX = -6 * DEG;
        bobY = -0.08;
        squash = 0.96;
        break;

      case FighterState.PARRY:
      case FighterState.PARRY_SUCCESS:
        tiltX = -3 * DEG;
        bobY = -0.05;
        break;

      case FighterState.HIT_STUN:
        tiltX = -18 * DEG;
        tiltZ = 8 * DEG;
        bobY = -0.05;
        lungeX = -0.2 * dir;
        break;

      case FighterState.PARRIED_STUN:
        tiltX = -15 * DEG;
        tiltZ = -10 * DEG;
        lungeX = -0.15 * dir;
        break;

      case FighterState.DODGE:
        bobY = -0.2;
        squash = 0.85;
        tiltX = 10 * DEG;
        break;

      case FighterState.CLASH:
        tiltX = -10 * DEG;
        lungeX = -0.2 * dir;
        bobY = -0.03;
        break;

      case FighterState.DYING:
        tiltX = -35 * DEG;
        tiltZ = 15 * DEG;
        bobY = -0.3 * Math.min(this.stateFrames / 30, 1);
        squash = 0.9;
        break;

      case FighterState.DEAD:
        tiltX = -50 * DEG;
        tiltZ = 20 * DEG;
        bobY = -0.4;
        squash = 0.85;
        break;
    }

    const isHeavyAttack = this.fsm.isAttacking && this.fsm.currentAttackType === AttackType.HEAVY;
    const t = isHeavyAttack ? 0.07 : 0.15;
    const r = this.root;

    if (this._fbxBaseScale == null) {
      this._fbxBaseScale = r.scale.x;
    }
    const bs = this._fbxBaseScale;

    r.rotation.x += (tiltX - r.rotation.x) * t;
    r.rotation.z += (tiltZ - r.rotation.z) * t;

    if (this._fbxBobY == null) this._fbxBobY = 0;
    this._fbxBobY += (bobY - this._fbxBobY) * t;
    if (this._fbxBaseY == null) this._fbxBaseY = r.position.y;
    r.position.y = this._fbxBaseY + this._fbxBobY;

    const sy = bs * (1 + (squash - 1));
    r.scale.y += (sy - r.scale.y) * t;
  }

  _updateClipAnimation() {
    const state = this.state;
    let clipName = 'idle';
    let loopOnce = false;

    // Helper to pick first available clip name
    const pick = (...names) => {
      for (const n of names) {
        if (this.clipActions[n]) return n;
      }
      return names[names.length - 1];
    };

    switch (state) {
      case FighterState.IDLE:
      case FighterState.BLOCK:
      case FighterState.BLOCK_STUN:
      case FighterState.PARRY:
      case FighterState.PARRY_SUCCESS:
      case FighterState.PARRIED_STUN:
      case FighterState.HIT_STUN:
      case FighterState.DODGE:
      case FighterState.CLASH:
        clipName = 'idle';
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
        const isHeavy = this.fsm.currentAttackType === AttackType.HEAVY;
        if (isHeavy) {
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
      const tip = this.weapon.getTipWorldPosition();
      const base = new THREE.Vector3();
      const handJoint = this.joints.handR || this.joints.handL;
      if (handJoint) {
        handJoint.getWorldPosition(base);
      } else {
        base.copy(this.position).setY(1.2);
      }
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

    // Spin the active indicator
    const time = performance.now() * 0.003;
    if (ind.parry.visible) ind.parry.rotation.y = time * 3;
    if (ind.success.visible) {
      ind.success.rotation.y = time * 4;
      ind.success.position.y = Math.sin(time * 5) * 0.05;
    }
    if (ind.block.visible) ind.block.rotation.y = time * 2;

    // Counter-rotate so indicators always face camera (cancel parent group rotation)
    ind.group.rotation.y = -this.group.rotation.y;
  }

  // Movement methods — fixed screen axes (D=right, A=left on X axis)
  moveForward(dt) {
    if (!this.fsm.isActionable) return;
    this.position.x += WALK_SPEED * dt;
    if (this.fsm.state === FighterState.IDLE || this.fsm.state === FighterState.PARRY_SUCCESS) {
      this.fsm.transition(FighterState.WALK_FORWARD);
    }
  }

  moveBack(dt) {
    if (!this.fsm.isActionable) return;
    this.position.x -= WALK_SPEED * dt;
    if (this.fsm.state === FighterState.IDLE || this.fsm.state === FighterState.PARRY_SUCCESS) {
      this.fsm.transition(FighterState.WALK_BACK);
    }
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
    if (result && this.useClips) {
      const isHeavy = type === AttackType.HEAVY;
      // Find the right clip: prefer separate quick/heavy, fall back to single 'attack'
      const clipName = isHeavy
        ? (this.clipActions.attack_heavy ? 'attack_heavy' : 'attack')
        : (this.clipActions.attack_quick ? 'attack_quick' : 'attack');
      const action = this.clipActions[clipName];
      if (action) {
        // Only adjust timeScale if using a single shared attack clip
        const hasSeparateClips = this.clipActions.attack_quick || this.clipActions.attack_heavy;
        const timeScale = (!hasSeparateClips && isHeavy) ? 0.5 : 1.0;
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
    return distance2D(
      this.position.x, this.position.z,
      other.position.x, other.position.z
    );
  }

  startRagdoll(dirX, dirZ) {
    // Snapshot current bone rotations BEFORE stopping animations
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

    // Stop animations, then restore the snapshot so we don't snap to T-pose
    if (this.useClips && this.mixer) {
      this.mixer.stopAllAction();
    }
    for (const b of bones) {
      b.bone.rotation.copy(b.startRot);
    }

    // Small stumble backward, no big launch
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
    // Use real time so ragdoll isn't frozen during slowmo
    const now = performance.now() / 1000;
    const realDt = r.lastTime ? Math.min(now - r.lastTime, 0.05) : dt;
    r.lastTime = now;
    r.time += realDt;

    // Stumble slide
    this.position.x += r.velX * realDt;
    this.position.z += r.velZ * realDt;
    r.velX *= (1 - 3 * realDt);
    r.velZ *= (1 - 3 * realDt);

    // Gradually tilt the root to collapse
    r.rootProgress = Math.min(r.rootProgress + realDt * 0.8, 1);
    const ease = r.rootProgress * r.rootProgress;
    this.root.rotation.x = r.rootStartX + (r.rootTargetX - r.rootStartX) * ease;
    this.root.rotation.z = r.rootStartZ + (r.rootTargetZ - r.rootStartZ) * ease;

    // Compensate Y based on tilt direction
    // Forward fall (positive X rot) pushes body down — needs lift
    // Backward fall (negative X rot) raises body — needs none
    const forwardTilt = Math.max(0, this.root.rotation.x) * 0.4;
    const backwardTilt = Math.max(0, -this.root.rotation.x) * 0.2;
    const sideTilt = Math.abs(this.root.rotation.z) * 0.15;
    this.position.y = Math.max(0, forwardTilt + backwardTilt + sideTilt);

    // Bones go limp — limbs flop more
    for (const b of r.bones) {
      b.bone.rotation.x += b.velX * realDt;
      b.bone.rotation.y += b.velY * realDt;
      b.bone.rotation.z += b.velZ * realDt;
      // Limbs get gravity pull
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
    this.animator.reset();
    this.trail.stop();
    this.walkPhase = 0;
    this._sidestepDir = 0;
    this._ragdoll = null;
    this.root.rotation.x = 0;
    this.root.rotation.z = 0;
    this.position.y = 0;

    if (this.useClips && this.mixer) {
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

    if (this.useFBX) {
      this.root.rotation.x = 0;
      this.root.rotation.z = 0;
      this._fbxBobY = 0;
      this._fbxBaseY = null;
      if (this._fbxBaseScale != null) {
        this.root.scale.setScalar(this._fbxBaseScale);
      }
      this._fbxBaseScale = null;
    }
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
