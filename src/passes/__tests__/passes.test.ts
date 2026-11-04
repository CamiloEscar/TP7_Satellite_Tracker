/**
 * @format
 *
 * Algorithm tests for the pass prediction service (ARCHITECTURE.md §5:
 * known ISS pass; GEO seen/not-seen by observer latitude; threshold 0° vs
 * 10°; satellite that never rises). Values are regression-locked from the
 * SGP4 engine with the same tolerance style as
 * `src/orbital/__tests__/engine.test.ts`.
 */
import {
  OrbitalError,
  createSatrecFromOmm,
  createSatrecFromTle,
  lookAnglesAt,
} from '../../orbital';
import type { OmmJson, OrbitalErrorCode } from '../../orbital';
import { findUpcomingPasses, samplePassTrajectory } from '../passes';
import type { PassSummary } from '../passes';

// --- Fixtures (embedded; no network) -----------------------------------------

// ISS TLE A - satellite.js README example, epoch 2019-06-05T12:12:57.999883Z.
const ISS_TLE_A_LINE1 =
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992';
const ISS_TLE_A_LINE2 =
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442';

// Geostationary object at lon ~-60: sidereal mean motion, near-equatorial.
// The mean anomaly places the sub-point at ~-60.01° at the epoch (locked).
const GEO_OMM: OmmJson = {
  OBJECT_NAME: 'GEO TEST SAT',
  OBJECT_ID: '2019-001A',
  EPOCH: '2019-06-05T12:13:00.000Z',
  MEAN_MOTION: 1.00273791,
  ECCENTRICITY: 0.0001,
  INCLINATION: 0.02,
  RA_OF_ASC_NODE: 0,
  ARG_OF_PERICENTER: 0,
  MEAN_ANOMALY: 16.8876,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 90000,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 0,
  BSTAR: 0,
  MEAN_MOTION_DOT: 0,
  MEAN_MOTION_DDOT: 0,
};

/** Buenos Aires, the app default observer. */
const BUENOS_AIRES = {
  latitudeDeg: -34.6037,
  longitudeDeg: -58.3816,
  altitudeKm: 0.025,
};
/** Same longitude as the GEO, mid-latitude in its hemisphere. */
const GEO_MID_LAT = { latitudeDeg: -35, longitudeDeg: -60, altitudeKm: 0 };
/** Same longitude as the GEO, opposite hemisphere (elevation ~11.5°). */
const GEO_OPPOSITE_LAT = { latitudeDeg: 70, longitudeDeg: -60, altitudeKm: 0 };
/** Same longitude as the GEO, polar (elevation ~-3.6°). */
const GEO_POLAR = { latitudeDeg: 85, longitudeDeg: -60, altitudeKm: 0 };

const FROM_UTC = new Date('2019-06-05T12:13:00.000Z');
const WINDOW_48H_S = 48 * 60 * 60;

const issSatrec = createSatrecFromTle(ISS_TLE_A_LINE1, ISS_TLE_A_LINE2);
const geoSatrec = createSatrecFromOmm(GEO_OMM);

// --- Helpers -----------------------------------------------------------------

function expectOrbitalError(fn: () => unknown, code: OrbitalErrorCode): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  if (!caught) {
    throw new Error(
      `Expected an OrbitalError with code ${code}, but nothing was thrown.`,
    );
  }
  expect(caught).toBeInstanceOf(OrbitalError);
  expect((caught as OrbitalError).code).toBe(code);
}

function expectCloseInstant(
  actual: Date,
  expectedIso: string,
  toleranceMs: number,
): void {
  expect(
    Math.abs(actual.getTime() - Date.parse(expectedIso)),
  ).toBeLessThanOrEqual(toleranceMs);
}

function expectCloseDeg(
  actual: number,
  expected: number,
  toleranceDeg: number,
): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(toleranceDeg);
}

function firstPass(
  ...args: Parameters<typeof findUpcomingPasses>
): PassSummary {
  const passes = findUpcomingPasses(...args);
  if (passes.length === 0) {
    throw new Error('Expected at least one pass.');
  }
  return passes[0];
}

// --- 1. Known ISS pass (regression lock) --------------------------------------

