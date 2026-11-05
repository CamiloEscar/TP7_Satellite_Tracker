/**
 * Report exports for the validation error table (RF-15, Hito 10): CSV and
 * Markdown renderings of an `ErrorTable`. Pure string formatting - the CSV is
 * machine-readable data, the Markdown is the report-ready rendering.
 */
import type { ErrorTable } from './table';

function iso(date: Date): string {
  return date.toISOString();
}

function fixedKm(value: number): string {
  return value.toFixed(3);
}

function fixedDeg(value: number): string {
  return value.toFixed(2);
}

function fixedHours(value: number): string {
  return value.toFixed(2);
}

/**
 * CSV export: one header row plus one row per compared sample. Null deltas
 * (mode A: the source has no look angles) render as empty cells. Decimal
 * point is "." and no locale formatting is applied, so the file is stable.
 */
export function errorTableToCsv(table: ErrorTable): string {
  const header = [
    'timestamp_utc',
    'error_km',
    'altitude_delta_km',
    'azimuth_delta_deg',
    'elevation_delta_deg',
    'element_epoch_utc',
    'element_fetched_at_utc',
    'element_age_hours',
  ].join(',');
  const lines = table.rows.map(row =>
    [
      iso(row.timestampUtc),
      fixedKm(row.errorKm),
      fixedKm(row.altitudeDeltaKm),
      row.azimuthDeltaDeg === null ? '' : fixedDeg(row.azimuthDeltaDeg),
      row.elevationDeltaDeg === null ? '' : fixedDeg(row.elevationDeltaDeg),
      iso(row.elementEpochUtc),
      iso(row.elementFetchedAtUtc),
      fixedHours(row.elementAgeHours),
    ].join(','),
  );
  return [header, ...lines].join('\n');
}

const MODE_TITLE: Record<ErrorTable['mode'], string> = {
  A: 'Modo A (error de implementación aislado, WTIA)',
  B: 'Modo B (error total, N2YO)',
};

const REFERENCE_LABEL: Record<ErrorTable['reference'], string> = {
  wtia: 'Where The ISS at? (/tles + /positions)',
  n2yo: 'N2YO (/positions)',
};

/**
 * Markdown export: title, method metadata, one table row per compared sample
 * (including element-set epoch, fetch instant and age) and a summary block.
 */
export function errorTableToMarkdown(table: ErrorTable): string {
  const first = table.rows[0];
  const lines: string[] = [
    `# Tabla de errores - ${MODE_TITLE[table.mode]}`,
    '',
    `- Satélite: ${table.satelliteName} (NORAD ${table.noradId})`,
    `- Fuente de referencia: ${REFERENCE_LABEL[table.reference]}`,
    `- Método: ${table.method}`,
    `- Set orbital usado: epoch ${iso(first.elementEpochUtc)}, descargado ${iso(
      first.elementFetchedAtUtc,
    )}`,
    '',
    '| Timestamp (UTC) | Error (km) | Δ alt (km) | Δ az (°) | Δ el (°) | Epoch set | Descargado | Edad set (h) |',
    '| --------------- | ---------: | ---------: | -------: | -------: | --------- | ---------- | -----------: |',
  ];
  for (const row of table.rows) {
    lines.push(
      `| ${iso(row.timestampUtc)} | ${fixedKm(row.errorKm)} | ${fixedKm(
        row.altitudeDeltaKm,
      )} | ${
        row.azimuthDeltaDeg === null ? '—' : fixedDeg(row.azimuthDeltaDeg)
      } | ${
        row.elevationDeltaDeg === null ? '—' : fixedDeg(row.elevationDeltaDeg)
      } | ${iso(row.elementEpochUtc)} | ${iso(
        row.elementFetchedAtUtc,
      )} | ${fixedHours(row.elementAgeHours)} |`,
    );
  }
  const summary = table.summary;
  lines.push(
    '',
    '## Resumen',
    '',
    `- Muestras: ${summary.sampleCount}`,
    `- Error medio: ${fixedKm(summary.meanErrorKm)} km`,
    `- Error máximo: ${fixedKm(summary.maxErrorKm)} km`,
    `- Δ altitud medio: ${fixedKm(summary.meanAltitudeDeltaKm)} km`,
  );
  if (summary.meanAzimuthDeltaDeg !== null) {
    lines.push(`- Δ azimut medio: ${fixedDeg(summary.meanAzimuthDeltaDeg)}°`);
  }
  if (summary.meanElevationDeltaDeg !== null) {
    lines.push(
      `- Δ elevación medio: ${fixedDeg(summary.meanElevationDeltaDeg)}°`,
    );
  }
  return lines.join('\n');
}
