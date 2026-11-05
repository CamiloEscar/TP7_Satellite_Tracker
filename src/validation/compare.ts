/**
 * Position comparison math for the validation layer (RF-15, Hito 10):
 * great-circle (haversine) error between geodetic points, altitude delta and
 * look-angle deltas. Pure TypeScript - no React Native, no network.
 */

/** Geodetic point in degrees / km (same boundary units as the engine). */
export interface GeodeticPoint {
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
}

/** Topocentric look angles in degrees (subset of the engine's result). */
export interface LookAngles {
  azimuthDeg: number;
  elevationDeg: number;
}

/** One compared sample: local propagation vs reference source. */
export interface SampleComparison {
  /** Comparison instant (UTC). Both sides are evaluated at THIS instant. */
  timestampUtc: Date;
  /** Great-circle (haversine) surface distance between the subpoints, km. */
  errorKm: number;
  /** Local altitude minus reference altitude, km (secondary metric). */
  altitudeDeltaKm: number;
  /** Absolute azimuth difference in [0, 180]; null when the source has no look angles. */
  azimuthDeltaDeg: number | null;
  /** Absolute elevation difference in [0, 180]; null when the source has no look angles. */
  elevationDeltaDeg: number | null;
}

/** Mean Earth radius in km (same constant as `src/geo`). */
export const MEAN_EARTH_RADIUS_KM = 6371;

const DEG_TO_RAD = Math.PI / 180;

/**
 * Great-circle (haversine) surface distance between two geodetic points, km.
 * The altitude difference is NOT folded in; it is reported separately as a
 * secondary metric (`altitudeDeltaKm`).
 */
export function haversineKm(a: GeodeticPoint, b: GeodeticPoint): number {
  const lat1 = a.latitudeDeg * DEG_TO_RAD;
  const lat2 = b.latitudeDeg * DEG_TO_RAD;
  const dLat = (b.latitudeDeg - a.latitudeDeg) * DEG_TO_RAD;
  const dLon = (b.longitudeDeg - a.longitudeDeg) * DEG_TO_RAD;
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * MEAN_EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Minimal absolute difference between two angles on a circle, degrees,
 * always in [0, 180]. Handles the azimuth wrap (359 vs 1 -> 2) and works
 * for elevation too (its range is already within one semicircle).
 */
export function angleDeltaDeg(aDeg: number, bDeg: number): number {
  const diff = Math.abs(aDeg - bDeg) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Compares one local propagation sample against one reference sample at the
 * SAME instant. Look-angle deltas are computed only when BOTH sides provide
 * them (mode B / N2YO); otherwise they are `null`.
 */
export function comparePositions(
  timestampUtc: Date,
  local: GeodeticPoint,
  reference: GeodeticPoint,
  localLook?: LookAngles,
  referenceLook?: LookAngles,
): SampleComparison {
  const lookPair = localLook && referenceLook;
  return {
    timestampUtc,
    errorKm: haversineKm(local, reference),
    altitudeDeltaKm: local.altitudeKm - reference.altitudeKm,
    azimuthDeltaDeg: lookPair
      ? angleDeltaDeg(localLook.azimuthDeg, referenceLook.azimuthDeg)
      : null,
    elevationDeltaDeg: lookPair
      ? angleDeltaDeg(localLook.elevationDeg, referenceLook.elevationDeg)
      : null,
  };
}
