/**
 * In-memory notification lead-time configuration store, same get/set/
 * subscribe seam as `src/observer/config.ts`.
 */
// ponytail: in-memory only - there is no `app_settings` table yet in
// `src/db/schema.ts`. Upgrade path: persist in the settings k/v table when
// the settings work lands.

/** Default lead time: notify 10 minutes before AOS. */
export const DEFAULT_LEAD_MINUTES = 10;
/** Inclusive bounds for the lead time (minutes). */
export const MIN_LEAD_MINUTES = 1;
export const MAX_LEAD_MINUTES = 120;

type LeadListener = (leadMinutes: number) => void;

let leadMinutes: number = DEFAULT_LEAD_MINUTES;
const listeners = new Set<LeadListener>();

export function getLeadMinutes(): number {
  return leadMinutes;
}

export function setLeadMinutes(next: number): void {
  leadMinutes = next;
  for (const listener of listeners) {
    listener(next);
  }
}

/** Subscribes to lead-time changes; returns an unsubscribe function. */
export function subscribeLeadMinutes(listener: LeadListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
