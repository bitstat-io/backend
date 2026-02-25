import type { GameScope } from '../auth/types';

function prefix(scope: GameScope) {
  return `tenant:${scope.tenantId}:game:${scope.gameId}:env:${scope.env}`;
}

export const key = {
  publicGames: () => 'public:games',
  leaderboardAll: (scope: GameScope) => `${prefix(scope)}:lb:all`,
  leaderboardDay: (scope: GameScope, day: string) => `${prefix(scope)}:lb:day:${day}`,
  stats: (scope: GameScope, userId: string) => `${prefix(scope)}:stats:${userId}`,
  tempWindow: (scope: GameScope, window: string) => `${prefix(scope)}:tmp:lb:${window}:${Date.now()}`,
  eventDedup: (scope: GameScope, eventId: string) => `${prefix(scope)}:event:${eventId}`,
  aggSecond: (scope: GameScope, epochSec: number) => `${prefix(scope)}:agg:sec:${epochSec}`,
  aggMinute: (scope: GameScope, epochMin: number) => `${prefix(scope)}:agg:min:${epochMin}`,
  aggHour: (scope: GameScope, epochHour: number) => `${prefix(scope)}:agg:hour:${epochHour}`,
  aggDay: (scope: GameScope, day: string) => `${prefix(scope)}:agg:day:${day}`,
  funnelMinute: (scope: GameScope, epochMin: number) => `${prefix(scope)}:funnel:min:${epochMin}`,
  funnelHour: (scope: GameScope, epochHour: number) => `${prefix(scope)}:funnel:hour:${epochHour}`,
  funnelDay: (scope: GameScope, day: string) => `${prefix(scope)}:funnel:day:${day}`,
  gameEventsMinute: (scope: GameScope, epochMin: number) => `${prefix(scope)}:games:events:min:${epochMin}`,
  gameEventsHour: (scope: GameScope, epochHour: number) => `${prefix(scope)}:games:events:hour:${epochHour}`,
  gameEventsDay: (scope: GameScope, day: string) => `${prefix(scope)}:games:events:day:${day}`,
  gameIapMinute: (scope: GameScope, epochMin: number) => `${prefix(scope)}:games:iap:min:${epochMin}`,
  gameIapHour: (scope: GameScope, epochHour: number) => `${prefix(scope)}:games:iap:hour:${epochHour}`,
  gameIapDay: (scope: GameScope, day: string) => `${prefix(scope)}:games:iap:day:${day}`,
  uniquePlayersMinute: (scope: GameScope, epochMin: number) => `${prefix(scope)}:hll:players:min:${epochMin}`,
  uniquePlayersHour: (scope: GameScope, epochHour: number) => `${prefix(scope)}:hll:players:hour:${epochHour}`,
  uniquePlayersDay: (scope: GameScope, day: string) => `${prefix(scope)}:hll:players:day:${day}`,
  eventLog: (scope: GameScope) => `${prefix(scope)}:log:events`,
  eventRejectLog: (scope: GameScope) => `${prefix(scope)}:log:rejected`,
  tempDashboard: (scope: GameScope, kind: string, window: string) =>
    `${prefix(scope)}:tmp:dash:${kind}:${window}:${Date.now()}`,
};
