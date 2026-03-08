import { describe, expect, it } from 'vitest';

import { getReadinessStatus } from '../src/services/health/status';

describe('getReadinessStatus', () => {
  it('reports ok when redis, db, and worker checks pass', async () => {
    const status = await getReadinessStatus({
      redisClient: {
        ping: async () => 'PONG',
        get: async () => '{"consumer":"worker-1"}',
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
          heartbeat: 'fresh',
        },
      },
    });
  });

  it('fails readiness when the worker heartbeat is missing', async () => {
    const status = await getReadinessStatus({
      redisClient: {
        ping: async () => 'PONG',
        get: async () => null,
        xpending: async () => [0, null, null, []],
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
      heartbeat: 'missing',
      reason: 'worker_heartbeat_missing',
    });
  });

  it('reports ok for an idle worker when heartbeat is fresh', async () => {
    const status = await getReadinessStatus({
      redisClient: {
        ping: async () => 'PONG',
        get: async () => '{"consumer":"worker-1"}',
        xpending: async () => [0, null, null, []],
        xinfo: async () => [],
      },
      db: {
        query: async () => ({ rows: [{ '?column?': 1 }] }),
      },
      streamKey: 'stream:prod',
      streamGroup: 'bitstat-events',
    });

    expect(status.checks.worker).toEqual({
      status: 'ok',
      stream: 'stream:prod',
      group: 'bitstat-events',
      pending: 0,
      consumers: 0,
      heartbeat: 'fresh',
    });
  });
});
