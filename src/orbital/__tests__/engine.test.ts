import * as satellite from 'satellite.js';
import {
  OrbitalError,
  createSatrecFromOmm,
  createSatrecFromTle,
  getEpoch,
  lookAnglesAt,
  propagateEci,
  subpointAt,
} from '../index';
import type { ObserverGeodetic, OmmJson, OrbitalErrorCode } from '../index';

// --- Public fixtures (embedded; no network) ----------------------------------

// ISS TLE A — satellite.js README example, epoch 2019-156.50900463
// (= 2019-06-05T12:12:57.999883Z).
const ISS_TLE_A_LINE1 =
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992';
const ISS_TLE_A_LINE2 =
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442';

// ISS TLE B — N2YO docs example, epoch 2018-077.09047010.
const ISS_TLE_B_LINE1 =
  '1 25544U 98067A   18077.09047010  .00001878  00000-0  35621-4 0  9999';
const ISS_TLE_B_LINE2 =
  '2 25544  51.6412 112.8495 0001928  208.4187 178.9720 15.54106440104358';

// HELIOS 2A OMM — satellite.js README example (EPOCH without Z suffix; UTC implied).
const HELIOS_2A_OMM: OmmJson = {
  OBJECT_NAME: 'HELIOS 2A',
  OBJECT_ID: '2004-049A',
  EPOCH: '2025-03-26T05:19:34.116960',
  MEAN_MOTION: 15.00555103,
  ECCENTRICITY: 0.000583,
  INCLINATION: 98.3164,
  RA_OF_ASC_NODE: 103.8411,
  ARG_OF_PERICENTER: 20.5667,
  MEAN_ANOMALY: 339.5789,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 28492,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 8655,
  BSTAR: 0.00048021,
  MEAN_MOTION_DOT: 0.00005995,
  MEAN_MOTION_DDOT: 0,
};

// --- Helpers ------------------------------------------------------------------

const MS_PER_DAY = 86400000;

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

