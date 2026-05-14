export const ATTACK_START_SOUND_MAP = Object.freeze({
  knight: Object.freeze({
    quick: '/audio/attack-start/knight-quick.wav',
    heavy: '/audio/attack-start/knight-heavy.wav',
    thrust: '/audio/attack-start/knight-thrust.wav',
  }),
  huscarl: Object.freeze({
    quick: '/audio/attack-start/knight-quick.wav',
    heavy: '/audio/attack-start/knight-heavy.wav',
    thrust: '/audio/attack-start/knight-thrust.wav',
  }),
  ronin: Object.freeze({
    quick: '/audio/attack-start/ronin-quick.wav',
    heavy: '/audio/attack-start/ronin-heavy.wav',
    thrust: '/audio/attack-start/ronin-thrust.ogg',
  }),
  spearman: Object.freeze({
    quick: '/audio/attack-start/spearman-quick.wav',
    heavy: '/audio/attack-start/spearman-heavy.wav',
    thrust: '/audio/attack-start/spearman-thrust.ogg',
  }),
});

export function getAttackStartSoundId(charId, attackType) {
  if (!charId || !attackType) return null;
  return `${charId}:${attackType}`;
}

export function listAttackStartSounds() {
  const entries = [];
  for (const [charId, attackMap] of Object.entries(ATTACK_START_SOUND_MAP)) {
    for (const [attackType, url] of Object.entries(attackMap)) {
      entries.push({
        id: getAttackStartSoundId(charId, attackType),
        url,
      });
    }
  }
  return entries;
}
