import { AttackType, WeaponType } from '../core/Constants.js';
import { defineCharacter } from './shared/characterContract.js';

export const knight = defineCharacter('knight', {
  displayName: 'Knight',
  glbPath: '/knight.glb',
  weapon: {
    type: WeaponType.SWORD,
    stats: {
      name: 'Longsword',
      description: 'Two-handed straight sword',
      length: 1.02,
      width: 0.045,
      color: 0xd9d9d9,
      guardSize: 0.13,
    },
    tuning: {
      hitRadius: 0.16,
      hitMode: 'capsule',
    },
  },
  attackData: {
    [AttackType.QUICK]: {
      aiRange: 1.55,
      lunge: 0.43,
      blockPush: 0.6,
      lungeStart: 0.28,
      lungeEnd: 0.68,
      contactStart: 8 / 49,
      contactEnd: 27.001 / 49,
      name: 'Quick Cut',
    },
    [AttackType.HEAVY]: {
      aiRange: 1.9,
      lunge: 1.04,
      blockPush: 1.35,
      lungeStart: 0.18,
      lungeEnd: 0.82,
      contactStart: 15 / 56,
      contactEnd: 33 / 56,
      clashAdvantage: {
        selfStunMult: 0.6,
        targetStunMult: 1.35,
      },
      name: 'Heavy Cut',
    },
    [AttackType.THRUST]: {
      aiRange: 2.0,
      lunge: 0.84,
      blockPush: 0.9,
      lungeStart: 0.24,
      lungeEnd: 0.78,
      contactStart: 16 / 50,
      contactEnd: 32.001 / 50,
      name: 'Thrust',
    },
  },
  sim: {
    poseProfile: {
      idle: {
        [AttackType.QUICK]: { yawStart: 0, yawEnd: 0, reachStart: 0.88, reachEnd: 0.88, liftStart: 0.14, liftEnd: 0.14 },
        [AttackType.HEAVY]: { yawStart: 0, yawEnd: 0, reachStart: 0.88, reachEnd: 0.88, liftStart: 0.14, liftEnd: 0.14 },
        [AttackType.THRUST]: { yawStart: 0, yawEnd: 0, reachStart: 0.88, reachEnd: 0.88, liftStart: 0.14, liftEnd: 0.14 },
      },
      attack: {
        [AttackType.QUICK]: {
          yawStart: -1.0, yawEnd: 0.42, reachStart: 0.96, reachEnd: 1.24, liftStart: 0.26, liftEnd: 0.08,
          windupLead: 0.08, recoveryEnd: 0.44,
        },
        [AttackType.HEAVY]: {
          yawStart: -1.3, yawEnd: 0.88, reachStart: 1.0, reachEnd: 1.34, liftStart: 0.5, liftEnd: 0.18,
          windupLead: 0.1, recoveryEnd: 0.32,
        },
        [AttackType.THRUST]: {
          yawStart: -0.08, yawEnd: 0.08, reachStart: 1.14, reachEnd: 1.78, liftStart: 0.2, liftEnd: 0.08,
          windupLead: 0.22, recoveryEnd: 0.62,
        },
      },
      sideOffset: 0.16,
      baseForward: 0.15,
      idleTipLift: 0.12,
    },
  },
  motionThresholds: {
    towardTarget: 0.004,
    relativeSpeed: 0.0055,
  },
  modelYOffset: 0.1,
  modelRotationX: -0.05,
  modelScale: 0.82,
  idleDuringStepCooldown: true,
  walkSpeedMult: 0.5,
  clipSpeedups: {
    walk: ['walk_forward', 'walk_backward'],
    strafe: ['strafe_left', 'strafe_right'],
    attack: ['attack_quick', 'attack_heavy', 'attack_thrust'],
    backstep: ['backstep'],
    knockback: ['clash_knockback', 'block_knockback'],
  },
  clipSpeedFactor: { walk: 1.8, strafe: 2.0, attack: 2.0, backstep: 3.0, knockback: 2.0 },
  clipSpeedOverrides: {
    attack_quick: 1.4,
    attack_heavy: 1.725,
    attack_thrust: 1.525,
    backstep: 1.3,
    strafe_right: 1.25,
    block_parry: 5.5,
  },
  bakeWeapon: true,
  aiRanges: { engage: 2.7, close: 1.7 },
  attackStrength: 1.25,
  defenseStoutness: 1.1,
  sidestepDistance: 1.05,
  sidestepRecoveryFrames: 6,
  stepDistance: 0.9,
  bodySeparation: 1.6,
});
