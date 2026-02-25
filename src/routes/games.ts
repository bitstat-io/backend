import type { FastifyInstance } from 'fastify';

import { listPublicGames } from '../services/games/registry';
import { gamesResponseSchema } from '../schemas/games';

export async function gamesRoutes(app: FastifyInstance) {
  app.get(
    '/games',
    {
      schema: {
        summary: 'List public games',
        description:
          'Public list of games with prod leaderboards. Use `game_slug` in `/v1/games/{gameSlug}/leaderboards`.',
        tags: ['Games'],
        response: {
          200: gamesResponseSchema,
        },
      },
    },
    async () => {
      const games = (await listPublicGames()).map((slug) => ({ game_slug: slug }));
      return { games };
    },
  );
}
