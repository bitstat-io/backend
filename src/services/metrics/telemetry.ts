import type { Pipeline } from 'ioredis';

import type { Event } from '../../schemas/events';
import type { GameScope } from '../../auth/types';
import { key } from '../../redis/keys';
import { dayId, epochHour, epochMinute, epochSecond } from '../../utils/time';

export const FUNNEL_STEPS = [
  'install',
  'tutorial_complete',
  'match_start',
  'match_complete',
  'purchase',
] as const;

const TTL_SECONDS = {
  second: 2 * 60 * 60,
  minute: 2 * 24 * 60 * 60,
  hour: 14 * 24 * 60 * 60,
  day: 90 * 24 * 60 * 60,
};

const LOG_TTL_SECONDS = 24 * 60 * 60;
const LOG_MAX_ITEMS = 60;
const REJECT_LOG_MAX_ITEMS = 80;

export function recordEventTelemetry(pipeline: Pipeline, scope: GameScope, event: Event, eventDate: Date) {
  const epochSec = epochSecond(eventDate);
  const epochMin = epochMinute(eventDate);
  const epochHr = epochHour(eventDate);
  const day = dayId(eventDate);

  const aggSec = key.aggSecond(scope, epochSec);
  const aggMin = key.aggMinute(scope, epochMin);
  const aggHour = key.aggHour(scope, epochHr);
  const aggDay = key.aggDay(scope, day);

  incrementAgg(pipeline, aggSec, event);
  incrementAgg(pipeline, aggMin, event);
  incrementAgg(pipeline, aggHour, event);
  incrementAgg(pipeline, aggDay, event);

  pipeline.expire(aggSec, TTL_SECONDS.second);
  pipeline.expire(aggMin, TTL_SECONDS.minute);
  pipeline.expire(aggHour, TTL_SECONDS.hour);
  pipeline.expire(aggDay, TTL_SECONDS.day);

  const funnelStep = normalizeFunnelStep(event.event_id);
  if (funnelStep) {
    const funnelMin = key.funnelMinute(scope, epochMin);
    const funnelHour = key.funnelHour(scope, epochHr);
    const funnelDay = key.funnelDay(scope, day);
    pipeline.hincrby(funnelMin, funnelStep, 1);
    pipeline.hincrby(funnelHour, funnelStep, 1);
    pipeline.hincrby(funnelDay, funnelStep, 1);
    pipeline.expire(funnelMin, TTL_SECONDS.minute);
    pipeline.expire(funnelHour, TTL_SECONDS.hour);
    pipeline.expire(funnelDay, TTL_SECONDS.day);
  }

  pipeline.pfadd(key.uniquePlayersMinute(scope, epochMin), event.user_id);
  pipeline.pfadd(key.uniquePlayersHour(scope, epochHr), event.user_id);
  pipeline.pfadd(key.uniquePlayersDay(scope, day), event.user_id);
  pipeline.expire(key.uniquePlayersMinute(scope, epochMin), TTL_SECONDS.minute);
  pipeline.expire(key.uniquePlayersHour(scope, epochHr), TTL_SECONDS.hour);
  pipeline.expire(key.uniquePlayersDay(scope, day), TTL_SECONDS.day);

  pipeline.zincrby(key.gameEventsMinute(scope, epochMin), 1, scope.gameId);
  pipeline.zincrby(key.gameEventsHour(scope, epochHr), 1, scope.gameId);
  pipeline.zincrby(key.gameEventsDay(scope, day), 1, scope.gameId);
  pipeline.expire(key.gameEventsMinute(scope, epochMin), TTL_SECONDS.minute);
  pipeline.expire(key.gameEventsHour(scope, epochHr), TTL_SECONDS.hour);
  pipeline.expire(key.gameEventsDay(scope, day), TTL_SECONDS.day);

  if (event.game_type === 'mobile') {
    pipeline.zincrby(key.gameIapMinute(scope, epochMin), event.event_properties.iap_amount, scope.gameId);
    pipeline.zincrby(key.gameIapHour(scope, epochHr), event.event_properties.iap_amount, scope.gameId);
    pipeline.zincrby(key.gameIapDay(scope, day), event.event_properties.iap_amount, scope.gameId);
    pipeline.expire(key.gameIapMinute(scope, epochMin), TTL_SECONDS.minute);
    pipeline.expire(key.gameIapHour(scope, epochHr), TTL_SECONDS.hour);
    pipeline.expire(key.gameIapDay(scope, day), TTL_SECONDS.day);
  }

  recordEventLog(pipeline, scope, event, eventDate);
}

