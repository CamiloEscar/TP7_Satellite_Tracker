import { DEFAULT_TTL_HOURS } from './cache';
import type { CatalogEntry, CatalogGroup } from './types';

/** Group filter for the catalog chips (RF-08): a group or "all". */
export type CatalogGroupFilter = CatalogGroup | 'all';

/** Default cache TTL as milliseconds (RF-16 alert threshold). */
export const DATA_TTL_MS = DEFAULT_TTL_HOURS * 3600000;

/**
 * Pure catalog query (RF-01 + RF-08): filters by search query and group and
 * returns results sorted deterministically (name ascending, NORAD ID as
 * tiebreaker). Matching: case-insensitive substring on names; digits-only
 * queries also match NORAD ID on exact or prefix digits; an empty query
 * matches everything.
 */
export function filterCatalog(
  entries: readonly CatalogEntry[],
  query: string,
  group: CatalogGroupFilter,
): CatalogEntry[] {
  const q = query.trim().toLowerCase();
  const digitsOnly = q.length > 0 && /^\d+$/.test(q);
  return entries
    .filter(entry => {
      if (group !== 'all' && entry.group !== group) {
        return false;
      }
      if (q.length === 0) {
        return true;
      }
      return (
        entry.name.toLowerCase().includes(q) ||
        (digitsOnly && String(entry.noradId).startsWith(q))
      );
    })
    .sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : a.noradId - b.noradId,
    );
}

/**
 * Formats a data age for display (RF-16), e.g. "hace 3 h". Granularity:
 * minutes below 1 h, hours below 24 h, days otherwise.
 */
export function formatDataAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60000);
  if (minutes < 60) {
    return `hace ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `hace ${hours} h`;
  }
  return `hace ${Math.floor(hours / 24)} d`;
}

/**
 * True when `ageMs` reached the cache TTL (RF-16 alert). Uses the same
 * boundary as `CacheService` freshness (`age < ttl` is fresh).
 */
export function isDataOverTtl(
  ageMs: number,
  ttlMs: number = DATA_TTL_MS,
): boolean {
  return ageMs >= ttlMs;
}
