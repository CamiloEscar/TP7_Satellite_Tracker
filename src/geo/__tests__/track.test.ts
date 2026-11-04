import { createSatrecFromTle } from '../../orbital';
import type { Satrec } from '../../orbital';
import {
  EARTH_RADIUS_KM,
  footprintPolygonKm,
  footprintRadiusKm,
  sampleGroundTrack,
  splitAtAntimeridian,
} from '../index';
import type { GeoJsonPosition, LatLon } from '../index';

// ISS TLE A - satellite.js README example, epoch 2019-06-05T12:12:57.999883Z.
const ISS_TLE_A_LINE1 =
  '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992';
const ISS_TLE_A_LINE2 =
  '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442';
const CENTER_UTC = new Date('2019-06-05T12:12:58.000Z');

function issSatrec(): Satrec {
  return createSatrecFromTle(ISS_TLE_A_LINE1, ISS_TLE_A_LINE2);
}

/** Orbital period in ms from the mean motion (satrec.no is rad/min). */
function periodMsOf(satrec: Satrec): number {
  return ((2 * Math.PI) / satrec.no) * 60000;
}

describe('sampleGroundTrack', () => {
  it('samples a symmetric ±1 orbit window at a fixed step', () => {
    const satrec = issSatrec();
    const stepMs = 60000;
    const samples = sampleGroundTrack(satrec, CENTER_UTC, 60);
    const halfSteps = Math.round(periodMsOf(satrec) / stepMs);

    expect(samples).toHaveLength(2 * halfSteps + 1);
    for (let i = 1; i < samples.length; i += 1) {
      expect(
        samples[i].timeUTC.getTime() - samples[i - 1].timeUTC.getTime(),
      ).toBe(stepMs);
    }
    expect(samples[0].timeUTC.getTime()).toBe(
      CENTER_UTC.getTime() - halfSteps * stepMs,
    );
    expect(samples[samples.length - 1].timeUTC.getTime()).toBe(
      CENTER_UTC.getTime() + halfSteps * stepMs,
    );
  });

  it('spans one orbit on each side of the center within one step', () => {
    const satrec = issSatrec();
    const stepMs = 60000;
    const samples = sampleGroundTrack(satrec, CENTER_UTC, 60);
    const periodMs = periodMsOf(satrec);

    const coveredBefore = CENTER_UTC.getTime() - samples[0].timeUTC.getTime();
    const coveredAfter =
      samples[samples.length - 1].timeUTC.getTime() - CENTER_UTC.getTime();
    for (const covered of [coveredBefore, coveredAfter]) {
      expect(covered).toBeGreaterThanOrEqual(periodMs - stepMs);
      expect(covered).toBeLessThanOrEqual(periodMs + stepMs);
    }
  });

  it('halves the step without changing the window', () => {
    const satrec = issSatrec();
    const coarse = sampleGroundTrack(satrec, CENTER_UTC, 60);
    const fine = sampleGroundTrack(satrec, CENTER_UTC, 30);

    expect(fine.length).toBeGreaterThan(coarse.length);
    expect(fine[0].timeUTC.getTime()).toBe(coarse[0].timeUTC.getTime());
    expect(fine[fine.length - 1].timeUTC.getTime()).toBe(
      coarse[coarse.length - 1].timeUTC.getTime(),
    );
  });

  it('returns samples within valid geodetic ranges', () => {
    const samples = sampleGroundTrack(issSatrec(), CENTER_UTC, 60);
    for (const sample of samples) {
      expect(Math.abs(sample.latitudeDeg)).toBeLessThanOrEqual(90);
      expect(sample.longitudeDeg).toBeGreaterThan(-180);
      expect(sample.longitudeDeg).toBeLessThanOrEqual(180);
    }
  });

  it('rejects a non-positive step', () => {
    expect(() => sampleGroundTrack(issSatrec(), CENTER_UTC, 0)).toThrow(
      'stepSeconds must be a positive finite number.',
    );
  });
});

