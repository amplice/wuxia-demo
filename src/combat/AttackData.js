import { AttackType, WeaponType } from '../core/Constants.js';

const ATTACK_DATA = {
  [WeaponType.KATANA]: {
    [AttackType.QUICK]: {
      startup: 6,
      active: 3,
      recovery: 10,
      reach: 1.5,
      lunge: 0.4,
      blockPush: 0.5,
      lungeStart: 1 / 3,
      lungeEnd: 2 / 3,
      name: 'Slash',
    },
    [AttackType.HEAVY]: {
      startup: 12,
      active: 6,
      recovery: 20,
      reach: 1.8,
      lunge: 0.7,
      blockPush: 1.2,
      lungeStart: 1 / 3,
      lungeEnd: 2 / 3,
      name: 'Heavy Slash',
    },
    [AttackType.THRUST]: {
      startup: 8,
      active: 4,
      recovery: 15,
      reach: 2.0,
      lunge: 0.7,
      blockPush: 0.8,
      lungeStart: 0.25,
      lungeEnd: 0.75,
      name: 'Thrust',
    },
  },
  [WeaponType.SPEAR]: {
    [AttackType.QUICK]: {
      startup: 7,
      active: 3,
      recovery: 11,
      reach: 2.0,
      lunge: 0.2,
      blockPush: 0.5,
      lungeStart: 0.5,
      lungeEnd: 1.0,
      name: 'Slash',
    },
    [AttackType.HEAVY]: {
      startup: 13,
      active: 6,
      recovery: 21,
      reach: 2.3,
      lunge: 0.6,
      blockPush: 1.2,
      lungeStart: 1 / 3,
      lungeEnd: 2 / 3,
      name: 'Heavy Slash',
    },
    [AttackType.THRUST]: {
      startup: 9,
      active: 4,
      recovery: 16,
      reach: 2.5,
      lunge: 0.12,
      blockPush: 0.8,
      lungeRatio: 0.5,
      name: 'Thrust',
    },
  },
};

export function getAttackData(attackType, weaponType = WeaponType.KATANA) {
  const weaponData = ATTACK_DATA[weaponType] || ATTACK_DATA[WeaponType.KATANA];
  const attackData = weaponData[attackType] || weaponData[AttackType.QUICK];
  return { ...attackData, attackType };
}
