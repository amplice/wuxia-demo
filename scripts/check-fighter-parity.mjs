import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const APP_PORT = Number(process.env.APP_PORT || 4276);
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));

function spawnProcess(command, args) {
  const isWinNpm = process.platform === 'win32' && command === 'npm';
  const resolvedCommand = isWinNpm ? 'cmd.exe' : command;
  const resolvedArgs = isWinNpm ? ['/c', 'npm.cmd', ...args] : args;
  const proc = spawn(resolvedCommand, resolvedArgs, {
    cwd: PROJECT_ROOT,
    env: { ...process.env },
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
      // booting
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function main() {
  const app = spawnProcess('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(APP_PORT)]);
  let browser;

  try {
    await waitForHttp(APP_URL, 30000);
    browser = await puppeteer.launch({
      headless: true,
      protocolTimeout: 240000,
    });
    const page = await browser.newPage();
    page.on('console', (msg) => console.log(`[browser:${msg.type()}] ${msg.text()}`));
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });

    const summary = await page.evaluate(async () => {
      const round = (n) => Number(n.toFixed(6));
      const vecDistance = (a, b) => {
        const dx = a[0] - b[0];
        const dy = a[1] - b[1];
        const dz = a[2] - b[2];
        return Math.sqrt((dx * dx) + (dy * dy) + (dz * dz));
      };

      const waitForReady = async () => {
        const start = performance.now();
        while (performance.now() - start < 30000) {
          const game = window.__ringOfSteelGame;
          if (game?._charCache?.ronin && game?._charCache?.spearman) {
            return game;
          }
          await new Promise((resolve) => window.setTimeout(resolve, 100));
        }
        throw new Error('Game cache did not finish loading.');
      };

      const game = await waitForReady();
      const [{ FighterSim }, { AUTHORITATIVE_TRACKS }, characterDefsModule, combatTuningModule, constantsModule, attackDataModule] = await Promise.all([
        import('/src/sim/FighterSim.js'),
        import('/src/data/authoritativeTracks.js'),
        import('/src/entities/CharacterDefs.js'),
        import('/src/combat/CombatTuning.js'),
        import('/src/core/Constants.js'),
        import('/src/combat/AttackData.js'),
      ]);

      const { CHARACTER_DEFS } = characterDefsModule;
      const { BODY_COLLISION } = combatTuningModule;
      const { FighterState, AttackType } = constantsModule;
      const { getAttackData } = attackDataModule;

      const attackTypeByClip = {
        attack_quick: AttackType.QUICK,
        attack_heavy: AttackType.HEAVY,
        attack_thrust: AttackType.THRUST,
      };

      const stateByClip = {
        idle: FighterState.IDLE,
        walk_forward: FighterState.WALK_FORWARD,
        walk_backward: FighterState.WALK_BACK,
        strafe_left: FighterState.SIDESTEP,
        strafe_right: FighterState.SIDESTEP,
        backstep: FighterState.DODGE,
        block_parry: FighterState.PARRY,
        block_knockback: FighterState.BLOCK_STUN,
        clash_knockback: FighterState.PARRIED_STUN,
      };

      const results = {};
      let globalMax = { charId: null, clipName: null, frame: -1, part: null, error: 0 };

      for (const [charId, trackData] of Object.entries(AUTHORITATIVE_TRACKS.characters ?? {})) {
        const charDef = CHARACTER_DEFS[charId];
        const fighter = new FighterSim(0, charId, charDef);
        fighter.group.position.set(0, 0, 0);
        fighter.group.rotation.set(0, 0, 0);
        results[charId] = {};

        for (const [clipName, clip] of Object.entries(trackData.clips ?? {})) {
          let maxBaseError = 0;
          let maxTipError = 0;
          let maxBodyError = 0;
          let maxFrame = 0;

          for (const frame of clip.frames) {
            fighter.activeClipName = clipName;
            fighter.walkPhase = frame.frame / 60;
            fighter.fsm.currentAttackType = null;
            fighter.fsm.currentAttackData = null;
            fighter.fsm.stateDuration = clip.frameCount;
            fighter.fsm.stateFrames = frame.frame + 1;
            fighter.fsm.transition(stateByClip[clipName] ?? FighterState.IDLE);
            fighter.fsm.stateFrames = frame.frame + 1;
            fighter.fsm.stateDuration = clip.frameCount;

            const attackType = attackTypeByClip[clipName];
            if (attackType) {
              fighter.fsm.state = FighterState.ATTACK_ACTIVE;
              fighter.fsm.currentAttackType = attackType;
              fighter.fsm.currentAttackData = getAttackData(attackType, fighter.weaponType);
            } else if (clipName === 'strafe_left' || clipName === 'strafe_right') {
              fighter.fsm.sidestepPhase = 'dash';
              fighter.fsm.sidestepDirection = clipName === 'strafe_left' ? 1 : -1;
            }

            const base = fighter.getWeaponBaseWorldPosition().toArray().map(round);
            const tip = fighter.getWeaponTipWorldPosition().toArray().map(round);
            const body = fighter.getBodyAnchorWorldPosition().toArray().map(round);

            const baseError = vecDistance(base, frame.base);
            const tipError = vecDistance(tip, frame.tip);
            const expectedBody = frame.body ?? trackData.bodyAnchorOffset ?? [0, BODY_COLLISION.centerHeight, 0];
            const bodyError = vecDistance(body, expectedBody);

            if (baseError > maxBaseError) maxBaseError = baseError;
            if (tipError > maxTipError) maxTipError = tipError;
            if (bodyError > maxBodyError) maxBodyError = bodyError;

            const clipMax = Math.max(baseError, tipError, bodyError);
            if (clipMax >= Math.max(maxBaseError, maxTipError, maxBodyError)) {
              maxFrame = frame.frame;
            }

            if (baseError > globalMax.error) globalMax = { charId, clipName, frame: frame.frame, part: 'base', error: round(baseError) };
            if (tipError > globalMax.error) globalMax = { charId, clipName, frame: frame.frame, part: 'tip', error: round(tipError) };
            if (bodyError > globalMax.error) globalMax = { charId, clipName, frame: frame.frame, part: 'body', error: round(bodyError) };
          }

          results[charId][clipName] = {
            frames: clip.frameCount,
            maxBaseError: round(maxBaseError),
            maxTipError: round(maxTipError),
            maxBodyError: round(maxBodyError),
            worstFrame: maxFrame,
          };
        }
      }

      return {
        globalMax,
        results,
      };
    });

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await browser?.close();
    killProcessTree(app.proc);
    await delay(150);
    const stderr = app.getStderr().trim();
    if (stderr) {
      console.error(stderr);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
