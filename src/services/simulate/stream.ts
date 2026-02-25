import type { SimulateMode } from '../../schemas/simulate';
import { env } from '../../config/env';
import { ingestEvents } from '../ingest/ingest';
import { generateEvents } from './generator';
import type { GameScope } from '../../auth/types';

export type StreamState = {
  id: string;
  status: 'running' | 'stopped' | 'error';
  mode: SimulateMode;
  rate: number;
  batchSize: number;
  sent: number;
  accepted: number;
  rejected: number;
  errors: number;
  scope?: GameScope;
  startedAt?: string;
  updatedAt?: string;
  error?: string;
};

let streamState: StreamState | null = null;
let timer: NodeJS.Timeout | null = null;
let tickInFlight = false;

export function getStreamState(): StreamState {
  if (!streamState) {
    return {
      id: 'stream',
      status: 'stopped',
      mode: 'mixed',
      rate: env.SIM_RATE_DEFAULT,
      batchSize: Math.min(env.EVENT_MAX_PER_BATCH, Math.max(env.SIM_RATE_DEFAULT, 10)),
      sent: 0,
      accepted: 0,
      rejected: 0,
      errors: 0,
    };
  }
  return streamState;
}

export function startStream(config: {
  scope: GameScope;
  mode: SimulateMode;
  rate: number;
  batchSize: number;
}): StreamState {
  const rate = clamp(config.rate, env.SIM_RATE_MIN, env.SIM_RATE_MAX);
  const batchSize = clamp(config.batchSize, 1, env.EVENT_MAX_PER_BATCH);

  if (!streamState) {
    streamState = {
      id: 'stream',
      status: 'running',
      mode: config.mode,
      rate,
      batchSize,
      sent: 0,
      accepted: 0,
      rejected: 0,
      errors: 0,
      scope: config.scope,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } else {
    streamState.status = 'running';
    streamState.mode = config.mode;
    streamState.rate = rate;
    streamState.batchSize = batchSize;
    streamState.scope = config.scope;
    streamState.updatedAt = new Date().toISOString();
    streamState.error = undefined;
  }

  if (!timer) {
    timer = setInterval(() => {
      void tickStream();
    }, 1000);
    timer.unref?.();
  }

  return streamState;
}

export function updateStream(config: {
  scope: GameScope;
  mode?: SimulateMode;
  rate?: number;
  batchSize?: number;
}): StreamState {
  if (!streamState) {
    return startStream({
      scope: config.scope,
      mode: config.mode ?? 'mixed',
      rate: config.rate ?? env.SIM_RATE_DEFAULT,
      batchSize: config.batchSize ?? Math.min(env.EVENT_MAX_PER_BATCH, Math.max(env.SIM_RATE_DEFAULT, 10)),
    });
  }

  if (config.mode) {
    streamState.mode = config.mode;
  }
  if (config.rate !== undefined) {
    streamState.rate = clamp(config.rate, env.SIM_RATE_MIN, env.SIM_RATE_MAX);
  }
  if (config.batchSize !== undefined) {
    streamState.batchSize = clamp(config.batchSize, 1, env.EVENT_MAX_PER_BATCH);
  }
  streamState.scope = config.scope;
  streamState.updatedAt = new Date().toISOString();
  return streamState;
}

export function stopStream(): StreamState {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!streamState) {
    return getStreamState();
  }
  streamState.status = 'stopped';
  streamState.updatedAt = new Date().toISOString();
  return streamState;
}

async function tickStream() {
  if (!streamState || streamState.status !== 'running') return;
  if (tickInFlight) return;
  tickInFlight = true;

  try {
    const totalEvents = Math.max(1, Math.round(streamState.rate));
    const fpsMatches = Math.max(1, Math.ceil(totalEvents / 10));
    const events = generateEvents({
      totalEvents,
      fpsMatches,
      mode: streamState.mode,
    })
      .slice(0, totalEvents);

    for (let i = 0; i < events.length; i += streamState.batchSize) {
      const chunk = events.slice(i, i + streamState.batchSize);
      if (!streamState.scope) {
        throw new Error('stream scope missing');
      }
      const result = await ingestEvents(streamState.scope, chunk);
      streamState.sent += chunk.length;
      streamState.accepted += result.accepted;
      streamState.rejected += result.rejected;
      streamState.errors += result.errors ?? 0;
    }
    streamState.updatedAt = new Date().toISOString();
  } catch (error) {
    streamState.status = 'error';
    streamState.error = error instanceof Error ? error.message : 'stream error';
    streamState.updatedAt = new Date().toISOString();
  } finally {
    tickInFlight = false;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
