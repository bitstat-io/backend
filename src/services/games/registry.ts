import { z } from 'zod';
import type { Pipeline } from 'ioredis';

import { redis } from '../../redis/client';
import { key } from '../../redis/keys';
import type { GameScope } from '../../auth/types';

const scopeSchema = z.object({
  tenantId: z.string().min(1),
  gameId: z.string().min(1),
  gameSlug: z.string().min(1),
  env: z.enum(['dev', 'staging', 'prod']),
});

function normalizeSlug(slug: string) {
  return slug.toLowerCase();
}

export async function registerPublicGame(scope: GameScope, pipeline?: Pipeline) {
  if (scope.env !== 'prod') return;
  const payload = JSON.stringify({
    tenantId: scope.tenantId,
    gameId: scope.gameId,
    gameSlug: scope.gameSlug,
    env: scope.env,
  });
  if (pipeline) {
    pipeline.hsetnx(key.publicGames(), normalizeSlug(scope.gameSlug), payload);
    return;
  }
  await redis.hsetnx(key.publicGames(), normalizeSlug(scope.gameSlug), payload);
}

export async function fetchPublicGame(gameSlug: string): Promise<GameScope | null> {
  const raw = await redis.hget(key.publicGames(), normalizeSlug(gameSlug));
  if (!raw) return null;
  try {
    const parsed = scopeSchema.parse(JSON.parse(raw));
    return {
      tenantId: parsed.tenantId,
      gameId: parsed.gameId,
      gameSlug: normalizeSlug(parsed.gameSlug),
      env: parsed.env,
    };
  } catch {
    return null;
  }
}

export async function listPublicGames(): Promise<string[]> {
  const slugs = await redis.hkeys(key.publicGames());
  return slugs.map(normalizeSlug).sort();
}
