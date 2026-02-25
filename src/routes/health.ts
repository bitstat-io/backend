import type { FastifyInstance } from 'fastify';

import { redis } from '../redis/client';

export async function healthRoutes(app: FastifyInstance) {
  app.get(
    '/health',
    {
      schema: {
        summary: 'Health check',
        description: 'Returns API health and Redis connectivity.',
        tags: ['Health'],
      },
    },
    async () => {
      let redisOk = false;
      try {
        const pong = await redis.ping();
        redisOk = pong === 'PONG';
      } catch {
        redisOk = false;
      }

      return {
        status: 'ok',
        redis: redisOk,
      };
    },
  );
}
