import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PROJECT_ROOT = fileURLToPath(new URL('..', import.meta.url));

const STEPS = [
  ['build', ['npm', 'run', 'build']],
  ['parity', ['npm', 'run', 'multiplayer:parity']],
  ['ws smoke', ['npm', 'run', 'multiplayer:smoke']],
  ['browser smoke', ['npm', 'run', 'multiplayer:browser-smoke']],
  ['public ui smoke', ['npm', 'run', 'multiplayer:public-ui-smoke']],
  ['disconnect smoke', ['npm', 'run', 'multiplayer:disconnect-smoke']],
];

function runCommand([label, commandSpec]) {
  const [command, ...args] = commandSpec;
  const isWinNpm = process.platform === 'win32' && command === 'npm';
  const resolvedCommand = isWinNpm ? 'cmd.exe' : command;
  const resolvedArgs = isWinNpm ? ['/c', 'npm.cmd', ...args] : args;

  return new Promise((resolve, reject) => {
    console.log(`\n[multiplayer-check] starting ${label}`);
    const child = spawn(resolvedCommand, resolvedArgs, {
      cwd: PROJECT_ROOT,
      env: { ...process.env },
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        console.log(`[multiplayer-check] passed ${label}`);
        resolve();
        return;
      }
      reject(new Error(`${label} failed with code ${code ?? 'null'} signal ${signal ?? 'none'}`));
    });
  });
}

async function main() {
  const startedAt = Date.now();
  for (const step of STEPS) {
    await runCommand(step);
  }
  const elapsedMs = Date.now() - startedAt;
  console.log(`\n[multiplayer-check] all checks passed in ${(elapsedMs / 1000).toFixed(1)}s`);
}

main().catch((err) => {
  console.error(`\n[multiplayer-check] failed: ${err.message}`);
  process.exit(1);
});
