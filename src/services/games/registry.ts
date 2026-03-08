import { z } from 'zod';
import type { ChainableCommander } from 'ioredis';

import { getDb } from '../../db/client';
import { redis } from '../../redis/client';
import { key } from '../../redis/keys';
import type { EnvName, GameScope } from '../../auth/types';

const publicGameSchema = z.object({
  tenantId: z.string().min(1),
  gameId: z.string().min(1),
  gameSlug: z.string().min(1),
  name: z.string().min(1),
  gameType: z.string().nullable(),
  coverImageUrl: z.string().nullable(),
  env: z.enum(['dev', 'prod']),
});

const PUBLIC_ENVS: EnvName[] = ['dev', 'prod'];

type RedisChain = ChainableCommander;

export type PublicGame = GameScope & {
  name: string;
  gameType: string | null;
  coverImageUrl: string | null;
};

function normalizeSlug(slug: string) {
  return slug.toLowerCase();
}

export async function syncPublicGameCache(gameId: string, pipeline?: RedisChain) {
  const db = getDb();
  if (!db) return;

  const result = await db.query(
    `select
       g.id as game_id,
       g.tenant_id,
       g.slug,
       g.name,
       g.game_type,
       g.cover_image_url,
       g.is_published_prod,
       g.is_published_dev
     from public.core_games g
     where g.id = $1
     limit 1`,
    [gameId],
  );

  const row = result.rows[0];
  if (!row) return;

  for (const envName of PUBLIC_ENVS) {
    const published = envName === 'prod' ? Boolean(row.is_published_prod) : Boolean(row.is_published_dev);
    const publicKey = key.publicGames(envName);
    const gameSlug = normalizeSlug(String(row.slug));

    if (!published) {
      if (pipeline) {
        pipeline.hdel(publicKey, gameSlug);
      } else {
        await redis.hdel(publicKey, gameSlug);
      }
      continue;
    }

    const payload = JSON.stringify({
      tenantId: String(row.tenant_id),
      gameId: String(row.game_id),
      gameSlug,
      name: String(row.name),
      gameType: row.game_type ? String(row.game_type) : null,
      coverImageUrl: row.cover_image_url ? String(row.cover_image_url) : null,
      env: envName,
    });

    if (pipeline) {
      pipeline.hset(publicKey, gameSlug, payload);
    } else {
      await redis.hset(publicKey, gameSlug, payload);
    }
  }
}

export async function fetchPublicGame(gameSlug: string, env: EnvName): Promise<PublicGame | null> {
  const raw = await redis.hget(key.publicGames(env), normalizeSlug(gameSlug));
  if (raw) {
    try {
      return toPublicGame(publicGameSchema.parse(JSON.parse(raw)));
    } catch {
      // Fall through to the database-backed recovery path.
    }
  }

  const db = getDb();
  if (!db) return null;

  const publishColumn = env === 'prod' ? 'is_published_prod' : 'is_published_dev';
  const result = await db.query(
    `select
       g.tenant_id,
       g.id as game_id,
       g.slug as game_slug,
       g.name,
       g.game_type,
       g.cover_image_url
     from public.core_games g
     where g.slug = $1
       and g.${publishColumn} = true
     limit 1`,
    [normalizeSlug(gameSlug)],
  );

  const row = result.rows[0];
  if (!row) return null;

  const publicGame: PublicGame = {
    tenantId: String(row.tenant_id),
    gameId: String(row.game_id),
    gameSlug: normalizeSlug(String(row.game_slug)),
    name: String(row.name),
    gameType: row.game_type ? String(row.game_type) : null,
    coverImageUrl: row.cover_image_url ? String(row.cover_image_url) : null,
    env,
  };

  await syncPublicGameCache(publicGame.gameId).catch(() => undefined);
  return publicGame;
}

export async function listPublicGames(env: EnvName): Promise<PublicGame[]> {
  const rawValues = await redis.hvals(key.publicGames(env));
  if (rawValues.length > 0) {
    return rawValues
      .map((raw) => {
        try {
          return toPublicGame(publicGameSchema.parse(JSON.parse(raw)));
        } catch {
          return null;
        }
      })
      .filter((entry): entry is PublicGame => Boolean(entry))
      .sort((a, b) => a.gameSlug.localeCompare(b.gameSlug));
  }

  const db = getDb();
  if (!db) return [];

  const publishColumn = env === 'prod' ? 'is_published_prod' : 'is_published_dev';
  const result = await db.query(
    `select
       g.tenant_id,
       g.id as game_id,
       g.slug,
       g.name,
       g.game_type,
       g.cover_image_url
     from public.core_games g
     where g.${publishColumn} = true
     order by g.slug asc`,
  );

  const games = result.rows.map(
    (row) =>
      ({
        tenantId: String(row.tenant_id),
        gameId: String(row.game_id),
        gameSlug: normalizeSlug(String(row.slug)),
        name: String(row.name),
        gameType: row.game_type ? String(row.game_type) : null,
        coverImageUrl: row.cover_image_url ? String(row.cover_image_url) : null,
        env,
      }) satisfies PublicGame,
  );

  await Promise.all(games.map((game) => syncPublicGameCache(game.gameId).catch(() => undefined)));
  return games;
}

function toPublicGame(parsed: z.infer<typeof publicGameSchema>): PublicGame {
  return {
    tenantId: parsed.tenantId,
    gameId: parsed.gameId,
    gameSlug: normalizeSlug(parsed.gameSlug),
    name: parsed.name,
    gameType: parsed.gameType,
    coverImageUrl: parsed.coverImageUrl,
    env: parsed.env,
  };
}
