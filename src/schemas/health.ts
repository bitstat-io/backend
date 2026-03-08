import { z } from 'zod';

const checkStatusSchema = z.enum(['ok', 'error']);

const dependencyCheckSchema = z.object({
  status: checkStatusSchema,
  configured: z.boolean().optional(),
  latency_ms: z.number().int().nonnegative().optional(),
  reason: z.string().optional(),
});

const workerCheckSchema = dependencyCheckSchema.extend({
  stream: z.string().min(1),
  group: z.string().min(1),
  pending: z.number().int().nonnegative().nullable(),
  consumers: z.number().int().nonnegative().nullable(),
});

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    redis: dependencyCheckSchema,
  }),
});

export const readinessResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  checks: z.object({
    redis: dependencyCheckSchema,
    db: dependencyCheckSchema,
    worker: workerCheckSchema,
  }),
});
