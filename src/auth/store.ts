import { z } from 'zod';

import { env } from '../config/env';
import type { ApiKeyRecord, ApiScope, GameScope } from './types';

const scopeSchema = z.enum(['ingest', 'read', 'admin']);
const envSchema = z.enum(['dev', 'staging', 'prod']);

const apiKeySchema = z.object({
  key: z.string().min(1),
  tenantId: z.string().min(1),
  gameId: z.string().min(1),
  gameSlug: z.string().min(1),
  env: envSchema,
  scopes: z.array(scopeSchema).optional(),
});

function parseApiKeys(raw: string | undefined): ApiKeyRecord[] {
  if (!raw || raw.trim().length === 0) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error('API_KEYS_JSON must be valid JSON.');
  }

  const records = z.array(apiKeySchema).parse(parsed);
  return records.map((record) => ({
    key: record.key,
    scopes: record.scopes && record.scopes.length > 0 ? record.scopes : (['ingest'] as ApiScope[]),
    scope: {
      tenantId: record.tenantId,
      gameId: record.gameId,
      gameSlug: record.gameSlug.toLowerCase(),
      env: record.env,
    },
  }));
}

const apiKeys = parseApiKeys(env.API_KEYS_JSON);
const apiKeyIndex = new Map<string, ApiKeyRecord>();
const gameSlugIndex = new Map<string, GameScope>();

for (const record of apiKeys) {
  if (apiKeyIndex.has(record.key)) {
    throw new Error(`Duplicate API key detected for key "${record.key}".`);
  }
  apiKeyIndex.set(record.key, record);

  if (record.scope.env === 'prod') {
    const existing = gameSlugIndex.get(record.scope.gameSlug);
    if (!existing) {
      gameSlugIndex.set(record.scope.gameSlug, record.scope);
      continue;
    }

    if (existing.gameId !== record.scope.gameId || existing.tenantId !== record.scope.tenantId) {
      throw new Error(`Game slug "${record.scope.gameSlug}" must be unique for prod.`);
    }
  }
}

export function findApiKey(key: string): ApiKeyRecord | null {
  return apiKeyIndex.get(key) ?? null;
}

export function findGameBySlug(gameSlug: string): GameScope | null {
  return gameSlugIndex.get(gameSlug.toLowerCase()) ?? null;
}

export function listPublicGameSlugs(): string[] {
  return Array.from(gameSlugIndex.keys()).sort();
}
