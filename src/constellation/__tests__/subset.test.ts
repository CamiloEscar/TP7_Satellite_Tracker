import type { CatalogEntry } from '../../data/types';
import { OrbitalError } from '../../orbital';
import { selectConstellationSubset } from '../index';

function entry(noradId: number, group: CatalogEntry['group']): CatalogEntry {
  return { noradId, name: `SAT-${noradId}`, group };
}

const CATALOG: CatalogEntry[] = [
  entry(48276, 'starlink'),
  entry(25544, 'iss'),
  entry(48274, 'starlink'),
  entry(33591, 'weather'),
  entry(48275, 'starlink'),
  entry(39128, 'gps-ops'),
];

describe('selectConstellationSubset', () => {
  it('takes the first `limit` entries ordered by NORAD ID ascending', () => {
    const subset = selectConstellationSubset(CATALOG, 2, 'all');
    expect(subset.map(e => e.noradId)).toEqual([25544, 33591]);
  });

  it('is deterministic regardless of catalog order', () => {
    const reversed = [...CATALOG].reverse();
    expect(selectConstellationSubset(reversed, 3, 'all')).toEqual(
      selectConstellationSubset(CATALOG, 3, 'all'),
    );
    expect(
      selectConstellationSubset(reversed, 3, 'all').map(e => e.noradId),
    ).toEqual([25544, 33591, 39128]);
  });

  it('filters by group (Starlink subset semantics)', () => {
    const subset = selectConstellationSubset(CATALOG, 50, 'starlink');
    expect(subset.map(e => e.noradId)).toEqual([48274, 48275, 48276]);
  });

  it('includes every group when the filter is "all"', () => {
    expect(selectConstellationSubset(CATALOG, 50, 'all')).toHaveLength(6);
  });

  it('returns fewer entries than the limit when the group is smaller', () => {
    const subset = selectConstellationSubset(CATALOG, 100, 'gps-ops');
    expect(subset.map(e => e.noradId)).toEqual([39128]);
  });

  it('returns an empty subset for an empty catalog', () => {
    expect(selectConstellationSubset([], 50, 'starlink')).toEqual([]);
  });

  it('accepts the inclusive limit bounds', () => {
    expect(selectConstellationSubset(CATALOG, 1, 'all')).toHaveLength(1);
    expect(selectConstellationSubset(CATALOG, 100, 'all')).toHaveLength(6);
  });

  it.each([0, 101, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects limit %p with ORBIT_BAD_INPUT',
    limit => {
      let caught: unknown;
      try {
        selectConstellationSubset(CATALOG, limit, 'all');
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(OrbitalError);
      expect((caught as OrbitalError).code).toBe('ORBIT_BAD_INPUT');
    },
  );
});
