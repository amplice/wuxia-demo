#!/usr/bin/env node
/**
 * Generate 300 procedural keyframe animations (10 actions × 30 variations)
 * Uses real metarig bone names from character_all.glb
 * Output: src/data/generated-animations.json
 *
 * Each animation has time-based keyframes with Euler angles (radians).
 * At runtime, Euler→Quaternion conversion creates THREE.AnimationClip objects.
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEG = Math.PI / 180;

const rand = (min, max) => min + Math.random() * (max - min);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const lerp = (a, b, t) => a + (b - a) * t;
const round4 = (v) => Math.round(v * 10000) / 10000;

// Key bones we animate (skip fingers and end bones)
// NOTE: THREE.js GLTFLoader sanitizes bone names by stripping dots,
// so 'spine002' becomes 'spine002', 'upper_armL' becomes 'upper_armL', etc.
const BONES = [
  'spine',       // hips/root
  'spine001',    // lower back
  'spine002',    // upper back
  'spine003',    // chest
  'Neck',
  'Head',
  'upper_armL', 'forearmL', 'handL',
  'upper_armR', 'forearmR', 'handR',
  'thighL', 'shinL', 'footL', 'toeL',
  'thighR', 'shinR', 'footR', 'toeR',
];

/**
 * Build a track entry: { bone, keyframes: [{t, rx, ry, rz}, ...] }
 * Only non-zero values needed.
 */
function track(bone, keyframes) {
  return {
    bone,
    keyframes: keyframes.map(kf => ({
      t: round4(kf.t),
      rx: round4(kf.rx || 0),
      ry: round4(kf.ry || 0),
      rz: round4(kf.rz || 0),
    })),
  };
}

/** Interpolate between two pose snapshots at times t0 and t1, inserting intermediate frames */
function tweenPose(pose0, pose1, t0, t1, steps = 1) {
  // Just return the two endpoints — runtime interpolation handles the rest
  const tracks = [];
  const allBones = new Set([...Object.keys(pose0), ...Object.keys(pose1)]);
  for (const bone of allBones) {
    const a = pose0[bone] || { rx: 0, ry: 0, rz: 0 };
    const b = pose1[bone] || { rx: 0, ry: 0, rz: 0 };
    tracks.push(track(bone, [
      { t: t0, ...a },
      { t: t1, ...b },
    ]));
  }
  return tracks;
}

/** Build tracks from a sequence of {time, pose} pairs with smooth interpolation */
function tracksFromSequence(sequence) {
  const allBones = new Set();
  for (const { pose } of sequence) {
    for (const bone of Object.keys(pose)) allBones.add(bone);
  }

  const tracks = [];
  for (const bone of allBones) {
    const keyframes = [];
    for (const { time, pose } of sequence) {
      const rot = pose[bone] || { rx: 0, ry: 0, rz: 0 };
      keyframes.push({ t: time, rx: rot.rx || 0, ry: rot.ry || 0, rz: rot.rz || 0 });
    }
    tracks.push(track(bone, keyframes));
  }
  return tracks;
}

// ═══════════════════════════════════════════════════════
// POSE HELPERS — define poses as { boneName: {rx, ry, rz} }
// ═══════════════════════════════════════════════════════

function idlePose(params = {}) {
  const { torsoTwist = 0, lean = 0, swordRaise = -60, guardArm = -30, kneesBent = 5, stanceWidth = 5 } = params;
  return {
    'spine': { ry: torsoTwist * 0.3 * DEG },
    'spine001': { rx: lean * 0.3 * DEG },
    'spine002': { rx: lean * 0.3 * DEG, ry: torsoTwist * 0.3 * DEG },
    'spine003': { ry: torsoTwist * 0.4 * DEG },
    'Neck': { ry: -torsoTwist * 0.3 * DEG },
    'Head': { rx: rand(-3, 3) * DEG, ry: -torsoTwist * 0.2 * DEG },
    'upper_armR': { rx: swordRaise * DEG, rz: rand(-30, -15) * DEG },
    'forearmR': { rx: rand(-50, -20) * DEG },
    'handR': { rx: rand(-10, 10) * DEG },
    'upper_armL': { rx: guardArm * DEG, rz: rand(15, 30) * DEG },
    'forearmL': { rx: rand(-40, -15) * DEG },
    'thighR': { rx: -stanceWidth * DEG },
    'shinR': { rx: kneesBent * DEG },
    'thighL': { rx: stanceWidth * DEG },
    'shinL': { rx: kneesBent * 0.7 * DEG },
  };
}

