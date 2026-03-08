import os from 'node:os';

import { Pool } from 'pg';

import { env } from '../config/env';
import { redis } from '../redis/client';
import { key } from '../redis/keys';
import type { Event } from '../schemas/events';
import { dayId, toDateFromClientTs } from '../utils/time';
import { scoreEvent } from '../services/ingest/scoring';

const STREAM_KEY = key.eventsStream(env.REDIS_STREAM_ENV);
const GROUP = env.REDIS_STREAM_GROUP;
const CONSUMER = env.REDIS_STREAM_CONSUMER ?? `${os.hostname()}-${process.pid}`;
const CLAIM_START_ID = '0-0';

const pool = env.SUPABASE_DB_URL ? new Pool({ connectionString: env.SUPABASE_DB_URL, max: 2 }) : null;

export type StreamRecord = {
  id: string;
  fields: Record<string, string>;
};

type EventRow = [
  string, // tenant_id
  string, // game_id
  string, // env
  string, // user_id
  string, // session_id
  string, // event_id
  string | null, // game_type
  Date, // client_ts
  Date, // server_ts
  string, // event_properties json
  number, // score
  string, // dedup_id
];

type LeaderboardAllRow = [string, string, string, number];

type LeaderboardDailyRow = [string, string, string, string, number];

type InsertedEventAggregate = {
  game_id: string;
  env: string;
  user_id: string;
  score: number;
  day: string | Date;
};

async function ensureGroup() {
  try {
    await redis.xgroup('CREATE', STREAM_KEY, GROUP, '0', 'MKSTREAM');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('BUSYGROUP')) throw error;
  }
}

function toFieldMap(fields: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const value = fields[i + 1];
    if (key) record[key] = value ?? '';
  }
  return record;
}

export function toStreamRecords(entries: unknown): StreamRecord[] {
  if (!Array.isArray(entries)) return [];

  return entries.flatMap((entry) => {
    if (!Array.isArray(entry) || entry.length < 2) return [];
    const [id, fields] = entry;
    if (typeof id !== 'string' || !Array.isArray(fields)) return [];
    const values = fields.every((value) => typeof value === 'string') ? (fields as string[]) : [];
    return values.length > 0 ? [{ id, fields: toFieldMap(values) }] : [];
  });
}

function buildInsertQuery(
  table: string,
  columns: string[],
  rows: Array<readonly unknown[]>,
  conflictClause: string,
) {
  if (rows.length === 0) return null;
  const values: unknown[] = [];
  const placeholders = rows
    .map((row, rowIndex) => {
      const start = rowIndex * columns.length;
      row.forEach((value) => values.push(value));
      const params = columns.map((_, colIndex) => `$${start + colIndex + 1}`).join(', ');
      return `(${params})`;
    })
    .join(', ');

  return {
    text: `insert into ${table} (${columns.join(', ')}) values ${placeholders} ${conflictClause}`,
    values,
  };
}

function parseRecord(record: StreamRecord) {
  const rawEvent = record.fields.event;
  if (!rawEvent) return null;

  let event: Event;
  try {
    event = JSON.parse(rawEvent) as Event;
  } catch {
    return null;
  }

  const clientDate = toDateFromClientTs(event.client_ts);
  if (!clientDate) return null;

  const score = Number(record.fields.score ?? scoreEvent(event));
  const dedupId = record.fields.dedup_id ?? `${event.user_id}:${event.session_id}:${event.event_id}:${event.client_ts}`;
  const day = record.fields.day ?? dayId(clientDate);

  return {
    event,
    score,
    dedupId,
    day,
    clientDate,
  };
}

export function buildLeaderboardRows(rows: InsertedEventAggregate[]) {
  const allMap = new Map<string, LeaderboardAllRow>();
  const dailyMap = new Map<string, LeaderboardDailyRow>();

  for (const row of rows) {
    const gameId = String(row.game_id);
    const envName = String(row.env);
    const userId = String(row.user_id);
    const score = Number(row.score ?? 0);
    const day = normalizeDay(row.day);

    const allKey = `${gameId}|${envName}|${userId}`;
    const allRow = allMap.get(allKey) ?? [gameId, envName, userId, 0];
    allRow[3] += score;
    allMap.set(allKey, allRow);

    const dailyKey = `${gameId}|${envName}|${day}|${userId}`;
    const dailyRow = dailyMap.get(dailyKey) ?? [gameId, envName, day, userId, 0];
    dailyRow[4] += score;
    dailyMap.set(dailyKey, dailyRow);
  }

  return {
    leaderboardAllRows: Array.from(allMap.values()),
    leaderboardDailyRows: Array.from(dailyMap.values()),
  };
}

