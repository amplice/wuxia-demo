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
  }

  show() {
    this.el.style.display = 'block';
    // Hide removed elements if they still exist in DOM
    const hide = (id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; };
    hide('p1-stance');
    hide('p2-stance');
    hide('p1-body');
    hide('p2-body');
  }

  hide() {
    this.el.style.display = 'none';
  }

  setOnlineMeta({ visible = false, status = 'Offline', code = '------' } = {}) {
    if (!this.onlineStrip || !this.onlineStatus || !this.onlineCode) return;
    this.onlineStrip.style.display = visible ? 'flex' : 'none';
    this.onlineStatus.textContent = status;
    this.onlineCode.textContent = code || '------';
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
