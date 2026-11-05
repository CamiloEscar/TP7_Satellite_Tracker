/**
 * @format
 *
 * Validation runner tests (RF-15, Hito 10): both modes over the real SGP4
 * engine with mocked sources (offline and deterministic). The "example
 * evidence" case replays the WTIA fixtures captured LIVE on 2026-11-04 (the
 * run itself is simulated/fixtures; the live run is separate evidence).
 */
import type {
  OrbitalRecord,
  TlePayload,
  ValidationPosition,
} from '../../data/types';
import { DataError } from '../../data/types';
import wtiaPositionsFixture from '../../data/__tests__/fixtures/wtia-positions.json';
import wtiaTlesFixture from '../../data/__tests__/fixtures/wtia-tles.json';
import {
  OrbitalError,
  createSatrecFromTle,
  getEpoch,
  lookAnglesAt,
  subpointAt,
} from '../../orbital';
import type { ObserverGeodetic, Satrec } from '../../orbital';
import {
  ISS_NORAD_ID,
  runValidation,
  sourcesFromProvider,
} from '../runValidation';
import type { ValidationSources } from '../runValidation';
import type { ValidationReference } from '../table';

// --- Fixtures (embedded; no network) -----------------------------------------

// ISS TLE A - satellite.js README example, epoch 2019-06-05T12:12:57.999883Z.
const ISS_TLE_A: TlePayload = {
  line1:
    '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  line2:
    '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
};

const ISS_RECORD: OrbitalRecord = {
  format: 'tle',
  noradId: ISS_NORAD_ID,
  name: 'ISS (ZARYA)',
  source: 'celestrak-gp',
  epoch: new Date('2019-06-05T12:12:58.000Z'),
  fetchedAt: new Date('2019-06-05T13:00:00.000Z'),
  payload: ISS_TLE_A,
};

const BUENOS_AIRES: ObserverGeodetic = {
  latitudeDeg: -34.6037,
  longitudeDeg: -58.3816,
  altitudeKm: 0.025,
};

const FETCHED_AT = new Date('2026-11-04T21:00:00.000Z');
const SAMPLES = [
  new Date('2026-11-04T21:00:00.000Z'),
  new Date('2026-11-04T21:01:00.000Z'),
  new Date('2026-11-04T21:02:00.000Z'),
];

const issSatrec = createSatrecFromTle(ISS_TLE_A.line1, ISS_TLE_A.line2);

function positionAt(
  satrec: Satrec,
  instant: Date,
  withLook = false,
): ValidationPosition {
  const subpoint = subpointAt(satrec, instant);
  const look = withLook ? lookAnglesAt(satrec, BUENOS_AIRES, instant) : null;
  return {
    noradId: ISS_NORAD_ID,
    timestamp: instant,
    latitudeDeg: subpoint.latitudeDeg,
    longitudeDeg: subpoint.longitudeDeg,
    altitudeKm: subpoint.altitudeKm,
    azimuthDeg: look?.azimuthDeg,
    elevationDeg: look?.elevationDeg,
  };
}

/** Sources whose reference is EXACTLY the local engine (error must be zero). */
function engineConsistentSources(
  options: {
    withLook?: boolean;
    roundToSecond?: boolean;
  } = {},
): ValidationSources {
  return {
    getValidationTle: async () => ISS_TLE_A,
    getReferencePosition: async (_noradId, requested) => {
      const instant = options.roundToSecond
        ? new Date(Math.floor(requested.getTime() / 1000) * 1000)
        : requested;
      return positionAt(issSatrec, instant, options.withLook);
    },
    getOrbitalRecord: async () => ISS_RECORD,
  };
}

function modeAOptions(timestamps: Date[] = SAMPLES) {
  return {
    mode: 'A' as const,
    noradId: ISS_NORAD_ID,
    timestampsUtc: timestamps,
    fetchedAtUtc: FETCHED_AT,
  };
}

async function expectOrbitalError(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(OrbitalError);
  expect((caught as OrbitalError).code).toBe(code);
}

// --- Mode A -------------------------------------------------------------------

