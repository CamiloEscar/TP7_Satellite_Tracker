/**
 * @format
 *
 * Error-table builder tests (RF-15): per-row element-set age (epoch +
 * fetchedAt), summary aggregation and the empty-input guard.
 */
import { OrbitalError } from '../../orbital';
import type { SampleComparison } from '../compare';
import { VALIDATION_METHOD, buildErrorTable } from '../table';

const EPOCH = new Date('2026-11-02T18:10:00.000Z');
const FETCHED_AT = new Date('2026-11-04T20:55:00.000Z');

function comparison(
  iso: string,
  overrides: Partial<SampleComparison> = {},
): SampleComparison {
  return {
    timestampUtc: new Date(iso),
    errorKm: 1,
    altitudeDeltaKm: 0.5,
    azimuthDeltaDeg: null,
    elevationDeltaDeg: null,
    ...overrides,
  };
}

const BASE_INPUT = {
  mode: 'A' as const,
  reference: 'wtia' as const,
  noradId: 25544,
  satelliteName: 'ISS',
  elementSet: { epochUtc: EPOCH, fetchedAtUtc: FETCHED_AT },
};

describe('buildErrorTable', () => {
  it('carries the element-set age per row (timestamp - epoch)', () => {
    const table = buildErrorTable({
      ...BASE_INPUT,
      comparisons: [
        comparison('2026-11-04T21:00:00.000Z'),
        comparison('2026-11-04T22:00:00.000Z'),
      ],
    });
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0].elementEpochUtc).toEqual(EPOCH);
    expect(table.rows[0].elementFetchedAtUtc).toEqual(FETCHED_AT);
    // 2026-11-02T18:10Z -> 2026-11-04T21:00Z is 50 h 50 min.
    expect(table.rows[0].elementAgeHours).toBeCloseTo(50 + 50 / 60, 10);
    expect(table.rows[1].elementAgeHours).toBeCloseTo(51 + 50 / 60, 10);
  });

  it('aggregates the summary (mean/max error km, altitude mean)', () => {
    const table = buildErrorTable({
      ...BASE_INPUT,
      comparisons: [
        comparison('2026-11-04T21:00:00.000Z', {
          errorKm: 1,
          altitudeDeltaKm: -1,
        }),
        comparison('2026-11-04T21:01:00.000Z', {
          errorKm: 3,
          altitudeDeltaKm: 1,
        }),
      ],
    });
    expect(table.summary.sampleCount).toBe(2);
    expect(table.summary.meanErrorKm).toBeCloseTo(2, 10);
    expect(table.summary.maxErrorKm).toBeCloseTo(3, 10);
    expect(table.summary.meanAltitudeDeltaKm).toBeCloseTo(0, 10);
    expect(table.summary.meanAzimuthDeltaDeg).toBeNull();
    expect(table.summary.meanElevationDeltaDeg).toBeNull();
  });

  it('averages the look-angle deltas only over the rows that have them', () => {
    const table = buildErrorTable({
      ...BASE_INPUT,
      mode: 'B',
      reference: 'n2yo',
      comparisons: [
        comparison('2026-11-04T21:00:00.000Z'),
        comparison('2026-11-04T21:01:00.000Z', {
          azimuthDeltaDeg: 2,
          elevationDeltaDeg: 4,
        }),
        comparison('2026-11-04T21:02:00.000Z', {
          azimuthDeltaDeg: 4,
          elevationDeltaDeg: 8,
        }),
      ],
    });
    expect(table.summary.meanAzimuthDeltaDeg).toBeCloseTo(3, 10);
    expect(table.summary.meanElevationDeltaDeg).toBeCloseTo(6, 10);
  });

  it('records the mode method note', () => {
    const table = buildErrorTable({
      ...BASE_INPUT,
      comparisons: [comparison('2026-11-04T21:00:00.000Z')],
    });
    expect(table.method).toBe(VALIDATION_METHOD.A);
  });

  it('rejects an empty comparison set', () => {
    let caught: unknown;
    try {
      buildErrorTable({ ...BASE_INPUT, comparisons: [] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(OrbitalError);
    expect((caught as OrbitalError).code).toBe('ORBIT_BAD_INPUT');
  });
});
