import { AttackType, WeaponType } from '../core/Constants.js';
import { defineCharacter } from './shared/characterContract.js';

export const huscarl = defineCharacter('huscarl', {
  displayName: 'Huscarl',
  glbPath: '/huscarl.glb',
  weapon: {
    type: WeaponType.SWORD,
    stats: {
      name: 'Hand Axe',
      description: 'Short one-handed axe and shield',
      length: 0.78,
      width: 0.07,
      color: 0xb9bec4,
      guardSize: 0,
    },
    tuning: {
      hitRadius: 0.13,
      hitMode: 'capsule',
    },
  },
  attackData: {
    [AttackType.QUICK]: {
      aiRange: 1.38,
      lunge: 0.42,
      blockPush: 0.55,
      lungeStart: 0.28,
      lungeEnd: 0.7,
      contactStart: 7 / 32,
      contactEnd: 21.001 / 32,
      name: 'Axe Chop',
    },
    [AttackType.HEAVY]: {
      aiRange: 1.62,
      lunge: 0.78,
      blockPush: 1.25,
      lungeStart: 0.18,
      lungeEnd: 0.8,
      contactStart: 17 / 61,
      contactEnd: 41.001 / 61,
      clashAdvantage: {
        selfStunMult: 0.7,
        targetStunMult: 1.25,
      },
      name: 'Shielded Cleave',
    },
    [AttackType.THRUST]: {
      aiRange: 1.45,
      lunge: 0.5,
      blockPush: 0.75,
      lungeStart: 0.25,
      lungeEnd: 0.72,
      contactStart: 15 / 52,
      contactEnd: 27.001 / 52,
      name: 'Axe Jab',
    },
  },
  sim: {
    attackFrames: {
      [AttackType.QUICK]: 32,
      [AttackType.HEAVY]: 61,
      [AttackType.THRUST]: 52,
    },
    poseProfile: {
      idle: {
        [AttackType.QUICK]: { yawStart: 0, yawEnd: 0, reachStart: 0.72, reachEnd: 0.72, liftStart: 0.12, liftEnd: 0.12 },
        [AttackType.HEAVY]: { yawStart: 0, yawEnd: 0, reachStart: 0.72, reachEnd: 0.72, liftStart: 0.12, liftEnd: 0.12 },
        [AttackType.THRUST]: { yawStart: 0, yawEnd: 0, reachStart: 0.72, reachEnd: 0.72, liftStart: 0.12, liftEnd: 0.12 },
      },
      attack: {
        [AttackType.QUICK]: {
          yawStart: -0.72, yawEnd: 0.55, reachStart: 0.82, reachEnd: 1.12, liftStart: 0.22, liftEnd: 0.08,
          windupLead: 0.08, recoveryEnd: 0.45,
        },
        [AttackType.HEAVY]: {
          yawStart: -1.05, yawEnd: 0.85, reachStart: 0.9, reachEnd: 1.22, liftStart: 0.46, liftEnd: 0.12,
          windupLead: 0.1, recoveryEnd: 0.35,
        },
        [AttackType.THRUST]: {
          yawStart: -0.2, yawEnd: 0.18, reachStart: 0.88, reachEnd: 1.3, liftStart: 0.16, liftEnd: 0.08,
          windupLead: 0.2, recoveryEnd: 0.6,
        },
      },
      sideOffset: 0.18,
      baseForward: 0.12,
      idleTipLift: 0.1,
    },
  },
  motionThresholds: {
    towardTarget: 0.004,
    relativeSpeed: 0.0055,
  },
  modelYOffset: 0.08,
  modelRotationX: -0.05,
  modelScale: 0.9,
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
    block_parry: 5.5,
  },
  bakeWeapon: true,
  aiRanges: { engage: 2.4, close: 1.45 },
  attackStrength: 1.15,
  defenseStoutness: 1.2,
  sidestepDistance: 1.0,
  sidestepRecoveryFrames: 7,
  stepDistance: 0.85,
  bodySeparation: 1.8,
});
