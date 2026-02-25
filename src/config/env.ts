import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  API_KEYS_JSON: z.string().optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(200),
  RATE_LIMIT_TIME_WINDOW_MS: z.coerce.number().int().min(100).default(1000),
  EVENT_MAX_PER_BATCH: z.coerce.number().int().min(1).max(500).default(500),
  EVENT_FUTURE_MAX_DAYS: z.coerce.number().int().min(0).default(30),
  EVENT_PAST_MAX_DAYS: z.coerce.number().int().min(1).default(365),
  EVENT_DEDUP_TTL_SEC: z.coerce.number().int().min(0).default(0),
  LEADERBOARD_TEMP_TTL_SEC: z.coerce.number().int().min(1).default(10),
  SIM_RATE_MIN: z.coerce.number().int().min(1).default(1),
  SIM_RATE_DEFAULT: z.coerce.number().int().min(1).default(50),
  SIM_RATE_MAX: z.coerce.number().int().min(1).default(500),
  SIM_DEFAULT_TOTAL_EVENTS: z.coerce.number().int().min(1).default(500),
  SIM_DEFAULT_FPS_MATCHES: z.coerce.number().int().min(0).default(40),
});

export const env = envSchema.parse(process.env);
