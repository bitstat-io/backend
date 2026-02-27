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

## Architecture Notes
- Every write is scoped by API key to `{tenantId, gameId, env}`.
- `env` is `dev` or `prod` and is stored with every record.
- Public leaderboards are available for both `dev` and `prod`.
- Raw events are retained for 3 months; aggregates are retained forever.
- The API writes to Redis; a worker flushes to Supabase via Redis Streams.
- Scoring rules can be stored per game in Supabase and applied during ingest.
- API keys are stored in Supabase (hashed for lookup, encrypted for retrieval).

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
2. API resolves the game slug in the public registry for the requested env.
3. API reads from Redis leaderboard keys.
4. API responds with ranked entries.

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
- Set `SUPABASE_JWT_SECRET` (preferred) or `SUPABASE_URL` + `SUPABASE_ANON_KEY` for verification.

### Supabase JWT (Owner) Only
- `GET /v1/dashboard/games`
- `POST /v1/dashboard/games`
- `GET /v1/dashboard/games/:gameSlug/api-keys`
- `POST /v1/dashboard/games/:gameSlug/api-keys`
- `GET /v1/dashboard/games/:gameSlug/api-keys/:keyId` (explicit key retrieval)
- `DELETE /v1/dashboard/games/:gameSlug/api-keys/:keyId`

## Event Schema
Required fields:
- `user_id`, `session_id`, `client_ts`, `category`, `event_id`, `event_properties`

Optional fields:
- `v`, `game_type`, `platform`, `region`

Rules:
- `category` must match `^[a-z0-9_-]{2,50}$` (lowercase).
- `event_properties` is a free-form JSON object capped by `EVENT_PROPERTIES_MAX_BYTES` (default 8 KB).
- `game_type` defaults to `other` when omitted.

## Scoring Rules
Scores are computed during ingest and written to Redis + the stream.
- Per-game scoring rules (from `core.scoring_rules`) are applied first.
- If no rule is found, `event_properties.score` is used when present; otherwise `0`.
- Rule order: `event_id` → `category` → `default`.
- JWT verification is local when `SUPABASE_JWT_SECRET` is set; otherwise it falls back to `SUPABASE_URL` + `SUPABASE_ANON_KEY`.

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
- `core.tenants` (owned by `owner_user_id`)
- `core.games`
- `core.api_keys` (hashed + encrypted)
- `core.scoring_rules` (versioned)

**Ingest**
- `ingest.events` (append-only). Use `dedup_id` + unique constraint to make writes idempotent.

**Analytics**
- `analytics.metric_definitions`
- `analytics.user_metrics`
- `analytics.leaderboard_daily`
- `analytics.leaderboard_all`

## Worker
The worker consumes the Redis events stream and writes data to Supabase.

**Stream**
- Key: `stream:events:{env}`
- Group: `REDIS_STREAM_GROUP` (default `bitstat-events`)
- Consumer: `REDIS_STREAM_CONSUMER` (defaults to `<host>-<pid>`)
- Batch: `REDIS_STREAM_BATCH_SIZE` (default `200`)
- Block: `REDIS_STREAM_BLOCK_MS` (default `2000`)
- Max length: `REDIS_STREAM_MAXLEN` (default `200000`)

**Responsibilities**
- Insert raw events into `ingest.events` (idempotent via `dedup_id`).
- Increment `analytics.leaderboard_all` and `analytics.leaderboard_daily`.

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
| `SUPABASE_ANON_KEY` | Optional | Supabase anon key (fallback auth) | `eyJ...` |
| `API_KEYS_JSON` | Optional | Static API keys (dev/bootstrap) | `[{"key":"...","tenantId":"...","gameId":"...","gameSlug":"valorant","env":"prod"}]` |
| `API_KEY_ENCRYPTION_SECRET` | Yes (dashboard keys) | Encrypt API keys at rest | `super-secret` |
| `API_KEY_CACHE_TTL_MS` | No | API key lookup cache | `60000` |
| `RATE_LIMIT_MAX` | No | Rate limit max | `200` |
| `RATE_LIMIT_TIME_WINDOW_MS` | No | Rate window ms | `1000` |
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
DELETE FROM ingest.events
WHERE client_ts < now() - interval '3 months';
```

**Cron example**
```
0 3 * * * psql "$SUPABASE_DB_URL" -c "DELETE FROM ingest.events WHERE client_ts < now() - interval '3 months';"
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

**Fetch an API key (explicit request)**
```bash
curl -H "Authorization: Bearer <SUPABASE_JWT>" \
  http://localhost:3000/v1/dashboard/games/valorant/api-keys/<KEY_ID>
```
