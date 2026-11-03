import type { OmmJson } from '../../orbital/types';
import { CacheService } from '../cache';
import { MemoryCacheStore } from '../memoryStore';
import type {
  CatalogEntry,
  Clock,
  DataErrorCode,
  OrbitalRecord,
} from '../types';
import { DataError } from '../types';

// --- Helpers --------------------------------------------------------------------

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const HOUR_MS = 3600000;

function makeClock(startMs: number): {
  clock: Clock;
  advance(ms: number): void;
} {
  let now = startMs;
  return {
    clock: { now: () => now },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function makeEntry(noradId: number): CatalogEntry {
  return { noradId, name: `SAT-${noradId}`, group: 'other' };
}

function makeRecord(
  noradId: number,
  fetchedAt: Date,
  epoch: Date,
): OrbitalRecord {
  return {
    format: 'omm',
    noradId,
    name: `SAT-${noradId}`,
    source: 'celestrak-gp',
    payload: {} as OmmJson,
    epoch,
    fetchedAt,
  };
}

async function expectDataError(
  promise: Promise<unknown>,
  code: DataErrorCode,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(DataError);
  expect((caught as DataError).code).toBe(code);
}

// --- Catalog TTL ---------------------------------------------------------------

describe('CacheService catalog TTL', () => {
  it('serves a fresh cache hit without calling the provider', async () => {
    const store = new MemoryCacheStore();
    await store.setCatalogSnapshot({
      entries: [makeEntry(25544)],
      fetchedAt: new Date(NOW - HOUR_MS),
    });
    const { clock } = makeClock(NOW);
    const cache = new CacheService(store, { clock });
    const fetchCatalog = jest.fn(async () => [makeEntry(1)]);

    const hit = await cache.getCatalog(fetchCatalog);

    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(hit.value).toEqual([makeEntry(25544)]);
    expect(hit.stale).toBe(false);
    expect(hit.epoch).toBeNull();
    expect(hit.fetchedAt.getTime()).toBe(NOW - HOUR_MS);
    expect(hit.ageMs).toBe(HOUR_MS);
  });

  it('refetches and stores when the TTL expired', async () => {
    const store = new MemoryCacheStore();
    await store.setCatalogSnapshot({
      entries: [makeEntry(25544)],
      fetchedAt: new Date(NOW - 25 * HOUR_MS),
    });
    const { clock } = makeClock(NOW);
    const cache = new CacheService(store, { clock });
    const fetchCatalog = jest.fn(async () => [makeEntry(43873)]);

    const hit = await cache.getCatalog(fetchCatalog);

    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    expect(hit.value).toEqual([makeEntry(43873)]);
    expect(hit.stale).toBe(false);
    expect(hit.ageMs).toBe(0);
    const stored = await store.getCatalogSnapshot();
    expect(stored?.entries).toEqual([makeEntry(43873)]);
    expect(stored?.fetchedAt.getTime()).toBe(NOW);
  });

  it('serves the stale entry flagged with its age when the provider fails', async () => {
    const store = new MemoryCacheStore();
    await store.setCatalogSnapshot({
      entries: [makeEntry(25544)],
      fetchedAt: new Date(NOW - 25 * HOUR_MS),
    });
    const { clock } = makeClock(NOW);
    const cache = new CacheService(store, { clock });
    const fetchCatalog = jest.fn(async () => {
      throw new DataError('DATA_NETWORK', 'offline');
    });

    const hit = await cache.getCatalog(fetchCatalog);

    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    expect(hit.value).toEqual([makeEntry(25544)]);
    expect(hit.stale).toBe(true);
    expect(hit.fetchedAt.getTime()).toBe(NOW - 25 * HOUR_MS);
    expect(hit.ageMs).toBe(25 * HOUR_MS);
  });

  it('rethrows provider errors when nothing is cached', async () => {
    const store = new MemoryCacheStore();
    const cache = new CacheService(store, { clock: makeClock(NOW).clock });
    const fetchCatalog = jest.fn(async () => {
      throw new DataError('DATA_ALL_PROVIDERS_FAILED', 'all down');
    });
    await expectDataError(
      cache.getCatalog(fetchCatalog),
      'DATA_ALL_PROVIDERS_FAILED',
    );
  });
});

// --- Orbital record TTL -----------------------------------------------------------

describe('CacheService orbital record TTL', () => {
  const epoch = new Date(Date.UTC(2026, 9, 30, 12, 0, 0));

  it('skips the fetch for a fresh record and exposes epoch/fetchedAt', async () => {
    const store = new MemoryCacheStore();
    await store.setOrbitalRecord(
      makeRecord(25544, new Date(NOW - HOUR_MS), epoch),
    );
    const cache = new CacheService(store, { clock: makeClock(NOW).clock });
    const fetchRecord = jest.fn(async () =>
      makeRecord(1, new Date(NOW), epoch),
    );

    const hit = await cache.getOrbitalRecord(25544, fetchRecord);

    expect(fetchRecord).not.toHaveBeenCalled();
    expect(hit.value.noradId).toBe(25544);
    expect(hit.epoch?.getTime()).toBe(epoch.getTime());
    expect(hit.fetchedAt.getTime()).toBe(NOW - HOUR_MS);
    expect(hit.stale).toBe(false);
  });

  it('serves a stale record with its age when the refetch fails', async () => {
    const store = new MemoryCacheStore();
    await store.setOrbitalRecord(
      makeRecord(25544, new Date(NOW - 25 * HOUR_MS), epoch),
    );
    const cache = new CacheService(store, { clock: makeClock(NOW).clock });
    const fetchRecord = jest.fn(async () => {
      throw new DataError('DATA_NETWORK', 'offline');
    });

    const hit = await cache.getOrbitalRecord(25544, fetchRecord);

    expect(fetchRecord).toHaveBeenCalledTimes(1);
    expect(hit.stale).toBe(true);
    expect(hit.epoch?.getTime()).toBe(epoch.getTime());
    expect(hit.ageMs).toBe(25 * HOUR_MS);
  });

  it('stores fetched records carrying their own fetchedAt', async () => {
    const store = new MemoryCacheStore();
    const cache = new CacheService(store, { clock: makeClock(NOW).clock });
    const record = makeRecord(43873, new Date(NOW - 5 * HOUR_MS), epoch);
    const fetchRecord = jest.fn(async () => record);

    const hit = await cache.getOrbitalRecord(43873, fetchRecord);

    expect(hit.fetchedAt.getTime()).toBe(NOW - 5 * HOUR_MS);
    expect(hit.ageMs).toBe(5 * HOUR_MS);
    expect(await store.getOrbitalRecord(43873)).toEqual(record);
  });
});

// --- Configuration -----------------------------------------------------------------

describe('CacheService TTL configuration', () => {
  it('accepts the 12-24 h range and rejects values outside it', () => {
    const store = new MemoryCacheStore();
    expect(() => new CacheService(store, { ttlHours: 12 })).not.toThrow();
    expect(() => new CacheService(store, { ttlHours: 24 })).not.toThrow();
    expect(() => new CacheService(store, { ttlHours: 11 })).toThrow(RangeError);
    expect(() => new CacheService(store, { ttlHours: 25 })).toThrow(RangeError);
  });
});
