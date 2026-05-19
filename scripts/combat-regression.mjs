#!/usr/bin/env node
import assert from 'node:assert/strict';

import { FighterSim } from '../src/sim/FighterSim.js';
import { MatchSim } from '../src/sim/MatchSim.js';
import { HitResolver } from '../src/combat/HitResolver.js';
import { CHARACTER_DEFS } from '../src/entities/CharacterDefs.js';
import { getImpactSlideScale, getImpactStunScale } from '../src/combat/CombatTuning.js';
import { AUTHORITATIVE_TRACKS } from '../src/data/authoritativeTracks.js';
import {
  AttackType,
  FighterState,
  HitResult,
  ARENA_RADIUS,
  BLOCK_STUN_FRAMES,
  CLASH_PUSHBACK_FRAMES,
  FRAME_DURATION,
  HEAVY_CLASH_STUN_MULT,
  HEAVY_CLASH_WINNER_STUN_MULT,
  PARRIED_STUN_FRAMES,
  PARRY_WINDOW_FRAMES,
} from '../src/core/Constants.js';

const ATTACK_CLIPS = {
  [AttackType.QUICK]: 'attack_quick',
  [AttackType.HEAVY]: 'attack_heavy',
  [AttackType.THRUST]: 'attack_thrust',
};

function createFighter(charId, playerIndex) {
  return new FighterSim(playerIndex, charId, CHARACTER_DEFS[charId]);
}

function setAttackState(fighter, attackType) {
  fighter.fsm.transition(FighterState.ATTACK_ACTIVE, fighter._getAttackFrameCount(attackType));
  fighter.fsm.currentAttackType = attackType;
  fighter.fsm.currentAttackData = fighter.charDef.attackData[attackType];
  fighter.fsm.stateFrames = 1;
}

