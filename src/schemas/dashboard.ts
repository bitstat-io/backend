import { z } from 'zod';

import { simulateModeSchema } from './simulate';

export const dashboardRangeSchema = z.enum(['5m', '1h', '24h', '7d']);

export const dashboardQuerySchema = z.object({
  range: dashboardRangeSchema.optional(),
});

export const trafficPointSchema = z.object({
  ts: z.string().min(1),
  events: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  fps: z.number().int().nonnegative(),
  mobile: z.number().int().nonnegative(),
  iap: z.number().nonnegative(),
});

export const funnelStepSchema = z.object({
  step: z.string().min(1),
  count: z.number().int().nonnegative(),
  rate: z.number().nonnegative(),
});

export const eventLogSchema = z.object({
  ts: z.string().min(1),
  game_id: z.string().min(1),
  game_slug: z.string().min(1),
  event_id: z.string().min(1),
  user_id: z.string().min(1),
  game_type: z.enum(['fps', 'mobile']),
  platform: z.string().nullable(),
  region: z.string().nullable(),
});

export const rejectLogSchema = z.object({
  ts: z.string().min(1),
  reason: z.string().min(1),
  event_id: z.string().optional(),
  game_id: z.string().optional(),
  user_id: z.string().optional(),
  game_slug: z.string().optional(),
  tenant_id: z.string().optional(),
  category: z.string().optional(),
  client_ts: z.number().optional(),
});

export const dashboardResponseSchema = z.object({
  range: dashboardRangeSchema,
  updatedAt: z.string().min(1),
  summary: z.object({
    events: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    uniquePlayers: z.number().int().nonnegative(),
    errorRate: z.number().nonnegative(),
    rejectRate: z.number().nonnegative(),
    fpsEvents: z.number().int().nonnegative(),
    mobileEvents: z.number().int().nonnegative(),
    iap: z.number().nonnegative(),
    eventsPerSec: z.number().nonnegative(),
  }),
  stream: z.object({
    simulationId: z.string().min(1),
    status: z.enum(['running', 'stopped', 'error']),
    mode: simulateModeSchema,
    rate: z.number().int().min(1),
    batchSize: z.number().int().min(1),
    sent: z.number().int().nonnegative(),
    accepted: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    startedAt: z.string().optional(),
    updatedAt: z.string().optional(),
    error: z.string().optional(),
  }),
  recentEvents: z.array(eventLogSchema),
  recentRejected: z.array(rejectLogSchema),
  traffic: z.array(trafficPointSchema),
  funnel: z.array(funnelStepSchema),
  topGames: z.array(
    z.object({
      game_id: z.string().min(1),
      events: z.number().nonnegative(),
      iap: z.number().nonnegative(),
    }),
  ),
  topPlayers: z.array(
    z.object({
      user_id: z.string().min(1),
      score: z.number().nonnegative(),
    }),
  ),
});
