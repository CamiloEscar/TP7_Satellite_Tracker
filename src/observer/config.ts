/**
 * In-memory observer/compass configuration store, same get/set/subscribe
 * seam as `src/selection.ts`.
 */
// ponytail: in-memory only - there is no `app_settings` table yet in
// `src/db/schema.ts`. Upgrade path: persist in the settings k/v table when
// the settings work lands (Hito 8+).

/** Default magnetic declination: -10 deg (Buenos Aires), positive east. */
export const DEFAULT_DECLINATION_DEG = -10;

type DeclinationListener = (declinationDeg: number) => void;

let declinationDeg: number = DEFAULT_DECLINATION_DEG;
const listeners = new Set<DeclinationListener>();

export function getDeclinationDeg(): number {
  return declinationDeg;
}

export function setDeclinationDeg(next: number): void {
  declinationDeg = next;
  for (const listener of listeners) {
    listener(next);
  }
}

/** Subscribes to declination changes; returns an unsubscribe function. */
export function subscribeDeclinationDeg(
  listener: DeclinationListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
