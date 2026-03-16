#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ANALYSIS_DIR = path.join(ROOT, 'analysis');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getLatestResultPath() {
  const files = fs.readdirSync(ANALYSIS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({
      name,
      fullPath: path.join(ANALYSIS_DIR, name),
      time: fs.statSync(path.join(ANALYSIS_DIR, name)).mtimeMs,
    }))
    .sort((a, b) => b.time - a.time);

  if (!files.length) {
    throw new Error('No self-play result files found in analysis/.');
  }

  return files[0].fullPath;
}

function aggregateSides(matches, keyFn) {
  const map = new Map();

  for (const match of matches) {
    for (const sideName of ['p1', 'p2']) {
      const side = match.metrics[sideName];
      const key = keyFn(side);
      if (!map.has(key)) {
        map.set(key, {
          key,
          attacks: 0,
          whiffs: 0,
          sidesteps: 0,
          blocks: 0,
          parries: 0,
          cleanHits: 0,
          kills: 0,
          sidestepKills: 0,
          entries: 0,
        });
      }

      const row = map.get(key);
      row.entries++;
      row.attacks += side.attacksStarted;
      row.whiffs += side.attacksWhiffed;
      row.sidesteps += side.sidesteps;
      row.blocks += side.blocks;
      row.parries += side.parries;
      row.cleanHits += side.cleanHits;
      row.kills += side.kills;
      row.sidestepKills += side.sidestepKills;
    }
  }

  return [...map.values()].map((row) => ({
    ...row,
    whiffRate: row.attacks ? row.whiffs / row.attacks : 0,
    sidestepKillShare: row.kills ? row.sidestepKills / row.kills : 0,
  }));
}

function printRows(title, rows, formatter) {
  console.log(`\n${title}`);
  for (const row of rows) {
    console.log(formatter(row));
  }
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function main() {
  const target = process.argv[2] ? path.resolve(process.argv[2]) : getLatestResultPath();
  const data = readJson(target);
  const { summary, matches, config } = data;

  console.log(`File: ${target}`);
  console.log(`Matches: ${summary.totalMatches}, decisive: ${summary.decisiveMatches}, draws: ${summary.drawnMatches}`);
  console.log(`Config: repeats=${config.repeats}, maxRoundFrames=${config.maxRoundFrames}, roundsToWin=${config.roundsToWin}, maxMatchRounds=${config.maxMatchRounds}`);
  console.log(`Class wins: ${JSON.stringify(summary.classWins)}`);
  console.log(`Profile wins: ${JSON.stringify(summary.profileWins)}`);
  console.log(`Global whiff rate: ${pct(summary.globalMetrics.totalAttacks ? summary.globalMetrics.totalWhiffs / summary.globalMetrics.totalAttacks : 0)}`);
  console.log(`Global sidestep kill share: ${pct(summary.globalMetrics.totalKills ? summary.globalMetrics.sidestepKills / summary.globalMetrics.totalKills : 0)}`);

  const byProfileChar = aggregateSides(matches, (side) => `${side.profile}[${side.charId}]`)
    .sort((a, b) => b.kills - a.kills);
  const byChar = aggregateSides(matches, (side) => side.charId)
    .sort((a, b) => b.kills - a.kills);

  printRows('By profile/class', byProfileChar, (row) =>
    `${row.key.padEnd(18)} kills=${String(row.kills).padStart(3)} hits=${String(row.cleanHits).padStart(3)} whiff=${pct(row.whiffRate).padStart(6)} sidesteps=${String(row.sidesteps).padStart(4)} sidestepKills=${String(row.sidestepKills).padStart(3)} (${pct(row.sidestepKillShare)})`,
  );

  printRows('By class', byChar, (row) =>
    `${row.key.padEnd(10)} kills=${String(row.kills).padStart(3)} hits=${String(row.cleanHits).padStart(3)} whiff=${pct(row.whiffRate).padStart(6)} sidesteps=${String(row.sidesteps).padStart(4)} sidestepKills=${String(row.sidestepKills).padStart(3)} (${pct(row.sidestepKillShare)})`,
  );

  if (summary.findings.length) {
    printRows('Summary findings', summary.findings, (finding) => `- ${finding}`);
  }
}

main();
