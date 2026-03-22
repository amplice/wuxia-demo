#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));
const ANALYSIS_DIR = path.join(PROJECT_ROOT, 'analysis');
if (!fs.existsSync(ANALYSIS_DIR)) fs.mkdirSync(ANALYSIS_DIR, { recursive: true });

function parseArg(name, fallback = null) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((entry) => entry.startsWith(prefix));
  if (arg) return arg.slice(prefix.length);
  const envKey = `npm_config_${name.replace(/-/g, '_')}`;
  if (process.env[envKey] != null) return process.env[envKey];
  return fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function compactError(err) {
  const text = err instanceof Error ? (err.stack || err.message) : String(err);
  return text.trim();
}

function runBotMatch(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/online-bot-match.mjs', ...args, '--no-save'], {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += String(chunk); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`online-bot-match failed (${code})\n${stderr || stdout}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (err) {
        reject(new Error(`Failed to parse online-bot-match output:\n${stdout}\n${stderr}\n${err.message}`));
      }
    });
  });
}

async function main() {
  const profilesArg = parseArg('profiles', 'hard,medium,easy');
  const charsArg = parseArg('chars', 'spearman,ronin');
  const repeats = Number(parseArg('repeats', '3'));
  const timeoutMs = Number(parseArg('timeout-ms', '90000'));
  const brain = parseArg('brain', 'balance');
  const explicitUrl = parseArg('server-url', null);
  const live = hasFlag('live');
  const failFast = hasFlag('fail-fast');

  const profiles = profilesArg.split(',').map((s) => s.trim()).filter(Boolean);
  const chars = charsArg.split(',').map((s) => s.trim()).filter(Boolean);

  const runs = [];
  const failures = [];
  for (const p1Profile of profiles) {
    for (const p2Profile of profiles) {
      for (const p1Char of chars) {
        for (const p2Char of chars) {
          const args = [
            `--repeats=${repeats}`,
            `--timeout-ms=${timeoutMs}`,
            `--p1-profile=${p1Profile}`,
            `--p2-profile=${p2Profile}`,
            `--p1-brain=${brain}`,
            `--p2-brain=${brain}`,
            `--p1-char=${p1Char}`,
            `--p2-char=${p2Char}`,
          ];
          if (explicitUrl) args.push(`--server-url=${explicitUrl}`);
          if (live) args.push('--live');
          const label = `${p1Profile}[${p1Char}] vs ${p2Profile}[${p2Char}]`;
          console.log(`[online-bot-matrix] ${label}`);
          try {
            const result = await runBotMatch(args);
            runs.push(result);
          } catch (err) {
            const failure = {
              p1Profile,
              p2Profile,
              p1Char,
              p2Char,
              repeats,
              timeoutMs,
              brain,
              error: compactError(err),
            };
            failures.push(failure);
            console.error(`[online-bot-matrix] failed ${label}\n${failure.error}`);
            if (failFast) throw err;
          }
        }
      }
    }
  }

  const aggregate = {
    totalRuns: runs.length,
    failedRuns: failures.length,
    totalMatches: runs.reduce((sum, run) => sum + run.repeats, 0),
    winnerCounts: runs.reduce((acc, run) => {
      for (const [key, value] of Object.entries(run.winnerCounts ?? {})) {
        acc[key] = (acc[key] || 0) + value;
      }
      return acc;
    }, {}),
    killReasons: runs.reduce((acc, run) => {
      for (const [key, value] of Object.entries(run.aggregate?.killReasons ?? {})) {
        acc[key] = (acc[key] || 0) + value;
      }
      return acc;
    }, {}),
  };

  const summary = {
    generatedAt: new Date().toISOString(),
    live: live || Boolean(explicitUrl),
    serverUrl: explicitUrl ?? null,
    repeats,
    timeoutMs,
    brain,
    profiles,
    chars,
    aggregate,
    runs,
    failures,
  };

  const label = live || explicitUrl ? 'online-matrix-live' : 'online-matrix-local';
  const outPath = path.join(ANALYSIS_DIR, `${label}-${timestamp()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`Saved online bot matrix to ${outPath}`);
  console.log(`Runs: ${aggregate.totalRuns}`);
  console.log(`Failures: ${aggregate.failedRuns}`);
  console.log(`Matches: ${aggregate.totalMatches}`);
  console.log(`Winner counts: ${JSON.stringify(aggregate.winnerCounts)}`);
  console.log(`Kill reasons: ${JSON.stringify(aggregate.killReasons)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
