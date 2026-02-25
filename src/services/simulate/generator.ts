import type { Event, FpsEvent, MobileEvent } from '../../schemas/events';
import type { SimulateMode } from '../../schemas/simulate';

const FPS_PLAYERS = 200;
const MOBILE_PLAYERS = 300;
const REGIONS = ['na', 'eu', 'apac', 'latam'] as const;
const PLATFORMS = ['pc', 'console', 'mobile'] as const;

export type SimulationConfig = {
  totalEvents: number;
  fpsMatches: number;
  mode: SimulateMode;
};

export function generateEvents(config: SimulationConfig): Event[] {
  if (config.mode === 'fps') {
    return generateFpsEvents(config.fpsMatches);
  }
  if (config.mode === 'mobile') {
    return generateMobileEvents(config.totalEvents);
  }

  const fpsEvents = generateFpsEvents(config.fpsMatches);
  const remaining = Math.max(0, config.totalEvents - fpsEvents.length);
  const mobileEvents = generateMobileEvents(remaining);
  return shuffle([...fpsEvents, ...mobileEvents]);
}

function generateFpsEvents(matches: number): FpsEvent[] {
  const events: FpsEvent[] = [];
  for (let match = 0; match < matches; match += 1) {
    const matchId = `match-${match + 1}`;
    for (let player = 0; player < 10; player += 1) {
      const userId = `fps-player-${randomInt(1, FPS_PLAYERS)}`;
      const eventId = weightedPick([
        ['match_start', 0.35],
        ['match_complete', 0.35],
        ['purchase', 0.05],
        ['tutorial_complete', 0.05],
        ['install', 0.02],
        ['combat_event', 0.18],
      ]);
      events.push({
        user_id: userId,
        session_id: `fps-session-${randomInt(1, 1200)}`,
        client_ts: randomRecentClientTs(),
        category: categoryForEvent(eventId),
        event_id: eventId,
        game_type: 'fps',
        match_id: matchId,
        platform: weightedPick([
          ['pc', 0.55],
          ['console', 0.4],
          ['mobile', 0.05],
        ]) as (typeof PLATFORMS)[number],
        region: sample(REGIONS),
        event_properties: {
          kills: randomInt(0, 30),
          deaths: randomInt(0, 20),
          assists: randomInt(0, 15),
        },
      });
    }
  }
  return events;
}

function generateMobileEvents(count: number): MobileEvent[] {
  const events: MobileEvent[] = [];
  for (let i = 0; i < count; i += 1) {
    const userId = `mobile-player-${randomInt(1, MOBILE_PLAYERS)}`;
    const eventId = weightedPick([
      ['install', 0.22],
      ['tutorial_complete', 0.18],
      ['match_start', 0.22],
      ['match_complete', 0.2],
      ['purchase', 0.06],
      ['session_start', 0.12],
    ]);
    events.push({
      user_id: userId,
      session_id: `mob-session-${randomInt(1, 2200)}`,
      client_ts: randomRecentClientTs(),
      category: categoryForEvent(eventId),
      event_id: eventId,
      game_type: 'mobile',
      platform: 'mobile',
      region: sample(REGIONS),
      event_properties: {
        iap_amount: Number((Math.random() * 9.99).toFixed(2)),
        level: randomInt(1, 50),
        coins: randomInt(0, 5000),
      },
    });
  }
  return events;
}

function randomRecentClientTs(): number {
  const now = Date.now();
  const offsetMs = randomInt(0, 5 * 60 * 1000);
  return Math.floor((now - offsetMs) / 1000);
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sample<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function weightedPick(entries: Array<[string, number]>): string {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const roll = Math.random() * total;
  let acc = 0;
  for (const [value, weight] of entries) {
    acc += weight;
    if (roll <= acc) {
      return value;
    }
  }
  return entries[entries.length - 1][0];
}

function categoryForEvent(eventId: string) {
  if (eventId === 'purchase') return 'business' as const;
  if (eventId === 'install') return 'user' as const;
  if (eventId === 'session_start' || eventId === 'session_end') return 'session_end' as const;
  return 'design' as const;
}

function shuffle<T>(items: T[]): T[] {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
