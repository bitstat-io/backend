import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { ApiScope } from '../auth/types';
import { extractBearerToken } from '../auth/bearer';
import { verifySupabaseJwt } from '../auth/supabase';
import { getDb } from '../db/client';
import {
  apiKeyResponseSchema,
  apiKeysListResponseSchema,
  createGameSchema,
  createKeySchema,
  gameResponseSchema,
  gamesListResponseSchema,
  publishGameSchema,
  slugSchema,
  updateGameSchema,
} from '../schemas/owner';
import { createApiKey, listApiKeys, revokeApiKey } from '../services/api-keys/store';
import { syncPublicGameCache } from '../services/games/registry';
import { findOwnedGameBySlug } from '../services/games/ownership';

type SupabaseUser = { id: string; email?: string };

function mapGame(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    game_type: row.game_type ? String(row.game_type) : null,
    cover_image_url: row.cover_image_url ? String(row.cover_image_url) : null,
    is_published_prod: Boolean(row.is_published_prod),
    is_published_dev: Boolean(row.is_published_dev),
    published_prod_at: row.published_prod_at ? new Date(String(row.published_prod_at)).toISOString() : null,
    published_dev_at: row.published_dev_at ? new Date(String(row.published_dev_at)).toISOString() : null,
    created_at: new Date(String(row.created_at)).toISOString(),
  };
}

async function requireSupabaseUser(request: FastifyRequest, reply: FastifyReply) {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    reply.code(401);
    return reply.send({ error: { code: 'UNAUTHORIZED', message: 'Missing Supabase JWT.' } });
  }
  const user = await verifySupabaseJwt(token);
  if (!user) {
    reply.code(401);
    return reply.send({ error: { code: 'UNAUTHORIZED', message: 'Invalid Supabase JWT.' } });
  }
  return user as SupabaseUser;
}