describe('findUpcomingPasses - known ISS pass', () => {
  // First pass above 10° from Buenos Aires after 2019-06-05T12:13Z:
  // a short WSW-to-N pass peaking at 22.2°.
  const pass = firstPass(issSatrec, BUENOS_AIRES, FROM_UTC, {
    minElevationDeg: 10,
    count: 1,
  });

  it('locks AOS, maximum and LOS instants within 2 s', () => {
    expectCloseInstant(pass.aosUtc, '2019-06-05T13:32:00.469Z', 2000);
    expectCloseInstant(pass.maxUtc, '2019-06-05T13:34:42.018Z', 2000);
    expectCloseInstant(pass.losUtc, '2019-06-05T13:37:22.031Z', 2000);
  });

  it('locks the maximum elevation and azimuths within 0.1°', () => {
    expectCloseDeg(pass.maxElevationDeg, 22.221, 0.1);
    expectCloseDeg(pass.aosAzimuthDeg, 256.062, 0.1);
    expectCloseDeg(pass.losAzimuthDeg, 2.669, 0.1);
  });

  it('is internally consistent (duration, azimuth range, maximum bounds)', () => {
    expect(pass.durationS).toBe(322);
    expect(
      Math.abs(
        pass.durationS * 1000 - (pass.losUtc.getTime() - pass.aosUtc.getTime()),
      ),
    ).toBeLessThanOrEqual(1000);
    expect(pass.aosAzimuthDeg).toBeGreaterThanOrEqual(0);
    expect(pass.aosAzimuthDeg).toBeLessThan(360);
    expect(pass.losAzimuthDeg).toBeGreaterThanOrEqual(0);
    expect(pass.losAzimuthDeg).toBeLessThan(360);
    expect(pass.maxUtc.getTime()).toBeGreaterThanOrEqual(pass.aosUtc.getTime());
    expect(pass.maxUtc.getTime()).toBeLessThanOrEqual(pass.losUtc.getTime());
    expect(pass.maxElevationDeg).toBeGreaterThanOrEqual(10);
  });
});

// --- 2. GEO seen/not-seen by observer latitude --------------------------------

describe('findUpcomingPasses - GEO seen/not-seen by observer latitude', () => {
  it('sees the GEO from mid-latitudes of its hemisphere (threshold 20°)', () => {
    const passes = findUpcomingPasses(geoSatrec, GEO_MID_LAT, FROM_UTC, {
      minElevationDeg: 20,
      count: 2,
      windowS: WINDOW_48H_S,
    });
    expect(passes).toHaveLength(1);
    // Elevation is ~49.4° all the time (stationary object).
    expectCloseDeg(passes[0].maxElevationDeg, 49.4, 0.5);
    expect(passes[0].maxElevationDeg).toBeGreaterThanOrEqual(20);
    // Always visible: the pass is clipped to the search window edges.
    expect(passes[0].aosUtc.toISOString()).toBe('2019-06-05T12:13:00.000Z');
    expect(passes[0].losUtc.toISOString()).toBe('2019-06-07T12:13:00.000Z');
    expect(passes[0].durationS).toBe(WINDOW_48H_S);
  });

  it('does not see the same GEO from the opposite hemisphere at the same longitude', () => {
    const passes = findUpcomingPasses(geoSatrec, GEO_OPPOSITE_LAT, FROM_UTC, {
      minElevationDeg: 20,
      count: 2,
      windowS: WINDOW_48H_S,
    });
    expect(passes).toEqual([]);
    // By latitude only: the object IS above the horizon there (~11.5°), it
    // just never reaches the 20° threshold that the mid-latitude sees.
    const look = lookAnglesAt(geoSatrec, GEO_OPPOSITE_LAT, FROM_UTC);
    expect(look.elevationDeg).toBeGreaterThan(0);
    expect(look.elevationDeg).toBeLessThan(20);
  });
});

// --- 3. Threshold 0° vs 10° ---------------------------------------------------

describe('findUpcomingPasses - threshold 0° vs 10°', () => {
  const pass0 = firstPass(issSatrec, BUENOS_AIRES, FROM_UTC, {
    minElevationDeg: 0,
    count: 1,
  });
  const pass10 = firstPass(issSatrec, BUENOS_AIRES, FROM_UTC, {
    minElevationDeg: 10,
    count: 1,
  });

  it('captures the same physical pass at both thresholds', () => {
    expectCloseInstant(pass0.maxUtc, pass10.maxUtc.toISOString(), 2000);
    expectCloseDeg(pass0.maxElevationDeg, pass10.maxElevationDeg, 0.1);
  });

  it('makes the 0° window strictly contain the 10° window', () => {
    expect(pass0.aosUtc.getTime()).toBeLessThan(pass10.aosUtc.getTime());
    expect(pass0.losUtc.getTime()).toBeGreaterThan(pass10.losUtc.getTime());
    expect(pass0.durationS).toBeGreaterThan(pass10.durationS);
  });
});

// --- 4. Satellite that never rises -------------------------------------------

