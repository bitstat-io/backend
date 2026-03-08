import { z } from 'zod';

const categorySchema = z
  .string()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9_-]{2,50}$/, 'category must match ^[a-z0-9_-]{2,50}$');

const gameTypeSchema = z.string().trim().min(1).max(100);

const baseEvent = z.object({
  user_id: z.string().min(1),
  session_id: z.string().min(1),
  client_ts: z.coerce.number().int().min(1),
  v: z.coerce.number().int().min(1).optional(),
  category: categorySchema,
  event_id: z.string().min(1),
  game_type: gameTypeSchema.optional(),
  platform: z.enum(['pc', 'console', 'mobile']).optional(),
  region: z.enum(['na', 'eu', 'apac', 'latam']).optional(),
  event_properties: z.record(z.unknown()),
});

export const eventSchema = baseEvent;

export const batchSchema = z.object({
  events: z.array(z.unknown()),
});

export const ingestResponseSchema = z.object({
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative().optional(),
});

export type Event = z.infer<typeof eventSchema>;
export type BatchPayload = z.infer<typeof batchSchema>;
