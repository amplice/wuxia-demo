export const STAGE_FX_DEFS = Object.freeze([
  Object.freeze({
    id: 'off',
    name: 'CLASSIC',
    tagline: 'Clean baseline render',
    description: 'No extra post look. Use the raw stage lighting, materials, and authored arena art only.',
    sourceHint: 'Baseline renderer',
  }),
  Object.freeze({
    id: 'arcade_steel',
    name: 'ARCADE STEEL',
    tagline: 'Punchy bloom / hot-cold contrast',
    description: 'A harder arcade frame with brighter steel, warmer highlights, cooler shadows, and a stronger cinematic punch.',
    sourceHint: 'Bloom + grade + chroma split',
  }),
  Object.freeze({
    id: 'ink_duel',
    name: 'ANIME CEL',
    tagline: 'Toon bands / comic contour',
    description: 'Flattened cel-style shading with cleaner contour emphasis so the fighters and arena read more like drawn panels than lit geometry.',
    sourceHint: 'Toon materials + contour pass',
  }),
  Object.freeze({
    id: 'dream_fever',
    name: 'DREAM FEVER',
    tagline: 'Soft bloom / spectral smear',
    description: 'Bright haze, spectral color bleed, and a soft trailing image that pushes the game toward a dreamlike wuxia frame.',
    sourceHint: 'Bloom + afterimage + chroma split',
  }),
  Object.freeze({
    id: 'crt_blood',
    name: 'CRT BLOOD',
    tagline: 'Scanlines / fringe / broadcast decay',
    description: 'A hard retro monitor treatment with visible scanlines, color separation, and a dirtier signal.',
    sourceHint: 'Scanlines + grain + chroma split',
  }),
]);

export const DEFAULT_STAGE_FX = 'off';

export function getStageFxDef(effectId = DEFAULT_STAGE_FX) {
  return STAGE_FX_DEFS.find((entry) => entry.id === effectId) ?? STAGE_FX_DEFS[0];
}