// ═══════════════════════════════════════════════════════
// 1. IDLE — breathing/swaying loop (2-3s)
// ═══════════════════════════════════════════════════════
function generateIdle(i) {
  const duration = rand(2.0, 3.0);
  const torsoTwist = rand(-25, -5);
  const lean = rand(-5, 5);
  const swordRaise = rand(-80, -40);
  const guardArm = rand(-40, -15);
  const kneesBent = rand(5, 20);
  const stanceWidth = rand(5, 18);
  const breathAmt = rand(1, 4);
  const swayAmt = rand(1, 3);

  const base = idlePose({ torsoTwist, lean, swordRaise, guardArm, kneesBent, stanceWidth });

  // Breathe: subtle spine.002 rx oscillation + slight sway
  const breathIn = { ...base };
  const breathOut = {};
  for (const [bone, rot] of Object.entries(base)) {
    breathOut[bone] = { ...rot };
  }
  breathOut['spine002'] = { ...base['spine002'], rx: (base['spine002']?.rx || 0) + breathAmt * DEG };
  breathOut['spine003'] = { ...base['spine003'], ry: (base['spine003']?.ry || 0) + swayAmt * DEG };
  breathOut['upper_armR'] = { ...base['upper_armR'], rx: (base['upper_armR']?.rx || 0) - 2 * DEG };

  const tracks = tracksFromSequence([
    { time: 0, pose: breathIn },
    { time: duration * 0.5, pose: breathOut },
    { time: duration, pose: breathIn },
  ]);

  return {
    name: `idle_v${String(i + 1).padStart(2, '0')}`,
    category: 'idle',
    duration: round4(duration),
    loop: true,
    tracks,
  };
}

// ═══════════════════════════════════════════════════════
// 2. WALK FORWARD — full stride cycle (0.8-1.2s)
// ═══════════════════════════════════════════════════════
function generateWalkForward(i) {
  const duration = rand(0.8, 1.2);
  const stride = rand(20, 35);
  const armSwing = rand(8, 20);
  const torsoTwist = rand(5, 12);
  const lean = rand(3, 10);
  const bounce = rand(2, 6);
  const swordBase = rand(-70, -50);

  function walkPose(phase) {
    // phase: 0 = right foot forward, 0.5 = left foot forward
    const s = Math.sin(phase * Math.PI * 2);
    const c = Math.cos(phase * Math.PI * 2);
    return {
      'spine': { ry: s * torsoTwist * 0.2 * DEG },
      'spine001': { rx: lean * 0.4 * DEG },
      'spine002': { rx: lean * 0.3 * DEG + Math.abs(s) * bounce * 0.5 * DEG, ry: s * torsoTwist * 0.3 * DEG },
      'spine003': { ry: s * torsoTwist * 0.5 * DEG },
      'Neck': { ry: -s * torsoTwist * 0.2 * DEG },
      'Head': { rx: -lean * 0.2 * DEG },
      'upper_armR': { rx: (swordBase + s * armSwing * 0.5) * DEG, rz: -25 * DEG },
      'forearmR': { rx: -30 * DEG },
      'upper_armL': { rx: (-20 - s * armSwing) * DEG, rz: 20 * DEG },
      'forearmL': { rx: (-25 + Math.max(0, s) * 15) * DEG },
      'thighR': { rx: -s * stride * DEG },
      'shinR': { rx: Math.max(5, (1 - s) * 0.5 * stride) * DEG },
      'footR': { rx: s * 8 * DEG },
      'thighL': { rx: s * stride * DEG },
      'shinL': { rx: Math.max(5, (1 + s) * 0.5 * stride) * DEG },
      'footL': { rx: -s * 8 * DEG },
    };
  }

  const numFrames = 8;
  const sequence = [];
  for (let f = 0; f <= numFrames; f++) {
    const phase = f / numFrames;
    sequence.push({ time: round4(phase * duration), pose: walkPose(phase) });
  }

  return {
    name: `walk_forward_v${String(i + 1).padStart(2, '0')}`,
    category: 'walk_forward',
    duration: round4(duration),
    loop: true,
    tracks: tracksFromSequence(sequence),
    metadata: { stride, lean },
  };
}

// ═══════════════════════════════════════════════════════
// 3. WALK BACKWARD (0.9-1.3s)
// ═══════════════════════════════════════════════════════
function generateWalkBackward(i) {
  const duration = rand(0.9, 1.3);
  const stride = rand(12, 25);
  const armGuard = rand(5, 15);
  const lean = rand(-8, -2);
  const swordBase = rand(-75, -55);

  function walkPose(phase) {
    const s = Math.sin(phase * Math.PI * 2);
    return {
      'spine': { ry: s * 5 * DEG },
      'spine001': { rx: lean * 0.4 * DEG },
      'spine002': { rx: lean * 0.3 * DEG, ry: s * 4 * DEG },
      'spine003': { ry: -s * 3 * DEG },
      'Neck': { ry: s * 3 * DEG },
      'Head': { rx: -lean * 0.3 * DEG, ry: rand(-5, 10) * DEG },
      'upper_armR': { rx: (swordBase - armGuard * Math.abs(s)) * DEG, rz: -25 * DEG },
      'forearmR': { rx: -35 * DEG },
      'upper_armL': { rx: (-30 - armGuard * 0.5) * DEG, rz: 20 * DEG },
      'forearmL': { rx: -35 * DEG },
      'thighR': { rx: s * stride * DEG },
      'shinR': { rx: Math.max(5, (1 + s) * 0.4 * stride) * DEG },
      'footR': { rx: -s * 6 * DEG },
      'thighL': { rx: -s * stride * DEG },
      'shinL': { rx: Math.max(5, (1 - s) * 0.4 * stride) * DEG },
      'footL': { rx: s * 6 * DEG },
    };
  }

  const numFrames = 8;
  const sequence = [];
  for (let f = 0; f <= numFrames; f++) {
    sequence.push({ time: round4((f / numFrames) * duration), pose: walkPose(f / numFrames) });
  }

  return {
    name: `walk_backward_v${String(i + 1).padStart(2, '0')}`,
    category: 'walk_backward',
    duration: round4(duration),
    loop: true,
    tracks: tracksFromSequence(sequence),
    metadata: { stride, lean },
  };
}

