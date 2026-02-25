import { z } from 'zod';

export const simulateModeSchema = z.enum(['fps', 'mobile', 'mixed']);

export const simulateRequestSchema = z.object({
  mode: simulateModeSchema.optional(),
  totalEvents: z.coerce.number().int().min(1).max(100_000).optional(),
  fpsMatches: z.coerce.number().int().min(0).max(10_000).optional(),
  rate: z.coerce.number().int().min(1).max(500).optional(),
  batchSize: z.coerce.number().int().min(1).max(500).optional(),
});

export const simulateResponseSchema = z.object({
  simulationId: z.string().min(1),
  status: z.enum(['running', 'done', 'error']),
  mode: simulateModeSchema,
  totalEvents: z.number().int().nonnegative(),
  rate: z.number().int().min(1),
  fpsMatches: z.number().int().min(0),
  batchSize: z.number().int().min(1),
  sent: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative(),
  rejected: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
});

export const simulateStreamRequestSchema = z.object({
  mode: simulateModeSchema.optional(),
  rate: z.coerce.number().int().min(1).max(500).optional(),
  batchSize: z.coerce.number().int().min(1).max(500).optional(),
});

export const simulateStreamResponseSchema = z.object({
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
});

export type SimulateRequest = z.infer<typeof simulateRequestSchema>;
export type SimulateMode = z.infer<typeof simulateModeSchema>;
