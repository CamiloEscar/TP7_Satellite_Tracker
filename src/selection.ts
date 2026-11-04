/**
 * Minimal selected-satellite store: get/set/subscribe over a module-level
 * value. `CatalogDetailScreen` writes it, `MapScreen` reads it via
 * `useSyncExternalStore`. Defaults to the ISS (25544).
 */
// ponytail: module-level singleton — state resets on reload and holds a single
// selection. Upgrade to React context or a real store if multi-selection lands
// (Hito 9 constellation layer).

export const DEFAULT_SATELLITE_NORAD_ID = 25544;

type SelectionListener = (noradId: number) => void;

let selectedNoradId: number = DEFAULT_SATELLITE_NORAD_ID;
const listeners = new Set<SelectionListener>();

export function getSelectedNoradId(): number {
  return selectedNoradId;
}

export function setSelectedNoradId(noradId: number): void {
  if (noradId === selectedNoradId) {
    return;
  }
  selectedNoradId = noradId;
  for (const listener of listeners) {
    listener(noradId);
  }
}

/** Subscribes to selection changes; returns an unsubscribe function. */
export function subscribeSelectedNoradId(
  listener: SelectionListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
