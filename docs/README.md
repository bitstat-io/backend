# BitStat Docs

This document is the single source of truth for how the BitStat backend works and how to run it.

## Overview
BitStat is a Fastify API that ingests game events, builds leaderboards, and exposes public read endpoints. The backend is the single gateway to storage.

**Core Components**
- Game Client / SDK
- BitStat API (Fastify)
- Redis (leaderboards, hot metrics, events stream)
- Worker (Redis Streams consumer)
- Supabase Postgres (durable storage)

**System Diagram**
![System Overview](images/system-overview.svg)

## Technical Overview
This diagram is the fastest way to understand the MVP architecture end to end: who talks to the backend, what the API writes immediately, what the worker persists later, and which systems own truth versus cache.

![Technical Overview](images/technical-overview.svg)

## Tech Stack
- Runtime: Node.js with TypeScript
- API framework: Fastify
- Validation and API schemas: Zod with `fastify-type-provider-zod`
- Durable storage: Supabase Postgres
- Hot data and queueing: Redis with Redis Streams
- Auth: Supabase JWT verification with `jose`
- API documentation: Fastify Swagger / OpenAPI
- Tests: Vitest

## Architecture Decisions
- Postgres is the source of truth for tenants, games, publish state, API keys, scoring rules, and raw event history.
- Redis is the hot path for ingestion, leaderboards, dashboard metrics, deduplication, and worker buffering.
- Public visibility is explicit. A game becomes public only when the owner publishes `dev` or `prod`.
- `game_type` is free-form metadata, not a hard taxonomy. Scoring and stats should not depend on a fixed list of genres.
- API keys are stored as `key_hash` plus `key_prefix`. The backend returns the raw key once at creation time and does not support later retrieval.
- Images are not uploaded through this backend. Owners upload artwork to Supabase Storage and store the resulting `cover_image_url` on the game record.
- Ingestion is optimized for low-latency writes. The API writes to Redis first, then a worker persists durable records and aggregates to Postgres.
- The MVP favors operational simplicity over perfect fault isolation. Redis is required for the live ingest and public registry paths today.

## Implementation Approach
- The API process owns request validation, authentication, authorization, rate limiting, and fast writes to Redis.
- The worker process owns Redis Stream consumption, stale pending-message reclaim, and durable writes into Postgres leaderboard and raw event tables.
- Public leaderboard reads prefer Redis for speed and fall back to Postgres leaderboard aggregates when leaderboard cache data is missing.
- Public game discovery uses a Redis-backed registry keyed by publish state, with Postgres used to rebuild missing registry entries.
- Owner flows are explicit backend actions: create game, update metadata, create API key, publish, and unpublish.
- Scoring is applied during ingest using per-game rules from `public.core_scoring_rules` when available, with a simple event-property fallback for MVP usage.
- Stats are generic and event-driven. The backend increments common counters like `matches` and `sessions`, and aggregates numeric properties such as `kills`, `coins`, and `iap_amount`.

## Architecture Notes
- Every write is scoped by API key to `{tenantId, gameId, env}`.
- `env` is `dev` or `prod` and is stored with every record.
- Public leaderboards are available for both `dev` and `prod`.
- Raw events are retained for 3 months; aggregates are retained forever.
- The API writes to Redis; a worker flushes to Supabase via Redis Streams.
- Scoring rules can be stored per game in Supabase and applied during ingest.
- API keys are stored in Supabase as `key_hash` plus `key_prefix`.

## Data Flow

### Ingest Flow
1. Client sends `POST /v1/events/batch` with API key.
2. API validates schema, timestamps, and deduplication.
3. API computes score per event using per-game rules.
4. API writes to Redis leaderboards and metrics.
5. API appends raw events to a Redis Stream.
6. Worker consumes the stream and writes to Supabase.

![Ingest Flow](images/ingest-flow.svg)

### Leaderboard Read Flow
1. Frontend calls a public leaderboard endpoint.
2. API resolves the game slug in the Redis public registry for the requested env.
3. If the cached registry entry is missing, API can rebuild it from Postgres publish state.
4. API reads from Redis leaderboard keys.
5. API responds with ranked entries.

Note: public registry lookups still require Redis to be reachable. The current Postgres recovery path handles missing cache entries, not full Redis outages.

![Leaderboard Flow](images/leaderboard-flow.svg)

## API

### Frontend-Safe API (No Auth)
- `GET /v1/health`
- `GET /v1/games` (prod only)
- `GET /v1/games/{gameSlug}/leaderboards` (prod)
- `GET /v1/games/dev/{gameSlug}/leaderboards` (dev)

