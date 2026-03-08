import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { leaderboardQuerySchema, leaderboardResponseSchema } from '../schemas/leaderboard';
import { fetchLeaderboard } from '../services/leaderboard/leaderboard';
import { fetchPublicGame } from '../services/games/registry';

export async function leaderboardRoutes(app: FastifyInstance) {
  const gameSlugParams = z.object({
    gameSlug: z.string().min(1).describe('Game slug'),
  });

  async function handleLeaderboard(request: FastifyRequest, reply: FastifyReply, env: 'dev' | 'prod') {
    const params = request.params as { gameSlug: string };
    const query = request.query as {
      window: 'all' | '1d' | '7d' | '30d';
      limit: number;
    };
    const scope = await fetchPublicGame(params.gameSlug, env);
    if (!scope) {
      reply.code(404);
      return { error: { code: 'NOT_FOUND', message: 'Game not found.' } };
    }
    const entries = await fetchLeaderboard(scope, query.window, query.limit);
    return {
      game: {
        slug: scope.gameSlug,
        name: scope.name,
        game_type: scope.gameType,
        cover_image_url: scope.coverImageUrl,
      },
      window: query.window,
      entries,
    };
  }

  app.get(
    '/games/:gameSlug/leaderboards',
    {
      schema: {
        summary: 'Fetch leaderboard',
        description:
          'Public prod leaderboard for a game. `window` supports `all`, `1d`, `7d`, `30d` (`1d` is UTC day).',
        tags: ['Leaderboards'],
        params: gameSlugParams,
        querystring: leaderboardQuerySchema,
        response: {
          200: leaderboardResponseSchema,
        },
      },
    },
    async (request, reply) => handleLeaderboard(request, reply, 'prod'),
  );

  app.get(
    '/games/dev/:gameSlug/leaderboards',
    {
      schema: {
        summary: 'Fetch dev leaderboard',
        description:
          'Public dev leaderboard for a game. `window` supports `all`, `1d`, `7d`, `30d` (`1d` is UTC day).',
        tags: ['Leaderboards'],
        params: gameSlugParams,
        querystring: leaderboardQuerySchema,
        response: {
          200: leaderboardResponseSchema,
        },
      },
    },
    async (request, reply) => handleLeaderboard(request, reply, 'dev'),
  );
}
