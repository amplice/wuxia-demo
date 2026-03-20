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
    this._wireClientEvents();
  }

  async connect() {
    const welcome = await this.client.connect(this.url);
    this.connected = true;
    this.clientId = welcome.clientId;
    return welcome;
  }

  disconnect() {
    this.client.disconnect();
    this.connected = false;
    this.lobbyCode = null;
    this.lastLobbyState = null;
    this.lastLobbyList = [];
    this.lastSnapshot = null;
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
    this.client.ping();
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
}
