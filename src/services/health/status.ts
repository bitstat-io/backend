import { env } from '../../config/env';
import { getDb } from '../../db/client';
import { redis } from '../../redis/client';
import { key } from '../../redis/keys';

type BasicCheck = {
  status: 'ok' | 'error';
  configured?: boolean;
  latency_ms?: number;
  reason?: string;
};

type WorkerCheck = BasicCheck & {
  stream: string;
  group: string;
  pending: number | null;
  consumers: number | null;
};

export type HealthStatus = {
  status: 'ok' | 'degraded';
  checks: {
    redis: BasicCheck;
  };
};

export type ReadinessStatus = {
  status: 'ok' | 'degraded';
  checks: {
    redis: BasicCheck;
    db: BasicCheck;
    worker: WorkerCheck;
  };
};

type HealthDeps = {
  redisClient?: {
    ping: () => Promise<string>;
    xpending: (keyName: string, group: string) => Promise<unknown>;
    xinfo: (subcommand: 'CONSUMERS', keyName: string, group: string) => Promise<unknown>;
  };
  db?: {
    query: (sql: string) => Promise<unknown>;
  } | null;
  streamKey?: string;
  streamGroup?: string;
  maxPending?: number;
};

export async function getHealthStatus(deps: HealthDeps = {}): Promise<HealthStatus> {
  const redisClient = deps.redisClient ?? redis;
  const redisCheck = await pingRedis(redisClient);

  return {
    status: redisCheck.status === 'ok' ? 'ok' : 'degraded',
    checks: {
      redis: redisCheck,
    },
  };
}

export async function getReadinessStatus(deps: HealthDeps = {}): Promise<ReadinessStatus> {
  const redisClient = deps.redisClient ?? redis;
  const db = deps.db === undefined ? getDb() : deps.db;
  const streamKey = deps.streamKey ?? key.eventsStream(env.REDIS_STREAM_ENV);
  const streamGroup = deps.streamGroup ?? env.REDIS_STREAM_GROUP;
  const maxPending = deps.maxPending ?? 1000;

  const redisCheck = await pingRedis(redisClient);
  const dbCheck = await pingDb(db);
  const workerCheck = await checkWorker({
    redisClient,
    redisCheck,
    dbCheck,
    streamKey,
    streamGroup,
    maxPending,
  });

  const overall = redisCheck.status === 'ok' && dbCheck.status === 'ok' && workerCheck.status === 'ok';

  return {
    status: overall ? 'ok' : 'degraded',
    checks: {
      redis: redisCheck,
      db: dbCheck,
      worker: workerCheck,
    },
  };
}

async function pingRedis(redisClient: NonNullable<HealthDeps['redisClient']>): Promise<BasicCheck> {
  const start = Date.now();
  try {
    const pong = await redisClient.ping();
    return pong === 'PONG'
      ? { status: 'ok', latency_ms: Date.now() - start }
      : { status: 'error', latency_ms: Date.now() - start, reason: 'unexpected_ping_response' };
  } catch (error) {
    return {
      status: 'error',
      latency_ms: Date.now() - start,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function pingDb(db: HealthDeps['db']): Promise<BasicCheck> {
  if (!db) {
    return { status: 'error', configured: false, reason: 'not_configured' };
  }

  const start = Date.now();
  try {
    await db.query('select 1');
    return { status: 'ok', configured: true, latency_ms: Date.now() - start };
  } catch (error) {
    return {
      status: 'error',
      configured: true,
      latency_ms: Date.now() - start,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkWorker(params: {
  redisClient: NonNullable<HealthDeps['redisClient']>;
  redisCheck: BasicCheck;
  dbCheck: BasicCheck;
  streamKey: string;
  streamGroup: string;
  maxPending: number;
}): Promise<WorkerCheck> {
  const base: WorkerCheck = {
    status: 'error',
    stream: params.streamKey,
    group: params.streamGroup,
    pending: null,
    consumers: null,
  };

  if (params.redisCheck.status !== 'ok') {
    return { ...base, reason: 'redis_unavailable' };
  }

  if (params.dbCheck.status !== 'ok') {
    return { ...base, reason: 'database_unavailable' };
  }

  try {
    const pendingSummary = await params.redisClient.xpending(params.streamKey, params.streamGroup);
    const consumersInfo = await params.redisClient.xinfo('CONSUMERS', params.streamKey, params.streamGroup);

    const pending = parsePendingCount(pendingSummary);
    const consumers = parseConsumerCount(consumersInfo);

    if (consumers < 1) {
      return { ...base, pending, consumers, reason: 'no_registered_consumers' };
    }

    if (pending > params.maxPending) {
      return { ...base, pending, consumers, reason: 'pending_threshold_exceeded' };
    }

    return {
      status: 'ok',
      stream: params.streamKey,
      group: params.streamGroup,
      pending,
      consumers,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (reason.includes('NOGROUP')) {
      return { ...base, reason: 'consumer_group_missing' };
    }
    return { ...base, reason };
  }
}

function parsePendingCount(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return 0;
  const count = value[0];
  const parsed = Number(count ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function parseConsumerCount(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}
