import { redis } from '../../redis/client';
import { key } from '../../redis/keys';
import { dayId, MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from '../../utils/time';
import type { GameScope } from '../../auth/types';

type Range = '5m' | '1h' | '24h' | '7d';
type BucketUnit = 'sec' | 'min' | 'hour' | 'day';

type TrafficPoint = {
  ts: string;
  events: number;
  accepted: number;
  rejected: number;
  errors: number;
  fps: number;
  mobile: number;
  iap: number;
};

const RANGE_CONFIG: Record<Range, { unit: BucketUnit; points: number; stepMs: number; unitSeconds: number }> = {
  '5m': { unit: 'sec', points: 300, stepMs: MS_PER_SECOND, unitSeconds: 1 },
  '1h': { unit: 'min', points: 60, stepMs: MS_PER_MINUTE, unitSeconds: 60 },
  '24h': { unit: 'hour', points: 24, stepMs: MS_PER_HOUR, unitSeconds: 3600 },
  '7d': { unit: 'day', points: 7, stepMs: MS_PER_DAY, unitSeconds: 86400 },
};

const AGG_RANGE_CONFIG: Record<Range, { unit: BucketUnit; points: number; stepMs: number }> = {
  '5m': { unit: 'min', points: 5, stepMs: MS_PER_MINUTE },
  '1h': { unit: 'min', points: 60, stepMs: MS_PER_MINUTE },
  '24h': { unit: 'hour', points: 24, stepMs: MS_PER_HOUR },
  '7d': { unit: 'day', points: 7, stepMs: MS_PER_DAY },
};

export async function getDashboardOverview(range: Range, scope: GameScope) {
  const config = RANGE_CONFIG[range];
  const buckets = buildBuckets(config);
  const aggKeys = buckets.map((bucket) => aggKey(scope, config.unit, bucket.id));

  const pipeline = redis.pipeline();
  aggKeys.forEach((agg) => pipeline.hgetall(agg));
  const aggResults = await pipeline.exec();

  const traffic: TrafficPoint[] = buckets.map((bucket, index) => {
    const result = aggResults?.[index]?.[1] as Record<string, string> | undefined;
    return {
      ts: new Date(bucket.ts).toISOString(),
      events: toInt(result?.events),
      accepted: toInt(result?.accepted),
      rejected: toInt(result?.rejected),
      errors: toInt(result?.errors),
      fps: toInt(result?.fps),
      mobile: toInt(result?.mobile),
      iap: toFloat(result?.iap),
    };
  });

  const totals = traffic.reduce(
    (acc, point) => {
      acc.events += point.events;
      acc.accepted += point.accepted;
      acc.rejected += point.rejected;
      acc.errors += point.errors;
      acc.fps += point.fps;
      acc.mobile += point.mobile;
      acc.iap += point.iap;
      return acc;
    },
    { events: 0, accepted: 0, rejected: 0, errors: 0, fps: 0, mobile: 0, iap: 0 },
  );

  const totalObserved = totals.accepted + totals.rejected + totals.errors;
  const errorRate = totalObserved > 0 ? totals.errors / totalObserved : 0;
  const rejectRate = totalObserved > 0 ? totals.rejected / totalObserved : 0;
  const latestEvents = traffic[traffic.length - 1]?.events ?? 0;
  const eventsPerSec = latestEvents / config.unitSeconds;

  const uniquePlayers = await getUniquePlayers(scope, range);
  const topGames = await getTopGames(scope, range, 5);
  const topPlayers = await getTopPlayers(scope, range, 5);
  const recentEvents = await getRecentEvents(scope, 12);
  const recentRejected = await getRecentRejected(scope, 8);
  return {
    range,
    updatedAt: new Date().toISOString(),
    summary: {
      events: totals.events,
      accepted: totals.accepted,
      rejected: totals.rejected,
      errors: totals.errors,
      uniquePlayers,
      errorRate,
      rejectRate,
      fpsEvents: totals.fps,
      mobileEvents: totals.mobile,
      iap: totals.iap,
      eventsPerSec,
    },
    recentEvents,
    recentRejected,
    traffic,
    topGames,
    topPlayers,
  };
}

function buildBuckets(config: { unit: BucketUnit; points: number; stepMs: number }) {
  const now = Date.now();

  if (config.unit === 'day') {
    const buckets: Array<{ id: string; ts: number }> = [];
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    for (let i = config.points - 1; i >= 0; i -= 1) {
      const ts = today.getTime() - i * config.stepMs;
      buckets.push({ id: dayId(new Date(ts)), ts });
    }
    return buckets;
  }

  const aligned = Math.floor(now / config.stepMs) * config.stepMs;
  const buckets: Array<{ id: number; ts: number }> = [];
  for (let i = config.points - 1; i >= 0; i -= 1) {
    const ts = aligned - i * config.stepMs;
    const id = Math.floor(ts / config.stepMs);
    buckets.push({ id, ts });
  }
  return buckets;
}

function aggKey(scope: GameScope, unit: BucketUnit, id: string | number) {
  if (unit === 'sec') return key.aggSecond(scope, id as number);
  if (unit === 'min') return key.aggMinute(scope, id as number);
  if (unit === 'hour') return key.aggHour(scope, id as number);
  return key.aggDay(scope, id as string);
}

function uniqueKey(scope: GameScope, unit: BucketUnit, id: string | number) {
  if (unit === 'min') return key.uniquePlayersMinute(scope, id as number);
  if (unit === 'hour') return key.uniquePlayersHour(scope, id as number);
  return key.uniquePlayersDay(scope, id as string);
}

async function getUniquePlayers(scope: GameScope, range: Range) {
  const config = AGG_RANGE_CONFIG[range];
  const buckets = buildBuckets({ unit: config.unit, points: config.points, stepMs: config.stepMs });
  const keys = buckets.map((bucket) => uniqueKey(scope, config.unit, bucket.id));
  if (keys.length === 0) return 0;
  const result = await redis.pfcount(...keys);
  return Number(result) || 0;
}


async function getTopGames(scope: GameScope, range: Range, limit: number) {
  const config = AGG_RANGE_CONFIG[range];
  const buckets = buildBuckets({ unit: config.unit, points: config.points, stepMs: config.stepMs });
  if (buckets.length === 0) return [];

  const eventKeys = buckets.map((bucket) => gameEventsKey(scope, config.unit, bucket.id));
  const iapKeys = buckets.map((bucket) => gameIapKey(scope, config.unit, bucket.id));

  const eventsTemp = key.tempDashboard(scope, 'games:events', range);
  const iapTemp = key.tempDashboard(scope, 'games:iap', range);

  await redis.zunionstore(eventsTemp, eventKeys.length, ...eventKeys);
  await redis.zunionstore(iapTemp, iapKeys.length, ...iapKeys);
  await redis.expire(eventsTemp, 15);
  await redis.expire(iapTemp, 15);

  const eventsResult = await redis.zrevrange(eventsTemp, 0, limit - 1, 'WITHSCORES');
  const iapResult = await redis.zrevrange(iapTemp, 0, limit - 1, 'WITHSCORES');

  const iapMap = toScoreMap(iapResult);
  const topGames: Array<{ game_id: string; events: number; iap: number }> = [];
  for (let i = 0; i < eventsResult.length; i += 2) {
    const gameId = eventsResult[i];
    const events = Number(eventsResult[i + 1] ?? 0);
    topGames.push({
      game_id: gameId,
      events,
      iap: iapMap.get(gameId) ?? 0,
    });
  }
  return topGames;
}

async function getTopPlayers(scope: GameScope, range: Range, limit: number) {
  if (range !== '7d') {
    const day = dayId(new Date());
    const list = await redis.zrevrange(key.leaderboardDay(scope, day), 0, limit - 1, 'WITHSCORES');
    return toTopPlayers(list);
  }

  const days = buildBuckets(RANGE_CONFIG['7d']).map((bucket) => bucket.id as string);
  if (days.length === 0) return [];
  const keys = days.map((day) => key.leaderboardDay(scope, day));
  const temp = key.tempDashboard(scope, 'players', range);
  await redis.zunionstore(temp, keys.length, ...keys);
  await redis.expire(temp, 15);
  const list = await redis.zrevrange(temp, 0, limit - 1, 'WITHSCORES');
  return toTopPlayers(list);
}

function gameEventsKey(scope: GameScope, unit: BucketUnit, id: string | number) {
  if (unit === 'min') return key.gameEventsMinute(scope, id as number);
  if (unit === 'hour') return key.gameEventsHour(scope, id as number);
  return key.gameEventsDay(scope, id as string);
}

function gameIapKey(scope: GameScope, unit: BucketUnit, id: string | number) {
  if (unit === 'min') return key.gameIapMinute(scope, id as number);
  if (unit === 'hour') return key.gameIapHour(scope, id as number);
  return key.gameIapDay(scope, id as string);
}

function toTopPlayers(list: string[]) {
  const players: Array<{ user_id: string; score: number }> = [];
  for (let i = 0; i < list.length; i += 2) {
    players.push({ user_id: list[i], score: Number(list[i + 1] ?? 0) });
  }
  return players;
}

function toScoreMap(list: string[]) {
  const map = new Map<string, number>();
  for (let i = 0; i < list.length; i += 2) {
    map.set(list[i], Number(list[i + 1] ?? 0));
  }
  return map;
}

function toInt(value?: string) {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function toFloat(value?: string) {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getRecentEvents(scope: GameScope, limit: number) {
  const list = await redis.lrange(key.eventLog(scope), 0, Math.max(0, limit - 1));
  return list
    .map((item) => {
      try {
        return JSON.parse(item) as {
          ts: string;
          game_id: string;
          game_slug: string;
          event_id: string;
          user_id: string;
          game_type: string;
          platform: string | null;
          region: string | null;
        };
      } catch (error) {
        return null;
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

async function getRecentRejected(scope: GameScope, limit: number) {
  const list = await redis.lrange(key.eventRejectLog(scope), 0, Math.max(0, limit - 1));
  return list
    .map((item) => {
      try {
        return JSON.parse(item) as {
          ts: string;
          reason: string;
          event_id?: string;
          game_id?: string;
          user_id?: string;
          game_slug?: string;
          tenant_id?: string;
          category?: string;
          client_ts?: number;
        };
      } catch (error) {
        return null;
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}