async function writeBatch(records: StreamRecord[]) {
  if (!pool) {
    throw new Error('SUPABASE_DB_URL is required to run the events worker.');
  }

  const eventRows: EventRow[] = [];
  const invalidIds: string[] = [];

  for (const record of records) {
    const parsed = parseRecord(record);
    if (!parsed) {
      invalidIds.push(record.id);
      continue;
    }

    const { event, score, dedupId, day, clientDate } = parsed;
    const tenantId = record.fields.tenant_id;
    const gameId = record.fields.game_id;
    const envName = record.fields.env;

    if (!tenantId || !gameId || !envName) {
      invalidIds.push(record.id);
      continue;
    }

    eventRows.push([
      tenantId,
      gameId,
      envName,
      event.user_id,
      event.session_id,
      event.event_id,
      event.game_type ?? null,
      clientDate,
      new Date(),
      JSON.stringify(event.event_properties ?? {}),
      score,
      dedupId,
    ]);
  }

  if (eventRows.length === 0) {
    if (invalidIds.length > 0) {
      await redis.xack(STREAM_KEY, GROUP, ...invalidIds);
    }
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const eventInsert = buildInsertQuery(
      'public.events',
      [
        'tenant_id',
        'game_id',
        'env',
        'user_id',
        'session_id',
        'event_id',
        'game_type',
        'client_ts',
        'server_ts',
        'event_properties',
        'score',
        'dedup_id',
      ],
      eventRows,
      'ON CONFLICT (game_id, env, dedup_id) DO NOTHING returning game_id, env, user_id, score, client_ts::date as day',
    );

    let insertedRows: InsertedEventAggregate[] = [];
    if (eventInsert) {
      const result = await client.query(eventInsert.text, eventInsert.values);
      insertedRows = result.rows as InsertedEventAggregate[];
    }

    const { leaderboardAllRows, leaderboardDailyRows } = buildLeaderboardRows(insertedRows);

    const allInsert = buildInsertQuery(
      'public.leaderboard_all',
      ['game_id', 'env', 'user_id', 'score'],
      leaderboardAllRows,
      'ON CONFLICT (game_id, env, user_id) DO UPDATE SET score = public.leaderboard_all.score + EXCLUDED.score',
    );

    if (allInsert) {
      await client.query(allInsert.text, allInsert.values);
    }

    const dailyInsert = buildInsertQuery(
      'public.leaderboard_daily',
      ['game_id', 'env', 'day', 'user_id', 'score'],
      leaderboardDailyRows,
      'ON CONFLICT (game_id, env, day, user_id) DO UPDATE SET score = public.leaderboard_daily.score + EXCLUDED.score',
    );

    if (dailyInsert) {
      await client.query(dailyInsert.text, dailyInsert.values);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const ackIds = records.map((record) => record.id);
  if (ackIds.length > 0) {
    await redis.xack(STREAM_KEY, GROUP, ...ackIds);
  }
}

async function claimPendingBatch(): Promise<StreamRecord[]> {
  const result = await redis.xautoclaim(
    STREAM_KEY,
    GROUP,
    CONSUMER,
    env.REDIS_STREAM_RECLAIM_MIN_IDLE_MS,
    CLAIM_START_ID,
    'COUNT',
    env.REDIS_STREAM_BATCH_SIZE,
  );

  if (!Array.isArray(result) || result.length < 2) {
    return [];
  }

  return toStreamRecords(result[1]);
}

async function readNewBatch(): Promise<StreamRecord[]> {
  const result = await redis.xreadgroup(
    'GROUP',
    GROUP,
    CONSUMER,
    'COUNT',
    env.REDIS_STREAM_BATCH_SIZE,
    'BLOCK',
    env.REDIS_STREAM_BLOCK_MS,
    'STREAMS',
    STREAM_KEY,
    '>',
  );

  if (!Array.isArray(result) || result.length === 0) {
    return [];
  }

  const stream = result[0];
  if (!Array.isArray(stream) || stream.length < 2) {
    return [];
  }

  return toStreamRecords(stream[1]);
}

async function run() {
  if (!pool) {
    throw new Error('SUPABASE_DB_URL is required to run the events worker.');
  }

  await ensureGroup();

  // eslint-disable-next-line no-console
  console.log(`Worker connected. stream=${STREAM_KEY} group=${GROUP} consumer=${CONSUMER}`);

  while (true) {
    const reclaimed = await claimPendingBatch();
    const records = reclaimed.length > 0 ? reclaimed : await readNewBatch();

    if (records.length === 0) continue;

    try {
      await writeBatch(records);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Worker batch failed:', error);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

function shutdown() {
  void redis.quit();
  void pool?.end();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

function normalizeDay(value: string | Date) {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value);
}

if (require.main === module) {
  void run();
}