// ═══════════════════════════════════════════════════════
// 4. KENDO OVERHEAD SLASH (0.4-0.8s)
// ═══════════════════════════════════════════════════════
function generateKendoSlash(i) {
  const startupT = rand(0.12, 0.22);
  const activeT = rand(0.06, 0.12);
  const recoveryT = rand(0.15, 0.3);
  const duration = startupT + activeT + recoveryT;
  const windupArm = rand(-140, -100);
  const windupElbow = rand(-100, -60);
  const lungeLean = rand(10, 22);
  const footForward = rand(15, 30);
  const twoHanded = Math.random() > 0.4;

  const ready = {
    'spine002': { rx: -5 * DEG, ry: rand(-15, -5) * DEG },
    'spine003': { ry: rand(-10, 0) * DEG },
    'Head': { rx: rand(0, 5) * DEG },
    'upper_armR': { rx: -65 * DEG, rz: -25 * DEG },
    'forearmR': { rx: -30 * DEG },
    'upper_armL': { rx: -25 * DEG, rz: 25 * DEG },
    'forearmL': { rx: -25 * DEG },
    'thighR': { rx: -8 * DEG },
    'shinR': { rx: 12 * DEG },
    'thighL': { rx: 5 * DEG },
    'shinL': { rx: 8 * DEG },
  };

  const windup = {
    'spine001': { rx: -8 * DEG },
    'spine002': { rx: -12 * DEG, ry: rand(-20, -8) * DEG },
    'spine003': { ry: rand(-15, -5) * DEG },
    'Head': { rx: rand(5, 12) * DEG, ry: rand(5, 12) * DEG },
    'upper_armR': { rx: windupArm * DEG, ry: rand(-15, 0) * DEG, rz: rand(-25, -10) * DEG },
    'forearmR': { rx: windupElbow * DEG },
    'handR': { rx: rand(-15, 0) * DEG },
    'upper_armL': twoHanded
      ? { rx: (windupArm * 0.85) * DEG, rz: rand(5, 15) * DEG }
      : { rx: -25 * DEG, rz: rand(20, 35) * DEG },
    'forearmL': twoHanded ? { rx: (windupElbow * 0.8) * DEG } : { rx: -25 * DEG },
    'thighR': { rx: -5 * DEG },
    'shinR': { rx: 15 * DEG },
    'thighL': { rx: 5 * DEG },
    'shinL': { rx: 8 * DEG },
  };

  const strike = {
    'spine001': { rx: lungeLean * 0.3 * DEG },
    'spine002': { rx: lungeLean * 0.4 * DEG, ry: rand(10, 20) * DEG },
    'spine003': { ry: rand(8, 18) * DEG },
    'Head': { rx: rand(-3, 3) * DEG, ry: rand(-5, 8) * DEG },
    'upper_armR': { rx: rand(-45, -20) * DEG, ry: rand(10, 25) * DEG, rz: rand(-35, -20) * DEG },
    'forearmR': { rx: rand(-15, 0) * DEG },
    'handR': { rx: rand(0, 10) * DEG },
    'upper_armL': twoHanded
      ? { rx: rand(-35, -15) * DEG, rz: rand(8, 20) * DEG }
      : { rx: rand(-15, 0) * DEG, rz: rand(25, 40) * DEG },
    'forearmL': twoHanded ? { rx: rand(-10, 0) * DEG } : { rx: -20 * DEG },
    'thighR': { rx: -footForward * DEG },
    'shinR': { rx: rand(5, 12) * DEG },
    'thighL': { rx: rand(8, 18) * DEG },
    'shinL': { rx: rand(5, 12) * DEG },
  };

  const recover = {
    'spine002': { rx: rand(3, 8) * DEG, ry: rand(12, 25) * DEG },
    'spine003': { ry: rand(10, 20) * DEG },
    'Head': { ry: rand(-5, 5) * DEG },
    'upper_armR': { rx: rand(-55, -35) * DEG, ry: rand(10, 25) * DEG, rz: -25 * DEG },
    'forearmR': { rx: rand(-20, -5) * DEG },
    'upper_armL': { rx: rand(-25, -10) * DEG, rz: rand(18, 30) * DEG },
    'forearmL': { rx: rand(-25, -10) * DEG },
    'thighR': { rx: -footForward * 0.5 * DEG },
    'shinR': { rx: rand(10, 18) * DEG },
    'thighL': { rx: rand(5, 10) * DEG },
    'shinL': { rx: rand(5, 10) * DEG },
  };

  const t1 = startupT;
  const t2 = t1 + activeT;

  return {
    name: `kendo_slash_v${String(i + 1).padStart(2, '0')}`,
    category: 'kendo_slash',
    duration: round4(duration),
    loop: false,
    tracks: tracksFromSequence([
      { time: 0, pose: ready },
      { time: round4(t1), pose: windup },
      { time: round4(t1 + activeT * 0.15), pose: strike },
      { time: round4(t2), pose: strike },
      { time: round4(duration), pose: recover },
    ]),
    metadata: { twoHanded, startupFrames: Math.round(startupT * 60), activeFrames: Math.round(activeT * 60) },
  };
}

