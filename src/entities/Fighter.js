import * as THREE from 'three';
import { FighterBuilder } from './FighterBuilder.js';
import { ModelLoader } from './ModelLoader.js';
import { Weapon } from './Weapon.js';
import { FighterStateMachine } from '../combat/FighterStateMachine.js';
import { StanceSystem } from '../combat/StanceSystem.js';
import { DamageSystem } from '../combat/DamageSystem.js';
import { ProceduralAnimator } from '../animation/ProceduralAnimator.js';
import { TrailEffect } from '../animation/TrailEffect.js';
import {
  getStancePose, getAttackPose, getBlockPose,
  getHitStunPose, getDyingPose, getDodgePose, getWalkPose,
} from '../animation/AnimationLibrary.js';
import {
  FighterState, AttackType, WeaponType,
  WALK_SPEED, SIDESTEP_SPEED, DODGE_INVULN_FRAMES, DODGE_TOTAL_FRAMES,
  FIGHT_START_DISTANCE,
} from '../core/Constants.js';
import { distance2D } from '../utils/MathUtils.js';

export class Fighter {
  /**
   * @param {number} playerIndex - 0 or 1
   * @param {number} color - hex color for procedural fallback / tint
   * @param {string} weaponType - WeaponType enum value
   * @param {object|null} modelData - { model, texture } from ModelLoader, or null for procedural
   * @param {object|null} fightAnimData - { model, clips } from ModelLoader.loadFightAnimations()
   */
  constructor(playerIndex, color, weaponType = WeaponType.JIAN, modelData = null, fightAnimData = null) {
    this.playerIndex = playerIndex;
    this.isP2 = playerIndex === 1;
    this.weaponType = weaponType;
    this.useFBX = false;
    this.useClips = false;

    // Animation mixer (for FBX model with GLB animations)
    this.mixer = null;
    this.animActions = {};
    this.currentAnimAction = null;

    // Clip-based animation state
    this.clipActions = {};
    this.activeClipName = null;

    let root, joints;

    if (fightAnimData) {
      // GLB clip-based animation path
      const tint = this.isP2 ? 0xaabbff : 0xffcccc;
      const result = ModelLoader.createFighterFromGLB(
        fightAnimData.model, fightAnimData.clips, tint, fightAnimData.texture
      );
      root = result.root;
      joints = result.joints;
      this.mixer = result.mixer;
      this.clipActions = result.actions;
      this.useClips = true;
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

    // Container group for world position
    this.group = new THREE.Group();
    this.group.add(this.root);

    // Weapon — created here but attached by Game.js (same approach as animation player)
    this.weapon = new Weapon(weaponType);

    // Trail effect
    const trailColor = this.isP2 ? 0x4488ff : 0xff4444;
    this.trail = new TrailEffect(trailColor);

    // Systems
    this.stanceSystem = new StanceSystem();
    this.damageSystem = new DamageSystem();
    this.fsm = new FighterStateMachine(this);
    this.animator = new ProceduralAnimator(joints, this.useFBX || this.useClips);

    // State shortcuts (proxied from FSM)
    this.dodgeInvulnFrames = DODGE_INVULN_FRAMES;

    // Position
    this.position = this.group.position;
    this.facingRight = !this.isP2;

    // Walk cycle timer
    this.walkPhase = 0;
    this._sidestepDir = 0;
  }

  get state() { return this.fsm.state; }
  get stateFrames() { return this.fsm.stateFrames; }
  get currentAttackData() { return this.fsm.currentAttackData; }
  get currentAttackType() { return this.fsm.currentAttackType; }
  get hitApplied() { return this.fsm.hitApplied; }
  set hitApplied(v) { this.fsm.hitApplied = v; }

  update(dt, opponent) {
    // Update facing — face toward opponent using full 2D angle
    if (opponent) {
      const dx = opponent.position.x - this.position.x;
      const dz = opponent.position.z - this.position.z;
      this.facingRight = dx >= 0;
      // atan2(dz, dx) gives 0 when opponent is to +X, PI when to -X
      // Subtract PI/2 because Cartwheel GLB model faces +Z at rotation.y=0
      const targetY = Math.atan2(dz, dx) - Math.PI / 2;
      // Smooth rotation with angle wrapping
      let diff = targetY - this.group.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.group.rotation.y += diff * 0.15;
    }

    // Update stance
    this.stanceSystem.update();

    // Update FSM
    this.fsm.update();

    // Update animation based on state
    this._updateAnimation();

    // Attack lunge — move toward opponent during active frames
    if (opponent && this.state === FighterState.ATTACK_ACTIVE) {
      const dx = opponent.position.x - this.position.x;
      const dz = opponent.position.z - this.position.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const lungeSpeed = 4.0;
      this.position.x += (dx / len) * lungeSpeed * dt;
      this.position.z += (dz / len) * lungeSpeed * dt;
    }

    // Update mixer for clip-based animations
    if (this.useClips && this.mixer) {
      this.mixer.update(dt);
    }

    // Update trail
    this._updateTrail();

    // Walk animation phase
    if (this.state === FighterState.WALK_FORWARD || this.state === FighterState.WALK_BACK) {
      this.walkPhase += dt * 8;
    }
  }

  _mirrorPose(pose) {
    // Swap L and R joints for P2 so weapon arm animations work correctly
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
      case FighterState.SIDESTEP:
        pose = getStancePose(this.stanceSystem.stance);
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

      case FighterState.STANCE_CHANGE:
        pose = getStancePose(this.stanceSystem.targetStance || this.stanceSystem.stance);
        speed = 0.2;
        break;

      case FighterState.ATTACK_STARTUP:
        pose = getAttackPose(this.stanceSystem.stance, this.fsm.currentAttackType, 'startup');
        speed = 0.25;
        break;

      case FighterState.ATTACK_ACTIVE:
        pose = getAttackPose(this.stanceSystem.stance, this.fsm.currentAttackType, 'active');
        speed = 0.35;
        break;

      case FighterState.ATTACK_RECOVERY:
        pose = getStancePose(this.stanceSystem.stance);
        speed = 0.1;
        break;

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
        pose = getStancePose(this.stanceSystem.stance);
    }

    this.animator.setTargetPose(this._mirrorPose(pose), speed);
    this.animator.update();
  }

