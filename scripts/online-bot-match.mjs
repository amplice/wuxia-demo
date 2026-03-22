import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { AIController } from '../src/ai/AIController.js';
import { resolveAIPersonality } from '../src/ai/AIPersonality.js';
import { FighterSim } from '../src/sim/FighterSim.js';
import { CHARACTER_DEFS } from '../src/entities/CharacterDefs.js';
import { DEFAULT_CHAR } from '../src/entities/CharacterDefs.js';
import { FRAME_DURATION, AttackType } from '../src/core/Constants.js';
import { createEmptyInputFrame } from '../src/sim/InputFrame.js';
import { getAttackData } from '../src/combat/AttackData.js';

const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const DEFAULT_LIVE_WS_URL = 'wss://ringofsteel-production.up.railway.app/ws';
const ANALYSIS_DIR = path.join(PROJECT_ROOT, 'analysis');

if (!fs.existsSync(ANALYSIS_DIR)) {
  fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
}

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
      if (res.ok) return await res.json();
    } catch {
      // Booting.
    }
    await delay(200);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function waitForMessage(ws, predicate, timeoutMs = 10000) {
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

class BotFighterProxy {
  constructor(shadow, input) {
    this.shadow = shadow;
    this.input = input;
  }

  get state() { return this.shadow.state; }
  get fsm() { return this.shadow.fsm; }
  get charDef() { return this.shadow.charDef; }
  get weaponType() { return this.shadow.weaponType; }
  get group() { return this.shadow.group; }
  get position() { return this.shadow.position; }
  get facingRight() { return this.shadow.facingRight; }
  get currentAttackType() { return this.shadow.currentAttackType; }
  get currentAttackData() { return this.shadow.currentAttackData; }
  get hitApplied() { return this.shadow.hitApplied; }

  distanceTo(other) {
    return this.shadow.distanceTo(other.shadow ?? other);
  }

  getBodyCollisionPosition(target) {
    return this.shadow.getBodyCollisionPosition(target);
  }

  applyMovementInput(direction) {
    this.input.held.left = direction < 0;
    this.input.held.right = direction > 0;
  }

  attack(type) {
    if (type === AttackType.HEAVY) this.input.pressed.heavy = true;
    else if (type === AttackType.THRUST) this.input.pressed.thrust = true;
    else this.input.pressed.quick = true;
  }

  block() {
    this.input.held.block = true;
  }

  parry() {
    this.input.pressed.block = true;
  }

  sidestep(direction) {
    if (direction < 0) this.input.pressed.sidestepUp = true;
    else this.input.pressed.sidestepDown = true;
  }

  backstep() {
    this.input.pressed.backstep = true;
  }
}

function applyShadowSnapshot(fighter, snapshot) {
  fighter._applySnapshotCore(snapshot, (attackType) => getAttackData(attackType, fighter.weaponType), {
    applyTransform: true,
  });
  fighter._updateVirtualClipName();
  fighter._updateTipMotion();
}

class OnlineBotClient {
  constructor({ url, profile, characterId, label, brain = 'scripted' }) {
    this.url = url;
    this.profile = profile;
    this.characterId = CHARACTER_DEFS[characterId] ? characterId : DEFAULT_CHAR;
    this.label = label;
    this.brain = brain;
    this.ai = new AIController(profile);
    this.personality = resolveAIPersonality(profile).personality;
    this.ws = null;
    this.clientId = null;
    this.lobbyCode = null;
    this.slot = null;
    this.players = null;
    this.phase = 'idle';
    this.lastSnapshot = null;
    this.shadowSelf = null;
    this.shadowOpponent = null;
    this._thinkTimer = null;
    this._messageHandlers = [];
    this.metrics = {
      combatEvents: 0,
      snapshots: 0,
      roundTransitions: 0,
      pongs: 0,
      errors: [],
    };
    this._decisionTick = 0;
    this._staleTicks = 0;
    this._lastProgressSignature = '0:0';
  }

  async connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    const welcome = await waitForMessage(ws, (message) => message.type === 'welcome');
    this.clientId = welcome.clientId;
    ws.on('message', (raw) => this._onMessage(raw));
    this._startThinkLoop();
    return welcome;
  }

  disconnect() {
    if (this._thinkTimer) {
      clearInterval(this._thinkTimer);
      this._thinkTimer = null;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }

  quickMatch() {
    this._send({ type: 'quick_match' });
  }

  onMessage(handler) {
    this._messageHandlers.push(handler);
  }

  _send(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`[${this.label}] websocket not open`);
    }
    this.ws.send(JSON.stringify(payload));
  }

  _onMessage(raw) {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }

    switch (message.type) {
      case 'lobby_state':
        this.lobbyCode = message.code ?? this.lobbyCode;
        this.players = message.players ?? this.players;
        this.phase = message.phase ?? this.phase;
        {
          const self = message.players?.find((player) => player.self || player.id === this.clientId);
          if (self) this.slot = self.slot;
        }
        if (this.lobbyCode && !this._characterSent) {
          this._send({ type: 'select_character', characterId: this.characterId });
          this._send({ type: 'ready', ready: true });
          this._characterSent = true;
        }
        break;
      case 'match_start':
        this.phase = message.phase ?? 'match_running';
        this.players = message.players ?? this.players;
        {
          const self = message.players?.find((player) => player.id === this.clientId);
          if (self) this.slot = self.slot;
        }
        this._ensureShadows();
        if (message.snapshot) {
          this._applyMatchSnapshot(message.snapshot);
        }
        break;
      case 'state_snapshot':
        this.metrics.snapshots++;
        this._applyMatchSnapshot(message.snapshot);
        break;
      case 'combat_event':
        this.metrics.combatEvents++;
        break;
      case 'match_state':
        this.phase = message.phase ?? this.phase;
        if (message.phase === 'round_complete' || message.phase === 'match_complete') {
          this.metrics.roundTransitions++;
        }
        if (message.snapshot) {
          this._applyMatchSnapshot(message.snapshot);
        }
        break;
      case 'pong':
        this.metrics.pongs++;
        break;
      case 'error':
        if (message.message !== 'Match has not started.') {
          this.metrics.errors.push(message.message);
        }
        break;
      default:
        break;
    }

    for (const handler of this._messageHandlers) {
      handler(message);
    }
  }

  _ensureShadows() {
    if (this.slot == null || !this.players || this.players.length < 2) return;
    const selfPlayer = this.players.find((player) => player.slot === this.slot);
    const opponentPlayer = this.players.find((player) => player.slot !== this.slot);
    if (!selfPlayer || !opponentPlayer) return;
    if (!this.shadowSelf || this.shadowSelf.charId !== selfPlayer.characterId) {
      this.shadowSelf = new FighterSim(selfPlayer.slot, selfPlayer.characterId, CHARACTER_DEFS[selfPlayer.characterId]);
    }
    if (!this.shadowOpponent || this.shadowOpponent.charId !== opponentPlayer.characterId) {
      this.shadowOpponent = new FighterSim(opponentPlayer.slot, opponentPlayer.characterId, CHARACTER_DEFS[opponentPlayer.characterId]);
    }
  }

  _applyMatchSnapshot(snapshot) {
    if (!snapshot) return;
    this.lastSnapshot = snapshot;
    this._ensureShadows();
    if (!this.shadowSelf || !this.shadowOpponent || this.slot == null) return;

    const selfSnapshot = snapshot.fighters?.find((fighter) => fighter.playerIndex === this.slot);
    const opponentSnapshot = snapshot.fighters?.find((fighter) => fighter.playerIndex !== this.slot);
    if (selfSnapshot) applyShadowSnapshot(this.shadowSelf, selfSnapshot);
    if (opponentSnapshot) applyShadowSnapshot(this.shadowOpponent, opponentSnapshot);
  }

  _startThinkLoop() {
    if (this._thinkTimer) clearInterval(this._thinkTimer);
    this._thinkTimer = setInterval(() => {
      try {
        this._think();
      } catch (err) {
        this.metrics.errors.push(err instanceof Error ? err.message : String(err));
      }
    }, Math.round(FRAME_DURATION * 1000 * 3));
  }

  _think() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.phase !== 'match_running') return;
    if (!this.lastSnapshot || !this.shadowSelf || !this.shadowOpponent) return;

    const progressSignature = `${this.metrics.combatEvents}:${this.metrics.roundTransitions}`;
    if (progressSignature === this._lastProgressSignature) this._staleTicks++;
    else {
      this._staleTicks = 0;
      this._lastProgressSignature = progressSignature;
    }

    const frame = (this.lastSnapshot.frameCount ?? 0) + 1;
    const input = createEmptyInputFrame(frame);
    if (this.brain === 'ai') {
      const selfProxy = new BotFighterProxy(this.shadowSelf, input);
      const opponentProxy = new BotFighterProxy(this.shadowOpponent, createEmptyInputFrame(frame));
      this.ai.update(selfProxy, opponentProxy, this.lastSnapshot.frameCount ?? 0, FRAME_DURATION * 3);
    } else if (this.brain === 'balance') {
      this._balanceThink(input);
    } else {
      this._scriptedThink(input);
    }
    this._send({
      type: 'input_frame',
      frame: input.frame,
      input,
    });
  }

  _scriptedThink(input) {
    this._decisionTick++;
    const self = this.shadowSelf;
    const opponent = this.shadowOpponent;
    const dist = self.distanceTo(opponent);
    const ranges = self.charDef?.aiRanges || { engage: 2.5, close: 1.8 };
    const engaging = dist <= ranges.engage + 0.15;
    const close = dist <= ranges.close;

    if (!self.fsm.isActionable) return;

    if (opponent.fsm.isAttacking && dist < ranges.engage + 0.35) {
      if (this._decisionTick % 5 === 0) {
        input.pressed.block = true;
      } else {
        input.held.block = true;
      }
      return;
    }

    if (!engaging) {
      input.held.right = true;
      return;
    }

    if (close && this._decisionTick % 11 === 0) {
      if (this._decisionTick % 22 === 0) input.pressed.sidestepUp = true;
      else input.pressed.sidestepDown = true;
      return;
    }

    if (this._decisionTick % 17 === 0) {
      input.pressed.heavy = true;
      return;
    }
    if (this._decisionTick % 9 === 0) {
      input.pressed.thrust = true;
      return;
    }
    if (this._decisionTick % 4 === 0) {
      input.pressed.quick = true;
      return;
    }

    input.held.right = !close;
  }

  _balanceThink(input) {
    this._decisionTick++;
    const self = this.shadowSelf;
    const opponent = this.shadowOpponent;
    const p = this.personality;
    const dist = self.distanceTo(opponent);
    const ranges = self.charDef?.aiRanges || { engage: 2.5, close: 1.8 };
    const inRange = dist <= ranges.engage + 0.1;
    const close = dist <= ranges.close;

    if (!self.fsm.isActionable) return;

    if (this._staleTicks > 40) {
      if (!inRange) {
        input.held.right = true;
        return;
      }
      if (this._decisionTick % 5 === 0) input.pressed.heavy = true;
      else if (this._decisionTick % 2 === 0 || !close) input.pressed.thrust = true;
      else input.pressed.quick = true;
      return;
    }

    if (opponent.fsm.isAttacking && dist < ranges.engage + 0.3) {
      const defenseRoll = (this._decisionTick + this.slot) % 10;
      const parryThreshold = Math.max(1, Math.round((p.parryRate + Math.max(0, p.parryBias || 0)) * 10));
      const dodgeThreshold = Math.max(0, Math.round((p.dodgeRate + Math.max(0, p.sidestepBias || 0)) * 10));
      if (defenseRoll < parryThreshold) {
        input.pressed.block = true;
        return;
      }
      if (defenseRoll < parryThreshold + dodgeThreshold) {
        input.pressed[(this._decisionTick % 2 === 0) ? 'sidestepUp' : 'sidestepDown'] = true;
        return;
      }
      input.held.block = true;
      return;
    }

    if (!inRange) {
      input.held.right = p.moveBackBias > 0.08 ? false : true;
      input.held.left = p.moveBackBias > 0.12;
      return;
    }

    if (close && p.spacingAwareness > 0.72 && this._decisionTick % 13 === 0) {
      if (p.dodgeRate + Math.max(0, p.backstepBias || 0) > 0.24) {
        input.pressed.backstep = true;
      } else {
        input.pressed[(this._decisionTick % 2 === 0) ? 'sidestepUp' : 'sidestepDown'] = true;
      }
      return;
    }

    const quickScore = 1 + (p.quickBias || 0) + p.aggression * 0.6 + (close ? 0.25 : 0);
    const heavyScore = 0.55 + (p.heavyBias || 0) + p.heavyMixup * 0.8;
    const thrustScore = 0.75 + (p.thrustBias || 0) + (!close ? 0.18 : 0);
    const sidestepScore = Math.max(0, p.dodgeRate * 0.55 + (p.sidestepBias || 0));
    const backstepScore = Math.max(0, p.dodgeRate * 0.28 + (p.backstepBias || 0));

    const choices = [
      ['quick', quickScore],
      ['heavy', heavyScore],
      ['thrust', thrustScore],
      ['sidestep', sidestepScore],
      ['backstep', backstepScore],
    ];
    const total = choices.reduce((sum, [, score]) => sum + Math.max(score, 0), 0) || 1;
    let roll = ((this._decisionTick * 37) + (this.slot * 17)) % 1000 / 1000 * total;
    for (const [choice, rawScore] of choices) {
      const score = Math.max(rawScore, 0);
      if (roll <= score) {
        switch (choice) {
          case 'heavy':
            input.pressed.heavy = true;
            return;
          case 'thrust':
            input.pressed.thrust = true;
            return;
          case 'sidestep':
            input.pressed[(this._decisionTick % 2 === 0) ? 'sidestepUp' : 'sidestepDown'] = true;
            return;
          case 'backstep':
            input.pressed.backstep = true;
            return;
          case 'quick':
          default:
            input.pressed.quick = true;
            return;
        }
      }
      roll -= score;
    }

    input.pressed.quick = true;
  }
}

