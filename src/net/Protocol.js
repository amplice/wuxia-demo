import { createEmptyInputFrame, INPUT_HELD_ACTIONS, INPUT_PRESSED_ACTIONS } from '../sim/InputFrame.js';

export const ClientMessageType = Object.freeze({
  CREATE_LOBBY: 'create_lobby',
  JOIN_LOBBY: 'join_lobby',
  LIST_LOBBIES: 'list_lobbies',
  QUICK_MATCH: 'quick_match',
  SELECT_CHARACTER: 'select_character',
  READY: 'ready',
  INPUT_FRAME: 'input_frame',
  PING: 'ping',
});

export const ServerMessageType = Object.freeze({
  WELCOME: 'welcome',
  ERROR: 'error',
  LOBBY_STATE: 'lobby_state',
  LOBBY_LIST: 'lobby_list',
  MATCH_START: 'match_start',
  MATCH_STATE: 'match_state',
  STATE_SNAPSHOT: 'state_snapshot',
  COMBAT_EVENT: 'combat_event',
  PONG: 'pong',
});

export function sanitizeInputFrame(input) {
  const sanitized = createEmptyInputFrame(Number.isFinite(input?.frame) ? input.frame : 0);

  for (const action of INPUT_HELD_ACTIONS) {
    sanitized.held[action] = Boolean(input?.held?.[action]);
  }

  for (const action of INPUT_PRESSED_ACTIONS) {
    sanitized.pressed[action] = Boolean(input?.pressed?.[action]);
  }

  return sanitized;
}

export function validateClientMessage(message) {
  if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
    return { ok: false, error: 'Malformed message.' };
  }

  switch (message.type) {
    case ClientMessageType.CREATE_LOBBY:
      return message.visibility == null || message.visibility === 'public' || message.visibility === 'private'
        ? { ok: true }
        : { ok: false, error: 'Lobby visibility must be public or private.' };
    case ClientMessageType.JOIN_LOBBY:
      return typeof message.code === 'string' && message.code.trim()
        ? { ok: true }
        : { ok: false, error: 'Lobby code is required.' };
    case ClientMessageType.LIST_LOBBIES:
    case ClientMessageType.QUICK_MATCH:
      return { ok: true };
    case ClientMessageType.SELECT_CHARACTER:
      return typeof message.characterId === 'string' && message.characterId.trim()
        ? { ok: true }
        : { ok: false, error: 'Character id is required.' };
    case ClientMessageType.READY:
      return typeof message.ready === 'boolean'
        ? { ok: true }
        : { ok: false, error: 'Ready flag must be boolean.' };
    case ClientMessageType.INPUT_FRAME:
      return Number.isFinite(message.frame) && message.input
        ? { ok: true }
        : { ok: false, error: 'Input frame payload is incomplete.' };
    case ClientMessageType.PING:
      return { ok: true };
    default:
      return { ok: false, error: `Unknown client message type '${message.type}'.` };
  }
}

export function createLobbyStatePayload(lobby, selfId = null) {
  return {
    type: ServerMessageType.LOBBY_STATE,
    code: lobby.code,
    visibility: lobby.visibility,
    players: lobby.players.map((player) => ({
      id: player.id,
      slot: player.slot,
      characterId: player.characterId,
      ready: player.ready,
      connected: player.connected,
      self: player.id === selfId,
    })),
    canStart: lobby.players.length === 2 && lobby.players.every((player) => player.ready),
    phase: lobby.phase,
  };
}

export function createLobbyListPayload(lobbies) {
  return {
    type: ServerMessageType.LOBBY_LIST,
    lobbies: lobbies.map((lobby) => ({
      code: lobby.code,
      visibility: lobby.visibility,
      phase: lobby.phase,
      playerCount: lobby.players.filter((player) => player.connected).length,
      maxPlayers: 2,
      hostCharacterId: lobby.players[0]?.characterId ?? null,
      createdAt: lobby.createdAt,
    })),
  };
}
