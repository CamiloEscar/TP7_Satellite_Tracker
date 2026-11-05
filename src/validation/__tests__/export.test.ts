/**
 * @format
 *
 * Export formatting tests (RF-15): deterministic CSV and Markdown renderings
 * of an error table (the report deliverable's table export).
 */
import type { SampleComparison } from '../compare';
import { errorTableToCsv, errorTableToMarkdown } from '../export';
import { buildErrorTable } from '../table';

const EPOCH = new Date('2026-11-02T18:10:00.000Z');
const FETCHED_AT = new Date('2026-11-04T20:55:00.000Z');

function tableWith(comparisons: SampleComparison[]) {
  return buildErrorTable({
    mode: 'A',
    reference: 'wtia',
    noradId: 25544,
    satelliteName: 'ISS',
    elementSet: { epochUtc: EPOCH, fetchedAtUtc: FETCHED_AT },
    comparisons,
  });
}

const SAMPLE_A: SampleComparison = {
  timestampUtc: new Date('2026-11-04T21:00:00.000Z'),
  errorKm: 1.23456,
  altitudeDeltaKm: -0.5,
  azimuthDeltaDeg: null,
  elevationDeltaDeg: null,
};

const SAMPLE_B: SampleComparison = {
  timestampUtc: new Date('2026-11-04T21:01:00.000Z'),
  errorKm: 2,
  altitudeDeltaKm: 0.25,
  azimuthDeltaDeg: 2.345,
  elevationDeltaDeg: -1.5,
};

describe('errorTableToCsv', () => {
  it('renders a stable header and one line per sample with fixed decimals', () => {
    const csv = errorTableToCsv(tableWith([SAMPLE_A]));
    expect(csv).toBe(
      'timestamp_utc,error_km,altitude_delta_km,azimuth_delta_deg,' +
        'elevation_delta_deg,element_epoch_utc,element_fetched_at_utc,' +
        'element_age_hours\n' +
        '2026-11-04T21:00:00.000Z,1.235,-0.500,,,' +
        '2026-11-02T18:10:00.000Z,2026-11-04T20:55:00.000Z,50.83',
    );
  });

  it('renders look-angle deltas when present', () => {
    const csv = errorTableToCsv(tableWith([SAMPLE_B]));
    const line = csv.split('\n')[1];
    expect(line).toBe(
      '2026-11-04T21:01:00.000Z,2.000,0.250,2.35,-1.50,' +
        '2026-11-02T18:10:00.000Z,2026-11-04T20:55:00.000Z,50.85',
    );
  });
});

describe('errorTableToMarkdown', () => {
  it('renders the report metadata, the sample table and the summary', () => {
    const md = errorTableToMarkdown(tableWith([SAMPLE_A, SAMPLE_B]));
    expect(md).toContain(
      '# Tabla de errores - Modo A (error de implementación aislado, WTIA)',
    );
    expect(md).toContain('- Satélite: ISS (NORAD 25544)');
    expect(md).toContain(
      '- Fuente de referencia: Where The ISS at? (/tles + /positions)',
    );
    expect(md).toContain('- Set orbital usado: epoch 2026-11-02T18:10:00.000Z');
    expect(md).toContain(
      '| Timestamp (UTC) | Error (km) | Δ alt (km) | Δ az (°) | Δ el (°) | Epoch set | Descargado | Edad set (h) |',
    );
    expect(md).toContain(
      '| 2026-11-04T21:00:00.000Z | 1.235 | -0.500 | — | — | 2026-11-02T18:10:00.000Z | 2026-11-04T20:55:00.000Z | 50.83 |',
    );
    expect(md).toContain(
      '| 2026-11-04T21:01:00.000Z | 2.000 | 0.250 | 2.35 | -1.50 |',
    );
    expect(md).toContain('## Resumen');
    expect(md).toContain('- Muestras: 2');
    expect(md).toContain('- Error medio: 1.617 km');
    expect(md).toContain('- Error máximo: 2.000 km');
    // Look-angle means only when the samples have them.
    expect(md).toContain('- Δ azimut medio: 2.35°');
    expect(md).toContain('- Δ elevación medio: -1.50°');
  });

  it('omits the look-angle means when the source has no angles (mode A)', () => {
    const md = errorTableToMarkdown(tableWith([SAMPLE_A]));
    expect(md).not.toContain('Δ azimut medio');
    expect(md).not.toContain('Δ elevación medio');
  });
});
