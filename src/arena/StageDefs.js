import { ARENA_RADIUS } from '../core/Constants.js';

export const DEFAULT_STAGE = 'test';

export const STAGE_DEFS = Object.freeze({
  test: Object.freeze({
    id: 'test',
    displayName: 'Test',
    description: 'Clean circular gameplay test arena',
    bounds: Object.freeze({ type: 'circle', radius: ARENA_RADIUS }),
  }),
  amphitheater: Object.freeze({
    id: 'amphitheater',
    displayName: 'Amphitheater',
    description: 'Ancient amphitheater model with original textures',
    modelPath: '/stages/ancient_amphitheater_model3_raw.glb',
    modelScale: 32,
    modelYOffset: 4.65,
    pitFloor: Object.freeze({
      radius: ARENA_RADIUS,
      y: 0,
      color: 0x9d6436,
    }),
    showBoundaryMarkers: false,
    bounds: Object.freeze({ type: 'circle', radius: ARENA_RADIUS }),
  }),
});

export function normalizeStageId(stageId) {
  return STAGE_DEFS[stageId] ? stageId : DEFAULT_STAGE;
}
