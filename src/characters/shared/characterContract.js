import { AttackType } from '../../core/Constants.js';

export const REQUIRED_CLIP_NAMES = Object.freeze([
  'idle',
  'walk_forward',
  'walk_backward',
  'strafe_left',
  'strafe_right',
  'backstep',
  'block_parry',
  'block_knockback',
  'clash_knockback',
  'attack_quick',
  'attack_heavy',
  'attack_thrust',
]);

const REQUIRED_ATTACK_TYPES = Object.freeze([
  AttackType.QUICK,
  AttackType.HEAVY,
  AttackType.THRUST,
]);

function assertField(value, path) {
  if (value === undefined || value === null) {
    throw new Error(`Missing required character field: ${path}`);
  }
}

function validateAttackData(charId, attackData) {
  assertField(attackData, `${charId}.attackData`);
  for (const attackType of REQUIRED_ATTACK_TYPES) {
    const attack = attackData[attackType];
    assertField(attack, `${charId}.attackData.${attackType}`);
    for (const field of ['aiRange', 'lunge', 'blockPush', 'contactStart', 'contactEnd']) {
      assertField(attack[field], `${charId}.attackData.${attackType}.${field}`);
    }
    if (attack.clashAdvantage) {
      const clashPath = `${charId}.attackData.${attackType}.clashAdvantage`;
      for (const field of ['selfStunMult', 'targetStunMult']) {
        if (attack.clashAdvantage[field] !== undefined) {
          assertField(attack.clashAdvantage[field], `${clashPath}.${field}`);
        }
      }
    }
  }
}

function validateWeapon(charId, weapon) {
  assertField(weapon, `${charId}.weapon`);
  for (const field of ['type', 'stats', 'tuning']) {
    assertField(weapon[field], `${charId}.weapon.${field}`);
  }
  for (const field of ['length', 'width', 'color', 'guardSize']) {
    assertField(weapon.stats[field], `${charId}.weapon.stats.${field}`);
  }
  for (const field of ['hitRadius', 'hitMode']) {
    assertField(weapon.tuning[field], `${charId}.weapon.tuning.${field}`);
  }
}

function validateSim(charId, sim) {
  assertField(sim, `${charId}.sim`);
  assertField(sim.poseProfile, `${charId}.sim.poseProfile`);
  assertField(sim.poseProfile.idle, `${charId}.sim.poseProfile.idle`);
  assertField(sim.poseProfile.attack, `${charId}.sim.poseProfile.attack`);
}

function validateMotionThresholds(charId, motionThresholds) {
  assertField(motionThresholds, `${charId}.motionThresholds`);
  for (const field of ['towardTarget', 'relativeSpeed']) {
    assertField(motionThresholds[field], `${charId}.motionThresholds.${field}`);
  }
}

export function defineCharacter(charId, def) {
  assertField(charId, 'charId');
  for (const field of ['displayName', 'glbPath', 'weapon', 'attackData', 'sim', 'motionThresholds']) {
    assertField(def[field], `${charId}.${field}`);
  }

  validateWeapon(charId, def.weapon);
  validateAttackData(charId, def.attackData);
  validateSim(charId, def.sim);
  validateMotionThresholds(charId, def.motionThresholds);

  return Object.freeze({
    ...def,
    id: charId,
    requiredClips: def.requiredClips ?? REQUIRED_CLIP_NAMES,
    weaponType: def.weapon.type,
    weaponStats: def.weapon.stats,
    weaponHitRadius: def.weapon.tuning.hitRadius,
    weaponClashRadius: def.weapon.tuning.hitRadius,
    weaponHitMode: def.weapon.tuning.hitMode,
  });
}

export function defineCharacterRegistry(registry, defaultChar) {
  assertField(registry, 'registry');
  assertField(defaultChar, 'defaultChar');
  if (!registry[defaultChar]) {
    throw new Error(`Default character '${defaultChar}' is not present in registry`);
  }
  return Object.freeze(registry);
}
