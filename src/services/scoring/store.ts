import { getDb } from '../../db/client';
import type { ScoringRulePayload } from '../../schemas/scoring';

export type StoredRule = {
  version: number;
  rules: ScoringRulePayload;
  active: boolean;
};

export async function fetchActiveRule(gameId: string): Promise<StoredRule | null> {
  const db = getDb();
  if (!db) return null;

  const result = await db.query(
    'select version, rules, is_active from core.scoring_rules where game_id = $1 and is_active = true order by version desc limit 1',
    [gameId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    version: Number(row.version ?? 0) || 0,
    rules: row.rules as ScoringRulePayload,
    active: Boolean(row.is_active),
  };
}

export async function createRule(gameId: string, payload: ScoringRulePayload): Promise<StoredRule> {
  const db = getDb();
  if (!db) {
    throw new Error('DB_UNAVAILABLE');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const versionResult = await client.query('select coalesce(max(version), 0) as version from core.scoring_rules where game_id = $1', [
      gameId,
    ]);
    const nextVersion = Number(versionResult.rows[0]?.version ?? 0) + 1;

    await client.query('update core.scoring_rules set is_active = false where game_id = $1 and is_active = true', [
      gameId,
    ]);

    const insert = await client.query(
      'insert into core.scoring_rules (game_id, version, rules, is_active) values ($1, $2, $3, true) returning version, rules, is_active',
      [gameId, nextVersion, payload],
    );

    await client.query('COMMIT');

    const row = insert.rows[0];
    return {
      version: Number(row.version ?? nextVersion),
      rules: row.rules as ScoringRulePayload,
      active: Boolean(row.is_active),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function listRuleVersions(gameId: string): Promise<Array<{ version: number; active: boolean; created_at: string }>> {
  const db = getDb();
  if (!db) {
    throw new Error('DB_UNAVAILABLE');
  }

  const result = await db.query(
    'select version, is_active, created_at from core.scoring_rules where game_id = $1 order by version desc',
    [gameId],
  );

  return result.rows.map((row) => ({
    version: Number(row.version ?? 0) || 0,
    active: Boolean(row.is_active),
    created_at: new Date(row.created_at).toISOString(),
  }));
}

export async function deactivateRules(gameId: string): Promise<void> {
  const db = getDb();
  if (!db) {
    throw new Error('DB_UNAVAILABLE');
  }

  await db.query('update core.scoring_rules set is_active = false where game_id = $1 and is_active = true', [gameId]);
}

export async function activateRuleVersion(gameId: string, version: number): Promise<StoredRule | null> {
  const db = getDb();
  if (!db) {
    throw new Error('DB_UNAVAILABLE');
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const target = await client.query(
      'select version, rules, is_active from core.scoring_rules where game_id = $1 and version = $2 limit 1',
      [gameId, version],
    );
    const row = target.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    await client.query('update core.scoring_rules set is_active = false where game_id = $1 and is_active = true', [gameId]);
    await client.query('update core.scoring_rules set is_active = true where game_id = $1 and version = $2', [
      gameId,
      version,
    ]);

    await client.query('COMMIT');

    return {
      version: Number(row.version ?? version) || version,
      rules: row.rules as ScoringRulePayload,
      active: true,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
