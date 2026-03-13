import * as THREE from 'three';
import { DEBUG_OPTIONS } from '../core/Constants.js';

export class DebugOverlay {
  constructor(scene = null) {
    this.enabled = this._loadInitialState();
    this.scene = scene;
    this.el = document.createElement('div');
    this.el.id = 'debug-overlay';
    this.el.style.cssText = [
      'position:fixed',
      'top:8px',
      'right:8px',
      'z-index:1000',
      'width:min(320px, 32vw)',
      'max-height:min(42vh, 360px)',
      'overflow:auto',
      'padding:8px 10px',
      'background:rgba(0,0,0,0.72)',
      'border:1px solid rgba(120,220,160,0.35)',
      'color:#b8ffd3',
      'font:11px/1.25 Consolas, Monaco, monospace',
      'white-space:pre-wrap',
      'pointer-events:none',
      'display:none',
    ].join(';');
    document.body.appendChild(this.el);

    this._onKeyDown = (event) => {
      if (event.code === DEBUG_OPTIONS.toggleKey) {
        this.setEnabled(!this.enabled);
      }
    };
    window.addEventListener('keydown', this._onKeyDown);
    this._createSceneHelpers();
    this._syncVisibility();
  }

  _loadInitialState() {
    if (!DEBUG_OPTIONS.persistToggle) {
      return DEBUG_OPTIONS.overlayEnabled;
    }

    const saved = window.localStorage.getItem(DEBUG_OPTIONS.storageKey);
    if (saved == null) {
      return DEBUG_OPTIONS.overlayEnabled;
    }
    return saved === 'true';
  }

