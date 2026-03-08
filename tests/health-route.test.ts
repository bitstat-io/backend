import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/services/health/status', () => ({
  getHealthStatus: vi.fn(),
  getReadinessStatus: vi.fn(),
}));

import { buildServer } from '../src/index';
import { getHealthStatus, getReadinessStatus } from '../src/services/health/status';

describe('health routes', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns liveness payload on /v1/health', async () => {
    vi.mocked(getHealthStatus).mockResolvedValue({
      status: 'ok',
      checks: {
        redis: { status: 'ok', latency_ms: 4 },
      },
    });

    const app = await buildServer();

    const response = await app.inject({ method: 'GET', url: '/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      checks: {
        redis: { status: 'ok', latency_ms: 4 },
      },
    });

    await app.close();
  });

  it('returns 503 on /v1/health/ready when a dependency is not ready', async () => {
    vi.mocked(getReadinessStatus).mockResolvedValue({
      status: 'degraded',
      checks: {
        redis: { status: 'ok', latency_ms: 3 },
        db: { status: 'ok', configured: true, latency_ms: 5 },
        worker: {
          status: 'error',
          stream: 'bs:v1:stream:events:prod',
          group: 'bitstat-events',
          pending: 12,
          consumers: 0,
          heartbeat: 'fresh',
          reason: 'pending_threshold_exceeded',
        },
      },
    });

    const app = await buildServer();

    const response = await app.inject({ method: 'GET', url: '/v1/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: 'degraded',
      checks: {
        redis: { status: 'ok', latency_ms: 3 },
        db: { status: 'ok', configured: true, latency_ms: 5 },
        worker: {
          status: 'error',
          stream: 'bs:v1:stream:events:prod',
          group: 'bitstat-events',
          pending: 12,
          consumers: 0,
          heartbeat: 'fresh',
          reason: 'pending_threshold_exceeded',
        },
      },
    });

    await app.close();
  });
});
