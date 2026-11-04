import type { ObserverGeodetic } from '../orbital/types';

/**
 * Pure observer-location logic: manual lat/lon/alt validation and GPS
 * error-code mapping into a typed result union.
 */

/** Result of resolving the observer location (GPS or manual entry). */
export type LocationResult =
  | { status: 'ok'; observer: ObserverGeodetic }
  | { status: 'permission_denied' }
  | { status: 'position_unavailable' }
  | { status: 'timeout' };

/**
 * Maps react-native-geolocation-service error codes to result statuses:
 * 1 -> permission_denied, 2 -> position_unavailable (GPS off), 3 -> timeout
 * (no signal). Any other code is treated as position_unavailable.
 */
export function gpsErrorToResult(code: number): LocationResult {
  switch (code) {
    case 1:
      return { status: 'permission_denied' };
    case 2:
      return { status: 'position_unavailable' };
    case 3:
      return { status: 'timeout' };
    default:
      return { status: 'position_unavailable' };
  }
}

/**
 * Builds the ok result from a GPS fix. Geolocation reports altitude in
 * meters and may omit it (null) - a missing altitude becomes sea level.
 */
export function gpsPositionToResult(
  latitudeDeg: number,
  longitudeDeg: number,
  altitudeM: number | null,
): LocationResult {
  return {
    status: 'ok',
    observer: {
      latitudeDeg,
      longitudeDeg,
      altitudeKm: (altitudeM ?? 0) / 1000,
    },
  };
}

/** Form field that failed manual validation. */
export type ManualLocationField = 'latitude' | 'longitude' | 'altitude';

/** Result of parsing the manual lat/lon/alt form (altitude in km). */
export type ManualLocationResult =
  | { status: 'ok'; observer: ObserverGeodetic }
  | { status: 'invalid'; field: ManualLocationField };

function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parses and validates manual form values. Bounds mirror `lookAnglesAt`:
 * latitude +-90, longitude +-180, altitude -1..100 km (inclusive).
 */
export function parseManualLocation(raw: {
  latitudeDeg: string;
  longitudeDeg: string;
  altitudeKm: string;
}): ManualLocationResult {
  const latitudeDeg = parseNumber(raw.latitudeDeg);
  if (latitudeDeg === null || Math.abs(latitudeDeg) > 90) {
    return { status: 'invalid', field: 'latitude' };
  }
  const longitudeDeg = parseNumber(raw.longitudeDeg);
  if (longitudeDeg === null || Math.abs(longitudeDeg) > 180) {
    return { status: 'invalid', field: 'longitude' };
  }
  const altitudeKm = parseNumber(raw.altitudeKm);
  if (altitudeKm === null || altitudeKm < -1 || altitudeKm > 100) {
    return { status: 'invalid', field: 'altitude' };
  }
  return { status: 'ok', observer: { latitudeDeg, longitudeDeg, altitudeKm } };
}
