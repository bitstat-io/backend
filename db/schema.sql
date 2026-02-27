-- BitStat Supabase schema (MVP)
-- Notes:
-- - Raw events are retained for 3 months via a scheduled delete.
-- - Aggregates (leaderboards, user metrics) are retained forever.

create extension if not exists "pgcrypto";

create schema if not exists core;
create schema if not exists ingest;
create schema if not exists analytics;

create type core.env_name as enum ('dev', 'prod');

-- Game types are data-driven for easy expansion.
create table if not exists core.game_types (
  code text primary key,
  label text not null
);

insert into core.game_types (code, label) values
  ('fps', 'FPS'),
  ('mmo', 'MMO'),
  ('mobile', 'Mobile'),
  ('other', 'Other')
on conflict do nothing;

create table if not exists core.tenants (
  id uuid primary key default gen_random_uuid(),
  owner_user_id text,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists core.games (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references core.tenants(id),
  slug text not null unique,
  name text not null,
  game_type text not null references core.game_types(code),
  created_at timestamptz not null default now()
);

create table if not exists core.api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references core.tenants(id),
  game_id uuid not null references core.games(id),
  env core.env_name not null,
  key_hash text not null,
  scopes text[] not null default array['ingest'],
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- Optional scoring rules, versioned per game.
create table if not exists core.scoring_rules (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references core.games(id),
  version int not null,
  rules jsonb not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (game_id, version)
);

-- Raw events (append-only)
create table if not exists ingest.events (
  id bigserial primary key,
  tenant_id uuid not null references core.tenants(id),
  game_id uuid not null references core.games(id),
  env core.env_name not null,
  user_id text not null,
  session_id text not null,
  event_id text not null,
  game_type text not null references core.game_types(code),
  client_ts timestamptz not null,
  server_ts timestamptz not null default now(),
  event_properties jsonb not null,
  score numeric not null default 0,
  dedup_id text not null,
  unique (game_id, env, dedup_id)
);

create index if not exists idx_events_game_time on ingest.events (game_id, env, client_ts desc);
create index if not exists idx_events_user_time on ingest.events (game_id, env, user_id, client_ts desc);
create index if not exists idx_events_event_id on ingest.events (game_id, env, event_id);

-- Custom metrics per game
create table if not exists analytics.metric_definitions (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references core.games(id),
  metric_key text not null,
  data_type text not null,    -- 'int', 'float', 'bool'
  agg_type text not null,     -- 'sum', 'count', 'max', 'last'
  created_at timestamptz not null default now(),
  unique (game_id, metric_key)
);

create table if not exists analytics.user_metrics (
  game_id uuid not null references core.games(id),
  env core.env_name not null,
  user_id text not null,
  metric_key text not null,
  value numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (game_id, env, user_id, metric_key)
);

-- Leaderboards
create table if not exists analytics.leaderboard_daily (
  game_id uuid not null references core.games(id),
  env core.env_name not null,
  day date not null,
  user_id text not null,
  score numeric not null default 0,
  primary key (game_id, env, day, user_id)
);

create table if not exists analytics.leaderboard_all (
  game_id uuid not null references core.games(id),
  env core.env_name not null,
  user_id text not null,
  score numeric not null default 0,
  primary key (game_id, env, user_id)
);

-- Retention job (run daily):
-- delete from ingest.events where client_ts < now() - interval '3 months';
