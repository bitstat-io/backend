import type { Event } from '../../schemas/events';

export type ScoringRule = {
  version: number;
  weights: {
    default?: Record<string, number>;
    category?: Record<string, Record<string, number>>;
    event?: Record<string, Record<string, number>>;
  };
};

export function scoreEvent(event: Event, rule?: ScoringRule | null): number {
  if (rule) {
    const weights = selectWeights(rule, event);
    if (weights) {
      return scoreWithWeights(event, weights);
    }
  }

  const explicit = toNumber(event.event_properties?.['score']);
  return explicit ?? 0;
}

function selectWeights(rule: ScoringRule, event: Event) {
  const byEvent = rule.weights.event?.[event.event_id];
  if (byEvent) return byEvent;
  const byCategory = rule.weights.category?.[event.category];
  if (byCategory) return byCategory;
  return rule.weights.default;
}

function scoreWithWeights(event: Event, weights: Record<string, number>): number {
  let score = 0;
  const props = event.event_properties ?? {};
  for (const [metric, weight] of Object.entries(weights)) {
    if (metric === 'score') {
      score += weight;
      continue;
    }
    const raw = (props as Record<string, unknown>)[metric];
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      score += raw * weight;
      continue;
    }
    if (typeof raw === 'boolean') {
      score += (raw ? 1 : 0) * weight;
    }
  }
  return score;
}

function toNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
