import { z } from 'zod';

const gaCategorySchema = z.enum([
  'user',
  'session_end',
  'business',
  'progression',
  'resource',
  'design',
  'error',
  'ad',
  'impression',
]);

const baseEvent = z.object({
  user_id: z.string().min(1),
  session_id: z.string().min(1),
  client_ts: z.coerce.number().int().min(1),
  v: z.coerce.number().int().min(1).optional(),
  category: gaCategorySchema,
  event_id: z.string().min(1),
  platform: z.enum(['pc', 'console', 'mobile']).optional(),
  region: z.enum(['na', 'eu', 'apac', 'latam']).optional(),
});

const fpsMetricsSchema = z.object({
  kills: z.number().int().min(0).max(200),
  deaths: z.number().int().min(0).max(200),
  assists: z.number().int().min(0).max(200),
});

const mobileMetricsSchema = z.object({
  iap_amount: z.number().min(0).max(500),
  level: z.number().int().min(0).max(500),
  coins: z.number().int().min(0).max(1_000_000),
});

export const fpsEventSchema = baseEvent.extend({
  game_type: z.literal('fps'),
  match_id: z.string().min(1).optional(),
  event_properties: fpsMetricsSchema,
});

export const mobileEventSchema = baseEvent.extend({
  game_type: z.literal('mobile'),
  event_properties: mobileMetricsSchema,
});

export const eventSchema = z.discriminatedUnion('game_type', [fpsEventSchema, mobileEventSchema]);

export const batchSchema = z.object({
  events: z.array(z.unknown()),
});

export const ingestResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative().optional(),
});

export type FpsEvent = z.infer<typeof fpsEventSchema>;
export type MobileEvent = z.infer<typeof mobileEventSchema>;
export type Event = z.infer<typeof eventSchema>;
export type BatchPayload = z.infer<typeof batchSchema>;