describe('runValidation - mode A (implementation-isolated error)', () => {
  it('reports ~0 error when both sides propagate the same TLE (machinery check)', async () => {
    const table = await runValidation(
      engineConsistentSources(),
      modeAOptions(),
    );
    expect(table.mode).toBe('A');
    expect(table.reference).toBe('wtia');
    expect(table.rows).toHaveLength(3);
    for (const row of table.rows) {
      expect(row.errorKm).toBeCloseTo(0, 10);
      expect(row.altitudeDeltaKm).toBeCloseTo(0, 10);
      expect(row.azimuthDeltaDeg).toBeNull();
      expect(row.elevationDeltaDeg).toBeNull();
    }
    expect(table.summary.maxErrorKm).toBeCloseTo(0, 10);
  });

  it('propagates locally at the REFERENCE instant (same-timestamp rule)', async () => {
    // The reference rounds to the second (WTIA echoes epoch seconds); the
    // local propagation must follow the reference instant, not the request.
    const halfSecondLater = SAMPLES.map(
      sample => new Date(sample.getTime() + 500),
    );
    const table = await runValidation(
      engineConsistentSources({ roundToSecond: true }),
      modeAOptions(halfSecondLater),
    );
    for (const row of table.rows) {
      expect(row.errorKm).toBeCloseTo(0, 10);
    }
  });

  it('carries the element-set epoch, fetch instant and age in every row', async () => {
    const table = await runValidation(
      engineConsistentSources(),
      modeAOptions(),
    );
    const expectedEpoch = getEpoch(issSatrec);
    for (const row of table.rows) {
      expect(row.elementEpochUtc).toEqual(expectedEpoch);
      expect(row.elementFetchedAtUtc).toEqual(FETCHED_AT);
      expect(row.elementAgeHours).toBeCloseTo(
        (row.timestampUtc.getTime() - expectedEpoch.getTime()) / 3600000,
        10,
      );
    }
  });

  it('replays the LIVE-captured WTIA fixtures as example evidence (simulado: fixtures)', async () => {
    // Fixture pair captured from the real API on 2026-11-04 (see
    // src/data/__tests__/fixtures): a real TLE + real positions ~1.1 days
    // later. The run is offline; the numbers are real-data regression locks.
    const sources: ValidationSources = {
      getValidationTle: async () => ({
        line1: wtiaTlesFixture.line1,
        line2: wtiaTlesFixture.line2,
      }),
      getReferencePosition: async (_noradId, requested) => {
        const tsSec = Math.floor(requested.getTime() / 1000);
        const row = wtiaPositionsFixture.find(r => r.timestamp === tsSec);
        if (!row) {
          throw new DataError('DATA_NOT_FOUND', 'no fixture row');
        }
        return {
          noradId: ISS_NORAD_ID,
          timestamp: new Date(row.timestamp * 1000),
          latitudeDeg: row.latitude,
          longitudeDeg: row.longitude,
          altitudeKm: row.altitude,
        };
      },
      getOrbitalRecord: async () => ISS_RECORD,
    };
    const timestamps = wtiaPositionsFixture.map(
      row => new Date(row.timestamp * 1000),
    );
    const table = await runValidation(sources, {
      mode: 'A',
      noradId: ISS_NORAD_ID,
      timestampsUtc: timestamps,
      fetchedAtUtc: new Date(wtiaTlesFixture.tle_timestamp * 1000),
    });
    expect(table.rows).toHaveLength(2);
    // Real-data bounds: a ~1.1-day-old ISS set; SGP4-vs-SGP4 with drift is
    // well below 200 km, and never exactly zero (different implementations).
    for (const row of table.rows) {
      expect(row.errorKm).toBeGreaterThan(0);
      expect(row.errorKm).toBeLessThan(200);
      expect(Math.abs(row.altitudeDeltaKm)).toBeLessThan(50);
    }
    expect(table.summary.sampleCount).toBe(2);
  });

  it('rejects non-ISS satellites (WTIA tracks the ISS only)', async () => {
    const sources = engineConsistentSources();
    await expectOrbitalError(
      runValidation(sources, { ...modeAOptions(), noradId: 33591 }),
      'ORBIT_BAD_INPUT',
    );
  });
});

