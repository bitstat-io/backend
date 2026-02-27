# BitStat Backend (MVP)

**Overview**
BitStat is a Redis-backed ingestion API with public leaderboards. API keys scope every write to `{tenantId, gameId, env}`. Public leaderboards are available for both `prod` and `dev`.

**Ingestion Behavior**
- Required event fields: `user_id`, `session_id`, `client_ts`, `category`, `event_id`, `event_properties`.
- Optional fields: `v`, `game_type`, `platform`, `region`.
- `category` must match `^[a-z0-9_-]{2,50}$` (lowercase).
- `game_type` is optional and defaults to `other` if omitted (used only for legacy FPS/mobile stats).
- `event_properties` is a free-form JSON object capped by `EVENT_PROPERTIES_MAX_BYTES` (default 8 KB).
- `client_ts` accepts seconds or milliseconds. Events outside `EVENT_PAST_MAX_DAYS` or `EVENT_FUTURE_MAX_DAYS` are rejected.
- Batch size is capped by `EVENT_MAX_PER_BATCH`. Oversized batches are fully rejected with HTTP 400 and reason `batch_too_large`.
- Optional deduplication uses `EVENT_DEDUP_TTL_SEC` and the key `user_id:session_id:event_id:client_ts`.

**Leaderboards**
- Windows: `all`, `1d`, `7d`, `30d`.
- `1d` is the current UTC day (not a rolling 24-hour window).
- Scores are derived from `scoreEvent` in `src/services/ingest/scoring.ts` using per-game rules.
- If no rule exists, `event_properties.score` is used when present; otherwise the event contributes `0`.
- FPS: `kills * 2 + assists - deaths`
- Mobile: `coins + level * 10 + iap_amount * 100`
- To change scoring, edit `src/services/ingest/scoring.ts` and redeploy.
- Per-game scoring rules are read from `core.scoring_rules` (Supabase) when `SUPABASE_DB_URL` is set.

**Stats**
- `events` increments for every accepted event.
- `matches` increments only when `event_id === "match_complete"` (FPS).
- `sessions` increments only when `event_id === "session_start"` (mobile).

**Public Games Registry**
- Public endpoints read from `public:games:prod` and `public:games:dev`.
- A `prod` or `dev` game slug is registered on the first successful ingest for that scope.
- `/v1/games`, `/v1/games/{gameSlug}/leaderboards`, and `/v1/games/dev/{gameSlug}/leaderboards` only work for slugs present in the registry.

**Frontend-Safe API (No Auth)**
- `GET /v1/health`
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
- `GET /v1/dashboard/games/:gameSlug/api-keys`
- `POST /v1/dashboard/games/:gameSlug/api-keys`
- `GET /v1/dashboard/games/:gameSlug/api-keys/:keyId`
- `DELETE /v1/dashboard/games/:gameSlug/api-keys/:keyId`

Use `Authorization: Bearer <access_token>` from Supabase Auth.
Set `SUPABASE_JWT_SECRET` (preferred) or `SUPABASE_URL` + `SUPABASE_ANON_KEY`.

**Dashboard Stream**
- SSE streams are scoped per `{tenantId, gameId, env, range}`.
- Snapshots are cached and refreshed on a ~1s tick to avoid excessive Redis reads.

**Storage Notes**
- All keys are namespaced: `tenant:{tenantId}:game:{gameId}:env:{env}:...`
- Temporary unioned leaderboards and dashboard sets are stored with short TTLs.
- Raw events are appended to `stream:events:{env}` for the Supabase write-behind worker.
- API keys are stored in Supabase with hashing + encryption (requires `API_KEY_ENCRYPTION_SECRET`).

**More Docs**
- See `docs/README.md` for the full architecture, API, and ops guide.
