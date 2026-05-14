import { ROUNDS_TO_WIN } from '../core/Constants.js';

export class HUD {
  constructor() {
    this.el = document.getElementById('hud');
    this.roundAnnounce = document.getElementById('round-announce');
    this.roundText = this.roundAnnounce.querySelector('.round-text');
    this.fightText = this.roundAnnounce.querySelector('.fight-text');
    this.onlineStrip = document.getElementById('online-hud-strip');
    this.onlineStatus = document.getElementById('online-hud-status');
    this.onlineCode = document.getElementById('online-hud-code');
    this.onlinePing = document.getElementById('online-hud-ping');
    this.stageBadge = document.getElementById('stage-hud-badge');
    this.stageName = document.getElementById('stage-hud-name');
    this.stageTagline = document.getElementById('stage-hud-tagline');
  }

  show() {
    this.el.style.display = 'block';
    const hide = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
    hide('p1-stance');
    hide('p2-stance');
    hide('p1-body');
    hide('p2-body');
  }

  hide() {
    this.el.style.display = 'none';
  }

  setOnlineMeta({ visible = false, status = 'Offline', code = '------', pingMs = null } = {}) {
    if (!this.onlineStrip || !this.onlineStatus || !this.onlineCode || !this.onlinePing) return;
    this.onlineStrip.style.display = visible ? 'flex' : 'none';
    this.onlineStatus.textContent = status;
    this.onlineCode.textContent = code || '------';
    this.onlinePing.textContent = Number.isFinite(pingMs) ? `${Math.round(pingMs)} ms` : '--';
  }

  setStage(stage = null) {
    if (!this.stageBadge || !this.stageName || !this.stageTagline) return;
    if (!stage) {
      this.stageBadge.style.display = 'none';
      return;
    }
    this.stageBadge.style.display = 'block';
    this.stageName.textContent = stage.name;
    this.stageTagline.textContent = stage.tagline;
    if (stage.ui) {
      this.stageBadge.style.setProperty('--stage-accent', stage.ui.accent);
      this.stageBadge.style.setProperty('--stage-border', stage.ui.border);
      this.stageBadge.style.setProperty('--stage-panel-top', stage.ui.panelTop);
      this.stageBadge.style.setProperty('--stage-panel-bottom', stage.ui.panelBottom);
      this.stageBadge.style.setProperty('--stage-glow', stage.ui.glow);
      this.stageBadge.style.setProperty('--stage-muted', stage.ui.muted);
    }
  }

  updateRoundPips(p1Wins, p2Wins) {
    this._renderPips('p1-pips', p1Wins);
    this._renderPips('p2-pips', p2Wins);
  }

  _renderPips(containerId, wins) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < ROUNDS_TO_WIN; i++) {
      const pip = document.createElement('div');
      pip.className = 'pip' + (i < wins ? ' won' : '');
      container.appendChild(pip);
    }
  }

  showRoundAnnounce(roundNum) {
    this.roundAnnounce.style.display = 'block';
    this.roundText.textContent = `ROUND ${roundNum}`;
    this.fightText.textContent = '';
  }

  showFight() {
    this.fightText.textContent = 'FIGHT!';
  }

  hideRoundAnnounce() {
    this.roundAnnounce.style.display = 'none';
  }

  reset() {
    this.hideRoundAnnounce();
    this.setOnlineMeta({ visible: false });
  }
}