async function runMatch({ url, p1Profile, p2Profile, p1Char, p2Char, p1Brain, p2Brain, timeoutMs = 90000 }) {
  const bot1 = new OnlineBotClient({ url, profile: p1Profile, characterId: p1Char, label: 'bot1', brain: p1Brain });
  const bot2 = new OnlineBotClient({ url, profile: p2Profile, characterId: p2Char, label: 'bot2', brain: p2Brain });

  const summary = await new Promise(async (resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for online bot match completion.'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      bot1.disconnect();
      bot2.disconnect();
    };

    const maybeResolve = (message) => {
      if (message.type !== 'match_state' || message.phase !== 'match_complete') return;
      const result = {
        code: bot1.lobbyCode ?? bot2.lobbyCode,
        winner: message.matchWinner ?? message.winner ?? null,
        scores: message.scores ?? null,
        killReason: message.killReason ?? null,
        lastFrame: message.snapshot?.frameCount ?? bot1.lastSnapshot?.frameCount ?? bot2.lastSnapshot?.frameCount ?? null,
        p1Brain,
        p2Brain,
        bot1: bot1.metrics,
        bot2: bot2.metrics,
      };
      cleanup();
      resolve(result);
    };

    bot1.onMessage(maybeResolve);
    bot2.onMessage(maybeResolve);

    await bot1.connect();
    await bot2.connect();

    bot1.quickMatch();
    await delay(200);
    bot2.quickMatch();
  });

  return summary;
}

