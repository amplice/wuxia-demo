import { CHARACTER_DEFS, DEFAULT_CHAR } from '../entities/CharacterDefs.js';
import { getDefaultMultiplayerWsUrl } from '../net/NetConfig.js';
import { DEFAULT_STAGE, STAGE_IDS, getStageDef } from '../arena/StageDefs.js';
import { DEFAULT_STAGE_FX, STAGE_FX_DEFS, getStageFxDef } from '../arena/StageFxDefs.js';

const STORAGE_KEY = 'ringofsteel.select.v1';

export class CharacterSelect {
  constructor() {
    this.el = document.getElementById('select-screen');
    this.onConfirm = null;

    this.mode = 'ai';
    this.difficulty = 'medium';
    this.p1Char = DEFAULT_CHAR;
    this.p2Char = DEFAULT_CHAR;
    this.stageId = DEFAULT_STAGE;
    this.stageFxId = DEFAULT_STAGE_FX;
    this.onStageChange = null;
    this.onStageFxChange = null;

    this.difficultySection = document.getElementById('difficulty-section');
    this.stageSection = document.getElementById('stage-section');
    this.stageContainer = document.getElementById('stage-options');
    this.stagePreview = this.stageSection?.querySelector('.stage-preview') ?? null;
    this.stageTitle = document.getElementById('stage-preview-title');
    this.stageDescription = document.getElementById('stage-preview-description');
    this.stageStats = document.getElementById('stage-preview-stats');
    this.stageFxSection = document.getElementById('stage-fx-section');
    this.stageFxContainer = document.getElementById('stage-fx-options');
    this.stageFxPreview = this.stageFxSection?.querySelector('.stage-fx-preview') ?? null;
    this.stageFxTitle = document.getElementById('stage-fx-preview-title');
    this.stageFxDescription = document.getElementById('stage-fx-preview-description');
    this.stageFxSource = document.getElementById('stage-fx-preview-source');
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

    this._loadPreferences();

    this._setupButtons();
    this._buildCharButtons();
    this._buildStageButtons();
    this._buildStageFxButtons();
    this._syncModeButtons();
    this._syncDifficultyButtons();
    this._updateModeUI();
    this.clearOnlineLobbyInfo();
    this._updateStagePreview();
    this._updateStageFxPreview();
  }