describe('findUpcomingPasses - satellite that never rises', () => {
  it('returns an empty list for a GEO below the horizon of a polar observer (threshold 0°)', () => {
    const passes = findUpcomingPasses(geoSatrec, GEO_POLAR, FROM_UTC, {
      minElevationDeg: 0,
      count: 2,
      windowS: WINDOW_48H_S,
    });
    expect(passes).toEqual([]);
    expect(
      lookAnglesAt(geoSatrec, GEO_POLAR, FROM_UTC).elevationDeg,
    ).toBeLessThan(0);
  });

  it('returns an empty list when the threshold sits above the maximum elevation', () => {
    const passes = findUpcomingPasses(geoSatrec, GEO_MID_LAT, FROM_UTC, {
      minElevationDeg: 60,
      count: 2,
      windowS: WINDOW_48H_S,
    });
    expect(passes).toEqual([]);
  });

  it('returns an empty list for a search window without any pass', () => {
    const passes = findUpcomingPasses(issSatrec, BUENOS_AIRES, FROM_UTC, {
      minElevationDeg: 10,
      count: 2,
      windowS: 60,
    });
    expect(passes).toEqual([]);
  });
});

// --- Input guards -------------------------------------------------------------

describe('findUpcomingPasses - input guards', () => {
  it('rejects invalid instants and options with ORBIT_BAD_INPUT', () => {
    expectOrbitalError(
      () =>
        findUpcomingPasses(issSatrec, BUENOS_AIRES, new Date(NaN), {
          count: 1,
        }),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(
      () =>
        findUpcomingPasses(issSatrec, BUENOS_AIRES, FROM_UTC, {
          minElevationDeg: -1,
        }),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(
      () =>
        findUpcomingPasses(issSatrec, BUENOS_AIRES, FROM_UTC, {
          minElevationDeg: 91,
        }),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(
      () => findUpcomingPasses(issSatrec, BUENOS_AIRES, FROM_UTC, { count: 0 }),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(
      () =>
        findUpcomingPasses(issSatrec, BUENOS_AIRES, FROM_UTC, { windowS: 0 }),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(
      () =>
        findUpcomingPasses(issSatrec, BUENOS_AIRES, FROM_UTC, {
          coarseStepS: 0,
        }),
      'ORBIT_BAD_INPUT',
    );
  });
});

// --- Trajectory sampling (sky chart input) ------------------------------------

describe('samplePassTrajectory', () => {
  const pass = firstPass(issSatrec, BUENOS_AIRES, FROM_UTC, {
    minElevationDeg: 10,
    count: 1,
  });
  const samples = samplePassTrajectory(
    issSatrec,
    BUENOS_AIRES,
    pass.aosUtc,
    pass.losUtc,
  );

  it('covers the pass from AOS to LOS including both endpoints', () => {
    expect(samples.length).toBeGreaterThanOrEqual(3);
    expect(samples[0].timeUTC.getTime()).toBe(pass.aosUtc.getTime());
    expect(samples[samples.length - 1].timeUTC.getTime()).toBe(
      pass.losUtc.getTime(),
    );
    for (let i = 1; i < samples.length; i += 1) {
      expect(samples[i].timeUTC.getTime()).toBeGreaterThan(
        samples[i - 1].timeUTC.getTime(),
      );
    }
  });

  it('keeps samples on the sky (azimuth range) and near the threshold at the edges', () => {
    for (const sample of samples) {
      expect(sample.azimuthDeg).toBeGreaterThanOrEqual(0);
      expect(sample.azimuthDeg).toBeLessThan(360);
      expect(Number.isFinite(sample.elevationDeg)).toBe(true);
    }
    // Bisection leaves AOS/LOS within ~0.5° of the threshold.
    expectCloseDeg(samples[0].elevationDeg, 10, 0.5);
    expectCloseDeg(samples[samples.length - 1].elevationDeg, 10, 0.5);
    // The trajectory maximum matches the reported pass maximum.
    const trajectoryMax = Math.max(...samples.map(s => s.elevationDeg));
    expectCloseDeg(trajectoryMax, pass.maxElevationDeg, 0.5);
  });

  it('rejects invalid inputs with ORBIT_BAD_INPUT', () => {
    expectOrbitalError(
      () =>
        samplePassTrajectory(
          issSatrec,
          BUENOS_AIRES,
          new Date(NaN),
          pass.losUtc,
        ),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(
      () =>
        samplePassTrajectory(issSatrec, BUENOS_AIRES, pass.losUtc, pass.aosUtc),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(
      () =>
        samplePassTrajectory(
          issSatrec,
          BUENOS_AIRES,
          pass.aosUtc,
          pass.losUtc,
          0,
        ),
      'ORBIT_BAD_INPUT',
    );
  });
});