  /**
   * FBX whole-body animation via root tilts, bobs, and lunges.
   * No bone manipulation — just transforms on this.root.
   */
  _updateFBXAnimation() {
    const state = this.state;
    const DEG = Math.PI / 180;
    const dir = this.facingRight ? 1 : -1;

    // Target values for root transform
    let tiltX = 0;  // forward/back lean
    let tiltZ = 0;  // side lean
    let bobY = 0;   // vertical offset
    let lungeX = 0; // horizontal lunge toward opponent
    let squash = 1; // scaleY squash/stretch

    switch (state) {
      case FighterState.IDLE:
        // Subtle breathing bob
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

      case FighterState.STANCE_CHANGE:
        bobY = -0.06;
        squash = 0.95;
        break;

      case FighterState.ATTACK_STARTUP:
        // Wind up — lean back
        tiltX = -12 * DEG;
        bobY = -0.04;
        lungeX = -0.15 * dir;
        break;

      case FighterState.ATTACK_ACTIVE:
        // Lunge forward
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

    // Smoothly blend root transforms
    const t = 0.15;
    const r = this.root;

    // Cache the base scale on first run
    if (this._fbxBaseScale == null) {
      this._fbxBaseScale = r.scale.x;
    }
    const bs = this._fbxBaseScale;

    r.rotation.x += (tiltX - r.rotation.x) * t;
    r.rotation.z += (tiltZ - r.rotation.z) * t;

    // Bob is Y offset on root's local position (already inside the group)
    if (this._fbxBobY == null) this._fbxBobY = 0;
    this._fbxBobY += (bobY - this._fbxBobY) * t;
    // Store initial root Y on first call
    if (this._fbxBaseY == null) this._fbxBaseY = r.position.y;
    r.position.y = this._fbxBaseY + this._fbxBobY;

    // Squash/stretch on Y axis only
    const sy = bs * (1 + (squash - 1));
    r.scale.y += (sy - r.scale.y) * t;
  }

  /**
   * Clip-based animation: map FSM state to animation clip with crossfading.
   */
  _updateClipAnimation() {
    const state = this.state;
    let clipName = 'idle';
    let frozen = false;
    let loopOnce = false;

    switch (state) {
      case FighterState.IDLE:
      case FighterState.BLOCK:
      case FighterState.BLOCK_STUN:
      case FighterState.PARRY:
      case FighterState.PARRY_SUCCESS:
      case FighterState.PARRIED_STUN:
      case FighterState.HIT_STUN:
      case FighterState.STANCE_CHANGE:
      case FighterState.DODGE:
      case FighterState.CLASH:
        clipName = 'idle';
        frozen = true;
        break;

      case FighterState.WALK_FORWARD:
        clipName = 'walk_right';
        break;

      case FighterState.WALK_BACK:
        clipName = 'walk_left';
        break;

      case FighterState.SIDESTEP:
        clipName = this._sidestepDir > 0 ? 'walk_right' : 'walk_left';
        break;

      case FighterState.ATTACK_STARTUP:
      case FighterState.ATTACK_ACTIVE:
      case FighterState.ATTACK_RECOVERY:
        clipName = 'attack';
        loopOnce = true;
        break;

      case FighterState.DYING:
      case FighterState.DEAD:
        clipName = 'idle';
        frozen = true;
        break;
    }

    const action = this.clipActions[clipName];
    if (!action) return;

    // Switch clip if different from current
    if (clipName !== this.activeClipName) {
      const prevAction = this.clipActions[this.activeClipName];

      // Configure new action
      if (loopOnce) {
        action.setLoop(THREE.LoopOnce);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(THREE.LoopRepeat);
        action.clampWhenFinished = false;
      }

      if (frozen) {
        action.timeScale = 0;
        action.time = 0;
      } else {
        action.timeScale = 1;
      }

      // Crossfade
      action.reset();
      action.setEffectiveWeight(1);
      if (prevAction) {
        action.crossFadeFrom(prevAction, 0.15, true);
      }
      action.play();

      this.activeClipName = clipName;
    } else if (frozen && action.timeScale !== 0) {
      // Ensure frozen stays frozen
      action.timeScale = 0;
      action.time = 0;
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

  // Movement methods — all relative to opponent position
  moveForward(dt, opponent) {
    if (!this.fsm.isActionable) return;
    if (opponent) {
      const dx = opponent.position.x - this.position.x;
      const dz = opponent.position.z - this.position.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      this.position.x += (dx / len) * WALK_SPEED * dt;
      this.position.z += (dz / len) * WALK_SPEED * dt;
    } else {
      const dir = this.facingRight ? 1 : -1;
      this.position.x += dir * WALK_SPEED * dt;
    }
    if (this.fsm.state === FighterState.IDLE) {
      this.fsm.transition(FighterState.WALK_FORWARD);
    }
  }

  moveBack(dt, opponent) {
    if (!this.fsm.isActionable) return;
    if (opponent) {
      const dx = opponent.position.x - this.position.x;
      const dz = opponent.position.z - this.position.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      this.position.x -= (dx / len) * WALK_SPEED * dt;
      this.position.z -= (dz / len) * WALK_SPEED * dt;
    } else {
      const dir = this.facingRight ? -1 : 1;
      this.position.x += dir * WALK_SPEED * dt;
    }
    if (this.fsm.state === FighterState.IDLE) {
      this.fsm.transition(FighterState.WALK_BACK);
    }
  }

  sidestep(dt, direction, opponent) {
    if (!this.fsm.isActionable) return;
    this._sidestepDir = direction;
    if (opponent) {
      // Orbit around opponent — move perpendicular to fighter-opponent line
      const dx = opponent.position.x - this.position.x;
      const dz = opponent.position.z - this.position.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      // Perpendicular: rotate 90 degrees
      const perpX = -dz / len;
      const perpZ = dx / len;
      this.position.x += perpX * direction * SIDESTEP_SPEED * dt;
      this.position.z += perpZ * direction * SIDESTEP_SPEED * dt;
    } else {
      this.position.z += direction * SIDESTEP_SPEED * dt;
    }
    if (this.fsm.state === FighterState.IDLE) {
      this.fsm.transition(FighterState.SIDESTEP);
    }
  }

  stopMoving() {
    if (this.state === FighterState.WALK_FORWARD ||
        this.state === FighterState.WALK_BACK ||
        this.state === FighterState.SIDESTEP) {
      this.fsm.transition(FighterState.IDLE);
    }
  }

  attack(type) {
    const result = this.fsm.startAttack(type);
    // Override FSM timing to match full animation clip duration
    if (result && this.useClips && this.clipActions.attack) {
      const clipDuration = this.clipActions.attack.getClip().duration;
      const totalFrames = Math.round(clipDuration * 60);
      this.fsm.currentAttackData = {
        ...this.fsm.currentAttackData,
        startup: 1,
        active: totalFrames,
        recovery: 1,
      };
    }
    return result;
  }

  block() {
    return this.fsm.startBlock();
  }

  parry() {
    return this.fsm.startParry();
  }

  dodge(opponent) {
    if (this.fsm.startDodge()) {
      // Dodge away from opponent
      if (opponent) {
        const dx = this.position.x - opponent.position.x;
        const dz = this.position.z - opponent.position.z;
        const len = Math.sqrt(dx * dx + dz * dz) || 1;
        this.position.x += (dx / len) * 1.5;
        this.position.z += (dz / len) * 1.5;
      } else {
        const dir = this.facingRight ? -1 : 1;
        this.position.x += dir * 1.5;
      }
      return true;
    }
    return false;
  }

  changeStance() {
    if (!this.fsm.isActionable) return false;
    if (this.stanceSystem.cycleStance()) {
      this.fsm.transition(FighterState.STANCE_CHANGE);
      return true;
    }
    return false;
  }

  distanceTo(other) {
    return distance2D(
      this.position.x, this.position.z,
      other.position.x, other.position.z
    );
  }

  resetForRound(xPos) {
    this.position.set(xPos, 0, 0);
    this.group.rotation.y = xPos < 0 ? -Math.PI / 2 : Math.PI / 2;
    this.fsm.reset();
    this.stanceSystem.reset();
    this.damageSystem.reset();
    this.animator.reset();
    this.trail.stop();
    this.walkPhase = 0;
    this._sidestepDir = 0;

    // Reset clip-based animation
    if (this.useClips && this.mixer) {
      this.mixer.stopAllAction();
      this.activeClipName = null;
      // Start idle clip
      const idleAction = this.clipActions['idle'];
      if (idleAction) {
        idleAction.reset();
        idleAction.timeScale = 0;
        idleAction.time = 0;
        idleAction.setLoop(THREE.LoopRepeat);
        idleAction.setEffectiveWeight(1);
        idleAction.play();
        this.activeClipName = 'idle';
      }
    }

    // Reset FBX root transforms
    if (this.useFBX) {
      this.root.rotation.x = 0;
      this.root.rotation.z = 0;
      this._fbxBobY = 0;
      this._fbxBaseY = null; // will re-cache on next update
      if (this._fbxBaseScale != null) {
        this.root.scale.setScalar(this._fbxBaseScale);
      }
      this._fbxBaseScale = null; // will re-cache on next update
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