**Leaderboard query params**
- `window`: `all`, `1d`, `7d`, `30d`
- `limit`: max entries to return

### Requires API Key (or Supabase JWT for scoring routes)
- `POST /v1/events/batch`
- `GET /v1/games/:gameSlug/stats`
- `GET /v1/games/:gameSlug/scoring-rules`
- `POST /v1/games/:gameSlug/scoring-rules` (admin scope)
- `PUT /v1/games/:gameSlug/scoring-rules` (admin scope)
- `GET /v1/games/:gameSlug/scoring-rules/versions`
- `PUT /v1/games/:gameSlug/scoring-rules/versions/:version/activate` (admin scope)
- `DELETE /v1/games/:gameSlug/scoring-rules` (admin scope)
- `GET /v1/dashboard/*`

**Scoring rules auth**
- Scoring rules endpoints accept either an API key (admin/read) or a Supabase JWT (owner).
**Supabase JWT auth**
- Use `Authorization: Bearer <access_token>` from Supabase Auth.
- Set `SUPABASE_JWT_SECRET` (preferred) or `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` for verification.

### Supabase JWT (Owner) Only
- `GET /v1/dashboard/games`
- `POST /v1/dashboard/games`
- `PUT /v1/dashboard/games/:gameSlug`
- `PUT /v1/dashboard/games/:gameSlug/publish`
- `PUT /v1/dashboard/games/:gameSlug/unpublish`
- `GET /v1/dashboard/games/:gameSlug/api-keys`
- `POST /v1/dashboard/games/:gameSlug/api-keys`
- `DELETE /v1/dashboard/games/:gameSlug/api-keys/:keyId`

## API Data Formats

**Auth headers**
- API key: `X-API-Key: <key>` or `Authorization: Bearer <key>`
- Supabase JWT: `Authorization: Bearer <access_token>`

**Common error shape**
```json
{ "error": { "code": "UNAUTHORIZED", "message": "..." } }
```

### `GET /v1/health`
```json
{ "status": "ok", "redis": true }
```

### `GET /v1/games`
```json
{ "games": [{ "game_slug": "valorant" }] }
```

### `GET /v1/games/:gameSlug/leaderboards`
Query: `window=all|1d|7d|30d`, `limit=1..100`
```json
{
  "gameSlug": "valorant",
  "window": "1d",
  "entries": [{ "rank": 1, "user_id": "player_1", "score": 120 }]
}
```

### `GET /v1/games/dev/:gameSlug/leaderboards`
Query: `window=all|1d|7d|30d`, `limit=1..100`
```json
{
  "gameSlug": "valorant",
  "window": "1d",
  "entries": [{ "rank": 1, "user_id": "player_1", "score": 120 }]
}
```

### `POST /v1/events/batch`
Request body
```json
{
  "events": [
    {
      "user_id": "player_1",
      "session_id": "s1",
      "client_ts": 1761246154,
      "v": 1,
      "category": "combat",
      "event_id": "match_complete",
      "game_type": "fps",
      "platform": "pc",
      "region": "na",
      "event_properties": { "kills": 5, "deaths": 2, "assists": 1 }
    }
  ]
}
```
Response
```json
{ "accepted": 10, "rejected": 2, "errors": 0 }
```

### `GET /v1/games/:gameSlug/stats`
Query: `user_id=<player id>`
```json
{
  "gameSlug": "valorant",
  "user_id": "player_1",
  "stats": { "events": "12", "kills": "5" }
}
```

### `GET /v1/games/:gameSlug/scoring-rules`
```json
{
  "gameSlug": "valorant",
  "version": 3,
  "rules": {
    "weights": {
      "default": { "score": 1 },
      "category": { "combat": { "kills": 2 } },
      "event": { "monster_kill": { "kills": 3 } }
    }
  },
  "active": true
}
```

### `POST /v1/games/:gameSlug/scoring-rules`
Request body
```json
{
  "weights": {
    "default": { "score": 1 },
    "category": { "combat": { "kills": 2 } },
    "event": { "monster_kill": { "kills": 3 } }
  }
}
```
Response: same as `GET /v1/games/:gameSlug/scoring-rules`

### `PUT /v1/games/:gameSlug/scoring-rules`
Request body: same as `POST /v1/games/:gameSlug/scoring-rules`
Response: same as `GET /v1/games/:gameSlug/scoring-rules`

### `GET /v1/games/:gameSlug/scoring-rules/versions`
```json
{
  "gameSlug": "valorant",
  "versions": [
    { "version": 3, "active": true, "created_at": "2026-02-28T08:00:00.000Z" }
  ]
}
```