// ═══════════════════════════════════════════════════════
// 5. HORIZONTAL SLASH (0.35-0.7s)
// ═══════════════════════════════════════════════════════
function generateHorizontalSlash(i) {
  const startupT = rand(0.1, 0.18);
  const activeT = rand(0.06, 0.1);
  const recoveryT = rand(0.15, 0.3);
  const duration = startupT + activeT + recoveryT;
  const swingDir = pick([-1, 1]);
  const torsoTwist = rand(18, 35);
  const armHeight = rand(-80, -50);

  const ready = {
    'spine002': { ry: -torsoTwist * swingDir * 0.5 * DEG },
    'spine003': { ry: -torsoTwist * swingDir * 0.5 * DEG },
    'upper_armR': { rx: armHeight * DEG, ry: rand(-15, -5) * swingDir * DEG, rz: rand(-35, -20) * DEG },
    'forearmR': { rx: rand(-45, -25) * DEG },
    'upper_armL': { rx: rand(-20, -10) * DEG, rz: rand(15, 25) * DEG },
    'forearmL': { rx: rand(-30, -15) * DEG },
    'thighR': { rx: rand(-10, -5) * DEG },
    'shinR': { rx: rand(10, 18) * DEG },
    'thighL': { rx: rand(5, 10) * DEG },
    'shinL': { rx: rand(5, 10) * DEG },
  };

  const swing = {
    'spine001': { ry: torsoTwist * swingDir * 0.2 * DEG },
    'spine002': { rx: rand(3, 8) * DEG, ry: torsoTwist * swingDir * 0.4 * DEG },
    'spine003': { ry: torsoTwist * swingDir * 0.4 * DEG },
    'Head': { ry: -torsoTwist * swingDir * 0.25 * DEG },
    'upper_armR': { rx: armHeight * 0.7 * DEG, ry: rand(15, 30) * swingDir * DEG, rz: rand(-40, -25) * DEG },
    'forearmR': { rx: rand(-12, 0) * DEG },
    'upper_armL': { rx: rand(-12, -5) * DEG, rz: rand(20, 35) * DEG },
    'forearmL': { rx: rand(-18, -5) * DEG },
    'thighR': { rx: rand(-15, -8) * DEG },
    'shinR': { rx: rand(8, 14) * DEG },
    'thighL': { rx: rand(8, 15) * DEG },
    'shinL': { rx: rand(5, 12) * DEG },
  };

  const recover = {
    'spine002': { ry: torsoTwist * swingDir * 0.3 * DEG },
    'spine003': { ry: torsoTwist * swingDir * 0.2 * DEG },
    'upper_armR': { rx: rand(-60, -40) * DEG, ry: rand(5, 15) * DEG, rz: -25 * DEG },
    'forearmR': { rx: rand(-20, -8) * DEG },
    'upper_armL': { rx: rand(-18, -8) * DEG, rz: rand(18, 28) * DEG },
    'forearmL': { rx: rand(-22, -8) * DEG },
    'thighR': { rx: rand(-8, -3) * DEG },
    'shinR': { rx: rand(10, 16) * DEG },
    'thighL': { rx: rand(5, 10) * DEG },
    'shinL': { rx: rand(5, 8) * DEG },
  };

  const t1 = startupT;
  const t2 = t1 + activeT;

  return {
    name: `horizontal_slash_v${String(i + 1).padStart(2, '0')}`,
    category: 'horizontal_slash',
    duration: round4(duration),
    loop: false,
    tracks: tracksFromSequence([
      { time: 0, pose: ready },
      { time: round4(t1), pose: ready },
      { time: round4(t1 + activeT * 0.2), pose: swing },
      { time: round4(t2), pose: swing },
      { time: round4(duration), pose: recover },
    ]),
    metadata: { swingDir: swingDir > 0 ? 'L-to-R' : 'R-to-L' },
  };
}

