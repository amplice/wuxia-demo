import fs from 'node:fs';
import path from 'node:path';
import { CHARACTER_DEFS } from '../src/entities/CharacterDefs.js';
import { FighterSim } from '../src/sim/FighterSim.js';
import { MatchSim } from '../src/sim/MatchSim.js';
import { createControllerFromSpec, resetControllerInstance } from '../src/ai/ControllerSpec.js';
import { AI_PROFILE_LIBRARY } from '../src/ai/AIPersonality.js';
import { FRAME_DURATION, ROUNDS_TO_WIN } from '../src/core/Constants.js';

const DEFAULT_REPEATS = 1;
const MAX_MATCH_ROUNDS = 7;
const DEFAULT_ROUND_SECONDS = 180;

const SCRIPTED_ROSTER = Object.freeze([
  'knight:aggressor','knight:baseline','knight:counter_guard','knight:duelist','knight:evasive','knight:heavy_bully','knight:knight_bulwark','knight:knight_duelist','knight:knight_sentinel','knight:lancer','knight:punisher','knight:scrapper','knight:sentinel','knight:skirmisher','knight:turtler',
  'ronin:aggressor','ronin:baseline','ronin:counter_guard','ronin:duelist','ronin:evasive','ronin:heavy_bully','ronin:lancer','ronin:punisher','ronin:ronin_aggressor','ronin:ronin_duelist','ronin:ronin_evasive','ronin:ronin_lancer','ronin:scrapper','ronin:sentinel','ronin:skirmisher','ronin:turtler',
  'spearman:aggressor','spearman:baseline','spearman:counter_guard','spearman:duelist','spearman:evasive','spearman:heavy_bully','spearman:lancer','spearman:punisher','spearman:scrapper','spearman:sentinel','spearman:skirmisher','spearman:spearman_aggressor','spearman:spearman_evasive','spearman:spearman_heavy_bully','spearman:turtler',
].map((entry) => {
  const [opponentChar, opponentProfile] = entry.split(':');
  return { opponentChar, opponentProfile, label: entry };
}));

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

function evaluateProfileForChar(charId, profile, repeats) {
  const summary = {
    charId,
    profile,
    wins: 0,
    losses: 0,
    draws: 0,
    byOpponentChar: {},
    byOpponentProfile: {},
  };

  for (const spec of SCRIPTED_ROSTER) {
    for (let repeat = 0; repeat < repeats; repeat++) {
      const left = runMatch(
        charId,
        spec.opponentChar,
        () => createControllerFromSpec(profile),
        () => createControllerFromSpec(spec.opponentProfile),
      );
      const leftResult = left.winner === 1 ? 'wins' : left.winner === 2 ? 'losses' : 'draws';
      summary[leftResult]++;
      summary.byOpponentChar[spec.opponentChar] ??= { wins: 0, losses: 0, draws: 0 };
      summary.byOpponentChar[spec.opponentChar][leftResult]++;
      summary.byOpponentProfile[spec.label] ??= { wins: 0, losses: 0, draws: 0 };
      summary.byOpponentProfile[spec.label][leftResult]++;

      const right = runMatch(
        spec.opponentChar,
        charId,
        () => createControllerFromSpec(spec.opponentProfile),
        () => createControllerFromSpec(profile),
      );
      const rightResult = right.winner === 2 ? 'wins' : right.winner === 1 ? 'losses' : 'draws';
      summary[rightResult]++;
      summary.byOpponentChar[spec.opponentChar][rightResult]++;
      summary.byOpponentProfile[spec.label][rightResult]++;
    }
  }

  return summary;
}

const options = parseArgs(process.argv.slice(2));
const repeats = numberOption(options.repeats, DEFAULT_REPEATS);
const roundSeconds = numberOption(options['round-seconds'], DEFAULT_ROUND_SECONDS);
const maxRoundFrames = Math.max(60, Math.round(roundSeconds / FRAME_DURATION));
const chars = options.chars ? options.chars.split(',') : ['spearman', 'ronin', 'knight'];
const filterProfiles = options.profiles ? new Set(options.profiles.split(',')) : null;
const profiles = Object.keys(AI_PROFILE_LIBRARY).filter((name) => !filterProfiles || filterProfiles.has(name));

const results = [];
for (const charId of chars) {
  for (const profile of profiles) {
    results.push(evaluateProfileForChar(charId, profile, repeats));
  }
}

results.sort((a, b) => {
  if (b.wins !== a.wins) return b.wins - a.wins;
  if (a.losses !== b.losses) return a.losses - b.losses;
  return a.profile.localeCompare(b.profile);
});

const grouped = Object.fromEntries(chars.map((charId) => [charId, results.filter((entry) => entry.charId === charId)]));
const payload = {
  generatedAt: new Date().toISOString(),
  repeats,
  roundSeconds,
  profiles,
  chars,
  grouped,
};

const stamp = payload.generatedAt.replace(/[:.]/g, '-');
const outPath = path.resolve('analysis', `scripted-profile-sweep-${stamp}.json`);
ensureDir(outPath);
fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
console.log(outPath);
for (const charId of chars) {
  console.log(`\n[${charId}]`);
  for (const row of grouped[charId].slice(0, 8)) {
    console.log(`${row.profile}: ${row.wins}W/${row.losses}L/${row.draws}D`);
  }
}