### `PUT /v1/games/:gameSlug/scoring-rules/versions/:version/activate`
Response: same as `GET /v1/games/:gameSlug/scoring-rules`

### `DELETE /v1/games/:gameSlug/scoring-rules`
```json
{ "gameSlug": "valorant", "active": false }
```

### `GET /v1/dashboard/overview`
Query: `range=5m|1h|24h|7d`
```json
{
  "range": "5m",
  "updatedAt": "2026-02-28T08:00:00.000Z",
  "summary": {
    "events": 120,
    "accepted": 118,
    "rejected": 2,
    "errors": 0,
    "uniquePlayers": 45,
    "errorRate": 0,
    "rejectRate": 0.016,
    "fpsEvents": 80,
    "mobileEvents": 38,
    "iap": 12.5,
    "eventsPerSec": 0.4
  },
  "recentEvents": [
    {
      "ts": "2026-02-28T08:00:00.000Z",
      "game_id": "uuid",
      "game_slug": "valorant",
      "event_id": "match_complete",
      "user_id": "player_1",
      "game_type": "fps",
      "platform": "pc",
      "region": "na"
    }
  ],
  "recentRejected": [
    {
      "ts": "2026-02-28T08:00:00.000Z",
      "reason": "invalid_schema",
      "event_id": "match_complete",
      "game_id": "uuid",
      "user_id": "player_1",
      "game_slug": "valorant",
      "tenant_id": "uuid",
      "category": "combat",
      "client_ts": 1761246154
    }
  ],
  "traffic": [
    {
      "ts": "2026-02-28T08:00:00.000Z",
      "events": 2,
      "accepted": 2,
      "rejected": 0,
      "errors": 0,
      "fps": 2,
      "mobile": 0,
      "iap": 0
    }
  ],
  "topGames": [{ "game_id": "uuid", "events": 20, "iap": 4.5 }],
  "topPlayers": [{ "user_id": "player_1", "score": 120 }]
}
```

### `GET /v1/dashboard/stream`
Query: `range=5m|1h|24h|7d`
SSE payload (each `data:` line) uses the same JSON shape as `GET /v1/dashboard/overview`.

### `GET /v1/dashboard/games`
```json
{
  "games": [
    {
      "id": "uuid",
      "slug": "valorant",
      "name": "Valorant",
      "game_type": "fps",
      "created_at": "2026-02-28T08:00:00.000Z"
    }
  ]
}
```

### `POST /v1/dashboard/games`
Request body
```json
{ "slug": "valorant", "name": "Valorant", "game_type": "fps" }
```
Response: same as `GET /v1/dashboard/games` entry.

### `GET /v1/dashboard/games/:gameSlug/api-keys`
```json
{
  "keys": [
    {
      "id": "uuid",
      "env": "prod",
      "scopes": ["ingest", "read"],
      "key_prefix": "bs_",
      "created_at": "2026-02-28T08:00:00.000Z",
      "revoked_at": null
    }
  ]
}
```

### `POST /v1/dashboard/games/:gameSlug/api-keys`
Request body
```json
{ "env": "prod", "scopes": ["ingest", "read"] }
```
Response (includes `key` on create)
```json
{
  "id": "uuid",
  "env": "prod",
  "scopes": ["ingest", "read"],
  "key_prefix": "bs_",
  "key": "bs_live_...",
  "created_at": "2026-02-28T08:00:00.000Z",
  "revoked_at": null
}
```

### `DELETE /v1/dashboard/games/:gameSlug/api-keys/:keyId`
```json
{ "id": "uuid", "revoked_at": "2026-02-28T08:00:00.000Z" }
```

## Event Schema
Required fields:
- `user_id`, `session_id`, `client_ts`, `category`, `event_id`, `event_properties`

Optional fields:
- `v`, `game_type`, `platform`, `region`

Rules:
- `category` must match `^[a-z0-9_-]{2,50}$` (lowercase).
- `event_properties` is a free-form JSON object capped by `EVENT_PROPERTIES_MAX_BYTES` (default 8 KB).
- `game_type` is optional metadata. It may be omitted entirely.

## Scoring Rules
Scores are computed during ingest and written to Redis + the stream.
- Per-game scoring rules (from `public.core_scoring_rules`) are applied first.
- If no rule is found, `event_properties.score` is used when present; otherwise `0`.
- Rule order: `event_id` → `category` → `default`.
- JWT verification is local when `SUPABASE_JWT_SECRET` is set; otherwise it falls back to `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`.