export function recordRejections(pipeline: Pipeline, scope: GameScope, count: number, at: Date) {
  if (count <= 0) return;
  const epochSec = epochSecond(at);
  const epochMin = epochMinute(at);
  const epochHr = epochHour(at);
  const day = dayId(at);

  incrementAggCount(pipeline, key.aggSecond(scope, epochSec), 'rejected', count);
  incrementAggCount(pipeline, key.aggMinute(scope, epochMin), 'rejected', count);
  incrementAggCount(pipeline, key.aggHour(scope, epochHr), 'rejected', count);
  incrementAggCount(pipeline, key.aggDay(scope, day), 'rejected', count);

  pipeline.expire(key.aggSecond(scope, epochSec), TTL_SECONDS.second);
  pipeline.expire(key.aggMinute(scope, epochMin), TTL_SECONDS.minute);
  pipeline.expire(key.aggHour(scope, epochHr), TTL_SECONDS.hour);
  pipeline.expire(key.aggDay(scope, day), TTL_SECONDS.day);
}

export function recordErrors(pipeline: Pipeline, scope: GameScope, count: number, at: Date) {
  if (count <= 0) return;
  const epochSec = epochSecond(at);
  const epochMin = epochMinute(at);
  const epochHr = epochHour(at);
  const day = dayId(at);

  incrementAggCount(pipeline, key.aggSecond(scope, epochSec), 'errors', count);
  incrementAggCount(pipeline, key.aggMinute(scope, epochMin), 'errors', count);
  incrementAggCount(pipeline, key.aggHour(scope, epochHr), 'errors', count);
  incrementAggCount(pipeline, key.aggDay(scope, day), 'errors', count);

  pipeline.expire(key.aggSecond(scope, epochSec), TTL_SECONDS.second);
  pipeline.expire(key.aggMinute(scope, epochMin), TTL_SECONDS.minute);
  pipeline.expire(key.aggHour(scope, epochHr), TTL_SECONDS.hour);
  pipeline.expire(key.aggDay(scope, day), TTL_SECONDS.day);
}

function incrementAgg(pipeline: Pipeline, aggKey: string, event: Event) {
  pipeline.hincrby(aggKey, 'events', 1);
  pipeline.hincrby(aggKey, 'accepted', 1);
  if (event.game_type === 'fps') {
    pipeline.hincrby(aggKey, 'fps', 1);
    pipeline.hincrby(aggKey, 'matches', 1);
    return;
  }
  pipeline.hincrby(aggKey, 'mobile', 1);
  pipeline.hincrby(aggKey, 'sessions', 1);
  pipeline.hincrbyfloat(aggKey, 'iap', event.event_properties.iap_amount);
}

function incrementAggCount(pipeline: Pipeline, aggKey: string, field: string, count: number) {
  pipeline.hincrby(aggKey, field, count);
}

function normalizeFunnelStep(eventType?: string) {
  if (!eventType) return null;
  const normalized = eventType.toLowerCase();
  return FUNNEL_STEPS.find((step) => step === normalized) ?? null;
}

function recordEventLog(pipeline: Pipeline, scope: GameScope, event: Event, eventDate: Date) {
  const payload = JSON.stringify({
    ts: eventDate.toISOString(),
    game_id: scope.gameId,
    game_slug: scope.gameSlug,
    event_id: event.event_id,
    user_id: event.user_id,
    game_type: event.game_type,
    platform: event.platform ?? null,
    region: event.region ?? null,
  });

  const logKey = key.eventLog(scope);
  pipeline.lpush(logKey, payload);
  pipeline.ltrim(logKey, 0, LOG_MAX_ITEMS - 1);
  pipeline.expire(logKey, LOG_TTL_SECONDS);
}

export function recordRejectedLog(pipeline: Pipeline, scope: GameScope, entries: string[]) {
  if (entries.length === 0) return;
  const logKey = key.eventRejectLog(scope);
  pipeline.lpush(logKey, ...entries);
  pipeline.ltrim(logKey, 0, REJECT_LOG_MAX_ITEMS - 1);
  pipeline.expire(logKey, LOG_TTL_SECONDS);
}
