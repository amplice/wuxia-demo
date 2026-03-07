import { WeaponType } from '../core/Constants.js';

export const WEAPON_STATS = {
  [WeaponType.JIAN]: {
    name: 'Jian',
    description: 'Balanced straight sword',
    length: 1.0,
    width: 0.02,
    color: 0xccccdd,
    guardSize: 0.08,
  },
  [WeaponType.DAO]: {
    name: 'Dao',
    description: 'Curved saber with power',
    length: 0.9,
    width: 0.035,
    color: 0xddccaa,
    guardSize: 0.1,
  },
  [WeaponType.STAFF]: {
    name: 'Staff',
    description: 'Long reach, slower strikes',
    length: 1.6,
    width: 0.025,
    color: 0x886644,
    guardSize: 0,
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