**Example rule JSON**
```json
{
  "weights": {
    "default": { "score": 1 },
    "category": {
      "combat": { "kills": 2, "boss": 10 }
    },
    "event": {
      "monster_kill": { "kills": 3, "boss": 20 }
    }
  }
}
```

## Data Model
The Supabase schema is stored at `db/schema.sql`.

**Retention**
- Raw events: 3 months.
- Aggregates: retained forever.
- `env` is `dev` or `prod` on all event and aggregate rows.

**Core Tables**
- `public.core_tenants` (owned by `email`)
- `public.core_games`
- `public.core_api_keys` (hashed)
- `public.core_scoring_rules` (versioned)

**Ingest**
- `public.ingest_events` (append-only). Use `dedup_id` + unique constraint to make writes idempotent.

**Analytics**
- `public.analytics_metric_definitions`
- `public.analytics_user_metrics`
- `public.analytics_leaderboard_daily`
- `public.analytics_leaderboard_all`

## Worker
The worker consumes the Redis events stream and writes data to Supabase.

**Stream**
- Key: `stream:events:{env}`
- Group: `REDIS_STREAM_GROUP` (default `bitstat-events`)
- Consumer: `REDIS_STREAM_CONSUMER` (defaults to `<host>-<pid>`)
- Heartbeat: `worker:heartbeat:{env}:{group}`
- Batch: `REDIS_STREAM_BATCH_SIZE` (default `200`)
- Block: `REDIS_STREAM_BLOCK_MS` (default `2000`)
- Max length: `REDIS_STREAM_MAXLEN` (default `200000`)

**Responsibilities**
- Insert raw events into `public.ingest_events` (idempotent via `dedup_id`).
- Increment `public.analytics_leaderboard_all` and `public.analytics_leaderboard_daily`.

**Run**
- `npm run worker`

**Required Env**
- `SUPABASE_DB_URL` (Supabase Postgres connection string)

## Environment Variables

| Variable | Required | Purpose | Example |
| --- | --- | --- | --- |
| `PORT` | No | API port | `3000` |
| `REDIS_URL` | Yes | Redis connection | `redis://localhost:6379` |
| `REDIS_STREAM_GROUP` | No | Streams consumer group | `bitstat-events` |
| `REDIS_STREAM_CONSUMER` | No | Consumer name | `host-1234` |
| `REDIS_STREAM_BATCH_SIZE` | No | Stream batch size | `200` |
| `REDIS_STREAM_BLOCK_MS` | No | Stream block time | `2000` |
| `REDIS_STREAM_MAXLEN` | No | Stream max length | `200000` |
| `SUPABASE_DB_URL` | Yes (worker, scoring rules, key mgmt) | Postgres connection | `postgresql://user:pass@host:5432/postgres` |
| `SUPABASE_JWT_SECRET` | Optional | Verify Supabase JWT locally | `super-secret` |
| `SUPABASE_URL` | Optional | Supabase project URL (fallback auth) | `https://xyz.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Optional | Supabase publishable key (fallback auth) | `sb_publishable_...` |
| `API_KEYS_JSON` | Optional | Static API keys (dev/bootstrap) | `[{"key":"...","tenantId":"...","gameId":"...","gameSlug":"valorant","env":"prod"}]` |
| `API_KEY_CACHE_TTL_MS` | No | API key lookup cache | `60000` |
| `RATE_LIMIT_MAX` | No | Rate limit max | `200` |
| `RATE_LIMIT_TIME_WINDOW_MS` | No | Rate window ms | `1000` |
| `READINESS_MAX_STREAM_PENDING` | No | Pending stream threshold | `1000` |
| `READINESS_WORKER_HEARTBEAT_TTL_SEC` | No | Worker heartbeat freshness window | `30` |
| `EVENT_MAX_PER_BATCH` | No | Max events/batch | `500` |
| `EVENT_FUTURE_MAX_DAYS` | No | Future timestamp allowance | `30` |
| `EVENT_PAST_MAX_DAYS` | No | Past timestamp allowance | `365` |
| `EVENT_DEDUP_TTL_SEC` | No | Dedup window | `0` |
| `EVENT_PROPERTIES_MAX_BYTES` | No | Max JSON bytes per `event_properties` | `8192` |
| `LEADERBOARD_TEMP_TTL_SEC` | No | Temp leaderboard TTL | `10` |
| `SCORING_RULE_CACHE_TTL_MS` | No | Scoring rule cache TTL | `180000` |

## Quickstart (Local)
1. Install Node.js 20+, Redis, and Postgres (or a Supabase project).
2. Apply the schema to Supabase.
3. Configure environment variables.
4. Start the API.
5. Start the worker.
6. Send a test ingest.

**Apply schema**
```bash
psql "$SUPABASE_DB_URL" -f backend/db/schema.sql
```

**Run API**
```bash
cd backend
npm install
npm run dev
```

**Run worker**
```bash
cd backend
npm run worker
```

## Redis Setup
Suggested Redis config lines:
```
appendonly yes
appendfsync everysec
maxmemory-policy noeviction
```

## Worker Runbook

**Start (systemd)**
```bash
sudo tee /etc/systemd/system/bitstat-worker.service > /dev/null <<'UNIT'
[Unit]
Description=BitStat Events Worker
After=network.target redis.service

