# BitStat Backend (MVP)

**Overview**
BitStat is a Redis-backed ingestion API with public leaderboards. API keys scope every write to `{tenantId, gameId, env}`. Only `prod` games are exposed publicly.

**Ingestion Behavior**
- Required event fields: `user_id`, `session_id`, `client_ts`, `category`, `event_id`, `game_type`, `event_properties`.
- Optional fields: `v`, `match_id`, `platform`, `region`.
- `client_ts` accepts seconds or milliseconds. Events outside `EVENT_PAST_MAX_DAYS` or `EVENT_FUTURE_MAX_DAYS` are rejected.
- Batch size is capped by `EVENT_MAX_PER_BATCH`. Oversized batches are fully rejected with HTTP 400 and reason `batch_too_large`.
- Optional deduplication uses `EVENT_DEDUP_TTL_SEC` and the key `user_id:session_id:event_id:client_ts`.

**Leaderboards**
- Windows: `all`, `1d`, `7d`, `30d`.
- `1d` is the current UTC day (not a rolling 24-hour window).
- Scores are derived from `scoreEvent`.
FPS: `kills * 2 + assists - deaths`
Mobile: `coins + level * 10 + iap_amount * 100`

**Stats**
- `events` increments for every accepted event.
- `matches` increments only when `event_id === "match_complete"` (FPS).
- `sessions` increments only when `event_id === "session_start"` (mobile).

**Public Games Registry**
- Public endpoints read from the Redis registry `public:games`.
- A `prod` game slug is registered on the first successful ingest for that scope.
- `/v1/games` and `/v1/games/{gameSlug}/leaderboards` only work for slugs present in the registry.

**Dashboard Stream**
- SSE streams are scoped per `{tenantId, gameId, env, range}`.
- Snapshots are cached and refreshed on a ~1s tick to avoid excessive Redis reads.

**Storage Notes**
- All keys are namespaced: `tenant:{tenantId}:game:{gameId}:env:{env}:...`
- Temporary unioned leaderboards and dashboard sets are stored with short TTLs.
