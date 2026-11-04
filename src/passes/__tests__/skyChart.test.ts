/**
 * @format
 *
 * Sky-chart projection sanity: zenith → center, horizon → edge ring,
 * azimuth rotation direction (N up, E right).
 */
import { elevationRingRadius, projectSkyPoint } from '../skyChart';

const R = 120;

describe('elevationRingRadius', () => {
  it('puts the zenith at the center and the horizon at the edge', () => {
    expect(elevationRingRadius(90, R)).toBe(0);
    expect(elevationRingRadius(0, R)).toBe(R);
    expect(elevationRingRadius(30, R)).toBeCloseTo((R * 2) / 3, 10);
    expect(elevationRingRadius(60, R)).toBeCloseTo(R / 3, 10);
  });

  it('shrinks monotonically as elevation grows', () => {
    expect(elevationRingRadius(60, R)).toBeLessThan(elevationRingRadius(30, R));
    expect(elevationRingRadius(30, R)).toBeLessThan(elevationRingRadius(0, R));
  });
});

describe('projectSkyPoint', () => {
  it('projects the zenith to the chart center at any azimuth', () => {
    for (const az of [0, 45, 123, 359]) {
      const point = projectSkyPoint(az, 90, R);
      expect(point.x).toBeCloseTo(0, 10);
      expect(point.y).toBeCloseTo(0, 10);
    }
  });

  it('projects the horizon to the edge ring at any azimuth', () => {
    for (const az of [0, 90, 180, 270]) {
      const point = projectSkyPoint(az, 0, R);
      expect(Math.hypot(point.x, point.y)).toBeCloseTo(R, 10);
    }
  });

  it('rotates clockwise with azimuth: north up, east right', () => {
    const north = projectSkyPoint(0, 0, R);
    expect(north.x).toBeCloseTo(0, 10);
    expect(north.y).toBeCloseTo(-R, 10); // up on screen
    const east = projectSkyPoint(90, 0, R);
    expect(east.x).toBeCloseTo(R, 10); // right on screen
    expect(east.y).toBeCloseTo(0, 10);
    const south = projectSkyPoint(180, 0, R);
    expect(south.x).toBeCloseTo(0, 10);
    expect(south.y).toBeCloseTo(R, 10); // down on screen
    const west = projectSkyPoint(270, 0, R);
    expect(west.x).toBeCloseTo(-R, 10);
    expect(west.y).toBeCloseTo(0, 10);
  });

  it('scales the radius with elevation', () => {
    const mid = projectSkyPoint(0, 45, R);
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(R / 2, 10);
  });
});
