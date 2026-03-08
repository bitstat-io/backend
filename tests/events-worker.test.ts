import { describe, expect, it } from 'vitest';

import { buildLeaderboardRows, toStreamRecords } from '../src/workers/events-worker';

describe('events worker helpers', () => {
  it('parses stream entries returned by Redis', () => {
    const records = toStreamRecords([
      ['1710000000-0', ['tenant_id', 'tenant-1', 'game_id', 'game-1', 'event', '{"event_id":"a"}']],
    ]);

    expect(records).toEqual([
      {
        id: '1710000000-0',
        fields: {
          tenant_id: 'tenant-1',
          game_id: 'game-1',
          event: '{"event_id":"a"}',
        },
      },
    ]);
  });

  it('builds leaderboard rows only from inserted events', () => {
    const rows = buildLeaderboardRows([
      { game_id: 'game-1', env: 'prod', user_id: 'u1', score: 10, day: '2026-03-08' },
      { game_id: 'game-1', env: 'prod', user_id: 'u1', score: 5, day: '2026-03-08' },
      { game_id: 'game-1', env: 'prod', user_id: 'u2', score: 7, day: '2026-03-07' },
    ]);

    expect(rows.leaderboardAllRows).toEqual([
      ['game-1', 'prod', 'u1', 15],
      ['game-1', 'prod', 'u2', 7],
    ]);
    expect(rows.leaderboardDailyRows).toEqual([
      ['game-1', 'prod', '2026-03-08', 'u1', 15],
      ['game-1', 'prod', '2026-03-07', 'u2', 7],
    ]);
  });
});
