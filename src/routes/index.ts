import type { FastifyInstance } from 'fastify';

import { eventsRoutes } from './events';
import { gamesRoutes } from './games';
import { dashboardRoutes } from './dashboard';
import { healthRoutes } from './health';
import { leaderboardRoutes } from './leaderboard';
import { statsRoutes } from './stats';
import { scoringRoutes } from './scoring';

export async function registerRoutes(app: FastifyInstance) {
  await app.register(
    async (v1) => {
      await v1.register(healthRoutes);
      await v1.register(gamesRoutes);
      await v1.register(dashboardRoutes);
      await v1.register(eventsRoutes);
      await v1.register(leaderboardRoutes);
      await v1.register(statsRoutes);
      await v1.register(scoringRoutes);
    },
    { prefix: '/v1' },
  );
}
