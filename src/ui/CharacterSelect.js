import { CHARACTER_DEFS, DEFAULT_CHAR } from '../entities/CharacterDefs.js';
import { getDefaultMultiplayerWsUrl } from '../net/NetConfig.js';

export class CharacterSelect {
  constructor() {
    this.el = document.getElementById('select-screen');
    this.onConfirm = null;

    this.mode = 'ai';
    this.difficulty = 'medium';
    this.p1Char = DEFAULT_CHAR;
    this.p2Char = DEFAULT_CHAR;
    this.difficultySection = document.getElementById('difficulty-section');
    this.onlineSection = document.getElementById('online-section');
    this.onlineServerUrl = document.getElementById('online-server-url');
    this.onlineLobbyCode = document.getElementById('online-lobby-code');
    this.onlineStatusNote = this.onlineSection?.querySelector('.status-note') ?? null;
    this.onlineLeaveBtn = document.getElementById('online-leave-btn');
    this.p1Container = document.getElementById('p1-char-options');
    this.p2Container = document.getElementById('p2-char-options');
    this.p2Heading = document.getElementById('p2-char-heading');
    this.p2Column = this.p2Heading?.closest('.char-select-column') ?? null;
    this.startBtn = document.getElementById('start-fight-btn');
    this.controlsBtn = document.getElementById('controls-btn');
    this.controlsModal = document.getElementById('controls-modal');
    this.controlsCloseBtn = document.getElementById('controls-close-btn');
    this._keyHandler = this._onKey.bind(this);
    this._onlineBusy = false;
    this._onlineLocked = false;
    this.onLeaveOnline = null;

    if (this.onlineServerUrl && !this.onlineServerUrl.value) {
      this.onlineServerUrl.value = getDefaultMultiplayerWsUrl();
    }

    this._setupButtons();
    this._buildCharButtons();
    this._updateModeUI();
  }

