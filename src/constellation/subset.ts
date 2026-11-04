import type { CatalogGroupFilter } from '../data/catalogQuery';
import type { CatalogEntry } from '../data/types';
import { OrbitalError } from '../orbital';
import { MAX_CONSTELLATION_LIMIT, MIN_CONSTELLATION_LIMIT } from './config';

/**
 * Deterministic constellation subset (RF-13): filters the catalog by group
 * and returns the first `limit` entries ordered by NORAD ID ascending, so
 * the subset is stable regardless of catalog order or iteration history.
 *
 * Throws `OrbitalError` (`ORBIT_BAD_INPUT`) for `limit` outside the integer
 * range [MIN_CONSTELLATION_LIMIT, MAX_CONSTELLATION_LIMIT], mirroring the
 * `planNotifications` bounds style.
 */
export function selectConstellationSubset(
  entries: readonly CatalogEntry[],
  limit: number,
  group: CatalogGroupFilter,
): CatalogEntry[] {
  if (
    !Number.isInteger(limit) ||
    limit < MIN_CONSTELLATION_LIMIT ||
    limit > MAX_CONSTELLATION_LIMIT
  ) {
    throw new OrbitalError(
      'ORBIT_BAD_INPUT',
      `limit must be an integer in [${MIN_CONSTELLATION_LIMIT}, ${MAX_CONSTELLATION_LIMIT}].`,
    );
  }
  return entries
    .filter(entry => group === 'all' || entry.group === group)
    .sort((a, b) => a.noradId - b.noradId)
    .slice(0, limit);
}