// ═══════════════════════════════════════════════════════
// 6. THRUST / STAB (0.35-0.65s)
// ═══════════════════════════════════════════════════════
function generateThrust(i) {
  const startupT = rand(0.1, 0.18);
  const activeT = rand(0.05, 0.1);
  const recoveryT = rand(0.12, 0.25);
  const duration = startupT + activeT + recoveryT;
  const lunge = rand(12, 22);
  const twoHanded = Math.random() > 0.6;
  const thrustArm = rand(-65, -35);

  const coil = {
    'spine001': { rx: -3 * DEG },
    'spine002': { rx: -5 * DEG, ry: rand(-25, -12) * DEG },
    'spine003': { ry: rand(-18, -8) * DEG },
    'Head': { ry: rand(8, 15) * DEG },
    'upper_armR': { rx: rand(-75, -55) * DEG, rz: rand(-22, -10) * DEG },
    'forearmR': { rx: rand(-75, -45) * DEG },
    'upper_armL': twoHanded
      ? { rx: rand(-65, -45) * DEG, rz: rand(5, 12) * DEG }
      : { rx: rand(-18, -5) * DEG, rz: rand(25, 35) * DEG },
    'forearmL': twoHanded ? { rx: rand(-55, -35) * DEG } : { rx: rand(-25, -10) * DEG },
    'thighR': { rx: rand(-3, 3) * DEG },
    'shinR': { rx: rand(15, 22) * DEG },
    'thighL': { rx: rand(5, 12) * DEG },
    'shinL': { rx: rand(5, 10) * DEG },
  };

  const thrust = {
    'spine001': { rx: lunge * 0.3 * DEG },
    'spine002': { rx: lunge * 0.4 * DEG, ry: rand(5, 12) * DEG },
    'spine003': { ry: rand(3, 10) * DEG },
    'Head': { rx: rand(-3, 0) * DEG },
    'upper_armR': { rx: thrustArm * DEG, ry: rand(5, 15) * DEG, rz: rand(-18, -5) * DEG },
    'forearmR': { rx: rand(-12, 0) * DEG },
    'handR': { rx: rand(-5, 8) * DEG },
    'upper_armL': twoHanded
      ? { rx: (thrustArm * 0.8) * DEG, rz: rand(5, 12) * DEG }
      : { rx: rand(-8, 5) * DEG, rz: rand(30, 45) * DEG },
    'forearmL': twoHanded ? { rx: rand(-8, 0) * DEG } : { rx: rand(-12, -5) * DEG },
    'thighR': { rx: -lunge * 1.1 * DEG },
    'shinR': { rx: rand(5, 12) * DEG },
    'thighL': { rx: rand(10, 18) * DEG },
    'shinL': { rx: rand(5, 10) * DEG },
  };

  const recover = {
    'spine002': { rx: rand(3, 6) * DEG },
    'upper_armR': { rx: rand(-55, -38) * DEG, rz: rand(-25, -12) * DEG },
    'forearmR': { rx: rand(-22, -8) * DEG },
    'upper_armL': { rx: rand(-18, -5) * DEG, rz: rand(18, 30) * DEG },
    'forearmL': { rx: rand(-22, -8) * DEG },
    'thighR': { rx: rand(-10, -3) * DEG },
    'shinR': { rx: rand(12, 18) * DEG },
    'thighL': { rx: rand(5, 10) * DEG },
    'shinL': { rx: rand(5, 8) * DEG },
  };

  const t1 = startupT;
  const t2 = t1 + activeT;

  return {
    name: `thrust_v${String(i + 1).padStart(2, '0')}`,
    category: 'thrust',
    duration: round4(duration),
    loop: false,
    tracks: tracksFromSequence([
      { time: 0, pose: coil },
      { time: round4(t1), pose: coil },
      { time: round4(t1 + activeT * 0.2), pose: thrust },
      { time: round4(t2), pose: thrust },
      { time: round4(duration), pose: recover },
    ]),
    metadata: { twoHanded },
  };
}

// ═══════════════════════════════════════════════════════
// 7. BLOCK / GUARD (1.0-1.5s hold animation)
// ═══════════════════════════════════════════════════════
function generateBlock(i) {
  const duration = rand(1.0, 1.5);
  const blockType = pick(['high', 'mid', 'low']);
  const twoHanded = Math.random() > 0.5;

  let swordRx, swordRz, elbowRx, offArmRx, torsoLean;
  if (blockType === 'high') {
    swordRx = rand(-120, -90); swordRz = rand(-22, -10); elbowRx = rand(-75, -45);
    offArmRx = twoHanded ? rand(-100, -75) : rand(-45, -25); torsoLean = rand(-3, 3);
  } else if (blockType === 'mid') {
    swordRx = rand(-85, -55); swordRz = rand(-28, -12); elbowRx = rand(-65, -35);
    offArmRx = twoHanded ? rand(-75, -50) : rand(-35, -15); torsoLean = rand(0, 8);
  } else {
    swordRx = rand(-45, -25); swordRz = rand(-32, -18); elbowRx = rand(-35, -15);
    offArmRx = twoHanded ? rand(-35, -20) : rand(-18, -5); torsoLean = rand(5, 12);
  }

  const blockPose = {
    'spine002': { rx: torsoLean * DEG, ry: rand(-8, 8) * DEG },
    'Head': { rx: rand(-3, 3) * DEG, ry: rand(-8, 8) * DEG },
    'upper_armR': { rx: swordRx * DEG, ry: rand(12, 35) * DEG, rz: swordRz * DEG },
    'forearmR': { rx: elbowRx * DEG },
    'handR': { rx: rand(-12, 12) * DEG },
    'upper_armL': { rx: offArmRx * DEG, ry: rand(-12, 5) * DEG, rz: rand(10, 25) * DEG },
    'forearmL': { rx: rand(-55, -25) * DEG },
    'thighR': { rx: rand(-12, -5) * DEG },
    'shinR': { rx: rand(10, 22) * DEG },
    'thighL': { rx: rand(5, 12) * DEG },
    'shinL': { rx: rand(5, 10) * DEG },
  };

  // Subtle brace animation
  const brace = {};
  for (const [bone, rot] of Object.entries(blockPose)) {
    brace[bone] = { ...rot };
  }
  brace['spine002'] = { ...brace['spine002'], rx: (brace['spine002'].rx || 0) + 2 * DEG };
  brace['shinR'] = { ...brace['shinR'], rx: (brace['shinR'].rx || 0) + 3 * DEG };

  return {
    name: `block_v${String(i + 1).padStart(2, '0')}`,
    category: 'block',
    duration: round4(duration),
    loop: true,
    tracks: tracksFromSequence([
      { time: 0, pose: blockPose },
      { time: round4(duration * 0.5), pose: brace },
      { time: round4(duration), pose: blockPose },
    ]),
    metadata: { blockType, twoHanded },
  };
}

