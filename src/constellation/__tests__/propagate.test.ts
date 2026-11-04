import type { OrbitalRecord } from '../../data/types';
import type { OmmJson } from '../../orbital';
import { subpointAt } from '../../orbital';
import { buildConstellation, propagateConstellation } from '../index';
import type { ConstellationObject } from '../index';

// ISS TLE A - satellite.js README example, epoch 2019-06-05T12:12:57.999883Z.
const ISS_TLE_A = {
  line1:
    '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  line2:
    '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
};

// HELIOS 2A OMM - satellite.js README example.
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

const WHEN_UTC = new Date('2019-06-05T12:13:00.000Z');

function tleRecord(noradId: number, name: string): OrbitalRecord {
  return {
    format: 'tle',
    noradId,
    name,
    source: 'celestrak-gp',
    epoch: new Date('2019-06-05T12:12:58.000Z'),
    fetchedAt: new Date('2019-06-05T13:00:00.000Z'),
    payload: ISS_TLE_A,
  };
}

function ommRecord(): OrbitalRecord {
  return {
    format: 'omm',
    noradId: 28492,
    name: 'HELIOS 2A',
    source: 'celestrak-gp',
    epoch: new Date('2025-03-26T05:19:34.000Z'),
    fetchedAt: new Date('2025-03-26T06:00:00.000Z'),
    payload: HELIOS_2A_OMM,
  };
}

function badTleRecord(): OrbitalRecord {
  return {
    format: 'tle',
    noradId: 999999,
    name: 'BAD SAT',
    source: 'celestrak-gp',
    epoch: new Date('2019-06-05T12:12:58.000Z'),
    fetchedAt: new Date('2019-06-05T13:00:00.000Z'),
    payload: { line1: 'garbage', line2: 'garbage' },
  };
}

describe('buildConstellation', () => {
  it('builds element sets from OMM and TLE records', () => {
    const objects = buildConstellation([
      tleRecord(25544, 'ISS (ZARYA)'),
      ommRecord(),
    ]);
    expect(objects.map(o => [o.noradId, o.name])).toEqual([
      [25544, 'ISS (ZARYA)'],
      [28492, 'HELIOS 2A'],
    ]);
    for (const object of objects) {
      expect(Number.isFinite(object.satrec.jdsatepoch)).toBe(true);
    }
  });

  it('skips malformed records but keeps the rest of the batch', () => {
    const objects = buildConstellation([
      tleRecord(25544, 'ISS (ZARYA)'),
      badTleRecord(),
      ommRecord(),
    ]);
    expect(objects.map(o => o.noradId)).toEqual([25544, 28492]);
  });
});

describe('propagateConstellation', () => {
  const objects: ConstellationObject[] = buildConstellation([
    tleRecord(25544, 'ISS (ZARYA)'),
    ommRecord(),
    tleRecord(48274, 'STARLINK-30000'),
  ]);

  it('propagates every member at one shared timestamp', () => {
    const dots = propagateConstellation(objects, WHEN_UTC);
    expect(dots.map(d => d.noradId)).toEqual([25544, 28492, 48274]);
    for (const dot of dots) {
      expect(Math.abs(dot.latitudeDeg)).toBeLessThanOrEqual(90);
      expect(Math.abs(dot.longitudeDeg)).toBeLessThanOrEqual(180);
    }
  });

  it('matches subpointAt at the same instant (batch equivalence)', () => {
    const dots = propagateConstellation(objects, WHEN_UTC);
    objects.forEach((object, index) => {
      const expected = subpointAt(object.satrec, WHEN_UTC);
      expect(dots[index].latitudeDeg).toBeCloseTo(expected.latitudeDeg, 10);
      expect(dots[index].longitudeDeg).toBeCloseTo(expected.longitudeDeg, 10);
      expect(dots[index].altitudeKm).toBeCloseTo(expected.altitudeKm, 10);
    });
  });

  it('isolates a failing member and keeps the rest of the batch', () => {
    // Deep-ish copy: clone each satrec so the shared fixtures stay clean.
    const poisoned = objects.map(object => ({
      ...object,
      satrec: { ...object.satrec },
    }));
    // Real SGP4 runtime failure (nm <= 0): negative mean motion (the same
    // trick as the engine tests) - the batch must degrade, not die.
    poisoned[1].satrec.no = -0.001;
    const dots = propagateConstellation(poisoned, WHEN_UTC);
    expect(dots.map(d => d.noradId)).toEqual([25544, 48274]);
  });

  it('returns an empty batch for no objects', () => {
    expect(propagateConstellation([], WHEN_UTC)).toEqual([]);
  });
});
