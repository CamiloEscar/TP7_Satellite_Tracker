import { OrbitalError, subpointAt } from '../orbital';
import type { Satrec } from '../orbital';

/**
 * WGS-84 mean Earth radius used by the footprint formula
 * (ARCHITECTURE.md §4). Units: km.
 */
export const EARTH_RADIUS_KM = 6371;

/** Latitude/longitude pair in degrees. */
export interface LatLon {
  latitudeDeg: number;
  longitudeDeg: number;
}

/** One ground-track sample: sub-satellite point at a UTC instant. */
export interface GroundTrackSample extends LatLon {
  timeUTC: Date;
}

/**
 * Samples the sub-satellite point every `stepSeconds` over a ±1 orbit window
 * around `centerUTC` (ARCHITECTURE.md §4). Batch computation: one synchronous
 * pass over a single satrec — the RN-friendly replacement for Web Workers.
 * Throws `OrbitalError` when propagation fails (e.g. decayed element set).
 */
export function sampleGroundTrack(
  satrec: Satrec,
  centerUTC: Date,
  stepSeconds = 60,
): GroundTrackSample[] {
  if (!Number.isFinite(stepSeconds) || stepSeconds <= 0) {
    throw new OrbitalError(
      'ORBIT_BAD_INPUT',
      'stepSeconds must be a positive finite number.',
    );
  }
  const stepMs = stepSeconds * 1000;
  // satellite.js keeps mean motion in rad/min: period = 2π / no.
  const periodMs = ((2 * Math.PI) / satrec.no) * 60000;
  const halfSteps = Math.round(periodMs / stepMs);
  const centerMs = centerUTC.getTime();
  const samples: GroundTrackSample[] = [];
  for (let i = -halfSteps; i <= halfSteps; i += 1) {
    const timeUTC = new Date(centerMs + i * stepMs);
    const subpoint = subpointAt(satrec, timeUTC);
    samples.push({
      latitudeDeg: subpoint.latitudeDeg,
      longitudeDeg: subpoint.longitudeDeg,
      timeUTC,
    });
  }
  return samples;
}

/**
 * Splits a polyline wherever consecutive longitudes jump more than 180°
 * (antimeridian cut, ARCHITECTURE.md §4). Each returned segment is a
 * continuous polyline; render one map polyline per segment.
 */
export function splitAtAntimeridian(points: readonly LatLon[]): LatLon[][] {
  const segments: LatLon[][] = [];
  let current: LatLon[] = [];
  for (const point of points) {
    const previous = current[current.length - 1];
    if (
      previous &&
      Math.abs(point.longitudeDeg - previous.longitudeDeg) > 180
    ) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length > 0) {
    segments.push(current);
  }
  return segments;
}

/**
 * Footprint ground radius (ARCHITECTURE.md §4):
 * angular radius γ = acos((Re / (Re + h)) · cos θ) − θ with θ = configurable
 * minimum elevation; linear radius = Re · γ.
 * Units: km from degrees and km. Clamped so degenerate inputs (negative
 * altitude, extreme elevation) cannot produce NaN/negative radii on the map.
 */
export function footprintRadiusKm(
  altitudeKm: number,
  minElevationDeg: number,
): number {
  const thetaRad = (minElevationDeg * Math.PI) / 180;
  const argument =
    (EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altitudeKm)) * Math.cos(thetaRad);
  const gammaRad = Math.acos(Math.min(1, Math.max(-1, argument))) - thetaRad;
  return Math.max(0, EARTH_RADIUS_KM * gammaRad);
}
