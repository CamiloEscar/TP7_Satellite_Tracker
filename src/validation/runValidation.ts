/**
 * Validation runner (RF-15, Hito 10): composes the two validation modes over
 * the pure comparison math. All provider access goes through the injected
 * `ValidationSources` ports (the existing data layer in production, fakes in
 * tests) - this module never performs HTTP itself.
 *
 * Method (ARCHITECTURE.md 5): SAME element set + SAME timestamp. The local
 * propagation is always evaluated at the exact instant of the reference
 * sample, so the comparison never mixes time offsets into the error.
 */
import type { ObserverGeodetic, Satrec } from '../orbital';
import {
  OrbitalError,
  createSatrecFromOmm,
  createSatrecFromTle,
  getEpoch,
  lookAnglesAt,
  subpointAt,
} from '../orbital';
import type {
  OrbitalRecord,
  TlePayload,
  ValidationPosition,
} from '../data/types';
import { DataError } from '../data/types';
import { comparePositions } from './compare';
import type { SampleComparison } from './compare';
import { buildErrorTable } from './table';
import type {
  ElementSetInfo,
  ErrorTable,
  ValidationMode,
  ValidationReference,
} from './table';

/** WTIA only tracks the ISS; mode A is therefore ISS-only. */
export const ISS_NORAD_ID = 25544;

/** Mode A satellite label for the report tables. */
const ISS_NAME = 'ISS';

/**
 * Ports the runner needs. Production wiring: `sourcesFromProvider` over the
 * `DataProvider`; tests inject plain fakes (never the network).
 */
export interface ValidationSources {
  /**
   * Mode A: the element set BOTH sides propagate (WTIA `/tles`). The
   * reference source computes its positions from this same set.
   */
  getValidationTle(): Promise<TlePayload>;
  /**
   * Reference position at a requested instant (WTIA `/positions` for mode A,
   * N2YO `/positions` for mode B). The returned `timestamp` is the exact
   * compared instant.
   */
  getReferencePosition(
    noradId: number,
    timestampUtc: Date,
  ): Promise<ValidationPosition>;
  /** Mode B: the app's own element set for the local propagation. */
  getOrbitalRecord(noradId: number): Promise<OrbitalRecord>;
}

export interface RunValidationOptions {
  mode: ValidationMode;
  noradId: number;
  /** Requested sample instants (UTC). One table row per instant. */
  timestampsUtc: readonly Date[];
  /** Look-angle observer; REQUIRED in mode B (N2YO az/el are observer-based). */
  observer?: ObserverGeodetic;
  /** Fetch instant recorded for the mode-A TLE (default: run time). */
  fetchedAtUtc?: Date;
}

function badInput(message: string): OrbitalError {
  return new OrbitalError('ORBIT_BAD_INPUT', message);
}

function assertTimestamps(options: RunValidationOptions): Date[] {
  const timestamps = [...options.timestampsUtc];
  if (timestamps.length === 0) {
    throw badInput('timestampsUtc must contain at least one instant.');
  }
  for (const timestamp of timestamps) {
    if (!(timestamp instanceof Date) || Number.isNaN(timestamp.getTime())) {
      throw badInput('timestampsUtc must contain valid Date instants.');
    }
  }
  return timestamps;
}

function satrecFromRecord(record: OrbitalRecord): Satrec {
  return record.format === 'omm'
    ? createSatrecFromOmm(record.payload)
    : createSatrecFromTle(record.payload.line1, record.payload.line2);
}

/**
 * Runs one validation over `timestampsUtc` and returns the error table.
 *
 * Mode A (implementation-isolated error): the WTIA TLE is propagated locally
 * and compared against WTIA positions at the same instants; both sides use
 * the SAME element set, so only OUR implementation error remains.
 *
 * Mode B (total error): the app's element set is propagated locally and
 * compared against N2YO positions (its own set + propagator), including the
 * az/el look angles from the observer.
 */
export async function runValidation(
  sources: ValidationSources,
  options: RunValidationOptions,
): Promise<ErrorTable> {
  const timestamps = assertTimestamps(options);
  return options.mode === 'A'
    ? runModeA(sources, options, timestamps)
    : runModeB(sources, options, timestamps);
}

