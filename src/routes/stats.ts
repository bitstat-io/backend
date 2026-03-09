import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireOwnedGameScope } from '../auth/owner';
import { redis } from '../redis/client';
import { statsQuerySchema, statsResponseSchema } from '../schemas/stats';
import { key } from '../redis/keys';
import { requireApiKey, requireGameSlugMatch } from '../auth/guard';

export async function statsRoutes(app: FastifyInstance) {
  const gameSlugParams = z.object({
    gameSlug: z.string().min(1).describe('Game slug'),
  });
  const ownerStatsQuerySchema = statsQuerySchema.extend({
    env: z.enum(['dev', 'prod']).optional(),
  });

  app.get(
    '/games/:gameSlug/stats',
    {
      schema: {
        summary: 'Player stats',
        description: 'Fetch aggregated stats for a user in a game. Requires read or admin API key.',
        tags: ['Stats'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        params: gameSlugParams,
        querystring: statsQuerySchema,
        response: {
          200: statsResponseSchema,
        },
      },
      preHandler: requireApiKey(['read', 'admin']),
    },
    async (request, reply) => {
      const params = request.params as { gameSlug: string };
      if (!requireGameSlugMatch(request, reply, params.gameSlug)) {
        return;
      }

      const query = request.query as { user_id: string };
      const statsKey = key.stats(request.auth!.scope, query.user_id);
      const stats = await redis.hgetall(statsKey);
      return {
        gameSlug: request.auth!.scope.gameSlug,
        user_id: query.user_id,
        stats,
      };
    },
  );

  app.get(
    '/dashboard/games/:gameSlug/stats',
    {
      schema: {
        summary: 'Owned game player stats',
        description: 'Owner-authenticated aggregated stats for a user in a specific owned game and environment.',
        tags: ['Stats'],
        params: gameSlugParams,
        querystring: ownerStatsQuerySchema,
        response: {
          200: statsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { gameSlug: string };
      const query = request.query as { user_id: string; env?: 'dev' | 'prod' };
      const env = query.env ?? 'prod';

      const resolved = await requireOwnedGameScope(request, reply, params.gameSlug, env);
      if (!resolved) return;

      const stats = await redis.hgetall(key.stats(resolved.scope, query.user_id));
      return {
        gameSlug: resolved.scope.gameSlug,
        user_id: query.user_id,
        stats,
      };
    },
  );
}
