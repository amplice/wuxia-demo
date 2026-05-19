import { AttackType, WeaponType } from '../core/Constants.js';
import { defineCharacter } from './shared/characterContract.js';

export const template = defineCharacter('template', {
  displayName: 'Template',
  glbPath: '/template.glb',
  weapon: {
    type: WeaponType.KATANA,
    stats: {
      name: 'Template Weapon',
      description: 'Replace with the authored weapon description.',
      length: 1.0,
      width: 0.03,
      color: 0xffffff,
      guardSize: 0.1,
    },
    tuning: {
      hitRadius: 0.08,
      hitMode: 'capsule',
    },
  },
  attackData: {
    [AttackType.QUICK]: {
      aiRange: 1.5,
      lunge: 0.4,
      blockPush: 0.5,
      lungeStart: 1 / 3,
      lungeEnd: 2 / 3,
      contactStart: 0.33,
      contactEnd: 0.5,
      name: 'Quick',
    },
    [AttackType.HEAVY]: {
      aiRange: 1.8,
      lunge: 0.8,
      blockPush: 1.0,
      lungeStart: 0.2,
      lungeEnd: 0.8,
      contactStart: 0.25,
      contactEnd: 0.5,
      name: 'Heavy',
    },
    [AttackType.THRUST]: {
      aiRange: 2.0,
      lunge: 0.9,
      blockPush: 0.8,
      lungeStart: 0.25,
      lungeEnd: 0.75,
      contactStart: 0.33,
      contactEnd: 0.66,
      name: 'Thrust',
    },
  },
  sim: {
    poseProfile: {
      idle: {
        [AttackType.QUICK]: { yawStart: 0, yawEnd: 0, reachStart: 0.9, reachEnd: 0.9, liftStart: 0.1, liftEnd: 0.1 },
        [AttackType.HEAVY]: { yawStart: 0, yawEnd: 0, reachStart: 0.9, reachEnd: 0.9, liftStart: 0.1, liftEnd: 0.1 },
        [AttackType.THRUST]: { yawStart: 0, yawEnd: 0, reachStart: 0.9, reachEnd: 0.9, liftStart: 0.1, liftEnd: 0.1 },
      },
      attack: {
        [AttackType.QUICK]: {
          yawStart: -0.8, yawEnd: 0.4, reachStart: 0.9, reachEnd: 1.2, liftStart: 0.2, liftEnd: 0.1,
          windupLead: 0.1, recoveryEnd: 0.4,
        },
        [AttackType.HEAVY]: {
          yawStart: -1.1, yawEnd: 0.8, reachStart: 1.0, reachEnd: 1.3, liftStart: 0.35, liftEnd: 0.15,
          windupLead: 0.12, recoveryEnd: 0.35,
        },
        [AttackType.THRUST]: {
          yawStart: -0.1, yawEnd: 0.1, reachStart: 1.1, reachEnd: 1.7, liftStart: 0.15, liftEnd: 0.08,
          windupLead: 0.2, recoveryEnd: 0.6,
        },
      },
      sideOffset: 0.12,
      baseForward: 0.16,
      idleTipLift: 0.1,
    },
  },
  motionThresholds: {
    towardTarget: 0.004,
    relativeSpeed: 0.0055,
  },
  modelYOffset: 0,
  modelRotationX: 0,
  idleDuringStepCooldown: true,
  walkSpeedMult: 0.5,
  clipSpeedups: {
    walk: ['walk_forward', 'walk_backward'],
    strafe: ['strafe_left', 'strafe_right'],
    attack: ['attack_quick', 'attack_heavy', 'attack_thrust'],
    backstep: ['backstep'],
    knockback: ['clash_knockback', 'block_knockback'],
  },
  clipSpeedFactor: { walk: 1, strafe: 1, attack: 1, backstep: 1, knockback: 1 },
  clipSpeedOverrides: {},
  bakeWeapon: true,
  aiRanges: { engage: 2.5, close: 1.8 },
  attackStrength: 1.0,
  defenseStoutness: 1.0,
  sidestepDistance: 1.2,
  sidestepRecoveryFrames: 5,
  bodySeparation: 1.6,
});
