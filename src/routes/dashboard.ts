import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireOwnedGameScope } from '../auth/owner';
import { dashboardQuerySchema, dashboardResponseSchema } from '../schemas/dashboard';
import { getDashboardOverview } from '../services/dashboard/overview';
import { registerDashboardStream } from '../services/dashboard/stream';
import { requireApiKey } from '../auth/guard';

export async function dashboardRoutes(app: FastifyInstance) {
  const ownerDashboardQuerySchema = dashboardQuerySchema.extend({
    env: z.enum(['dev', 'prod']).optional(),
  });

  app.get(
    '/dashboard/overview',
    {
      schema: {
        summary: 'Dashboard overview',
        description: 'Admin overview metrics for the current game scope.',
        tags: ['Dashboard'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        querystring: dashboardQuerySchema,
        response: {
          200: dashboardResponseSchema,
        },
      },
      preHandler: requireApiKey(['read', 'admin']),
    },
    async (request) => {
      const query = request.query as { range?: '5m' | '1h' | '24h' | '7d' };
      const range = query.range ?? '5m';
      return getDashboardOverview(range, request.auth!.scope);
    },
  );

  app.get(
    '/dashboard/stream',
    {
      schema: {
        summary: 'Dashboard stream',
        description: 'Server-sent events for live dashboard updates.',
        tags: ['Dashboard'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        querystring: dashboardQuerySchema,
      },
      preHandler: requireApiKey(['read', 'admin']),
    },
    async (request, reply) => {
      const query = request.query as { range?: '5m' | '1h' | '24h' | '7d' };
      const range = query.range ?? '5m';

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      reply.hijack();
      reply.raw.write(': stream connected\n\n');
      registerDashboardStream(range, reply.raw, request.auth!.scope);
    },
  );

  app.get(
    '/dashboard/games/:gameSlug/overview',
    {
      schema: {
        summary: 'Owned game dashboard overview',
        description: 'Owner-authenticated overview metrics for a specific owned game and environment.',
        tags: ['Dashboard'],
        params: z.object({
          gameSlug: z.string().min(1).describe('Game slug'),
        }),
        querystring: ownerDashboardQuerySchema,
        response: {
          200: dashboardResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { gameSlug: string };
      const query = request.query as { env?: 'dev' | 'prod'; range?: '5m' | '1h' | '24h' | '7d' };
      const env = query.env ?? 'prod';
      const range = query.range ?? '5m';

      const resolved = await requireOwnedGameScope(request, reply, params.gameSlug, env);
      if (!resolved) return;

      return getDashboardOverview(range, resolved.scope);
    },
  );

  app.get(
    '/dashboard/games/:gameSlug/stream',
    {
      schema: {
        summary: 'Owned game dashboard stream',
        description: 'Owner-authenticated server-sent events stream for a specific owned game and environment.',
        tags: ['Dashboard'],
        params: z.object({
          gameSlug: z.string().min(1).describe('Game slug'),
        }),
        querystring: ownerDashboardQuerySchema,
      },
    },
    async (request, reply) => {
      const params = request.params as { gameSlug: string };
      const query = request.query as { env?: 'dev' | 'prod'; range?: '5m' | '1h' | '24h' | '7d' };
      const env = query.env ?? 'prod';
      const range = query.range ?? '5m';

      const resolved = await requireOwnedGameScope(request, reply, params.gameSlug, env);
      if (!resolved) return;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      reply.hijack();
      reply.raw.write(': stream connected\n\n');
      registerDashboardStream(range, reply.raw, resolved.scope);
    },
  );
}
