import * as THREE from 'three';
import { Renderer } from './core/Renderer.js';
import { Clock } from './core/Clock.js';
import { InputManager } from './core/InputManager.js';
import { Arena } from './arena/Arena.js';
import { Environment } from './arena/Environment.js';
import { CameraController } from './camera/CameraController.js';
import { Fighter } from './entities/Fighter.js';
import { ModelLoader } from './entities/ModelLoader.js';
import { CHARACTER_DEFS, DEFAULT_CHAR } from './entities/CharacterDefs.js';
import { ParticleSystem } from './vfx/ParticleSystem.js';
import { ScreenEffects } from './vfx/ScreenEffects.js';
import { AIController } from './ai/AIController.js';
import { DebugOverlay } from './debug/DebugOverlay.js';
import { UIManager } from './ui/UIManager.js';
import { MatchSim } from './sim/MatchSim.js';
import { captureInputFrame } from './sim/InputFrame.js';
import { OnlineSession } from './net/OnlineSession.js';
import {
  GameState, HitResult,
  FIGHT_START_DISTANCE, ROUNDS_TO_WIN, ROUND_INTRO_DURATION,
  ROUND_END_DELAY,
} from './core/Constants.js';


export class Game {
  constructor() {
    this.renderer = new Renderer();
    this.clock = new Clock();
    this.input = new InputManager();
    this.ui = new UIManager();
    this.screenEffects = new ScreenEffects();

    this.scene = null;
    this.camera = null;
    this.arena = null;
    this.environment = null;
    this.particles = null;

    this.fighter1 = null;
    this.fighter2 = null;
    this.aiController = null;
    this.matchSim = null;
    this.onlineSession = null;
    this.onlineDiscoverySession = null;
    this.onlineLobbyRefreshTimer = null;
    this.onlineLocalSlot = null;
    this.onlineMatchPlayers = null;
    this._suppressOnlineClose = false;
    this.onlinePendingMatchResult = null;
    this._charCache = {};

    this.gameState = GameState.TITLE;
    this.stateTimer = 0;

    // Match state
    this.mode = 'ai';
    this.difficulty = 'medium';
    this.p1Score = 0;
    this.p2Score = 0;
    this.currentRound = 1;
    this.killSlowMoTimer = 0;
    this.animationSandbox = null;
    this.debugOverlay = null;
    this._lastFrameStats = { steps: 0, rawDelta: 0 };
  }

  async init() {
    this.ui.showLoading(0.05, 'Booting renderer...');
    await this.renderer.init();
    this.ui.showLoading(0.15, 'Preparing arena...');

    this.scene = new THREE.Scene();
    this.cameraController = new CameraController();
    this.camera = this.cameraController.camera;

    this.arena = new Arena(this.scene);
    this.environment = new Environment(this.scene);
    this.particles = new ParticleSystem(this.scene);
    this.debugOverlay = new DebugOverlay(this.scene);

    // Preload all characters with explicit progress so startup doesn't look dead.
    const charEntries = Object.entries(CHARACTER_DEFS);
    for (let i = 0; i < charEntries.length; i++) {
      const [id, def] = charEntries[i];
      const progressBase = 0.2 + (i / Math.max(charEntries.length, 1)) * 0.7;
      this.ui.showLoading(progressBase, `Loading ${def.displayName}...`);
      try {
        this._charCache[id] = await ModelLoader.loadCharacter(def);
      } catch (err) {
        console.warn(`Failed to load character '${id}':`, err);
      }
      const progressDone = 0.2 + ((i + 1) / Math.max(charEntries.length, 1)) * 0.7;
      this.ui.showLoading(progressDone, `Loaded ${def.displayName}`);
    }
    this.ui.showLoading(0.95, 'Finalizing interface...');

    // UI
    this.ui.showTitle();

    this.ui.title.onStart = () => {
      this._disconnectDiscoverySession();
      this._stopOnlineLobbyRefresh();
      this._disconnectOnlineSession();
      this.gameState = GameState.SELECT;
      this.ui.showSelect();
      this.ui.select.resetOnlineState();
      this.ui.select.setPublicLobbies([]);
      this.ui.select.setOnlineStatus('Browse a public room, host one, quick match, or enter a direct code manually.');
    };

    this.ui.title.onAnimPlayer = async () => {
      await this._startAnimationSandbox();
    };

    this.ui.select.onConfirm = async (config) => {
      this.mode = config.mode;
      this.difficulty = config.difficulty;
      if (config.mode === 'online') {
        await this._startOnlineSession(config);
        return;
      }
      this._startMatch(config.p1Char, config.p2Char);
    };
    this.ui.select.onModeChange = async (mode) => {
      if (mode === 'online') {
        this._startOnlineLobbyRefresh();
        await this._refreshPublicLobbies();
      } else {
        this._stopOnlineLobbyRefresh();
        this._disconnectDiscoverySession();
      }
    };
    this.ui.select.onOnlineHostPublic = async (config) => {
      await this._hostPublicOnline(config);
    };
    this.ui.select.onOnlineQuickMatch = async (config) => {
      await this._startQuickMatch(config);
    };
    this.ui.select.onOnlineRefresh = async (config) => {
      await this._refreshPublicLobbies(config.serverUrl);
    };
    this.ui.select.onOnlineJoinPublic = async (config) => {
      await this._startOnlineSession(config);
    };
    this.ui.select.onLeaveOnline = () => {
      this._stopOnlineLobbyRefresh();
      this._disconnectDiscoverySession();
      this._disconnectOnlineSession();
      this._cleanupFighters();
      this.gameState = GameState.SELECT;
      this.ui.showSelect();
      this.ui.select.resetOnlineState();
      this.ui.select.setPublicLobbies([]);
      this.ui.select.setOnlineStatus('Disconnected. Browse a public room, host one, quick match, or enter a direct code manually.');
    };

    this.ui.victory.onContinue = () => {
      this._stopOnlineLobbyRefresh();
      this._disconnectDiscoverySession();
      this._disconnectOnlineSession();
      this.gameState = GameState.TITLE;
      this._cleanupFighters();
      this.ui.showTitle();
    };

    this.clock.start();
    this._loop();
  }