describe('splitAtAntimeridian', () => {
  it('keeps a continuous track as a single segment', () => {
    const points: LatLon[] = [
      { latitudeDeg: 0, longitudeDeg: 178 },
      { latitudeDeg: 0, longitudeDeg: 179 },
      { latitudeDeg: 0, longitudeDeg: 179.5 },
    ];
    const segments = splitAtAntimeridian(points);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual(points);
  });

  it('splits when consecutive longitudes cross the antimeridian', () => {
    const crossing: LatLon[] = [
      { latitudeDeg: 10, longitudeDeg: 178 },
      { latitudeDeg: 10, longitudeDeg: 179 },
      { latitudeDeg: 10, longitudeDeg: -179 },
      { latitudeDeg: 10, longitudeDeg: -178 },
    ];
    const segments = splitAtAntimeridian(crossing);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual([crossing[0], crossing[1]]);
    expect(segments[1]).toEqual([crossing[2], crossing[3]]);
  });

  it('returns no segments for an empty polyline', () => {
    expect(splitAtAntimeridian([])).toEqual([]);
  });
});

describe('footprintRadiusKm', () => {
  it('matches the known value of the §4 formula for ISS-like altitude at 0°', () => {
    // γ = acos(Re / (Re + h)) with h = 420 km; radius = Re · γ.
    expect(footprintRadiusKm(420, 0)).toBeCloseTo(2252.39, 2);
  });

  it('grows with altitude', () => {
    expect(footprintRadiusKm(420, 10)).toBeGreaterThan(
      footprintRadiusKm(400, 10),
    );
  });

  it('shrinks with a higher minimum elevation', () => {
    expect(footprintRadiusKm(420, 0)).toBeGreaterThan(
      footprintRadiusKm(420, 20),
    );
  });
});

/** Great-circle distance in km between two GeoJSON positions ([lon, lat]). */
function haversineKm(a: GeoJsonPosition, b: GeoJsonPosition): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

describe('footprintPolygonKm', () => {
  // GeoJSON order: [lon, lat].
  const CENTER: GeoJsonPosition = [30, -40];

  it('returns a closed ring with segments + 1 positions', () => {
    const ring = footprintPolygonKm(CENTER[1], CENTER[0], 1000, 16);
    expect(ring).toHaveLength(17);
    expect(ring[ring.length - 1]).toEqual(ring[0]);
  });

  it('places every vertex ≈ radiusKm from the center via haversine', () => {
    const radiusKm = 2252.39;
    const ring = footprintPolygonKm(CENTER[1], CENTER[0], radiusKm);
    expect(ring).toHaveLength(65); // default 64 segments + closing vertex
    for (const vertex of ring) {
      expect(haversineKm(CENTER, vertex)).toBeCloseTo(radiusKm, 3);
    }
  });

  it('grows monotonically with the radius', () => {
    const small = footprintPolygonKm(CENTER[1], CENTER[0], 500, 16);
    const large = footprintPolygonKm(CENTER[1], CENTER[0], 1500, 16);
    for (let i = 0; i < small.length; i += 1) {
      expect(haversineKm(CENTER, large[i])).toBeGreaterThan(
        haversineKm(CENTER, small[i]),
      );
    }
  });

  it('wraps longitudes into valid geodetic ranges across the antimeridian', () => {
    const ring = footprintPolygonKm(0, 179, 500, 16);
    for (const [longitudeDeg, latitudeDeg] of ring) {
      expect(longitudeDeg).toBeGreaterThanOrEqual(-180);
      expect(longitudeDeg).toBeLessThanOrEqual(180);
      expect(Math.abs(latitudeDeg)).toBeLessThanOrEqual(90);
    }
  });

  it('rejects fewer than three segments', () => {
    expect(() => footprintPolygonKm(CENTER[1], CENTER[0], 100, 2)).toThrow(
      'segments must be an integer >= 3.',
    );
  });
});
