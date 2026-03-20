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
    this.onlineLobbyList = document.getElementById('online-lobby-list');
    this.onlineLobbyPanel = document.getElementById('online-lobby-panel');
    this.onlineLobbySlot1 = document.getElementById('online-lobby-slot-1');
    this.onlineLobbySlot2 = document.getElementById('online-lobby-slot-2');
    this.onlineStatusNote = this.onlineSection?.querySelector('.status-note') ?? null;
    this.onlineLeaveBtn = document.getElementById('online-leave-btn');
    this.onlineHostPublicBtn = document.getElementById('online-host-public-btn');
    this.onlineQuickMatchBtn = document.getElementById('online-quick-match-btn');
    this.onlineRefreshBtn = document.getElementById('online-refresh-btn');
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
    this._publicLobbies = [];
    this.onLeaveOnline = null;
    this.onModeChange = null;
    this.onOnlineHostPublic = null;
    this.onOnlineQuickMatch = null;
    this.onOnlineRefresh = null;
    this.onOnlineJoinPublic = null;

    if (this.onlineServerUrl && !this.onlineServerUrl.value) {
      this.onlineServerUrl.value = getDefaultMultiplayerWsUrl();
    }

    this._setupButtons();
    this._buildCharButtons();
    this._updateModeUI();
    this.clearOnlineLobbyInfo();
  }

  _setupButtons() {
    // Mode buttons
    document.querySelectorAll('#mode-options .select-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#mode-options .select-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.mode = btn.dataset.mode;
        this._updateModeUI();
        if (this.onModeChange) this.onModeChange(this.mode);
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
    if (this.onlineHostPublicBtn) {
      this.onlineHostPublicBtn.addEventListener('click', () => {
        if (!this._onlineBusy && !this._onlineLocked && this.onOnlineHostPublic) {
          this.onOnlineHostPublic(this._buildOnlineConfig());
        }
      });
    }
    if (this.onlineQuickMatchBtn) {
      this.onlineQuickMatchBtn.addEventListener('click', () => {
        if (!this._onlineBusy && !this._onlineLocked && this.onOnlineQuickMatch) {
          this.onOnlineQuickMatch(this._buildOnlineConfig());
        }
      });
    }
    if (this.onlineRefreshBtn) {
      this.onlineRefreshBtn.addEventListener('click', () => {
        if (!this._onlineBusy && !this._onlineLocked && this.onOnlineRefresh) {
          this.onOnlineRefresh(this._buildOnlineConfig());
        }
      });
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
    this._updateOnlineButtons();
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
      this.startBtn.textContent = 'IN LOBBY';
      this.startBtn.disabled = true;
    } else if (lobbyCode) {
      this.startBtn.textContent = 'JOIN';
      this.startBtn.disabled = false;
    } else {
      this.startBtn.textContent = 'HOST PRIVATE';
      this.startBtn.disabled = false;
    }
    if (this.onlineLeaveBtn) {
      this.onlineLeaveBtn.style.display = this._onlineLocked ? '' : 'none';
      this.onlineLeaveBtn.disabled = false;
    }
  }

  _updateOnlineButtons() {
    const disabled = this.mode !== 'online' || this._onlineBusy || this._onlineLocked;
    if (this.onlineHostPublicBtn) this.onlineHostPublicBtn.disabled = disabled;
    if (this.onlineQuickMatchBtn) this.onlineQuickMatchBtn.disabled = disabled;
    if (this.onlineRefreshBtn) this.onlineRefreshBtn.disabled = disabled;
  }

  _buildOnlineConfig() {
    return {
      mode: this.mode,
      difficulty: this.difficulty,
      p1Char: this.p1Char,
      p2Char: this.p2Char,
      serverUrl: this.onlineServerUrl?.value?.trim() || '',
      lobbyCode: this.onlineLobbyCode?.value?.trim().toUpperCase() || '',
    };
  }

  setPublicLobbies(lobbies = []) {
    this._publicLobbies = Array.isArray(lobbies) ? lobbies : [];
    this._renderPublicLobbies();
  }

  _renderPublicLobbies() {
    if (!this.onlineLobbyList) return;
    this.onlineLobbyList.innerHTML = '';

    if (!this._publicLobbies.length) {
      const empty = document.createElement('div');
      empty.className = 'online-lobby-empty';
      empty.textContent = 'No public matches waiting.';
      this.onlineLobbyList.appendChild(empty);
      return;
    }

    for (const lobby of this._publicLobbies) {
      const row = document.createElement('div');
      row.className = 'online-lobby-row';

      const main = document.createElement('div');
      main.className = 'online-lobby-main';
      main.innerHTML = `
        <span class="emphasis">${lobby.code}</span>
        <span>${lobby.playerCount}/${lobby.maxPlayers} Players</span>
        <span>${String(lobby.hostCharacterId || 'unknown').replace('_', ' ')}</span>
      `;

      const joinBtn = document.createElement('button');
      joinBtn.className = 'select-btn';
      joinBtn.textContent = 'JOIN';
      joinBtn.disabled = this.mode !== 'online' || this._onlineBusy || this._onlineLocked;
      joinBtn.addEventListener('click', () => {
        if (this.onOnlineJoinPublic) {
          this.onOnlineJoinPublic({
            ...this._buildOnlineConfig(),
            lobbyCode: lobby.code,
          });
        }
      });

      row.appendChild(main);
      row.appendChild(joinBtn);
      this.onlineLobbyList.appendChild(row);
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

  setOnlineLobbyInfo(detail = null) {
    if (!this.onlineLobbyPanel || !this.onlineLobbySlot1 || !this.onlineLobbySlot2) return;
    const players = Array.isArray(detail?.players) ? detail.players : [];
    this._setOnlineSlotState(this.onlineLobbySlot1, players.find((player) => player.slot === 0) ?? null, 0);
    this._setOnlineSlotState(this.onlineLobbySlot2, players.find((player) => player.slot === 1) ?? null, 1);
  }

  clearOnlineLobbyInfo() {
    if (!this.onlineLobbySlot1 || !this.onlineLobbySlot2) return;
    this._setOnlineSlotState(this.onlineLobbySlot1, null, 0);
    this._setOnlineSlotState(this.onlineLobbySlot2, null, 1);
  }

  _setOnlineSlotState(slotEl, player, slotIndex) {
    if (!slotEl) return;
    const valueEl = slotEl.querySelector('.value');
    slotEl.classList.toggle('empty', !player?.connected);
    if (!valueEl) return;
    if (!player?.connected) {
      valueEl.textContent = 'Open';
      return;
    }
    const role = slotIndex === 0 ? 'Host' : 'Guest';
    const you = player.self ? ' (You)' : '';
    valueEl.textContent = `${role}${you} Connected`;
  }

  setOnlineBusy(busy) {
    this._onlineBusy = Boolean(busy);
    this._updateStartButton();
    this._updateOnlineButtons();
    this._renderPublicLobbies();
  }

  setOnlineLocked(locked) {
    this._onlineLocked = Boolean(locked);
    if (this.onlineServerUrl) this.onlineServerUrl.readOnly = this._onlineLocked;
    if (this.onlineLobbyCode) this.onlineLobbyCode.readOnly = this._onlineLocked;
    this._updateStartButton();
    this._updateOnlineButtons();
    this._renderPublicLobbies();
  }

  resetOnlineState() {
    this._onlineBusy = false;
    this._onlineLocked = false;
    if (this.onlineServerUrl) this.onlineServerUrl.readOnly = false;
    if (this.onlineLobbyCode) this.onlineLobbyCode.readOnly = false;
    this.clearOnlineLobbyInfo();
    this._updateStartButton();
    this._updateOnlineButtons();
    this._renderPublicLobbies();
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