  _setupButtons() {
    // Mode buttons
    document.querySelectorAll('#mode-options .select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#mode-options .select-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.mode = btn.dataset.mode;
        this._updateModeUI();
      });
    });

    // Difficulty buttons
    document.querySelectorAll('#difficulty-options .select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#difficulty-options .select-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.difficulty = btn.dataset.diff;
      });
    });

    // Start button
    document.getElementById('start-fight-btn').addEventListener('click', () => {
      if (this._onlineBusy) return;
      if (this.onConfirm) {
        this.onConfirm({
          mode: this.mode,
          difficulty: this.difficulty,
          p1Char: this.p1Char,
          p2Char: this.p2Char,
          serverUrl: this.onlineServerUrl?.value?.trim() || '',
          lobbyCode: this.onlineLobbyCode?.value?.trim().toUpperCase() || '',
        });
      }
    });

    if (this.onlineLobbyCode) {
      this.onlineLobbyCode.addEventListener('input', () => this._updateStartButton());
    }
    if (this.onlineLeaveBtn) {
      this.onlineLeaveBtn.addEventListener('click', () => {
        if (this.onLeaveOnline) this.onLeaveOnline();
      });
    }

    if (this.controlsBtn) {
      this.controlsBtn.addEventListener('click', () => this._setControlsOpen(true));
    }
    if (this.controlsCloseBtn) {
      this.controlsCloseBtn.addEventListener('click', () => this._setControlsOpen(false));
    }
    if (this.controlsModal) {
      this.controlsModal.addEventListener('click', (e) => {
        if (e.target === this.controlsModal) this._setControlsOpen(false);
      });
    }
  }

  _buildCharButtons() {
    if (!this.p1Container || !this.p2Container) return;

    const charIds = Object.keys(CHARACTER_DEFS);

    // Hide character section if only one character
    const section = this.p1Container.closest('.select-section');
    if (charIds.length <= 1 && section) {
      section.style.display = 'none';
      return;
    }

    this.p1Container.innerHTML = '';
    this.p2Container.innerHTML = '';
    for (const id of charIds) {
      const def = CHARACTER_DEFS[id];
      this.p1Container.appendChild(this._createCharButton(id, def.displayName, 1));
      this.p2Container.appendChild(this._createCharButton(id, def.displayName, 2));
    }
  }

  _createCharButton(id, label, playerIndex) {
    const btn = document.createElement('button');
    btn.className = 'select-btn';
    btn.dataset.char = id;
    btn.textContent = label.toUpperCase();

    const isActive = playerIndex === 1 ? id === this.p1Char : id === this.p2Char;
    if (isActive) btn.classList.add('active');

    btn.addEventListener('click', () => {
      const container = playerIndex === 1 ? this.p1Container : this.p2Container;
      container.querySelectorAll('.select-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (playerIndex === 1) {
        this.p1Char = id;
      } else {
        this.p2Char = id;
      }
    });

    return btn;
  }

  _updateOpponentLabel() {
    if (!this.p2Heading) return;
    this.p2Heading.textContent = this.mode === 'ai'
      ? 'Computer Character'
      : this.mode === 'online'
        ? 'Opponent Character'
        : 'Player 2 Character';
  }

  _updateModeUI() {
    if (this.difficultySection) {
      this.difficultySection.style.display = this.mode === 'ai' ? 'block' : 'none';
    }
    if (this.onlineSection) {
      this.onlineSection.style.display = this.mode === 'online' ? 'block' : 'none';
    }
    if (this.p2Column) {
      this.p2Column.style.display = this.mode === 'online' ? 'none' : '';
    }
    if (this.startBtn) {
      this._updateStartButton();
    }
    this._updateOpponentLabel();
  }

  _updateStartButton() {
    if (!this.startBtn) return;
    if (this.mode !== 'online') {
      this.startBtn.textContent = 'FIGHT';
      this.startBtn.disabled = false;
      if (this.onlineLeaveBtn) this.onlineLeaveBtn.style.display = 'none';
      return;
    }

    if (this._onlineBusy) {
      this.startBtn.textContent = 'CONNECTING...';
      this.startBtn.disabled = true;
      if (this.onlineLeaveBtn) {
        this.onlineLeaveBtn.style.display = this._onlineLocked ? '' : 'none';
        this.onlineLeaveBtn.disabled = true;
      }
      return;
    }

    const lobbyCode = this.onlineLobbyCode?.value?.trim() ?? '';
    if (this._onlineLocked) {
      this.startBtn.textContent = 'READY';
    } else if (lobbyCode) {
      this.startBtn.textContent = 'JOIN';
    } else {
      this.startBtn.textContent = 'HOST';
    }
    this.startBtn.disabled = false;
    if (this.onlineLeaveBtn) {
      this.onlineLeaveBtn.style.display = this._onlineLocked ? '' : 'none';
      this.onlineLeaveBtn.disabled = false;
    }
  }

  setOnlineLobbyCode(code = '') {
    if (this.onlineLobbyCode) {
      this.onlineLobbyCode.value = code;
    }
    this._updateStartButton();
  }

  setOnlineStatus(message) {
    if (this.onlineStatusNote) {
      this.onlineStatusNote.textContent = message;
    }
  }

  setOnlineBusy(busy) {
    this._onlineBusy = Boolean(busy);
    this._updateStartButton();
  }

  setOnlineLocked(locked) {
    this._onlineLocked = Boolean(locked);
    if (this.onlineServerUrl) this.onlineServerUrl.readOnly = this._onlineLocked;
    if (this.onlineLobbyCode) this.onlineLobbyCode.readOnly = this._onlineLocked;
    this._updateStartButton();
  }

  resetOnlineState() {
    this._onlineBusy = false;
    this._onlineLocked = false;
    if (this.onlineServerUrl) this.onlineServerUrl.readOnly = false;
    if (this.onlineLobbyCode) this.onlineLobbyCode.readOnly = false;
    this._updateStartButton();
  }

  show() {
    this.el.style.display = 'flex';
    this._updateModeUI();
    this._setControlsOpen(false);
    window.addEventListener('keydown', this._keyHandler);
  }

  hide() {
    this.el.style.display = 'none';
    this._setControlsOpen(false);
    window.removeEventListener('keydown', this._keyHandler);
  }

  _setControlsOpen(open) {
    if (!this.controlsModal) return;
    this.controlsModal.classList.toggle('open', open);
  }

  _onKey(e) {
    if (e.code === 'Escape' && this.controlsModal?.classList.contains('open')) {
      this._setControlsOpen(false);
    }
  }
}