// --- Mode B -------------------------------------------------------------------

describe('runValidation - mode B (total error)', () => {
  const modeBOptions = {
    mode: 'B' as const,
    noradId: ISS_NORAD_ID,
    timestampsUtc: SAMPLES,
    observer: BUENOS_AIRES,
    fetchedAtUtc: FETCHED_AT,
  };

  it('reports ~0 position and look-angle error against the engine itself (machinery check)', async () => {
    const table = await runValidation(
      engineConsistentSources({ withLook: true }),
      modeBOptions,
    );
    expect(table.mode).toBe('B');
    expect(table.reference).toBe('n2yo');
    expect(table.satelliteName).toBe('ISS (ZARYA)');
    for (const row of table.rows) {
      expect(row.errorKm).toBeCloseTo(0, 10);
      expect(row.azimuthDeltaDeg).not.toBeNull();
      expect(row.azimuthDeltaDeg).toBeCloseTo(0, 10);
      expect(row.elevationDeltaDeg).toBeCloseTo(0, 10);
    }
    expect(table.summary.meanAzimuthDeltaDeg).toBeCloseTo(0, 10);
  });

  it('uses the app element set age (record epoch + fetchedAt) in the rows', async () => {
    const table = await runValidation(
      engineConsistentSources({ withLook: true }),
      modeBOptions,
    );
    expect(table.rows[0].elementEpochUtc).toEqual(ISS_RECORD.epoch);
    expect(table.rows[0].elementFetchedAtUtc).toEqual(ISS_RECORD.fetchedAt);
  });

  it('keeps look-angle deltas null when the reference has no az/el', async () => {
    const table = await runValidation(engineConsistentSources(), modeBOptions);
    for (const row of table.rows) {
      expect(row.azimuthDeltaDeg).toBeNull();
      expect(row.elevationDeltaDeg).toBeNull();
    }
    expect(table.summary.meanAzimuthDeltaDeg).toBeNull();
  });

  it('requires an observer (N2YO az/el are observer-based)', async () => {
    await expectOrbitalError(
      runValidation(engineConsistentSources(), {
        ...modeBOptions,
        observer: undefined,
      }),
      'ORBIT_BAD_INPUT',
    );
  });
});

// --- Shared guards + provider adapter ----------------------------------------

describe('runValidation - guards', () => {
  it('rejects an empty sample list', async () => {
    await expectOrbitalError(
      runValidation(engineConsistentSources(), {
        ...modeAOptions(),
        timestampsUtc: [],
      }),
      'ORBIT_BAD_INPUT',
    );
  });

  it('rejects invalid instants', async () => {
    await expectOrbitalError(
      runValidation(engineConsistentSources(), {
        ...modeAOptions(),
        timestampsUtc: [new Date(NaN)],
      }),
      'ORBIT_BAD_INPUT',
    );
  });
});

describe('sourcesFromProvider', () => {
  it('routes the reference request to the selected source without fallback', async () => {
    const getValidationPositionFrom = jest.fn(
      async (
        _source: ValidationReference,
        _noradId: number,
        timestamp: Date,
      ): Promise<ValidationPosition> => positionAt(issSatrec, timestamp),
    );
    const getValidationTle = jest.fn(async () => ISS_TLE_A);
    const sources = sourcesFromProvider(
      {
        getOrbitalData: async () => ISS_RECORD,
        getValidationTle,
        getValidationPositionFrom,
      },
      'n2yo',
    );
    await sources.getReferencePosition(ISS_NORAD_ID, SAMPLES[0]);
    expect(getValidationPositionFrom).toHaveBeenCalledWith(
      'n2yo',
      ISS_NORAD_ID,
      SAMPLES[0],
    );
    await sources.getValidationTle();
    expect(getValidationTle).toHaveBeenCalled();
  });

  it('surfaces a missing optional method as a typed DataError', async () => {
    const sources = sourcesFromProvider(
      { getOrbitalData: async () => ISS_RECORD },
      'wtia',
    );
    let caught: unknown;
    try {
      await sources.getValidationTle();
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(DataError);
    expect((caught as DataError).code).toBe('DATA_NOT_FOUND');
  });
});
