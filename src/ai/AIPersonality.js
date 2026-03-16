const COMMON_DEFAULTS = Object.freeze({
  reactionFrames: 15,
  decisionNoise: 0.2,
  aggression: 0.5,
  parryRate: 0.15,
  dodgeRate: 0.2,
  counterRate: 0.5,
  punishRate: 0.4,
  heavyMixup: 0.3,
  spacingAwareness: 0.5,
  quickBias: 0,
  heavyBias: 0,
  thrustBias: 0,
  blockBias: 0,
  parryBias: 0,
  sidestepBias: 0,
  backstepBias: 0,
  moveForwardBias: 0,
  moveBackBias: 0,
  idleBias: 0,
});

export const AI_PROFILE_LIBRARY = {
  baseline: {
    ...COMMON_DEFAULTS,
  },
  aggressor: {
    ...COMMON_DEFAULTS,
    reactionFrames: 10,
    decisionNoise: 0.1,
    aggression: 0.9,
    parryRate: 0.08,
    dodgeRate: 0.12,
    counterRate: 0.25,
    punishRate: 0.35,
    heavyMixup: 0.45,
    spacingAwareness: 0.15,
    quickBias: 0.15,
    heavyBias: 0.12,
    moveForwardBias: 0.18,
    sidestepBias: -0.08,
    moveBackBias: -0.1,
  },
  turtler: {
    ...COMMON_DEFAULTS,
    reactionFrames: 12,
    decisionNoise: 0.1,
    aggression: 0.28,
    parryRate: 0.1,
    dodgeRate: 0.15,
    counterRate: 0.25,
    punishRate: 0.35,
    heavyMixup: 0.05,
    spacingAwareness: 0.75,
    blockBias: 0.22,
    moveBackBias: 0.1,
    sidestepBias: -0.02,
    moveForwardBias: -0.1,
    quickBias: 0.04,
  },
  duelist: {
    ...COMMON_DEFAULTS,
    reactionFrames: 6,
    decisionNoise: 0.08,
    aggression: 0.45,
    parryRate: 0.45,
    dodgeRate: 0.18,
    counterRate: 0.8,
    punishRate: 0.7,
    heavyMixup: 0.2,
    spacingAwareness: 0.6,
    parryBias: 0.2,
    thrustBias: 0.1,
    blockBias: -0.08,
  },
  evasive: {
    ...COMMON_DEFAULTS,
    reactionFrames: 8,
    decisionNoise: 0.12,
    aggression: 0.45,
    parryRate: 0.08,
    dodgeRate: 0.45,
    counterRate: 0.35,
    punishRate: 0.65,
    heavyMixup: 0.1,
    spacingAwareness: 0.8,
    sidestepBias: 0.08,
    backstepBias: 0.02,
    moveBackBias: 0.04,
    moveForwardBias: 0.06,
    quickBias: 0.08,
    blockBias: -0.05,
    idleBias: -0.08,
  },
  punisher: {
    ...COMMON_DEFAULTS,
    reactionFrames: 7,
    decisionNoise: 0.06,
    aggression: 0.4,
    parryRate: 0.18,
    dodgeRate: 0.25,
    counterRate: 0.75,
    punishRate: 0.9,
    heavyMixup: 0.35,
    spacingAwareness: 0.85,
    heavyBias: 0.08,
    thrustBias: 0.12,
    moveForwardBias: -0.05,
    idleBias: -0.05,
  },
};

export const AI_DIFFICULTY_ALIASES = Object.freeze({
  easy: 'turtler',
  medium: 'punisher',
  hard: 'evasive',
});

export const AI_PRESETS = {
  easy: AI_PROFILE_LIBRARY[AI_DIFFICULTY_ALIASES.easy],
  medium: AI_PROFILE_LIBRARY[AI_DIFFICULTY_ALIASES.medium],
  hard: AI_PROFILE_LIBRARY[AI_DIFFICULTY_ALIASES.hard],
};

export function resolveAIPersonality(profile) {
  if (typeof profile === 'string') {
    const aliasTarget = AI_DIFFICULTY_ALIASES[profile];
    if (aliasTarget) {
      return {
        name: profile,
        personality: { ...AI_PROFILE_LIBRARY[aliasTarget] },
        baseProfile: aliasTarget,
      };
    }

    const personality = AI_PROFILE_LIBRARY[profile] || AI_PROFILE_LIBRARY.baseline;
    return {
      name: profile in AI_PROFILE_LIBRARY ? profile : 'baseline',
      personality: { ...personality },
      baseProfile: profile in AI_PROFILE_LIBRARY ? profile : 'baseline',
    };
  }
  return {
    name: profile?.name || 'custom',
    personality: { ...COMMON_DEFAULTS, ...(profile || {}) },
    baseProfile: 'custom',
  };
}
