import {
  SatRecError,
  degreesLat,
  degreesLong,
  ecfToLookAngles,
  eciToEcf,
  eciToGeodetic,
  gstime,
  json2satrec,
  propagate,
  radiansLat,
  radiansLong,
  radiansToDegrees,
  twoline2satrec,
} from 'satellite.js';
import type { SatRec } from 'satellite.js';
import type {
  EciResult,
  LookAnglesResult,
  ObserverGeodetic,
  OmmJson,
  OrbitalErrorCode,
  Satrec,
  SubpointResult,
} from './types';

/** Julian date of the Unix epoch (1970-01-01T00:00:00Z). */
const JD_UNIX_EPOCH = 2440587.5;
const MS_PER_DAY = 86400000;

/**
 * Typed error of the orbital engine. `code` is the stable machine-readable
 * discriminator ('ORBIT_BAD_INPUT' | 'ORBIT_DECAYED' | 'ORBIT_PROPAGATION_FAILED');
 * the message is human-oriented and never leaks a raw library error.
 */
export class OrbitalError extends Error {
  readonly code: OrbitalErrorCode;

  constructor(code: OrbitalErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'OrbitalError';
    this.code = code;
  }
}

function badInput(message: string): OrbitalError {
  return new OrbitalError('ORBIT_BAD_INPUT', message);
}

/**
 * Element-set factory from OMM/JSON (primary format; NORAD IDs beyond 99999
 * have no TLE representation).
 */
export function createSatrecFromOmm(omm: OmmJson): Satrec {
  if (typeof omm !== 'object' || omm === null) {
    throw badInput('OMM element set must be an object.');
  }
  try {
    return assertUsable(json2satrec(omm));
  } catch (e) {
    if (e instanceof OrbitalError) {
      throw e;
    }
    throw new OrbitalError(
      'ORBIT_BAD_INPUT',
      `Invalid OMM element set: ${String(e)}`,
      {
        cause: e,
      },
    );
  }
}

/** Element-set factory from a legacy two-line TLE. */
export function createSatrecFromTle(line1: string, line2: string): Satrec {
  if (typeof line1 !== 'string' || typeof line2 !== 'string') {
    throw badInput('TLE lines must be strings.');
  }
  if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
    throw badInput('TLE lines must start with "1 " and "2 " respectively.');
  }
  // Columns 1..63 of each line carry every element SGP4 consumes.
  if (line1.length < 63 || line2.length < 63) {
    throw badInput('TLE lines are too short to contain the required fields.');
  }
  try {
    return assertUsable(twoline2satrec(line1, line2));
  } catch (e) {
    if (e instanceof OrbitalError) {
      throw e;
    }
    throw new OrbitalError(
      'ORBIT_BAD_INPUT',
      `Invalid TLE element set: ${String(e)}`,
      {
        cause: e,
      },
    );
  }
}

/** Rejects records that parsed to NaN fields or already carry an SGP4 init error. */
function assertUsable(satrec: SatRec): SatRec {
  if (
    !Number.isFinite(satrec.jdsatepoch) ||
    !Number.isFinite(satrec.no) ||
    satrec.error !== SatRecError.None
  ) {
    throw badInput(
      `Element set for satellite ${String(satrec.satnum)} is not usable ` +
        `(SGP4 init error code ${String(satrec.error)}).`,
    );
  }
  return satrec;
}

/** Element-set epoch as a UTC Date instant (jdsatepoch is UTC-based). */
export function getEpoch(satrec: Satrec): Date {
  if (
    typeof satrec !== 'object' ||
    satrec === null ||
    !Number.isFinite(satrec.jdsatepoch)
  ) {
    throw badInput('Satrec is missing a valid jdsatepoch.');
  }
  return new Date(Math.round((satrec.jdsatepoch - JD_UNIX_EPOCH) * MS_PER_DAY));
}

function assertValidInstant(whenUTC: Date): void {
  if (!(whenUTC instanceof Date) || Number.isNaN(whenUTC.getTime())) {
    throw badInput('whenUTC must be a valid Date (UTC instant).');
  }
}

/**
 * Propagates to `whenUTC` and returns the raw ECI (TEME) state.
 * Internal workhorse of `subpointAt`/`lookAnglesAt`; also exported for
 * consumers that need positions/velocities directly (e.g. speed checks).
 */
