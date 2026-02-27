import type { Pipeline } from 'ioredis';

import { env } from '../../config/env';
import { redis } from '../../redis/client';
import { key } from '../../redis/keys';
import type { GameScope } from '../../auth/types';
import { eventSchema, type Event } from '../../schemas/events';
import { dayId, toDateFromClientTs, MS_PER_DAY } from '../../utils/time';
import { scoreEvent } from './scoring';
import { getScoringRule } from './rules';
import { recordErrors, recordEventTelemetry, recordRejections, recordRejectedLog } from '../metrics/telemetry';
import { registerPublicGame } from '../games/registry';

export type IngestResult = {
  accepted: number;
  rejected: number;
  errors?: number;
};

export class BatchTooLargeError extends Error {
  rejected: number;

  constructor(rejected: number) {
    super('Batch too large');
    this.name = 'BatchTooLargeError';
    this.rejected = rejected;
  }
}

type Candidate = {
  event: Event;
  eventDate: Date;
  dedupId: string;
  raw: unknown;
};

export async function ingestEvents(scope: GameScope, rawEvents: unknown[]): Promise<IngestResult> {
  let accepted = 0;
  let rejected = 0;
  let errors = 0;
  const rejectedLogs: string[] = [];

  const now = Date.now();
  const futureLimit = now + env.EVENT_FUTURE_MAX_DAYS * MS_PER_DAY;
  const pastLimit = now - env.EVENT_PAST_MAX_DAYS * MS_PER_DAY;

  if (rawEvents.length > env.EVENT_MAX_PER_BATCH) {
    rejected = rawEvents.length;
    rejectedLogs.push(buildRejectLog(scope, 'batch_too_large', undefined));
    const metricPipeline = redis.pipeline();
    recordRejections(metricPipeline, scope, rejected, new Date());
    recordRejectedLog(metricPipeline, scope, rejectedLogs);
    try {
      await metricPipeline.exec();
    } catch (error) {
      // ignore dashboard metrics failures
    }
    throw new BatchTooLargeError(rejected);
  }

  const candidates: Candidate[] = [];
  for (const raw of rawEvents) {
    const parsed = eventSchema.safeParse(raw);
    if (!parsed.success) {
      rejected += 1;
      rejectedLogs.push(buildRejectLog(scope, 'invalid_schema', raw));
      continue;
    }

    const event = parsed.data;
    if (!validatePropertiesSize(event.event_properties)) {
      rejected += 1;
      rejectedLogs.push(buildRejectLog(scope, 'event_properties_too_large', raw, event));
      continue;
    }
    const eventDate = toDateFromClientTs(event.client_ts);
    if (!eventDate) {
      rejected += 1;
      rejectedLogs.push(buildRejectLog(scope, 'invalid_timestamp', raw, event));
      continue;
    }

    const eventTime = eventDate.getTime();
    if (eventTime > futureLimit || eventTime < pastLimit) {
      rejected += 1;
      rejectedLogs.push(buildRejectLog(scope, 'timestamp_out_of_range', raw, event));
      continue;
    }

    const dedupId = buildDedupId(event);
    candidates.push({ event, eventDate, dedupId, raw });
  }

  let acceptedEvents = candidates;
  if (env.EVENT_DEDUP_TTL_SEC > 0 && candidates.length > 0) {
    const dedupPipeline = redis.pipeline();
    candidates.forEach((candidate) => {
      dedupPipeline.set(
        key.eventDedup(scope, candidate.dedupId),
        '1',
        'EX',
        env.EVENT_DEDUP_TTL_SEC,
        'NX',
      );
    });

    try {
      const dedupResults = await dedupPipeline.exec();
      if (!dedupResults) {
        errors = candidates.length;
        acceptedEvents = [];
      } else {
        const nextAccepted: Candidate[] = [];
        dedupResults.forEach((entry, index) => {
          const [, result] = entry ?? [];
          if (result === 'OK') {
            nextAccepted.push(candidates[index]);
            return;
          }
          rejected += 1;
          const candidate = candidates[index];
          rejectedLogs.push(buildRejectLog(scope, 'dedup_conflict', candidate.raw, candidate.event));
        });
        acceptedEvents = nextAccepted;
      }
    } catch (error) {
      errors = candidates.length;
      acceptedEvents = [];
    }
  }

  if (errors === 0 && acceptedEvents.length > 0) {
    const transaction = redis.multi();
    const scoringRule = await getScoringRule(scope.gameId);
    await registerPublicGame(scope, transaction);
    accepted = acceptedEvents.length;

    for (const candidate of acceptedEvents) {
      const { event, eventDate } = candidate;
      const score = scoreEvent(event, scoringRule);
      const day = dayId(eventDate);
      const streamPayload = JSON.stringify(event);

      transaction.zincrby(key.leaderboardAll(scope), score, event.user_id);
      transaction.zincrby(key.leaderboardDay(scope, day), score, event.user_id);
      transaction.xadd(
        key.eventsStream(scope.env),
        'MAXLEN',
        '~',
        env.REDIS_STREAM_MAXLEN,
        '*',
        'tenant_id',
        scope.tenantId,
        'game_id',
        scope.gameId,
        'game_slug',
        scope.gameSlug,
        'env',
        scope.env,
        'event',
        streamPayload,
        'score',
        String(score),
        'dedup_id',
        candidate.dedupId,
        'day',
        day,
      );

      updateStats(transaction, scope, event);
      recordEventTelemetry(transaction, scope, event, eventDate);
    }

    try {
      await transaction.exec();
    } catch (error) {
      errors = accepted;
      accepted = 0;
    }
  }

  if (rejected > 0 || errors > 0 || rejectedLogs.length > 0) {
    const now = new Date();
    const metricPipeline = redis.pipeline();
    if (rejected > 0) {
      recordRejections(metricPipeline, scope, rejected, now);
    }
    if (errors > 0) {
      recordErrors(metricPipeline, scope, errors, now);
    }
    if (rejectedLogs.length > 0) {
      recordRejectedLog(metricPipeline, scope, rejectedLogs);
    }
    try {
      await metricPipeline.exec();
    } catch (error) {
      // ignore dashboard metrics failures
    }
  }

  return errors > 0 ? { accepted, rejected, errors } : { accepted, rejected };
}

