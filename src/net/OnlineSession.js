import { MultiplayerClient } from './MultiplayerClient.js';
import { getDefaultMultiplayerWsUrl } from './NetConfig.js';

export class OnlineSession extends EventTarget {
  constructor({ url = getDefaultMultiplayerWsUrl() } = {}) {
    super();
    this.url = url;
    this.client = new MultiplayerClient();
    this.connected = false;
    this.clientId = null;
    this.lobbyCode = null;
    this.lastLobbyState = null;
    this.lastLobbyList = [];
    this.lastSnapshot = null;
    this.pingMs = null;
    this._pingTimer = null;
    this._lastPingSentAt = null;
    this._wireClientEvents();
  }

  async connect() {
    const welcome = await this.client.connect(this.url);
    this.connected = true;
    this.clientId = welcome.clientId;
    this._startPingLoop();
    return welcome;
  }

  disconnect() {
    this._stopPingLoop();
    this.client.disconnect();
    this.connected = false;
    this.lobbyCode = null;
    this.lastLobbyState = null;
    this.lastLobbyList = [];
    this.lastSnapshot = null;
    this.pingMs = null;
    this._lastPingSentAt = null;
  }

  async createLobby(characterId = null, visibility = 'private') {
    await this._ensureConnected();
    if (visibility === 'public') {
      this.client.createPublicLobby();
    } else {
      this.client.createLobby();
    }
    const lobby = await this._waitForEvent('lobby_state', (detail) => Boolean(detail?.code));
    if (characterId) this.client.setCharacter(characterId);
    return lobby;
  }

  async joinLobby(code, characterId = null) {
    await this._ensureConnected();
    this.client.joinLobby(code);
    const lobby = await this._waitForEvent('lobby_state', (detail) => detail?.code === code);
    if (characterId) this.client.setCharacter(characterId);
    return lobby;
  }

  async listLobbies() {
    await this._ensureConnected();
    this.client.listLobbies();
    return this._waitForEvent('lobby_list');
  }

  async quickMatch(characterId = null) {
    await this._ensureConnected();
    this.client.quickMatch();
    const lobby = await this._waitForEvent('lobby_state', (detail) => Boolean(detail?.code));
    if (characterId) this.client.setCharacter(characterId);
    return lobby;
  }

  setCharacter(characterId) {
    this.client.setCharacter(characterId);
  }

  setReady(ready) {
    this.client.setReady(ready);
  }

  sendInputFrame(frame, input) {
    this.client.sendInputFrame(frame, input);
  }

  ping() {
    const sentAt = Date.now();
    this._lastPingSentAt = sentAt;
    this.client.ping(sentAt);
  }

  _wireClientEvents() {
    const rebroadcast = (type, handler = null) => {
      this.client.addEventListener(type, (event) => {
        if (handler) handler(event.detail);
        this.dispatchEvent(new CustomEvent(type, { detail: event.detail }));
      });
    };

    rebroadcast('close', () => {
      this.connected = false;
      this._stopPingLoop();
      this.pingMs = null;
      this._lastPingSentAt = null;
    });
    rebroadcast('error');
    rebroadcast('lobby_state', (detail) => {
      this.lobbyCode = detail.code;
      this.lastLobbyState = detail;
    });
    rebroadcast('lobby_list', (detail) => {
      this.lastLobbyList = Array.isArray(detail?.lobbies) ? detail.lobbies : [];
    });
    rebroadcast('match_start');
    rebroadcast('match_state');
    rebroadcast('combat_event');
    rebroadcast('state_snapshot', (detail) => {
      this.lastSnapshot = detail.snapshot;
    });
    rebroadcast('pong');
    this.client.addEventListener('pong', (event) => {
      const detail = event.detail ?? {};
      const sentAt = Number(detail.sentAt);
      if (!Number.isFinite(sentAt)) return;
      const rtt = Math.max(0, Date.now() - sentAt);
      this.pingMs = this.pingMs === null
        ? rtt
        : Math.round(this.pingMs * 0.7 + rtt * 0.3);
      this.dispatchEvent(new CustomEvent('ping_update', {
        detail: {
          pingMs: this.pingMs,
          rtt,
        },
      }));
    });
  }

  async _ensureConnected() {
    if (this.connected) return;
    await this.connect();
  }

  _waitForEvent(type, predicate = null, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out waiting for '${type}'.`));
      }, timeoutMs);

      const handler = (event) => {
        const detail = event.detail;
        if (predicate && !predicate(detail)) return;
        cleanup();
        resolve(detail);
      };

      const cleanup = () => {
        window.clearTimeout(timeout);
        this.removeEventListener(type, handler);
      };

      this.addEventListener(type, handler);
    });
  }

  _startPingLoop() {
    this._stopPingLoop();
    this.ping();
    this._pingTimer = window.setInterval(() => {
      if (!this.connected) return;
      this.ping();
    }, 2000);
  }

  _stopPingLoop() {
    if (!this._pingTimer) return;
    window.clearInterval(this._pingTimer);
    this._pingTimer = null;
  }
}
