import { AttackType, WeaponType } from '../core/Constants.js';
import { defineCharacter } from './shared/characterContract.js';

export const ronin = defineCharacter('ronin', {
  displayName: 'Ronin',
  glbPath: '/ronin.glb',
  weapon: {
    type: WeaponType.KATANA,
    stats: {
      name: 'Katana',
      description: 'Curved sword',
      length: 0.9,
      width: 0.035,
      color: 0xddccaa,
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
      lunge: 0.46,
      blockPush: 0.5,
      lungeStart: 1 / 3,
      lungeEnd: 2 / 3,
      contactStart: 13 / 41,
      contactEnd: 20.001 / 41,
      name: 'Slash',
    },
    [AttackType.HEAVY]: {
      aiRange: 1.8,
      lunge: 1.05,
      blockPush: 1.2,
      lungeStart: 1 / 5,
      lungeEnd: 4 / 5,
      contactStart: 12 / 50,
      contactEnd: 24.001 / 50,
      name: 'Heavy Slash',
    },
    [AttackType.THRUST]: {
      aiRange: 2.0,
      lunge: 0.58,
      blockPush: 0.8,
      lungeStart: 0.25,
      lungeEnd: 0.75,
      contactStart: 13 / 41,
      contactEnd: 24.001 / 41,
      name: 'Thrust',
    },
  },
  sim: {
    poseProfile: {
      idle: {
        [AttackType.QUICK]: { yawStart: 0, yawEnd: 0, reachStart: 0.85, reachEnd: 0.85, liftStart: 0.12, liftEnd: 0.12 },
        [AttackType.HEAVY]: { yawStart: 0, yawEnd: 0, reachStart: 0.85, reachEnd: 0.85, liftStart: 0.12, liftEnd: 0.12 },
        [AttackType.THRUST]: { yawStart: 0, yawEnd: 0, reachStart: 0.85, reachEnd: 0.85, liftStart: 0.12, liftEnd: 0.12 },
      },
      attack: {
        [AttackType.QUICK]: {
          yawStart: -0.95, yawEnd: 0.55, reachStart: 0.95, reachEnd: 1.25, liftStart: 0.20, liftEnd: 0.08,
          windupLead: 0.08, recoveryEnd: 0.42,
        },
        [AttackType.HEAVY]: {
          yawStart: -1.25, yawEnd: 0.95, reachStart: 1.00, reachEnd: 1.35, liftStart: 0.45, liftEnd: 0.15,
          windupLead: 0.10, recoveryEnd: 0.30,
        },
        [AttackType.THRUST]: {
          yawStart: -0.10, yawEnd: 0.08, reachStart: 1.15, reachEnd: 1.75, liftStart: 0.18, liftEnd: 0.10,
          windupLead: 0.22, recoveryEnd: 0.60,
        },
      },
      sideOffset: 0.16,
      baseForward: 0.14,
      idleTipLift: 0.12,
    },
  },
  motionThresholds: {
    towardTarget: 0.004,
    relativeSpeed: 0.0055,
  },
  modelYOffset: -0.15,
  modelRotationX: -0.05,
  idleDuringStepCooldown: true,
  walkSpeedMult: 0.5,
  clipSpeedups: {
    walk: ['walk_forward', 'walk_backward'],
    strafe: ['strafe_left', 'strafe_right'],
    attack: ['attack_quick', 'attack_heavy', 'attack_thrust'],
    backstep: ['backstep'],
    knockback: ['clash_knockback', 'block_knockback'],
  },
  clipSpeedFactor: { walk: 2, strafe: 2, attack: 2, backstep: 3, knockback: 2 },
  clipSpeedOverrides: {
    attack_quick: 1.12,
    attack_heavy: 1.15,
    attack_thrust: 0.8125,
    backstep: 0.8333333333333334,
    block_parry: 7.5,
    clash_knockback: 2.734375,
    block_knockback: 2.734375,
  },
  bakeWeapon: true,
  aiRanges: { engage: 2.8, close: 1.8 },
  attackStrength: 1.1,
  defenseStoutness: 1.05,
  sidestepDistance: 1.2,
  sidestepFrames: 24,
  sidestepRecoveryFrames: 5,
  bodySeparation: 1.6,
});