function approxEqual(actual, expected, epsilon = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${expected}, got ${actual}`,
  );
}

function testParryWindow() {
  const resolver = new HitResolver();
  const attacker = createFighter('knight', 0);
  const defender = createFighter('spearman', 1);
  setAttackState(attacker, AttackType.HEAVY);

  defender.fsm.transition(FighterState.PARRY, PARRY_WINDOW_FRAMES + 5);
  defender.fsm.stateFrames = PARRY_WINDOW_FRAMES;
  assert.equal(resolver.resolve(attacker, defender).result, HitResult.PARRIED, 'true parry window should parry');

  defender.fsm.transition(FighterState.PARRY, PARRY_WINDOW_FRAMES + 5);
  defender.fsm.stateFrames = PARRY_WINDOW_FRAMES + 1;
  assert.equal(resolver.resolve(attacker, defender).result, HitResult.BLOCKED, 'post-window parry fallback should block');

  defender.fsm.transition(FighterState.BLOCK, BLOCK_STUN_FRAMES);
  defender.fsm.stateFrames = 1;
  assert.equal(resolver.resolve(attacker, defender).result, HitResult.BLOCKED, 'active block should block');
}

function testParriedStunScaling() {
  const sim = new MatchSim({
    fighter1: createFighter('ronin', 0),
    fighter2: createFighter('knight', 1),
  });
  const attacker = sim.fighter1;
  const defender = sim.fighter2;

  sim._applyResolvedHit(attacker, defender, {
    result: HitResult.PARRIED,
    attackerType: AttackType.HEAVY,
  });

  const expectedBase = Math.round(PARRIED_STUN_FRAMES * 0.9);
  const expectedFrames = Math.round(
    expectedBase * getImpactStunScale(defender.charDef, attacker.charDef, 1),
  );
  assert.equal(attacker.state, FighterState.PARRIED_STUN, 'parried attacker should enter parried stun');
  assert.equal(attacker.fsm.stateDuration, expectedFrames, 'heavy parry stun should follow attack/class scaling');
}

function testClashResolution() {
  const sim = new MatchSim({
    fighter1: createFighter('knight', 0),
    fighter2: createFighter('ronin', 1),
  });
  const knight = sim.fighter1;
  const ronin = sim.fighter2;
  setAttackState(knight, AttackType.HEAVY);
  setAttackState(ronin, AttackType.QUICK);
  const knightAdv = knight.charDef.attackData[AttackType.HEAVY].clashAdvantage;

  sim._applyResolvedHit(knight, ronin, {
    result: HitResult.CLASH,
    attackerType: AttackType.HEAVY,
    defenderType: AttackType.QUICK,
  });

  const expectedKnightFrames = Math.round(
    CLASH_PUSHBACK_FRAMES * getImpactStunScale(ronin.charDef, knight.charDef, knightAdv?.selfStunMult ?? HEAVY_CLASH_WINNER_STUN_MULT),
  );
  const expectedRoninFrames = Math.round(
    CLASH_PUSHBACK_FRAMES * getImpactStunScale(knight.charDef, ronin.charDef, knightAdv?.targetStunMult ?? HEAVY_CLASH_STUN_MULT),
  );

  assert.equal(knight.state, FighterState.CLASH, 'knight should enter clash stun');
  assert.equal(ronin.state, FighterState.CLASH, 'ronin should enter clash stun');
  assert.equal(knight.fsm.stateDuration, expectedKnightFrames, 'knight clash self stun should match authored advantage');
  assert.equal(ronin.fsm.stateDuration, expectedRoninFrames, 'ronin clash target stun should match authored disadvantage');
  assert.ok(knight.fsm.stateDuration < ronin.fsm.stateDuration, 'heavy-vs-non-heavy clash should favor the heavy side');
}

function testBlockPushDistance() {
  const sim = new MatchSim({
    fighter1: createFighter('knight', 0),
    fighter2: createFighter('spearman', 1),
  });
  const knight = sim.fighter1;
  const spearman = sim.fighter2;
  setAttackState(knight, AttackType.HEAVY);
  const attackBlockPush = knight.charDef.attackData[AttackType.HEAVY].blockPush;

  sim._applyResolvedHit(knight, spearman, {
    result: HitResult.BLOCKED,
    attackerType: AttackType.HEAVY,
  });

  const expectedPush = attackBlockPush * getImpactSlideScale(knight.charDef, spearman.charDef, 1);
  approxEqual(spearman.blockPushRemaining, expectedPush);
  assert.equal(spearman.state, FighterState.BLOCK_STUN, 'blocked defender should enter block stun');
}

function testRingOutResolution() {
  const sim = new MatchSim({
    fighter1: createFighter('spearman', 0),
    fighter2: createFighter('knight', 1),
  });
  sim.startRound();
  sim.fighter1.position.set(ARENA_RADIUS + 1.0, 0, 0);
  sim._checkRingOut();

  assert.equal(sim.roundOver, true, 'ring-out should end the round');
  assert.equal(sim.winner, 2, 'ring-out should award the round to the opponent');
  assert.equal(sim.killReason, 'ring_out', 'ring-out should report the correct kill reason');
}

function testAuthoritativeTrackSync() {
  for (const [charId, charDef] of Object.entries(CHARACTER_DEFS)) {
    const authoritative = AUTHORITATIVE_TRACKS.characters?.[charId];
    assert.ok(authoritative, `missing authoritative track bundle for ${charId}`);
    for (const attackType of Object.values(AttackType)) {
      const clipName = ATTACK_CLIPS[attackType];
      const clip = authoritative.clips?.[clipName];
      assert.ok(clip?.frameCount, `missing authoritative clip ${clipName} for ${charId}`);
      assert.equal(
        new FighterSim(0, charId, charDef)._getAttackFrameCount(attackType),
        clip.frameCount,
        `${charId} ${attackType} sim attack duration should come from authoritative tracks`,
      );
    }
  }
}

function testContactWindows() {
  for (const [charId, charDef] of Object.entries(CHARACTER_DEFS)) {
    for (const attackType of Object.values(AttackType)) {
      const attack = charDef.attackData[attackType];
      const frames = new FighterSim(0, charId, charDef)._getAttackFrameCount(attackType);
      const startFrame = attack.contactStart * frames;
      const endFrame = attack.contactEnd * frames;
      assert.ok(startFrame >= 0, `${charId} ${attackType} contact start must be non-negative`);
      assert.ok(endFrame > startFrame, `${charId} ${attackType} contact window must be ordered`);
      assert.ok(endFrame <= frames + 1, `${charId} ${attackType} contact end must stay within the move duration`);
    }
  }
}

function testSimultaneousControllerScheduling() {
  const sim = new MatchSim({
    fighter1: createFighter('ronin', 0),
    fighter2: createFighter('ronin', 1),
  });
  sim.startRound();

  let controller1Calls = 0;
  let controller2Calls = 0;
  let controller2ObservedOpponentState = null;

  sim.step(FRAME_DURATION, {
    controller1: (fighter) => {
      controller1Calls++;
      fighter.attack(AttackType.QUICK);
    },
    controller2: (fighter, opponent) => {
      controller2Calls++;
      controller2ObservedOpponentState = opponent.state;
    },
  });

  assert.equal(controller1Calls, 1, 'controller1 should run once per frame');
  assert.equal(controller2Calls, 1, 'controller2 should run once per frame');
  assert.equal(
    controller2ObservedOpponentState,
    FighterState.IDLE,
    'controller2 should not see controller1 same-frame decisions',
  );
}

function testSimultaneousBodyHitsClash() {
  const hitResolver = {
    checkWeaponClash: () => false,
    checkSwordCollision: () => true,
    resolve: () => {
      throw new Error('mutual body hits should resolve as a clash before one-sided resolve');
    },
  };
  const sim = new MatchSim({
    fighter1: createFighter('huscarl', 0),
    fighter2: createFighter('huscarl', 1),
    hitResolver,
  });

  setAttackState(sim.fighter1, AttackType.QUICK);
  setAttackState(sim.fighter2, AttackType.QUICK);
  sim._checkHits();

  assert.equal(sim.fighter1.hitApplied, true, 'fighter1 mutual body hit should be consumed');
  assert.equal(sim.fighter2.hitApplied, true, 'fighter2 mutual body hit should be consumed');
  assert.equal(sim.events[0]?.result, HitResult.CLASH, 'mutual same-frame body hits should clash');
}

const TESTS = [
  ['parry window', testParryWindow],
  ['parried stun scaling', testParriedStunScaling],
  ['clash resolution', testClashResolution],
  ['block push distance', testBlockPushDistance],
  ['ring-out resolution', testRingOutResolution],
  ['authoritative track sync', testAuthoritativeTrackSync],
  ['contact windows', testContactWindows],
  ['simultaneous controller scheduling', testSimultaneousControllerScheduling],
  ['simultaneous body hits', testSimultaneousBodyHitsClash],
];

function main() {
  const results = [];
  for (const [name, test] of TESTS) {
    const startedAt = performance.now();
    test();
    results.push({
      name,
      ms: performance.now() - startedAt,
    });
  }

  console.log('Combat regression passed.');
  for (const result of results) {
    console.log(`- ${result.name}: ${result.ms.toFixed(1)}ms`);
  }
  console.log(`- frame duration reference: ${FRAME_DURATION.toFixed(6)}s`);
}

main();
