#!/usr/bin/env node
import http from 'http';
import crypto from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { CHARACTER_DEFS, DEFAULT_CHAR } from '../src/entities/CharacterDefs.js';
import {
  FRAME_DURATION,
  FIGHT_START_DISTANCE,
  ROUND_END_DELAY,
  ROUND_INTRO_DURATION,
  ROUNDS_TO_WIN,
} from '../src/core/Constants.js';
import { MatchSim } from '../src/sim/MatchSim.js';
import { FighterSim } from '../src/sim/FighterSim.js';
import { createEmptyInputFrame } from '../src/sim/InputFrame.js';
import {
  ClientMessageType,
  ServerMessageType,
  createLobbyListPayload,
  createLobbyStatePayload,
  sanitizeInputFrame,
  validateClientMessage,
} from '../src/net/Protocol.js';

const PORT = Number(process.env.MULTIPLAYER_PORT || process.env.PORT || 3010);
const MAX_PLAYERS_PER_LOBBY = 2;
const SNAPSHOT_INTERVAL_FRAMES = 3;
const LOBBY_SWEEP_INTERVAL_MS = Number(process.env.LOBBY_SWEEP_INTERVAL_MS || 15000);
const EMPTY_LOBBY_TTL_MS = Number(process.env.EMPTY_LOBBY_TTL_MS || 30000);
const PUBLIC_LOBBY_IDLE_TTL_MS = Number(process.env.PUBLIC_LOBBY_IDLE_TTL_MS || 10 * 60 * 1000);
const PRIVATE_LOBBY_IDLE_TTL_MS = Number(process.env.PRIVATE_LOBBY_IDLE_TTL_MS || 30 * 60 * 1000);
const MATCH_COMPLETE_TTL_MS = Number(process.env.MATCH_COMPLETE_TTL_MS || 30000);

class MatchRoom {
  constructor(lobby) {
    this.lobby = lobby;
    this.sim = null;
    this.interval = null;
    this.lastSnapshots = new Map();
    this.latestInputs = new Map();
    this.roundNumber = 1;
    this.scores = [0, 0];
    this.restartTimer = null;
  }

  start() {
    if (this.interval) return;
    const [p1, p2] = this.lobby.players;
    const fighter1 = new FighterSim(0, p1.characterId, CHARACTER_DEFS[p1.characterId]);
    const fighter2 = new FighterSim(1, p2.characterId, CHARACTER_DEFS[p2.characterId]);
    this.sim = new MatchSim({ fighter1, fighter2 });
    this.sim.startRound(FIGHT_START_DISTANCE);
    this.lobby.phase = 'match_running';

    for (const player of this.lobby.players) {
      this.latestInputs.set(player.id, createEmptyInputFrame(0));
    }

    this._broadcast({
      type: ServerMessageType.MATCH_START,
      code: this.lobby.code,
      phase: this.lobby.phase,
      roundNumber: this.roundNumber,
      scores: [...this.scores],
      players: this.lobby.players.map((player) => ({
        id: player.id,
        slot: player.slot,
        characterId: player.characterId,
      })),
      snapshot: this.sim.getSnapshot(),
    });

    this.interval = setInterval(() => this._tick(), FRAME_DURATION * 1000);
  }

  stop(reason = 'stopped') {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.lobby.phase = reason === 'disconnect' ? 'lobby' : 'match_complete';
  }

  setInput(playerId, input) {
    const current = this.latestInputs.get(playerId) ?? createEmptyInputFrame(0);
    const next = sanitizeInputFrame(input);
    current.frame = next.frame;
    current.held = { ...next.held };
    for (const [key, value] of Object.entries(next.pressed)) {
      current.pressed[key] = current.pressed[key] || value;
    }
    this.latestInputs.set(playerId, current);
  }

  _drainInput(playerId, frame) {
    const current = this.latestInputs.get(playerId) ?? createEmptyInputFrame(frame);
    const stepInput = {
      frame,
      held: { ...current.held },
      pressed: { ...current.pressed },
    };
    for (const key of Object.keys(current.pressed)) {
      current.pressed[key] = false;
    }
    current.frame = frame;
    this.latestInputs.set(playerId, current);
    return stepInput;
  }

