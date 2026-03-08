import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireApiKey, requireGameSlugMatch } from '../auth/guard';
import { extractBearerToken } from '../auth/bearer';
import { verifySupabaseJwt } from '../auth/supabase';
import {
  scoringRuleDeactivateResponseSchema,
  scoringRuleResponseSchema,
  scoringRuleSchema,
  scoringRuleVersionsResponseSchema,
} from '../schemas/scoring';
import { activateRuleVersion, createRule, deactivateRules, fetchActiveRule, listRuleVersions } from '../services/scoring/store';
import { setScoringRuleCache } from '../services/ingest/rules';
import { findOwnedGameBySlug } from '../services/games/ownership';

export async function scoringRoutes(app: FastifyInstance) {
  const gameSlugParams = z.object({
    gameSlug: z.string().min(1).describe('Game slug'),
  });

  async function resolveScoringTarget(
    request: FastifyRequest,
    reply: FastifyReply,
    gameSlug: string,
    requiredScopes: Array<'read' | 'admin'>,
  ) {
    const token = extractBearerToken(request.headers.authorization);
    if (token) {
      const user = await verifySupabaseJwt(token);
      if (user) {
        const owned = await findOwnedGameBySlug(gameSlug, user.id);
        if (!owned) {
          reply.code(404);
          return reply.send({ error: { code: 'NOT_FOUND', message: 'Game not found.' } });
        }
        return { gameId: owned.gameId, gameSlug: owned.gameSlug };
      }
    }

    const authHandler = requireApiKey(requiredScopes);
    await authHandler(request as any, reply as any);
    if (reply.sent) return null;
    if (!requireGameSlugMatch(request as any, reply as any, gameSlug)) {
      return null;
    }
    return { gameId: (request as any).auth.scope.gameId, gameSlug: (request as any).auth.scope.gameSlug };
  }

  app.get(
    '/games/:gameSlug/scoring-rules',
    {
      schema: {
        summary: 'Get scoring rules',
        description: 'Fetch the active scoring rules for a game.',
        tags: ['Scoring'],
        params: gameSlugParams,
        response: {
          200: scoringRuleResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { gameSlug: string };
      const target = await resolveScoringTarget(request, reply, params.gameSlug, ['read', 'admin']);
      if (!target) return;

      const rule = await fetchActiveRule(target.gameId);
      if (!rule) {
        reply.code(404);
        return { error: { code: 'NOT_FOUND', message: 'Scoring rules not found.' } };
      }

      return {
        gameSlug: target.gameSlug,
        version: rule.version,
        rules: rule.rules,
        active: rule.active,
      };
    },
  );

  app.get(
    '/games/:gameSlug/scoring-rules/versions',
    {
      schema: {
        summary: 'List scoring rule versions',
        description: 'List scoring rule versions for a game.',
        tags: ['Scoring'],
        params: gameSlugParams,
        response: {
          200: scoringRuleVersionsResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { gameSlug: string };
      const target = await resolveScoringTarget(request, reply, params.gameSlug, ['read', 'admin']);
      if (!target) return;

      try {
        const versions = await listRuleVersions(target.gameId);
        return { gameSlug: target.gameSlug, versions };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'DB_UNAVAILABLE') {
          reply.code(503);
          return { error: { code: 'SERVICE_UNAVAILABLE', message: 'Scoring rules require database access.' } };
        }
        throw error;
      }
    },
  );

  app.post(
    '/games/:gameSlug/scoring-rules',
    {
      schema: {
        summary: 'Create scoring rules',
        description: 'Create a new active scoring rule set for a game.',
        tags: ['Scoring'],
        params: gameSlugParams,
        body: scoringRuleSchema,
        response: {
          200: scoringRuleResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { gameSlug: string };
      const target = await resolveScoringTarget(request, reply, params.gameSlug, ['admin']);
      if (!target) return;

      try {
        const rule = await createRule(target.gameId, request.body as any);
        setScoringRuleCache(target.gameId, {
          version: rule.version,
          weights: rule.rules.weights,
        });
        return {
          gameSlug: target.gameSlug,
          version: rule.version,
          rules: rule.rules,
          active: rule.active,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'DB_UNAVAILABLE') {
          reply.code(503);
          return { error: { code: 'SERVICE_UNAVAILABLE', message: 'Scoring rules require database access.' } };
        }
        throw error;
      }
    },
  );

  app.put(
    '/games/:gameSlug/scoring-rules',
    {
      schema: {
        summary: 'Replace scoring rules',
        description: 'Overwrite the active scoring rules for a game.',
        tags: ['Scoring'],
        params: gameSlugParams,
        body: scoringRuleSchema,
        response: {
          200: scoringRuleResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { gameSlug: string };
      const target = await resolveScoringTarget(request, reply, params.gameSlug, ['admin']);
      if (!target) return;

      try {
        const rule = await createRule(target.gameId, request.body as any);
        setScoringRuleCache(target.gameId, {
          version: rule.version,
          weights: rule.rules.weights,
        });
        return {
          gameSlug: target.gameSlug,
          version: rule.version,
          rules: rule.rules,
          active: rule.active,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'DB_UNAVAILABLE') {
          reply.code(503);
          return { error: { code: 'SERVICE_UNAVAILABLE', message: 'Scoring rules require database access.' } };
        }
        throw error;
      }
    },
  );

  app.put(
    '/games/:gameSlug/scoring-rules/versions/:version/activate',
    {
      schema: {
        summary: 'Activate scoring rule version',
        description: 'Set an existing scoring rule version as active.',
        tags: ['Scoring'],
        params: gameSlugParams.extend({ version: z.coerce.number().int().min(1) }),
        response: {
          200: scoringRuleResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { gameSlug: string; version: number };
      const target = await resolveScoringTarget(request, reply, params.gameSlug, ['admin']);
      if (!target) return;

      try {
        const rule = await activateRuleVersion(target.gameId, params.version);
        if (!rule) {
          reply.code(404);
          return { error: { code: 'NOT_FOUND', message: 'Scoring rule version not found.' } };
        }

        setScoringRuleCache(target.gameId, {
          version: rule.version,
          weights: rule.rules.weights,
        });

        return {
          gameSlug: target.gameSlug,
          version: rule.version,
          rules: rule.rules,
          active: rule.active,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'DB_UNAVAILABLE') {
          reply.code(503);
          return { error: { code: 'SERVICE_UNAVAILABLE', message: 'Scoring rules require database access.' } };
        }
        throw error;
      }
    },
  );

  app.delete(
    '/games/:gameSlug/scoring-rules',
    {
      schema: {
        summary: 'Deactivate scoring rules',
        description: 'Deactivate all scoring rules for a game.',
        tags: ['Scoring'],
        params: gameSlugParams,
        response: {
          200: scoringRuleDeactivateResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const params = request.params as { gameSlug: string };
      const target = await resolveScoringTarget(request, reply, params.gameSlug, ['admin']);
      if (!target) return;

      try {
        await deactivateRules(target.gameId);
        setScoringRuleCache(target.gameId, null);
        return { gameSlug: target.gameSlug, active: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message === 'DB_UNAVAILABLE') {
          reply.code(503);
          return { error: { code: 'SERVICE_UNAVAILABLE', message: 'Scoring rules require database access.' } };
        }
        throw error;
      }
    },
  );
}
