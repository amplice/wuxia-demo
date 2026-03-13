import { WeaponType } from '../core/Constants.js';

export const WEAPON_STATS = {
  [WeaponType.KATANA]: {
    name: 'Katana',
    description: 'Curved sword',
    length: 0.9,
    width: 0.035,
    color: 0xddccaa,
    guardSize: 0.1,
  },
  [WeaponType.SPEAR]: {
    name: 'Spear',
    description: 'Long thrusting weapon',
    length: 2.0,
    width: 0.02,
    color: 0x886644,
    guardSize: 0,
  },
};
