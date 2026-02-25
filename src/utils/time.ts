export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const MS_PER_HOUR = 60 * 60 * 1000;
export const MS_PER_MINUTE = 60 * 1000;
export const MS_PER_SECOND = 1000;

export function toDate(ts: string): Date | null {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

export function toDateFromClientTs(clientTs: number): Date | null {
  if (!Number.isFinite(clientTs) || clientTs <= 0) {
    return null;
  }
  const normalized = clientTs < 2_000_000_000 ? clientTs * 1000 : clientTs;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

export function dayId(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, '');
}

export function epochSecond(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_SECOND);
}

export function epochMinute(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_MINUTE);
}

export function epochHour(date: Date): number {
  return Math.floor(date.getTime() / MS_PER_HOUR);
}

export function dayIdsForWindow(days: number, now = new Date()): string[] {
  const ids: string[] = [];
  for (let i = 0; i < days; i += 1) {
    ids.push(dayId(new Date(now.getTime() - i * MS_PER_DAY)));
  }
  return ids;
}
