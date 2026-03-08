import { env } from '../../config/env';
import { getDb } from '../../db/client';
import { redis } from '../../redis/client';
import { key } from '../../redis/keys';
import { dayId, dayIdsForWindow, epochMinute } from '../../utils/time';
import type { LeaderboardWindow } from '../../schemas/leaderboard';
import type { GameScope } from '../../auth/types';

export type LeaderboardEntry = {
  rank: number;
  user_id: string;
  score: number;
};

export async function fetchLeaderboard(
  scope: GameScope,
  window: LeaderboardWindow,
  limit: number,
): Promise<LeaderboardEntry[]> {
  try {
    const leaderboardKey = await resolveLeaderboardKey(scope, window);
    const raw = await redis.zrevrange(leaderboardKey, 0, limit - 1, 'WITHSCORES');
    const entries = toLeaderboardEntries(raw);
    if (entries.length > 0) {
      return entries;
    }
  } catch {
    // Fall back to the durable aggregates if Redis is unavailable.
  }

  return fetchLeaderboardFromDb(scope, window, limit);
}

async function resolveLeaderboardKey(scope: GameScope, window: LeaderboardWindow): Promise<string> {
  if (window === 'all') {
    return key.leaderboardAll(scope);
  }

  const days = window === '1d' ? 1 : window === '7d' ? 7 : 30;
  const dayKeys = dayIdsForWindow(days).map((day) => key.leaderboardDay(scope, day));
  const bucket = String(epochMinute(new Date()));
  const tempKey = key.tempWindow(scope, window, bucket);

  await redis.zunionstore(tempKey, dayKeys.length, ...dayKeys);
  await redis.expire(tempKey, env.LEADERBOARD_TEMP_TTL_SEC);

  return tempKey;
}

function toLeaderboardEntries(raw: string[]): LeaderboardEntry[] {
  const entries: LeaderboardEntry[] = [];
  for (let i = 0; i < raw.length; i += 2) {
    entries.push({
      rank: i / 2 + 1,
      user_id: raw[i] ?? '',
      score: Number(raw[i + 1] ?? 0),
    });
  }
  return entries;
}

async function fetchLeaderboardFromDb(
  scope: GameScope,
  window: LeaderboardWindow,
  limit: number,
): Promise<LeaderboardEntry[]> {
  const db = getDb();
  if (!db) return [];

  if (window === 'all') {
    const result = await db.query(
      `select user_id, score
       from public.leaderboard_all
       where game_id = $1 and env = $2
       order by score desc, user_id asc
       limit $3`,
      [scope.gameId, scope.env, limit],
    );

    return result.rows.map((row, index) => ({
      rank: index + 1,
      user_id: String(row.user_id),
      score: Number(row.score ?? 0),
    }));
  }

  const days = dayIdsForWindow(window === '1d' ? 1 : window === '7d' ? 7 : 30).map(toDayDate);
  const result = await db.query(
    `select user_id, sum(score) as score
     from public.leaderboard_daily
     where game_id = $1
       and env = $2
       and day = any($3::date[])
     group by user_id
     order by score desc, user_id asc
     limit $4`,
    [scope.gameId, scope.env, days, limit],
  );

  return result.rows.map((row, index) => ({
    rank: index + 1,
    user_id: String(row.user_id),
    score: Number(row.score ?? 0),
  }));
}

function toDayDate(day: string) {
  return `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
}
