import * as THREE from 'three';
import { ModelLoader } from './ModelLoader.js';
import { Weapon } from './Weapon.js';
import { getAttackData } from '../combat/AttackData.js';
import { FighterCore } from '../combat/FighterCore.js';
import {
  BODY_COLLISION,
  REMOTE_VIEW_TUNING,
  WEAPON_FALLBACKS,
} from '../combat/CombatTuning.js';
import { TrailEffect } from '../animation/TrailEffect.js';
import { moveAngleTowards } from '../utils/MathUtils.js';
import {
  FighterState, AttackType, WeaponType,
} from '../core/Constants.js';

const _markerBodyPosition = new THREE.Vector3();
const _remoteTargetPosition = new THREE.Vector3();

export class Fighter extends FighterCore {
  static _playerMarkerTexture = null;

  constructor(playerIndex, color, charDef, animData) {
    super(playerIndex, charDef.glbPath ?? charDef.displayName ?? 'fighter', charDef);
    if (!animData?.model || !animData?.clips) {
      const charName = charDef?.displayName || 'unknown';
      throw new Error(`Missing animation data for fighter '${charName}'`);
    }

    const result = ModelLoader.createFighterFromGLB(
      animData.model, animData.clips, animData.texture
    );
    const root = result.root;
    const joints = result.joints;
    this.mixer = result.mixer;
    this.clipActions = result.actions;

    this.root = root;
    this.joints = joints;
    this.visualRoot = new THREE.Group();
    this.visualRoot.add(this.root);

    // Visual-only alignment tweaks live on a wrapper so gameplay anchors keep
    // using the clean GLB root transform.
    if (charDef.rootRotationY) {
      this.visualRoot.rotation.y = charDef.rootRotationY;
    }
    if (charDef.modelRotationX) {
      this.visualRoot.rotation.x += charDef.modelRotationX;
    }
    if (charDef.modelYOffset) {
      this.visualRoot.position.y += charDef.modelYOffset;
    }

    this.group = new THREE.Group();
    this.group.add(this.visualRoot);

    this.weapon = new Weapon(this.weaponType);

    const trailColor = this.isP2 ? 0x4488ff : 0xff4444;
    this.trail = new TrailEffect(trailColor);

    // State indicators (floating shapes above head)
    this._stateIndicator = this._createStateIndicators();
    this.group.add(this._stateIndicator.group);
    this._playerMarker = this._createPlayerMarker();
    this.group.add(this._playerMarker);

    // Knockback multiplier (set by Game on clash/block for heavy advantage)
    this.knockbackMult = 1;

    // Ragdoll state
    this._ragdoll = null;
    this._remoteTargetPosition = new THREE.Vector3();
    this._remoteTargetRotationY = this.group.rotation.y;
    this._hasRemoteTarget = false;

    this._setImmediateIdlePose();
    this._updatePlayerMarker();
    this._updateTipMotion();
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

  _createPlayerMarker() {
    const color = this.isP2 ? 0x3f7cff : 0xff4a4a;
    const markerTexture = Fighter._getPlayerMarkerTexture();
    const markerGeo = new THREE.PlaneGeometry(1.25, 1.25);
    const markerMat = new THREE.MeshBasicMaterial({
      color,
      map: markerTexture,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.rotation.x = -Math.PI / 2;
    marker.position.y = 0.012;
    return marker;
  }

  static _getPlayerMarkerTexture() {
    if (Fighter._playerMarkerTexture) return Fighter._playerMarkerTexture;
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createRadialGradient(
      size * 0.5,
      size * 0.5,
      size * 0.28,
      size * 0.5,
      size * 0.5,
      size * 0.5,
    );
    gradient.addColorStop(0.0, 'rgba(255,255,255,0.0)');
    gradient.addColorStop(0.54, 'rgba(255,255,255,0.0)');
    gradient.addColorStop(0.68, 'rgba(255,255,255,0.82)');
    gradient.addColorStop(0.78, 'rgba(255,255,255,0.55)');
    gradient.addColorStop(0.88, 'rgba(255,255,255,0.18)');
    gradient.addColorStop(1.0, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    Fighter._playerMarkerTexture = texture;
    return texture;
  }

  _updatePlayerMarker() {
    if (!this._playerMarker) return;
    this.getBodyCollisionPosition(_markerBodyPosition);
    this.group.worldToLocal(_markerBodyPosition);
    this._playerMarker.position.x = _markerBodyPosition.x;
    this._playerMarker.position.z = _markerBodyPosition.z;
    this._playerMarker.position.y = 0.012;
  }

  _setImmediateIdlePose() {
    if (!this.mixer) return;
    this.mixer.stopAllAction();
    this.activeClipName = null;
    const idleAction = this.clipActions.idle;
    if (!idleAction) return;
    idleAction.reset();
    idleAction.timeScale = 1;
    idleAction.setLoop(THREE.LoopRepeat);
    idleAction.setEffectiveWeight(1);
    idleAction.play();
    this.mixer.update(0);
    this.activeClipName = 'idle';
  }

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
    this._beginUpdateCore(dt, opponent);

    // Update animation based on state
    this._updateClipAnimation();

    // Update mixer for clip-based animations
    if (this.mixer) {
      this.mixer.update(dt);
    }

    this._updatePlayerMarker();

    // Update trail
    this._updateTrail();

    // Update state indicators
    this._updateStateIndicators();
    this._finishUpdateCore();
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
    const weaponBaseJoint = this.joints.weaponBase;
    if (weaponBaseJoint) {
      return weaponBaseJoint.getWorldPosition(target);
    }
    const handJoint = this.joints.handR || this.joints.handL;
    if (handJoint) {
      return handJoint.getWorldPosition(target);
    }
    return target.copy(this.position).setY(WEAPON_FALLBACKS.baseHeight);
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
    return target.copy(this.position).setY(BODY_COLLISION.centerHeight);
  }

  _updateClipAnimation() {
    const pick = (...names) => {
      for (const n of names) {
        if (this.clipActions[n]) return n;
      }
      return names[names.length - 1];
    };
    const { clipName, loopOnce } = this._getPresentationClip(pick);

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
    const isAttacking = this.state === FighterState.ATTACK_ACTIVE;
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

  syncStatePresentation() {
    this._updateClipAnimation();
    this._updateStateIndicators();
    this._updateTrail();
  }

  _getAttackFrameCount(type) {
    let clipName;
    if (type === AttackType.THRUST) {
      clipName = this.clipActions.attack_thrust ? 'attack_thrust' : 'attack';
    } else if (type === AttackType.HEAVY) {
      clipName = this.clipActions.attack_heavy ? 'attack_heavy' : 'attack';
    } else {
      clipName = this.clipActions.attack_quick ? 'attack_quick' : 'attack';
    }

    const action = this.clipActions[clipName];
    let attackFrames = 1;
    if (action) {
      const hasSeparateClips = this.clipActions.attack_quick || this.clipActions.attack_heavy || this.clipActions.attack_thrust;
      const timeScale = (!hasSeparateClips && type === AttackType.HEAVY) ? 0.5 : 1.0;
      action.timeScale = timeScale;
      const clipDuration = action.getClip().duration / timeScale;
      attackFrames = Math.max(1, Math.ceil(clipDuration * 60));
    }

    return attackFrames;
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
      rootStartX: this.visualRoot.rotation.x,
      rootStartZ: this.visualRoot.rotation.z,
      rootTargetX: this.visualRoot.rotation.x + (Math.PI / 2 + Math.random() * 0.3) * (Math.random() > 0.5 ? 1 : -1),
      rootTargetZ: this.visualRoot.rotation.z + (Math.random() - 0.5) * 0.8,
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
    this.visualRoot.rotation.x = r.rootStartX + (r.rootTargetX - r.rootStartX) * ease;
    this.visualRoot.rotation.z = r.rootStartZ + (r.rootTargetZ - r.rootStartZ) * ease;

    const forwardTilt = Math.max(0, this.visualRoot.rotation.x) * 0.4;
    const backwardTilt = Math.max(0, -this.visualRoot.rotation.x) * 0.2;
    const sideTilt = Math.abs(this.visualRoot.rotation.z) * 0.15;
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
    this._resetCoreState(xPos);
    this.trail.stop();
    this.walkPhase = 0;
    this._ragdoll = null;
    this.visualRoot.rotation.y = this.charDef.rootRotationY ?? 0;
    this.visualRoot.rotation.x = this.charDef.modelRotationX ?? 0;
    this.visualRoot.rotation.z = 0;
    this.position.y = 0;

    if (this.mixer) {
      this._setImmediateIdlePose();
    }

    this._updatePlayerMarker();
    this._updateTipMotion();
    this._hasRemoteTarget = false;
    this._remoteTargetPosition.copy(this.position);
    this._remoteTargetRotationY = this.group.rotation.y;
  }

  applyAuthoritativeSnapshot(snapshot) {
    if (snapshot?.position) {
      this._remoteTargetPosition.set(
        snapshot.position.x ?? this.position.x,
        snapshot.position.y ?? this.position.y,
        snapshot.position.z ?? this.position.z,
      );
      this._remoteTargetRotationY = snapshot.rotationY ?? this.group.rotation.y;
      if (!this._hasRemoteTarget) {
        this.position.copy(this._remoteTargetPosition);
        this.group.rotation.y = this._remoteTargetRotationY;
        this._hasRemoteTarget = true;
      }
    }

    this._applySnapshotCore(snapshot, (attackType) => getAttackData(attackType, this.weaponType), {
      applyTransform: false,
    });

    this._updatePlayerMarker();
    this.syncStatePresentation();
    const action = this.activeClipName ? this.clipActions[this.activeClipName] : null;
    if (action) {
      const clipDuration = action.getClip().duration / Math.max(action.timeScale || 1, 1e-6);
      const progress = Math.max(0, Math.min(1, (snapshot.stateDuration ?? 0) > 0
        ? (snapshot.stateFrames ?? 0) / snapshot.stateDuration
        : 0));
      action.time = clipDuration * progress;
      this.mixer?.update(0);
    }
    this._updateTipMotion();
  }

  updateRemoteView(dt) {
    if (this._ragdoll) {
      this._updateRagdoll(dt);
      return;
    }

    if (this._hasRemoteTarget) {
      _remoteTargetPosition.copy(this._remoteTargetPosition).sub(this.position);
      if (_remoteTargetPosition.length() > REMOTE_VIEW_TUNING.snapDistance) {
        this.position.copy(this._remoteTargetPosition);
      } else {
        const blend = 1 - Math.exp(-REMOTE_VIEW_TUNING.positionBlendSpeed * dt);
        this.position.lerp(this._remoteTargetPosition, blend);
      }
      this.group.rotation.y = moveAngleTowards(
        this.group.rotation.y,
        this._remoteTargetRotationY,
        REMOTE_VIEW_TUNING.rotationBlendSpeed * dt,
      );
    }

    if (this.mixer) {
      this.mixer.update(dt);
    }

    this._updatePlayerMarker();
    this._updateTrail();
    this._updateStateIndicators();
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


