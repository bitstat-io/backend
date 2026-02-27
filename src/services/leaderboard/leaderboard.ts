import { env } from '../../config/env';
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
  const leaderboardKey = await resolveLeaderboardKey(scope, window);
  const raw = await redis.zrevrange(leaderboardKey, 0, limit - 1, 'WITHSCORES');
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
