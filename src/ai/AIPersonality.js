export const AI_PRESETS = {
  easy: {
    reactionFrames: 30,
    decisionNoise: 0.4,
    aggression: 0.3,
    parryRate: 0.05,
    dodgeRate: 0.1,
    counterRate: 0.1,    // chance to counter-attack after parry/whiff
    punishRate: 0.1,     // chance to punish recovery windows
    heavyMixup: 0.1,     // tendency to use heavy attacks vs blockers
    spacingAwareness: 0.2, // how well AI maintains optimal range
  },
  medium: {
    reactionFrames: 15,
    decisionNoise: 0.2,
    aggression: 0.5,
    parryRate: 0.15,
    dodgeRate: 0.2,
    counterRate: 0.5,
    punishRate: 0.4,
    heavyMixup: 0.3,
    spacingAwareness: 0.5,
  },
  hard: {
    reactionFrames: 4,
    decisionNoise: 0.05,
    aggression: 0.7,
    parryRate: 0.5,
    dodgeRate: 0.35,
    counterRate: 0.9,
    punishRate: 0.85,
    heavyMixup: 0.5,
    spacingAwareness: 0.85,
  },
};
