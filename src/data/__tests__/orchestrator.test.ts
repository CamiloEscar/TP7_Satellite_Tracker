import { CacheService } from '../cache';
import { MemoryCacheStore } from '../memoryStore';
import { DataOrchestrator } from '../orchestrator';
import type {
  CatalogEntry,
  Clock,
  DataErrorCode,
  DataProvider,
  OrbitalRecord,
  ValidationPosition,
} from '../types';
import { DataError } from '../types';
import type { OmmJson } from '../../orbital/types';

// --- Helpers --------------------------------------------------------------------

const NOW = Date.UTC(2026, 10, 3, 12, 0, 0);
const HOUR_MS = 3600000;

const clock: Clock = { now: () => NOW };

function makeEntry(noradId: number): CatalogEntry {
  return { noradId, name: `SAT-${noradId}`, group: 'other' };
}

function makeRecord(noradId: number): OrbitalRecord {
  return {
    format: 'omm',
    noradId,
    name: `SAT-${noradId}`,
    source: 'celestrak-gp',
    payload: {} as OmmJson,
    epoch: new Date(NOW - 2 * HOUR_MS),
    fetchedAt: new Date(NOW),
  };
}

function makePosition(noradId: number): ValidationPosition {
  return {
    noradId,
    timestamp: new Date(NOW),
    latitudeDeg: -34.6,
    longitudeDeg: -58.4,
    altitudeKm: 420,
  };
}

type CatalogSource = Pick<DataProvider, 'getCatalog' | 'getOrbitalData'>;
type PositionSource = Pick<DataProvider, 'getValidationPosition'>;

function failingCatalog(message: string): CatalogSource {
  return {
    getCatalog: jest.fn(async () => {
      throw new DataError('DATA_NETWORK', message);
    }),
    getOrbitalData: jest.fn(async () => {
      throw new DataError('DATA_NETWORK', message);
    }),
  };
}

function staticCatalog(
  entries: CatalogEntry[],
  record: OrbitalRecord,
): CatalogSource {
  return {
    getCatalog: jest.fn(async () => entries),
    getOrbitalData: jest.fn(async () => record),
  };
}

function staticPositions(position: ValidationPosition): PositionSource {
  return {
    getValidationPosition: jest.fn(async () => position),
  };
}

function failingPositions(message: string): PositionSource {
  return {
    getValidationPosition: jest.fn(async () => {
      throw new DataError('DATA_NETWORK', message);
    }),
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

// --- Catalog / orbital fallback ---------------------------------------------------

describe('DataOrchestrator catalog fallback', () => {
  it('falls back to Space-Track when CelesTrak fails (catalog)', async () => {
    const primary = failingCatalog('celestrak down');
    const fallback = staticCatalog([makeEntry(25544)], makeRecord(25544));
    const cache = new CacheService(new MemoryCacheStore(), { clock });
    const orchestrator = new DataOrchestrator({
      catalogPrimary: primary,
      catalogFallback: fallback,
      positionPrimary: staticPositions(makePosition(25544)),
      positionFallback: staticPositions(makePosition(25544)),
      cache,
    });

    await expect(orchestrator.getCatalog()).resolves.toEqual([
      makeEntry(25544),
    ]);
    expect(primary.getCatalog).toHaveBeenCalledTimes(1);
    expect(fallback.getCatalog).toHaveBeenCalledTimes(1);
  });

  it('falls back to Space-Track when CelesTrak fails (orbital data)', async () => {
    const primary = failingCatalog('celestrak down');
    const fallback = staticCatalog([], makeRecord(25544));
    const cache = new CacheService(new MemoryCacheStore(), { clock });
    const orchestrator = new DataOrchestrator({
      catalogPrimary: primary,
      catalogFallback: fallback,
      positionPrimary: staticPositions(makePosition(25544)),
      positionFallback: staticPositions(makePosition(25544)),
      cache,
    });

    const record = await orchestrator.getOrbitalData(25544);
    expect(record.noradId).toBe(25544);
    expect(fallback.getOrbitalData).toHaveBeenCalledTimes(1);
  });

  it('throws DATA_ALL_PROVIDERS_FAILED when both catalog providers fail', async () => {
    const cache = new CacheService(new MemoryCacheStore(), { clock });
    const orchestrator = new DataOrchestrator({
      catalogPrimary: failingCatalog('primary down'),
      catalogFallback: failingCatalog('fallback down'),
      positionPrimary: staticPositions(makePosition(25544)),
      positionFallback: staticPositions(makePosition(25544)),
      cache,
    });
    await expectDataError(
      orchestrator.getCatalog(),
      'DATA_ALL_PROVIDERS_FAILED',
    );
    await expectDataError(
      orchestrator.getOrbitalData(25544),
      'DATA_ALL_PROVIDERS_FAILED',
    );
  });

  it('serves stale cache data when both providers fail', async () => {
    const store = new MemoryCacheStore();
    await store.setCatalogSnapshot({
      entries: [makeEntry(25544)],
      fetchedAt: new Date(NOW - 25 * HOUR_MS),
    });
    const cache = new CacheService(store, { clock });
    const orchestrator = new DataOrchestrator({
      catalogPrimary: failingCatalog('primary down'),
      catalogFallback: failingCatalog('fallback down'),
      positionPrimary: staticPositions(makePosition(25544)),
      positionFallback: staticPositions(makePosition(25544)),
      cache,
    });

    const meta = await orchestrator.getCatalogWithMeta();
    expect(meta.value).toEqual([makeEntry(25544)]);
    expect(meta.stale).toBe(true);
    expect(meta.ageMs).toBe(25 * HOUR_MS);
  });
});

// --- Position fallback -------------------------------------------------------------

describe('DataOrchestrator validation position fallback', () => {
  it('falls back to N2YO when WTIA fails', async () => {
    const primary = failingPositions('wtia down');
    const fallback = staticPositions(makePosition(25544));
    const cache = new CacheService(new MemoryCacheStore(), { clock });
    const orchestrator = new DataOrchestrator({
      catalogPrimary: staticCatalog([], makeRecord(25544)),
      catalogFallback: staticCatalog([], makeRecord(25544)),
      positionPrimary: primary,
      positionFallback: fallback,
      cache,
    });

    const pos = await orchestrator.getValidationPosition(25544, new Date(NOW));
    expect(pos.noradId).toBe(25544);
    expect(primary.getValidationPosition).toHaveBeenCalledTimes(1);
    expect(fallback.getValidationPosition).toHaveBeenCalledTimes(1);
  });

  it('throws DATA_ALL_PROVIDERS_FAILED when both position providers fail', async () => {
    const cache = new CacheService(new MemoryCacheStore(), { clock });
    const orchestrator = new DataOrchestrator({
      catalogPrimary: staticCatalog([], makeRecord(25544)),
      catalogFallback: staticCatalog([], makeRecord(25544)),
      positionPrimary: failingPositions('primary down'),
      positionFallback: failingPositions('fallback down'),
      cache,
    });
    await expectDataError(
      orchestrator.getValidationPosition(25544, new Date(NOW)),
      'DATA_ALL_PROVIDERS_FAILED',
    );
  });
});
