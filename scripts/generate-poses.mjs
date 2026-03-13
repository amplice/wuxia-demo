#!/usr/bin/env node
/**
 * Generate 300 procedural animation poses (10 actions × 30 variations each)
 * Outputs to src/data/generated-poses.json
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEG = Math.PI / 180;

// Utility: random in range
const rand = (min, max) => min + Math.random() * (max - min);
// Utility: random pick from array
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// Utility: clamp
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Joint names
const JOINTS = [
  'torso', 'head',
  'upperArmR', 'lowerArmR', 'handR',
  'upperArmL', 'lowerArmL', 'handL',
  'upperLegR', 'lowerLegR',
  'upperLegL', 'lowerLegL',
];

function makePose(overrides = {}) {
  const pose = {};
  for (const [joint, rot] of Object.entries(overrides)) {
    pose[joint] = {
      rx: rot.rx || 0,
      ry: rot.ry || 0,
      rz: rot.rz || 0,
    };
  }
  return pose;
}

function jitter(base, amount) {
  return base + rand(-amount, amount) * DEG;
}

// ═══════════════════════════════════════════════════════
// 1. IDLE / READY STANCE  (30 variations)
// ═══════════════════════════════════════════════════════
function generateIdle(i) {
  // Vary: torso twist, arm height, stance width, head angle, weapon position
  const torsoTwist = rand(-25, -5) * DEG;
  const torsoLean = rand(-5, 5) * DEG;
  const headCompensate = rand(5, 20) * DEG;
  const swordArmRaise = rand(-90, -40) * DEG;
  const swordElbow = rand(-50, -10) * DEG;
  const offArmRaise = rand(-40, -10) * DEG;
  const offElbow = rand(-50, -15) * DEG;
  const stanceWidth = rand(5, 20) * DEG;
  const kneesBent = rand(5, 25) * DEG;
  const weightShift = rand(-8, 8) * DEG;

  return {
    name: `idle_v${String(i + 1).padStart(2, '0')}`,
    category: 'idle',
    pose: makePose({
      torso: { rx: torsoLean, ry: torsoTwist },
      head: { rx: rand(-5, 5) * DEG, ry: headCompensate },
      upperArmR: { rx: swordArmRaise, ry: rand(-10, 10) * DEG, rz: rand(-40, -15) * DEG },
      lowerArmR: { rx: swordElbow },
      handR: { rx: rand(-15, 15) * DEG },
      upperArmL: { rx: offArmRaise, ry: rand(-5, 5) * DEG, rz: rand(15, 35) * DEG },
      lowerArmL: { rx: offElbow },
      upperLegR: { rx: -stanceWidth + weightShift },
      lowerLegR: { rx: kneesBent },
      upperLegL: { rx: stanceWidth + weightShift },
      lowerLegL: { rx: kneesBent * rand(0.3, 0.8) },
    }),
  };
}

// ═══════════════════════════════════════════════════════
// 2. WALK FORWARD  (30 variations — walk cycle key poses)
// ═══════════════════════════════════════════════════════
function generateWalkForward(i) {
  // Each variation is a pair of poses: contact + passing
  const stride = rand(15, 35) * DEG;
  const lean = rand(3, 12) * DEG;
  const armSwing = rand(10, 30) * DEG;
  const kneeLift = rand(10, 35) * DEG;
  const torsoTwist = rand(5, 15) * DEG;
  const bounce = rand(0, 8) * DEG;

  const contact = makePose({
    torso: { rx: lean, ry: -torsoTwist },
    head: { rx: -lean * 0.3 },
    upperArmR: { rx: -70 * DEG + armSwing, rz: -25 * DEG },
    lowerArmR: { rx: -25 * DEG },
    upperArmL: { rx: -20 * DEG - armSwing, rz: 25 * DEG },
    lowerArmL: { rx: -20 * DEG },
    upperLegR: { rx: -stride },
    lowerLegR: { rx: kneeLift },
    upperLegL: { rx: stride * 0.7 },
    lowerLegL: { rx: rand(3, 10) * DEG },
  });

  const passing = makePose({
    torso: { rx: lean, ry: torsoTwist },
    head: { rx: -lean * 0.3 },
    upperArmR: { rx: -70 * DEG - armSwing, rz: -25 * DEG },
    lowerArmR: { rx: -25 * DEG },
    upperArmL: { rx: -20 * DEG + armSwing, rz: 25 * DEG },
    lowerArmL: { rx: -20 * DEG },
    upperLegR: { rx: stride * 0.7 },
    lowerLegR: { rx: rand(3, 10) * DEG },
    upperLegL: { rx: -stride },
    lowerLegL: { rx: kneeLift },
  });

  return {
    name: `walk_forward_v${String(i + 1).padStart(2, '0')}`,
    category: 'walk_forward',
    phases: { contact, passing },
    metadata: { stride: stride / DEG, lean: lean / DEG, armSwing: armSwing / DEG },
  };
}

// ═══════════════════════════════════════════════════════
// 3. WALK BACKWARD  (30 variations)
// ═══════════════════════════════════════════════════════
function generateWalkBackward(i) {
  const stride = rand(10, 25) * DEG;
  const lean = rand(-8, -2) * DEG;  // Lean back
  const armGuard = rand(0, 20) * DEG;
  const kneeLift = rand(8, 25) * DEG;

  const contact = makePose({
    torso: { rx: lean, ry: rand(-10, 10) * DEG },
    head: { rx: -lean * 0.5, ry: rand(-5, 15) * DEG },
    upperArmR: { rx: -80 * DEG - armGuard, rz: -25 * DEG },
    lowerArmR: { rx: -35 * DEG },
    upperArmL: { rx: -30 * DEG - armGuard * 0.5, rz: 20 * DEG },
    lowerArmL: { rx: -40 * DEG },
    upperLegR: { rx: stride * 0.8 },
    lowerLegR: { rx: rand(3, 8) * DEG },
    upperLegL: { rx: -stride },
    lowerLegL: { rx: kneeLift },
  });

  const passing = makePose({
    torso: { rx: lean, ry: rand(-10, 10) * DEG },
    head: { rx: -lean * 0.5, ry: rand(-5, 15) * DEG },
    upperArmR: { rx: -80 * DEG + armGuard * 0.3, rz: -25 * DEG },
    lowerArmR: { rx: -35 * DEG },
    upperArmL: { rx: -30 * DEG + armGuard * 0.2, rz: 20 * DEG },
    lowerArmL: { rx: -40 * DEG },
    upperLegR: { rx: -stride },
    lowerLegR: { rx: kneeLift },
    upperLegL: { rx: stride * 0.8 },
    lowerLegL: { rx: rand(3, 8) * DEG },
  });

  return {
    name: `walk_backward_v${String(i + 1).padStart(2, '0')}`,
    category: 'walk_backward',
    phases: { contact, passing },
    metadata: { stride: stride / DEG, lean: lean / DEG },
  };
}

// ═══════════════════════════════════════════════════════
// 4. KENDO OVERHEAD SLASH  (30 variations)
// ═══════════════════════════════════════════════════════
function generateKendoSlash(i) {
  const windupHeight = rand(-140, -100) * DEG;  // Arms high overhead
  const followAngle = rand(-20, 20) * DEG;
  const torsoWindup = rand(-15, -5) * DEG;
  const lungeLean = rand(8, 20) * DEG;
  const twoHanded = Math.random() > 0.4;  // 60% two-handed
  const footForward = rand(15, 35) * DEG;

  const startup = makePose({
    torso: { rx: torsoWindup, ry: rand(-20, -5) * DEG },
    head: { rx: rand(5, 15) * DEG, ry: rand(5, 15) * DEG },
    upperArmR: { rx: windupHeight, ry: rand(-20, 0) * DEG, rz: rand(-30, -10) * DEG },
    lowerArmR: { rx: rand(-100, -60) * DEG },
    handR: { rx: rand(-20, 0) * DEG },
    upperArmL: twoHanded
      ? { rx: windupHeight * 0.9, ry: rand(0, 15) * DEG, rz: rand(5, 20) * DEG }
      : { rx: rand(-30, -10) * DEG, rz: rand(20, 40) * DEG },
    lowerArmL: twoHanded
      ? { rx: rand(-90, -50) * DEG }
      : { rx: rand(-30, -15) * DEG },
    upperLegR: { rx: -rand(5, 15) * DEG },
    lowerLegR: { rx: rand(10, 20) * DEG },
    upperLegL: { rx: rand(3, 10) * DEG },
    lowerLegL: { rx: rand(3, 8) * DEG },
  });

  const active = makePose({
    torso: { rx: lungeLean, ry: rand(10, 25) * DEG },
    head: { rx: rand(-5, 5) * DEG, ry: rand(-5, 10) * DEG },
    upperArmR: { rx: rand(-50, -20) * DEG, ry: rand(10, 30) * DEG, rz: rand(-40, -20) * DEG },
    lowerArmR: { rx: rand(-20, 0) * DEG },
    handR: { rx: rand(0, 15) * DEG },
    upperArmL: twoHanded
      ? { rx: rand(-40, -15) * DEG, ry: rand(-10, 10) * DEG, rz: rand(10, 25) * DEG }
      : { rx: rand(-20, 0) * DEG, rz: rand(25, 45) * DEG },
    lowerArmL: twoHanded
      ? { rx: rand(-15, 0) * DEG }
      : { rx: rand(-20, -5) * DEG },
    upperLegR: { rx: -footForward },
    lowerLegR: { rx: rand(5, 15) * DEG },
    upperLegL: { rx: rand(5, 15) * DEG },
    lowerLegL: { rx: rand(3, 10) * DEG },
  });

  const recovery = makePose({
    torso: { rx: rand(3, 10) * DEG, ry: rand(15, 30) * DEG },
    head: { rx: rand(-3, 3) * DEG },
    upperArmR: { rx: rand(-40, -20) * DEG, ry: rand(15, 35) * DEG, rz: rand(-35, -15) * DEG },
    lowerArmR: { rx: rand(-15, 0) * DEG },
    upperArmL: { rx: rand(-25, -10) * DEG, rz: rand(20, 35) * DEG },
    lowerArmL: { rx: rand(-25, -10) * DEG },
    upperLegR: { rx: -footForward * 0.5 },
    lowerLegR: { rx: rand(8, 18) * DEG },
    upperLegL: { rx: rand(3, 10) * DEG },
    lowerLegL: { rx: rand(3, 8) * DEG },
  });

  return {
    name: `kendo_slash_v${String(i + 1).padStart(2, '0')}`,
    category: 'kendo_slash',
    phases: { startup, active, recovery },
    metadata: { twoHanded, windupDeg: windupHeight / DEG },
  };
}

// ═══════════════════════════════════════════════════════
// 5. QUICK HORIZONTAL SLASH  (30 variations)
// ═══════════════════════════════════════════════════════
function generateHorizontalSlash(i) {
  const swingDir = pick([-1, 1]);  // Left-to-right or right-to-left
  const swingHeight = rand(-80, -50) * DEG;
  const torsoTwist = rand(15, 35) * DEG;
  const followThrough = rand(20, 40) * DEG;

  const startup = makePose({
    torso: { rx: rand(0, 5) * DEG, ry: -torsoTwist * swingDir },
    head: { ry: torsoTwist * swingDir * 0.4 },
    upperArmR: { rx: swingHeight, ry: rand(-20, -5) * DEG * swingDir, rz: rand(-40, -20) * DEG },
    lowerArmR: { rx: rand(-50, -25) * DEG },
    handR: { ry: rand(-10, 10) * DEG },
    upperArmL: { rx: rand(-25, -10) * DEG, rz: rand(15, 30) * DEG },
    lowerArmL: { rx: rand(-35, -15) * DEG },
    upperLegR: { rx: rand(-12, -5) * DEG },
    lowerLegR: { rx: rand(10, 20) * DEG },
    upperLegL: { rx: rand(5, 12) * DEG },
    lowerLegL: { rx: rand(3, 8) * DEG },
  });

  const active = makePose({
    torso: { rx: rand(3, 8) * DEG, ry: followThrough * swingDir },
    head: { ry: -followThrough * swingDir * 0.3 },
    upperArmR: { rx: swingHeight * 0.7, ry: rand(15, 35) * DEG * swingDir, rz: rand(-45, -25) * DEG },
    lowerArmR: { rx: rand(-15, 0) * DEG },
    handR: { ry: rand(-5, 15) * DEG * swingDir },
    upperArmL: { rx: rand(-15, -5) * DEG, rz: rand(20, 40) * DEG },
    lowerArmL: { rx: rand(-20, -5) * DEG },
    upperLegR: { rx: rand(-18, -8) * DEG },
    lowerLegR: { rx: rand(8, 15) * DEG },
    upperLegL: { rx: rand(5, 15) * DEG },
    lowerLegL: { rx: rand(5, 12) * DEG },
  });

  const recovery = makePose({
    torso: { rx: rand(0, 5) * DEG, ry: followThrough * swingDir * 0.5 },
    head: { ry: rand(-5, 5) * DEG },
    upperArmR: { rx: rand(-65, -45) * DEG, ry: rand(5, 20) * DEG, rz: rand(-35, -20) * DEG },
    lowerArmR: { rx: rand(-25, -10) * DEG },
    upperArmL: { rx: rand(-20, -10) * DEG, rz: rand(20, 30) * DEG },
    lowerArmL: { rx: rand(-25, -10) * DEG },
    upperLegR: { rx: rand(-10, -3) * DEG },
    lowerLegR: { rx: rand(10, 18) * DEG },
    upperLegL: { rx: rand(5, 10) * DEG },
    lowerLegL: { rx: rand(3, 8) * DEG },
  });

  return {
    name: `horizontal_slash_v${String(i + 1).padStart(2, '0')}`,
    category: 'horizontal_slash',
    phases: { startup, active, recovery },
    metadata: { swingDir: swingDir > 0 ? 'L-to-R' : 'R-to-L' },
  };
}

// ═══════════════════════════════════════════════════════
// 6. THRUST / STAB  (30 variations)
// ═══════════════════════════════════════════════════════
function generateThrust(i) {
  const thrustHeight = rand(-70, -40) * DEG;  // How high the arm extends
  const lunge = rand(10, 25) * DEG;
  const coil = rand(10, 25) * DEG;
  const twoHanded = Math.random() > 0.6;

  const startup = makePose({
    torso: { rx: rand(-5, 0) * DEG, ry: rand(-30, -15) * DEG },
    head: { ry: rand(10, 20) * DEG },
    upperArmR: { rx: rand(-80, -60) * DEG, ry: rand(-15, 0) * DEG, rz: rand(-25, -10) * DEG },
    lowerArmR: { rx: rand(-80, -50) * DEG },
    handR: { rx: rand(-10, 10) * DEG },
    upperArmL: twoHanded
      ? { rx: rand(-70, -50) * DEG, rz: rand(5, 15) * DEG }
      : { rx: rand(-20, -5) * DEG, rz: rand(25, 40) * DEG },
    lowerArmL: twoHanded
      ? { rx: rand(-60, -40) * DEG }
      : { rx: rand(-30, -10) * DEG },
    upperLegR: { rx: rand(-5, 5) * DEG },
    lowerLegR: { rx: rand(15, 25) * DEG },
    upperLegL: { rx: rand(5, 15) * DEG },
    lowerLegL: { rx: rand(5, 10) * DEG },
  });

  const active = makePose({
    torso: { rx: lunge, ry: rand(5, 15) * DEG },
    head: { rx: rand(-5, 0) * DEG, ry: rand(-5, 5) * DEG },
    upperArmR: { rx: thrustHeight, ry: rand(5, 20) * DEG, rz: rand(-20, -5) * DEG },
    lowerArmR: { rx: rand(-15, 0) * DEG },
    handR: { rx: rand(-5, 10) * DEG },
    upperArmL: twoHanded
      ? { rx: thrustHeight * 0.8, ry: rand(-5, 10) * DEG, rz: rand(5, 15) * DEG }
      : { rx: rand(-10, 5) * DEG, rz: rand(30, 50) * DEG },
    lowerArmL: twoHanded
      ? { rx: rand(-10, 0) * DEG }
      : { rx: rand(-15, -5) * DEG },
    upperLegR: { rx: -lunge * 1.2 },
    lowerLegR: { rx: rand(5, 15) * DEG },
    upperLegL: { rx: rand(8, 20) * DEG },
    lowerLegL: { rx: rand(5, 12) * DEG },
  });

  const recovery = makePose({
    torso: { rx: rand(3, 8) * DEG, ry: rand(0, 10) * DEG },
    head: { ry: rand(-5, 5) * DEG },
    upperArmR: { rx: rand(-60, -40) * DEG, rz: rand(-30, -15) * DEG },
    lowerArmR: { rx: rand(-25, -10) * DEG },
    upperArmL: { rx: rand(-20, -5) * DEG, rz: rand(20, 35) * DEG },
    lowerArmL: { rx: rand(-25, -10) * DEG },
    upperLegR: { rx: rand(-12, -3) * DEG },
    lowerLegR: { rx: rand(12, 20) * DEG },
    upperLegL: { rx: rand(5, 12) * DEG },
    lowerLegL: { rx: rand(3, 8) * DEG },
  });

  return {
    name: `thrust_v${String(i + 1).padStart(2, '0')}`,
    category: 'thrust',
    phases: { startup, active, recovery },
    metadata: { twoHanded, thrustHeightDeg: thrustHeight / DEG },
  };
}

// ═══════════════════════════════════════════════════════
// 7. BLOCK / GUARD  (30 variations)
// ═══════════════════════════════════════════════════════
function generateBlock(i) {
  const blockType = pick(['high', 'mid', 'low']);
  const twoHanded = Math.random() > 0.5;

  let swordArmRx, swordArmRz, swordElbow, offArmRx, torsoLean;

  if (blockType === 'high') {
    swordArmRx = rand(-120, -90) * DEG;
    swordArmRz = rand(-25, -10) * DEG;
    swordElbow = rand(-80, -50) * DEG;
    offArmRx = twoHanded ? rand(-100, -80) * DEG : rand(-50, -30) * DEG;
    torsoLean = rand(-5, 5) * DEG;
  } else if (blockType === 'mid') {
    swordArmRx = rand(-90, -60) * DEG;
    swordArmRz = rand(-30, -15) * DEG;
    swordElbow = rand(-70, -40) * DEG;
    offArmRx = twoHanded ? rand(-80, -55) * DEG : rand(-40, -20) * DEG;
    torsoLean = rand(0, 10) * DEG;
  } else {
    swordArmRx = rand(-50, -30) * DEG;
    swordArmRz = rand(-35, -20) * DEG;
    swordElbow = rand(-40, -20) * DEG;
    offArmRx = twoHanded ? rand(-40, -25) * DEG : rand(-20, -5) * DEG;
    torsoLean = rand(5, 15) * DEG;
  }

  return {
    name: `block_v${String(i + 1).padStart(2, '0')}`,
    category: 'block',
    pose: makePose({
      torso: { rx: torsoLean, ry: rand(-10, 10) * DEG },
      head: { rx: rand(-5, 5) * DEG, ry: rand(-10, 10) * DEG },
      upperArmR: { rx: swordArmRx, ry: rand(15, 40) * DEG, rz: swordArmRz },
      lowerArmR: { rx: swordElbow },
      handR: { rx: rand(-15, 15) * DEG },
      upperArmL: { rx: offArmRx, ry: rand(-15, 5) * DEG, rz: rand(10, 30) * DEG },
      lowerArmL: { rx: rand(-60, -30) * DEG },
      upperLegR: { rx: rand(-15, -5) * DEG },
      lowerLegR: { rx: rand(10, 25) * DEG },
      upperLegL: { rx: rand(5, 15) * DEG },
      lowerLegL: { rx: rand(5, 12) * DEG },
    }),
    metadata: { blockType, twoHanded },
  };
}

// ═══════════════════════════════════════════════════════
// 8. HIT REACTION  (30 variations)
// ═══════════════════════════════════════════════════════
function generateHitReaction(i) {
  const hitFrom = pick(['front', 'left', 'right', 'high']);
  const severity = rand(0.5, 1.5);

  let torsoRx, torsoRy, torsoRz, headRx, headRy;

  if (hitFrom === 'front') {
    torsoRx = rand(-25, -10) * DEG * severity;
    torsoRy = rand(-10, 10) * DEG;
    torsoRz = rand(-5, 5) * DEG;
    headRx = rand(10, 25) * DEG * severity;
    headRy = rand(-15, 15) * DEG;
  } else if (hitFrom === 'left') {
    torsoRx = rand(-10, 0) * DEG;
    torsoRy = rand(15, 35) * DEG * severity;
    torsoRz = rand(5, 15) * DEG * severity;
    headRx = rand(5, 15) * DEG;
    headRy = rand(-25, -10) * DEG * severity;
  } else if (hitFrom === 'right') {
    torsoRx = rand(-10, 0) * DEG;
    torsoRy = rand(-35, -15) * DEG * severity;
    torsoRz = rand(-15, -5) * DEG * severity;
    headRx = rand(5, 15) * DEG;
    headRy = rand(10, 25) * DEG * severity;
  } else {
    torsoRx = rand(-30, -15) * DEG * severity;
    torsoRy = rand(-10, 10) * DEG;
    torsoRz = rand(-5, 5) * DEG;
    headRx = rand(15, 30) * DEG * severity;
    headRy = rand(-10, 10) * DEG;
  }

  return {
    name: `hit_reaction_v${String(i + 1).padStart(2, '0')}`,
    category: 'hit_reaction',
    pose: makePose({
      torso: { rx: torsoRx, ry: torsoRy, rz: torsoRz },
      head: { rx: headRx, ry: headRy },
      upperArmR: { rx: rand(-30, 0) * DEG, rz: rand(-60, -30) * DEG * severity },
      lowerArmR: { rx: rand(-15, 0) * DEG },
      upperArmL: { rx: rand(0, 20) * DEG * severity, rz: rand(30, 60) * DEG * severity },
      lowerArmL: { rx: rand(-15, 0) * DEG },
      upperLegR: { rx: rand(-15, 5) * DEG },
      lowerLegR: { rx: rand(10, 30) * DEG * severity },
      upperLegL: { rx: rand(0, 15) * DEG },
      lowerLegL: { rx: rand(5, 15) * DEG },
    }),
    metadata: { hitFrom, severity: severity.toFixed(2) },
  };
}

// ═══════════════════════════════════════════════════════
// 9. DODGE / SIDESTEP  (30 variations)
// ═══════════════════════════════════════════════════════
function generateDodge(i) {
  const dodgeType = pick(['sidestep_left', 'sidestep_right', 'duck', 'lean_back']);
  let pose;

  if (dodgeType === 'sidestep_left' || dodgeType === 'sidestep_right') {
    const dir = dodgeType === 'sidestep_left' ? 1 : -1;
    pose = makePose({
      torso: { rx: rand(10, 20) * DEG, rz: rand(5, 20) * DEG * dir },
      head: { rx: rand(-10, -3) * DEG, rz: rand(-5, 5) * DEG },
      upperArmR: { rx: rand(-70, -40) * DEG, rz: rand(-35, -15) * DEG },
      lowerArmR: { rx: rand(-30, -10) * DEG },
      upperArmL: { rx: rand(-30, -10) * DEG, rz: rand(15, 35) * DEG },
      lowerArmL: { rx: rand(-25, -10) * DEG },
      upperLegR: { rx: rand(-30, -15) * DEG * (dir > 0 ? 1 : 0.5) },
      lowerLegR: { rx: rand(20, 40) * DEG },
      upperLegL: { rx: rand(-30, -15) * DEG * (dir < 0 ? 1 : 0.5) },
      lowerLegL: { rx: rand(20, 40) * DEG },
    });
  } else if (dodgeType === 'duck') {
    const squat = rand(0.5, 1.0);
    pose = makePose({
      torso: { rx: rand(15, 30) * DEG * squat },
      head: { rx: rand(-15, -5) * DEG },
      upperArmR: { rx: rand(-60, -30) * DEG, rz: rand(-30, -15) * DEG },
      lowerArmR: { rx: rand(-40, -15) * DEG },
      upperArmL: { rx: rand(-30, -10) * DEG, rz: rand(15, 30) * DEG },
      lowerArmL: { rx: rand(-30, -10) * DEG },
      upperLegR: { rx: rand(-35, -20) * DEG * squat },
      lowerLegR: { rx: rand(40, 70) * DEG * squat },
      upperLegL: { rx: rand(-35, -20) * DEG * squat },
      lowerLegL: { rx: rand(40, 70) * DEG * squat },
    });
  } else {
    pose = makePose({
      torso: { rx: rand(-20, -10) * DEG },
      head: { rx: rand(5, 15) * DEG },
      upperArmR: { rx: rand(-50, -25) * DEG, rz: rand(-40, -20) * DEG },
      lowerArmR: { rx: rand(-20, -5) * DEG },
      upperArmL: { rx: rand(-20, 0) * DEG, rz: rand(25, 45) * DEG },
      lowerArmL: { rx: rand(-15, -5) * DEG },
      upperLegR: { rx: rand(5, 20) * DEG },
      lowerLegR: { rx: rand(15, 30) * DEG },
      upperLegL: { rx: rand(5, 20) * DEG },
      lowerLegL: { rx: rand(15, 30) * DEG },
    });
  }

  return {
    name: `dodge_v${String(i + 1).padStart(2, '0')}`,
    category: 'dodge',
    pose,
    metadata: { dodgeType },
  };
}

// ═══════════════════════════════════════════════════════
// 10. DEATH / COLLAPSE  (30 variations)
// ═══════════════════════════════════════════════════════
function generateDeath(i) {
  const deathType = pick(['fall_back', 'fall_forward', 'crumple', 'dramatic_spin']);
  let pose;

  if (deathType === 'fall_back') {
    pose = makePose({
      torso: { rx: rand(-40, -20) * DEG, ry: rand(-20, 20) * DEG, rz: rand(-15, 15) * DEG },
      head: { rx: rand(15, 35) * DEG, ry: rand(-20, 20) * DEG },
      upperArmR: { rx: rand(0, 30) * DEG, rz: rand(-80, -40) * DEG },
      lowerArmR: { rx: rand(-15, 0) * DEG },
      upperArmL: { rx: rand(0, 30) * DEG, rz: rand(40, 80) * DEG },
      lowerArmL: { rx: rand(-15, 0) * DEG },
      upperLegR: { rx: rand(-25, -5) * DEG },
      lowerLegR: { rx: rand(20, 50) * DEG },
      upperLegL: { rx: rand(-10, 15) * DEG },
      lowerLegL: { rx: rand(5, 30) * DEG },
    });
  } else if (deathType === 'fall_forward') {
    pose = makePose({
      torso: { rx: rand(20, 45) * DEG, ry: rand(-15, 15) * DEG, rz: rand(-10, 10) * DEG },
      head: { rx: rand(-20, -5) * DEG, ry: rand(-15, 15) * DEG },
      upperArmR: { rx: rand(-30, 10) * DEG, rz: rand(-60, -30) * DEG },
      lowerArmR: { rx: rand(-30, -5) * DEG },
      upperArmL: { rx: rand(-30, 10) * DEG, rz: rand(30, 60) * DEG },
      lowerArmL: { rx: rand(-30, -5) * DEG },
      upperLegR: { rx: rand(-5, 15) * DEG },
      lowerLegR: { rx: rand(10, 35) * DEG },
      upperLegL: { rx: rand(5, 20) * DEG },
      lowerLegL: { rx: rand(5, 25) * DEG },
    });
  } else if (deathType === 'crumple') {
    pose = makePose({
      torso: { rx: rand(25, 45) * DEG, ry: rand(-10, 10) * DEG },
      head: { rx: rand(-25, -10) * DEG, ry: rand(-20, 20) * DEG, rz: rand(-15, 15) * DEG },
      upperArmR: { rx: rand(-10, 20) * DEG, rz: rand(-50, -20) * DEG },
      lowerArmR: { rx: rand(-40, -10) * DEG },
      upperArmL: { rx: rand(-10, 20) * DEG, rz: rand(20, 50) * DEG },
      lowerArmL: { rx: rand(-40, -10) * DEG },
      upperLegR: { rx: rand(-40, -20) * DEG },
      lowerLegR: { rx: rand(60, 90) * DEG },
      upperLegL: { rx: rand(-30, -10) * DEG },
      lowerLegL: { rx: rand(50, 80) * DEG },
    });
  } else {
    // dramatic spin
    const spinDir = pick([-1, 1]);
    pose = makePose({
      torso: { rx: rand(-20, 10) * DEG, ry: rand(30, 60) * DEG * spinDir, rz: rand(10, 25) * DEG * spinDir },
      head: { rx: rand(10, 25) * DEG, ry: rand(-30, -10) * DEG * spinDir, rz: rand(-10, 10) * DEG },
      upperArmR: { rx: rand(10, 40) * DEG, rz: rand(-90, -50) * DEG },
      lowerArmR: { rx: rand(-10, 0) * DEG },
      upperArmL: { rx: rand(10, 40) * DEG, rz: rand(50, 90) * DEG },
      lowerArmL: { rx: rand(-10, 0) * DEG },
      upperLegR: { rx: rand(-20, 0) * DEG },
      lowerLegR: { rx: rand(20, 45) * DEG },
      upperLegL: { rx: rand(5, 20) * DEG },
      lowerLegL: { rx: rand(10, 30) * DEG },
    });
  }

  return {
    name: `death_v${String(i + 1).padStart(2, '0')}`,
    category: 'death',
    pose,
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

// Round all radian values to 4 decimal places for readability
function roundPose(pose) {
  const rounded = {};
  for (const [joint, rot] of Object.entries(pose)) {
    rounded[joint] = {};
    for (const [axis, val] of Object.entries(rot)) {
      rounded[joint][axis] = Math.round(val * 10000) / 10000;
    }
  }
  return rounded;
}

for (const anim of allAnimations) {
  if (anim.pose) {
    anim.pose = roundPose(anim.pose);
  }
  if (anim.phases) {
    for (const [phase, pose] of Object.entries(anim.phases)) {
      anim.phases[phase] = roundPose(pose);
    }
  }
}

const output = {
  generated: new Date().toISOString(),
  totalCount: allAnimations.length,
  categories: [...new Set(allAnimations.map(a => a.category))],
  animations: allAnimations,
};

const outPath = resolve(__dirname, '../src/data/generated-poses.json');
writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(`Generated ${allAnimations.length} animations to ${outPath}`);
console.log('Categories:', output.categories.join(', '));