async function runModeA(
  sources: ValidationSources,
  options: RunValidationOptions,
  timestamps: Date[],
): Promise<ErrorTable> {
  if (options.noradId !== ISS_NORAD_ID) {
    throw badInput(
      `Mode A is ISS-only (WTIA tracks NORAD ${ISS_NORAD_ID}); got ${options.noradId}.`,
    );
  }
  const tle = await sources.getValidationTle();
  const satrec = createSatrecFromTle(tle.line1, tle.line2);
  const elementSet: ElementSetInfo = {
    epochUtc: getEpoch(satrec),
    fetchedAtUtc: options.fetchedAtUtc ?? new Date(),
  };
  const comparisons: SampleComparison[] = [];
  for (const requested of timestamps) {
    const reference = await sources.getReferencePosition(
      options.noradId,
      requested,
    );
    // Same-timestamp rule: propagate locally at the reference sample instant.
    const instant = reference.timestamp;
    const local = subpointAt(satrec, instant);
    comparisons.push(comparePositions(instant, local, reference));
  }
  return buildErrorTable({
    mode: 'A',
    reference: 'wtia',
    noradId: options.noradId,
    satelliteName: ISS_NAME,
    elementSet,
    comparisons,
  });
}

async function runModeB(
  sources: ValidationSources,
  options: RunValidationOptions,
  timestamps: Date[],
): Promise<ErrorTable> {
  const { observer } = options;
  if (!observer) {
    throw badInput(
      'Mode B requires an observer (N2YO az/el are observer-based).',
    );
  }
  const record = await sources.getOrbitalRecord(options.noradId);
  const satrec = satrecFromRecord(record);
  const elementSet: ElementSetInfo = {
    epochUtc: record.epoch,
    fetchedAtUtc: record.fetchedAt,
  };
  const comparisons: SampleComparison[] = [];
  for (const requested of timestamps) {
    const reference = await sources.getReferencePosition(
      options.noradId,
      requested,
    );
    const instant = reference.timestamp;
    const local = subpointAt(satrec, instant);
    const localLook = lookAnglesAt(satrec, observer, instant);
    const referenceLook =
      reference.azimuthDeg !== undefined && reference.elevationDeg !== undefined
        ? {
            azimuthDeg: reference.azimuthDeg,
            elevationDeg: reference.elevationDeg,
          }
        : undefined;
    comparisons.push(
      comparePositions(instant, local, reference, localLook, referenceLook),
    );
  }
  return buildErrorTable({
    mode: 'B',
    reference: 'n2yo',
    noradId: options.noradId,
    satelliteName: record.name,
    elementSet,
    comparisons,
  });
}

/** Slice of `DataProvider` the validation wiring needs (all optional-but-checked). */
export interface ValidationProviderSlice {
  getOrbitalData(noradId: number): Promise<OrbitalRecord>;
  getValidationTle?(): Promise<TlePayload>;
  getValidationPositionFrom?(
    source: ValidationReference,
    noradId: number,
    timestamp: Date,
  ): Promise<ValidationPosition>;
}

/**
 * Adapts the `DataProvider` (data layer) to the runner ports. Missing
 * optional methods surface as `DataError` (`DATA_NOT_FOUND`) so the UI can
 * report them with the rest of the data-layer errors.
 */
export function sourcesFromProvider(
  provider: ValidationProviderSlice,
  reference: ValidationReference,
): ValidationSources {
  return {
    getValidationTle: async () => {
      const get = provider.getValidationTle;
      if (!get) {
        throw missingSource('validation TLE (WTIA /tles)');
      }
      return get.call(provider);
    },
    getReferencePosition: (noradId, timestampUtc) => {
      const get = provider.getValidationPositionFrom;
      if (!get) {
        throw missingSource(`validation positions (${reference})`);
      }
      return get.call(provider, reference, noradId, timestampUtc);
    },
    getOrbitalRecord: noradId => provider.getOrbitalData(noradId),
  };
}

/** Builds a typed `DataError` for a missing optional provider method. */
function missingSource(what: string): DataError {
  return new DataError(
    'DATA_NOT_FOUND',
    `The data provider does not expose ${what}.`,
  );
}
