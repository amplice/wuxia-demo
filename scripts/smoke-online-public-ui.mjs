import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const randomOffset = Math.floor(Math.random() * 1000);
const liveMode = process.argv.includes('--live');
const APP_PORT = Number(process.env.APP_PORT || (liveMode ? 5180 : (4400 + randomOffset)));
const WS_PORT = Number(process.env.MULTIPLAYER_PORT || (liveMode ? 3010 : (3400 + randomOffset)));
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

async function openOnlineMode(page, serverUrl) {
  await page.evaluate((url) => {
    const game = window.__ringOfSteelGame;
    game.gameState = 'select';
    game.ui.showSelect();
    game.ui.select.mode = 'online';
    game.ui.select._updateModeUI();
    if (game.ui.select.onModeChange) {
      game.ui.select.onModeChange('online');
    }
    const input = document.getElementById('online-server-url');
    input.value = url;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, serverUrl);
  await page.waitForSelector('#online-server-url');
  await page.$eval('#online-server-url', (el, value) => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, serverUrl);
}

async function waitForHud(page, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const visible = await page.evaluate(() => {
      const hud = document.getElementById('hud');
      return hud && getComputedStyle(hud).display === 'block';
    });
    if (visible) return;
    await delay(100);
  }
  throw new Error('Timed out waiting for HUD.');
}

async function readGameState(page) {
  return page.evaluate(() => {
    const game = window.__ringOfSteelGame;
    return {
      mode: game?.mode ?? null,
      state: game?.gameState ?? null,
      hasFighter1: Boolean(game?.fighter1),
      hasFighter2: Boolean(game?.fighter2),
      fighter1State: game?.fighter1?.state ?? null,
      fighter2State: game?.fighter2?.state ?? null,
      onlineSlot: game?.onlineLocalSlot ?? null,
      onlineLobbyCode: game?.onlineSession?.lobbyCode ?? null,
      discoveryConnected: Boolean(game?.onlineDiscoverySession?.connected),
      lastSnapshotFrame: game?.onlineSession?.lastSnapshot?.frameCount ?? null,
    };
  });
}

async function dispatchForwardMove(page) {
  await page.evaluate(() => {
    const game = window.__ringOfSteelGame;
    const session = game?.onlineSession;
    const baseFrame = session?.lastSnapshot?.frameCount ?? 0;
    const input = {
      frame: baseFrame + 1,
      held: {
        left: true,
        right: false,
        sidestepUp: false,
        sidestepDown: false,
        block: false,
      },
      pressed: {
        quick: false,
        heavy: false,
        thrust: false,
        sidestepUp: false,
        sidestepDown: false,
        backstep: false,
        block: false,
      },
    };
    game?._applyOnlineLocalControlMapping?.(input);
    session?.sendInputFrame(baseFrame + 1, input);
  });
}

async function waitForLobbyListRow(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await page.evaluate(() => document.querySelectorAll('#online-lobby-list .online-lobby-row').length);
    if (count > 0) return count;
    await delay(100);
  }
  throw new Error('Timed out waiting for public lobby row.');
}

async function waitForLobbyCode(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const code = await page.$eval('#online-lobby-code', (el) => el.value).catch(() => '');
    if (code) return code;
    await delay(100);
  }
  throw new Error('Timed out waiting for lobby code.');
}

async function runOne({ mode }) {
  const app = liveMode ? null : spawnProcess('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(APP_PORT)]);
  const server = liveMode ? null : spawnProcess('node', ['server/multiplayer-server.mjs'], { MULTIPLAYER_PORT: String(WS_PORT) });

  let browser;
  try {
    console.log(`[public-ui-smoke] mode=${mode} live=${liveMode} app=${APP_URL} ws=${WS_PORT}`);
    await Promise.all([
      waitForHttp(APP_URL),
      waitForHttp(`http://127.0.0.1:${WS_PORT}/health`),
    ]);
    console.log('[public-ui-smoke] servers ready');

    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 240000,
    });
    const hostPage = await browser.newPage();
    const guestPage = await browser.newPage();

    await Promise.all([
      hostPage.goto(APP_URL, { waitUntil: 'domcontentloaded' }),
      guestPage.goto(APP_URL, { waitUntil: 'domcontentloaded' }),
    ]);
    console.log('[public-ui-smoke] pages loaded');

    await Promise.all([
      waitForGameReady(hostPage),
      waitForGameReady(guestPage),
    ]);
    console.log('[public-ui-smoke] game ready');

    const serverUrl = `ws://127.0.0.1:${WS_PORT}/ws`;
    await Promise.all([
      openOnlineMode(hostPage, serverUrl),
      openOnlineMode(guestPage, serverUrl),
    ]);
    console.log('[public-ui-smoke] online mode open');

    if (mode === 'public') {
      await hostPage.$eval('#online-host-public-btn', (el) => el.click());
      console.log('[public-ui-smoke] host public clicked');
      const code = await waitForLobbyCode(hostPage);
      console.log(`[public-ui-smoke] host code ${code}`);
      await waitForLobbyListRow(guestPage);
      console.log('[public-ui-smoke] guest sees public row');
      await guestPage.$eval('#online-lobby-list .online-lobby-row .select-btn', (el) => el.click());
      console.log('[public-ui-smoke] guest joined from list');

      await Promise.all([
        waitForHud(hostPage),
        waitForHud(guestPage),
      ]);
      console.log('[public-ui-smoke] HUD visible');

      await dispatchForwardMove(guestPage);
      await delay(750);
      console.log('[public-ui-smoke] guest move sent');

      const [hostState, guestState] = await Promise.all([
        readGameState(hostPage),
        readGameState(guestPage),
      ]);

      return { code, hostState, guestState };
    }

    await hostPage.$eval('#online-quick-match-btn', (el) => el.click());
    await guestPage.$eval('#online-quick-match-btn', (el) => el.click());
    console.log('[public-ui-smoke] quick match clicked both');

    await Promise.all([
      waitForHud(hostPage),
      waitForHud(guestPage),
    ]);
    console.log('[public-ui-smoke] HUD visible');

    await dispatchForwardMove(guestPage);
    await delay(750);
    console.log('[public-ui-smoke] guest move sent');

    const [hostState, guestState] = await Promise.all([
      readGameState(hostPage),
      readGameState(guestPage),
    ]);

    return { code: hostState.onlineLobbyCode, hostState, guestState };
  } finally {
    await browser?.close();
    if (!liveMode) {
      killProcessTree(app.proc);
      killProcessTree(server.proc);
      await delay(150);
      if (app.getStderr().trim()) console.error(app.getStderr().trim());
      if (server.getStderr().trim()) console.error(server.getStderr().trim());
    }
  }
}

async function main() {
  const mode = process.argv.includes('--quick') ? 'quick' : 'public';
  const repeatsArg = process.argv.find((arg) => arg.startsWith('--repeats='));
  const repeats = Math.max(1, Number(repeatsArg?.split('=')[1] || 1));
  const results = [];

  for (let i = 0; i < repeats; i++) {
    const result = await runOne({ mode });
    results.push(result);

    if (mode === 'public') {
      const ok = result.hostState.fighter2State === 'walk_forward' && result.guestState.fighter2State === 'walk_forward';
      if (!ok) {
        console.error(JSON.stringify({ mode, run: i + 1, result }, null, 2));
        process.exit(1);
      }
    } else {
      const ok = result.guestState.fighter2State === 'walk_forward';
      if (!ok) {
        console.error(JSON.stringify({ mode, run: i + 1, result }, null, 2));
        process.exit(1);
      }
    }
  }

  console.log(JSON.stringify({ mode, repeats, results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
