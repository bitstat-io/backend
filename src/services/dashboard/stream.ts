import type { ServerResponse } from 'http';

import { getDashboardOverview } from './overview';
import type { GameScope } from '../../auth/types';

type Range = '5m' | '1h' | '24h' | '7d';
type StreamKey = string;

type StreamMeta = {
  scope: GameScope;
  range: Range;
};

type CacheEntry = {
  payload: string;
  updatedAt: number;
};

const subscribers = new Map<StreamKey, Set<ServerResponse>>();
const cache = new Map<StreamKey, CacheEntry>();
const metaIndex = new Map<StreamKey, StreamMeta>();

let timer: NodeJS.Timeout | null = null;
let tickInFlight = false;

export function registerDashboardStream(range: Range, res: ServerResponse, scope: GameScope) {
  const key = streamKey(scope, range);
  const set = subscribers.get(key) ?? new Set<ServerResponse>();
  set.add(res);
  subscribers.set(key, set);
  metaIndex.set(key, { scope, range });

  res.on('close', () => {
    removeSubscriber(key, res);
  });
  res.on('error', () => {
    removeSubscriber(key, res);
  });

  ensureTimer();
  void sendImmediateSnapshot(key, res);
}

function removeSubscriber(key: StreamKey, res: ServerResponse) {
  const set = subscribers.get(key);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) {
    subscribers.delete(key);
    metaIndex.delete(key);
    cache.delete(key);
  }
  if (subscribers.size === 0) {
    stopTimer();
  }
}

function ensureTimer() {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, 1000);
  timer.unref?.();
}

function stopTimer() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

async function sendImmediateSnapshot(key: StreamKey, res: ServerResponse) {
  try {
    const entry = cache.get(key);
    if (entry) {
      writePayload(res, entry.payload);
      return;
    }
    const meta = metaIndex.get(key);
    if (!meta) return;
    const snapshot = await getDashboardOverview(meta.range, meta.scope);
    const payload = JSON.stringify(snapshot);
    cache.set(key, { payload, updatedAt: Date.now() });
    writePayload(res, payload);
  } catch (error) {
    // ignore stream bootstrap errors
  }
}

async function tick() {
  if (tickInFlight) return;
  tickInFlight = true;
  try {
    const keys = Array.from(subscribers.keys());
    for (const key of keys) {
      const set = subscribers.get(key);
      if (!set || set.size === 0) continue;

      const cached = cache.get(key);
      const now = Date.now();
      if (!cached || now - cached.updatedAt >= 900) {
        const meta = metaIndex.get(key);
        if (!meta) continue;
        const snapshot = await getDashboardOverview(meta.range, meta.scope);
        const payload = JSON.stringify(snapshot);
        cache.set(key, { payload, updatedAt: now });
      }

      const payload = cache.get(key)?.payload;
      if (!payload) continue;

      for (const res of Array.from(set)) {
        if (res.writableEnded || res.destroyed) {
          removeSubscriber(key, res);
          continue;
        }
        writePayload(res, payload);
      }
    }
  } finally {
    tickInFlight = false;
  }
}

function writePayload(res: ServerResponse, payload: string) {
  res.write(`data: ${payload}\n\n`);
}

function streamKey(scope: GameScope, range: Range): StreamKey {
  return `${scope.tenantId}:${scope.gameId}:${scope.env}:${range}`;
}
