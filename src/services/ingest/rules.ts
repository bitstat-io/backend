import { z } from 'zod';

import { env } from '../../config/env';
import { getDb } from '../../db/client';
import type { ScoringRule } from './scoring';

const metricWeightsSchema = z.record(z.number());
const ruleSchema = z.object({
  weights: z.object({
    default: metricWeightsSchema.optional(),
    category: z.record(metricWeightsSchema).optional(),
    event: z.record(metricWeightsSchema).optional(),
  }),
});

type CacheEntry = {
  rule: ScoringRule | null;
  fetchedAt: number;
};

const CACHE_TTL_MS = env.SCORING_RULE_CACHE_TTL_MS;
const cache = new Map<string, CacheEntry>();

export async function getScoringRule(gameId: string): Promise<ScoringRule | null> {
  const now = Date.now();
  const cached = cache.get(gameId);
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.rule;
  }

  const db = getDb();
  if (!db) {
    cache.set(gameId, { rule: null, fetchedAt: now });
    return null;
  }

  try {
    const result = await db.query(
      'select version, rules from public.scoring_rules where game_id = $1 and is_active = true order by version desc limit 1',
      [gameId],
    );

    const row = result.rows[0];
    if (!row) {
      cache.set(gameId, { rule: null, fetchedAt: now });
      return null;
    }

    const parsed = ruleSchema.safeParse(row.rules ?? {});
    if (!parsed.success) {
      cache.set(gameId, { rule: null, fetchedAt: now });
      return null;
    }

    const rule: ScoringRule = {
      version: Number(row.version ?? 0) || 0,
      weights: parsed.data.weights,
    };

    cache.set(gameId, { rule, fetchedAt: now });
    return rule;
  } catch (error) {
    cache.set(gameId, { rule: null, fetchedAt: now });
    return null;
  }
}

export function setScoringRuleCache(gameId: string, rule: ScoringRule | null) {
  cache.set(gameId, { rule, fetchedAt: Date.now() });
}
