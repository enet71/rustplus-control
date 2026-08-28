import { readJson, writeJson } from '../../shared/local-storage';
import type { AppEvent } from '../../shared/api-types';

const EVENTS_KEY = 'rustplus-control.events';
export const MAX_EVENTS = 150;

export function readEventLog(): AppEvent[] {
  const events = readJson<AppEvent[]>(EVENTS_KEY, []);
  return Array.isArray(events) ? events.slice(0, MAX_EVENTS) : [];
}

export function writeEventLog(events: AppEvent[]): void {
  writeJson(EVENTS_KEY, events);
}

/** Newest first, without duplicating an event the server re-sent after a reconnect. */
export function appendEvent(current: AppEvent[], event: AppEvent): AppEvent[] {
  return [event, ...current.filter((item) => item.id !== event.id)].slice(0, MAX_EVENTS);
}
