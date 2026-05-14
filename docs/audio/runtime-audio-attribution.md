# Runtime Audio Attribution

This documents the audio files currently wired into the game runtime under `public/audio/`.

## Attack Start

| Runtime Asset | Source Asset | License | Source |
|---|---|---|---|
| `public/audio/attack-start/knight-heavy.wav` | `Sword Whoosh 05.wav` | CC BY 4.0 | https://thesoundrack.itch.io/swords-blades-sound-pack |
| `public/audio/attack-start/knight-quick.wav` | `Sword Whoosh 03.wav` | CC BY 4.0 | https://thesoundrack.itch.io/swords-blades-sound-pack |
| `public/audio/attack-start/knight-thrust.wav` | `Sword Whoosh 06.wav` | CC BY 4.0 | https://thesoundrack.itch.io/swords-blades-sound-pack |
| `public/audio/attack-start/ronin-heavy.wav` | `Sword Whoosh 07.wav` | CC BY 4.0 | https://thesoundrack.itch.io/swords-blades-sound-pack |
| `public/audio/attack-start/ronin-quick.wav` | `Sword Whoosh 08.wav` | CC BY 4.0 | https://thesoundrack.itch.io/swords-blades-sound-pack |
| `public/audio/attack-start/ronin-thrust.ogg` | `whoosh_shortest_02.ogg` | CC BY 4.0 | https://tagirijus.itch.io/whoosh-sound-effects |
| `public/audio/attack-start/spearman-heavy.wav` | `Sword Whoosh 02.wav` | CC BY 4.0 | https://thesoundrack.itch.io/swords-blades-sound-pack |
| `public/audio/attack-start/spearman-quick.wav` | `Sword Whoosh 01.wav` | CC BY 4.0 | https://thesoundrack.itch.io/swords-blades-sound-pack |
| `public/audio/attack-start/spearman-thrust.ogg` | `whoosh_short_07.ogg` | CC BY 4.0 | https://tagirijus.itch.io/whoosh-sound-effects |

## Defense

| Runtime Asset | Source Asset | License | Source |
|---|---|---|---|
| `public/audio/defense/block-01.wav` | `01_ccby_swords_colliding_3.wav` | CC BY 4.0 | https://ivyism.itch.io/weaponry-pack |
| `public/audio/defense/block-02.wav` | `05_cc0_spear_sabre_haft_on_hilt.wav` | CC0 | https://opengameart.org/content/medieval-sound-effects-weapon-impacts |
| `public/audio/defense/parry-01.wav` | `01_ccby_clink.wav` | CC BY 4.0 | https://ivyism.itch.io/weaponry-pack |
| `public/audio/defense/parry-02.wav` | `03_cc0_clink3.wav` | CC0 | see `audio/review/README.md` |
| `public/audio/defense/clash-01.wav` | `02_ccby_swords_colliding_4.wav` | CC BY 4.0 | https://ivyism.itch.io/weaponry-pack |
| `public/audio/defense/clash-02.ogg` | `07_cc0_sword_clash_9.ogg` | CC0 | https://opengameart.org/content/20-sword-sound-effects-attacks-and-clashes |

## Hit

| Runtime Asset | Source Asset | License | Source |
|---|---|---|---|
| `public/audio/hit/light-01.wav` | `01_ccby_sword_hit_03.wav` | CC BY 4.0 | https://thesoundrack.itch.io/swords-blades-sound-pack |
| `public/audio/hit/light-02.ogg` | `06_cc0_impactMetal_light_003.ogg` | CC0 | https://kenney.nl/assets/impact-sounds |
| `public/audio/hit/heavy-01.wav` | `01_ccby_sword_hit_18.wav` | CC BY 4.0 | https://thesoundrack.itch.io/swords-blades-sound-pack |
| `public/audio/hit/heavy-02.ogg` | `06_cc0_impactMetal_heavy_001.ogg` | CC0 | https://kenney.nl/assets/impact-sounds |
| `public/audio/hit/thrust-01.wav` | `04_ccby_sword_hit_05.wav` | CC BY 4.0 | https://thesoundrack.itch.io/swords-blades-sound-pack |
| `public/audio/hit/thrust-02.ogg` | `06_cc0_impactPlate_light_002.ogg` | CC0 | https://kenney.nl/assets/impact-sounds |

## Movement

| Runtime Asset | Source Asset | License | Source |
|---|---|---|---|
| `public/audio/movement/sidestep-01.ogg` | `01_ccby_whoosh_shortest_03.ogg` | CC BY 4.0 | https://tagirijus.itch.io/whoosh-sound-effects |
| `public/audio/movement/sidestep-02.wav` | `04_cc0_air_move.wav` | CC0 | https://opengameart.org/content/air-woosh-move |
| `public/audio/movement/backstep-01.ogg` | `01_ccby_whoosh_short_04.ogg` | CC BY 4.0 | https://tagirijus.itch.io/whoosh-sound-effects |
| `public/audio/movement/backstep-02.wav` | `04_cc0_air_move.wav` | CC0 | https://opengameart.org/content/air-woosh-move |
| `public/audio/movement/footstep-01.wav` | `01_cc0_metal_steps_03.wav` | CC0 | https://opengameart.org/content/metal-footsteps-on-concrete |
| `public/audio/movement/footstep-02.wav` | `02_cc0_metal_steps_08.wav` | CC0 | https://opengameart.org/content/metal-footsteps-on-concrete |
| `public/audio/movement/footstep-03.ogg` | `04_cc0_fantozzi_stone_l1.ogg` | CC0 | https://opengameart.org/content/fantozzis-footsteps-grasssand-stone |
| `public/audio/movement/footstep-04.ogg` | `06_cc0_fantozzi_stone_r2.ogg` | CC0 | https://opengameart.org/content/fantozzis-footsteps-grasssand-stone |

## Notes

- `attack-start-attribution.md` remains accurate for the attack-start subset; this file is the broader runtime manifest.
- This file tracks only sounds currently referenced by `src/audio/AudioCatalog.js`.
- UI and system sounds are intentionally not wired into runtime audio right now.
