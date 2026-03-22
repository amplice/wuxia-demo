# Multiplayer Dev Notes

Current direction: server-authoritative.

What exists now:
- `src/combat/FighterCore.js`
  - shared non-visual fighter core used by both browser `Fighter` and headless `FighterSim`
  - owns shared facing, movement, lunge, reset, weapon-velocity bookkeeping, snapshot application, and presentation-clip selection
- `src/sim/MatchSim.js`
  - shared combat simulation used by local `Game` flow and self-play
- `src/sim/InputFrame.js`
  - serializable per-frame input format
- `src/sim/FighterSim.js`
  - headless fighter used by the Node multiplayer server
  - now consumes sampled authoritative weapon tracks from real browser-loaded GLB clips
- `src/net/Protocol.js`
  - shared websocket message types and payload validation helpers
- `src/net/MultiplayerClient.js`
  - browser websocket transport wrapper
- `src/net/OnlineSession.js`
  - browser-side session wrapper used by the online game flow
- `server/multiplayer-server.mjs`
  - in-memory lobby server with:
    - create/join lobby
    - character select
    - ready state
    - ping/pong
    - input-frame acceptance
    - authoritative room ticking `MatchSim` at 60 Hz
    - round score tracking and automatic authoritative round restarts
    - periodic `state_snapshot` messages
    - `combat_event` and round-end `match_state` messages
- `scripts/smoke-multiplayer.mjs`
  - boots the local websocket server
  - connects two ws clients
  - creates a lobby, joins, readies, and verifies match start + snapshots
- `scripts/smoke-online-browser.mjs`
  - browser-level smoke harness for two-tab online flow
  - drives `Game`'s online session path directly and verifies both clients reach `fighting`
- `scripts/generate-authoritative-tracks.mjs`
  - boots the app in a headless browser
  - samples real GLB-driven weapon base/tip tracks from the browser fighter path
  - writes them to `src/data/authoritativeTracks.js`

What does **not** exist yet:
- reconnect flow
- prediction/rollback
- polished online UI
- exact server/client combat parity

Current state:
- browser-side online mode wiring now exists
- the client can connect, create/join a lobby, ready up, and render authoritative snapshots
- the client now follows authoritative round/match lifecycle and score updates
- the Node server still runs on `FighterSim`, not the browser `Fighter`
- `FighterSim` now uses sampled authoritative attack/idle weapon tracks from the real browser asset path
- `FighterSim` also uses sampled body-anchor data when available
- fallback hand-authored pose code still exists for missing tracks
- browser `Fighter` and headless `FighterSim` now share a real fighter core instead of fully duplicating their update/reset logic
- local offline play and web self-play still use the animation-driven browser fighter

That means:
- the authoritative match host is real
- the browser client path is real
- browser-level online smoke now passes locally
- but server/client combat parity is still not final because only weapon tracks were sampled; the full fighter still is not shared

Next required refactor:
1. tighten `FighterSim` geometry until it matches browser combat closely enough
2. sample additional authoritative data if needed (for example more non-attack clips or body anchor paths)
3. continue moving remaining duplicated fighter methods fully into `FighterCore`
4. or split browser `Fighter` further into explicit simulation + view layers
5. add a proper lobby/ready/error UI around the existing online flow

Local dev command:

```powershell
npm run multiplayer:server
```

Smoke check:

```powershell
npm run multiplayer:smoke
```

Browser smoke:

```powershell
npm run multiplayer:browser-smoke
```

Public lobby / quick-match smoke:

```powershell
npm run multiplayer:public-ui-smoke
```

Disconnect smoke:

```powershell
npm run multiplayer:disconnect-smoke
```

Online bot-vs-bot match over the real websocket server:

```powershell
npm run multiplayer:bot-match -- --repeats=3 --p1-profile=hard --p2-profile=medium --p1-char=spearman --p2-char=ronin
```

Generate authoritative sampled tracks:

```powershell
npm run generate:authoritative-tracks
```

Websocket endpoint:

```text
ws://localhost:3010/ws
```

## Multiplayer-Safe Workflow

When adding or changing gameplay that can affect state, timing, movement, or animation:

1. update the local/offline game logic
2. update sampled authoritative tracks if the weapon/body path changed
3. run the full multiplayer safety gate
4. only then treat the change as safe to build on

Full check:

```powershell
npm run multiplayer:check
```

That currently runs:

- production build
- authoritative parity check
- websocket smoke
- browser online smoke
- public lobby / quick-match smoke
- disconnect smoke

Use the smaller commands during iteration, but before committing gameplay changes that touch combat or movement, the expectation should be that `multiplayer:check` passes.

## What Codex Can Test

Codex can test multiplayer in several real ways already:

- headless websocket smoke against the real Node multiplayer server
- two-browser online smoke against the real game client
- public-lobby / quick-match browser smoke
- disconnect handling smoke
- server/client authoritative parity checks

What this does **not** replace:

- actual human-vs-human feel checks over real internet latency

If stronger automated coverage is needed later, the next logical step is:

- scripted online sparring clients that connect through the real websocket server and play repeated matches using either fixed input scripts or AI-driven input decisions

That now exists in initial form via `multiplayer:bot-match`.

Best use:

- regression-test the real online input/session pipeline
- catch authoritative lifecycle bugs that local self-play would miss

Use balance findings carefully:

- it is useful as a rough signal
- but it is still less authoritative for balance than local self-play plus human playtests
