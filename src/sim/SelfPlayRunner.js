import * as THREE from 'three';
import { Fighter } from '../entities/Fighter.js';
import { ModelLoader } from '../entities/ModelLoader.js';
import { CHARACTER_DEFS } from '../entities/CharacterDefs.js';
import { AIController } from '../ai/AIController.js';
import { HitResolver } from '../combat/HitResolver.js';
import { getBodyRadius, getImpactScale } from '../combat/CombatTuning.js';
import {
  FRAME_DURATION,
  FighterState,
  AttackType,
  HitResult,
  FIGHT_START_DISTANCE,
  ROUNDS_TO_WIN,
  ARENA_RADIUS,
  BLOCK_PUSHBACK_SPEED,
  KNOCKBACK_SLIDE_SPEED,
  HEAVY_ADVANTAGE_MULT,
  CLASH_PUSHBACK_FRAMES,
  BLOCK_STUN_FRAMES,
  HIT_STUN_FRAMES,
  PARRIED_STUN_FRAMES,
} from '../core/Constants.js';

const _pairBodyA = new THREE.Vector3();
const _pairBodyB = new THREE.Vector3();

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

export const DEFAULT_TOURNAMENT_CONFIG = Object.freeze({
  profiles: ['baseline', 'aggressor', 'turtler', 'duelist', 'evasive', 'punisher'],
  characters: ['spearman', 'ronin'],
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

    const matches = [];
    let seed = config.seedBase;

    for (const p1Profile of config.profiles) {
      for (const p2Profile of config.profiles) {
        for (const p1Char of config.characters) {
          for (const p2Char of config.characters) {
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
      const ai1 = new AIController(p1Profile);
      const ai2 = new AIController(p2Profile);

      const match = {
        seed,
        p1Profile,
        p2Profile,
        p1Char,
        p2Char,
        roundsToWin,
        p1Score: 0,
        p2Score: 0,
        winner: null,
        rounds: [],
        metrics: this._createMatchMetrics(p1Profile, p2Profile, p1Char, p2Char),
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
          p1Profile,
          p2Profile,
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

  _runRound({ fighter1, fighter2, ai1, ai2, roundIndex, maxRoundFrames, match, p1Profile, p2Profile, p1Char, p2Char }) {
    fighter1.resetForRound(-FIGHT_START_DISTANCE / 2);
    fighter2.resetForRound(FIGHT_START_DISTANCE / 2);
    ai1.reset();
    ai2.reset();

    const state = {
      frameCount: 0,
      hitstopFrames: 0,
      roundOver: false,
      winner: null,
      killReason: null,
      fighters: [fighter1, fighter2],
      trackers: new Map(),
      metrics: this._createRoundMetrics(roundIndex, p1Profile, p2Profile, p1Char, p2Char),
    };

    for (const fighter of state.fighters) {
      state.trackers.set(fighter, {
        prevState: fighter.state,
        prevHitApplied: fighter.hitApplied,
        lastSidestepFrame: -9999,
      });
    }

    for (let frame = 0; frame < maxRoundFrames && !state.roundOver; frame++) {
      state.frameCount++;
      match.metrics.totalFrames++;

      if (state.hitstopFrames > 0) {
        state.hitstopFrames--;
        this._recordStateTransitions(state, fighter1, fighter2);
        continue;
      }

      ai1.update(fighter1, fighter2, state.frameCount, FRAME_DURATION);
      ai2.update(fighter2, fighter1, state.frameCount, FRAME_DURATION);

      fighter1.update(FRAME_DURATION, fighter2);
      fighter2.update(FRAME_DURATION, fighter1);

      this._applyBlockPushback(fighter1, fighter2, state, FRAME_DURATION);
      this._applyBlockPushback(fighter2, fighter1, state, FRAME_DURATION);
      this._applyKnockbackSlide(fighter1, fighter2, FRAME_DURATION);
      this._enforceFighterSeparation(fighter1, fighter2);
      this._checkHits(state, fighter1, fighter2);
      fighter1.syncStatePresentation();
      fighter2.syncStatePresentation();
      this._checkRingOut(state, fighter1, fighter2);
      this._clampToArenaIfNeeded(fighter1);
      this._clampToArenaIfNeeded(fighter2);
      this._recordStateTransitions(state, fighter1, fighter2);
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
    };
  }

  _createFighter(playerIndex, charId) {
    const charDef = CHARACTER_DEFS[charId];
    const animData = this._charCache.get(charId);
    return new Fighter(playerIndex, playerIndex === 0 ? 0x991111 : 0x112266, charDef, animData);
  }

  _createMatchMetrics(p1Profile, p2Profile, p1Char, p2Char) {
    return {
      totalFrames: 0,
      resultCounts: { clash: 0, blocked: 0, parried: 0, clean_hit: 0 },
      p1: this._createSideMetrics(p1Profile, p1Char),
      p2: this._createSideMetrics(p2Profile, p2Char),
    };
  }

  _createSideMetrics(profile, charId) {
    return {
      profile,
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
      cleanHits: 0,
      kills: 0,
      deaths: 0,
      ringOutKills: 0,
      sidestepKills: 0,
      offAngleKills: 0,
    };
  }

  _createRoundMetrics(roundIndex, p1Profile, p2Profile, p1Char, p2Char) {
    return {
      roundIndex,
      timeout: false,
      resultCounts: { clash: 0, blocked: 0, parried: 0, clean_hit: 0 },
      p1: this._createSideMetrics(p1Profile, p1Char),
      p2: this._createSideMetrics(p2Profile, p2Char),
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
      }
      if (tracker.prevState === FighterState.ATTACK_ACTIVE && !tracker.prevHitApplied) {
        sideMetrics.attacksWhiffed++;
      }
      if (fighter.state === FighterState.SIDESTEP) {
        sideMetrics.sidesteps++;
        tracker.lastSidestepFrame = state.frameCount;
      }
      if (fighter.state === FighterState.DODGE) sideMetrics.backsteps++;
      if (fighter.state === FighterState.BLOCK) sideMetrics.blocks++;
      if (fighter.state === FighterState.PARRY) sideMetrics.parries++;
      if (fighter.state === FighterState.PARRY_SUCCESS) sideMetrics.parrySuccesses++;
      if (fighter.state === FighterState.CLASH) sideMetrics.clashes++;
    }

    tracker.prevState = fighter.state;
    tracker.prevHitApplied = fighter.hitApplied;
  }

  _applyBlockPushback(attacker, defender, state, dt) {
    if (!attacker.fsm.isAttacking) return;
    if (defender.state !== FighterState.BLOCK && defender.state !== FighterState.BLOCK_STUN) return;
    if (!this.hitResolver.checkWeaponOverlap(attacker, defender)) return;

    const { dx, dz, dist } = this._getFighterPairDelta(attacker, defender);

    if (defender.state === FighterState.BLOCK) {
      const isHeavy = attacker.fsm.currentAttackType === AttackType.HEAVY;
      const heavyBonus = isHeavy ? HEAVY_ADVANTAGE_MULT : 1;
      const mult = this._getImpactScale(attacker, defender, heavyBonus);
      defender.fsm.applyBlockStun(Math.round(BLOCK_STUN_FRAMES * mult));
      defender.knockbackMult = mult;
    }

    const nx = dx / (dist || 0.01);
    const nz = dz / (dist || 0.01);
    const pushbackScale = defender.knockbackMult || this._getImpactScale(attacker, defender);
    defender.position.x += nx * BLOCK_PUSHBACK_SPEED * pushbackScale * dt;
    defender.position.z += nz * BLOCK_PUSHBACK_SPEED * pushbackScale * dt;
  }

  _applyKnockbackSlide(a, b, dt) {
    const stunStates = [FighterState.CLASH, FighterState.HIT_STUN, FighterState.PARRIED_STUN, FighterState.BLOCK_STUN];
    const aStun = stunStates.includes(a.state);
    const bStun = stunStates.includes(b.state);
    if (!aStun && !bStun) return;

    const { dx, dz, dist } = this._getFighterPairDelta(a, b);
    const nx = dx / dist;
    const nz = dz / dist;

    if (aStun) {
      const slide = KNOCKBACK_SLIDE_SPEED * (a.knockbackMult || 1) * dt;
      a.position.x -= nx * slide;
      a.position.z -= nz * slide;
    }
    if (bStun) {
      const slide = KNOCKBACK_SLIDE_SPEED * (b.knockbackMult || 1) * dt;
      b.position.x += nx * slide;
      b.position.z += nz * slide;
    }
  }

  _checkHits(state, fighter1, fighter2) {
    if (
      fighter1.fsm.isAttacking &&
      fighter2.fsm.isAttacking &&
      !fighter1.hitApplied &&
      !fighter2.hitApplied &&
      this.hitResolver.checkWeaponClash(fighter1, fighter2)
    ) {
      this._applyResolvedHit(state, fighter1, fighter2, {
        result: HitResult.CLASH,
        attackerType: fighter1.fsm.currentAttackType,
        defenderType: fighter2.fsm.currentAttackType,
      });
      fighter1.hitApplied = true;
      fighter2.hitApplied = true;
      return;
    }

    if (fighter1.fsm.isAttacking && !fighter1.hitApplied) {
      if (this.hitResolver.checkSwordCollision(fighter1, fighter2)) {
        this._resolveHit(state, fighter1, fighter2);
        fighter1.hitApplied = true;
      }
    }

    if (fighter2.fsm.isAttacking && !fighter2.hitApplied) {
      if (this.hitResolver.checkSwordCollision(fighter2, fighter1)) {
        this._resolveHit(state, fighter2, fighter1);
        fighter2.hitApplied = true;
      }
    }
  }

  _resolveHit(state, attacker, defender) {
    const result = this.hitResolver.resolve(attacker, defender);
    this._applyResolvedHit(state, attacker, defender, result);
  }

  _applyResolvedHit(state, attacker, defender, result) {
    const attackerMetrics = attacker.playerIndex === 0 ? state.metrics.p1 : state.metrics.p2;
    const defenderMetrics = defender.playerIndex === 0 ? state.metrics.p1 : state.metrics.p2;
    state.metrics.resultCounts[result.result] = (state.metrics.resultCounts[result.result] || 0) + 1;

    switch (result.result) {
      case HitResult.CLASH: {
        const atkType = result.attackerType;
        const defType = result.defenderType;
        const atkHeavy = atkType === AttackType.HEAVY;
        const defHeavy = defType === AttackType.HEAVY;
        const atkHeavyBonus = (defHeavy && !atkHeavy) ? HEAVY_ADVANTAGE_MULT : 1;
        const defHeavyBonus = (atkHeavy && !defHeavy) ? HEAVY_ADVANTAGE_MULT : 1;
        const atkMult = this._getImpactScale(defender, attacker, atkHeavyBonus);
        const defMult = this._getImpactScale(attacker, defender, defHeavyBonus);
        attacker.fsm.applyClash(Math.round(CLASH_PUSHBACK_FRAMES * atkMult));
        defender.fsm.applyClash(Math.round(CLASH_PUSHBACK_FRAMES * defMult));
        attacker.knockbackMult = atkMult;
        defender.knockbackMult = defMult;
        state.hitstopFrames = 5;
        attackerMetrics.clashes++;
        defenderMetrics.clashes++;
        break;
      }
      case HitResult.WHIFF:
        break;
      case HitResult.PARRIED: {
        const parryMult = this._getImpactScale(defender, attacker);
        attacker.fsm.applyParriedStun(Math.round(PARRIED_STUN_FRAMES * parryMult));
        attacker.knockbackMult = parryMult;
        defender.fsm.applyParrySuccess();
        state.hitstopFrames = 8;
        defenderMetrics.parrySuccesses++;
        break;
      }
      case HitResult.BLOCKED: {
        const isHeavy = result.attackerType === AttackType.HEAVY;
        const heavyBonus = isHeavy ? HEAVY_ADVANTAGE_MULT : 1;
        const blockMult = this._getImpactScale(attacker, defender, heavyBonus);
        attacker.fsm.applyBlockStun();
        defender.fsm.applyBlockStun(Math.round(BLOCK_STUN_FRAMES * blockMult));
        defender.knockbackMult = blockMult;
        state.hitstopFrames = 3;
        defenderMetrics.blockedHits++;
        break;
      }
      case HitResult.CLEAN_HIT: {
        const isKill = defender.damageSystem.applyDamage();
        const hitMult = this._getImpactScale(attacker, defender);
        defender.fsm.applyHitStun(Math.round(HIT_STUN_FRAMES * hitMult));
        defender.knockbackMult = hitMult;
        attackerMetrics.cleanHits++;
        state.hitstopFrames = 6;
        if (isKill) {
          this._onKill(state, attacker, defender, 'clean_hit');
        }
        break;
      }
    }
  }

  _onKill(state, killer, victim, reason) {
    if (state.roundOver) return;
    state.roundOver = true;
    state.winner = killer.playerIndex + 1;
    state.killReason = reason;

    const killerMetrics = killer.playerIndex === 0 ? state.metrics.p1 : state.metrics.p2;
    const victimMetrics = victim.playerIndex === 0 ? state.metrics.p1 : state.metrics.p2;
    const killerTracker = state.trackers.get(killer);
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
  }

  _checkRingOut(state, fighterA, fighterB) {
    const checkFighter = (fighter, otherFighter) => {
      const dist = Math.sqrt(fighter.position.x * fighter.position.x + fighter.position.z * fighter.position.z);
      if (dist > ARENA_RADIUS + 0.5 && fighter.state !== FighterState.DYING && fighter.state !== FighterState.DEAD) {
        fighter.damageSystem.applyDamage();
        this._onKill(state, otherFighter, fighter, 'ring_out');
      }
    };

    checkFighter(fighterA, fighterB);
    checkFighter(fighterB, fighterA);
  }

  _clampToArenaIfNeeded(fighter) {
    const noClamp = (s) =>
      s === FighterState.BLOCK ||
      s === FighterState.BLOCK_STUN ||
      s === FighterState.CLASH ||
      s === FighterState.HIT_STUN ||
      s === FighterState.PARRIED_STUN;

    if (noClamp(fighter.state)) return;

    const dist = Math.sqrt(fighter.position.x * fighter.position.x + fighter.position.z * fighter.position.z);
    if (dist > ARENA_RADIUS - 0.3) {
      const scale = (ARENA_RADIUS - 0.3) / dist;
      fighter.position.x *= scale;
      fighter.position.z *= scale;
    }
  }

  _enforceFighterSeparation(a, b) {
    const minDist = getBodyRadius(a.charDef) + getBodyRadius(b.charDef);
    const { dx, dz, dist } = this._getFighterPairDelta(a, b);
    if (dist < minDist) {
      const overlap = (minDist - dist) / 2;
      const nx = dx / dist;
      const nz = dz / dist;
      a.position.x -= nx * overlap;
      a.position.z -= nz * overlap;
      b.position.x += nx * overlap;
      b.position.z += nz * overlap;
    }
  }

  _getFighterPairDelta(a, b) {
    a.getBodyCollisionPosition(_pairBodyA);
    b.getBodyCollisionPosition(_pairBodyB);

    let dx = _pairBodyB.x - _pairBodyA.x;
    let dz = _pairBodyB.z - _pairBodyA.z;
    let distSq = dx * dx + dz * dz;

    if (distSq < 1e-6) {
      dx = b.position.x - a.position.x;
      dz = b.position.z - a.position.z;
      distSq = dx * dx + dz * dz;
    }

    if (distSq < 1e-6) {
      dx = a.playerIndex < b.playerIndex ? 1 : -1;
      dz = 0;
      distSq = 1;
    }

    return { dx, dz, dist: Math.sqrt(distSq) };
  }

  _getImpactScale(attacker, defender, bonus = 1) {
    return getImpactScale(attacker?.charDef, defender?.charDef, bonus);
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
        cleanHits: 0,
        sidestepKills: 0,
        offAngleKills: 0,
        ringOutKills: 0,
        totalKills: 0,
        totalWhiffs: 0,
        totalAttacks: 0,
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
      summary.globalMetrics.cleanHits += match.metrics.resultCounts.clean_hit;

      for (const side of ['p1', 'p2']) {
        const metrics = match.metrics[side];
        summary.globalMetrics.sidestepKills += metrics.sidestepKills;
        summary.globalMetrics.offAngleKills += metrics.offAngleKills;
        summary.globalMetrics.ringOutKills += metrics.ringOutKills;
        summary.globalMetrics.totalKills += metrics.kills;
        summary.globalMetrics.totalWhiffs += metrics.attacksWhiffed;
        summary.globalMetrics.totalAttacks += metrics.attacksStarted;
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
