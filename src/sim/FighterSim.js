import * as THREE from 'three';
import { getAttackData } from '../combat/AttackData.js';
import { FighterCore } from '../combat/FighterCore.js';
import { AUTHORITATIVE_TRACKS } from '../data/authoritativeTracks.js';
import {
  WEAPON_FALLBACKS,
} from '../combat/CombatTuning.js';
import { WEAPON_STATS } from '../entities/WeaponData.js';
import { AttackType } from '../core/Constants.js';

const _relativeVelocity = new THREE.Vector3();
const _pointVelocity = new THREE.Vector3();
const _pointToTarget = new THREE.Vector3();
const _selfBodyPosition = new THREE.Vector3();
const _opponentBodyPosition = new THREE.Vector3();
const _weaponBase = new THREE.Vector3();
const _weaponTip = new THREE.Vector3();
const _sampledBody = new THREE.Vector3();
const _sampledBase = new THREE.Vector3();
const _sampledTip = new THREE.Vector3();

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

export class FighterSim extends FighterCore {
  constructor(playerIndex, charId, charDef) {
    super(playerIndex, charId, charDef);
    this.root = new THREE.Group();
    this.visualRoot = new THREE.Group();
    this.visualRoot.add(this.root);
    this.group.add(this.visualRoot);
    this.position = this.group.position;
    this.authoritativeTracks = AUTHORITATIVE_TRACKS.characters?.[charId] ?? null;

    this.resetForRound(playerIndex === 0 ? -2.5 : 2.5);
  }

  update(dt, opponent) {
    this._beginUpdateCore(dt, opponent);
    this._updateVirtualClipName();
    this._finishUpdateCore();
  }

  syncStatePresentation() {}

  getWeaponBaseWorldPosition(target = new THREE.Vector3()) {
    this._computeWeaponPose(_weaponBase, _weaponTip);
    return target.copy(_weaponBase);
  }

  getWeaponTipWorldPosition(target = new THREE.Vector3()) {
    this._computeWeaponPose(_weaponBase, _weaponTip);
    return target.copy(_weaponTip);
  }

  getBodyAnchorWorldPosition(target = new THREE.Vector3()) {
    const sampledFrame = this._getSampledClipFrame();
    if (Array.isArray(sampledFrame?.body) && sampledFrame.body.length === 3) {
      return this._localToWorld(_sampledBody.fromArray(sampledFrame.body), target);
    }

    const sampledAnchor = this.authoritativeTracks?.bodyAnchorOffset;
    if (Array.isArray(sampledAnchor) && sampledAnchor.length === 3) {
      return this._localToWorld(_sampledBody.fromArray(sampledAnchor), target);
    }
    return super.getBodyAnchorWorldPosition(target);
  }

  _getDebugSnapshotExtras() {
    return { headless: true };
  }

  resetForRound(xPos) {
    this._resetCoreState(xPos);
    this._updateTipMotion();
  }

  addToScene() {}
  removeFromScene() {}
  startRagdoll() {}

  _updateVirtualClipName() {
    this.activeClipName = this._getPresentationClip((...names) => names[0]).clipName;
  }

  _computeWeaponPose(baseTarget, tipTarget) {
    if (this._applyAuthoritativeWeaponPose(baseTarget, tipTarget)) {
      return;
    }

    const yaw = this.group.rotation.y;
    const stats = this.charDef.weaponStats ?? WEAPON_STATS[this.weaponType];
    const attackType = this.currentAttackType || AttackType.QUICK;
    const progress = this.fsm.isAttacking && this.fsm.stateDuration > 0
      ? THREE.MathUtils.clamp(this.stateFrames / this.fsm.stateDuration, 0, 1)
      : 0;
    const poseProfile = this.charDef.sim?.poseProfile;
    const poseSet = poseProfile?.attack;
    const idlePose = poseProfile?.idle?.[attackType];
    const pose = this.fsm.isAttacking ? poseSet[attackType] : idlePose;
    const attackData = this.currentAttackData ?? getAttackData(attackType, this.charDef);
    const poseProgress = this.fsm.isAttacking
      ? this._getAttackPoseProgress(progress, attackData, pose)
      : 0;
    const yawOffset = lerp(pose.yawStart, pose.yawEnd, poseProgress);
    const reach = lerp(pose.reachStart, pose.reachEnd, poseProgress);
    const lift = lerp(pose.liftStart, pose.liftEnd, poseProgress);

    const sideOffset = poseProfile?.sideOffset ?? 0.08;
    const sideSign = this.isP2 ? -1 : 1;
    const baseForward = poseProfile?.baseForward ?? 0.22;
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
      tipTarget.y += poseProfile?.idleTipLift ?? 0.04;
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
    throw new Error(`Missing authoritative attack clip '${clipName}' for ${this.charId}`);
  }

  _getAttackClipName(attackType = this.currentAttackType) {
    if (attackType === AttackType.HEAVY) return 'attack_heavy';
    if (attackType === AttackType.THRUST) return 'attack_thrust';
    return 'attack_quick';
  }

  _getSampledWeaponClip() {
    if (!this.authoritativeTracks?.clips) return null;
    return this.authoritativeTracks.clips[this.activeClipName] ?? this.authoritativeTracks.clips.idle ?? null;
  }

  _getSampledClipFrame() {
    const clip = this._getSampledWeaponClip();
    if (!clip?.frames?.length) return null;

    const frameCount = clip.frames.length;
    const frameIndex = this.fsm.isAttacking
      ? THREE.MathUtils.clamp(this.stateFrames - 1, 0, frameCount - 1)
      : Math.floor((this.walkPhase * 60) % frameCount);
    return clip.frames[frameIndex] ?? null;
  }

  _applyAuthoritativeWeaponPose(baseTarget, tipTarget) {
    const frame = this._getSampledClipFrame();
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
