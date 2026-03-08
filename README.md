# BitStat Backend (MVP)

**Overview**
BitStat is a Redis-backed ingestion API with public leaderboards. API keys scope every write to `{tenantId, gameId, env}`. Public visibility is explicit per environment and controlled by the game owner.

**Ingestion Behavior**
- Required event fields: `user_id`, `session_id`, `client_ts`, `category`, `event_id`, `event_properties`.
- Optional fields: `v`, `game_type`, `platform`, `region`.
- `category` must match `^[a-z0-9_-]{2,50}$` (lowercase).
- `game_type` is optional free-form metadata. The backend does not enforce a fixed list of game types.
- `event_properties` is a free-form JSON object capped by `EVENT_PROPERTIES_MAX_BYTES` (default 8 KB).
- `client_ts` accepts seconds or milliseconds. Events outside `EVENT_PAST_MAX_DAYS` or `EVENT_FUTURE_MAX_DAYS` are rejected.
- Batch size is capped by `EVENT_MAX_PER_BATCH`. Oversized batches are fully rejected with HTTP 400 and reason `batch_too_large`.
- Deduplication defaults to `EVENT_DEDUP_TTL_SEC=604800` and uses the key `user_id:session_id:event_id:client_ts`.

**Leaderboards**
- Windows: `all`, `1d`, `7d`, `30d`.
- `1d` is the current UTC day (not a rolling 24-hour window).
- Scores are derived from `scoreEvent` in `src/services/ingest/scoring.ts` using per-game rules.
- If no rule exists, `event_properties.score` is used when present; otherwise the event contributes `0`.
- By default scoring is game-type agnostic. To change scoring, edit `src/services/ingest/scoring.ts` and redeploy.
- Per-game scoring rules are read from `public.core_scoring_rules` (Supabase) when `SUPABASE_DB_URL` is set.

**Stats**
- `events` increments for every accepted event.
- `matches` increments when `event_id === "match_complete"`.
- `sessions` increments when `event_id === "session_start"`.
- Numeric fields like `kills`, `deaths`, `assists`, `coins`, `level`, and `iap_amount` are aggregated when present in `event_properties`.

**Public Games Registry**
- Public endpoints read from `public:games:prod` and `public:games:dev`.
- Games are added to the public registry only when the owner explicitly publishes that environment.
- `/v1/games`, `/v1/games/{gameSlug}/leaderboards`, and `/v1/games/dev/{gameSlug}/leaderboards` only work for published games.
- If a published game is missing from the Redis registry, the backend can rebuild that entry from Postgres.
- Public registry reads still depend on Redis being reachable today. A Redis outage is not fully masked by the Postgres fallback path.

**Frontend-Safe API (No Auth)**
- `GET /v1/health`
- `GET /v1/health/ready`
- `GET /v1/games` (prod only)
- `GET /v1/games/{gameSlug}/leaderboards` (prod)
- `GET /v1/games/dev/{gameSlug}/leaderboards` (dev)

**Requires API Key**
- `POST /v1/events/batch`
- `GET /v1/games/:gameSlug/stats`
- `GET /v1/games/:gameSlug/scoring-rules`
- `POST /v1/games/:gameSlug/scoring-rules`
- `PUT /v1/games/:gameSlug/scoring-rules`
- `GET /v1/games/:gameSlug/scoring-rules/versions`
- `PUT /v1/games/:gameSlug/scoring-rules/versions/:version/activate`
- `DELETE /v1/games/:gameSlug/scoring-rules`
- `GET /v1/dashboard/*`

**Supabase JWT (Owner)**
- `GET /v1/dashboard/games`
- `POST /v1/dashboard/games`
- `PUT /v1/dashboard/games/:gameSlug`
- `PUT /v1/dashboard/games/:gameSlug/publish`
- `PUT /v1/dashboard/games/:gameSlug/unpublish`
- `GET /v1/dashboard/games/:gameSlug/api-keys`
- `POST /v1/dashboard/games/:gameSlug/api-keys`
- `DELETE /v1/dashboard/games/:gameSlug/api-keys/:keyId`

Use `Authorization: Bearer <access_token>` from Supabase Auth.
Set `SUPABASE_JWT_SECRET` (preferred) or `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY`.

**Publishing**
- Owners upload artwork to Supabase Storage and store the resulting public image URL in `cover_image_url`.
- Owners can set `cover_image_url` when creating or updating a game.
- A cover image is required before publishing a game.
- Publishing `prod` makes the game appear in the public catalog and public leaderboard routes.
- Unpublishing removes it from public discovery without affecting ingestion.

**Dashboard Stream**
- SSE streams are scoped per `{tenantId, gameId, env, range}`.
- Snapshots are cached and refreshed on a ~1s tick to avoid excessive Redis reads.

**Storage Notes**
- All keys are namespaced: `tenant:{tenantId}:game:{gameId}:env:{env}:...`
- Temporary unioned leaderboards and dashboard sets are stored with short TTLs.
- Raw events are appended to `stream:events:{env}` for the Supabase write-behind worker.
- The worker reclaims stale pending Redis Stream messages before reading new ones.
- API keys are stored as `key_hash` + `key_prefix`. The raw key is returned only once at creation time.

**Operational Readiness**
- `GET /v1/health` is a liveness probe.
- `GET /v1/health/ready` returns `503` when Redis, Postgres, or the worker consumer group is not ready.
- `READINESS_MAX_STREAM_PENDING` controls how many pending worker messages are tolerated before readiness fails.

**More Docs**
- See `docs/README.md` for the full architecture, API, and ops guide.
- See `docs/deploy-vps.md` for a single-VPS deployment guide using Redis, PM2, and Nginx.

**Bootstrap**
- Run `db/schema.sql` on a fresh database to create the schema.
- Run `db/seed.sql` if you want a local sample tenant, games, and scoring rule for development.
- API keys are not seeded on purpose. Create them through `POST /v1/dashboard/games/:gameSlug/api-keys` so the backend returns the raw key once.
