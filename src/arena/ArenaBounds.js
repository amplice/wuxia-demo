import { DEFAULT_STAGE, STAGE_DEFS, normalizeStageId } from './StageDefs.js';

let currentArenaStage = DEFAULT_STAGE;

export function setCurrentArenaStage(stageId) {
  currentArenaStage = normalizeStageId(stageId);
  return currentArenaStage;
}

export function getCurrentArenaStage() {
  return currentArenaStage;
}

function getStageBounds(stageId = currentArenaStage) {
  return STAGE_DEFS[normalizeStageId(stageId)].bounds;
}

export function getArenaBounds(stageId = currentArenaStage) {
  return getStageBounds(stageId);
}

export function isPointInsideArena(x, z, stageId = null, margin = 0) {
  const bounds = getStageBounds(stageId ?? currentArenaStage);
  if (bounds.type === 'circle') {
    return Math.hypot(x, z) <= bounds.radius + margin;
  }
  return true;
}

export function getArenaBoundaryDistance(x, z, stageId = null, margin = 0) {
  const bounds = getStageBounds(stageId ?? currentArenaStage);
  if (bounds.type === 'circle') {
    return Math.max(0, bounds.radius + margin - Math.hypot(x, z));
  }
  return Infinity;
}

export function getArenaEdgeDistance(x, z, stageId = null) {
  const bounds = getStageBounds(stageId ?? currentArenaStage);
  if (bounds.type === 'circle') return bounds.radius - Math.hypot(x, z);
  return Infinity;
}

export function clampPointToArena(pos, stageId = null, inset = 0.3) {
  const bounds = getStageBounds(stageId ?? currentArenaStage);
  if (bounds.type === 'circle') {
    const maxRadius = Math.max(0.2, bounds.radius - inset);
    const dist = Math.hypot(pos.x, pos.z);
    if (dist <= maxRadius || dist < 1e-6) return pos;
    pos.x = (pos.x / dist) * maxRadius;
    pos.z = (pos.z / dist) * maxRadius;
  }
  return pos;
}