// ═══════════════════════════════════════════════════════
// 8. HIT REACTION (0.3-0.6s)
// ═══════════════════════════════════════════════════════
function generateHitReaction(i) {
  const duration = rand(0.3, 0.6);
  const hitFrom = pick(['front', 'left', 'right', 'high']);
  const severity = rand(0.6, 1.4);

  let torso, head, armR, armL;
  if (hitFrom === 'front') {
    torso = { rx: rand(-22, -10) * severity * DEG, rz: rand(-5, 5) * DEG };
    head = { rx: rand(10, 22) * severity * DEG, ry: rand(-12, 12) * DEG };
  } else if (hitFrom === 'left') {
    torso = { ry: rand(15, 30) * severity * DEG, rz: rand(5, 12) * severity * DEG };
    head = { rx: rand(5, 12) * DEG, ry: rand(-20, -8) * severity * DEG };
  } else if (hitFrom === 'right') {
    torso = { ry: rand(-30, -15) * severity * DEG, rz: rand(-12, -5) * severity * DEG };
    head = { rx: rand(5, 12) * DEG, ry: rand(8, 20) * severity * DEG };
  } else {
    torso = { rx: rand(-28, -12) * severity * DEG };
    head = { rx: rand(15, 28) * severity * DEG };
  }

  const hitPose = {
    'spine002': torso,
    'spine003': { rx: (torso.rx || 0) * 0.5, ry: (torso.ry || 0) * 0.5, rz: (torso.rz || 0) * 0.5 },
    'Head': head,
    'upper_armR': { rx: rand(-25, 0) * DEG, rz: rand(-55, -28) * severity * DEG },
    'forearmR': { rx: rand(-12, 0) * DEG },
    'upper_armL': { rx: rand(0, 15) * severity * DEG, rz: rand(28, 55) * severity * DEG },
    'forearmL': { rx: rand(-12, 0) * DEG },
    'thighR': { rx: rand(-12, 5) * DEG },
    'shinR': { rx: rand(10, 25) * severity * DEG },
    'thighL': { rx: rand(0, 12) * DEG },
    'shinL': { rx: rand(5, 12) * DEG },
  };

  // Recovery: back toward neutral
  const recoverPose = {
    'spine002': { rx: (torso.rx || 0) * 0.2, ry: (torso.ry || 0) * 0.2 },
    'Head': { rx: (head.rx || 0) * 0.15 },
    'upper_armR': { rx: -50 * DEG, rz: -25 * DEG },
    'forearmR': { rx: -25 * DEG },
    'upper_armL': { rx: -20 * DEG, rz: 22 * DEG },
    'forearmL': { rx: -20 * DEG },
    'thighR': { rx: -5 * DEG },
    'shinR': { rx: 10 * DEG },
    'thighL': { rx: 5 * DEG },
    'shinL': { rx: 8 * DEG },
  };

  return {
    name: `hit_reaction_v${String(i + 1).padStart(2, '0')}`,
    category: 'hit_reaction',
    duration: round4(duration),
    loop: false,
    tracks: tracksFromSequence([
      { time: 0, pose: {} },
      { time: round4(duration * 0.15), pose: hitPose },
      { time: round4(duration * 0.4), pose: hitPose },
      { time: round4(duration), pose: recoverPose },
    ]),
    metadata: { hitFrom, severity: round4(severity) },
  };
}

