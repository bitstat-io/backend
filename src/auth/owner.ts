import type { FastifyReply, FastifyRequest } from 'fastify';

import type { EnvName, GameScope } from './types';
import { extractBearerToken } from './bearer';
import { verifySupabaseJwt } from './supabase';
import { findOwnedGameBySlug, type OwnedGame } from '../services/games/ownership';

export type SupabaseOwner = {
  id: string;
  email: string;
};

export async function requireSupabaseOwner(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<SupabaseOwner | null> {
  const token = extractBearerToken(request.headers.authorization);
  if (!token) {
    reply.code(401);
    await reply.send({ error: { code: 'UNAUTHORIZED', message: 'Missing Supabase JWT.' } });
    return null;
  }

  const user = await verifySupabaseJwt(token);
  if (!user) {
    reply.code(401);
    await reply.send({ error: { code: 'UNAUTHORIZED', message: 'Invalid Supabase JWT.' } });
    return null;
  }

  if (!user.email) {
    reply.code(400);
    await reply.send({ error: { code: 'BAD_REQUEST', message: 'Owner email is required in the auth token.' } });
    return null;
  }

  return {
    id: user.id,
    email: user.email,
  };
}

export async function requireOwnedGameScope(
  request: FastifyRequest,
  reply: FastifyReply,
  gameSlug: string,
  env: EnvName,
): Promise<{ owner: SupabaseOwner; owned: OwnedGame; scope: GameScope } | null> {
  const owner = await requireSupabaseOwner(request, reply);
  if (!owner) return null;

  const owned = await findOwnedGameBySlug(gameSlug, owner.email);
  if (!owned) {
    reply.code(404);
    await reply.send({ error: { code: 'NOT_FOUND', message: 'Game not found.' } });
    return null;
  }

  return {
    owner,
    owned,
    scope: {
      tenantId: owned.tenantId,
      gameId: owned.gameId,
      gameSlug: owned.gameSlug,
      env,
    },
  };
}
