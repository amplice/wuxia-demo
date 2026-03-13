import { WeaponType } from '../core/Constants.js';

export const CHARACTER_DEFS = {
  spearman: {
    displayName: 'Spearman',
    glbPath: '/spearman.glb',
    weaponType: WeaponType.SPEAR,
    modelYOffset: -0.02,
    modelRotationX: -0.02,
    walkSpeedMult: 0.5,
    clipSpeedups: {
      walk: ['walk_forward', 'walk_backward'],
      strafe: ['strafe_left', 'strafe_right'],
      attack: ['attack_quick', 'attack_heavy', 'attack_thrust'],
      backstep: ['backstep'],
      knockback: ['clash_knockback', 'block_knockback'],
    },
    clipSpeedFactor: { walk: 2.6, strafe: 2, attack: 2, backstep: 3, knockback: 2 },
    hipsLeanDeg: 4.5,
    swapIdle: { from: 'idle_alt', to: 'idle' },
    bakeWeapon: true,
    aiRanges: { engage: 3.5, close: 2.5 },
    bodySeparation: 1.6,
  },
  ronin: {
    displayName: 'Ronin',
    glbPath: '/ronin.glb',
    weaponType: WeaponType.KATANA,
    modelYOffset: -0.15,
    modelRotationX: -0.05,
    walkSpeedMult: 0.5,
    clipSpeedups: {
      walk: ['walk_forward', 'walk_backward'],
      strafe: ['strafe_left', 'strafe_right'],
      attack: ['attack_quick', 'attack_heavy', 'attack_thrust'],
      backstep: ['backstep'],
      knockback: ['clash_knockback', 'block_knockback'],
    },
    clipSpeedFactor: { walk: 2, strafe: 2, attack: 2, backstep: 3, knockback: 2 },
    clipSpeedOverrides: { attack_quick: 0.75, attack_heavy: 0.75, block_parry: 4 },
    bakeWeapon: true,
    aiRanges: { engage: 2.8, close: 1.8 },
    sidestepDistance: 1.2,
    bodySeparation: 1.6,
  },
};

export const DEFAULT_CHAR = 'spearman';
