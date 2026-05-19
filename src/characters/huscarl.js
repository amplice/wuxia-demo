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
      hitRadius: 0.12,
      hitMode: 'capsule',
    },
  },
  attackData: {
    [AttackType.QUICK]: {
      aiRange: 1.48,
      lunge: 0.65,
      blockPush: 0.55,
      lungeStart: 0.18,
      lungeEnd: 0.78,
      contactStart: 7 / 32,
      contactEnd: 21.001 / 32,
      name: 'Axe Chop',
    },
    [AttackType.HEAVY]: {
      aiRange: 1.6,
      lunge: 1.14,
      blockPush: 1.35,
      lungeStart: 0.12,
      lungeEnd: 0.82,
      contactStart: 5 / 61,
      contactEnd: 22.001 / 61,
      clashAdvantage: {
        selfStunMult: 0.7,
        targetStunMult: 1.25,
      },
      name: 'Shielded Cleave',
    },
    [AttackType.THRUST]: {
      aiRange: 1.6,
      lunge: 0.72,
      blockPush: 0.75,
      lungeStart: 0.16,
      lungeEnd: 0.76,
      contactStart: 10 / 52,
      contactEnd: 17.001 / 52,
      name: 'Axe Jab',
    },
  },
  sim: {
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
  modelScale: 0.845,
  idleDuringStepCooldown: true,
  walkSpeedMult: 0.7,
  clipSpeedups: {
    walk: ['walk_forward', 'walk_backward'],
    strafe: ['strafe_left', 'strafe_right'],
    attack: ['attack_quick', 'attack_heavy', 'attack_thrust'],
    backstep: ['backstep'],
    knockback: ['clash_knockback', 'block_knockback'],
  },
  clipSpeedFactor: { walk: 2.25, strafe: 2.35, attack: 2.45, backstep: 3.4, knockback: 2.0 },
  clipSpeedOverrides: {
    attack_quick: 1.04,
    attack_heavy: 1.04,
    attack_thrust: 1.04,
    block_parry: 5.5,
  },
  bakeWeapon: true,
  aiRanges: { engage: 2.4, close: 1.45 },
  attackStrength: 1.22,
  defenseStoutness: 1.12,
  sidestepDistance: 1.18,
  sidestepRecoveryFrames: 7,
  stepDistance: 1.08,
  bodySeparation: 1.75,
});
