import type { FastifyInstance } from 'fastify';

import { healthResponseSchema, readinessResponseSchema } from '../schemas/health';
import { getHealthStatus, getReadinessStatus } from '../services/health/status';

export async function healthRoutes(app: FastifyInstance) {
  app.get(
    '/health',
    {
      schema: {
        summary: 'Health check',
        description: 'Liveness check for the API and Redis connectivity.',
        tags: ['Health'],
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => {
      return getHealthStatus();
    },
  );

  app.get(
    '/health/ready',
    {
      schema: {
        summary: 'Readiness check',
        description: 'Readiness check for Redis, Postgres, and the events worker consumer group.',
        tags: ['Health'],
        response: {
          200: readinessResponseSchema,
          503: readinessResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const status = await getReadinessStatus();
      if (status.status !== 'ok') {
        reply.code(503);
      }
      return status;
    },
  );
}
