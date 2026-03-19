import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const randomOffset = Math.floor(Math.random() * 1000);
const APP_PORT = Number(process.env.APP_PORT || (4200 + randomOffset));
const WS_PORT = Number(process.env.MULTIPLAYER_PORT || (3200 + randomOffset));
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));

function spawnProcess(command, args, extraEnv = {}) {
  const isWinNpm = process.platform === 'win32' && command === 'npm';
  const resolvedCommand = isWinNpm ? 'cmd.exe' : command;
  const resolvedArgs = isWinNpm ? ['/c', 'npm.cmd', ...args] : args;
  const proc = spawn(resolvedCommand, resolvedArgs, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  let stderr = '';
  proc.stderr.on('data', (chunk) => {
    stderr += String(chunk);
  });
  return { proc, getStderr: () => stderr };
}

function killProcessTree(proc) {
  if (!proc || proc.killed) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], {
      stdio: 'ignore',
      shell: false,
    });
    killer.unref();
    return;
  }
  proc.kill('SIGTERM');
}

async function waitForHttp(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // Booting.
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForGameReady(page) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => {
      const game = window.__ringOfSteelGame;
      return Boolean(game?._charCache?.ronin && game?._charCache?.spearman);
    });
    if (ready) return;
    await delay(200);
  }
  const debug = await page.evaluate(() => ({
    hasGame: Boolean(window.__ringOfSteelGame),
    cacheKeys: Object.keys(window.__ringOfSteelGame?._charCache ?? {}),
    gameState: window.__ringOfSteelGame?.gameState ?? null,
    loadingStatus: document.getElementById('loading-status')?.textContent ?? null,
    loadingPercent: document.getElementById('loading-percent')?.textContent ?? null,
    bodyText: document.body.innerText.slice(0, 400),
  }));
  throw new Error(`Timed out waiting for game ready: ${JSON.stringify(debug)}`);
}

async function configureOnlineHost(page, characterId) {
  await page.evaluate(async ({ characterId, serverUrl }) => {
    const game = window.__ringOfSteelGame;
    game.gameState = 'select';
    game.ui.showSelect();
    await game._startOnlineSession({
      mode: 'online',
      difficulty: 'medium',
      p1Char: characterId,
      p2Char: characterId,
      serverUrl,
      lobbyCode: '',
    });
  }, { characterId, serverUrl: `ws://127.0.0.1:${WS_PORT}/ws` });

  await page.waitForFunction(() => {
    return Boolean(window.__ringOfSteelGame?.onlineSession?.lobbyCode);
  }, { timeout: 15000 });
  return page.evaluate(() => window.__ringOfSteelGame.onlineSession.lobbyCode);
}

async function configureOnlineGuest(page, characterId, code) {
  await page.evaluate(async ({ characterId, code, serverUrl }) => {
    const game = window.__ringOfSteelGame;
    game.gameState = 'select';
    game.ui.showSelect();
    await game._startOnlineSession({
      mode: 'online',
      difficulty: 'medium',
      p1Char: characterId,
      p2Char: characterId,
      serverUrl,
      lobbyCode: code,
    });
  }, { characterId, code, serverUrl: `ws://127.0.0.1:${WS_PORT}/ws` });
}

async function waitForHud(page) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const open = await page.evaluate(() => {
      const hud = document.getElementById('hud');
      return hud && getComputedStyle(hud).display === 'block';
    });
    if (open) return;
    await delay(100);
  }
  throw new Error('Timed out waiting for HUD.');
}

async function readGameState(page) {
  return page.evaluate(() => {
    const game = window.__ringOfSteelGame;
    return {
      mode: game?.mode,
      state: game?.gameState,
      hasFighter1: Boolean(game?.fighter1),
      hasFighter2: Boolean(game?.fighter2),
      fighter1State: game?.fighter1?.state ?? null,
      fighter2State: game?.fighter2?.state ?? null,
      onlineSlot: game?.onlineLocalSlot ?? null,
      onlineLobbyCode: game?.onlineSession?.lobbyCode ?? null,
      lastSnapshotFrame: game?.onlineSession?.lastSnapshot?.frameCount ?? null,
    };
  });
}

