# Multiplayer Dev Notes

Current direction: server-authoritative.

What exists now:
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
- fallback hand-authored pose code still exists for missing tracks
- local offline play and web self-play still use the animation-driven browser fighter

That means:
- the authoritative match host is real
- the browser client path is real
- browser-level online smoke now passes locally
- but server/client combat parity is still not final because only weapon tracks were sampled; the full fighter still is not shared

Next required refactor:
1. tighten `FighterSim` geometry until it matches browser combat closely enough
2. sample additional authoritative data if needed (for example more non-attack clips or body anchor paths)
3. or split browser `Fighter` into simulation + view so both server and client share the exact same fighter core
4. add a proper lobby/ready/error UI around the existing online flow

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

Generate authoritative sampled tracks:

```powershell
npm run generate:authoritative-tracks
```

Websocket endpoint:

```text
ws://localhost:3010/ws
```
