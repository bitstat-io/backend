import { describe, expect, it } from 'vitest';

import { getReadinessStatus } from '../src/services/health/status';

describe('getReadinessStatus', () => {
  it('reports ok when redis, db, and worker checks pass', async () => {
    const status = await getReadinessStatus({
      redisClient: {
        ping: async () => 'PONG',
        xpending: async () => [0, null, null, []],
        xinfo: async () => [['name', 'consumer-1', 'pending', 0, 'idle', 100]],
      },
      db: {
        query: async () => ({ rows: [{ '?column?': 1 }] }),
      },
      streamKey: 'stream:prod',
      streamGroup: 'bitstat-events',
      maxPending: 5,
    });

    expect(status).toEqual({
      status: 'ok',
      checks: {
        redis: { status: 'ok', latency_ms: expect.any(Number) },
        db: { status: 'ok', configured: true, latency_ms: expect.any(Number) },
        worker: {
          status: 'ok',
          stream: 'stream:prod',
          group: 'bitstat-events',
          pending: 0,
          consumers: 1,
        },
      },
    });
  });

  it('fails readiness when the worker consumer group is missing', async () => {
    const status = await getReadinessStatus({
      redisClient: {
        ping: async () => 'PONG',
        xpending: async () => {
          throw new Error('NOGROUP No such key');
        },
        xinfo: async () => [],
      },
      db: {
        query: async () => ({ rows: [{ '?column?': 1 }] }),
      },
      streamKey: 'stream:prod',
      streamGroup: 'bitstat-events',
    });

    expect(status.status).toBe('degraded');
    expect(status.checks.worker).toEqual({
      status: 'error',
      stream: 'stream:prod',
      group: 'bitstat-events',
      pending: null,
      consumers: null,
      reason: 'consumer_group_missing',
    });
  });
});
