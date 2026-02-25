import type { FastifyInstance } from 'fastify';

import { batchSchema, ingestResponseSchema } from '../schemas/events';
import { ingestEvents, BatchTooLargeError } from '../services/ingest/ingest';
import { requireApiKey } from '../auth/guard';

export async function eventsRoutes(app: FastifyInstance) {
  app.post(
    '/events/batch',
    {
      schema: {
        summary: 'Ingest events batch',
        description:
          'Ingest a batch of game analytics events. Requires `X-API-Key` (or `Authorization: Bearer`).',
        tags: ['Ingest'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: batchSchema,
        response: {
          200: ingestResponseSchema,
        },
      },
      preHandler: requireApiKey(['ingest']),
    },
    async (request, reply) => {
      const start = Date.now();
      const body = request.body as { events: unknown[] };
      const events = body?.events ?? [];

      try {
        const result = await ingestEvents(request.auth!.scope, events);
        const durationMs = Date.now() - start;
        request.log.info(
          {
            accepted: result.accepted,
            rejected: result.rejected,
            durationMs,
          },
          'batch ingested',
        );

        return result;
      } catch (error) {
        if (error instanceof BatchTooLargeError) {
          reply.code(400);
          return { accepted: 0, rejected: error.rejected };
        }
        throw error;
      }
    },
  );
}
