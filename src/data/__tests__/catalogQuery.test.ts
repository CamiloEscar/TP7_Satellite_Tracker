import {
  DATA_TTL_MS,
  filterCatalog,
  formatDataAge,
  isDataOverTtl,
} from '../catalogQuery';
import type { CatalogEntry } from '../types';

const HOUR_MS = 3600000;

const ENTRIES: CatalogEntry[] = [
  { noradId: 25544, name: 'ISS (ZARYA)', group: 'iss' },
  { noradId: 48274, name: 'STARLINK-30000', group: 'starlink' },
  { noradId: 43013, name: 'STARLINK-1007', group: 'starlink' },
  { noradId: 32711, name: 'NOAA 19', group: 'weather' },
  { noradId: 39128, name: 'GPS BIIF-8 (PRN 07)', group: 'gps-ops' },
  { noradId: 25338, name: 'NOAA 15', group: 'weather' },
  { noradId: 900001, name: 'FUTURE SAT', group: 'other' },
];

const SORTED_NAMES = [
  'FUTURE SAT',
  'GPS BIIF-8 (PRN 07)',
  'ISS (ZARYA)',
  'NOAA 15',
  'NOAA 19',
  'STARLINK-1007',
  'STARLINK-30000',
];

describe('filterCatalog', () => {
  it('returns all entries for an empty query', () => {
    const result = filterCatalog(ENTRIES, '', 'all');
    expect(result.map(e => e.name)).toEqual(SORTED_NAMES);
  });

  it('matches name substrings case-insensitively', () => {
    const result = filterCatalog(ENTRIES, 'starlink', 'all');
    expect(result.map(e => e.name)).toEqual([
      'STARLINK-1007',
      'STARLINK-30000',
    ]);

    const iss = filterCatalog(ENTRIES, 'iss (', 'all');
    expect(iss.map(e => e.name)).toEqual(['ISS (ZARYA)']);
  });

  it('matches NORAD ID on exact value', () => {
    const result = filterCatalog(ENTRIES, '25544', 'all');
    expect(result.map(e => e.noradId)).toEqual([25544]);
  });

  it('matches NORAD ID on digit prefix', () => {
    const result = filterCatalog(ENTRIES, '25', 'all');
    expect(result.map(e => e.noradId).sort((a, b) => a - b)).toEqual([
      25338, 25544,
    ]);
  });

  it('combines the search query with the group filter', () => {
    const result = filterCatalog(ENTRIES, 'noaa', 'weather');
    expect(result.map(e => e.name)).toEqual(['NOAA 15', 'NOAA 19']);

    const wrongGroup = filterCatalog(ENTRIES, 'noaa', 'starlink');
    expect(wrongGroup).toEqual([]);
  });

  it('returns results sorted by name with NORAD ID tiebreaker', () => {
    const tie: CatalogEntry[] = [
      { noradId: 2, name: 'SAME NAME', group: 'other' },
      { noradId: 1, name: 'SAME NAME', group: 'other' },
    ];
    const shuffled = [...ENTRIES].reverse();
    const result = filterCatalog([...tie, ...shuffled], '', 'all');
    const sameNameIds = result
      .filter(e => e.name === 'SAME NAME')
      .map(e => e.noradId);
    expect(sameNameIds).toEqual([1, 2]);
    expect(result.map(e => e.name)).toEqual([
      'FUTURE SAT',
      'GPS BIIF-8 (PRN 07)',
      'ISS (ZARYA)',
      'NOAA 15',
      'NOAA 19',
      'SAME NAME',
      'SAME NAME',
      'STARLINK-1007',
      'STARLINK-30000',
    ]);
  });
});

describe('formatDataAge', () => {
  it('formats ages below one hour in minutes', () => {
    expect(formatDataAge(0)).toBe('hace 0 min');
    expect(formatDataAge(59 * 60000)).toBe('hace 59 min');
  });

  it('formats ages below one day in hours', () => {
    expect(formatDataAge(60 * 60000)).toBe('hace 1 h');
    expect(formatDataAge(3 * HOUR_MS)).toBe('hace 3 h');
    expect(formatDataAge(23 * HOUR_MS + 59 * 60000)).toBe('hace 23 h');
  });

  it('formats ages of one day or more in days', () => {
    expect(formatDataAge(24 * HOUR_MS)).toBe('hace 1 d');
    expect(formatDataAge(50 * HOUR_MS)).toBe('hace 2 d');
  });
});

describe('isDataOverTtl', () => {
  it('uses the default cache TTL as threshold', () => {
    expect(DATA_TTL_MS).toBe(24 * HOUR_MS);
    expect(isDataOverTtl(DATA_TTL_MS - 1)).toBe(false);
    expect(isDataOverTtl(DATA_TTL_MS)).toBe(true);
    expect(isDataOverTtl(25 * HOUR_MS)).toBe(true);
    expect(isDataOverTtl(3 * HOUR_MS)).toBe(false);
  });

  it('accepts a custom TTL threshold', () => {
    expect(isDataOverTtl(2 * HOUR_MS, HOUR_MS)).toBe(true);
    expect(isDataOverTtl(30 * 60000, HOUR_MS)).toBe(false);
  });
});
