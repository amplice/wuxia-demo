import { WeaponType } from '../core/Constants.js';

export const HURT_CYLINDER = Object.freeze({
  radius: 0.34,
  height: 1.8,
});

export const BODY_COLLISION = Object.freeze({
  centerHeight: 0.9,
  cylinderHeight: 1.8,
  defaultRadius: 0.4,
});

export const WEAPON_FALLBACKS = Object.freeze({
  baseHeight: 1.2,
});

export const MOTION_THRESHOLDS = Object.freeze({
  spearTowardTarget: 0.001,
  spearRelativeSpeed: 0.002,
  katanaTowardTarget: 0.004,
  katanaRelativeSpeed: 0.0055,
  weaponClashClosingDrive: 0.0025,
});

export const IMPACT_TUNING = Object.freeze({
  defaultAttackStrength: 1.0,
  defaultDefenseStoutness: 1.0,
  minScale: 0.85,
  maxScale: 1.35,
});

export const DEFAULT_WEAPON_TUNING = Object.freeze({
  [WeaponType.SPEAR]: Object.freeze({
    hitRadius: 0.02,
    clashRadius: 0.09,
    hitMode: 'tip',
  }),
  [WeaponType.KATANA]: Object.freeze({
    hitRadius: 0.08,
    clashRadius: 0.09,
    hitMode: 'capsule',
  }),
});

export function getDefaultWeaponTuning(weaponType) {
  return DEFAULT_WEAPON_TUNING[weaponType] ?? DEFAULT_WEAPON_TUNING[WeaponType.SPEAR];
}

export function getDefaultWeaponHitRadius(weaponType) {
  return getDefaultWeaponTuning(weaponType).hitRadius;
}

export function getDefaultWeaponClashRadius(weaponType) {
  return getDefaultWeaponTuning(weaponType).clashRadius;
}

export function getMotionThresholds(weaponType) {
  if (weaponType === WeaponType.KATANA) {
    return {
      towardTarget: MOTION_THRESHOLDS.katanaTowardTarget,
      relativeSpeed: MOTION_THRESHOLDS.katanaRelativeSpeed,
    };
  }
  return {
    towardTarget: MOTION_THRESHOLDS.spearTowardTarget,
    relativeSpeed: MOTION_THRESHOLDS.spearRelativeSpeed,
  };
}

export function getBodyRadius(charDef) {
  if (typeof charDef?.bodyRadius === 'number') return charDef.bodyRadius;
  if (typeof charDef?.bodySeparation === 'number') return charDef.bodySeparation * 0.5;
  return BODY_COLLISION.defaultRadius;
}

export function getImpactScale(attackerCharDef, defenderCharDef, bonus = 1) {
  const attackStrength = attackerCharDef?.attackStrength ?? IMPACT_TUNING.defaultAttackStrength;
  const defenseStoutness = defenderCharDef?.defenseStoutness ?? IMPACT_TUNING.defaultDefenseStoutness;
  const rawScale = bonus * (attackStrength / defenseStoutness);
  return Math.min(IMPACT_TUNING.maxScale, Math.max(IMPACT_TUNING.minScale, rawScale));
}
