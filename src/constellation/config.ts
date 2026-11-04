import type { CatalogGroupFilter } from '../data/catalogQuery';

/**
 * In-memory constellation configuration store, same get/set/subscribe seam
 * as `src/observer/config.ts` and `src/notifications/config.ts`.
 */
// ponytail: in-memory only - there is no `app_settings` table yet in
// `src/db/schema.ts` (ARCHITECTURE.md §3 plans it). Upgrade path: persist
// in the settings k/v table when the settings work lands.

/** Default constellation limit: 50 objects (RF-13). */
export const DEFAULT_CONSTELLATION_LIMIT = 50;
/** Inclusive bounds for the object limit. */
export const MIN_CONSTELLATION_LIMIT = 1;
export const MAX_CONSTELLATION_LIMIT = 100;
/** Default group subset: Starlink (RF-13). */
export const DEFAULT_CONSTELLATION_GROUP: CatalogGroupFilter = 'starlink';

/** Group chips for the constellation setting (catalog group semantics). */
// UI copy in Spanish, matching the existing catalog/settings chips.
export const CONSTELLATION_GROUP_CHIPS: readonly {
  key: CatalogGroupFilter;
  label: string;
}[] = [
  { key: 'starlink', label: 'Starlink' },
  { key: 'iss', label: 'ISS' },
  { key: 'gps-ops', label: 'GPS operacional' },
  { key: 'weather', label: 'Meteorológicos' },
  { key: 'other', label: 'Otros' },
  { key: 'all', label: 'Todos' },
];

type LimitListener = (limit: number) => void;
type GroupListener = (group: CatalogGroupFilter) => void;

let constellationLimit: number = DEFAULT_CONSTELLATION_LIMIT;
const limitListeners = new Set<LimitListener>();

export function getConstellationLimit(): number {
  return constellationLimit;
}

export function setConstellationLimit(next: number): void {
  constellationLimit = next;
  for (const listener of limitListeners) {
    listener(next);
  }
}

/** Subscribes to limit changes; returns an unsubscribe function. */
export function subscribeConstellationLimit(
  listener: LimitListener,
): () => void {
  limitListeners.add(listener);
  return () => {
    limitListeners.delete(listener);
  };
}

let constellationGroup: CatalogGroupFilter = DEFAULT_CONSTELLATION_GROUP;
const groupListeners = new Set<GroupListener>();

export function getConstellationGroup(): CatalogGroupFilter {
  return constellationGroup;
}

export function setConstellationGroup(next: CatalogGroupFilter): void {
  constellationGroup = next;
  for (const listener of groupListeners) {
    listener(next);
  }
}

/** Subscribes to group changes; returns an unsubscribe function. */
export function subscribeConstellationGroup(
  listener: GroupListener,
): () => void {
  groupListeners.add(listener);
  return () => {
    groupListeners.delete(listener);
  };
}

/**
 * Pure settings parsing for the limit input: an integer within
 * [MIN_CONSTELLATION_LIMIT, MAX_CONSTELLATION_LIMIT], otherwise null.
 * Mirrors the inline validation style of the SettingsScreen inputs.
 */
export function parseConstellationLimit(text: string): number | null {
  const trimmed = text.trim();
  const value = Number(trimmed);
  if (
    trimmed === '' ||
    !Number.isInteger(value) ||
    value < MIN_CONSTELLATION_LIMIT ||
    value > MAX_CONSTELLATION_LIMIT
  ) {
    return null;
  }
  return value;
}