  _tick() {
    const [p1, p2] = this.lobby.players;
    if (!p1?.connected || !p2?.connected) {
      this.stop('disconnect');
      this._broadcast(createLobbyStatePayload(this.lobby));
      return;
    }

    const frame = (this.sim?.frameCount ?? 0) + 1;
    const step = this.sim.step(FRAME_DURATION, {
      input1: this._drainInput(p1.id, frame),
      input2: this._drainInput(p2.id, frame),
    });

    for (const event of step.events) {
      this._broadcast({
        type: ServerMessageType.COMBAT_EVENT,
        code: this.lobby.code,
        frameCount: step.frameCount,
        event,
      });
    }

    if (step.frameCount % SNAPSHOT_INTERVAL_FRAMES === 0 || step.roundOver) {
      this._broadcast({
        type: ServerMessageType.STATE_SNAPSHOT,
        code: this.lobby.code,
        snapshot: step.snapshot,
      });
    }

    if (step.roundOver) {
      const winnerIndex = (step.winner ?? 1) - 1;
      if (winnerIndex >= 0 && winnerIndex < this.scores.length) {
        this.scores[winnerIndex]++;
      }

      const matchWinner = this.scores.findIndex((score) => score >= ROUNDS_TO_WIN);
      const phase = matchWinner >= 0 ? 'match_complete' : 'round_complete';
      this.lobby.phase = phase;
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }

      this._broadcast({
        type: ServerMessageType.MATCH_STATE,
        code: this.lobby.code,
        phase,
        roundNumber: this.roundNumber,
        scores: [...this.scores],
        winner: step.winner,
        matchWinner: matchWinner >= 0 ? matchWinner + 1 : null,
        killReason: step.killReason,
        snapshot: step.snapshot,
      });

      if (phase === 'match_complete') {
        this.stop('match_complete');
        return;
      }

      this.roundNumber++;
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.start();
      }, Math.round((ROUND_END_DELAY + ROUND_INTRO_DURATION) * 1000));
    }
  }

  _broadcast(payload) {
    for (const player of this.lobby.players) {
      if (!player.socket) continue;
      send(player.socket, payload);
    }
  }
}

class LobbyManager {
  constructor() {
    this.lobbies = new Map();
  }

  create(client, { visibility = 'private' } = {}) {
    this._ensureClientFree(client);
    const code = this._generateCode();
    const lobby = {
      code,
      visibility,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      phase: 'lobby',
      players: [this._createPlayer(client, 0)],
      room: null,
    };
    this.lobbies.set(code, lobby);
    client.lobbyCode = code;
    client.slot = 0;
    return lobby;
  }

  join(client, code) {
    this._ensureClientFree(client);
    const lobby = this.lobbies.get(code);
    if (!lobby) throw new Error(`Lobby '${code}' does not exist.`);
    if (lobby.players.length >= MAX_PLAYERS_PER_LOBBY) throw new Error(`Lobby '${code}' is full.`);
    if (lobby.players.some((player) => player.id === client.id)) return lobby;

    const slot = lobby.players.length;
    lobby.players.push(this._createPlayer(client, slot));
    this._touchLobby(lobby);
    client.lobbyCode = code;
    client.slot = slot;
    return lobby;
  }

  quickMatch(client) {
    this._ensureClientFree(client);
    const lobby = [...this.lobbies.values()]
      .filter((entry) =>
        entry.visibility === 'public' &&
        (entry.phase === 'lobby' || entry.phase === 'match_pending') &&
        entry.players.filter((player) => player.connected).length < MAX_PLAYERS_PER_LOBBY)
      .sort((a, b) => a.createdAt - b.createdAt)[0];

    if (lobby) {
      this._touchLobby(lobby);
      return this.join(client, lobby.code);
    }

    return this.create(client, { visibility: 'public' });
  }

