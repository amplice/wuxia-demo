# Self-Play Tournament

This project now has a real self-play harness that runs the existing combat simulation headlessly.

It does not fake outcomes. It uses:
- the real fighter logic
- the real AI controller
- the real hit / block / clash / knockback code
- the real character assets and animation-driven combat checks

## Files

- tournament entry page: [tournament.html](C:/Users/cobra/wuxia-warrior/tournament.html)
- page bootstrap: [src/tournament-main.js](C:/Users/cobra/wuxia-warrior/src/tournament-main.js)
- self-play runner: [src/sim/SelfPlayRunner.js](C:/Users/cobra/wuxia-warrior/src/sim/SelfPlayRunner.js)
- AI profiles: [src/ai/AIPersonality.js](C:/Users/cobra/wuxia-warrior/src/ai/AIPersonality.js)
- AI logic: [src/ai/AIController.js](C:/Users/cobra/wuxia-warrior/src/ai/AIController.js)
- tournament launcher: [scripts/selfplay-tournament.mjs](C:/Users/cobra/wuxia-warrior/scripts/selfplay-tournament.mjs)
- result analyzer: [scripts/analyze-selfplay.mjs](C:/Users/cobra/wuxia-warrior/scripts/analyze-selfplay.mjs)

## How To Run

Small smoke test:

```powershell
node scripts/selfplay-tournament.mjs --profiles=medium --chars=spearman --repeats=1 --max-round-frames=120
```

Full round-robin:

```powershell
node scripts/selfplay-tournament.mjs --repeats=3 --max-round-frames=1200 --rounds-to-win=2 --max-match-rounds=3
```

Analyze the latest result:

```powershell
node scripts/analyze-selfplay.mjs
```

Analyze a specific result:

```powershell
node scripts/analyze-selfplay.mjs analysis/selfplay-2026-03-15T22-53-56-455Z.json
```

## Current Profiles

- `medium`
- `aggressor`
- `turtler`
- `duelist`
- `evasive`
- `punisher`

These are intentionally different styles, not just numeric difficulty levels.

## Shipped Difficulty Mapping

The player-facing difficulty labels now map to real tournament-tested strategy profiles:

- `easy` -> `turtler`
- `medium` -> `punisher`
- `hard` -> `evasive`

Reasoning:
- `hard` should use the strongest current profile
- `medium` should be strong and disciplined without being the top tournament winner
- `easy` should remain beatable and more passive

## What The Runner Measures

Per match and per side:
- attacks started
- attacks whiffed
- attack type mix
- sidesteps
- backsteps
- blocks
- parries
- clashes
- blocked hits
- parry successes
- clean hits
- kills
- deaths
- ring-out kills
- sidestep-follow-up kills

Tournament summary:
- decisive matches vs draws
- class win totals
- profile win totals
- matchup records
- global whiff rate
- global sidestep-kill share

## Important Design Assumption

The combat model is now primarily contact-driven:
- attack state means "attack in progress"
- valid hits come from weapon geometry + motion + contact window
- the self-play harness is useful because it exercises those real systems at scale

## Iteration Notes

### Baseline tournament

Result file:
- `analysis/selfplay-2026-03-15T22-47-46-104Z.json`

Key findings:
- spearman won `191` decisive matches vs ronin `116`
- decisive share: spearman `62.2%`
- draws: `125 / 432`
- whiff rate: `90.6%`

Interpretation:
- spear was materially advantaged
- AI was wasting far too many attacks
- defensive / evasive styles often stalled into draws

### First AI iteration

Main changes:
- penalized attacks right after whiffs
- reduced attacks into fresh sidesteps
- reduced some passive profile extremes

Result file:
- `analysis/selfplay-2026-03-15T22-51-16-641Z.json`

Findings:
- whiff rate improved to `80.7%`
- draws improved to `81 / 432`
- but sidestep-kill share jumped to `37.1%`
- spearman dominance worsened to `66.7%` of decisive wins

Interpretation:
- this over-corrected into mobility-heavy behavior
- spear users exploited sidestep angles too well

### Second AI iteration

Main changes:
- reduced unconditional sidestep scoring
- added mobility fatigue
- stronger penalties for repeated sidesteps / backsteps
- when flanked, favor opening distance and reacquiring front instead of orbiting

Result file:
- `analysis/selfplay-2026-03-15T22-53-56-455Z.json`

Current findings:
- decisive matches: `349`
- draws: `83`
- class wins: spearman `171`, ronin `178`
- global whiff rate: `85.9%`
- sidestep kills: `74 / 719` = `10.3%`

Interpretation:
- class balance is now much closer to even
- sidestep exploitation is no longer the dominant pattern
- whiff rate is still too high
- `evasive` is now the strongest tournament profile and should be watched for degeneracy

## Current Practical Conclusion

The latest state is materially better than the baseline:
- class balance is near even
- draw rate is lower
- sidestep abuse is no longer dominating the results

The next likely AI improvement targets are:
1. reduce whiff rate further without pushing the system back into draw-heavy passivity
2. keep `evasive` strong but stop it from becoming the single dominant style
3. decide which profile should back the shipped CPU defaults for `medium` and `hard`

### Difficulty validation

Result file:
- `analysis/selfplay-2026-03-16T02-03-18-677Z.json`

Setup:
- profiles: `easy, medium, hard`
- repeats: `8`
- `roundsToWin = 2`
- `maxMatchRounds = 3`

Result:
- decisive matches: `243`
- draws: `45`
- profile wins:
  - `hard`: `125`
  - `medium`: `78`
  - `easy`: `40`

Interpretation:
- the shipped preset ordering is correct
- `hard > medium > easy` in actual self-play
- class balance remains acceptable in the preset-only run:
  - spearman `129`
  - ronin `114`
