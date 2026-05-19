import { Fighter } from '../entities/Fighter.js';
import { ModelLoader } from '../entities/ModelLoader.js';
import { CHARACTER_DEFS } from '../entities/CharacterDefs.js';
import { createControllerFromSpec, normalizeControllerSpec, resetControllerInstance } from '../ai/ControllerSpec.js';
import { AI_CLASS_PROFILE_SETS } from '../ai/AIPersonality.js';
import { HitResolver } from '../combat/HitResolver.js';
import { MatchSim } from './MatchSim.js';
import {
  FRAME_DURATION,
  FighterState,
  HitResult,
  FIGHT_START_DISTANCE,
  ROUNDS_TO_WIN,
} from '../core/Constants.js';


function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function withSeededRandom(seed, fn) {
  const originalRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function summarizeRecentEvents(events = []) {
  return events.map((event) => ({
    frame: event.frame,
    kind: event.kind,
    actor: event.actor,
    result: event.result ?? null,
    attackType: event.attackType ?? null,
    otherAttackType: event.otherAttackType ?? null,
    opponent: event.opponent ?? null,
  }));
}

function classifyKillSetup(trace) {
  const context = trace?.killer?.context;
  if (!context) return 'unknown';
  if (trace.reason === 'ring_out') return 'ring_out';
  if (context.parrySuccessFramesAgo != null && context.parrySuccessFramesAgo <= 45) return 'parry_punish';
  if (
    context.clashFramesAgo != null &&
    context.lastAttackStartedAfterClash &&
    context.attackStartedWithinClashWindow
  ) return 'clash_followup';
  if (context.sidestepFramesAgo != null && context.sidestepFramesAgo <= 45) return 'sidestep_followup';
  if (context.backstepFramesAgo != null && context.backstepFramesAgo <= 45) return 'backstep_followup';
  return 'neutral';
}

export const DEFAULT_TOURNAMENT_CONFIG = Object.freeze({
  profiles: ['baseline', 'aggressor', 'turtler', 'duelist', 'evasive', 'punisher'],
  characters: Object.keys(CHARACTER_DEFS),
  classProfileSets: null,
  roundsToWin: ROUNDS_TO_WIN,
  repeats: 1,
  maxRoundFrames: 60 * 25,
  maxMatchRounds: 9,
  seedBase: 1337,
  includeMirrorMatches: false,
});

export class SelfPlayRunner {
  constructor() {
    this.hitResolver = new HitResolver();
    this._charCache = new Map();
  }

  async preloadCharacters(ids = Object.keys(CHARACTER_DEFS)) {
    for (const id of ids) {
      if (this._charCache.has(id)) continue;
      const def = CHARACTER_DEFS[id];
      if (!def) throw new Error(`Unknown character '${id}'`);
      const data = await ModelLoader.loadCharacter(def);
      this._charCache.set(id, data);
    }
  }

  async runTournament(options = {}) {
    const config = { ...DEFAULT_TOURNAMENT_CONFIG };
    for (const [key, value] of Object.entries(options)) {
      if (value !== undefined) config[key] = value;
    }
    console.log('[selfplay] preload start', config.characters);
    await this.preloadCharacters(config.characters);
    console.log('[selfplay] preload done');

    const classProfileSets = config.classProfileSets === 'default'
      ? AI_CLASS_PROFILE_SETS
      : config.classProfileSets;

    const matches = [];
    let seed = config.seedBase;

    for (const p1Char of config.characters) {
      const p1Profiles = classProfileSets?.[p1Char] || config.profiles;
      for (const p2Char of config.characters) {
        const p2Profiles = classProfileSets?.[p2Char] || config.profiles;
        for (const p1Profile of p1Profiles) {
          for (const p2Profile of p2Profiles) {
            for (let repeat = 0; repeat < config.repeats; repeat++) {
              const match = await this.runMatch({
                p1Profile,
                p2Profile,
                p1Char,
                p2Char,
                roundsToWin: config.roundsToWin,
                maxRoundFrames: config.maxRoundFrames,
                maxMatchRounds: config.maxMatchRounds,
                seed: seed++,
              });
              matches.push(match);
              console.log('[selfplay] match done', p1Profile, p1Char, 'vs', p2Profile, p2Char, 'winner=', match.winner);

              if (config.includeMirrorMatches && (p1Profile !== p2Profile || p1Char !== p2Char)) {
                const mirrored = await this.runMatch({
                  p1Profile: p2Profile,
                  p2Profile: p1Profile,
                  p1Char: p2Char,
                  p2Char: p1Char,
                  roundsToWin: config.roundsToWin,
                  maxRoundFrames: config.maxRoundFrames,
                  maxMatchRounds: config.maxMatchRounds,
                  seed: seed++,
                });
                matches.push(mirrored);
              }
            }
          }
        }
      }
    }

    const summary = this._summarizeTournament(matches);
    return { config, matches, summary };
  }

  async runSeries(options = {}) {
    const {
      p1Profile = 'medium',
      p2Profile = 'medium',
      p1Char = 'spearman',
      p2Char = 'spearman',
      roundsToWin = ROUNDS_TO_WIN,
      repeats = 1,
      maxRoundFrames = 60 * 25,
      maxMatchRounds = 9,
      seedBase = 1337,
    } = options;

    await this.preloadCharacters([p1Char, p2Char]);

    const matches = [];
    for (let i = 0; i < repeats; i++) {
      const match = await this.runMatch({
        p1Profile,
        p2Profile,
        p1Char,
        p2Char,
        roundsToWin,
        maxRoundFrames,
        maxMatchRounds,
        seed: seedBase + i,
      });
      matches.push(match);
    }

    const config = {
      mode: 'series',
      p1Profile,
      p2Profile,
      p1Char,
      p2Char,
      roundsToWin,
      repeats,
      maxRoundFrames,
      maxMatchRounds,
      seedBase,
    };
    const summary = this._summarizeTournament(matches);
    return { config, matches, summary };
  }

  async runMatch(options) {
    const {
      p1Profile = 'medium',
      p2Profile = 'medium',
      p1Char = 'spearman',
      p2Char = 'spearman',
      roundsToWin = ROUNDS_TO_WIN,
      maxRoundFrames = 60 * 25,
      maxMatchRounds = 9,
      seed = 1,
    } = options;

    await this.preloadCharacters([p1Char, p2Char]);
    console.log('[selfplay] runMatch', p1Profile, p1Char, 'vs', p2Profile, p2Char, 'seed', seed);

    return withSeededRandom(seed, () => {
      const fighter1 = this._createFighter(0, p1Char);
      const fighter2 = this._createFighter(1, p2Char);
      const p1ControllerSpec = normalizeControllerSpec(p1Profile);
      const p2ControllerSpec = normalizeControllerSpec(p2Profile);
      const ai1 = createControllerFromSpec(p1ControllerSpec);
      const ai2 = createControllerFromSpec(p2ControllerSpec);

      const match = {
        seed,
        p1Profile: p1ControllerSpec.raw,
        p2Profile: p2ControllerSpec.raw,
        p1ControllerKind: p1ControllerSpec.kind,
        p2ControllerKind: p2ControllerSpec.kind,
        p1Char,
        p2Char,
        roundsToWin,
        p1Score: 0,
        p2Score: 0,
        winner: null,
        rounds: [],
        metrics: this._createMatchMetrics(p1ControllerSpec, p2ControllerSpec, p1Char, p2Char),
      };

      for (let roundIndex = 1; roundIndex <= maxMatchRounds; roundIndex++) {
        if (match.p1Score >= roundsToWin || match.p2Score >= roundsToWin) break;
        const round = this._runRound({
          fighter1,
          fighter2,
          ai1,
          ai2,
          roundIndex,
          maxRoundFrames,
          match,
          p1ControllerSpec,
          p2ControllerSpec,
          p1Char,
          p2Char,
        });
        match.rounds.push(round);
        if (round.winner === 1) match.p1Score++;
        if (round.winner === 2) match.p2Score++;
      }

      match.winner = match.p1Score === match.p2Score
        ? null
        : (match.p1Score > match.p2Score ? 1 : 2);

      return match;
    });
  }

  _runRound({ fighter1, fighter2, ai1, ai2, roundIndex, maxRoundFrames, match, p1ControllerSpec, p2ControllerSpec, p1Char, p2Char }) {
    const sim = new MatchSim({ fighter1, fighter2, hitResolver: this.hitResolver });
    sim.startRound(FIGHT_START_DISTANCE, { swapSides: (roundIndex + 1) % 2 === 0 });
    resetControllerInstance(ai1);
    resetControllerInstance(ai2);

    const state = {
      frameCount: 0,
      hitstopFrames: 0,
      roundOver: false,
      winner: null,
      killReason: null,
      fighters: [fighter1, fighter2],
      trackers: new Map(),
      metrics: this._createRoundMetrics(roundIndex, p1ControllerSpec, p2ControllerSpec, p1Char, p2Char),
    };

    for (const fighter of state.fighters) {
      state.trackers.set(fighter, {
        prevState: fighter.state,
        prevHitApplied: fighter.hitApplied,
        lastSidestepFrame: -9999,
        lastBackstepFrame: -9999,
        lastParryFrame: -9999,
        lastParrySuccessFrame: -9999,
        lastClashFrame: -9999,
        lastAttackStartFrame: -9999,
        lastAttackType: null,
        recentEvents: [],
      });
    }

    for (let frame = 0; frame < maxRoundFrames && !state.roundOver; frame++) {
      if (state.hitstopFrames > 0) {
        state.hitstopFrames--;
        state.frameCount = sim.frameCount;
        match.metrics.totalFrames++;
        this._recordStateTransitions(state, fighter1, fighter2);
        continue;
      }

      const step = sim.step(FRAME_DURATION, {
        controller1: (self, opponent, matchSim, dt) => ai1.update(self, opponent, matchSim.frameCount, dt),
        controller2: (self, opponent, matchSim, dt) => ai2.update(self, opponent, matchSim.frameCount, dt),
      });

      state.frameCount = step.frameCount;
      match.metrics.totalFrames++;
      this._consumeSimEvents(state, step.events);
      this._recordStateTransitions(state, fighter1, fighter2);

      if (step.roundOver) {
        const killer = step.winner === 1 ? fighter1 : fighter2;
        const victim = step.winner === 1 ? fighter2 : fighter1;
        this._onKill(state, killer, victim, step.killReason);
      }
    }

    if (!state.roundOver) {
      state.metrics.timeout = true;
    }

    this._mergeRoundMetrics(match.metrics, state.metrics);

    return {
      roundIndex,
      winner: state.winner,
      killReason: state.killReason,
      frames: state.frameCount,
      metrics: state.metrics,
      killTrace: state.killTrace ?? null,
    };
  }

  _createFighter(playerIndex, charId) {
    const charDef = CHARACTER_DEFS[charId];
    const animData = this._charCache.get(charId);
    const fighter = new Fighter(playerIndex, playerIndex === 0 ? 0x991111 : 0x112266, charDef, animData);
    fighter.charId = charId;
    return fighter;
  }

  _createMatchMetrics(p1ControllerSpec, p2ControllerSpec, p1Char, p2Char) {
    return {
      totalFrames: 0,
      resultCounts: { clash: 0, blocked: 0, parried: 0, lethal_hit: 0 },
      p1: this._createSideMetrics(p1ControllerSpec, p1Char),
      p2: this._createSideMetrics(p2ControllerSpec, p2Char),
    };
  }

  _createSideMetrics(controllerSpec, charId) {
    return {
      profile: controllerSpec.raw,
      controllerKind: controllerSpec.kind,
      controllerProfile: controllerSpec.profile,
      charId,
      attacksStarted: 0,
      attacksWhiffed: 0,
      attackTypes: { quick: 0, heavy: 0, thrust: 0 },
      sidesteps: 0,
      backsteps: 0,
      blocks: 0,
      parries: 0,
      clashes: 0,
      blockedHits: 0,
      parrySuccesses: 0,
      lethalHits: 0,
      kills: 0,
      deaths: 0,
      ringOutKills: 0,
      sidestepKills: 0,
      offAngleKills: 0,
    };
  }

  _createRoundMetrics(roundIndex, p1ControllerSpec, p2ControllerSpec, p1Char, p2Char) {
    return {
      roundIndex,
      timeout: false,
      resultCounts: { clash: 0, blocked: 0, parried: 0, lethal_hit: 0 },
      p1: this._createSideMetrics(p1ControllerSpec, p1Char),
      p2: this._createSideMetrics(p2ControllerSpec, p2Char),
      killTraces: [],
    };
  }

  _mergeRoundMetrics(matchMetrics, roundMetrics) {
    for (const key of Object.keys(roundMetrics.resultCounts)) {
      matchMetrics.resultCounts[key] += roundMetrics.resultCounts[key];
    }
    for (const side of ['p1', 'p2']) {
      const dst = matchMetrics[side];
      const src = roundMetrics[side];
      for (const [key, value] of Object.entries(src)) {
        if (key === 'attackTypes') {
          for (const [atk, count] of Object.entries(value)) {
            dst.attackTypes[atk] += count;
          }
        } else if (typeof value === 'number' && key in dst) {
          dst[key] += value;
        }
      }
    }
  }

  _consumeSimEvents(state, events) {
    for (const event of events) {
      if (event.hitstopFrames) {
        state.hitstopFrames = Math.max(state.hitstopFrames, event.hitstopFrames);
      }

      if (event.type === 'combat_result') {
        state.metrics.resultCounts[event.result] = (state.metrics.resultCounts[event.result] || 0) + 1;
        const attackerMetrics = event.attackerIndex === 0 ? state.metrics.p1 : state.metrics.p2;
        const defenderMetrics = event.defenderIndex === 0 ? state.metrics.p1 : state.metrics.p2;
        const attackerFighter = state.fighters[event.attackerIndex];
        const defenderFighter = state.fighters[event.defenderIndex];
        const attackerTracker = state.trackers.get(attackerFighter);
        const defenderTracker = state.trackers.get(defenderFighter);

        attackerTracker?.recentEvents.push({
          frame: state.frameCount,
          kind: 'combat_result',
          actor: event.attackerIndex + 1,
          opponent: event.defenderIndex + 1,
          result: event.result,
          attackType: event.attackerType ?? null,
          otherAttackType: event.defenderType ?? null,
        });
        defenderTracker?.recentEvents.push({
          frame: state.frameCount,
          kind: 'combat_result',
          actor: event.defenderIndex + 1,
          opponent: event.attackerIndex + 1,
          result: event.result,
          attackType: event.defenderType ?? null,
          otherAttackType: event.attackerType ?? null,
        });

        if (event.result === HitResult.PARRIED) {
          defenderMetrics.parrySuccesses++;
        } else if (event.result === HitResult.BLOCKED) {
          defenderMetrics.blockedHits++;
        } else if (event.result === HitResult.LETHAL_HIT) {
          attackerMetrics.lethalHits++;
        }
        continue;
      }

      if (event.type === 'ring_out') {
        const winnerFighter = state.fighters[event.winnerIndex];
        const loserFighter = state.fighters[event.loserIndex];
        state.trackers.get(winnerFighter)?.recentEvents.push({
          frame: state.frameCount,
          kind: 'ring_out',
          actor: event.winnerIndex + 1,
          opponent: event.loserIndex + 1,
        });
        state.trackers.get(loserFighter)?.recentEvents.push({
          frame: state.frameCount,
          kind: 'ring_out',
          actor: event.loserIndex + 1,
          opponent: event.winnerIndex + 1,
        });
      }
    }
  }

  _recordStateTransitions(state, fighter1, fighter2) {
    this._recordFighterTransitions(state, fighter1, state.metrics.p1);
    this._recordFighterTransitions(state, fighter2, state.metrics.p2);
  }

  _recordFighterTransitions(state, fighter, sideMetrics) {
      const tracker = state.trackers.get(fighter);
      if (!tracker) return;

    if (tracker.prevState !== fighter.state) {
      if (fighter.state === FighterState.ATTACK_ACTIVE) {
        sideMetrics.attacksStarted++;
        if (fighter.currentAttackType && fighter.currentAttackType in sideMetrics.attackTypes) {
          sideMetrics.attackTypes[fighter.currentAttackType]++;
        }
        tracker.lastAttackStartFrame = state.frameCount;
        tracker.lastAttackType = fighter.currentAttackType ?? null;
        tracker.recentEvents.push({
          frame: state.frameCount,
          kind: 'attack_start',
          actor: fighter.playerIndex + 1,
          attackType: fighter.currentAttackType ?? null,
          opponent: fighter.playerIndex === 0 ? 2 : 1,
        });
      }
      if (tracker.prevState === FighterState.ATTACK_ACTIVE && !tracker.prevHitApplied) {
        sideMetrics.attacksWhiffed++;
      }
      if (fighter.state === FighterState.SIDESTEP) {
        sideMetrics.sidesteps++;
        tracker.lastSidestepFrame = state.frameCount;
        tracker.recentEvents.push({
          frame: state.frameCount,
          kind: 'sidestep',
          actor: fighter.playerIndex + 1,
          opponent: fighter.playerIndex === 0 ? 2 : 1,
        });
      }
      if (fighter.state === FighterState.DODGE) {
        sideMetrics.backsteps++;
        tracker.lastBackstepFrame = state.frameCount;
        tracker.recentEvents.push({
          frame: state.frameCount,
          kind: 'backstep',
          actor: fighter.playerIndex + 1,
          opponent: fighter.playerIndex === 0 ? 2 : 1,
        });
      }
      if (fighter.state === FighterState.BLOCK) {
        sideMetrics.blocks++;
      }
      if (fighter.state === FighterState.PARRY) {
        sideMetrics.parries++;
        tracker.lastParryFrame = state.frameCount;
        tracker.recentEvents.push({
          frame: state.frameCount,
          kind: 'parry_start',
          actor: fighter.playerIndex + 1,
          opponent: fighter.playerIndex === 0 ? 2 : 1,
        });
      }
      if (fighter.state === FighterState.PARRY_SUCCESS) {
        sideMetrics.parrySuccesses++;
        tracker.lastParrySuccessFrame = state.frameCount;
        tracker.recentEvents.push({
          frame: state.frameCount,
          kind: 'parry_success',
          actor: fighter.playerIndex + 1,
          opponent: fighter.playerIndex === 0 ? 2 : 1,
        });
      }
      if (fighter.state === FighterState.CLASH) {
        sideMetrics.clashes++;
        tracker.lastClashFrame = state.frameCount;
        tracker.lastClashDurationFrames = fighter.fsm.stateDuration ?? null;
        tracker.recentEvents.push({
          frame: state.frameCount,
          kind: 'clash_state',
          actor: fighter.playerIndex + 1,
          opponent: fighter.playerIndex === 0 ? 2 : 1,
        });
      }
    }

    tracker.recentEvents = tracker.recentEvents.filter((event) => (state.frameCount - event.frame) <= 180);

    tracker.prevState = fighter.state;
    tracker.prevHitApplied = fighter.hitApplied;
  }






  _onKill(state, killer, victim, reason) {
    if (state.roundOver) return;
    state.roundOver = true;
    state.winner = killer.playerIndex + 1;
    state.killReason = reason;

    const killerMetrics = killer.playerIndex === 0 ? state.metrics.p1 : state.metrics.p2;
    const victimMetrics = victim.playerIndex === 0 ? state.metrics.p1 : state.metrics.p2;
    const killerTracker = state.trackers.get(killer);
    const victimTracker = state.trackers.get(victim);
    killerMetrics.kills++;
    victimMetrics.deaths++;

    if (reason === 'ring_out') {
      killerMetrics.ringOutKills++;
    }
    if (killerTracker && (state.frameCount - killerTracker.lastSidestepFrame) <= 45) {
      killerMetrics.sidestepKills++;
    }
    if (this._getFacingDot(killer, victim) < 0.55) {
      killerMetrics.offAngleKills++;
    }

    const killTrace = {
      frame: state.frameCount,
      winner: state.winner,
      reason,
      killer: {
        player: killer.playerIndex + 1,
        charId: killer.charId,
        profile: killerMetrics.profile,
        attackType: killer.currentAttackType ?? killerTracker?.lastAttackType ?? null,
        state: killer.state,
        recentEvents: summarizeRecentEvents(killerTracker?.recentEvents ?? []),
        context: {
          sidestepFramesAgo: killerTracker ? state.frameCount - killerTracker.lastSidestepFrame : null,
          backstepFramesAgo: killerTracker ? state.frameCount - killerTracker.lastBackstepFrame : null,
          parrySuccessFramesAgo: killerTracker ? state.frameCount - killerTracker.lastParrySuccessFrame : null,
          clashFramesAgo: killerTracker ? state.frameCount - killerTracker.lastClashFrame : null,
          attackStartFramesAgo: killerTracker ? state.frameCount - killerTracker.lastAttackStartFrame : null,
          lastAttackStartedAfterClash: killerTracker
            ? killerTracker.lastAttackStartFrame >= killerTracker.lastClashFrame
            : false,
          attackStartedWithinClashWindow: killerTracker
            ? (
              killerTracker.lastAttackStartFrame >= killerTracker.lastClashFrame &&
              killerTracker.lastAttackStartFrame <= (killerTracker.lastClashFrame + (killerTracker.lastClashDurationFrames ?? 0) + 2)
            )
            : false,
          offAngle: this._getFacingDot(killer, victim) < 0.55,
        },
      },
      victim: {
        player: victim.playerIndex + 1,
        charId: victim.charId,
        profile: victimMetrics.profile,
        state: victim.state,
        recentEvents: summarizeRecentEvents(victimTracker?.recentEvents ?? []),
        context: {
          sidestepFramesAgo: victimTracker ? state.frameCount - victimTracker.lastSidestepFrame : null,
          backstepFramesAgo: victimTracker ? state.frameCount - victimTracker.lastBackstepFrame : null,
          parrySuccessFramesAgo: victimTracker ? state.frameCount - victimTracker.lastParrySuccessFrame : null,
          clashFramesAgo: victimTracker ? state.frameCount - victimTracker.lastClashFrame : null,
        },
      },
    };
    state.killTrace = killTrace;
    state.metrics.killTraces.push(killTrace);
  }






  _getFacingDot(attacker, defender) {
    const self = attacker.getBodyCollisionPosition();
    const other = defender.getBodyCollisionPosition();
    const dx = other.x - self.x;
    const dz = other.z - self.z;
    const len = Math.max(Math.hypot(dx, dz), 1e-5);
    const nx = dx / len;
    const nz = dz / len;
    const forwardX = Math.sin(attacker.group.rotation.y);
    const forwardZ = Math.cos(attacker.group.rotation.y);
    return forwardX * nx + forwardZ * nz;
  }

  _summarizeTournament(matches) {
    const summary = {
      totalMatches: matches.length,
      decisiveMatches: 0,
      drawnMatches: 0,
      classWins: {},
      profileWins: {},
      globalMetrics: {
        clashes: 0,
        blocked: 0,
        parried: 0,
        lethalHits: 0,
        sidestepKills: 0,
        offAngleKills: 0,
        ringOutKills: 0,
        totalKills: 0,
        totalWhiffs: 0,
        totalAttacks: 0,
      },
      killTraceSummary: {
        byAttackType: {},
        byClassAttackType: {},
        bySetup: {},
        byClassSetup: {},
        byClassAttackSetup: {},
        byClassMatchup: {},
      },
      roundOutcomeSummary: {
        byReason: {},
        byMatchup: {},
        byClassMatchup: {},
      },
      matchupRecords: {},
      findings: [],
    };

    for (const match of matches) {
      const p1Win = match.winner === 1;
      const p2Win = match.winner === 2;
      if (match.winner == null) {
        summary.drawnMatches++;
      } else {
        summary.decisiveMatches++;
      }

      if (p1Win) {
        summary.classWins[match.p1Char] = (summary.classWins[match.p1Char] || 0) + 1;
        summary.profileWins[match.p1Profile] = (summary.profileWins[match.p1Profile] || 0) + 1;
      }
      if (p2Win) {
        summary.classWins[match.p2Char] = (summary.classWins[match.p2Char] || 0) + 1;
        summary.profileWins[match.p2Profile] = (summary.profileWins[match.p2Profile] || 0) + 1;
      }

      summary.globalMetrics.clashes += match.metrics.resultCounts.clash;
      summary.globalMetrics.blocked += match.metrics.resultCounts.blocked;
      summary.globalMetrics.parried += match.metrics.resultCounts.parried;
      summary.globalMetrics.lethalHits += match.metrics.resultCounts.lethal_hit;

      for (const side of ['p1', 'p2']) {
        const metrics = match.metrics[side];
        summary.globalMetrics.sidestepKills += metrics.sidestepKills;
        summary.globalMetrics.offAngleKills += metrics.offAngleKills;
        summary.globalMetrics.ringOutKills += metrics.ringOutKills;
        summary.globalMetrics.totalKills += metrics.kills;
        summary.globalMetrics.totalWhiffs += metrics.attacksWhiffed;
        summary.globalMetrics.totalAttacks += metrics.attacksStarted;
      }

      for (const round of match.rounds) {
        const roundReason = round.killReason ?? (round.metrics?.timeout ? 'timeout' : 'unknown');
        const profileMatchup = `${match.p1Char}:${match.p1Profile} vs ${match.p2Char}:${match.p2Profile}`;
        const classMatchup = `${match.p1Char} vs ${match.p2Char}`;
        summary.roundOutcomeSummary.byReason[roundReason] = (summary.roundOutcomeSummary.byReason[roundReason] || 0) + 1;
        summary.roundOutcomeSummary.byMatchup[`${profileMatchup}:${roundReason}`] =
          (summary.roundOutcomeSummary.byMatchup[`${profileMatchup}:${roundReason}`] || 0) + 1;
        summary.roundOutcomeSummary.byClassMatchup[`${classMatchup}:${roundReason}`] =
          (summary.roundOutcomeSummary.byClassMatchup[`${classMatchup}:${roundReason}`] || 0) + 1;

        if (!round.killTrace) continue;
        const killerCharId = round.killTrace.killer.charId ?? 'unknown';
        const attackType = round.killTrace.killer.attackType ?? 'unknown';
        const classAttackType = `${killerCharId}:${attackType}`;
        const setup = classifyKillSetup(round.killTrace);
        const classSetup = `${killerCharId}:${setup}`;
        const classAttackSetup = `${killerCharId}:${attackType}:${setup}`;
        const matchup = `${killerCharId}->${round.killTrace.victim.charId}`;
        summary.killTraceSummary.byAttackType[attackType] = (summary.killTraceSummary.byAttackType[attackType] || 0) + 1;
        summary.killTraceSummary.byClassAttackType[classAttackType] = (summary.killTraceSummary.byClassAttackType[classAttackType] || 0) + 1;
        summary.killTraceSummary.bySetup[setup] = (summary.killTraceSummary.bySetup[setup] || 0) + 1;
        summary.killTraceSummary.byClassSetup[classSetup] = (summary.killTraceSummary.byClassSetup[classSetup] || 0) + 1;
        summary.killTraceSummary.byClassAttackSetup[classAttackSetup] = (summary.killTraceSummary.byClassAttackSetup[classAttackSetup] || 0) + 1;
        summary.killTraceSummary.byClassMatchup[matchup] = (summary.killTraceSummary.byClassMatchup[matchup] || 0) + 1;
      }

      const matchupKey = `${match.p1Char}:${match.p1Profile} vs ${match.p2Char}:${match.p2Profile}`;
      if (!summary.matchupRecords[matchupKey]) {
        summary.matchupRecords[matchupKey] = { matches: 0, p1Wins: 0, p2Wins: 0, draws: 0 };
      }
      const record = summary.matchupRecords[matchupKey];
      record.matches++;
      if (p1Win) record.p1Wins++;
      else if (p2Win) record.p2Wins++;
      else record.draws++;
    }

    const decisive = Math.max(summary.decisiveMatches, 1);
    const classEntries = Object.entries(summary.classWins).sort((a, b) => b[1] - a[1]);
    if (classEntries.length >= 2) {
      const [bestClass, bestWins] = classEntries[0];
      const [, nextWins] = classEntries[1];
      const share = bestWins / decisive;
      if (share > 0.58 && bestWins - nextWins >= 5) {
        summary.findings.push(`${bestClass} appears advantaged in self-play (${(share * 100).toFixed(1)}% of decisive wins).`);
      }
    }

    const sidestepKillShare = summary.globalMetrics.totalKills > 0
      ? summary.globalMetrics.sidestepKills / summary.globalMetrics.totalKills
      : 0;
    if (sidestepKillShare > 0.28) {
      summary.findings.push(`Sidestep follow-up kills are frequent (${(sidestepKillShare * 100).toFixed(1)}% of kills), which suggests sidestep angle-taking may still be too rewarding.`);
    }

    const offAngleKillShare = summary.globalMetrics.totalKills > 0
      ? summary.globalMetrics.offAngleKills / summary.globalMetrics.totalKills
      : 0;
    if (offAngleKillShare > 0.2) {
      summary.findings.push(`Off-angle kills remain common (${(offAngleKillShare * 100).toFixed(1)}% of kills), which points to ongoing AI facing/positioning weaknesses.`);
    }

    const whiffRate = summary.globalMetrics.totalAttacks > 0
      ? summary.globalMetrics.totalWhiffs / summary.globalMetrics.totalAttacks
      : 0;
    if (whiffRate > 0.45) {
      summary.findings.push(`Attack whiff rate is high (${(whiffRate * 100).toFixed(1)}%), which suggests the AI is still over-committing or choosing poor ranges.`);
    }

    return summary;
  }
}

