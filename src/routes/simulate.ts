import type { FastifyInstance } from 'fastify';

import { env } from '../config/env';
import {
  simulateRequestSchema,
  simulateResponseSchema,
  simulateStreamRequestSchema,
  simulateStreamResponseSchema,
} from '../schemas/simulate';
import type { SimulateMode, SimulateRequest } from '../schemas/simulate';
import { getSimulation, startSimulation } from '../services/simulate/runner';
import { getStreamState, startStream, stopStream, updateStream } from '../services/simulate/stream';
import { requireApiKey } from '../auth/guard';

export async function simulateRoutes(app: FastifyInstance) {
  app.post(
    '/simulate',
    {
      schema: {
        summary: 'Start batch simulation',
        description: 'Admin-only helper to ingest generated events.',
        tags: ['Simulate'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: simulateRequestSchema,
        response: {
          200: simulateResponseSchema,
        },
      },
      preHandler: requireApiKey(['admin']),
    },
    async (request) => {
      const body = (request.body ?? {}) as SimulateRequest;

      const mode = (body.mode ?? 'mixed') as SimulateMode;
      let totalEvents = clamp(body.totalEvents ?? env.SIM_DEFAULT_TOTAL_EVENTS, 1, 100_000);
      let fpsMatches = clamp(body.fpsMatches ?? env.SIM_DEFAULT_FPS_MATCHES, 0, 10_000);

      if (mode === 'fps') {
        fpsMatches = body.fpsMatches !== undefined ? fpsMatches : Math.floor(totalEvents / 10);
        if (fpsMatches < 1) {
          fpsMatches = 1;
        }
        totalEvents = fpsMatches * 10;
      } else if (mode === 'mobile') {
        fpsMatches = 0;
      } else if (fpsMatches * 10 > totalEvents) {
        fpsMatches = Math.floor(totalEvents / 10);
      }

      const rate = clamp(body.rate ?? env.SIM_RATE_DEFAULT, env.SIM_RATE_MIN, env.SIM_RATE_MAX);
      const batchSize = clamp(
        body.batchSize ?? Math.min(env.EVENT_MAX_PER_BATCH, Math.max(rate, 10)),
        1,
        env.EVENT_MAX_PER_BATCH,
      );

      const state = startSimulation({ scope: request.auth!.scope, mode, totalEvents, fpsMatches, rate, batchSize });

      return {
        simulationId: state.id,
        status: state.status,
        mode: state.mode,
        totalEvents: state.totalEvents,
        fpsMatches: state.fpsMatches,
        rate: state.rate,
        batchSize: state.batchSize,
        sent: state.sent,
        accepted: state.accepted,
        rejected: state.rejected,
        errors: state.errors,
      };
    },
  );

  app.get(
    '/simulate/:id',
    {
      schema: {
        summary: 'Get simulation status',
        description: 'Admin-only helper to check a simulation run.',
        tags: ['Simulate'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: simulateResponseSchema,
        },
      },
      preHandler: requireApiKey(['admin']),
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const state = getSimulation(id);
      if (!state) {
        reply.code(404);
        return {
          simulationId: id,
          status: 'error',
          mode: 'mixed',
          totalEvents: 0,
          fpsMatches: 0,
          rate: 1,
          batchSize: 1,
          sent: 0,
          accepted: 0,
          rejected: 0,
          errors: 0,
        };
      }

      return {
        simulationId: state.id,
        status: state.status,
        mode: state.mode,
        totalEvents: state.totalEvents,
        fpsMatches: state.fpsMatches,
        rate: state.rate,
        batchSize: state.batchSize,
        sent: state.sent,
        accepted: state.accepted,
        rejected: state.rejected,
        errors: state.errors,
      };
    },
  );

  app.get(
    '/simulate/stream',
    {
      schema: {
        summary: 'Get stream state',
        description: 'Admin-only helper to read the live stream simulator state.',
        tags: ['Simulate'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: simulateStreamResponseSchema,
        },
      },
      preHandler: requireApiKey(['admin']),
    },
    async () => {
      const state = getStreamState();
      return {
        simulationId: state.id,
        status: state.status,
        mode: state.mode,
        rate: state.rate,
        batchSize: state.batchSize,
        sent: state.sent,
        accepted: state.accepted,
        rejected: state.rejected,
        errors: state.errors,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        error: state.error,
      };
    },
  );

  app.post(
    '/simulate/stream',
    {
      schema: {
        summary: 'Start stream simulation',
        description: 'Admin-only helper to start a live stream of generated events.',
        tags: ['Simulate'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: simulateStreamRequestSchema,
        response: {
          200: simulateStreamResponseSchema,
        },
      },
      preHandler: requireApiKey(['admin']),
    },
    async (request) => {
      const body = (request.body ?? {}) as { mode?: SimulateMode; rate?: number; batchSize?: number };
      const mode = (body.mode ?? 'mixed') as SimulateMode;
      const rate = clamp(body.rate ?? env.SIM_RATE_DEFAULT, env.SIM_RATE_MIN, env.SIM_RATE_MAX);
      const batchSize = clamp(
        body.batchSize ?? Math.min(env.EVENT_MAX_PER_BATCH, Math.max(rate, 10)),
        1,
        env.EVENT_MAX_PER_BATCH,
      );

      const state = startStream({ scope: request.auth!.scope, mode, rate, batchSize });
      return {
        simulationId: state.id,
        status: state.status,
        mode: state.mode,
        rate: state.rate,
        batchSize: state.batchSize,
        sent: state.sent,
        accepted: state.accepted,
        rejected: state.rejected,
        errors: state.errors,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        error: state.error,
      };
    },
  );

  app.patch(
    '/simulate/stream',
    {
      schema: {
        summary: 'Update stream simulation',
        description: 'Admin-only helper to update the live stream parameters.',
        tags: ['Simulate'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        body: simulateStreamRequestSchema,
        response: {
          200: simulateStreamResponseSchema,
        },
      },
      preHandler: requireApiKey(['admin']),
    },
    async (request) => {
      const body = (request.body ?? {}) as { mode?: SimulateMode; rate?: number; batchSize?: number };
      const state = updateStream({
        scope: request.auth!.scope,
        mode: body.mode,
        rate: body.rate,
        batchSize: body.batchSize,
      });
      return {
        simulationId: state.id,
        status: state.status,
        mode: state.mode,
        rate: state.rate,
        batchSize: state.batchSize,
        sent: state.sent,
        accepted: state.accepted,
        rejected: state.rejected,
        errors: state.errors,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        error: state.error,
      };
    },
  );

  app.delete(
    '/simulate/stream',
    {
      schema: {
        summary: 'Stop stream simulation',
        description: 'Admin-only helper to stop the live stream.',
        tags: ['Simulate'],
        security: [{ apiKey: [] }, { bearerAuth: [] }],
        response: {
          200: simulateStreamResponseSchema,
        },
      },
      preHandler: requireApiKey(['admin']),
    },
    async () => {
      const state = stopStream();
      return {
        simulationId: state.id,
        status: state.status,
        mode: state.mode,
        rate: state.rate,
        batchSize: state.batchSize,
        sent: state.sent,
        accepted: state.accepted,
        rejected: state.rejected,
        errors: state.errors,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        error: state.error,
      };
    },
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
