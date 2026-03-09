import { AttackType, WeaponType } from '../core/Constants.js';

const BASE_DATA = {
  [AttackType.QUICK]: { startup: 6, active: 3, recovery: 10, reach: 1.5, lunge: 1.0, blockPush: 0.5, name: 'Slash' },
  [AttackType.HEAVY]: { startup: 12, active: 6, recovery: 20, reach: 1.8, lunge: 1.5, blockPush: 1.2, name: 'Heavy Slash' },
  [AttackType.THRUST]: { startup: 8, active: 4, recovery: 15, reach: 2.0, lunge: 2.0, blockPush: 0.8, name: 'Thrust' },
};

// Weapon modifiers
const WEAPON_MODS = {
  [WeaponType.JIAN]: { startupMod: 0, reachMod: 0, recoveryMod: 0, lungeMult: 1 },
  [WeaponType.DAO]: { startupMod: 1, reachMod: 0.1, recoveryMod: -1, lungeMult: 1 },
  [WeaponType.STAFF]: { startupMod: 2, reachMod: 0.4, recoveryMod: 2, lungeMult: 1 },
  [WeaponType.SPEAR]: { startupMod: 1, reachMod: 0.5, recoveryMod: 1, lungeMult: 0.4 },
};

export function getAttackData(attackType, weaponType = WeaponType.JIAN) {
  const base = BASE_DATA[attackType];
  if (!base) return BASE_DATA[AttackType.QUICK]; // fallback
  const mod = WEAPON_MODS[weaponType];

  return {
    startup: base.startup + mod.startupMod,
    active: base.active,
    recovery: base.recovery + mod.recoveryMod,
    reach: base.reach + mod.reachMod,
    lunge: base.lunge * mod.lungeMult,
    blockPush: base.blockPush,
    name: base.name,
    attackType,
  };
}
