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
import { PlannerAIController } from './ai/PlannerAIController.js';
import { HumanAIMatchRecorder } from './ai/HumanAIMatchRecorder.js';
import { DebugOverlay } from './debug/DebugOverlay.js';
import { UIManager } from './ui/UIManager.js';
import { MatchSim } from './sim/MatchSim.js';
import { captureInputFrame } from './sim/InputFrame.js';
import { OnlineSession } from './net/OnlineSession.js';
import { SoundManager } from './audio/SoundManager.js';
import { listAudioAssets } from './audio/AudioCatalog.js';
import { GameAudio } from './audio/GameAudio.js';
import { DEFAULT_STAGE, getStageDef } from './arena/StageDefs.js';
import {
  GameState, HitResult,
  FIGHT_START_DISTANCE, ROUNDS_TO_WIN, ROUND_INTRO_DURATION,
  ROUND_END_DELAY,
} from './core/Constants.js';

const AI_DIFFICULTY_PROFILE_MAP = Object.freeze({
  spearman: Object.freeze({
    easy: 'spearman_heavy_bully',
    medium: 'spearman_evasive',
    hard: 'spearman_heavy_bully',
  }),
  ronin: Object.freeze({
    easy: 'ronin_lancer',
    medium: 'ronin_duelist',
    hard: 'ronin_aggressor',
  }),
  knight: Object.freeze({
    easy: 'knight_bulwark',
    medium: 'knight_duelist',
    hard: 'knight_sentinel',
  }),
});


