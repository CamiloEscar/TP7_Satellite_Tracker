import type { OrbitalRecord } from '../data/types';
import {
  createSatrecFromOmm,
  createSatrecFromTle,
  subpointAt,
} from '../orbital';
import type { Satrec, SubpointResult } from '../orbital';

/** One constellation member ready to propagate. */
export interface ConstellationObject {
  noradId: number;
  name: string;
  satrec: Satrec;
}

/** One propagated member at a shared timestamp (map dot data). */
export interface ConstellationDot {
  noradId: number;
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
}

/**
 * Builds element sets for a batch of records. A malformed record is skipped:
 * one bad element set must not kill the whole constellation layer.
 */
export function buildConstellation(
  records: readonly OrbitalRecord[],
): ConstellationObject[] {
  const objects: ConstellationObject[] = [];
  for (const record of records) {
    try {
      const satrec =
        record.format === 'omm'
          ? createSatrecFromOmm(record.payload)
          : createSatrecFromTle(record.payload.line1, record.payload.line2);
      objects.push({ noradId: record.noradId, name: record.name, satrec });
    } catch {
      // Skip unusable element sets; the rest of the batch still renders.
    }
  }
  return objects;
}

/**
 * Batch propagation of every member at one shared timestamp (ARCHITECTURE.md
 * §4 "propagación en lote"): one `subpointAt` per member, one dot per
 * successful member. Per-member errors (e.g. decayed) are isolated: failed
 * members are skipped, the rest of the batch is returned.
 */
export function propagateConstellation(
  objects: readonly ConstellationObject[],
  whenUTC: Date,
): ConstellationDot[] {
  const dots: ConstellationDot[] = [];
  for (const object of objects) {
    try {
      const subpoint: SubpointResult = subpointAt(object.satrec, whenUTC);
      dots.push({
        noradId: object.noradId,
        latitudeDeg: subpoint.latitudeDeg,
        longitudeDeg: subpoint.longitudeDeg,
        altitudeKm: subpoint.altitudeKm,
      });
    } catch {
      // Skip failed members; the layer degrades instead of dying.
    }
  }
  return dots;
}
