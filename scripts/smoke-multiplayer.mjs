import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

const PORT = Number(process.env.MULTIPLAYER_PORT || 3131);
const SERVER_URL = `ws://127.0.0.1:${PORT}/ws`;
const HEALTH_URL = `http://127.0.0.1:${PORT}/health`;
const SERVER_PATH = fileURLToPath(new URL('../server/multiplayer-server.mjs', import.meta.url));
const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

function waitForMessage(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for websocket message.'));
    }, timeoutMs);

    const onMessage = (raw) => {
      let message;
      try {
        message = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };

    const onError = (err) => {
      cleanup();
      reject(err);
    };

    const cleanup = () => {
      clearTimeout(timeout);
      ws.off('message', onMessage);
      ws.off('error', onError);
    };

    ws.on('message', onMessage);
    ws.on('error', onError);
  });
}

async function connectClient() {
  const ws = new WebSocket(SERVER_URL);
  const welcome = await waitForMessage(ws, (message) => message.type === 'welcome');
  return { ws, welcome };
}

async function waitForHealth(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      // Server may still be booting.
    }
    await delay(150);
  }
  throw new Error(`Health endpoint did not respond within ${timeoutMs}ms.`);
}

async function run() {
  const server = spawn(process.execPath, [SERVER_PATH], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      MULTIPLAYER_PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderr = '';
  server.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    const health = await waitForHealth(HEALTH_URL);

    const { ws: host } = await connectClient();
    const { ws: guest } = await connectClient();
    const hostEvents = [];
    const guestEvents = [];

    host.on('message', (raw) => hostEvents.push(JSON.parse(String(raw))));
    guest.on('message', (raw) => guestEvents.push(JSON.parse(String(raw))));

    host.send(JSON.stringify({ type: 'create_lobby', visibility: 'public' }));
    const hostLobby = await waitForMessage(host, (message) => message.type === 'lobby_state' && message.code);
    const code = hostLobby.code;

    guest.send(JSON.stringify({ type: 'list_lobbies' }));
    const lobbyList = await waitForMessage(guest, (message) => message.type === 'lobby_list');
    const listed = Array.isArray(lobbyList.lobbies) && lobbyList.lobbies.some((lobby) => lobby.code === code);
    if (!listed) {
      throw new Error('Public lobby was not visible in lobby list.');
    }

    host.send(JSON.stringify({ type: 'select_character', characterId: 'spearman' }));
    guest.send(JSON.stringify({ type: 'quick_match' }));
    await waitForMessage(guest, (message) => message.type === 'lobby_state' && message.code === code);
    guest.send(JSON.stringify({ type: 'select_character', characterId: 'ronin' }));

    host.send(JSON.stringify({ type: 'ready', ready: true }));
    guest.send(JSON.stringify({ type: 'ready', ready: true }));

    await waitForMessage(host, (message) => message.type === 'match_start');
    await delay(500);

    const errors = [...hostEvents, ...guestEvents]
      .filter((message) => message.type === 'error')
      .map((message) => message.message);

    const summary = {
      health,
      code,
      listed,
      matchStarted: [...hostEvents, ...guestEvents].some((message) => message.type === 'match_start'),
      snapshotCount: [...hostEvents, ...guestEvents].filter((message) => message.type === 'state_snapshot').length,
      combatEventCount: [...hostEvents, ...guestEvents].filter((message) => message.type === 'combat_event').length,
      errors,
    };

    host.close();
    guest.close();

    if (!summary.matchStarted || summary.snapshotCount === 0 || errors.length > 0) {
      console.error(JSON.stringify(summary, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    server.kill();
    await delay(100);
    if (!server.killed) {
      server.kill('SIGKILL');
    }
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
