import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { redis } from '../redis/client';
import { statsQuerySchema, statsResponseSchema } from '../schemas/stats';
import { key } from '../redis/keys';
import { requireApiKey, requireGameSlugMatch } from '../auth/guard';

export async function statsRoutes(app: FastifyInstance) {
  const gameSlugParams = z.object({
    gameSlug: z.string().min(1).describe('Game slug'),
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
}
