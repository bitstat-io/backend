import { getDb } from '../../db/client';

export type OwnedGame = {
  gameId: string;
  tenantId: string;
  gameSlug: string;
  name: string;
  gameType: string | null;
  coverImageUrl: string | null;
  isPublishedProd: boolean;
  isPublishedDev: boolean;
  publishedProdAt: string | null;
  publishedDevAt: string | null;
  createdAt: string;
};

export async function findOwnedGameBySlug(gameSlug: string, ownerEmail: string): Promise<OwnedGame | null> {
  const db = getDb();
  if (!db) return null;

  const result = await db.query(
    `select
       g.id as game_id,
       g.slug as game_slug,
       g.name,
       g.game_type,
       g.cover_image_url,
       g.is_published_prod,
       g.is_published_dev,
       g.published_prod_at,
       g.published_dev_at,
       g.created_at,
       t.id as tenant_id
     from public.core_games g
     join public.core_tenants t on g.tenant_id = t.id
     where g.slug = $1 and t.email = $2
     limit 1`,
    [gameSlug, ownerEmail],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    gameId: String(row.game_id),
    tenantId: String(row.tenant_id),
    gameSlug: String(row.game_slug),
    name: String(row.name),
    gameType: row.game_type ? String(row.game_type) : null,
    coverImageUrl: row.cover_image_url ? String(row.cover_image_url) : null,
    isPublishedProd: Boolean(row.is_published_prod),
    isPublishedDev: Boolean(row.is_published_dev),
    publishedProdAt: row.published_prod_at ? new Date(row.published_prod_at).toISOString() : null,
    publishedDevAt: row.published_dev_at ? new Date(row.published_dev_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
  };
}
