# Character Alignment Notes

There are two distinct transform systems that can make a character "look rotated" in-game.

Do not treat them as interchangeable.

## 1. Whole-Model Alignment

Fields in [CharacterDefs.js](/abs/path/not-used):
- `modelYOffset`
- `modelRotationX`
- potentially `rootRotationY`

Applied in:
- [src/entities/Fighter.js](C:/Users/cobra/wuxia-warrior/src/entities/Fighter.js)

What this does:
- moves or rotates the entire rendered model root
- affects every clip the same way
- does **not** change the authored pose inside an animation

Use this for:
- asset grounding
- global visual tilt
- model facing/alignment fixes
- "this whole character sits too high / too low / too upright"

## 2. Animation Pose Tweaks

Fields in [src/entities/CharacterDefs.js](C:/Users/cobra/wuxia-warrior/src/entities/CharacterDefs.js):
- `hipsLeanDeg`
- `swapIdle`

Applied in:
- [src/entities/ModelLoader.js](C:/Users/cobra/wuxia-warrior/src/entities/ModelLoader.js)

What this does:
- edits animation clip data during load
- affects only selected clips
- changes the internal pose, not the whole model root

Use this for:
- making walk/idle feel more forward-leaning
- swapping to a better idle clip
- clip-specific presentation adjustments

## Practical Rule

If the problem is:

- "the entire character looks too high / low / tilted in every animation"
  - use `modelYOffset` / `modelRotationX`

- "the walk/idle/combat pose itself needs to lean differently"
  - use `hipsLeanDeg` or another clip-level tweak

## Why This Matters

If you forget one of these layers exists, it is easy to:
- "fix" the wrong system
- stack two rotations on top of each other
- think a rotation is not working when it is actually being canceled or applied somewhere else

## Current Code Paths

- whole-model alignment: [src/entities/Fighter.js](C:/Users/cobra/wuxia-warrior/src/entities/Fighter.js)
- clip-pose tweaking: [src/entities/ModelLoader.js](C:/Users/cobra/wuxia-warrior/src/entities/ModelLoader.js)
- per-character values: [src/entities/CharacterDefs.js](C:/Users/cobra/wuxia-warrior/src/entities/CharacterDefs.js)