function eciDistanceKm(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/**
 * Converts a TLE into the equivalent OMM/JSON object field by field,
 * mirroring the exact columns satellite.js reads in both parsers
 * (see satellite.js dist/io.js: twoline2satrec / json2satrec).
 *
 * Field conventions proven here:
 * - MEAN_MOTION: rev/day from line 2 cols 53-63.
 * - ECCENTRICITY: line 2 cols 27-33 with a decimal point prepended.
 * - BSTAR / MEAN_MOTION_DDOT: TLE signed-mantissa " 59442-4" -> 0.59442e-4.
 * - MEAN_MOTION_DOT: line 1 cols 34-43 verbatim (TLE stores ndot/2; OMM
 *   stores the same value — both parsers divide identically).
 * - EPOCH: YYDDD.ddddddd -> ISO UTC with ms resolution.
 */
function tleToOmm(line1: string, line2: string): OmmJson {
  const epochyr = parseInt(line1.substring(18, 20), 10);
  const year = epochyr < 57 ? epochyr + 2000 : epochyr + 1900;
  const epochdays = parseFloat(line1.substring(20, 32));
  const epochMs =
    Date.UTC(year, 0, 1) + Math.round((epochdays - 1) * MS_PER_DAY);
  // e.g. 2019-156.50900463 -> 2019-06-05T12:12:57.999Z
  const exp10 = (s: string): number =>
    parseFloat(
      `${s.substring(0, 1)}.${s.substring(1, 6)}E${s.substring(6, 8)}`,
    );
  return {
    OBJECT_NAME: 'ISS (ZARYA)',
    OBJECT_ID: '1998-067A',
    EPOCH: new Date(epochMs).toISOString(),
    MEAN_MOTION: parseFloat(line2.substring(52, 63)),
    ECCENTRICITY: parseFloat(`.${line2.substring(26, 33).replace(/\s/g, '0')}`),
    INCLINATION: parseFloat(line2.substring(8, 16)),
    RA_OF_ASC_NODE: parseFloat(line2.substring(17, 25)),
    ARG_OF_PERICENTER: parseFloat(line2.substring(34, 42)),
    MEAN_ANOMALY: parseFloat(line2.substring(43, 51)),
    EPHEMERIS_TYPE: 0,
    CLASSIFICATION_TYPE: 'U',
    NORAD_CAT_ID: parseInt(line1.substring(2, 7), 10),
    ELEMENT_SET_NO: parseInt(line1.substring(64, 68).trim(), 10),
    REV_AT_EPOCH: parseInt(line2.substring(63, 68).trim(), 10),
    BSTAR: exp10(line1.substring(53, 61)),
    MEAN_MOTION_DOT: parseFloat(line1.substring(33, 43)),
    MEAN_MOTION_DDOT: exp10(line1.substring(44, 52)),
  };
}

// --- Shared state ---------------------------------------------------------------

const satrecA = createSatrecFromTle(ISS_TLE_A_LINE1, ISS_TLE_A_LINE2);
const epochA = getEpoch(satrecA);

// --- Element-set factories ------------------------------------------------------

describe('createSatrecFromTle / createSatrecFromOmm', () => {
  it('parses the ISS TLE A fixture', () => {
    expect(satrecA.satnum).toBe('25544');
  });

  it('parses the ISS TLE B fixture', () => {
    const satrec = createSatrecFromTle(ISS_TLE_B_LINE1, ISS_TLE_B_LINE2);
    expect(satrec.satnum).toBe('25544');
  });

  it('parses the HELIOS 2A OMM fixture', () => {
    const satrec = createSatrecFromOmm(HELIOS_2A_OMM);
    expect(satrec.satnum).toBe('28492');
  });

  it('rejects malformed TLE lines with ORBIT_BAD_INPUT', () => {
    expectOrbitalError(
      () => createSatrecFromTle('garbage line one', 'garbage line two'),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(
      () => createSatrecFromTle(ISS_TLE_A_LINE2, ISS_TLE_A_LINE1),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(
      () =>
        createSatrecFromTle(ISS_TLE_A_LINE1.substring(0, 40), ISS_TLE_A_LINE2),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(() => createSatrecFromTle('', ''), 'ORBIT_BAD_INPUT');
  });

  it('rejects malformed OMM input with ORBIT_BAD_INPUT', () => {
    expectOrbitalError(
      () => createSatrecFromOmm(null as unknown as OmmJson),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(
      () => createSatrecFromOmm({} as OmmJson),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(
      () =>
        createSatrecFromOmm({
          ...HELIOS_2A_OMM,
          EPOCH: undefined as unknown as string,
        }),
      'ORBIT_BAD_INPUT',
    );
  });
});

// --- getEpoch -------------------------------------------------------------------

describe('getEpoch', () => {
  it('returns the TLE A epoch as the correct UTC instant (2019-06-05T12:12:57.999883Z)', () => {
    const expectedMs = Date.UTC(2019, 0, 1) + (156.50900463 - 1) * MS_PER_DAY;
    expect(Math.abs(epochA.getTime() - expectedMs)).toBeLessThanOrEqual(1000);
  });

  it('returns the OMM epoch as a UTC instant even without a Z suffix', () => {
    const satrec = createSatrecFromOmm(HELIOS_2A_OMM);
    const expectedMs = Date.parse('2025-03-26T05:19:34.116960Z');
    expect(
      Math.abs(getEpoch(satrec).getTime() - expectedMs),
    ).toBeLessThanOrEqual(1000);
  });
});

// --- subpointAt -----------------------------------------------------------------

describe('subpointAt', () => {
  it('keeps ISS (TLE A) at epoch inside its physical envelope', () => {
    const s = subpointAt(satrecA, epochA);
    expect(Math.abs(s.latitudeDeg)).toBeLessThanOrEqual(52); // orbit inclination 51.64 deg
    expect(s.longitudeDeg).toBeGreaterThan(-180);
    expect(s.longitudeDeg).toBeLessThanOrEqual(180);
    expect(s.altitudeKm).toBeGreaterThanOrEqual(400);
    expect(s.altitudeKm).toBeLessThanOrEqual(460);
  });

  it('keeps ISS (TLE B) at epoch inside the same envelope', () => {
    const satrec = createSatrecFromTle(ISS_TLE_B_LINE1, ISS_TLE_B_LINE2);
    const s = subpointAt(satrec, getEpoch(satrec));
    expect(Math.abs(s.latitudeDeg)).toBeLessThanOrEqual(52);
    expect(s.longitudeDeg).toBeGreaterThan(-180);
    expect(s.longitudeDeg).toBeLessThanOrEqual(180);
    expect(s.altitudeKm).toBeGreaterThanOrEqual(390);
    expect(s.altitudeKm).toBeLessThanOrEqual(460);
  });

  it('produces finite LEO-band samples every 60 s for a full orbit', () => {
    // Period of TLE A: 15.51174618 rev/day -> ~92.8 min.
    for (let t = 0; t <= 5520; t += 60) {
      const when = new Date(epochA.getTime() + t * 1000);
      const s = subpointAt(satrecA, when);
      expect(Number.isFinite(s.latitudeDeg)).toBe(true);
      expect(Number.isFinite(s.longitudeDeg)).toBe(true);
      expect(s.altitudeKm).toBeGreaterThanOrEqual(380);
      expect(s.altitudeKm).toBeLessThanOrEqual(480);
    }
  });

  it('derives ~7.66 km/s orbital speed from consecutive ECI samples', () => {
    const p0 = propagateEci(satrecA, epochA).positionKm;
    const p1 = propagateEci(
      satrecA,
      new Date(epochA.getTime() + 60000),
    ).positionKm;
    const speedKmPerS = eciDistanceKm(p0, p1) / 60;
    expect(speedKmPerS).toBeGreaterThan(7.6);
    expect(speedKmPerS).toBeLessThanOrEqual(7.7);
  });

  it('rejects an invalid Date with ORBIT_BAD_INPUT', () => {
    expectOrbitalError(
      () => subpointAt(satrecA, new Date(NaN)),
      'ORBIT_BAD_INPUT',
    );
  });
});

// --- Cross-format equivalence -----------------------------------------------------

describe('cross-format equivalence (TLE A vs field-by-field OMM)', () => {
  it('agrees within ~1 km at epoch + 30 min through both loaders', () => {
    const satrecTle = createSatrecFromTle(ISS_TLE_A_LINE1, ISS_TLE_A_LINE2);
    const satrecOmm = createSatrecFromOmm(
      tleToOmm(ISS_TLE_A_LINE1, ISS_TLE_A_LINE2),
    );
    const when = new Date(getEpoch(satrecTle).getTime() + 30 * 60000);

    const eciTle = propagateEci(satrecTle, when).positionKm;
    const eciOmm = propagateEci(satrecOmm, when).positionKm;
    expect(eciDistanceKm(eciTle, eciOmm)).toBeLessThan(1);

    const subTle = subpointAt(satrecTle, when);
    const subOmm = subpointAt(satrecOmm, when);
    expect(Math.abs(subTle.latitudeDeg - subOmm.latitudeDeg)).toBeLessThan(
      0.01,
    ); // ~1.1 km
    expect(Math.abs(subTle.longitudeDeg - subOmm.longitudeDeg)).toBeLessThan(
      0.01,
    );
    expect(Math.abs(subTle.altitudeKm - subOmm.altitudeKm)).toBeLessThan(1);
  });
});

// --- lookAnglesAt -----------------------------------------------------------------

describe('lookAnglesAt', () => {
  const t = new Date(epochA.getTime() + 42 * 60000);
  const sp = subpointAt(satrecA, t);
  const atSubpoint: ObserverGeodetic = {
    latitudeDeg: sp.latitudeDeg,
    longitudeDeg: sp.longitudeDeg,
    altitudeKm: 0,
  };

  it('gives elevation ≈ 90° and range ≈ altitude for an observer at the subpoint', () => {
    const la = lookAnglesAt(satrecA, atSubpoint, t);
    expect(Math.abs(la.elevationDeg - 90)).toBeLessThanOrEqual(1);
    expect(Math.abs(la.rangeKm - sp.altitudeKm)).toBeLessThanOrEqual(5);
  });

  it('gives lower elevation and a well-defined azimuth for an observer ~1000 km away', () => {
    const offset: ObserverGeodetic = {
      latitudeDeg: sp.latitudeDeg + 9, // ~1000 km north along the meridian
      longitudeDeg: sp.longitudeDeg,
      altitudeKm: 0,
    };
    const near = lookAnglesAt(satrecA, atSubpoint, t);
    const far = lookAnglesAt(satrecA, offset, t);
    expect(far.elevationDeg).toBeLessThan(near.elevationDeg);
    expect(far.elevationDeg).toBeLessThan(85);
    expect(Number.isFinite(far.azimuthDeg)).toBe(true);
    expect(far.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(far.azimuthDeg).toBeLessThan(360);
  });

  it('rejects out-of-range observers with ORBIT_BAD_INPUT', () => {
    expectOrbitalError(
      () => lookAnglesAt(satrecA, { ...atSubpoint, latitudeDeg: 91 }, t),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(
      () => lookAnglesAt(satrecA, { ...atSubpoint, longitudeDeg: 181 }, t),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(
      () => lookAnglesAt(satrecA, { ...atSubpoint, altitudeKm: Number.NaN }, t),
      'ORBIT_BAD_INPUT',
    );
  });

  it('rejects an invalid Date with ORBIT_BAD_INPUT', () => {
    expectOrbitalError(
      () => lookAnglesAt(satrecA, atSubpoint, new Date(NaN)),
      'ORBIT_BAD_INPUT',
    );
  });
});

// --- Propagation error mapping (forced null/thrown paths) --------------------------

// babel's ESM->CJS interop makes module exports non-configurable, so
// jest.spyOn cannot redefine `propagate`. A module mock with a delegating
// default implementation achieves the same for the whole file.
const actualSatellite = jest.requireActual('satellite.js') as typeof satellite;
const delegatePropagate = ((...args: unknown[]) =>
  (actualSatellite.propagate as (...a: unknown[]) => unknown)(
    ...args,
  )) as unknown as typeof satellite.propagate;

jest.mock('satellite.js', () => {
  const actual = jest.requireActual('satellite.js');
  return {
    ...actual,
    propagate: jest.fn((...args: unknown[]) =>
      (actual.propagate as (...a: unknown[]) => unknown)(...args),
    ),
  };
});

describe('propagation error mapping', () => {
  const validObserver: ObserverGeodetic = {
    latitudeDeg: -34.6,
    longitudeDeg: -58.4,
    altitudeKm: 0,
  };
  const mockedPropagate = jest.mocked(satellite.propagate);

  afterEach(() => {
    mockedPropagate.mockReset();
    mockedPropagate.mockImplementation(delegatePropagate);
  });

  it('maps a null propagation with SatRecError.Decayed to ORBIT_DECAYED', () => {
    mockedPropagate.mockImplementation(((satrec: satellite.SatRec) => {
      satrec.error = satellite.SatRecError.Decayed;
      return null;
    }) as unknown as typeof satellite.propagate);
    expectOrbitalError(() => subpointAt(satrecA, epochA), 'ORBIT_DECAYED');
  });

  it('maps a null propagation with another SGP4 error to ORBIT_PROPAGATION_FAILED', () => {
    mockedPropagate.mockImplementation(((satrec: satellite.SatRec) => {
      satrec.error = satellite.SatRecError.MeanMotionBelowZero;
      return null;
    }) as unknown as typeof satellite.propagate);
    expectOrbitalError(
      () => subpointAt(satrecA, epochA),
      'ORBIT_PROPAGATION_FAILED',
    );
  });

  it('maps a real SGP4 failure (negative mean motion) to ORBIT_PROPAGATION_FAILED', () => {
    const satrec = createSatrecFromTle(ISS_TLE_A_LINE1, ISS_TLE_A_LINE2);
    satrec.no = -0.001; // rad/min -> sgp4 runtime error 2 (nm <= 0) -> real null path
    expectOrbitalError(
      () => subpointAt(satrec, epochA),
      'ORBIT_PROPAGATION_FAILED',
    );
  });

  it('maps a thrown library error to ORBIT_PROPAGATION_FAILED', () => {
    mockedPropagate.mockImplementation((() => {
      throw new RangeError('simulated library failure');
    }) as unknown as typeof satellite.propagate);
    expectOrbitalError(
      () => lookAnglesAt(satrecA, validObserver, epochA),
      'ORBIT_PROPAGATION_FAILED',
    );
  });
});

// --- Deterministic regression lock --------------------------------------------------

describe('deterministic regression lock (ISS TLE A at epoch + 42 min)', () => {
  it('matches the frozen subpoint values', () => {
    const when = new Date(epochA.getTime() + 42 * 60000);
    const s = subpointAt(satrecA, when);
    // Frozen from satellite.js 7.1.0 output (2026-11-02). Guards against
    // silent numeric drift from future refactors of the wrapper.
    expect(s.latitudeDeg).toBeCloseTo(10.085277581957982, 6);
    expect(s.longitudeDeg).toBeCloseTo(143.65946216848278, 6);
    expect(s.altitudeKm).toBeCloseTo(418.1448204843482, 3);
  });
});