  _syncVisibility() {
    this.el.style.display = this.enabled ? 'block' : 'none';
    if (this.helperRoot) {
      this.helperRoot.visible = this.enabled;
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (DEBUG_OPTIONS.persistToggle) {
      window.localStorage.setItem(DEBUG_OPTIONS.storageKey, String(enabled));
    }
    this._syncVisibility();
  }

  update(data) {
    if (!this.enabled) return;
    this.el.textContent = this._formatData(data);
    this._updateSceneHelpers(data);
  }

  _formatData(data) {
    if (!data) {
      return `Debug Overlay (${DEBUG_OPTIONS.toggleKey})`;
    }

    const lines = [];
    lines.push(`Debug Overlay  [${DEBUG_OPTIONS.toggleKey}]`);
    lines.push(`state=${data.gameState} frame=${data.frameCount} timeScale=${data.timeScale.toFixed(2)} rawDt=${data.rawDelta.toFixed(4)} steps=${data.steps} timer=${data.stateTimer.toFixed(3)}`);
    lines.push(`mode=${data.mode} difficulty=${data.difficulty} round=${data.currentRound} score=${data.p1Score}-${data.p2Score} hitstop=${data.screen.hitstopFrames} freeze=${data.screen.onHitstop}`);
    lines.push(`camera killCam=${data.camera.killCamActive} phase=${data.camera.killCamPhase} orbit=${data.camera.orbitAngle.toFixed(2)} shake=${data.camera.shakeIntensity.toFixed(3)} killTime=${data.camera.killCamTime.toFixed(2)}`);
    lines.push(`distance=${data.distance.toFixed(3)} animSandbox=${data.animSandbox}`);

    if (data.ai) {
      lines.push(`ai current=${data.ai.currentAction ?? '-'} pending=${data.ai.pendingAction ?? '-'} react=${data.ai.reactionFrames} noise=${data.ai.decisionNoise.toFixed(2)} aggro=${data.ai.aggression.toFixed(2)} parry=${data.ai.parryRate.toFixed(2)}`);
      lines.push(`ai sideDir=${data.ai.sideDir} blockHeld=${data.ai.blockHeldFrames}`);
    } else {
      lines.push('ai current=- pending=-');
    }

    lines.push('');
    lines.push(this._formatFighter('P1', data.fighter1));
    lines.push('');
    lines.push(this._formatFighter('P2', data.fighter2));
    return lines.join('\n');
  }

  _formatFighter(label, fighter) {
    if (!fighter) {
      return `${label}: missing`;
    }

    const lines = [];
    lines.push(`${label} ${fighter.charName} weapon=${fighter.weaponType} state=${fighter.state} frames=${fighter.stateFrames} attack=${fighter.attackType ?? '-'} clip=${fighter.activeClip ?? '-'} hitApplied=${fighter.hitApplied}`);
    lines.push(`  pos=(${fighter.position.x.toFixed(2)}, ${fighter.position.z.toFixed(2)}) rotY=${fighter.rotationY.toFixed(2)} facingRight=${fighter.facingRight} step=${fighter.stepping ? fighter.stepDirection : 0} stepFrames=${fighter.stepFrames} cooldown=${fighter.stepCooldown}`);
    lines.push(`  actionable=${fighter.actionable} attacking=${fighter.attacking} sidestepPhase=${fighter.sidestepPhase ?? '-'} dead=${fighter.dead}`);
    lines.push(`  tipSpeed=${fighter.tipSpeed.toFixed(4)} baseSpeed=${fighter.baseSpeed.toFixed(4)} relTarget=${fighter.tipRelativeToward.toFixed(4)} relForward=${fighter.tipRelativeForward.toFixed(4)}`);
    if (fighter.collision) {
      lines.push(`  collision dist=${fighter.collision.distance.toFixed(4)} hurtRadius=${fighter.collision.hurtRadius.toFixed(3)} hurtHeight=${fighter.collision.hurtHeight.toFixed(3)} defender=${fighter.collision.defenderState ?? '-'}`);
      lines.push(`  collision motionGate=${fighter.collision.motionGatePassed} forward=${fighter.collision.forwardDrive.toFixed(4)} toward=${fighter.collision.towardTarget.toFixed(4)} segmentHit=${fighter.collision.segmentHit}`);
      lines.push(`  collision resolve=${fighter.collision.lastResolve ?? '-'} result=${fighter.collision.lastCheckResult ?? '-'}`);
    }
    return lines.join('\n');
  }

  destroy() {
    window.removeEventListener('keydown', this._onKeyDown);
    if (this.helperRoot?.parent) {
      this.helperRoot.parent.remove(this.helperRoot);
    }
    this.el.remove();
  }

  _createSceneHelpers() {
    if (!this.scene) return;

    this.helperRoot = new THREE.Group();
    this.helperRoot.visible = this.enabled;
    this.scene.add(this.helperRoot);

    this._fighterHelpers = [
      this._buildFighterHelpers(0xff6666, 0xffb347),
      this._buildFighterHelpers(0x66aaff, 0x66ffd9),
    ];
    for (const helper of this._fighterHelpers) {
      this.helperRoot.add(helper.group);
    }
  }

  _buildFighterHelpers(hurtColor, segmentColor) {
    const group = new THREE.Group();

    const hurt = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: hurtColor,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    );

    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 1.8, 20, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.06,
        depthWrite: false,
      }),
    );

    const lineGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(0, 1, 0),
    ]);
    const weaponLine = new THREE.Line(
      lineGeom,
      new THREE.LineBasicMaterial({
        color: segmentColor,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    );

    const base = new THREE.Mesh(
      new THREE.SphereGeometry(0.04, 10, 8),
      new THREE.MeshBasicMaterial({
        color: segmentColor,
        transparent: true,
        opacity: 0.75,
        depthWrite: false,
      }),
    );

    const tip = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 10, 8),
      new THREE.MeshBasicMaterial({
        color: segmentColor,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
      }),
    );

    group.add(hurt);
    group.add(body);
    group.add(weaponLine);
    group.add(base);
    group.add(tip);

    return { group, hurt, body, weaponLine, base, tip };
  }

  _updateSceneHelpers(data) {
    if (!this.helperRoot || !data) return;
    this._updateFighterHelper(this._fighterHelpers[0], data.fighter1);
    this._updateFighterHelper(this._fighterHelpers[1], data.fighter2);
  }

  _updateFighterHelper(helper, fighter) {
    if (!helper) return;
    if (!fighter) {
      helper.group.visible = false;
      return;
    }

    helper.group.visible = true;

    helper.hurt.position.set(
      fighter.hurtCenter.x,
      fighter.hurtCenter.y,
      fighter.hurtCenter.z,
    );
    helper.hurt.scale.set(fighter.hurtRadius, fighter.hurtHeight, fighter.hurtRadius);

    helper.body.position.set(
      fighter.bodyCollision.x,
      0.9,
      fighter.bodyCollision.z,
    );
    helper.body.scale.set(fighter.bodyRadius, 1, fighter.bodyRadius);

    const base = new THREE.Vector3(
      fighter.weaponBase.x,
      fighter.weaponBase.y,
      fighter.weaponBase.z,
    );
    const tip = new THREE.Vector3(
      fighter.weaponTip.x,
      fighter.weaponTip.y,
      fighter.weaponTip.z,
    );
    helper.base.position.copy(base);
    helper.tip.position.copy(tip);
    helper.weaponLine.geometry.setFromPoints([base, tip]);
  }
}
