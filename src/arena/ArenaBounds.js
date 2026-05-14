import { DEFAULT_STAGE, getStageDef } from './StageDefs.js';

const OCTAGON_SLOPE = Math.SQRT2 - 1;
let currentStageId = DEFAULT_STAGE;

export function setCurrentArenaStage(stageId) {
  currentStageId = getStageDef(stageId).id;
  return currentStageId;
}

export function getCurrentArenaStage() {
  return currentStageId;
}

export function getArenaBounds(stageId = currentStageId) {
  return getStageDef(stageId).bounds;
}

export function isPointInsideArena(x, z, stageId = currentStageId, margin = 0) {
  return isPointInsideBounds(x, z, getArenaBounds(stageId), margin);
}

export function isPointInsideBounds(x, z, bounds, margin = 0) {
  const expanded = expandBounds(bounds, margin);
  switch (expanded.type) {
    case 'circle':
      return Math.hypot(x, z) <= expanded.radius;
    case 'ellipse':
      return ((x * x) / (expanded.radiusX * expanded.radiusX)) + ((z * z) / (expanded.radiusZ * expanded.radiusZ)) <= 1;
    case 'octagon': {
      const ax = Math.abs(x);
      const az = Math.abs(z);
      return Math.max(ax, az) + OCTAGON_SLOPE * Math.min(ax, az) <= expanded.radius;
    }
    case 'roundedRect': {
      const qx = Math.abs(x) - (expanded.halfWidth - expanded.cornerRadius);
      const qz = Math.abs(z) - (expanded.halfDepth - expanded.cornerRadius);
      const ox = Math.max(qx, 0);
      const oz = Math.max(qz, 0);
      if (qx <= 0 && qz <= 0) return true;
      return Math.hypot(ox, oz) <= expanded.cornerRadius;
    }
    default:
      return true;
  }
}

export function getArenaBoundaryDistance(x, z, stageId = currentStageId, margin = 0) {
  return getBoundaryDistanceForBounds(x, z, getArenaBounds(stageId), margin);
}

export function getBoundaryDistanceForBounds(x, z, bounds, margin = 0) {
  const dist = Math.hypot(x, z);
  if (dist < 1e-6) return getMinExtent(expandBounds(bounds, margin));
  return getBoundaryDistanceOnRay(x / dist, z / dist, bounds, margin);
}

export function getBoundaryDistanceOnRay(nx, nz, bounds, margin = 0) {
  const expanded = expandBounds(bounds, margin);
  const maxExtent = getMaxExtent(expanded) + 4;
  let low = 0;
  let high = maxExtent;
  for (let i = 0; i < 28; i++) {
    const mid = (low + high) * 0.5;
    if (isPointInsideBounds(nx * mid, nz * mid, expanded, 0)) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return low;
}

export function getArenaEdgeDistance(x, z, stageId = currentStageId) {
  return getEdgeDistanceForBounds(x, z, getArenaBounds(stageId));
}

export function getEdgeDistanceForBounds(x, z, bounds) {
  return getBoundaryDistanceForBounds(x, z, bounds, 0) - Math.hypot(x, z);
}

export function clampPointToArena(pos, stageId = currentStageId, inset = 0.3) {
  return clampPointToBounds(pos, getArenaBounds(stageId), inset);
}

export function clampPointToBounds(pos, bounds, inset = 0.3) {
  if (isPointInsideBounds(pos.x, pos.z, bounds, -inset)) return pos;
  const dist = Math.hypot(pos.x, pos.z);
  if (dist < 1e-6) return pos;
  const boundary = getBoundaryDistanceOnRay(pos.x / dist, pos.z / dist, bounds, -inset);
  pos.x = (pos.x / dist) * boundary;
  pos.z = (pos.z / dist) * boundary;
  return pos;
}

function expandBounds(bounds, margin = 0) {
  switch (bounds.type) {
    case 'circle':
      return { ...bounds, radius: Math.max(0.2, bounds.radius + margin) };
    case 'ellipse':
      return {
        ...bounds,
        radiusX: Math.max(0.2, bounds.radiusX + margin),
        radiusZ: Math.max(0.2, bounds.radiusZ + margin),
      };
    case 'octagon':
      return { ...bounds, radius: Math.max(0.2, bounds.radius + margin) };
    case 'roundedRect':
      return {
        ...bounds,
        halfWidth: Math.max(0.3, bounds.halfWidth + margin),
        halfDepth: Math.max(0.3, bounds.halfDepth + margin),
        cornerRadius: Math.max(0.05, bounds.cornerRadius + margin),
      };
    default:
      return bounds;
  }
}

function getMaxExtent(bounds) {
  switch (bounds.type) {
    case 'circle':
    case 'octagon':
      return bounds.radius;
    case 'ellipse':
      return Math.max(bounds.radiusX, bounds.radiusZ);
    case 'roundedRect':
      return Math.max(bounds.halfWidth, bounds.halfDepth);
    default:
      return 8;
  }
}

function getMinExtent(bounds) {
  switch (bounds.type) {
    case 'circle':
    case 'octagon':
      return bounds.radius;
    case 'ellipse':
      return Math.min(bounds.radiusX, bounds.radiusZ);
    case 'roundedRect':
      return Math.min(bounds.halfWidth, bounds.halfDepth);
    default:
      return 8;
  }
}
