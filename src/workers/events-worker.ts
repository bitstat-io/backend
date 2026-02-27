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

if (!env.SUPABASE_DB_URL) {
  throw new Error('SUPABASE_DB_URL is required to run the events worker.');
}

const pool = new Pool({ connectionString: env.SUPABASE_DB_URL, max: 2 });

type StreamRecord = {
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
  string, // game_type
  Date, // client_ts
  Date, // server_ts
  string, // event_properties json
  number, // score
  string, // dedup_id
];

type LeaderboardAllRow = [string, string, string, number];

type LeaderboardDailyRow = [string, string, string, string, number];

async function ensureGroup() {
  try {
    await redis.xgroup('CREATE', STREAM_KEY, GROUP, '$', 'MKSTREAM');
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

async function writeBatch(records: StreamRecord[]) {
  const eventRows: EventRow[] = [];
  const allMap = new Map<string, LeaderboardAllRow>();
  const dailyMap = new Map<string, LeaderboardDailyRow>();
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
      event.game_type ?? 'other',
      clientDate,
      new Date(),
      JSON.stringify(event.event_properties ?? {}),
      score,
      dedupId,
    ]);

    const allKey = `${gameId}|${envName}|${event.user_id}`;
    const allRow = allMap.get(allKey) ?? [gameId, envName, event.user_id, 0];
    allRow[3] += score;
    allMap.set(allKey, allRow);

    const dailyKey = `${gameId}|${envName}|${day}|${event.user_id}`;
    const dailyRow = dailyMap.get(dailyKey) ?? [gameId, envName, day, event.user_id, 0];
    dailyRow[4] += score;
    dailyMap.set(dailyKey, dailyRow);
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
      'ingest.events',
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
      'ON CONFLICT (game_id, env, dedup_id) DO NOTHING',
    );

    if (eventInsert) {
      await client.query(eventInsert.text, eventInsert.values);
    }

    const leaderboardAllRows = Array.from(allMap.values());
    const leaderboardDailyRows = Array.from(dailyMap.values());

    const allInsert = buildInsertQuery(
      'analytics.leaderboard_all',
      ['game_id', 'env', 'user_id', 'score'],
      leaderboardAllRows,
      'ON CONFLICT (game_id, env, user_id) DO UPDATE SET score = analytics.leaderboard_all.score + EXCLUDED.score',
    );

    if (allInsert) {
      await client.query(allInsert.text, allInsert.values);
    }

    const dailyInsert = buildInsertQuery(
      'analytics.leaderboard_daily',
      ['game_id', 'env', 'day', 'user_id', 'score'],
      leaderboardDailyRows,
      'ON CONFLICT (game_id, env, day, user_id) DO UPDATE SET score = analytics.leaderboard_daily.score + EXCLUDED.score',
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

async function run() {
  await ensureGroup();

  // eslint-disable-next-line no-console
  console.log(`Worker connected. stream=${STREAM_KEY} group=${GROUP} consumer=${CONSUMER}`);

  while (true) {
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

    if (!result || result.length === 0) continue;

    const streamEntries = result[0]?.[1] ?? [];
    const records: StreamRecord[] = streamEntries.map(([id, fields]: [string, string[]]) => ({
      id,
      fields: toFieldMap(fields),
    }));

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
  void pool.end();
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

void run();