  _setupButtons() {
    document.querySelectorAll('#mode-options .select-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#mode-options .select-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.mode = btn.dataset.mode;
        this._savePreferences();
        this._updateModeUI();
        if (this.onModeChange) this.onModeChange(this.mode);
      });
    });

    document.querySelectorAll('#difficulty-options .select-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#difficulty-options .select-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.difficulty = btn.dataset.diff;
        this._savePreferences();
      });
    });

    document.getElementById('start-fight-btn').addEventListener('click', () => {
      if (this._onlineBusy) return;
      if (this.onConfirm) {
        this.onConfirm(this._buildOnlineConfig());
      }
    });

    if (this.onlineLobbyCode) {
      this.onlineLobbyCode.addEventListener('input', () => this._updateStartButton());
    }
    if (this.onlineServerUrl) {
      this.onlineServerUrl.addEventListener('change', () => this._savePreferences());
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

  _buildStageButtons() {
    if (!this.stageContainer) return;
    this.stageContainer.innerHTML = '';
    for (const id of STAGE_IDS) {
      const stage = getStageDef(id);
      const btn = document.createElement('button');
      btn.className = 'select-btn stage-select-btn' + (id === this.stageId ? ' active' : '');
      btn.dataset.stage = id;
      const metrics = stage.ui?.metrics ?? [];
      const meta = metrics.slice(0, 2).map((item) => `<span>${item.value}</span>`).join('');
      this._applyStageTheme(btn, stage);
      btn.innerHTML = `
        <span class="stage-select-name">${stage.name}</span>
        <span class="stage-select-tag">${stage.tagline}</span>
        <span class="stage-select-meta">${meta}</span>
      `;
      btn.addEventListener('click', () => this.setStage(id));
      this.stageContainer.appendChild(btn);
    }
    this._updateStageButtons();
  }

  _buildStageFxButtons() {
    if (!this.stageFxContainer) return;
    this.stageFxContainer.innerHTML = '';
    for (const effect of STAGE_FX_DEFS) {
      const btn = document.createElement('button');
      btn.className = 'select-btn stage-fx-btn' + (effect.id === this.stageFxId ? ' active' : '');
      btn.dataset.stageFx = effect.id;
      btn.innerHTML = `
        <span class="stage-fx-name">${effect.name}</span>
        <span class="stage-fx-tag">${effect.tagline}</span>
      `;
      btn.addEventListener('click', () => this.setStageFx(effect.id));
      this.stageFxContainer.appendChild(btn);
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
      container.querySelectorAll('.select-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      if (playerIndex === 1) {
        this.p1Char = id;
      } else {
        this.p2Char = id;
      }
      this._savePreferences();
    });

    return btn;
  }

  setStage(stageId, { silent = false } = {}) {
    const stage = getStageDef(stageId);
    this.stageId = stage.id;
    if (this.stageContainer) {
      this.stageContainer.querySelectorAll('[data-stage]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.stage === stage.id);
      });
    }
    this._updateStagePreview();
    this._updateStageFxPreview();
    this._savePreferences();
    if (!silent && this.onStageChange) {
      this.onStageChange(stage.id);
    }
  }

  setStageFx(stageFxId, { silent = false } = {}) {
    const effect = getStageFxDef(stageFxId);
    this.stageFxId = effect.id;
    if (this.stageFxContainer) {
      this.stageFxContainer.querySelectorAll('[data-stage-fx]').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.stageFx === effect.id);
      });
    }
    this._updateStageFxPreview();
    this._savePreferences();
    if (!silent && this.onStageFxChange) {
      this.onStageFxChange(effect.id);
    }
  }

  _syncModeButtons() {
    document.querySelectorAll('#mode-options .select-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.mode === this.mode);
    });
  }

  _syncDifficultyButtons() {
    document.querySelectorAll('#difficulty-options .select-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.diff === this.difficulty);
    });
  }

  _updateStagePreview() {
    const stage = getStageDef(this.stageId);
    if (this.stageTitle) this.stageTitle.textContent = stage.name;
    if (this.stageDescription) this.stageDescription.textContent = stage.description;
    if (this.stageStats) {
      const metrics = stage.ui?.metrics ?? [];
      this.stageStats.innerHTML = metrics.map((metric) => `
        <div class="stage-stat">
          <span class="stage-stat-label">${metric.label}</span>
          <span class="stage-stat-value">${metric.value}</span>
        </div>
      `).join('');
    }
    if (this.stagePreview) this._applyStageTheme(this.stagePreview, stage);
    if (this.stageSection) this._applyStageTheme(this.stageSection, stage);
  }

  _updateStageFxPreview() {
    const effect = getStageFxDef(this.stageFxId);
    if (this.stageFxTitle) this.stageFxTitle.textContent = effect.name;
    if (this.stageFxDescription) this.stageFxDescription.textContent = effect.description;
    if (this.stageFxSource) this.stageFxSource.textContent = effect.sourceHint;
    if (this.stageFxPreview) this._applyStageTheme(this.stageFxPreview, getStageDef(this.stageId));
    if (this.stageFxSection) this._applyStageTheme(this.stageFxSection, getStageDef(this.stageId));
  }

  _updateStageButtons() {
    const disabled = this.mode === 'online' && this._onlineLocked;
    this.stageContainer?.querySelectorAll('[data-stage]').forEach((btn) => {
      btn.disabled = disabled;
    });
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
    this._updateStageButtons();
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
      stageId: this.stageId,
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

      const stage = getStageDef(lobby.stageId);
      const main = document.createElement('div');
      main.className = 'online-lobby-main';
      main.innerHTML = `
        <span class="emphasis">${lobby.code}</span>
        <span>${lobby.playerCount}/${lobby.maxPlayers} Players</span>
        <span>${String(lobby.hostCharacterId || 'unknown').replace('_', ' ')}</span>
        <span>${stage.name}</span>
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
    if (detail?.stageId) {
      this.setStage(detail.stageId, { silent: true });
    }
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
    this._updateStageButtons();
    this._renderPublicLobbies();
  }

  setOnlineLocked(locked) {
    this._onlineLocked = Boolean(locked);
    if (this.onlineServerUrl) this.onlineServerUrl.readOnly = this._onlineLocked;
    if (this.onlineLobbyCode) this.onlineLobbyCode.readOnly = this._onlineLocked;
    this._updateStartButton();
    this._updateOnlineButtons();
    this._updateStageButtons();
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
    this._updateStageButtons();
    this._renderPublicLobbies();
  }

  show() {
    this.el.style.display = 'flex';
    this._updateModeUI();
    this._updateStagePreview();
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

  _loadPreferences() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved.mode === 'ai' || saved.mode === 'pvp' || saved.mode === 'online') {
        this.mode = saved.mode;
      }
      if (saved.difficulty === 'easy' || saved.difficulty === 'medium' || saved.difficulty === 'hard') {
        this.difficulty = saved.difficulty;
      }
      if (typeof saved.p1Char === 'string' && CHARACTER_DEFS[saved.p1Char]) {
        this.p1Char = saved.p1Char;
      }
      if (typeof saved.p2Char === 'string' && CHARACTER_DEFS[saved.p2Char]) {
        this.p2Char = saved.p2Char;
      }
      this.stageId = getStageDef(saved.stageId).id;
      this.stageFxId = getStageFxDef(saved.stageFxId).id;
      if (typeof saved.serverUrl === 'string' && this.onlineServerUrl) {
        this.onlineServerUrl.value = saved.serverUrl;
      }
    } catch {
      // Ignore malformed local preferences and fall back to defaults.
    }
  }

  _savePreferences() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode: this.mode,
        difficulty: this.difficulty,
        p1Char: this.p1Char,
        p2Char: this.p2Char,
        stageId: this.stageId,
        stageFxId: this.stageFxId,
        serverUrl: this.onlineServerUrl?.value?.trim() || '',
      }));
    } catch {
      // Ignore storage failures.
    }
  }

  _onKey(e) {
    if (e.code === 'Escape' && this.controlsModal?.classList.contains('open')) {
      this._setControlsOpen(false);
    }
  }

  _applyStageTheme(el, stage) {
    if (!el || !stage?.ui) return;
    el.style.setProperty('--stage-accent', stage.ui.accent);
    el.style.setProperty('--stage-accent-soft', stage.ui.accentSoft);
    el.style.setProperty('--stage-panel-top', stage.ui.panelTop);
    el.style.setProperty('--stage-panel-bottom', stage.ui.panelBottom);
    el.style.setProperty('--stage-border', stage.ui.border);
    el.style.setProperty('--stage-glow', stage.ui.glow);
    el.style.setProperty('--stage-muted', stage.ui.muted);
  }
}
