import { ARENA_RADIUS } from '../core/Constants.js';

export function getCurrentArenaStage() {
  return 'default';
}

export function getArenaBounds() {
  return { type: 'circle', radius: ARENA_RADIUS };
}

export function isPointInsideArena(x, z, _stageId = null, margin = 0) {
  return Math.hypot(x, z) <= ARENA_RADIUS + margin;
}

export function getArenaBoundaryDistance(x, z, _stageId = null, margin = 0) {
  const dist = Math.hypot(x, z);
  if (dist < 1e-6) return ARENA_RADIUS + margin;
  return Math.max(0, ARENA_RADIUS + margin);
}

export function getArenaEdgeDistance(x, z) {
  return ARENA_RADIUS - Math.hypot(x, z);
}

export function clampPointToArena(pos, _stageId = null, inset = 0.3) {
  const maxRadius = Math.max(0.2, ARENA_RADIUS - inset);
  const dist = Math.hypot(pos.x, pos.z);
  if (dist <= maxRadius || dist < 1e-6) return pos;
  pos.x = (pos.x / dist) * maxRadius;
  pos.z = (pos.z / dist) * maxRadius;
  return pos;
}