async function main() {
  const repeats = Number(parseArg('repeats', '1'));
  const timeoutMs = Number(parseArg('timeout-ms', '90000'));
  const p1Profile = parseArg('p1-profile', 'hard');
  const p2Profile = parseArg('p2-profile', 'hard');
  const p1Brain = parseArg('p1-brain', 'scripted');
  const p2Brain = parseArg('p2-brain', 'scripted');
  const p1Char = parseArg('p1-char', 'spearman');
  const p2Char = parseArg('p2-char', 'ronin');
  const explicitUrl = parseArg('server-url', null);
  const live = hasFlag('live');
  const noSave = hasFlag('no-save');
  const defaultPort = live ? '3010' : String(3700 + Math.floor(Math.random() * 300));
  const port = Number(parseArg('port', defaultPort));
  const url = explicitUrl || (live ? DEFAULT_LIVE_WS_URL : `ws://127.0.0.1:${port}/ws`);

  const server = (explicitUrl || live) ? null : spawnProcess('node', ['server/multiplayer-server.mjs'], {
    MULTIPLAYER_PORT: String(port),
  });

  try {
    if (!explicitUrl && !live) {
      await waitForHttp(`http://127.0.0.1:${port}/health`, 15000);
    }

    const results = [];
    for (let i = 0; i < repeats; i++) {
      results.push(await runMatch({
        url,
        p1Profile,
        p2Profile,
        p1Brain,
        p2Brain,
        p1Char,
        p2Char,
        timeoutMs,
      }));
    }

    const summary = {
      generatedAt: new Date().toISOString(),
      url,
      repeats,
      timeoutMs,
      p1Profile,
      p2Profile,
      p1Brain,
      p2Brain,
      p1Char,
      p2Char,
      results,
      winnerCounts: results.reduce((acc, result) => {
        const key = `player${result.winner ?? 'none'}`;
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
      aggregate: {
        averageLastFrame: Math.round(results.reduce((sum, result) => sum + (result.lastFrame || 0), 0) / Math.max(results.length, 1)),
        killReasons: results.reduce((acc, result) => {
          const key = result.killReason || 'unknown';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {}),
        averageScores: {
          player1: Number((results.reduce((sum, result) => sum + (result.scores?.[0] ?? 0), 0) / Math.max(results.length, 1)).toFixed(2)),
          player2: Number((results.reduce((sum, result) => sum + (result.scores?.[1] ?? 0), 0) / Math.max(results.length, 1)).toFixed(2)),
        },
        bot1: {
          avgSnapshots: Number((results.reduce((sum, result) => sum + (result.bot1?.snapshots ?? 0), 0) / Math.max(results.length, 1)).toFixed(2)),
          avgCombatEvents: Number((results.reduce((sum, result) => sum + (result.bot1?.combatEvents ?? 0), 0) / Math.max(results.length, 1)).toFixed(2)),
          totalErrors: results.reduce((sum, result) => sum + (result.bot1?.errors?.length ?? 0), 0),
        },
        bot2: {
          avgSnapshots: Number((results.reduce((sum, result) => sum + (result.bot2?.snapshots ?? 0), 0) / Math.max(results.length, 1)).toFixed(2)),
          avgCombatEvents: Number((results.reduce((sum, result) => sum + (result.bot2?.combatEvents ?? 0), 0) / Math.max(results.length, 1)).toFixed(2)),
          totalErrors: results.reduce((sum, result) => sum + (result.bot2?.errors?.length ?? 0), 0),
        },
      },
    };

    if (!noSave) {
      const modeLabel = live || explicitUrl ? 'online-live' : 'online-local';
      const outPath = path.join(ANALYSIS_DIR, `${modeLabel}-${timestamp()}.json`);
      fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
      summary.savedTo = outPath;
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (server) {
      killProcessTree(server.proc);
      await delay(200);
      const stderr = server.getStderr().trim();
      if (stderr) console.error(stderr);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
