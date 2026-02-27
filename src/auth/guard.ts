import type { FastifyReply, FastifyRequest } from 'fastify';

import type { ApiScope, ApiKeyRecord } from './types';
import { findApiKey } from './store';

type ErrorPayload = { error: { code: string; message: string } };

function unauthorized(message: string): ErrorPayload {
  return { error: { code: 'UNAUTHORIZED', message } };
}

function forbidden(message: string): ErrorPayload {
  return { error: { code: 'FORBIDDEN', message } };
}

export function extractApiKey(request: FastifyRequest): string | null {
  const headerKey = request.headers['x-api-key'];
  if (typeof headerKey === 'string' && headerKey.trim().length > 0) {
    return headerKey.trim();
  }

  const auth = request.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice('bearer '.length).trim();
  }

  return null;
}

function hasScopes(record: ApiKeyRecord, required: ApiScope[]) {
  if (required.length === 0) return true;
  return required.some((scope) => record.scopes.includes(scope));
}

export function requireApiKey(requiredScopes: ApiScope[] = ['ingest']) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      reply.code(401);
      return reply.send(unauthorized('Missing API key.'));
    }

    const record = await findApiKey(apiKey);
    if (!record) {
      reply.code(401);
      return reply.send(unauthorized('Invalid API key.'));
    }

    if (!hasScopes(record, requiredScopes)) {
      reply.code(403);
      return reply.send(forbidden('Insufficient scope for this request.'));
    }

    request.auth = record;
  };
}

export function requireGameSlugMatch(request: FastifyRequest, reply: FastifyReply, gameSlug: string) {
  if (!request.auth || request.auth.scope.gameSlug !== gameSlug.toLowerCase()) {
    reply.code(403);
    reply.send(forbidden('API key does not match requested game.'));
    return false;
  }
  return true;
}
