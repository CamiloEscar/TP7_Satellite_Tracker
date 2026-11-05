/**
 * Error table builder for the validation layer (RF-15, Hito 10): turns the
 * per-sample comparisons into one report-ready table with the age of the
 * orbital element set used (epoch + fetchedAt). Pure TypeScript.
 */
import { OrbitalError } from '../orbital';
import type { SampleComparison } from './compare';

/**
 * Validation modes (Hito 10):
 * - A: implementation-isolated error. The SAME element set (WTIA `/tles`) is
 *   propagated locally and against the reference (WTIA `/positions`) at the
 *   SAME timestamps, so only OUR implementation error remains.
 * - B: total error. Local propagation vs N2YO `/positions` (different element
 *   sets and propagators); its az/el also validate the look angles.
 */
export type ValidationMode = 'A' | 'B';

/** Which source produced the reference samples (evidence provenance). */
export type ValidationReference = 'wtia' | 'n2yo';

/** Identity and freshness of the orbital element set used locally. */
export interface ElementSetInfo {
  /** Epoch of the element set (UTC). */
  epochUtc: Date;
  /** UTC instant of the download that produced the element set. */
  fetchedAtUtc: Date;
}

/** One row of the error table: one compared sample plus element-set age. */
export interface ErrorTableRow {
  timestampUtc: Date;
  errorKm: number;
  altitudeDeltaKm: number;
  azimuthDeltaDeg: number | null;
  elevationDeltaDeg: number | null;
  elementEpochUtc: Date;
  elementFetchedAtUtc: Date;
  /** Age of the element set at the sample instant: (timestamp - epoch), hours. */
  elementAgeHours: number;
}

/** Aggregate metrics over the rows (means over non-null deltas). */
export interface ErrorSummary {
  sampleCount: number;
  meanErrorKm: number;
  maxErrorKm: number;
  meanAltitudeDeltaKm: number;
  meanAzimuthDeltaDeg: number | null;
  meanElevationDeltaDeg: number | null;
}

/** The full validation result table (export input). */
export interface ErrorTable {
  mode: ValidationMode;
  reference: ValidationReference;
  noradId: number;
  satelliteName: string;
  /** Method note recorded in the exports (report text, Spanish). */
  method: string;
  rows: ErrorTableRow[];
  summary: ErrorSummary;
}

/** Method note per mode (report text, Spanish). */
export const VALIDATION_METHOD: Record<ValidationMode, string> = {
  A: 'Error de implementación aislado: mismo TLE (WTIA /tles) propagado localmente y por WTIA /positions en el mismo instante.',
  B: 'Error total: propagación local vs N2YO /positions (az/el validados desde el observador).',
};

export interface BuildErrorTableInput {
  mode: ValidationMode;
  reference: ValidationReference;
  noradId: number;
  satelliteName: string;
  elementSet: ElementSetInfo;
  comparisons: readonly SampleComparison[];
}

function badInput(message: string): OrbitalError {
  return new OrbitalError('ORBIT_BAD_INPUT', message);
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Builds the error table from the raw comparisons. The element-set age is
 * computed per row against the sample instant, so the table always carries
 * the orbital data freshness required by the report.
 *
 * Throws `OrbitalError` (`ORBIT_BAD_INPUT`) when there are no comparisons -
 * an error table without samples is not a valid result.
 */
export function buildErrorTable(input: BuildErrorTableInput): ErrorTable {
  const { elementSet, comparisons } = input;
  if (comparisons.length === 0) {
    throw badInput('comparisons must contain at least one sample.');
  }
  const rows: ErrorTableRow[] = comparisons.map(comparison => ({
    timestampUtc: comparison.timestampUtc,
    errorKm: comparison.errorKm,
    altitudeDeltaKm: comparison.altitudeDeltaKm,
    azimuthDeltaDeg: comparison.azimuthDeltaDeg,
    elevationDeltaDeg: comparison.elevationDeltaDeg,
    elementEpochUtc: elementSet.epochUtc,
    elementFetchedAtUtc: elementSet.fetchedAtUtc,
    elementAgeHours:
      (comparison.timestampUtc.getTime() - elementSet.epochUtc.getTime()) /
      3600000,
  }));
  const azimuthDeltas = rows
    .map(row => row.azimuthDeltaDeg)
    .filter((value): value is number => value !== null);
  const elevationDeltas = rows
    .map(row => row.elevationDeltaDeg)
    .filter((value): value is number => value !== null);
  return {
    mode: input.mode,
    reference: input.reference,
    noradId: input.noradId,
    satelliteName: input.satelliteName,
    method: VALIDATION_METHOD[input.mode],
    rows,
    summary: {
      sampleCount: rows.length,
      meanErrorKm: mean(rows.map(row => row.errorKm)),
      maxErrorKm: Math.max(...rows.map(row => row.errorKm)),
      meanAltitudeDeltaKm: mean(rows.map(row => row.altitudeDeltaKm)),
      meanAzimuthDeltaDeg:
        azimuthDeltas.length > 0 ? mean(azimuthDeltas) : null,
      meanElevationDeltaDeg:
        elevationDeltas.length > 0 ? mean(elevationDeltas) : null,
    },
  };
}
