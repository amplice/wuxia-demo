#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ANALYSIS_DIR = path.join(ROOT, 'analysis');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function getLatest(prefixes) {
  const files = fs.readdirSync(ANALYSIS_DIR)
    .filter((name) => name.endsWith('.json') && prefixes.some((prefix) => name.startsWith(prefix)))
    .map((name) => ({
      name,
      fullPath: path.join(ANALYSIS_DIR, name),
      time: fs.statSync(path.join(ANALYSIS_DIR, name)).mtimeMs,
    }))
    .sort((a, b) => b.time - a.time);
  if (!files.length) throw new Error(`No analysis file found for prefixes: ${prefixes.join(', ')}`);
  return files[0].fullPath;
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function analyzeSingleRun(data) {
  const matches = data.results ?? [];
  const totalMatches = matches.length;
  const winnerCounts = data.winnerCounts ?? {};
  const killReasons = data.aggregate?.killReasons ?? {};
  console.log(`File: ${process.argv[2] || 'latest online bot run'}`);
  console.log(`Mode: ${data.url}`);
  console.log(`Brains: p1=${data.p1Brain} p2=${data.p2Brain}`);
  console.log(`Profiles: p1=${data.p1Profile} p2=${data.p2Profile}`);
  console.log(`Chars: p1=${data.p1Char} p2=${data.p2Char}`);
  console.log(`Matches: ${totalMatches}`);
  console.log(`Winner counts: ${JSON.stringify(winnerCounts)}`);
  console.log(`Kill reasons: ${JSON.stringify(killReasons)}`);
  if (data.aggregate) {
    console.log(`Average scores: p1=${data.aggregate.averageScores?.player1 ?? 0} p2=${data.aggregate.averageScores?.player2 ?? 0}`);
    console.log(`Average last frame: ${data.aggregate.averageLastFrame ?? 0}`);
    console.log(`Bot errors: p1=${data.aggregate.bot1?.totalErrors ?? 0} p2=${data.aggregate.bot2?.totalErrors ?? 0}`);
  }
}

function analyzeMatrix(data) {
  console.log(`File: ${process.argv[2] || 'latest online bot matrix'}`);
  console.log(`Runs: ${data.aggregate?.totalRuns ?? 0}`);
  console.log(`Failures: ${data.aggregate?.failedRuns ?? 0}`);
  console.log(`Matches: ${data.aggregate?.totalMatches ?? 0}`);
  console.log(`Brain: ${data.brain}`);
  console.log(`Profiles: ${data.profiles.join(', ')}`);
  console.log(`Chars: ${data.chars.join(', ')}`);
  console.log(`Winner counts: ${JSON.stringify(data.aggregate?.winnerCounts ?? {})}`);
  console.log(`Kill reasons: ${JSON.stringify(data.aggregate?.killReasons ?? {})}`);

  const rows = [];
  for (const run of data.runs ?? []) {
    rows.push({
      key: `${run.p1Profile}[${run.p1Char}] vs ${run.p2Profile}[${run.p2Char}]`,
      p1Wins: run.winnerCounts?.player1 ?? 0,
      p2Wins: run.winnerCounts?.player2 ?? 0,
      avgP1: run.aggregate?.averageScores?.player1 ?? 0,
      avgP2: run.aggregate?.averageScores?.player2 ?? 0,
      avgFrames: run.aggregate?.averageLastFrame ?? 0,
    });
  }

  rows.sort((a, b) => (b.p1Wins + b.p2Wins) - (a.p1Wins + a.p2Wins));
  console.log('\nMatchups');
  for (const row of rows) {
    const total = Math.max(row.p1Wins + row.p2Wins, 1);
    console.log(`${row.key.padEnd(42)} wins ${row.p1Wins}-${row.p2Wins}  p1=${pct(row.p1Wins / total)}  avgScore=${row.avgP1.toFixed(2)}-${row.avgP2.toFixed(2)}  avgFrame=${row.avgFrames}`);
  }

  if ((data.failures?.length ?? 0) > 0) {
    console.log('\nFailures');
    for (const failure of data.failures) {
      console.log(`${`${failure.p1Profile}[${failure.p1Char}] vs ${failure.p2Profile}[${failure.p2Char}]`.padEnd(42)} ${failure.error.split('\n')[0]}`);
    }
  }
}

function main() {
  const target = process.argv[2]
    ? path.resolve(process.argv[2])
    : getLatest(['online-local-', 'online-live-', 'online-matrix-local-', 'online-matrix-live-']);
  const data = readJson(target);
  if (Array.isArray(data.runs)) {
    analyzeMatrix(data);
  } else {
    analyzeSingleRun(data);
  }
}

main();
