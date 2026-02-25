import { describe, expect, it } from 'vitest';

import { dayIdsForWindow } from '../src/utils/time';

describe('dayIdsForWindow', () => {
  it('returns descending day ids from a reference date', () => {
    const reference = new Date('2026-02-18T12:00:00.000Z');
    const ids = dayIdsForWindow(3, reference);

    expect(ids).toEqual(['20260218', '20260217', '20260216']);
  });
});