async function dispatchQuickAttack(page) {
  await page.evaluate(() => {
    const game = window.__ringOfSteelGame;
    const session = game?.onlineSession;
    const baseFrame = session?.lastSnapshot?.frameCount ?? 0;
    session?.sendInputFrame(baseFrame + 1, {
      frame: baseFrame + 1,
      held: {
        left: false,
        right: false,
        sidestepUp: false,
        sidestepDown: false,
        block: false,
      },
      pressed: {
        quick: true,
        heavy: false,
        thrust: false,
        sidestepUp: false,
        sidestepDown: false,
        backstep: false,
        block: false,
      },
    });
  });
}

async function waitForFighterState(page, fighterKey, expectedState, timeoutMs = 5000) {
  await page.waitForFunction(
    ({ fighterKey, expectedState }) => {
      const game = window.__ringOfSteelGame;
      return game?.[fighterKey]?.state === expectedState;
    },
    { timeout: timeoutMs },
    { fighterKey, expectedState },
  );
}

async function run() {
  const app = spawnProcess('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(APP_PORT)]);
  const server = spawnProcess('node', ['server/multiplayer-server.mjs'], { MULTIPLAYER_PORT: String(WS_PORT) });

  let browser;
  try {
    console.log('[browser-smoke] waiting for servers');
    await Promise.all([
      waitForHttp(APP_URL),
      waitForHttp(`http://127.0.0.1:${WS_PORT}/health`),
    ]);

    console.log('[browser-smoke] launching browser');
    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 240000,
    });
    const hostPage = await browser.newPage();
    const guestPage = await browser.newPage();
    for (const page of [hostPage, guestPage]) {
      page.on('console', (msg) => console.log(`[browser:${msg.type()}] ${msg.text()}`));
      page.on('pageerror', (err) => console.error('[browser:pageerror]', err));
    }

    console.log('[browser-smoke] opening app pages');
    await Promise.all([
      hostPage.goto(APP_URL, { waitUntil: 'domcontentloaded' }),
      guestPage.goto(APP_URL, { waitUntil: 'domcontentloaded' }),
    ]);

    console.log('[browser-smoke] waiting for game ready');
    await Promise.all([
      waitForGameReady(hostPage),
      waitForGameReady(guestPage),
    ]);

    console.log('[browser-smoke] creating host lobby');
    const code = await configureOnlineHost(hostPage, 'spearman');
    console.log(`[browser-smoke] host code ${code}`);
    console.log('[browser-smoke] joining guest');
    await configureOnlineGuest(guestPage, 'ronin', code);

    console.log('[browser-smoke] waiting for HUD');
    await Promise.all([
      waitForHud(hostPage),
      waitForHud(guestPage),
    ]);

    console.log('[browser-smoke] sending host quick attack');
    await dispatchQuickAttack(hostPage);
    await delay(750);
    console.log('[browser-smoke] post-input state');
    console.log(JSON.stringify({
      host: await readGameState(hostPage),
      guest: await readGameState(guestPage),
    }, null, 2));
    await Promise.all([
      waitForFighterState(hostPage, 'fighter1', 'attack_active'),
      waitForFighterState(guestPage, 'fighter1', 'attack_active'),
    ]);

    const [hostState, guestState] = await Promise.all([
      readGameState(hostPage),
      readGameState(guestPage),
    ]);

    const summary = {
      code,
      hostState,
      guestState,
    };

    if (!hostState.hasFighter1 || !hostState.hasFighter2 || !guestState.hasFighter1 || !guestState.hasFighter2) {
      console.error(JSON.stringify(summary, null, 2));
      process.exitCode = 1;
      return;
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser?.close();
    killProcessTree(app.proc);
    killProcessTree(server.proc);
    await delay(150);
    if (app.getStderr().trim()) {
      console.error(app.getStderr().trim());
    }
    if (server.getStderr().trim()) {
      console.error(server.getStderr().trim());
    }
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
