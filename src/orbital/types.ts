import type { OMMJsonObject, SatRec } from 'satellite.js';

/**
 * OMM/JSON element set (CCSDS OMM v3 subset accepted by satellite.js).
 * Primary orbital data format of the app; TLE is a legacy fallback.
 */
export type OmmJson = OMMJsonObject;

/**
 * Opaque SGP4 element record produced by the engine's factory functions.
 * Alias of satellite.js `SatRec` so consumers never import the library directly.
 */
export type Satrec = SatRec;

/** Observer location on the WGS-84 ellipsoid. Units: degrees / km. */
export interface ObserverGeodetic {
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
}

/** Sub-satellite point (geodetic). Longitude normalized to (-180, 180]. Units: degrees / km. */
export interface SubpointResult {
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
}

/** Topocentric look angles from the observer to the satellite. Azimuth in [0, 360). */
export interface LookAnglesResult {
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
}

/** Earth-Centered Inertial state vector (TEME frame). Units: km / km/s. */
export interface EciResult {
  positionKm: { x: number; y: number; z: number };
  velocityKmPerS: { x: number; y: number; z: number };
}

/** Typed error codes of the orbital engine. Raw library errors never cross this boundary. */
export type OrbitalErrorCode =
  | 'ORBIT_BAD_INPUT'
  | 'ORBIT_DECAYED'
  | 'ORBIT_PROPAGATION_FAILED';