  _getCharData(charId) {
    const id = CHARACTER_DEFS[charId] ? charId : DEFAULT_CHAR;
    const def = CHARACTER_DEFS[id];
    const animData = this._charCache[id];
    if (!animData) {
      throw new Error(`Character asset '${id}' failed to load.`);
    }
    return { animData, charDef: def, resolvedId: id };
  }

  _startMatch(p1Char, p2Char) {
    this._disconnectOnlineSession();
    this.p1Score = 0;
    this.p2Score = 0;
    this.currentRound = 1;

    this._cleanupFighters();

    const p1 = this._getCharData(p1Char);
    const p2 = this._getCharData(p2Char);
    this.fighter1 = new Fighter(0, 0x991111, p1.charDef, p1.animData);
    this.fighter2 = new Fighter(1, 0x112266, p2.charDef, p2.animData);
    this.fighter1.addToScene(this.scene);
    this.fighter2.addToScene(this.scene);

    this._attachWeapon(this.fighter1);
    this._attachWeapon(this.fighter2);

    // AI
    if (this.mode === 'ai') {
      this.aiController = new AIController(this.difficulty);
    } else {
      this.aiController = null;
    }
    this.matchSim = new MatchSim({
      fighter1: this.fighter1,
      fighter2: this.fighter2,
    });

    this.ui.showHUD();
    this.ui.hud.updateRoundPips(0, 0);
    this.ui.hud.setOnlineMeta({ visible: false });
    this._startRound();
  }

  _attachWeapon(fighter) {
    // Skip if weapon is baked into the model (e.g. spearman GLB includes the spear)
    if (fighter.charDef.bakeWeapon) return;

    let handBone = null;
    fighter.root.traverse((child) => {
      if (child.isBone) {
        const n = ModelLoader._normalizeBoneName(child.name);
        if (ModelLoader.RIGHT_HAND_BONE_NAMES.includes(n)) {
          handBone = child;
        }
      }
    });
    if (handBone) {
      const s = 1 / fighter.root.scale.x;
      fighter.weapon.mesh.scale.setScalar(s);
      handBone.add(fighter.weapon.mesh);
    } else {
      fighter.weapon.mesh.position.set(0.3, 1.2, 0);
      fighter.root.add(fighter.weapon.mesh);
    }
  }

  _startRound() {
    this.gameState = GameState.ROUND_INTRO;
    this.stateTimer = 0;
    this.clock.setTimeScale(1.0);
    this.killSlowMoTimer = 0;
    this._killRealStart = null;

    this.matchSim?.startRound(FIGHT_START_DISTANCE);
    this.aiController?.reset();

    this.cameraController.stopKillCam();
    this.cameraController.reset();

    this.particles.reset();
    this.screenEffects.reset();

    this.ui.hud.reset();
    this.ui.hud.updateRoundPips(this.p1Score, this.p2Score);
    this.ui.hud.showRoundAnnounce(this.currentRound);

    this.input.clearBuffers();
  }