// ═══════════════════════════════════════════════════════
// 9. DODGE / SIDESTEP (0.3-0.5s)
// ═══════════════════════════════════════════════════════
function generateDodge(i) {
  const duration = rand(0.3, 0.5);
  const dodgeType = pick(['sidestep_left', 'sidestep_right', 'duck', 'lean_back']);

  let peakPose;
  if (dodgeType === 'sidestep_left' || dodgeType === 'sidestep_right') {
    const dir = dodgeType === 'sidestep_left' ? 1 : -1;
    peakPose = {
      'spine': { rz: dir * rand(3, 8) * DEG },
      'spine002': { rx: rand(8, 15) * DEG, rz: dir * rand(5, 15) * DEG },
      'Head': { rx: rand(-8, -3) * DEG },
      'upper_armR': { rx: rand(-65, -38) * DEG, rz: rand(-30, -15) * DEG },
      'forearmR': { rx: rand(-25, -8) * DEG },
      'upper_armL': { rx: rand(-25, -8) * DEG, rz: rand(15, 30) * DEG },
      'forearmL': { rx: rand(-22, -8) * DEG },
      'thighR': { rx: rand(-25, -12) * (dir > 0 ? 1 : 0.5) * DEG },
      'shinR': { rx: rand(18, 35) * DEG },
      'thighL': { rx: rand(-25, -12) * (dir < 0 ? 1 : 0.5) * DEG },
      'shinL': { rx: rand(18, 35) * DEG },
    };
  } else if (dodgeType === 'duck') {
    const squat = rand(0.5, 1.0);
    peakPose = {
      'spine002': { rx: rand(12, 25) * squat * DEG },
      'Head': { rx: rand(-12, -5) * DEG },
      'upper_armR': { rx: rand(-55, -28) * DEG, rz: rand(-25, -12) * DEG },
      'forearmR': { rx: rand(-35, -12) * DEG },
      'upper_armL': { rx: rand(-25, -8) * DEG, rz: rand(12, 25) * DEG },
      'forearmL': { rx: rand(-25, -8) * DEG },
      'thighR': { rx: rand(-30, -18) * squat * DEG },
      'shinR': { rx: rand(35, 60) * squat * DEG },
      'thighL': { rx: rand(-30, -18) * squat * DEG },
      'shinL': { rx: rand(35, 60) * squat * DEG },
    };
  } else {
    peakPose = {
      'spine002': { rx: rand(-18, -8) * DEG },
      'Head': { rx: rand(5, 12) * DEG },
      'upper_armR': { rx: rand(-45, -22) * DEG, rz: rand(-35, -18) * DEG },
      'forearmR': { rx: rand(-18, -5) * DEG },
      'upper_armL': { rx: rand(-15, 0) * DEG, rz: rand(22, 40) * DEG },
      'forearmL': { rx: rand(-12, -5) * DEG },
      'thighR': { rx: rand(5, 15) * DEG },
      'shinR': { rx: rand(12, 25) * DEG },
      'thighL': { rx: rand(5, 15) * DEG },
      'shinL': { rx: rand(12, 25) * DEG },
    };
  }

  return {
    name: `dodge_v${String(i + 1).padStart(2, '0')}`,
    category: 'dodge',
    duration: round4(duration),
    loop: false,
    tracks: tracksFromSequence([
      { time: 0, pose: {} },
      { time: round4(duration * 0.3), pose: peakPose },
      { time: round4(duration * 0.7), pose: peakPose },
      { time: round4(duration), pose: {} },
    ]),
    metadata: { dodgeType },
  };
}