[Service]
Type=simple
WorkingDirectory=/opt/bitstat/backend
EnvironmentFile=/etc/bitstat/worker.env
ExecStart=/usr/bin/npm run worker
Restart=always
RestartSec=2

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl daemon-reload
sudo systemctl enable --now bitstat-worker
```

**Check stream lag**
```bash
redis-cli XINFO GROUPS stream:events:prod
redis-cli XPENDING stream:events:prod bitstat-events
```

## Retention Job (Raw Events = 3 months)
Create a daily cron job that deletes old raw events.

**SQL**
```sql
DELETE FROM public.ingest_events
WHERE client_ts < now() - interval '3 months';
```

**Cron example**
```
0 3 * * * psql "$SUPABASE_DB_URL" -c "DELETE FROM public.ingest_events WHERE client_ts < now() - interval '3 months';"
```

## API Examples

**Health**
```bash
curl http://localhost:3000/v1/health
```

**List prod games**
```bash
curl http://localhost:3000/v1/games
```

**Prod leaderboard**
```bash
curl "http://localhost:3000/v1/games/valorant/leaderboards?window=1d&limit=10"
```

**Dev leaderboard**
```bash
curl "http://localhost:3000/v1/games/dev/valorant/leaderboards?window=1d&limit=10"
```

**Ingest (requires API key)**
```bash
curl -X POST http://localhost:3000/v1/events/batch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <YOUR_KEY>" \
  -d '{"events":[{"user_id":"player_1","session_id":"s1","client_ts":1761246154,"category":"design","event_id":"match_complete","game_type":"fps","event_properties":{"kills":5,"deaths":2,"assists":1}}]}'
```

**Create scoring rules (admin scope)**
```bash
curl -X POST http://localhost:3000/v1/games/valorant/scoring-rules \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <YOUR_ADMIN_KEY>" \
  -d '{"weights":{"default":{"score":1},"category":{"combat":{"kills":2,"boss":10}},"event":{"monster_kill":{"kills":3,"boss":20}}}}'
```

**Replace scoring rules (admin scope or Supabase JWT)**
```bash
curl -X PUT http://localhost:3000/v1/games/valorant/scoring-rules \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPABASE_JWT_OR_ADMIN_KEY>" \
  -d '{"weights":{"default":{"score":1},"event":{"raid_complete":{"score":50}}}}'
```

**List rule versions**
```bash
curl -H "Authorization: Bearer <SUPABASE_JWT_OR_READ_KEY>" \
  http://localhost:3000/v1/games/valorant/scoring-rules/versions
```

**Activate a rule version (admin scope)**
```bash
curl -X PUT http://localhost:3000/v1/games/valorant/scoring-rules/versions/3/activate \
  -H "Authorization: Bearer <SUPABASE_JWT_OR_ADMIN_KEY>"
```

**Deactivate rules (admin scope)**
```bash
curl -X DELETE http://localhost:3000/v1/games/valorant/scoring-rules \
  -H "Authorization: Bearer <SUPABASE_JWT_OR_ADMIN_KEY>"
```

**Create a game (Supabase JWT)**
```bash
curl -X POST http://localhost:3000/v1/dashboard/games \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPABASE_JWT>" \
  -d '{"slug":"valorant","name":"Valorant","game_type":"fps"}'
```

**Create an API key (Supabase JWT)**
```bash
curl -X POST http://localhost:3000/v1/dashboard/games/valorant/api-keys \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPABASE_JWT>" \
  -d '{"env":"prod","scopes":["ingest","read"]}'
```

**Update game metadata with a Supabase Storage image URL**
```bash
curl -X PUT http://localhost:3000/v1/dashboard/games/valorant \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPABASE_JWT>" \
  -d '{"cover_image_url":"https://your-project.supabase.co/storage/v1/object/public/games/valorant.png"}'
```

**Publish a game to prod**
```bash
curl -X PUT http://localhost:3000/v1/dashboard/games/valorant/publish \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <SUPABASE_JWT>" \
  -d '{"env":"prod"}'
```