  _cleanupFighters() {
    if (this.fighter1) {
      this.fighter1.removeFromScene(this.scene);
      this.fighter1 = null;
    }
    if (this.fighter2) {
      this.fighter2.removeFromScene(this.scene);
      this.fighter2 = null;
    }
    this.matchSim = null;
  }

  async _startOnlineSession(config) {
    this.mode = 'online';
    this.difficulty = config.difficulty ?? this.difficulty;
    const requestedUrl = config.serverUrl || undefined;
    const requestedCode = config.lobbyCode || '';
    this._stopOnlineLobbyRefresh();
    this._disconnectDiscoverySession();

    if (
      this.onlineSession?.connected &&
      this.onlineSession?.lobbyCode &&
      this.onlineSession.url === requestedUrl &&
      (!requestedCode || requestedCode === this.onlineSession.lobbyCode)
    ) {
      this.onlineSession.setCharacter(config.p1Char);
      this.ui.select.setOnlineStatus(
        this.onlineSession.lobbyCode
          ? `LOBBY ${this.onlineSession.lobbyCode}. STILL CONNECTED.`
          : 'STILL CONNECTED.'
      );
      return;
    }

    this._disconnectOnlineSession();
      this.ui.select.setOnlineBusy(true);
      this.ui.select.setOnlineLocked(false);
      this._cleanupFighters();
      this.aiController = null;
      this.matchSim = null;
      this.p1Score = 0;
      this.p2Score = 0;
      this.currentRound = 1;
      this.onlinePendingMatchResult = null;
      this.clock.setTimeScale(1.0);
      this.killSlowMoTimer = 0;
      this._killRealStart = null;

    const session = new OnlineSession({ url: requestedUrl });
    this.onlineSession = session;
    this.onlineLocalSlot = null;
    this.onlineMatchPlayers = null;
    this._bindOnlineSession(session);
    this.ui.select.setOnlineStatus('CONNECTING TO SERVER...');

    try {
      await session.connect();
      if (requestedCode) {
        await session.joinLobby(requestedCode, config.p1Char);
      } else {
        await session.createLobby(config.p1Char);
      }
      session.setReady(true);
      this.ui.select.setOnlineBusy(false);
      this.ui.select.setOnlineLocked(true);
      this.ui.select.setOnlineStatus(
        requestedCode ? 'JOINED LOBBY. WAITING FOR MATCH...' : 'LOBBY CREATED. SHARE THE CODE AND WAIT FOR OPPONENT...'
      );
    } catch (err) {
      console.error('Online session failed to start:', err);
      this.ui.select.setOnlineBusy(false);
      this.ui.select.setOnlineLocked(false);
      this.ui.select.setOnlineStatus(`CONNECTION FAILED: ${err?.message || 'UNKNOWN ERROR'}`);
      this._disconnectOnlineSession();
    }
  }

  async _hostPublicOnline(config) {
    this.mode = 'online';
    const requestedUrl = config.serverUrl || undefined;
    this._stopOnlineLobbyRefresh();
    this._disconnectDiscoverySession();
    this._disconnectOnlineSession();
    this.ui.select.setOnlineBusy(true);
    this.ui.select.setOnlineLocked(false);
    this.ui.select.setOnlineStatus('CREATING PUBLIC MATCH...');

    try {
      const session = new OnlineSession({ url: requestedUrl });
      this.onlineSession = session;
      this.onlineLocalSlot = null;
      this.onlineMatchPlayers = null;
      this._bindOnlineSession(session);
      await session.connect();
      await session.createLobby(config.p1Char, 'public');
      session.setReady(true);
      this.ui.select.setOnlineBusy(false);
      this.ui.select.setOnlineLocked(true);
      this.ui.select.setOnlineStatus(`PUBLIC LOBBY ${session.lobbyCode}. WAITING FOR OPPONENT...`);
    } catch (err) {
      console.error('Public host failed:', err);
      this.ui.select.setOnlineBusy(false);
      this.ui.select.setOnlineLocked(false);
      this.ui.select.setOnlineStatus(`HOST FAILED: ${err?.message || 'UNKNOWN ERROR'}`);
      this._disconnectOnlineSession();
    }
  }