export async function ownerRoutes(app: FastifyInstance) {
  app.get(
    '/dashboard/games',
    {
      schema: {
        summary: 'List owned games',
        description: 'List games owned by the Supabase user.',
        tags: ['Dashboard'],
        response: { 200: gamesListResponseSchema },
      },
    },
    async (request, reply) => {
      const user = await requireSupabaseUser(request as any, reply as any);
      if (!user) return;

      const db = getDb();
      if (!db) {
        reply.code(503);
        return reply.send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable.' } });
      }

      const result = await db.query(
        `select
           g.id,
           g.slug,
           g.name,
           g.game_type,
           g.cover_image_url,
           g.is_published_prod,
           g.is_published_dev,
           g.published_prod_at,
           g.published_dev_at,
           g.created_at
         from public.games g
         join public.tenants t on g.tenant_id = t.id
         where t.owner_user_id = $1
         order by g.created_at desc`,
        [user.id],
      );

      const games = result.rows.map((row) => mapGame(row));

      return { games };
    },
  );

  app.post(
    '/dashboard/games',
    {
      schema: {
        summary: 'Create game',
        description: 'Create a new game for the Supabase user.',
        tags: ['Dashboard'],
        body: createGameSchema,
        response: { 200: gameResponseSchema },
      },
    },
    async (request, reply) => {
      const user = await requireSupabaseUser(request as any, reply as any);
      if (!user) return;

      const db = getDb();
      if (!db) {
        reply.code(503);
        return reply.send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable.' } });
      }

      const body = request.body as z.infer<typeof createGameSchema>;
      const slug = body.slug.trim().toLowerCase();
      const name = body.name.trim();
      const gameType = body.game_type?.trim() || null;
      const coverImageUrl = body.cover_image_url?.trim() || null;

      const existing = await db.query(`select 1 from public.games where slug = $1 limit 1`, [slug]);
      if (existing.rows.length > 0) {
        reply.code(409);
        return reply.send({ error: { code: 'CONFLICT', message: 'Game slug already exists.' } });
      }

      const tenantResult = await db.query(
        `insert into public.tenants (owner_user_id, name)
         values ($1, $2)
         on conflict (owner_user_id) do update set name = public.tenants.name
         returning id`,
        [user.id, user.email ? `${user.email}` : `tenant-${user.id.slice(0, 8)}`],
      );
      const tenantId = String(tenantResult.rows[0].id);

      const gameResult = await db.query(
        `insert into public.games (tenant_id, slug, name, game_type, cover_image_url)
         values ($1, $2, $3, $4, $5)
         returning
           id,
           slug,
           name,
           game_type,
           cover_image_url,
           is_published_prod,
           is_published_dev,
           published_prod_at,
           published_dev_at,
           created_at`,
        [tenantId, slug, name, gameType, coverImageUrl],
      );

      return mapGame(gameResult.rows[0]);
    },
  );

  app.put(
    '/dashboard/games/:gameSlug',
    {
      schema: {
        summary: 'Update game',
        description: 'Update game metadata such as name, type, or cover image.',
        tags: ['Dashboard'],
        params: z.object({ gameSlug: slugSchema }),
        body: updateGameSchema,
        response: { 200: gameResponseSchema },
      },
    },
    async (request, reply) => {
      const user = await requireSupabaseUser(request as any, reply as any);
      if (!user) return;

      const db = getDb();
      if (!db) {
        reply.code(503);
        return reply.send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable.' } });
      }

      const params = request.params as { gameSlug: string };
      const owned = await findOwnedGameBySlug(params.gameSlug, user.id);
      if (!owned) {
        reply.code(404);
        return reply.send({ error: { code: 'NOT_FOUND', message: 'Game not found.' } });
      }

      const body = request.body as z.infer<typeof updateGameSchema>;
      const updates: string[] = [];
      const values: unknown[] = [];

      if (body.name !== undefined) {
        updates.push(`name = $${values.length + 1}`);
        values.push(body.name.trim());
      }
      if (body.game_type !== undefined) {
        updates.push(`game_type = $${values.length + 1}`);
        values.push(body.game_type ? body.game_type.trim() : null);
      }
      if (body.cover_image_url !== undefined) {
        updates.push(`cover_image_url = $${values.length + 1}`);
        values.push(body.cover_image_url ? body.cover_image_url.trim() : null);
      }

      values.push(owned.gameId);
      const result = await db.query(
        `update public.games
         set ${updates.join(', ')}
         where id = $${values.length}
         returning
           id,
           slug,
           name,
           game_type,
           cover_image_url,
           is_published_prod,
           is_published_dev,
           published_prod_at,
           published_dev_at,
           created_at`,
        values,
      );

      await syncPublicGameCache(owned.gameId).catch(() => undefined);
      return mapGame(result.rows[0]);
    },
  );

  app.put(
    '/dashboard/games/:gameSlug/publish',
    {
      schema: {
        summary: 'Publish game',
        description: 'Publish a game in the selected environment.',
        tags: ['Dashboard'],
        params: z.object({ gameSlug: slugSchema }),
        body: publishGameSchema,
        response: { 200: gameResponseSchema },
      },
    },
    async (request, reply) => {
      const user = await requireSupabaseUser(request as any, reply as any);
      if (!user) return;

      const db = getDb();
      if (!db) {
        reply.code(503);
        return reply.send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable.' } });
      }

      const params = request.params as { gameSlug: string };
      const owned = await findOwnedGameBySlug(params.gameSlug, user.id);
      if (!owned) {
        reply.code(404);
        return reply.send({ error: { code: 'NOT_FOUND', message: 'Game not found.' } });
      }
      if (!owned.coverImageUrl) {
        reply.code(400);
        return reply.send({ error: { code: 'BAD_REQUEST', message: 'A cover image is required before publishing.' } });
      }

      const body = request.body as z.infer<typeof publishGameSchema>;
      const isPublishedColumn = body.env === 'prod' ? 'is_published_prod' : 'is_published_dev';
      const publishedAtColumn = body.env === 'prod' ? 'published_prod_at' : 'published_dev_at';

      const result = await db.query(
        `update public.games
         set ${isPublishedColumn} = true,
             ${publishedAtColumn} = coalesce(${publishedAtColumn}, now())
         where id = $1
         returning
           id,
           slug,
           name,
           game_type,
           cover_image_url,
           is_published_prod,
           is_published_dev,
           published_prod_at,
           published_dev_at,
           created_at`,
        [owned.gameId],
      );

      await syncPublicGameCache(owned.gameId).catch(() => undefined);
      return mapGame(result.rows[0]);
    },
  );

  app.put(
    '/dashboard/games/:gameSlug/unpublish',
    {
      schema: {
        summary: 'Unpublish game',
        description: 'Unpublish a game in the selected environment.',
        tags: ['Dashboard'],
        params: z.object({ gameSlug: slugSchema }),
        body: publishGameSchema,
        response: { 200: gameResponseSchema },
      },
    },
    async (request, reply) => {
      const user = await requireSupabaseUser(request as any, reply as any);
      if (!user) return;

      const db = getDb();
      if (!db) {
        reply.code(503);
        return reply.send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable.' } });
      }

      const params = request.params as { gameSlug: string };
      const owned = await findOwnedGameBySlug(params.gameSlug, user.id);
      if (!owned) {
        reply.code(404);
        return reply.send({ error: { code: 'NOT_FOUND', message: 'Game not found.' } });
      }

      const body = request.body as z.infer<typeof publishGameSchema>;
      const isPublishedColumn = body.env === 'prod' ? 'is_published_prod' : 'is_published_dev';

      const result = await db.query(
        `update public.games
         set ${isPublishedColumn} = false
         where id = $1
         returning
           id,
           slug,
           name,
           game_type,
           cover_image_url,
           is_published_prod,
           is_published_dev,
           published_prod_at,
           published_dev_at,
           created_at`,
        [owned.gameId],
      );

      await syncPublicGameCache(owned.gameId).catch(() => undefined);
      return mapGame(result.rows[0]);
    },
  );

  app.get(
    '/dashboard/games/:gameSlug/api-keys',
    {
      schema: {
        summary: 'List API keys',
        description: 'List API keys for an owned game.',
        tags: ['Dashboard'],
        params: z.object({ gameSlug: slugSchema }),
        response: { 200: apiKeysListResponseSchema },
      },
    },
    async (request, reply) => {
      const user = await requireSupabaseUser(request as any, reply as any);
      if (!user) return;

      const db = getDb();
      if (!db) {
        reply.code(503);
        return reply.send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable.' } });
      }

      const params = request.params as { gameSlug: string };
      const owned = await findOwnedGameBySlug(params.gameSlug, user.id);
      if (!owned) {
        reply.code(404);
        return reply.send({ error: { code: 'NOT_FOUND', message: 'Game not found.' } });
      }

      try {
        const keys = await listApiKeys(owned.gameId);
        return {
          keys: keys.map((key) => ({
            id: key.id,
            env: key.env,
            scopes: key.scopes,
            key_prefix: key.key_prefix,
            created_at: key.created_at,
            revoked_at: key.revoked_at,
          })),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'DB_UNAVAILABLE') {
          reply.code(503);
          return reply.send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable.' } });
        }
        throw error;
      }
    },
  );

  app.post(
    '/dashboard/games/:gameSlug/api-keys',
    {
      schema: {
        summary: 'Create API key',
        description: 'Create an API key for an owned game.',
        tags: ['Dashboard'],
        params: z.object({ gameSlug: slugSchema }),
        body: createKeySchema,
        response: { 200: apiKeyResponseSchema },
      },
    },
    async (request, reply) => {
      const user = await requireSupabaseUser(request as any, reply as any);
      if (!user) return;

      const db = getDb();
      if (!db) {
        reply.code(503);
        return reply.send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable.' } });
      }

      const params = request.params as { gameSlug: string };
      const owned = await findOwnedGameBySlug(params.gameSlug, user.id);
      if (!owned) {
        reply.code(404);
        return reply.send({ error: { code: 'NOT_FOUND', message: 'Game not found.' } });
      }

      const body = request.body as z.infer<typeof createKeySchema>;
      const scopes: ApiScope[] = body.scopes && body.scopes.length > 0 ? body.scopes : ['ingest'];

      try {
        const key = await createApiKey({
          tenantId: owned.tenantId,
          gameId: owned.gameId,
          env: body.env,
          scopes,
        });
        return {
          id: key.id,
          env: key.env,
          scopes: key.scopes,
          key_prefix: key.key_prefix,
          key: key.key,
          created_at: key.created_at,
          revoked_at: key.revoked_at,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'DB_UNAVAILABLE') {
          reply.code(503);
          return reply.send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable.' } });
        }
        throw error;
      }
    },
  );

  app.delete(
    '/dashboard/games/:gameSlug/api-keys/:keyId',
    {
      schema: {
        summary: 'Revoke API key',
        description: 'Revoke an API key for an owned game.',
        tags: ['Dashboard'],
        params: z.object({ gameSlug: slugSchema, keyId: z.string().min(1) }),
        response: { 200: apiKeyResponseSchema.pick({ id: true, revoked_at: true }) },
      },
    },
    async (request, reply) => {
      const user = await requireSupabaseUser(request as any, reply as any);
      if (!user) return;

      const db = getDb();
      if (!db) {
        reply.code(503);
        return reply.send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable.' } });
      }

      const params = request.params as { gameSlug: string; keyId: string };
      const owned = await findOwnedGameBySlug(params.gameSlug, user.id);
      if (!owned) {
        reply.code(404);
        return reply.send({ error: { code: 'NOT_FOUND', message: 'Game not found.' } });
      }

      try {
        const revoked = await revokeApiKey(owned.gameId, params.keyId);
        if (!revoked) {
          reply.code(404);
          return reply.send({ error: { code: 'NOT_FOUND', message: 'API key not found.' } });
        }
        return { id: revoked.id, revoked_at: revoked.revoked_at };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'DB_UNAVAILABLE') {
          reply.code(503);
          return reply.send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'Database unavailable.' } });
        }
        throw error;
      }
    },
  );
}
