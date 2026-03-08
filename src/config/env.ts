import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  REDIS_KEY_PREFIX: z.string().min(1).default('bs:v1:'),
  REDIS_STREAM_GROUP: z.string().min(1).default('bitstat-events'),
  REDIS_STREAM_CONSUMER: z.string().optional(),
  REDIS_STREAM_BATCH_SIZE: z.coerce.number().int().min(1).max(1000).default(200),
  REDIS_STREAM_BLOCK_MS: z.coerce.number().int().min(100).max(10000).default(2000),
  REDIS_STREAM_MAXLEN: z.coerce.number().int().min(1000).default(200000),
  REDIS_STREAM_RECLAIM_MIN_IDLE_MS: z.coerce.number().int().min(1000).default(60000),
  REDIS_STREAM_ENV: z.enum(['dev', 'prod']).default('prod'),
  SUPABASE_DB_URL: z.string().optional(),
  SUPABASE_JWT_SECRET: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  API_KEYS_JSON: z.string().optional(),
  API_KEY_CACHE_TTL_MS: z.coerce.number().int().min(1000).default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(200),
  RATE_LIMIT_TIME_WINDOW_MS: z.coerce.number().int().min(100).default(1000),
  READINESS_MAX_STREAM_PENDING: z.coerce.number().int().min(0).default(1000),
  READINESS_WORKER_HEARTBEAT_TTL_SEC: z.coerce.number().int().min(5).default(30),
  EVENT_MAX_PER_BATCH: z.coerce.number().int().min(1).max(500).default(500),
  EVENT_FUTURE_MAX_DAYS: z.coerce.number().int().min(0).default(30),
  EVENT_PAST_MAX_DAYS: z.coerce.number().int().min(1).default(365),
  EVENT_DEDUP_TTL_SEC: z.coerce.number().int().min(0).default(604800),
  EVENT_PROPERTIES_MAX_BYTES: z.coerce.number().int().min(256).default(8192),
  LEADERBOARD_TEMP_TTL_SEC: z.coerce.number().int().min(1).default(10),
  SCORING_RULE_CACHE_TTL_MS: z.coerce.number().int().min(1000).default(180000),
});

export const env = envSchema.parse(process.env);