  async _startQuickMatch(config) {
    this.mode = 'online';
    const requestedUrl = config.serverUrl || undefined;
    this._stopOnlineLobbyRefresh();
    this._disconnectDiscoverySession();
    this._disconnectOnlineSession();
    this.ui.select.setOnlineBusy(true);
    this.ui.select.setOnlineLocked(false);
    this.ui.select.setOnlineStatus('FINDING PUBLIC MATCH...');

    try {
      const session = new OnlineSession({ url: requestedUrl });
      this.onlineSession = session;
      this.onlineLocalSlot = null;
      this.onlineMatchPlayers = null;
      this._bindOnlineSession(session);
      await session.connect();
      await session.quickMatch(config.p1Char);
      session.setReady(true);
      this.ui.select.setOnlineBusy(false);
      this.ui.select.setOnlineLocked(true);
      this.ui.select.setOnlineStatus(`LOBBY ${session.lobbyCode}. WAITING FOR OPPONENT...`);
    } catch (err) {
      console.error('Quick match failed:', err);
      this.ui.select.setOnlineBusy(false);
      this.ui.select.setOnlineLocked(false);
      this.ui.select.setOnlineStatus(`QUICK MATCH FAILED: ${err?.message || 'UNKNOWN ERROR'}`);
      this._disconnectOnlineSession();
    }
  }

  async _refreshPublicLobbies(serverUrl = null) {
    const requestedUrl = serverUrl || this.ui.select.onlineServerUrl?.value?.trim() || undefined;
    let session = this.onlineDiscoverySession;

    try {
      if (!session || !session.connected || (requestedUrl && session.url !== requestedUrl)) {
        if (session) {
          session.disconnect();
        }
        session = new OnlineSession({ url: requestedUrl });
        session.addEventListener('lobby_list', (event) => {
          this.ui.select.setPublicLobbies(event.detail?.lobbies ?? []);
        });
        this.onlineDiscoverySession = session;
        await session.connect();
      }

      const result = await session.listLobbies();
      this.ui.select.setPublicLobbies(result?.lobbies ?? []);
      if (!this.ui.select.onlineLobbyCode?.value) {
        this.ui.select.setOnlineStatus('Browse a public room, host one, quick match, or enter a direct code manually.');
      }
    } catch (err) {
      console.error('Public lobby refresh failed:', err);
      this.ui.select.setPublicLobbies([]);
      this.ui.select.setOnlineStatus(`LOBBY LIST FAILED: ${err?.message || 'UNKNOWN ERROR'}`);
    }
  }

  _disconnectDiscoverySession() {
    if (!this.onlineDiscoverySession) return;
    this.onlineDiscoverySession.disconnect();
    this.onlineDiscoverySession = null;
  }

  _bindOnlineSession(session) {
    session.addEventListener('error', (event) => {
      const detail = event.detail;
      const message = detail?.message || detail?.error?.message || 'NETWORK ERROR';
      console.error('Online session error:', detail);
      this.ui.select.setOnlineBusy(false);
      this.ui.select.setOnlineStatus(`ERROR: ${String(message).toUpperCase()}`);
    });

    session.addEventListener('close', () => {
      if (this._suppressOnlineClose) return;
      this._handleOnlineDisconnect('DISCONNECTED FROM SERVER.');
    });

    session.addEventListener('lobby_list', (event) => {
      this.ui.select.setPublicLobbies(event.detail?.lobbies ?? []);
    });
    session.addEventListener('lobby_state', (event) => {
      this._handleOnlineLobbyState(event.detail);
    });
    session.addEventListener('match_start', (event) => {
      this._handleOnlineMatchStart(event.detail);
    });
    session.addEventListener('state_snapshot', (event) => {
      this._handleOnlineStateSnapshot(event.detail?.snapshot);
    });
    session.addEventListener('combat_event', (event) => {
      const combatEvent = event.detail?.event;
      if (combatEvent) {
        this._handleSimEvent(combatEvent);
      }
    });
    session.addEventListener('match_state', (event) => {
      this._handleOnlineMatchState(event.detail);
    });
  }

  _handleOnlineLobbyState(detail) {
    if (!detail) return;
    this.onlineMatchPlayers = detail.players ?? null;
    this.ui.select.setOnlineLobbyInfo(detail);
    const self = detail.players?.find((player) => player.self);
    if (self) {
      this.onlineLocalSlot = self.slot;
    }

    this.ui.select.setOnlineLobbyCode(detail.code || '');

    const connectedPlayers = detail.players?.filter((player) => player.connected).length ?? 0;
    if (
      this.mode === 'online' &&
      this.gameState !== GameState.SELECT &&
      detail.phase !== 'match_running' &&
      connectedPlayers < 2
    ) {
      this._handleOnlineDisconnect('OPPONENT DISCONNECTED.');
      return;
    }

    this.ui.select.setOnlineBusy(false);
    this.ui.select.setOnlineLocked(Boolean(detail.code));
    if (detail.phase === 'match_running') {
      this.ui.select.setOnlineStatus('MATCH STARTING...');
    } else if (connectedPlayers < 2) {
      this.ui.select.setOnlineStatus(`LOBBY ${detail.code}. WAITING FOR OPPONENT...`);
    } else {
      this.ui.select.setOnlineStatus(`LOBBY ${detail.code}. OPPONENT CONNECTED. STARTING...`);
    }
  }

