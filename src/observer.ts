import type { ObserverGeodetic } from './orbital/types';

/**
 * Minimal observer-location store: get/set/subscribe over a module-level
 * value, the same seam as `src/selection.ts`. `PassesScreen` reads it;
 * `bootstrap.ts` keeps its own copy for the N2YO provider until Hito 7.
 */
// ponytail: module-level singleton defaulting to Buenos Aires. Hito 7 (GPS +
// manual location) becomes the writer; replace with the real observer layer
// if this store ever needs persistence or multi-observer support.

/** Default observer: Buenos Aires (25 m above sea level). */
export const DEFAULT_OBSERVER: ObserverGeodetic = {
  latitudeDeg: -34.6037,
  longitudeDeg: -58.3816,
  altitudeKm: 0.025,
};

type ObserverListener = (observer: ObserverGeodetic) => void;

let observer: ObserverGeodetic = DEFAULT_OBSERVER;
const listeners = new Set<ObserverListener>();

export function getObserver(): ObserverGeodetic {
  return observer;
}

export function setObserver(next: ObserverGeodetic): void {
  observer = next;
  for (const listener of listeners) {
    listener(next);
  }
}

/** Subscribes to observer changes; returns an unsubscribe function. */
export function subscribeObserver(listener: ObserverListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