  listPublicLobbies() {
    return [...this.lobbies.values()]
      .filter((lobby) =>
        lobby.visibility === 'public' &&
        !lobby.room &&
        lobby.players.some((player) => player.connected) &&
        lobby.players.filter((player) => player.connected).length < MAX_PLAYERS_PER_LOBBY)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  setCharacter(client, characterId) {
    const lobby = this.getLobbyForClient(client);
    if (!CHARACTER_DEFS[characterId]) {
      throw new Error(`Unknown character '${characterId}'.`);
    }
    const player = lobby.players.find((entry) => entry.id === client.id);
    if (!player) throw new Error('Player is not in the lobby.');
    player.characterId = characterId;
    player.ready = false;
    if (lobby.phase !== 'lobby') {
      throw new Error('Cannot change character after match start.');
    }
    this._touchLobby(lobby);
    return lobby;
  }

  setReady(client, ready) {
    const lobby = this.getLobbyForClient(client);
    const player = lobby.players.find((entry) => entry.id === client.id);
    if (!player) throw new Error('Player is not in the lobby.');
    player.ready = ready;
    if (lobby.players.length === 2 && lobby.players.every((entry) => entry.ready && entry.connected)) {
      lobby.phase = 'match_pending';
    } else if (lobby.phase !== 'match_running') {
      lobby.phase = 'lobby';
    }
    this._touchLobby(lobby);
    return lobby;
  }

  ensureMatchStarted(lobby) {
    if (lobby.phase !== 'match_pending' || lobby.room) return lobby;
    lobby.room = new MatchRoom(lobby);
    lobby.room.start();
    this._touchLobby(lobby);
    return lobby;
  }

  storeInputFrame(client, input) {
    const lobby = this.getLobbyForClient(client);
    if (!lobby.room || lobby.phase !== 'match_running') {
      throw new Error('Match has not started.');
    }
    lobby.room.setInput(client.id, input);
    this._touchLobby(lobby);
    return lobby;
  }

  disconnect(client) {
    const code = client.lobbyCode;
    if (!code) return null;
    const lobby = this.lobbies.get(code);
    if (!lobby) return null;

    lobby.players = lobby.players.map((player) => (
      player.id === client.id ? { ...player, connected: false, ready: false } : player
    ));
    if (lobby.room) {
      lobby.room.stop('disconnect');
      lobby.room = null;
    }
    this._compactLobby(lobby);
    this._touchLobby(lobby);
    if (lobby.players.every((player) => !player.connected)) {
      this.lobbies.delete(code);
      return null;
    }
    lobby.phase = lobby.players.length >= 2 ? 'match_pending' : 'lobby';
    return lobby;
  }

  getLobbyForClient(client) {
    const lobby = client.lobbyCode ? this.lobbies.get(client.lobbyCode) : null;
    if (!lobby) throw new Error('Client is not linked to a lobby.');
    return lobby;
  }

  _ensureClientFree(client) {
    if (client.lobbyCode && this.lobbies.has(client.lobbyCode)) {
      throw new Error('Client is already in a lobby.');
    }
  }

  _createPlayer(client, slot) {
    return {
      id: client.id,
      slot,
      characterId: DEFAULT_CHAR,
      ready: false,
      connected: true,
      socket: client,
    };
  }

  _generateCode() {
    let code = '';
    do {
      code = crypto.randomBytes(3).toString('hex').toUpperCase();
    } while (this.lobbies.has(code));
    return code;
  }

  _touchLobby(lobby) {
    lobby.updatedAt = Date.now();
  }

  _compactLobby(lobby) {
    lobby.players = lobby.players
      .filter((player) => player.connected)
      .map((player, slot) => {
        player.slot = slot;
        if (player.socket) {
          player.socket.slot = slot;
          player.socket.lobbyCode = lobby.code;
        }
        return player;
      });
  }

  sweepExpiredLobbies(now = Date.now()) {
    for (const [code, lobby] of this.lobbies) {
      const connectedPlayers = lobby.players.filter((player) => player.connected).length;
      const idleMs = now - (lobby.updatedAt || lobby.createdAt || now);

      if (connectedPlayers === 0 && idleMs >= EMPTY_LOBBY_TTL_MS) {
        if (lobby.room) lobby.room.stop('cleanup');
        this.lobbies.delete(code);
        continue;
      }

      if (lobby.phase === 'match_complete' && idleMs >= MATCH_COMPLETE_TTL_MS) {
        if (lobby.room) lobby.room.stop('cleanup');
        this.lobbies.delete(code);
        continue;
      }

      if (!lobby.room && connectedPlayers < MAX_PLAYERS_PER_LOBBY) {
        const idleLimit = lobby.visibility === 'public'
          ? PUBLIC_LOBBY_IDLE_TTL_MS
          : PRIVATE_LOBBY_IDLE_TTL_MS;
        if (idleMs >= idleLimit) {
          this.lobbies.delete(code);
        }
      }
    }
  }
}

function send(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function broadcastLobby(lobby) {
  for (const player of lobby.players) {
    if (!player.socket) continue;
    send(player.socket, createLobbyStatePayload(lobby, player.id));
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      name: 'ring-of-steel-multiplayer',
      ok: true,
      websocketPath: '/ws',
      publicLobbySupport: true,
    }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({ server, path: '/ws' });
const lobbyManager = new LobbyManager();
const connectedClients = new Set();

function broadcastPublicLobbyList() {
  const payload = createLobbyListPayload(lobbyManager.listPublicLobbies());
  for (const socket of connectedClients) {
    send(socket, payload);
  }
}

wss.on('connection', (socket) => {
  connectedClients.add(socket);
  socket.id = crypto.randomUUID();
  send(socket, {
    type: ServerMessageType.WELCOME,
    clientId: socket.id,
  });
  send(socket, createLobbyListPayload(lobbyManager.listPublicLobbies()));

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      send(socket, { type: ServerMessageType.ERROR, message: 'Invalid JSON payload.' });
      return;
    }

    const validation = validateClientMessage(message);
    if (!validation.ok) {
      send(socket, { type: ServerMessageType.ERROR, message: validation.error });
      return;
    }

    try {
      switch (message.type) {
        case ClientMessageType.CREATE_LOBBY: {
          const lobby = lobbyManager.create(socket, { visibility: message.visibility ?? 'private' });
          broadcastLobby(lobby);
          broadcastPublicLobbyList();
          break;
        }
        case ClientMessageType.JOIN_LOBBY: {
          const lobby = lobbyManager.join(socket, message.code.trim().toUpperCase());
          broadcastLobby(lobby);
          broadcastPublicLobbyList();
          break;
        }
        case ClientMessageType.LIST_LOBBIES:
          send(socket, createLobbyListPayload(lobbyManager.listPublicLobbies()));
          break;
        case ClientMessageType.QUICK_MATCH: {
          const lobby = lobbyManager.quickMatch(socket);
          broadcastLobby(lobby);
          broadcastPublicLobbyList();
          break;
        }
        case ClientMessageType.SELECT_CHARACTER: {
          const lobby = lobbyManager.setCharacter(socket, message.characterId.trim());
          broadcastLobby(lobby);
          break;
        }
        case ClientMessageType.READY: {
          const lobby = lobbyManager.setReady(socket, message.ready);
          broadcastLobby(lobby);
          lobbyManager.ensureMatchStarted(lobby);
          break;
        }
        case ClientMessageType.INPUT_FRAME: {
          lobbyManager.storeInputFrame(socket, message.input);
          break;
        }
        case ClientMessageType.PING:
          send(socket, {
            type: ServerMessageType.PONG,
            sentAt: message.sentAt ?? null,
            serverTime: Date.now(),
          });
          break;
      }
    } catch (err) {
      send(socket, {
        type: ServerMessageType.ERROR,
        message: err instanceof Error ? err.message : 'Unknown server error.',
      });
    }
  });

  socket.on('close', () => {
    connectedClients.delete(socket);
    const lobby = lobbyManager.disconnect(socket);
    if (lobby) broadcastLobby(lobby);
    broadcastPublicLobbyList();
  });
});

setInterval(() => {
  lobbyManager.sweepExpiredLobbies();
  broadcastPublicLobbyList();
}, LOBBY_SWEEP_INTERVAL_MS).unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[multiplayer] server listening on ws://0.0.0.0:${PORT}/ws`);
});