  _handleOnlineMatchStart(detail) {
    if (!detail?.players) return;
    this.onlineMatchPlayers = detail.players;
    this.currentRound = detail.roundNumber ?? this.currentRound;
    if (Array.isArray(detail.scores)) {
      this.p1Score = detail.scores[0] ?? this.p1Score;
      this.p2Score = detail.scores[1] ?? this.p2Score;
    }
    this.onlinePendingMatchResult = null;
    const self = detail.players.find((player) => player.id === this.onlineSession?.clientId);
    if (self) {
      this.onlineLocalSlot = self.slot;
    }
    this._startOnlineMatch(detail.players, detail.snapshot);
  }

  _startOnlineMatch(players, snapshot = null) {
    this._cleanupFighters();
    this.clock.setTimeScale(1.0);
    this.killSlowMoTimer = 0;
    this._killRealStart = null;
    this.cameraController.stopKillCam();
    this.cameraController.reset();
    this.screenEffects.reset();
    this.particles.reset();

    const sortedPlayers = [...players].sort((a, b) => a.slot - b.slot);
    const p1 = sortedPlayers[0];
    const p2 = sortedPlayers[1];
    if (!p1 || !p2) return;

    const p1Char = this._getCharData(p1.characterId);
    const p2Char = this._getCharData(p2.characterId);
    this.fighter1 = new Fighter(0, 0x991111, p1Char.charDef, p1Char.animData);
    this.fighter2 = new Fighter(1, 0x112266, p2Char.charDef, p2Char.animData);
    this.fighter1.addToScene(this.scene);
    this.fighter2.addToScene(this.scene);
    this._attachWeapon(this.fighter1);
    this._attachWeapon(this.fighter2);

    this.gameState = GameState.ROUND_INTRO;
    this.stateTimer = 0;
    this.ui.showHUD();
    this.ui.hud.reset();
    this.ui.hud.updateRoundPips(this.p1Score, this.p2Score);
    this.ui.hud.setOnlineMeta({
      visible: true,
      status: this.onlineLocalSlot === 0 ? 'ONLINE P1' : 'ONLINE P2',
      code: this.onlineSession?.lobbyCode ?? '------',
    });
    this.ui.hud.showRoundAnnounce(this.currentRound);
    this.input.clearBuffers();

    if (snapshot) {
      this._handleOnlineStateSnapshot(snapshot);
    }
  }

  _handleOnlineStateSnapshot(snapshot) {
    if (!snapshot || !this.fighter1 || !this.fighter2) return;
    const [fighter1Snapshot, fighter2Snapshot] = snapshot.fighters ?? [];
    if (fighter1Snapshot) this.fighter1.applyAuthoritativeSnapshot(fighter1Snapshot);
    if (fighter2Snapshot) this.fighter2.applyAuthoritativeSnapshot(fighter2Snapshot);
  }

  _handleOnlineMatchState(detail) {
    if (!detail) return;

    if (Array.isArray(detail.scores)) {
      this.p1Score = detail.scores[0] ?? this.p1Score;
      this.p2Score = detail.scores[1] ?? this.p2Score;
    }
    this.currentRound = detail.roundNumber ?? this.currentRound;

    if (detail.snapshot) {
      this._handleOnlineStateSnapshot(detail.snapshot);
    }

    if (
      (detail.phase === 'round_complete' || detail.phase === 'match_complete') &&
      detail.winner &&
      this.gameState === GameState.FIGHTING
    ) {
      this.onlinePendingMatchResult = detail;
      const killer = detail.winner === 1 ? this.fighter1 : this.fighter2;
      const victim = detail.winner === 1 ? this.fighter2 : this.fighter1;
      this._startKillPresentation(killer, victim, detail.killReason);
    }
  }

  _disconnectOnlineSession() {
    if (!this.onlineSession) return;
    this._suppressOnlineClose = true;
    this.onlineSession.disconnect();
    queueMicrotask(() => {
      this._suppressOnlineClose = false;
    });
    this.onlineSession = null;
    this.onlineLocalSlot = null;
    this.onlineMatchPlayers = null;
    this.onlinePendingMatchResult = null;
    this.ui.select.setOnlineBusy(false);
    this.ui.select.setOnlineLocked(false);
    this.ui.select.clearOnlineLobbyInfo();
    this.ui.hud.setOnlineMeta({ visible: false });
  }

