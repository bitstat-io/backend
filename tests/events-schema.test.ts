import { describe, expect, it } from 'vitest';

import { eventSchema } from '../src/schemas/events';

describe('eventSchema', () => {
  it('accepts arbitrary game types as metadata', () => {
    const parsed = eventSchema.safeParse({
      user_id: 'player_1',
      session_id: 'session_1',
      client_ts: 1761246154,
      category: 'combat',
      event_id: 'match_complete',
      game_type: 'rts',
      event_properties: {},
    });

    expect(parsed.success).toBe(true);
  });

  it('allows events without a game type', () => {
    const parsed = eventSchema.safeParse({
      user_id: 'player_1',
      session_id: 'session_1',
      client_ts: 1761246154,
      category: 'combat',
      event_id: 'match_complete',
      event_properties: {},
    });

    expect(parsed.success).toBe(true);
  });
});
