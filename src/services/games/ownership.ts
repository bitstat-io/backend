import { getDb } from '../../db/client';

export type OwnedGame = {
  gameId: string;
  tenantId: string;
  gameSlug: string;
};

export async function findOwnedGameBySlug(gameSlug: string, ownerUserId: string): Promise<OwnedGame | null> {
  const db = getDb();
  if (!db) return null;

  const result = await db.query(
    `select g.id as game_id, g.slug as game_slug, t.id as tenant_id
     from core.games g
     join core.tenants t on g.tenant_id = t.id
     where g.slug = $1 and t.owner_user_id = $2
     limit 1`,
    [gameSlug, ownerUserId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    gameId: String(row.game_id),
    tenantId: String(row.tenant_id),
    gameSlug: String(row.game_slug),
  };
}
