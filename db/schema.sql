-- BitStat Supabase schema (fresh bootstrap)
-- Notes:
-- - This file is intended for setting up a new database from scratch.
-- - Raw events are retained for 3 months via a scheduled delete.
-- - Aggregates (leaderboards, user metrics) are retained forever.

create extension if not exists "pgcrypto";

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'env_name'
      and n.nspname = 'public'
  ) then
    create type public.env_name as enum ('dev', 'prod');
  end if;
end
$$;

create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.games (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  slug text not null unique,
  name text not null,
  game_type text,
  cover_image_url text,
  is_published_prod boolean not null default false,
  is_published_dev boolean not null default false,
  published_prod_at timestamptz,
  published_dev_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  game_id uuid not null references public.games(id),
  env public.env_name not null,
  key_hash text not null,
  key_prefix text not null,
  scopes text[] not null default array['ingest'],
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists idx_api_keys_hash on public.api_keys (key_hash);

-- Optional scoring rules, versioned per game.
create table if not exists public.scoring_rules (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  version int not null,
  rules jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (game_id, version)
);

-- Raw events (append-only)
create table if not exists public.events (
  id bigserial primary key,
  tenant_id uuid not null references public.tenants(id),
  game_id uuid not null references public.games(id),
  env public.env_name not null,
  user_id text not null,
  session_id text not null,
  event_id text not null,
  game_type text,
  client_ts timestamptz not null,
  server_ts timestamptz not null default now(),
  event_properties jsonb not null,
  score numeric not null default 0,
  dedup_id text not null,
  unique (game_id, env, dedup_id)
);

create index if not exists idx_events_game_time on public.events (game_id, env, client_ts desc);
create index if not exists idx_events_user_time on public.events (game_id, env, user_id, client_ts desc);
create index if not exists idx_events_event_id on public.events (game_id, env, event_id);

-- Custom metrics per game
create table if not exists public.metric_definitions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id),
  metric_key text not null,
  data_type text not null,    -- 'int', 'float', 'bool'
  agg_type text not null,     -- 'sum', 'count', 'max', 'last'
  created_at timestamptz not null default now(),
  unique (game_id, metric_key)
);

create table if not exists public.user_metrics (
  game_id uuid not null references public.games(id),
  env public.env_name not null,
  user_id text not null,
  metric_key text not null,
  value numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (game_id, env, user_id, metric_key)
);

-- Leaderboards
create table if not exists public.leaderboard_daily (
  game_id uuid not null references public.games(id),
  env public.env_name not null,
  day date not null,
  user_id text not null,
  score numeric not null default 0,
  primary key (game_id, env, day, user_id)
);

create table if not exists public.leaderboard_all (
  game_id uuid not null references public.games(id),
  env public.env_name not null,
  user_id text not null,
  score numeric not null default 0,
  primary key (game_id, env, user_id)
);

-- Retention job (run daily):
-- delete from public.events where client_ts < now() - interval '3 months';

create unique index if not exists idx_tenants_owner_user_id on public.tenants (owner_user_id)
where owner_user_id is not null;
