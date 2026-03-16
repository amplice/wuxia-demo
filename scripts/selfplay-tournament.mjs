#!/usr/bin/env node
import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import os from 'os';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'analysis');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const repeats = Number(args.find(a => a.startsWith('--repeats='))?.split('=')[1] || '1');
const maxRoundFrames = Number(args.find(a => a.startsWith('--max-round-frames='))?.split('=')[1] || String(60 * 20));
const roundsToWin = Number(args.find(a => a.startsWith('--rounds-to-win='))?.split('=')[1] || '3');
const maxMatchRounds = Number(args.find(a => a.startsWith('--max-match-rounds='))?.split('=')[1] || '9');
const seedBase = Number(args.find(a => a.startsWith('--seed='))?.split('=')[1] || '1337');
const profilesArg = args.find(a => a.startsWith('--profiles='))?.split('=')[1];
const charsArg = args.find(a => a.startsWith('--chars='))?.split('=')[1];
const profiles = profilesArg ? profilesArg.split(',').map(s => s.trim()).filter(Boolean) : undefined;
const characters = charsArg ? charsArg.split(',').map(s => s.trim()).filter(Boolean) : undefined;

async function startVite() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', '5199'], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    let output = '';
    const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
    proc.stdout.on('data', (data) => {
      output += data.toString();
      const clean = stripAnsi(output);
      if (clean.includes('Local:')) {
        const match = clean.match(/http:\/\/[^\s]+/);
        if (match) resolve({ proc, url: match[0] });
      }
    });
    proc.stderr.on('data', (data) => {
      output += data.toString();
    });

    setTimeout(() => reject(new Error('Vite start timeout. Output:\n' + stripAnsi(output))), 15000);
  });
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function stopProcessTree(proc) {
  if (!proc || proc.killed) return;
  if (os.platform() === 'win32') {
    await new Promise((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(proc.pid), '/t', '/f'], {
        stdio: 'ignore',
        shell: true,
      });
      killer.on('exit', () => resolve());
      killer.on('error', () => resolve());
    });
    return;
  }

  proc.kill('SIGTERM');
  await new Promise((resolve) => setTimeout(resolve, 500));
  if (!proc.killed) proc.kill('SIGKILL');
}

async function main() {
  console.log('[selfplay-script] starting vite');
  const { proc: viteProc, url } = await startVite();
  console.log(`[selfplay-script] vite ready ${url}`);
  let browser;
  try {
    console.log('[selfplay-script] launching browser');
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader'],
      defaultViewport: { width: 1280, height: 720 },
    });

    const page = await browser.newPage();
    console.log('[selfplay-script] opening page');
    page.on('console', (msg) => console.log(`[browser:${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => console.error(`[pageerror] ${err.message}`));

    await page.goto(`${url}/tournament.html`, { waitUntil: 'load', timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log('[selfplay-script] page loaded');
    await page.waitForFunction(() => typeof window.runSelfPlayTournament === 'function', { timeout: 30000 });
    console.log('[selfplay-script] runner available');

    console.log('[selfplay-script] running tournament');
    const result = await page.evaluate(async ({ repeats, maxRoundFrames, roundsToWin, maxMatchRounds, seedBase, profiles, characters }) => {
      return window.runSelfPlayTournament({
        repeats,
        maxRoundFrames,
        roundsToWin,
        maxMatchRounds,
        seedBase,
        profiles,
        characters,
      });
    }, { repeats, maxRoundFrames, roundsToWin, maxMatchRounds, seedBase, profiles, characters });

    const outPath = path.join(OUT_DIR, `selfplay-${timestamp()}.json`);
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));

    console.log(`Saved tournament result to ${outPath}`);
    console.log(`Matches: ${result.summary.totalMatches}`);
    console.log(`Decisive: ${result.summary.decisiveMatches}`);
    console.log(`Draws: ${result.summary.drawnMatches}`);
    console.log('Class wins:', result.summary.classWins);
    console.log('Profile wins:', result.summary.profileWins);
    if (result.summary.findings.length) {
      console.log('Findings:');
      for (const finding of result.summary.findings) {
        console.log(`- ${finding}`);
      }
    }
  } finally {
    if (browser) await browser.close();
    await stopProcessTree(viteProc);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
