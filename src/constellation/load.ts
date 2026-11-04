import type { CatalogGroupFilter } from '../data/catalogQuery';
import type { DataProvider, OrbitalRecord } from '../data/types';
import { buildConstellation } from './propagate';
import type { ConstellationObject } from './propagate';
import { selectConstellationSubset } from './subset';

/** Data-layer slice the constellation loader needs (the existing fetch path). */
export type ConstellationDataSource = Pick<
  DataProvider,
  'getCatalog' | 'getOrbitalData'
>;

/**
 * Loads the constellation subset through the existing data layer (catalog +
 * per-satellite element sets with cache/TTL/fallback - no new fetch path) and
 * builds its element sets. A record that fails to load is skipped, like a
 * malformed one in `buildConstellation`.
 */
export async function loadConstellation(
  source: ConstellationDataSource,
  limit: number,
  group: CatalogGroupFilter,
): Promise<ConstellationObject[]> {
  const entries = await source.getCatalog();
  const subset = selectConstellationSubset(entries, limit, group);
  const records = await Promise.all(
    subset.map(entry => source.getOrbitalData(entry.noradId).catch(() => null)),
  );
  return buildConstellation(
    records.filter((record): record is OrbitalRecord => record !== null),
  );
}
