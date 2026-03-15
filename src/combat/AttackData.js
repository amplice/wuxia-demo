import { AttackType, WeaponType } from '../core/Constants.js';

const ATTACK_DATA = {
  [WeaponType.KATANA]: {
    [AttackType.QUICK]: {
      reach: 1.5,
      lunge: 0.4,
      blockPush: 0.5,
      lungeStart: 1 / 3,
      lungeEnd: 2 / 3,
      contactStart: 30 / 90,
      contactEnd: 44 / 90,
      name: 'Slash',
    },
    [AttackType.HEAVY]: {
      reach: 1.8,
      lunge: 0.7,
      blockPush: 1.2,
      lungeStart: 1 / 3,
      lungeEnd: 2 / 3,
      contactStart: 30 / 115,
      contactEnd: 55 / 115,
      name: 'Heavy Slash',
    },
    [AttackType.THRUST]: {
      reach: 2.0,
      lunge: 0.7,
      blockPush: 0.8,
      lungeStart: 0.25,
      lungeEnd: 0.75,
      contactStart: 22 / 65,
      contactEnd: 41 / 65,
      name: 'Thrust',
    },
  },
  [WeaponType.SPEAR]: {
    [AttackType.QUICK]: {
      reach: 2.0,
      lunge: 0.2,
      blockPush: 0.5,
      lungeStart: 0.5,
      lungeEnd: 1.0,
      contactStart: 17 / 90,
      contactEnd: 42 / 90,
      name: 'Slash',
    },
    [AttackType.HEAVY]: {
      reach: 2.3,
      lunge: 0.6,
      blockPush: 1.2,
      lungeStart: 1 / 3,
      lungeEnd: 2 / 3,
      contactStart: 13 / 105,
      contactEnd: 38 / 105,
      name: 'Heavy Slash',
    },
    [AttackType.THRUST]: {
      reach: 2.5,
      lunge: 0.12,
      blockPush: 0.8,
      lungeRatio: 0.5,
      contactStart: 27 / 83,
      contactEnd: 44 / 83,
      name: 'Thrust',
    },
  },
};

export function getAttackData(attackType, weaponType = WeaponType.KATANA) {
  const weaponData = ATTACK_DATA[weaponType] || ATTACK_DATA[WeaponType.KATANA];
  const attackData = weaponData[attackType] || weaponData[AttackType.QUICK];
  return { ...attackData, attackType };
}