function validatePropertiesSize(properties: Record<string, unknown>) {
  try {
    const size = Buffer.byteLength(JSON.stringify(properties ?? {}), 'utf8');
    return size <= env.EVENT_PROPERTIES_MAX_BYTES;
  } catch {
    return false;
  }
}

function buildRejectLog(scope: GameScope, reason: string, raw?: unknown, event?: Event) {
  const payload = {
    ts: new Date().toISOString(),
    reason,
    event_id: event?.event_id ?? extractString(raw, 'event_id'),
    user_id: event?.user_id ?? extractString(raw, 'user_id'),
    category: event?.category ?? extractString(raw, 'category'),
    client_ts: event?.client_ts ?? extractNumber(raw, 'client_ts'),
    game_id: scope.gameId,
    game_slug: scope.gameSlug,
    tenant_id: scope.tenantId,
  };
  return JSON.stringify(payload);
}

function extractString(raw: unknown, keyName: string) {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const value = record[keyName];
  return typeof value === 'string' ? value : undefined;
}

function extractNumber(raw: unknown, keyName: string) {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const value = record[keyName];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function buildDedupId(event: Event) {
  return `${event.user_id}:${event.session_id}:${event.event_id}:${event.client_ts}`;
}

function updateStats(pipeline: Pipeline, scope: GameScope, event: Event) {
  const statsKey = key.stats(scope, event.user_id);

  pipeline.hincrby(statsKey, 'events', 1);
  if (event.game_type === 'fps') {
    pipeline.hincrby(statsKey, 'kills', toInt(event.event_properties, 'kills'));
    pipeline.hincrby(statsKey, 'deaths', toInt(event.event_properties, 'deaths'));
    pipeline.hincrby(statsKey, 'assists', toInt(event.event_properties, 'assists'));
    if (event.event_id === 'match_complete') {
      pipeline.hincrby(statsKey, 'matches', 1);
    }
    return;
  }

  if (event.game_type === 'mobile') {
    pipeline.hincrby(statsKey, 'coins', toInt(event.event_properties, 'coins'));
    pipeline.hincrby(statsKey, 'level', toInt(event.event_properties, 'level'));
    pipeline.hincrbyfloat(statsKey, 'iap_amount', toNumber(event.event_properties, 'iap_amount'));
    if (event.event_id === 'session_start') {
      pipeline.hincrby(statsKey, 'sessions', 1);
    }
  }
}

function toInt(record: Record<string, unknown>, key: string) {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function toNumber(record: Record<string, unknown>, key: string) {
  const value = record?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