// ═══════════════════════════════════════════════════════
// 10. DEATH / COLLAPSE (1.0-2.0s)
// ═══════════════════════════════════════════════════════
function generateDeath(i) {
  const duration = rand(1.0, 2.0);
  const deathType = pick(['fall_back', 'fall_forward', 'crumple', 'dramatic_spin']);

  let impactPose, finalPose;

  if (deathType === 'fall_back') {
    impactPose = {
      'spine001': { rx: rand(-15, -5) * DEG },
      'spine002': { rx: rand(-30, -15) * DEG, ry: rand(-15, 15) * DEG },
      'Head': { rx: rand(12, 30) * DEG, ry: rand(-15, 15) * DEG },
      'upper_armR': { rx: rand(0, 25) * DEG, rz: rand(-70, -35) * DEG },
      'forearmR': { rx: rand(-12, 0) * DEG },
      'upper_armL': { rx: rand(0, 25) * DEG, rz: rand(35, 70) * DEG },
      'forearmL': { rx: rand(-12, 0) * DEG },
      'thighR': { rx: rand(-20, -5) * DEG },
      'shinR': { rx: rand(18, 42) * DEG },
      'thighL': { rx: rand(-8, 12) * DEG },
      'shinL': { rx: rand(5, 25) * DEG },
    };
    finalPose = { ...impactPose };
    finalPose['spine002'] = { rx: rand(-40, -25) * DEG, ry: rand(-20, 20) * DEG, rz: rand(-12, 12) * DEG };
    finalPose['upper_armR'] = { rx: rand(10, 35) * DEG, rz: rand(-85, -50) * DEG };
    finalPose['upper_armL'] = { rx: rand(10, 35) * DEG, rz: rand(50, 85) * DEG };
  } else if (deathType === 'fall_forward') {
    impactPose = {
      'spine001': { rx: rand(8, 15) * DEG },
      'spine002': { rx: rand(18, 38) * DEG, ry: rand(-12, 12) * DEG },
      'Head': { rx: rand(-18, -5) * DEG, ry: rand(-12, 12) * DEG },
      'upper_armR': { rx: rand(-25, 8) * DEG, rz: rand(-55, -25) * DEG },
      'forearmR': { rx: rand(-25, -5) * DEG },
      'upper_armL': { rx: rand(-25, 8) * DEG, rz: rand(25, 55) * DEG },
      'forearmL': { rx: rand(-25, -5) * DEG },
      'thighR': { rx: rand(-3, 12) * DEG },
      'shinR': { rx: rand(8, 30) * DEG },
      'thighL': { rx: rand(5, 18) * DEG },
      'shinL': { rx: rand(5, 22) * DEG },
    };
    finalPose = { ...impactPose };
    finalPose['spine002'] = { rx: rand(30, 48) * DEG, rz: rand(-8, 8) * DEG };
  } else if (deathType === 'crumple') {
    impactPose = {
      'spine002': { rx: rand(22, 38) * DEG },
      'Head': { rx: rand(-22, -8) * DEG, ry: rand(-15, 15) * DEG, rz: rand(-12, 12) * DEG },
      'upper_armR': { rx: rand(-8, 15) * DEG, rz: rand(-45, -18) * DEG },
      'forearmR': { rx: rand(-35, -8) * DEG },
      'upper_armL': { rx: rand(-8, 15) * DEG, rz: rand(18, 45) * DEG },
      'forearmL': { rx: rand(-35, -8) * DEG },
      'thighR': { rx: rand(-35, -18) * DEG },
      'shinR': { rx: rand(50, 80) * DEG },
      'thighL': { rx: rand(-25, -8) * DEG },
      'shinL': { rx: rand(42, 72) * DEG },
    };
    finalPose = { ...impactPose };
    finalPose['spine002'] = { rx: rand(35, 50) * DEG };
    finalPose['shinR'] = { rx: rand(65, 95) * DEG };
    finalPose['shinL'] = { rx: rand(55, 85) * DEG };
  } else {
    const spinDir = pick([-1, 1]);
    impactPose = {
      'spine002': { rx: rand(-15, 8) * DEG, ry: rand(25, 50) * spinDir * DEG, rz: rand(8, 20) * spinDir * DEG },
      'Head': { rx: rand(8, 22) * DEG, ry: rand(-25, -8) * spinDir * DEG },
      'upper_armR': { rx: rand(8, 35) * DEG, rz: rand(-80, -42) * DEG },
      'forearmR': { rx: rand(-8, 0) * DEG },
      'upper_armL': { rx: rand(8, 35) * DEG, rz: rand(42, 80) * DEG },
      'forearmL': { rx: rand(-8, 0) * DEG },
      'thighR': { rx: rand(-15, 0) * DEG },
      'shinR': { rx: rand(18, 38) * DEG },
      'thighL': { rx: rand(5, 15) * DEG },
      'shinL': { rx: rand(8, 25) * DEG },
    };
    finalPose = { ...impactPose };
    finalPose['spine002'] = { ...finalPose['spine002'], ry: rand(35, 65) * spinDir * DEG };
  }

  return {
    name: `death_v${String(i + 1).padStart(2, '0')}`,
    category: 'death',
    duration: round4(duration),
    loop: false,
    tracks: tracksFromSequence([
      { time: 0, pose: {} },
      { time: round4(duration * 0.2), pose: impactPose },
      { time: round4(duration * 0.5), pose: finalPose },
      { time: round4(duration), pose: finalPose },
    ]),
    metadata: { deathType },
  };
}

// ═══════════════════════════════════════════════════════
// GENERATE ALL
// ═══════════════════════════════════════════════════════
const generators = [
  { fn: generateIdle, count: 30 },
  { fn: generateWalkForward, count: 30 },
  { fn: generateWalkBackward, count: 30 },
  { fn: generateKendoSlash, count: 30 },
  { fn: generateHorizontalSlash, count: 30 },
  { fn: generateThrust, count: 30 },
  { fn: generateBlock, count: 30 },
  { fn: generateHitReaction, count: 30 },
  { fn: generateDodge, count: 30 },
  { fn: generateDeath, count: 30 },
];

const allAnimations = [];
for (const { fn, count } of generators) {
  for (let i = 0; i < count; i++) {
    allAnimations.push(fn(i));
  }
}

const output = {
  generated: new Date().toISOString(),
  totalCount: allAnimations.length,
  categories: [...new Set(allAnimations.map(a => a.category))],
  animations: allAnimations,
};

const outPath = resolve(__dirname, '../src/data/generated-animations.json');
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`Generated ${allAnimations.length} animations to ${outPath}`);
console.log('Categories:', output.categories.join(', '));

// Stats
let totalTracks = 0, totalKeyframes = 0;
for (const anim of allAnimations) {
  totalTracks += anim.tracks.length;
  for (const t of anim.tracks) totalKeyframes += t.keyframes.length;
}
console.log(`Total tracks: ${totalTracks}, total keyframes: ${totalKeyframes}`);