  _handleOnlineDisconnect(message) {
    if (this.mode !== 'online') return;
    if (this.onlineSession) {
      this._suppressOnlineClose = true;
      this.onlineSession.disconnect();
      queueMicrotask(() => {
        this._suppressOnlineClose = false;
      });
    }
    this._startOnlineLobbyRefresh();
    this._cleanupFighters();
    this.matchSim = null;
    this.aiController = null;
    this.gameState = GameState.SELECT;
    this.ui.showSelect();
    this.ui.select.resetOnlineState();
    this.ui.select.clearOnlineLobbyInfo();
    this.ui.select.setOnlineStatus(message);
    this.ui.hud.setOnlineMeta({ visible: false });
    this.onlineSession = null;
    this.onlineLocalSlot = null;
    this.onlineMatchPlayers = null;
    this.onlinePendingMatchResult = null;
  }

  _startOnlineLobbyRefresh() {
    this._stopOnlineLobbyRefresh();
    this.onlineLobbyRefreshTimer = setInterval(() => {
      if (this.mode !== 'online') return;
      if (this.gameState !== GameState.SELECT) return;
      if (this.onlineSession?.lobbyCode) return;
      this._refreshPublicLobbies().catch((err) => {
        console.error('Lobby refresh tick failed:', err);
      });
    }, 2000);
  }

  _stopOnlineLobbyRefresh() {
    if (!this.onlineLobbyRefreshTimer) return;
    clearInterval(this.onlineLobbyRefreshTimer);
    this.onlineLobbyRefreshTimer = null;
  }

  async _startAnimationSandbox() {
    this._cleanupFighters();
    this.gameState = GameState.ANIM_PLAYER;

    if (!this.animationSandbox) {
      const { AnimationSandbox } = await import('./tools/AnimationSandbox.js');
      this.animationSandbox = new AnimationSandbox({
        scene: this.scene,
        camera: this.camera,
        cameraController: this.cameraController,
        environment: this.environment,
        input: this.input,
        ui: this.ui,
      });
      this.animationSandbox.onExit = () => {
        this._stopAnimationSandbox();
        this.gameState = GameState.TITLE;
        this.ui.showTitle();
      };
    }

    await this.animationSandbox.start();
  }

  _stopAnimationSandbox() {
    if (!this.animationSandbox) return;
    this.animationSandbox.stop();
  }

  _loop() {
    requestAnimationFrame(() => this._loop());

    const { steps, dt, rawDelta } = this.clock.update();
    this._lastFrameStats.steps = steps;
    this._lastFrameStats.rawDelta = rawDelta;

    for (let i = 0; i < steps; i++) {
      const frozen = this.screenEffects.update();
      if (frozen) continue;

      this._fixedUpdate(dt);
    }

    this._renderUpdate(rawDelta);
    this._updateDebugOverlay();
    this.renderer.render(this.scene, this.camera);
  }

  _fixedUpdate(dt) {
    this.input.update(this.clock.frameCount);

    switch (this.gameState) {
      case GameState.ROUND_INTRO:
        this._updateRoundIntro(dt);
        break;
      case GameState.FIGHTING:
        this._updateFighting(dt);
        break;
      case GameState.KILL_CAM:
        this._updateKillCam(dt);
        break;
      case GameState.ROUND_END:
        this._updateRoundEnd(dt);
        break;
    }
  }

