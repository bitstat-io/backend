import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

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
  slugSchema,
} from '../schemas/owner';
import { createApiKey, fetchApiKey, listApiKeys, revokeApiKey } from '../services/api-keys/store';
import { findOwnedGameBySlug } from '../services/games/ownership';

type SupabaseUser = { id: string; email?: string };

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
        `select g.id, g.slug, g.name, g.game_type, g.created_at
         from core.games g
         join core.tenants t on g.tenant_id = t.id
         where t.owner_user_id = $1
         order by g.created_at desc`,
        [user.id],
      );

      const games = result.rows.map((row) => ({
        id: String(row.id),
        slug: String(row.slug),
        name: String(row.name),
        game_type: row.game_type as any,
        created_at: new Date(row.created_at).toISOString(),
      }));

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
      const gameType = body.game_type ?? 'other';

      const existing = await db.query(`select 1 from core.games where slug = $1 limit 1`, [slug]);
      if (existing.rows.length > 0) {
        reply.code(409);
        return reply.send({ error: { code: 'CONFLICT', message: 'Game slug already exists.' } });
      }

      const tenantResult = await db.query(
        `insert into core.tenants (owner_user_id, name)
         values ($1, $2)
         on conflict (owner_user_id) do update set name = core.tenants.name
         returning id`,
        [user.id, user.email ? `${user.email}` : `tenant-${user.id.slice(0, 8)}`],
      );
      const tenantId = String(tenantResult.rows[0].id);

      const gameResult = await db.query(
        `insert into core.games (tenant_id, slug, name, game_type)
         values ($1, $2, $3, $4)
         returning id, slug, name, game_type, created_at`,
        [tenantId, slug, name, gameType],
      );

      const row = gameResult.rows[0];
      return {
        id: String(row.id),
        slug: String(row.slug),
        name: String(row.name),
        game_type: row.game_type as any,
        created_at: new Date(row.created_at).toISOString(),
      };
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
      const scopes = body.scopes && body.scopes.length > 0 ? body.scopes : ['ingest'];

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
        if (message === 'ENCRYPTION_SECRET_MISSING') {
          reply.code(503);
          return reply.send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'API key encryption not configured.' } });
        }
        throw error;
      }
    },
  );

  app.get(
    '/dashboard/games/:gameSlug/api-keys/:keyId',
    {
      schema: {
        summary: 'Fetch API key',
        description: 'Fetch an API key value (explicit request).',
        tags: ['Dashboard'],
        params: z.object({ gameSlug: slugSchema, keyId: z.string().min(1) }),
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

      const params = request.params as { gameSlug: string; keyId: string };
      const owned = await findOwnedGameBySlug(params.gameSlug, user.id);
      if (!owned) {
        reply.code(404);
        return reply.send({ error: { code: 'NOT_FOUND', message: 'Game not found.' } });
      }

      try {
        const key = await fetchApiKey(owned.gameId, params.keyId);
        if (!key) {
          reply.code(404);
          return reply.send({ error: { code: 'NOT_FOUND', message: 'API key not found.' } });
        }
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
        if (message === 'ENCRYPTION_SECRET_MISSING') {
          reply.code(503);
          return reply.send({ error: { code: 'SERVICE_UNAVAILABLE', message: 'API key encryption not configured.' } });
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
