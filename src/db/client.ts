import { Pool } from 'pg';

import { env } from '../config/env';

let pool: Pool | null = null;

if (env.SUPABASE_DB_URL) {
  pool = new Pool({ connectionString: env.SUPABASE_DB_URL, max: 4 });
}

export function getDb() {
  return pool;
}
