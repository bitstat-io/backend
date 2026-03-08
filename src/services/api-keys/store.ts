import { getDb } from '../../db/client';
import type { ApiKeyRecord, ApiScope, EnvName } from '../../auth/types';
import { generateApiKey, hashApiKey, keyPrefix } from './crypto';

type ApiKeyRow = {
  id: string;
  env: EnvName;
  scopes: ApiScope[];
  key_prefix: string;
  created_at: string;
  revoked_at: string | null;
};

export async function findApiKeyRecord(rawKey: string): Promise<ApiKeyRecord | null> {
  const db = getDb();
  if (!db) return null;

  const hash = hashApiKey(rawKey);
  const result = await db.query(
    `select k.tenant_id, k.game_id, k.env, k.scopes, g.slug as game_slug
     from public.api_keys k
     join public.games g on g.id = k.game_id
     where k.key_hash = $1 and k.revoked_at is null
     limit 1`,
    [hash],
  );

  const row = result.rows[0];
  if (!row) return null;

  const scopes = normalizeScopes(row.scopes);
  return {
    key: rawKey,
    scopes,
    scope: {
      tenantId: String(row.tenant_id),
      gameId: String(row.game_id),
      gameSlug: String(row.game_slug),
      env: row.env as EnvName,
    },
  };
}

export async function listApiKeys(gameId: string): Promise<ApiKeyRow[]> {
  const db = getDb();
  if (!db) throw new Error('DB_UNAVAILABLE');

  const result = await db.query(
    `select id, env, scopes, key_prefix, created_at, revoked_at
     from public.api_keys
     where game_id = $1
     order by created_at desc`,
    [gameId],
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    env: row.env as EnvName,
    scopes: normalizeScopes(row.scopes),
    key_prefix: String(row.key_prefix),
    created_at: new Date(row.created_at).toISOString(),
    revoked_at: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
  }));
}

export async function createApiKey(params: {
  tenantId: string;
  gameId: string;
  env: EnvName;
  scopes: ApiScope[];
}) {
  const db = getDb();
  if (!db) throw new Error('DB_UNAVAILABLE');

  const rawKey = generateApiKey();
  const hash = hashApiKey(rawKey);
  const prefix = keyPrefix(rawKey);

  const result = await db.query(
    `insert into public.api_keys (tenant_id, game_id, env, key_hash, key_prefix, scopes)
     values ($1, $2, $3, $4, $5, $6)
     returning id, env, scopes, key_prefix, created_at, revoked_at`,
    [params.tenantId, params.gameId, params.env, hash, prefix, params.scopes],
  );

  const row = result.rows[0];
  return {
    id: String(row.id),
    env: row.env as EnvName,
    scopes: normalizeScopes(row.scopes),
    key_prefix: String(row.key_prefix),
    created_at: new Date(row.created_at).toISOString(),
    revoked_at: row.revoked_at ? new Date(row.revoked_at).toISOString() : null,
    key: rawKey,
  };
}

export async function revokeApiKey(gameId: string, keyId: string) {
  const db = getDb();
  if (!db) throw new Error('DB_UNAVAILABLE');

  const result = await db.query(
    `update public.api_keys
     set revoked_at = now()
     where id = $1 and game_id = $2 and revoked_at is null
     returning id, revoked_at`,
    [keyId, gameId],
  );

  const row = result.rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    revoked_at: new Date(row.revoked_at).toISOString(),
  };
}

function normalizeScopes(scopes: unknown): ApiScope[] {
  if (!Array.isArray(scopes)) return ['ingest'];
  const allowed: ApiScope[] = [];
  for (const scope of scopes) {
    if (scope === 'ingest' || scope === 'read' || scope === 'admin') {
      allowed.push(scope);
    }
  }
  return allowed.length > 0 ? allowed : ['ingest'];
}
