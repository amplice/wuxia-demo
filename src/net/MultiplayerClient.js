import {
  ClientMessageType,
  ServerMessageType,
  sanitizeInputFrame,
} from './Protocol.js';

export class MultiplayerClient extends EventTarget {
  constructor() {
    super();
    this.socket = null;
    this.connected = false;
    this.clientId = null;
  }

  connect(url) {
    if (this.socket) this.disconnect();

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      this.socket = socket;

      socket.addEventListener('open', () => {
        this.connected = true;
      }, { once: true });

      socket.addEventListener('message', (event) => {
        const payload = this._parseMessage(event.data);
        if (!payload) return;

        if (payload.type === ServerMessageType.WELCOME) {
          this.clientId = payload.clientId;
          resolve(payload);
        }

        this.dispatchEvent(new CustomEvent(payload.type, { detail: payload }));
      });

      socket.addEventListener('close', (event) => {
        this.connected = false;
        this.dispatchEvent(new CustomEvent('close', {
          detail: {
            code: event.code,
            reason: event.reason,
            wasClean: event.wasClean,
          },
        }));
      });

      socket.addEventListener('error', (err) => {
        if (!this.connected) reject(err);
        this.dispatchEvent(new CustomEvent('error', { detail: err }));
      });
    });
  }

  disconnect() {
    if (!this.socket) return;
    this.socket.close();
    this.socket = null;
    this.connected = false;
  }

  createLobby() {
    this._send({ type: ClientMessageType.CREATE_LOBBY });
  }

  createPublicLobby() {
    this._send({ type: ClientMessageType.CREATE_LOBBY, visibility: 'public' });
  }

  joinLobby(code) {
    this._send({ type: ClientMessageType.JOIN_LOBBY, code });
  }

  listLobbies() {
    this._send({ type: ClientMessageType.LIST_LOBBIES });
  }

  quickMatch() {
    this._send({ type: ClientMessageType.QUICK_MATCH });
  }

  setCharacter(characterId) {
    this._send({ type: ClientMessageType.SELECT_CHARACTER, characterId });
  }

  setReady(ready) {
    this._send({ type: ClientMessageType.READY, ready: Boolean(ready) });
  }

  sendInputFrame(frame, input) {
    const sanitized = sanitizeInputFrame({ ...input, frame });
    this._send({
      type: ClientMessageType.INPUT_FRAME,
      frame: sanitized.frame,
      input: sanitized,
    });
  }

  ping(sentAt = Date.now()) {
    this._send({ type: ClientMessageType.PING, sentAt });
  }

  _send(payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Multiplayer socket is not open.');
    }
    this.socket.send(JSON.stringify(payload));
  }

  _parseMessage(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}
