#!/usr/bin/env node
import { CHARACTER_DEFS } from '../src/entities/CharacterDefs.js';
import { FighterSim } from '../src/sim/FighterSim.js';
import {
  AttackType,
  BLOCK_KNOCKBACK_SLIDE_SPEED,
  BLOCK_STUN_FRAMES,
  PARRIED_STUN_FRAMES,
  PARRY_REENTRY_COOLDOWN_FRAMES,
  PARRY_SUCCESS_FRAMES_BY_ATTACK,
  PARRY_WINDOW_FRAMES,
} from '../src/core/Constants.js';
import { AUTHORITATIVE_TRACKS } from '../src/data/authoritativeTracks.js';

const ATTACK_CLIPS = {
  [AttackType.QUICK]: 'attack_quick',
  [AttackType.HEAVY]: 'attack_heavy',
  [AttackType.THRUST]: 'attack_thrust',
};

const args = new Set(process.argv.slice(2));
const asJson = args.has('--json');

function buildBaseline() {
  const classes = {};

  for (const [charId, charDef] of Object.entries(CHARACTER_DEFS)) {
    const authoritative = AUTHORITATIVE_TRACKS.characters?.[charId];
    classes[charId] = {
      attackStrength: charDef.attackStrength,
      defenseStoutness: charDef.defenseStoutness,
      walkSpeedMult: charDef.walkSpeedMult ?? null,
      sidestepDistance: charDef.sidestepDistance ?? null,
      stepDistance: charDef.stepDistance ?? null,
      bodySeparation: charDef.bodySeparation ?? null,
      clipSpeedOverrides: {
        attack_quick: charDef.clipSpeedOverrides?.attack_quick ?? null,
        attack_heavy: charDef.clipSpeedOverrides?.attack_heavy ?? null,
        attack_thrust: charDef.clipSpeedOverrides?.attack_thrust ?? null,
      },
      attacks: Object.fromEntries(
        Object.values(AttackType).map((attackType) => {
          const clip = authoritative?.clips?.[ATTACK_CLIPS[attackType]];
          const fighter = new FighterSim(0, charId, charDef);
          return [attackType, {
            frames: fighter._getAttackFrameCount(attackType),
            authoritativeFrames: clip?.frameCount ?? null,
            aiRange: charDef.attackData[attackType].aiRange,
            lunge: charDef.attackData[attackType].lunge,
            blockPush: charDef.attackData[attackType].blockPush,
            contactStart: charDef.attackData[attackType].contactStart,
            contactEnd: charDef.attackData[attackType].contactEnd,
          }];
        }),
      ),
    };
  }

  return {
    generatedAt: new Date().toISOString(),
    core: {
      parryWindowFrames: PARRY_WINDOW_FRAMES,
      parryReentryCooldownFrames: PARRY_REENTRY_COOLDOWN_FRAMES,
      parriedStunFrames: PARRIED_STUN_FRAMES,
      parrySuccessFramesByAttack: PARRY_SUCCESS_FRAMES_BY_ATTACK,
      blockStunFrames: BLOCK_STUN_FRAMES,
      blockKnockbackSlideSpeed: BLOCK_KNOCKBACK_SLIDE_SPEED,
    },
    classes,
  };
}

function printText(baseline) {
  console.log('Combat baseline');
  console.log(`- generatedAt: ${baseline.generatedAt}`);
  console.log(`- parryWindowFrames: ${baseline.core.parryWindowFrames}`);
  console.log(`- parryReentryCooldownFrames: ${baseline.core.parryReentryCooldownFrames}`);
  console.log(`- parriedStunFrames: ${baseline.core.parriedStunFrames}`);
  console.log(`- parrySuccessFramesByAttack: ${JSON.stringify(baseline.core.parrySuccessFramesByAttack)}`);
  console.log(`- blockStunFrames: ${baseline.core.blockStunFrames}`);
  console.log(`- blockKnockbackSlideSpeed: ${baseline.core.blockKnockbackSlideSpeed}`);
  for (const [charId, data] of Object.entries(baseline.classes)) {
    console.log(`\n${charId}`);
    console.log(`- attackStrength: ${data.attackStrength}`);
    console.log(`- defenseStoutness: ${data.defenseStoutness}`);
    console.log(`- walkSpeedMult: ${data.walkSpeedMult}`);
    console.log(`- sidestepDistance: ${data.sidestepDistance}`);
    console.log(`- stepDistance: ${data.stepDistance}`);
    console.log(`- bodySeparation: ${data.bodySeparation}`);
    console.log(`- clipSpeedOverrides: ${JSON.stringify(data.clipSpeedOverrides)}`);
    for (const [attackType, attack] of Object.entries(data.attacks)) {
      console.log(`  - ${attackType}: frames=${attack.frames}, authoritativeFrames=${attack.authoritativeFrames}, aiRange=${attack.aiRange}, lunge=${attack.lunge}, blockPush=${attack.blockPush}`);
    }
  }
}

const baseline = buildBaseline();
if (asJson) {
  console.log(JSON.stringify(baseline, null, 2));
} else {
  printText(baseline);
}