  _renderUpdate(dt) {
    if (this.gameState === GameState.ANIM_PLAYER) {
      if (this.animationSandbox) {
        this.animationSandbox.update(dt);
      }
      return;
    }

    if (
      this.mode === 'online' &&
      !this.matchSim &&
      this.fighter1 &&
      this.fighter2 &&
      this.gameState !== GameState.KILL_CAM
    ) {
      this.fighter1.updateRemoteView(dt);
      this.fighter2.updateRemoteView(dt);
    }

    if (this.fighter1 && this.fighter2) {
      this.cameraController.update(dt, this.fighter1, this.fighter2);
    }

    if (this.gameState === GameState.KILL_CAM) {
      // Use real time for kill cam phases (not affected by time scale)
      const now = performance.now() / 1000;
      if (!this._killRealStart) this._killRealStart = now;
      const elapsed = now - this._killRealStart;

      // Phased slowmo: freeze → ultra slow → slow → end
      const FREEZE_END = 0.15;
      const ULTRA_SLOW_END = 1.0;
      const SLOW_END = 3.0;

      if (elapsed < FREEZE_END) {
        this.clock.setTimeScale(0.0);
      } else if (elapsed < ULTRA_SLOW_END) {
        // Ease from 0 to 0.1
        const t = (elapsed - FREEZE_END) / (ULTRA_SLOW_END - FREEZE_END);
        this.clock.setTimeScale(t * 0.1);
      } else if (elapsed < SLOW_END) {
        // Ease from 0.1 to 0.4
        const t = (elapsed - ULTRA_SLOW_END) / (SLOW_END - ULTRA_SLOW_END);
        this.clock.setTimeScale(0.1 + t * 0.3);
      } else {
        // Kill cam done
        this.clock.setTimeScale(1.0);
        this.cameraController.stopKillCam();
        this.screenEffects.stopKillEffects();
        this._killRealStart = null;

        if (this.fighter2 && this.fighter2.damageSystem.isDead()) {
          this.p1Score++;
        }
        if (this.fighter1 && this.fighter1.damageSystem.isDead()) {
          this.p2Score++;
        }

        this.gameState = GameState.ROUND_END;
        this.stateTimer = 0;
      }
    }

    this.environment.update(dt);
    this.particles.update(dt);
  }

  _updateRoundIntro(dt) {
    this.stateTimer += dt;

    if (this.stateTimer > ROUND_INTRO_DURATION * 0.6) {
      this.ui.hud.showFight();
    }

    if (this.stateTimer >= ROUND_INTRO_DURATION) {
      this.gameState = GameState.FIGHTING;
      this.ui.hud.hideRoundAnnounce();
    }
  }

  _updateFighting(dt) {
    if (this.mode === 'online' && !this.matchSim) {
      this._updateOnlineFighting(dt);
      return;
    }

    const frame = this.clock.frameCount;
    const input1 = captureInputFrame(this.input, 0, frame);
    const input2 = this.aiController ? null : captureInputFrame(this.input, 1, frame);
    const controller2 = this.aiController
      ? ((fighter, opponent, sim, simDt) => {
          this.aiController.update(fighter, opponent, sim.frameCount, simDt);
        })
      : null;
    const step = this.matchSim.step(dt, {
      input1,
      input2,
      controller2,
    });
    this._handleSimStep(step);

    // Update HUD
    this._updateHUD();
  }

  _updateOnlineFighting(_dt) {
    if (!this.onlineSession?.connected) return;
    const baseFrame = this.onlineSession.lastSnapshot?.frameCount ?? 0;
    const localFrame = this.clock.frameCount;
    const input = captureInputFrame(this.input, 0, localFrame);
    this._applyOnlineLocalControlMapping(input);
    input.frame = baseFrame + 1;
    try {
      this.onlineSession.sendInputFrame(input.frame, input);
    } catch (err) {
      console.error('Failed to send online input frame:', err);
    }
    this._updateHUD();
  }

  _applyOnlineLocalControlMapping(input) {
    if (!input || this.onlineLocalSlot !== 1) return;

    const heldLeft = input.held.left;
    input.held.left = input.held.right;
    input.held.right = heldLeft;

    const pressedUp = input.pressed.sidestepUp;
    input.pressed.sidestepUp = input.pressed.sidestepDown;
    input.pressed.sidestepDown = pressedUp;
  }

  _handleSimStep(step) {
    for (const event of step.events) {
      this._handleSimEvent(event);
    }

    if (step.roundOver && this.gameState === GameState.FIGHTING) {
      const killer = step.winner === 1 ? this.fighter1 : this.fighter2;
      const victim = step.winner === 1 ? this.fighter2 : this.fighter1;
      this._startKillPresentation(killer, victim, step.killReason);
    }
  }

  _handleSimEvent(event) {
    if (event.type === 'ring_out') return;
    if (event.type !== 'combat_result') return;

    const contactPoint = new THREE.Vector3(
      event.contactPoint.x,
      event.contactPoint.y,
      event.contactPoint.z,
    );

    switch (event.result) {
      case HitResult.CLASH:
        this.particles.emitClashSparks(contactPoint);
        this.cameraController.shake(0.2);
        this.screenEffects.startHitstop(event.hitstopFrames);
        break;
      case HitResult.PARRIED:
        this.particles.emitSparks(contactPoint, 10);
        this.cameraController.shake(0.15);
        this.screenEffects.startHitstop(event.hitstopFrames);
        break;
      case HitResult.BLOCKED:
        this.particles.emitSparks(contactPoint, 6);
        this.cameraController.shake(0.1);
        this.screenEffects.startHitstop(event.hitstopFrames);
        break;
      case HitResult.CLEAN_HIT:
        this.particles.emitSparks(contactPoint, 8);
        this.particles.emitBlood(contactPoint, 15);
        this.cameraController.shake(0.25);
        this.screenEffects.flashRed();
        this.screenEffects.startHitstop(event.hitstopFrames);
        break;
    }
  }

