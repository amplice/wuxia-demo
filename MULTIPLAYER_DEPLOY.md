## Multiplayer Server

The multiplayer service is a separate Node websocket server:

```powershell
npm run multiplayer:server
```

It exposes:

- health check: `/health`
- info endpoint: `/`
- websocket endpoint: `/ws`

## Deploy Shape

Deploy the multiplayer server separately from the frontend and run:

```powershell
node server/multiplayer-server.mjs
```

Use one of:

- `PORT`
- `MULTIPLAYER_PORT`

The server listens on `0.0.0.0`.

## Frontend Config

Point the web client at the deployed websocket host with:

```text
VITE_MULTIPLAYER_WS_URL=wss://your-multiplayer-host.example/ws
```

If this is not set:

- dev defaults to `ws://<host>:3010/ws`
- production defaults to same-origin `/ws`

So:

- same host/path proxy deployment: no frontend env var required
- separate websocket host: set `VITE_MULTIPLAYER_WS_URL`

## Lobby Cleanup

The server automatically expires stale lobbies.

Configurable env vars:

- `LOBBY_SWEEP_INTERVAL_MS`
- `EMPTY_LOBBY_TTL_MS`
- `PUBLIC_LOBBY_IDLE_TTL_MS`
- `PRIVATE_LOBBY_IDLE_TTL_MS`
- `MATCH_COMPLETE_TTL_MS`

Default behavior:

- empty lobbies expire quickly
- waiting public lobbies expire after inactivity
- waiting private lobbies expire later
- completed matches are cleaned up automatically

## Current Intended UX

- public room list is the primary join path
- quick match is supported
- direct lobby code is fallback only
