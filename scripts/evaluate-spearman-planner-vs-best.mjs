import fs from 'node:fs';
import path from 'node:path';
import { CHARACTER_DEFS } from '../src/entities/CharacterDefs.js';
import { FighterSim } from '../src/sim/FighterSim.js';
import { MatchSim } from '../src/sim/MatchSim.js';
import { createControllerFromSpec, resetControllerInstance } from '../src/ai/ControllerSpec.js';
import { FRAME_DURATION, ROUNDS_TO_WIN } from '../src/core/Constants.js';

const DEFAULT_REPEATS = 10;
const MAX_MATCH_ROUNDS = 7;
const DEFAULT_ROUND_SECONDS = 180;

const OPPONENTS = Object.freeze([
  { charId: 'ronin', profile: 'aggressor', label: 'ronin:aggressor' },
  { charId: 'ronin', profile: 'ronin_hard_duelist', label: 'ronin:ronin_hard_duelist' },
  { charId: 'knight', profile: 'knight_sentinel', label: 'knight:knight_sentinel' },
  { charId: 'knight', profile: 'knight_hard_guard', label: 'knight:knight_hard_guard' },
]);

function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (!arg.startsWith('--')) continue;
    const [key, value] = arg.slice(2).split('=');
    options[key] = value ?? true;
  }
  return options;
}

function numberOption(value, fallback) {
  if (value == null) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createFighter(playerIndex, charId) {
  const charDef = CHARACTER_DEFS[charId];
  if (!charDef) throw new Error(`Unknown character '${charId}'`);
  const fighter = new FighterSim(playerIndex, charId, charDef);
  fighter.neuralTemporal = {};
  return fighter;
}

function resetController(controller) {
  resetControllerInstance(controller);
}

function stepController(controller, fighter, opponent, sim, dt) {
  controller.update(fighter, opponent, sim.frameCount, dt);
}

function runSingleRound(leftChar, rightChar, leftController, rightController, roundNumber = 1) {
  const fighter1 = createFighter(0, leftChar);
  const fighter2 = createFighter(1, rightChar);
  const sim = new MatchSim({ fighter1, fighter2 });

  sim.startRound(undefined, { swapSides: roundNumber % 2 === 0 });
  resetController(leftController);
  resetController(rightController);

  let frames = 0;
  while (!sim.roundOver && frames < maxRoundFrames) {
    sim.step(FRAME_DURATION, {
      controller1: (fighter, opponent, innerSim, dt) => stepController(leftController, fighter, opponent, innerSim, dt),
      controller2: (fighter, opponent, innerSim, dt) => stepController(rightController, fighter, opponent, innerSim, dt),
    });
    frames++;
  }

  if (!sim.roundOver) return { winner: 0, timedOut: true };
  return { winner: sim.winner ?? 0, timedOut: false };
}

function runMatch(leftChar, rightChar, leftControllerFactory, rightControllerFactory) {
  const leftController = leftControllerFactory();
  const rightController = rightControllerFactory();

  let leftRounds = 0;
  let rightRounds = 0;
  let roundsPlayed = 0;
  let timedOut = false;

  while (leftRounds < ROUNDS_TO_WIN && rightRounds < ROUNDS_TO_WIN && roundsPlayed < MAX_MATCH_ROUNDS) {
    roundsPlayed++;
    const roundResult = runSingleRound(leftChar, rightChar, leftController, rightController, roundsPlayed);
    if (roundResult.timedOut) {
      timedOut = true;
      break;
    }
    if (roundResult.winner === 1) leftRounds++;
    else if (roundResult.winner === 2) rightRounds++;
    else {
      timedOut = true;
      break;
    }
  }

  if (leftRounds > rightRounds) return { winner: 1, roundsPlayed, timedOut };
  if (rightRounds > leftRounds) return { winner: 2, roundsPlayed, timedOut };
  return { winner: 0, roundsPlayed, timedOut: true };
}

function initResult(label) {
  return {
    label,
    wins: 0,
    losses: 0,
    draws: 0,
    leftSeat: { wins: 0, losses: 0, draws: 0 },
    rightSeat: { wins: 0, losses: 0, draws: 0 },
  };
}

function applyOutcome(bucket, result, seat) {
  const key = result.winner === 1 ? 'wins' : result.winner === 2 ? 'losses' : 'draws';
  bucket[key]++;
  bucket[seat][key]++;
}

function evaluateOpponent(spec, repeats) {
  const result = initResult(spec.label);

  for (let repeat = 0; repeat < repeats; repeat++) {
    const left = runMatch(
        'spearman',
        spec.charId,
        () => createControllerFromSpec({ kind: 'planner', profile: 'spearman_hard_line' }),
        () => createControllerFromSpec(spec.profile),
      );
    applyOutcome(result, left, 'leftSeat');

    const right = runMatch(
        spec.charId,
        'spearman',
        () => createControllerFromSpec(spec.profile),
        () => createControllerFromSpec({ kind: 'planner', profile: 'spearman_hard_line' }),
      );
    const flipped = {
      winner: right.winner === 2 ? 1 : right.winner === 1 ? 2 : 0,
    };
    applyOutcome(result, flipped, 'rightSeat');
  }

  return result;
}

const options = parseArgs(process.argv.slice(2));
const repeats = numberOption(options.repeats, DEFAULT_REPEATS);
const roundSeconds = numberOption(options['round-seconds'], DEFAULT_ROUND_SECONDS);
const maxRoundFrames = Math.max(60, Math.round(roundSeconds / FRAME_DURATION));

const results = OPPONENTS.map((spec) => evaluateOpponent(spec, repeats));
const totals = results.reduce((acc, row) => {
  acc.wins += row.wins;
  acc.losses += row.losses;
  acc.draws += row.draws;
  return acc;
}, { wins: 0, losses: 0, draws: 0 });

const payload = {
  generatedAt: new Date().toISOString(),
  repeats,
  roundSeconds,
  controller: {
    charId: 'spearman',
    controllerKind: 'planner',
    profile: 'spearman_hard_line',
  },
  opponents: OPPONENTS,
  results,
  totals,
};

const stamp = payload.generatedAt.replace(/[:.]/g, '-');
const outPath = path.resolve('analysis', `spearman-planner-vs-best-${stamp}.json`);
ensureDir(outPath);
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

console.log(outPath);
console.log(`total: ${totals.wins}W/${totals.losses}L/${totals.draws}D`);
for (const row of results) {
  console.log(`${row.label}: ${row.wins}W/${row.losses}L/${row.draws}D`);
}