  _startKillPresentation(killer, victim, reason = 'clean_hit') {
    if (!killer || !victim) return;

    const dx = victim.position.x - killer.position.x;
    const dz = victim.position.z - killer.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
    victim.startRagdoll(dx / dist, dz / dist);

    if (reason !== 'ring_out') {
      const pos = victim.position.clone();
      pos.y += 1.0;
      this.particles.emitBloodGush(pos, 50);
    }

    this.clock.setTimeScale(0.0);
    this.killSlowMoTimer = 0;
    this.killPhase = 'freeze';
    this.cameraController.startKillCam(victim, killer);
    this.cameraController.shake(0.6);
    this.screenEffects.startKillEffects();
    this.gameState = GameState.KILL_CAM;
  }

  _updateKillCam(dt) {
    if (this.mode === 'online' && !this.matchSim) {
      this.fighter1.updateRemoteView(dt);
      this.fighter2.updateRemoteView(dt);
      return;
    }

    this.fighter1.update(dt, this.fighter2);
    this.fighter2.update(dt, this.fighter1);
  }

  _updateRoundEnd(dt) {
    this.stateTimer += dt;

    if (this.stateTimer >= ROUND_END_DELAY) {
      if (this.mode === 'online' && !this.matchSim) {
        if (this.onlinePendingMatchResult?.phase === 'match_complete') {
          const winnerSlot = (this.onlinePendingMatchResult.matchWinner ?? this.onlinePendingMatchResult.winner ?? 1) - 1;
          const winnerName = this.onlineLocalSlot === null
            ? `PLAYER ${winnerSlot + 1}`
            : winnerSlot === this.onlineLocalSlot ? 'YOU' : 'OPPONENT';
          this._showVictory(winnerName);
        }
        return;
      }

      if (this.p1Score >= ROUNDS_TO_WIN) {
        this._showVictory('PLAYER 1');
      } else if (this.p2Score >= ROUNDS_TO_WIN) {
        const name = this.mode === 'ai' ? 'COMPUTER' : 'PLAYER 2';
        this._showVictory(name);
      } else {
        this.currentRound++;
        this._startRound();
      }
    }
  }

  _showVictory(winnerName) {
    this.gameState = GameState.VICTORY;
    this.ui.showVictory(winnerName, this.p1Score, this.p2Score);
  }

  _updateDebugOverlay() {
    if (!this.debugOverlay) return;
    this.debugOverlay.update(this._buildDebugSnapshot());
  }

  _buildDebugSnapshot() {
    const fighter1 = this.fighter1?.getDebugSnapshot(this.fighter2) ?? null;
    const fighter2 = this.fighter2?.getDebugSnapshot(this.fighter1) ?? null;
    const distance = (this.fighter1 && this.fighter2)
      ? this.fighter1.distanceTo(this.fighter2)
      : 0;

    return {
      gameState: this.gameState,
      frameCount: this.clock.frameCount,
      timeScale: this.clock.timeScale,
      rawDelta: this._lastFrameStats.rawDelta,
      steps: this._lastFrameStats.steps,
      stateTimer: this.stateTimer,
      mode: this.mode,
      difficulty: this.difficulty,
      currentRound: this.currentRound,
      p1Score: this.p1Score,
      p2Score: this.p2Score,
      distance,
      animSandbox: Boolean(this.animationSandbox && this.gameState === GameState.ANIM_PLAYER),
      screen: {
        hitstopFrames: this.screenEffects.hitstopFrames,
        onHitstop: this.screenEffects.onHitstop,
      },
      camera: {
        killCamActive: this.cameraController.killCamActive,
        killCamPhase: this.cameraController.killCamPhase,
        orbitAngle: this.cameraController.orbitAngle,
        shakeIntensity: this.cameraController.shakeIntensity,
        killCamTime: this.cameraController.killCamTime,
      },
      ai: this.aiController?.getDebugSnapshot() ?? null,
      fighter1,
      fighter2,
    };
  }

  _updateHUD() {
    if (!this.fighter1 || !this.fighter2) return;
    this.ui.hud.updateRoundPips(this.p1Score, this.p2Score);
  }

}