export function propagateEci(satrec: Satrec, whenUTC: Date): EciResult {
  assertValidInstant(whenUTC);
  let pv;
  try {
    pv = propagate(satrec, whenUTC);
  } catch (e) {
    throw new OrbitalError(
      'ORBIT_PROPAGATION_FAILED',
      `SGP4 propagation threw for satellite ${String(satrec.satnum)}: ${String(
        e,
      )}`,
      { cause: e },
    );
  }
  if (!pv) {
    throw propagationFailure(satrec);
  }
  const { position, velocity } = pv;
  const components = [
    position.x,
    position.y,
    position.z,
    velocity.x,
    velocity.y,
    velocity.z,
  ];
  if (components.some(v => !Number.isFinite(v))) {
    throw new OrbitalError(
      'ORBIT_PROPAGATION_FAILED',
      `SGP4 returned a non-finite state for satellite ${String(
        satrec.satnum,
      )}.`,
    );
  }
  return { positionKm: position, velocityKmPerS: velocity };
}

/** Maps a null SGP4 result (propagate's contract: satrec.error is set) to a typed error. */
function propagationFailure(satrec: SatRec): OrbitalError {
  if (satrec.error === SatRecError.Decayed) {
    return new OrbitalError(
      'ORBIT_DECAYED',
      `Satellite ${String(
        satrec.satnum,
      )} has decayed; no state exists at the requested time.`,
    );
  }
  return new OrbitalError(
    'ORBIT_PROPAGATION_FAILED',
    `SGP4 propagation failed for satellite ${String(satrec.satnum)} ` +
      `(error code ${String(satrec.error)}).`,
  );
}

/** Sub-satellite point (geodetic lat/lon/alt) at `whenUTC`. Degrees at the boundary. */
export function subpointAt(satrec: Satrec, whenUTC: Date): SubpointResult {
  const { positionKm } = propagateEci(satrec, whenUTC);
  try {
    const gmst = gstime(whenUTC);
    const geo = eciToGeodetic(positionKm, gmst);
    const latitudeDeg = degreesLat(geo.latitude);
    let longitudeDeg = degreesLong(geo.longitude);
    if (longitudeDeg === -180) {
      longitudeDeg = 180; // normalize to (-180, 180]
    }
    return { latitudeDeg, longitudeDeg, altitudeKm: geo.height };
  } catch (e) {
    if (e instanceof OrbitalError) {
      throw e;
    }
    throw new OrbitalError(
      'ORBIT_PROPAGATION_FAILED',
      `ECI-to-geodetic transform failed for satellite ${String(
        satrec.satnum,
      )}: ${String(e)}`,
      { cause: e },
    );
  }
}

/** Topocentric azimuth/elevation/range from `observer` (degrees, km) at `whenUTC`. */
export function lookAnglesAt(
  satrec: Satrec,
  observer: ObserverGeodetic,
  whenUTC: Date,
): LookAnglesResult {
  if (typeof observer !== 'object' || observer === null) {
    throw badInput('Observer must be an ObserverGeodetic object.');
  }
  if (
    !Number.isFinite(observer.latitudeDeg) ||
    Math.abs(observer.latitudeDeg) > 90
  ) {
    throw badInput(
      'Observer latitudeDeg must be a finite number in [-90, 90].',
    );
  }
  if (
    !Number.isFinite(observer.longitudeDeg) ||
    Math.abs(observer.longitudeDeg) > 180
  ) {
    throw badInput(
      'Observer longitudeDeg must be a finite number in [-180, 180].',
    );
  }
  if (
    !Number.isFinite(observer.altitudeKm) ||
    observer.altitudeKm < -1 ||
    observer.altitudeKm > 100
  ) {
    throw badInput(
      'Observer altitudeKm must be a finite number in km above sea level (-1..100).',
    );
  }
  const { positionKm } = propagateEci(satrec, whenUTC);
  try {
    const gmst = gstime(whenUTC);
    const ecf = eciToEcf(positionKm, gmst);
    const look = ecfToLookAngles(
      {
        latitude: radiansLat(observer.latitudeDeg),
        longitude: radiansLong(observer.longitudeDeg),
        height: observer.altitudeKm,
      },
      ecf,
    );
    const azimuthDeg = ((radiansToDegrees(look.azimuth) % 360) + 360) % 360;
    return {
      azimuthDeg,
      elevationDeg: radiansToDegrees(look.elevation),
      rangeKm: look.rangeSat,
    };
  } catch (e) {
    if (e instanceof OrbitalError) {
      throw e;
    }
    throw new OrbitalError(
      'ORBIT_PROPAGATION_FAILED',
      `Look-angle computation failed for satellite ${String(
        satrec.satnum,
      )}: ${String(e)}`,
      { cause: e },
    );
  }
}
