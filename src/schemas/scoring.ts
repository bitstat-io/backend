import { z } from 'zod';

const metricWeightsSchema = z.record(z.number());

export const scoringRuleSchema = z.object({
  weights: z.object({
    default: metricWeightsSchema.optional(),
    category: z.record(metricWeightsSchema).optional(),
    event: z.record(metricWeightsSchema).optional(),
  }),
});

export const scoringRuleResponseSchema = z.object({
  gameSlug: z.string().min(1),
  version: z.number().int().nonnegative(),
  rules: scoringRuleSchema,
  active: z.boolean(),
});

export const scoringRuleVersionSchema = z.object({
  version: z.number().int().nonnegative(),
  active: z.boolean(),
  created_at: z.string().min(1),
});

export const scoringRuleVersionsResponseSchema = z.object({
  gameSlug: z.string().min(1),
  versions: z.array(scoringRuleVersionSchema),
});

export const scoringRuleDeactivateResponseSchema = z.object({
  gameSlug: z.string().min(1),
  active: z.literal(false),
});

export type ScoringRulePayload = z.infer<typeof scoringRuleSchema>;