export class Game {
  constructor() {
    this.renderer = new Renderer();
    this.clock = new Clock();
    this.input = new InputManager();
    this.ui = new UIManager();
    this.screenEffects = new ScreenEffects();
    this.sound = new SoundManager();
    this.gameAudio = new GameAudio(this.sound);

    this.scene = null;
    this.camera = null;
    this.arena = null;
    this.environment = null;
    this.particles = null;

    this.fighter1 = null;
    this.fighter2 = null;
    this.aiController = null;
    this.aiMatchRecorder = new HumanAIMatchRecorder();
    this.matchSim = null;
    this.onlineSession = null;
    this.onlineDiscoverySession = null;
    this.onlineLobbyRefreshTimer = null;
    this.onlineLocalSlot = null;
    this.onlineMatchPlayers = null;
    this._suppressOnlineClose = false;
    this.onlinePendingMatchResult = null;
    this.onlinePingMs = null;
    this._charCache = {};

    this.gameState = GameState.TITLE;
    this.stateTimer = 0;

    // Match state
    this.mode = 'ai';
    this.difficulty = 'medium';
    this.stageId = DEFAULT_STAGE;
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

    this.arena = new Arena(this.scene, this.stageId);
    this.environment = new Environment(this.scene, this.stageId);
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
    HumanAIMatchRecorder.installWindowApi();
    this.gameAudio.preload(listAudioAssets()).catch((error) => {
      console.warn('[sound] preload failed', error);
    });

    // UI
    this.ui.showTitle();

    this.ui.title.onStart = () => {
      this.sound.unlock().catch(() => {});
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
      this.sound.unlock().catch(() => {});
      await this._startAnimationSandbox();
    };

    this.ui.select.onConfirm = async (config) => {
      this.sound.unlock().catch(() => {});
      this.mode = config.mode;
      this.difficulty = config.difficulty;
      if (config.mode === 'online') {
        await this._startOnlineSession(config);
        return;
      }
      this._startMatch(config.p1Char, config.p2Char, config.stageId);
    };
    this.ui.select.onStageChange = (stageId) => {
      this._applyStage(stageId, { syncSelect: false });
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

  _startMatch(p1Char, p2Char, stageId = this.stageId) {
    this._disconnectOnlineSession();
    this._resetMatchScoreState();
    const stage = this._applyStage(stageId);

    const { p1, p2 } = this._spawnFighters(p1Char, p2Char);

    // AI
    if (this.mode === 'ai') {
      this.aiController = this._createCpuController(p2.charDef.id, this.difficulty);
      this.aiMatchRecorder.startMatch({
        mode: 'ai',
        fighter1Char: p1.charDef.id,
        fighter2Char: p2.charDef.id,
        playerChar: p1.charDef.id,
        aiChar: p2.charDef.id,
        difficulty: this.difficulty,
        stageId: stage.id,
        aiMeta: this.aiController.getDebugSnapshot?.() ?? null,
      });
    } else {
      this.aiController = null;
      this.aiMatchRecorder.discard();
    }
    this.matchSim = new MatchSim({
      fighter1: this.fighter1,
      fighter2: this.fighter2,
    });

    this.ui.showHUD();
    this.ui.hud.setStage(stage);
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
    this._resetCombatPresentation();

    this.matchSim?.startRound(FIGHT_START_DISTANCE);
    this.aiController?.reset();
    this.gameAudio.resetFighterState([this.fighter1, this.fighter2]);

    this.ui.hud.reset();
    this.ui.hud.setStage(getStageDef(this.stageId));
    this.ui.hud.updateRoundPips(this.p1Score, this.p2Score);
    this.ui.hud.showRoundAnnounce(this.currentRound);
    if (this.mode === 'ai' && this.fighter1 && this.fighter2) {
      this.aiMatchRecorder.startRound({
        roundNumber: this.currentRound,
        fighter1: this.fighter1,
        fighter2: this.fighter2,
        aiMeta: this.aiController?.getDebugSnapshot?.() ?? null,
        frameCount: this.matchSim?.frameCount ?? 0,
      });
    }

    this.input.clearBuffers();
  }

  _getAIDifficultyProfile(charId, difficulty) {
    const charProfiles = AI_DIFFICULTY_PROFILE_MAP[charId];
    if (charProfiles && charProfiles[difficulty]) return charProfiles[difficulty];
    return difficulty;
  }

  _createCpuController(charId, difficulty) {
    const aiProfile = this._getAIDifficultyProfile(charId, difficulty);
    return difficulty === 'hard'
      ? new PlannerAIController(aiProfile)
      : new AIController(aiProfile);
  }

  _resetMatchScoreState() {
    this.p1Score = 0;
    this.p2Score = 0;
    this.currentRound = 1;
  }

  _resetCombatPresentation() {
    this.clock.setTimeScale(1.0);
    this.killSlowMoTimer = 0;
    this._killRealStart = null;
    this.cameraController.stopKillCam();
    this.cameraController.reset();
    this.particles.reset();
    this.screenEffects.reset();
  }

  _applyStage(stageId, { syncSelect = true } = {}) {
    const stage = getStageDef(stageId);
    this.stageId = stage.id;
    this.arena?.applyStage(stage.id);
    this.environment?.applyStage(stage.id);
    if (syncSelect) {
      this.ui?.select?.setStage(stage.id, { silent: true });
    }
    this.ui?.hud?.setStage(stage);
    return stage;
  }

  _spawnFighters(p1Char, p2Char) {
    this._cleanupFighters();

    const p1 = this._getCharData(p1Char);
    const p2 = this._getCharData(p2Char);
    this.fighter1 = new Fighter(0, 0x991111, p1.charDef, p1.animData);
    this.fighter2 = new Fighter(1, 0x112266, p2.charDef, p2.animData);
    this.fighter1.addToScene(this.scene);
    this.fighter2.addToScene(this.scene);
    this._attachWeapon(this.fighter1);
    this._attachWeapon(this.fighter2);
    this.gameAudio.resetFighterState([this.fighter1, this.fighter2]);

    return { p1, p2 };
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
    this.gameAudio.resetFighterState([]);
  }

  async _startOnlineSession(config) {
    this.mode = 'online';
    this.difficulty = config.difficulty ?? this.difficulty;
    this._applyStage(config.stageId ?? this.stageId);
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
    this._resetMatchScoreState();
    this.onlinePendingMatchResult = null;
    this._resetCombatPresentation();

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
        await session.createLobby(config.p1Char, config.stageId);
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
    this._applyStage(config.stageId ?? this.stageId);
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
      await session.createLobby(config.p1Char, config.stageId, 'public');
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
    this._applyStage(config.stageId ?? this.stageId);
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
      await session.quickMatch(config.p1Char, config.stageId);
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

    session.addEventListener('close', (event) => {
      if (this._suppressOnlineClose) return;
      const code = event.detail?.code ?? null;
      const reason = event.detail?.reason ?? '';
      const message = code === 1012
        ? 'SERVER RESTARTED. REJOIN A MATCH.'
        : reason
          ? `DISCONNECTED: ${String(reason).toUpperCase()}`
          : 'DISCONNECTED FROM SERVER.';
      this._handleOnlineDisconnect(message);
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
    session.addEventListener('ping_update', (event) => {
      this.onlinePingMs = event.detail?.pingMs ?? null;
      this._updateHUD();
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
    if (detail.stageId) {
      this._applyStage(detail.stageId);
    }
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
    if (detail.stageId) {
      this._applyStage(detail.stageId);
    }
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
    this._resetCombatPresentation();

    const sortedPlayers = [...players].sort((a, b) => a.slot - b.slot);
    const p1 = sortedPlayers[0];
    const p2 = sortedPlayers[1];
    if (!p1 || !p2) return;

    this._spawnFighters(p1.characterId, p2.characterId);

    this.gameState = GameState.ROUND_INTRO;
    this.stateTimer = 0;
    this.ui.showHUD();
    this.ui.hud.reset();
    this.ui.hud.setStage(getStageDef(this.stageId));
    this.ui.hud.updateRoundPips(this.p1Score, this.p2Score);
      this.ui.hud.setOnlineMeta({
        visible: true,
        status: this.onlineLocalSlot === 0 ? 'ONLINE P1' : 'ONLINE P2',
        code: this.onlineSession?.lobbyCode ?? '------',
        pingMs: this.onlinePingMs,
      });
      this.ui.hud.showRoundAnnounce(this.currentRound);
      this.gameAudio.resetFighterState([this.fighter1, this.fighter2]);
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
    this.onlinePingMs = null;
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
    this.onlinePingMs = null;
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
      this.gameAudio.updateFighters([this.fighter1, this.fighter2]);
      this.cameraController.update(dt, this.fighter1, this.fighter2);
    } else {
      this.cameraController.updateMenu(dt);
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

        if (this.mode !== 'online' || this.matchSim) {
          if (this.fighter2 && this.fighter2.damageSystem.isDead()) {
            this.p1Score++;
          }
          if (this.fighter1 && this.fighter1.damageSystem.isDead()) {
            this.p2Score++;
          }
          if (this.mode === 'ai') {
            const roundSummary = this.aiMatchRecorder.completeRound({
              frameCount: this.matchSim?.frameCount ?? 0,
              winner: this.fighter2?.damageSystem.isDead()
                ? 1
                : (this.fighter1?.damageSystem.isDead() ? 2 : null),
              killReason: this.matchSim?.killReason ?? null,
              p1Score: this.p1Score,
              p2Score: this.p2Score,
            });
            this.aiController?.observeRoundResult?.(roundSummary);
          }
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
    if (this.mode === 'ai') {
      this.aiMatchRecorder.recordStep({
        frameCount: step.frameCount,
        input1,
        input2,
        fighter1: this.fighter1,
        fighter2: this.fighter2,
        aiMeta: this.aiController?.getDebugSnapshot?.() ?? null,
        events: step.events,
      });
    }
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
    this.gameAudio.handleCombatEvent(event);
    if (event.type === 'ring_out') return;
    if (event.type !== 'combat_result') return;

    const contactPoint = new THREE.Vector3(
      event.contactPoint.x,
      event.contactPoint.y,
      event.contactPoint.z,
    );
    const impactDirection = this._getCombatImpactDirection(event);

    switch (event.result) {
      case HitResult.CLASH:
        this._emitWeaponImpact(event, 'clash', impactDirection, contactPoint);
        this.cameraController.shake(0.2);
        this.screenEffects.startHitstop(event.hitstopFrames);
        break;
      case HitResult.PARRIED:
        this._emitWeaponImpact(event, 'parry', impactDirection, contactPoint);
        this.cameraController.shake(0.15);
        this.screenEffects.startHitstop(event.hitstopFrames);
        break;
      case HitResult.BLOCKED:
        this._emitWeaponImpact(event, 'block', impactDirection, contactPoint);
        this.cameraController.shake(0.1);
        this.screenEffects.startHitstop(event.hitstopFrames);
        break;
      case HitResult.LETHAL_HIT:
        this.particles.emitWhiteImpact(contactPoint, impactDirection, 10);
        this.particles.emitBlood(contactPoint, 32, impactDirection);
        this.cameraController.shake(0.25);
        this.screenEffects.flashRed();
        this.screenEffects.startHitstop(event.hitstopFrames);
        break;
    }
  }

  _emitWeaponImpact(event, kind, impactDirection, fallbackPoint) {
    const attacker = event.attackerIndex === 0 ? this.fighter1 : this.fighter2;
    const defender = event.defenderIndex === 0 ? this.fighter1 : this.fighter2;
    const points = [
      this._getWeaponImpactPoint(attacker),
      this._getWeaponImpactPoint(defender),
    ].filter(Boolean);

    if (!points.length) points.push(fallbackPoint.clone());

    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (kind === 'clash') {
        const direction = i === 0
          ? impactDirection
          : (impactDirection ? impactDirection.clone().multiplyScalar(-1) : null);
        this.particles.emitClashSparks(point, direction);
      } else if (kind === 'parry') {
        const direction = i === 0
          ? impactDirection
          : (impactDirection ? impactDirection.clone().multiplyScalar(-1) : null);
        this.particles.emitWhiteImpact(point, direction, 18);
      } else if (kind === 'block') {
        const direction = i === 0
          ? impactDirection
          : (impactDirection ? impactDirection.clone().multiplyScalar(-1) : null);
        this.particles.emitWhiteImpact(point, direction, 14);
      }
    }
  }

  _getWeaponImpactPoint(fighter) {
    if (!fighter) return null;
    const base = fighter.getWeaponBaseWorldPosition(new THREE.Vector3());
    const tip = fighter.getWeaponTipWorldPosition(new THREE.Vector3());
    return base.lerp(tip, 0.72);
  }

  _getCombatImpactDirection(event) {
    const attacker = event.attackerIndex === 0 ? this.fighter1 : this.fighter2;
    const defender = event.defenderIndex === 0 ? this.fighter1 : this.fighter2;
    if (!attacker || !defender) return null;

    const direction = new THREE.Vector3(
      defender.position.x - attacker.position.x,
      0.18,
      defender.position.z - attacker.position.z,
    );
    if (direction.lengthSq() < 0.0001) return null;
    return direction.normalize();
  }

  _startKillPresentation(killer, victim, reason = 'lethal_hit') {
    if (!killer || !victim) return;

    const dx = victim.position.x - killer.position.x;
    const dz = victim.position.z - killer.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz) || 0.01;
    victim.startRagdoll(dx / dist, dz / dist);

    if (reason !== 'ring_out') {
      const pos = victim.position.clone();
      pos.y += 1.0;
      const sprayDirection = new THREE.Vector3(dx / dist, 0.22, dz / dist).normalize();
      this.particles.emitBloodGush(pos, 95, sprayDirection);
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
    if (this.mode === 'ai') {
      this.aiMatchRecorder.finishMatch({
        winnerName,
        p1Score: this.p1Score,
        p2Score: this.p2Score,
      });
    }
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
    if (this.mode === 'online' && !this.matchSim) {
      this.ui.hud.setOnlineMeta({
        visible: true,
        status: this.onlineLocalSlot === 0 ? 'ONLINE P1' : 'ONLINE P2',
        code: this.onlineSession?.lobbyCode ?? '------',
        pingMs: this.onlinePingMs,
      });
    }
  }

}
