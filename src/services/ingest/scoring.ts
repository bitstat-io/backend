import type { Event, FpsEvent, MobileEvent } from '../../schemas/events';

export function scoreEvent(event: Event): number {
  if (event.game_type === 'fps') {
    return scoreFps(event);
  }
  return scoreMobile(event);
}

export function scoreFps(event: FpsEvent): number {
  const { kills, assists, deaths } = event.event_properties;
  return kills * 2 + assists * 1 - deaths * 1;
}

export function scoreMobile(event: MobileEvent): number {
  const { coins, level, iap_amount } = event.event_properties;
  return coins * 1 + level * 10 + iap_amount * 100;
}
