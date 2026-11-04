import type { ObserverGeodetic } from '../orbital/types';

/**
 * Observer layer: observer-location store plus the pure modules for GPS /
 * manual location, compass math and heading sources. `PassesScreen`,
 * `MapScreen` and `SettingsScreen` write/read the store here; the pure
 * modules are re-exported as the layer's public surface.
 */
// ponytail: module-level singleton defaulting to Buenos Aires. GPS + manual
// location (SettingsScreen) are the writers; replace with a real store if
// this ever needs persistence or multi-observer support.

export * from './compass';
export * from './config';
export * from './heading';
export * from './location';

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
