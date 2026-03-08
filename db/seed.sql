-- BitStat dev seed
-- Run after db/schema.sql on a fresh database.

with owner_tenant as (
  insert into public.core_tenants (email)
  values ('seed-owner@bitstat.io')
  on conflict (email) do update
    set email = excluded.email
  returning id
),
published_game as (
  insert into public.core_games (
    tenant_id,
    slug,
    name,
    game_type,
    cover_image_url,
    is_published_prod,
    published_prod_at
  )
  select
    owner_tenant.id,
    'tetris',
    'Tetris',
    'puzzle',
    'https://example.supabase.co/storage/v1/object/public/games/tetris.png',
    true,
    now()
  from owner_tenant
  on conflict (slug) do update
    set name = excluded.name,
        game_type = excluded.game_type,
        cover_image_url = excluded.cover_image_url,
        is_published_prod = excluded.is_published_prod,
        published_prod_at = coalesce(public.core_games.published_prod_at, excluded.published_prod_at)
  returning id
),
draft_game as (
  insert into public.core_games (
    tenant_id,
    slug,
    name,
    game_type,
    cover_image_url,
    is_published_prod,
    is_published_dev
  )
  select
    owner_tenant.id,
    'space-racer',
    'Space Racer',
    'arcade',
    'https://example.supabase.co/storage/v1/object/public/games/space-racer.png',
    false,
    false
  from owner_tenant
  on conflict (slug) do update
    set name = excluded.name,
        game_type = excluded.game_type,
        cover_image_url = excluded.cover_image_url,
        is_published_prod = excluded.is_published_prod,
        is_published_dev = excluded.is_published_dev
  returning id
)
insert into public.core_scoring_rules (game_id, version, rules, is_active)
select
  published_game.id,
  1,
  '{
    "events": {
      "match_complete": { "score": 100 },
      "kill": { "property": "kills", "multiplier": 10 },
      "purchase": { "property": "iap_amount", "multiplier": 1 }
    }
  }'::jsonb,
  true
from published_game
on conflict (game_id, version) do update
  set rules = excluded.rules,
      is_active = excluded.is_active;
