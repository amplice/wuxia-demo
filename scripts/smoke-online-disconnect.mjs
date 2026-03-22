import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const randomOffset = Math.floor(Math.random() * 1000);
const APP_PORT = Number(process.env.APP_PORT || (4300 + randomOffset));
const WS_PORT = Number(process.env.MULTIPLAYER_PORT || (3300 + randomOffset));
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
  throw new Error('Timed out waiting for game ready.');
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

async function readUiState(page) {
  return page.evaluate(() => {
    const game = window.__ringOfSteelGame;
    const select = document.getElementById('select-screen');
    return {
      gameState: game?.gameState ?? null,
      mode: game?.mode ?? null,
      onlineConnected: Boolean(game?.onlineSession?.connected),
      hasFighter1: Boolean(game?.fighter1),
      hasFighter2: Boolean(game?.fighter2),
      selectVisible: select ? getComputedStyle(select).display !== 'none' : false,
      statusText: select?.querySelector('.status-note')?.textContent?.trim() ?? null,
    };
  });
}

async function waitForMatchReady(page, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readUiState(page);
    if (
      (state.gameState === 'fighting' || state.gameState === 'round_intro') &&
      state.hasFighter1 &&
      state.hasFighter2
    ) {
      return;
    }
    await delay(100);
  }
  throw new Error('Timed out waiting for online match readiness.');
}

async function run() {
  const app = spawnProcess('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(APP_PORT)]);
  const server = spawnProcess('node', ['server/multiplayer-server.mjs'], { MULTIPLAYER_PORT: String(WS_PORT) });
  let browser;

  try {
    await Promise.all([
      waitForHttp(APP_URL),
      waitForHttp(`http://127.0.0.1:${WS_PORT}/health`),
    ]);

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

    await Promise.all([
      hostPage.goto(APP_URL, { waitUntil: 'domcontentloaded' }),
      guestPage.goto(APP_URL, { waitUntil: 'domcontentloaded' }),
    ]);

    await Promise.all([
      waitForGameReady(hostPage),
      waitForGameReady(guestPage),
    ]);

    const code = await configureOnlineHost(hostPage, 'spearman');
    await configureOnlineGuest(guestPage, 'ronin', code);

    try {
      await Promise.all([
        waitForMatchReady(hostPage),
        waitForMatchReady(guestPage),
      ]);
    } catch (err) {
      const hostState = await readUiState(hostPage);
      const guestState = await readUiState(guestPage);
      console.error(JSON.stringify({ stage: 'waitForMatchReady', code, hostState, guestState }, null, 2));
      throw err;
    }

    await guestPage.close();

    await hostPage.waitForFunction(() => {
      const game = window.__ringOfSteelGame;
      return game?.gameState === 'select';
    }, { timeout: 10000 });

    const hostState = await readUiState(hostPage);
    console.log(JSON.stringify({ code, hostState }, null, 2));
  } finally {
    await browser?.close();
    killProcessTree(app.proc);
    killProcessTree(server.proc);
    await delay(150);
    if (app.getStderr().trim()) console.error(app.getStderr().trim());
    if (server.getStderr().trim()) console.error(server.getStderr().trim());
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
