import { createControllerFromSpec, resetControllerInstance } from '../src/ai/ControllerSpec.js';
import { CHARACTER_DEFS } from '../src/entities/CharacterDefs.js';
import { FighterSim } from '../src/sim/FighterSim.js';
import { MatchSim } from '../src/sim/MatchSim.js';
import { FRAME_DURATION, ROUNDS_TO_WIN } from '../src/core/Constants.js';

const MAX_MATCH_ROUNDS = 7;
const DEFAULT_ROUND_SECONDS = 180;

const PROFILE_OPTIONS = Object.freeze({
  spearman: ['spearman_evasive', 'spearman_heavy_bully', 'spearman_aggressor', 'spearman_hard_line'],
  ronin: ['ronin_evasive', 'ronin_aggressor', 'ronin_lancer', 'ronin_duelist', 'ronin_hard_duelist'],
  knight: ['knight_duelist', 'knight_bulwark', 'knight_sentinel', 'knight_hard_guard'],
});

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
      controller1: (fighter, opponent, innerSim, dt) => leftController.update(fighter, opponent, innerSim.frameCount, dt),
      controller2: (fighter, opponent, innerSim, dt) => rightController.update(fighter, opponent, innerSim.frameCount, dt),
    });
    frames++;
  }

  if (!sim.roundOver) return 0;
  return sim.winner ?? 0;
}

function runMatch(leftChar, rightChar, leftProfile, rightProfile) {
  const leftController = createControllerFromSpec({ kind: 'planner', profile: leftProfile });
  const rightController = createControllerFromSpec({ kind: 'planner', profile: rightProfile });
  let leftRounds = 0;
  let rightRounds = 0;
  let roundsPlayed = 0;

  while (leftRounds < ROUNDS_TO_WIN && rightRounds < ROUNDS_TO_WIN && roundsPlayed < MAX_MATCH_ROUNDS) {
    roundsPlayed++;
    const winner = runSingleRound(leftChar, rightChar, leftController, rightController, roundsPlayed);
    if (winner === 1) leftRounds++;
    else if (winner === 2) rightRounds++;
    else break;
  }

  if (leftRounds > rightRounds) return 1;
  if (rightRounds > leftRounds) return 2;
  return 0;
}

function evaluatePair(leftChar, rightChar, leftProfile, rightProfile, repeats) {
  let leftWins = 0;
  let rightWins = 0;
  let draws = 0;

  for (let i = 0; i < repeats; i++) {
    const leftSeat = runMatch(leftChar, rightChar, leftProfile, rightProfile);
    if (leftSeat === 1) leftWins++;
    else if (leftSeat === 2) rightWins++;
    else draws++;

    const rightSeat = runMatch(rightChar, leftChar, rightProfile, leftProfile);
    if (rightSeat === 1) rightWins++;
    else if (rightSeat === 2) leftWins++;
    else draws++;
  }

  return { leftWins, rightWins, draws, total: repeats * 2 };
}

function scoreCombo(results) {
  let worstMargin = -Infinity;
  let drawPenalty = 0;
  let decisivePenalty = 0;

  for (const pair of results) {
    const margin = Math.abs(pair.leftWins - pair.rightWins);
    worstMargin = Math.max(worstMargin, margin);
    drawPenalty += Math.max(0, pair.draws - Math.floor(pair.total * 0.2));
    decisivePenalty += Math.max(0, Math.floor(pair.total * 0.5) - (pair.leftWins + pair.rightWins));
  }

  return {
    worstMargin,
    drawPenalty,
    decisivePenalty,
    totalScore: worstMargin * 100 + drawPenalty * 10 + decisivePenalty * 5,
  };
}

const options = parseArgs(process.argv.slice(2));
const repeats = numberOption(options.repeats, 4);
const topn = numberOption(options.topn, 12);
const roundSeconds = numberOption(options['round-seconds'], DEFAULT_ROUND_SECONDS);
const maxRoundFrames = Math.max(60, Math.round(roundSeconds / FRAME_DURATION));
const chars = ['spearman', 'ronin', 'knight'];
const pairs = [
  ['spearman', 'ronin'],
  ['spearman', 'knight'],
  ['ronin', 'knight'],
];

const ranked = [];

for (const spearmanProfile of PROFILE_OPTIONS.spearman) {
  for (const roninProfile of PROFILE_OPTIONS.ronin) {
    for (const knightProfile of PROFILE_OPTIONS.knight) {
      const profiles = {
        spearman: spearmanProfile,
        ronin: roninProfile,
        knight: knightProfile,
      };

      const results = pairs.map(([leftChar, rightChar]) => ({
        pair: `${leftChar}-${rightChar}`,
        ...evaluatePair(leftChar, rightChar, profiles[leftChar], profiles[rightChar], repeats),
      }));

      ranked.push({
        profiles,
        results,
        ...scoreCombo(results),
      });
    }
  }
}

ranked.sort((a, b) => a.totalScore - b.totalScore);

for (const entry of ranked.slice(0, topn)) {
  console.log(JSON.stringify(entry));
}
