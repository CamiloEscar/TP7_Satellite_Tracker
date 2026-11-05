/**
 * @format
 *
 * Comparison math tests (RF-15): haversine great-circle error, circular
 * angle deltas and the sample comparison assembly (look-angle deltas only
 * when both sides provide them).
 */
import {
  MEAN_EARTH_RADIUS_KM,
  angleDeltaDeg,
  comparePositions,
  haversineKm,
} from '../compare';

const POINT_A = {
  latitudeDeg: -34.6037,
  longitudeDeg: -58.3816,
  altitudeKm: 420,
};

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(POINT_A, POINT_A)).toBe(0);
  });

  it('matches the 1 degree of latitude arc on the sphere', () => {
    const a = { ...POINT_A, latitudeDeg: 0, longitudeDeg: 0, altitudeKm: 0 };
    const b = { ...a, latitudeDeg: 1 };
    const expected = (MEAN_EARTH_RADIUS_KM * Math.PI) / 180;
    expect(haversineKm(a, b)).toBeCloseTo(expected, 6);
  });

  it('matches the 1 degree of longitude arc at the equator', () => {
    const a = { latitudeDeg: 0, longitudeDeg: 0, altitudeKm: 0 };
    const b = { latitudeDeg: 0, longitudeDeg: 1, altitudeKm: 0 };
    const expected = (MEAN_EARTH_RADIUS_KM * Math.PI) / 180;
    expect(haversineKm(a, b)).toBeCloseTo(expected, 6);
  });

  it('is symmetric and ignores the altitude difference', () => {
    const b = {
      latitudeDeg: -33.5,
      longitudeDeg: -57.9,
      altitudeKm: 999,
    };
    expect(haversineKm(POINT_A, b)).toBeCloseTo(haversineKm(b, POINT_A), 10);
    expect(haversineKm(POINT_A, b)).toBeCloseTo(
      haversineKm({ ...POINT_A, altitudeKm: 0 }, { ...b, altitudeKm: 0 }),
      10,
    );
  });

  it('handles the longitude wrap (same meridian, opposite signs)', () => {
    const a = { latitudeDeg: 0, longitudeDeg: 179.5, altitudeKm: 0 };
    const b = { latitudeDeg: 0, longitudeDeg: -179.5, altitudeKm: 0 };
    const expected = (MEAN_EARTH_RADIUS_KM * Math.PI) / 180; // 1 degree
    expect(haversineKm(a, b)).toBeCloseTo(expected, 6);
  });
});

describe('angleDeltaDeg', () => {
  it('returns the plain absolute difference inside one semicircle', () => {
    expect(angleDeltaDeg(10, 20)).toBeCloseTo(10, 10);
    expect(angleDeltaDeg(20, 10)).toBeCloseTo(10, 10);
  });

  it('takes the short way around the azimuth wrap', () => {
    expect(angleDeltaDeg(359, 1)).toBeCloseTo(2, 10);
    expect(angleDeltaDeg(1, 359)).toBeCloseTo(2, 10);
    expect(angleDeltaDeg(0, 180)).toBeCloseTo(180, 10);
    expect(angleDeltaDeg(180, 0)).toBeCloseTo(180, 10);
  });
});

describe('comparePositions', () => {
  const timestamp = new Date('2026-11-04T21:00:00.000Z');

  it('reports error km and altitude delta; look deltas null without angles', () => {
    const local = { latitudeDeg: 10, longitudeDeg: 20, altitudeKm: 421 };
    const reference = { latitudeDeg: 10, longitudeDeg: 20, altitudeKm: 419 };
    const comparison = comparePositions(timestamp, local, reference);
    expect(comparison.timestampUtc).toBe(timestamp);
    expect(comparison.errorKm).toBe(0);
    expect(comparison.altitudeDeltaKm).toBeCloseTo(2, 10);
    expect(comparison.azimuthDeltaDeg).toBeNull();
    expect(comparison.elevationDeltaDeg).toBeNull();
  });

  it('computes look-angle deltas when both sides provide angles', () => {
    const point = { latitudeDeg: 0, longitudeDeg: 0, altitudeKm: 400 };
    const comparison = comparePositions(
      timestamp,
      point,
      point,
      { azimuthDeg: 359, elevationDeg: 40 },
      { azimuthDeg: 1, elevationDeg: 42.5 },
    );
    expect(comparison.azimuthDeltaDeg).toBeCloseTo(2, 10);
    expect(comparison.elevationDeltaDeg).toBeCloseTo(2.5, 10);
  });

  it('keeps look deltas null when only one side provides angles', () => {
    const point = { latitudeDeg: 0, longitudeDeg: 0, altitudeKm: 400 };
    const comparison = comparePositions(
      timestamp,
      point,
      point,
      { azimuthDeg: 10, elevationDeg: 20 },
      undefined,
    );
    expect(comparison.azimuthDeltaDeg).toBeNull();
    expect(comparison.elevationDeltaDeg).toBeNull();
  });
});
