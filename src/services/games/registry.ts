import { z } from 'zod';
import type { Pipeline } from 'ioredis';

import { redis } from '../../redis/client';
import { key } from '../../redis/keys';
import type { EnvName, GameScope } from '../../auth/types';

const scopeSchema = z.object({
  tenantId: z.string().min(1),
  gameId: z.string().min(1),
  gameSlug: z.string().min(1),
  env: z.enum(['dev', 'prod']),
});

const PUBLIC_ENVS: EnvName[] = ['dev', 'prod'];

function normalizeSlug(slug: string) {
  return slug.toLowerCase();
}

export async function registerPublicGame(scope: GameScope, pipeline?: Pipeline) {
  if (!PUBLIC_ENVS.includes(scope.env)) return;
  const payload = JSON.stringify({
    tenantId: scope.tenantId,
    gameId: scope.gameId,
    gameSlug: scope.gameSlug,
    env: scope.env,
  });
  const publicKey = key.publicGames(scope.env);
  if (pipeline) {
    pipeline.hsetnx(publicKey, normalizeSlug(scope.gameSlug), payload);
    return;
  }
  await redis.hsetnx(publicKey, normalizeSlug(scope.gameSlug), payload);
}

export async function fetchPublicGame(gameSlug: string, env: EnvName): Promise<GameScope | null> {
  const raw = await redis.hget(key.publicGames(env), normalizeSlug(gameSlug));
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

export async function listPublicGames(env: EnvName): Promise<string[]> {
  const slugs = await redis.hkeys(key.publicGames(env));
  return slugs.map(normalizeSlug).sort();
}
