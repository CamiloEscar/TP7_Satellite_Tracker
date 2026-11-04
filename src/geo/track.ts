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

/**
 * GeoJSON position in degrees: `[longitude, latitude]` — GeoJSON axis order,
 * the OPPOSITE of the named `LatLon` fields used elsewhere in this module.
 */
export type GeoJsonPosition = [longitudeDeg: number, latitudeDeg: number];

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

/**
 * Geodesic footprint circle as a closed GeoJSON polygon ring on the sphere
 * (destination-point formula: each vertex lies `radiusKm` from the center at
 * successive bearings). Returns `segments + 1` positions — `segments` vertices
 * plus an exact closing copy of the first one. Positions are in GeoJSON order
 * (`GeoJsonPosition`), NOT the `LatLon` order used by the track functions.
 * Longitudes wrap to [-180, 180] so the ring stays valid GeoJSON.
 */
export function footprintPolygonKm(
  centerLatDeg: number,
  centerLonDeg: number,
  radiusKm: number,
  segments = 64,
): GeoJsonPosition[] {
  if (!Number.isInteger(segments) || segments < 3) {
    throw new OrbitalError(
      'ORBIT_BAD_INPUT',
      'segments must be an integer >= 3.',
    );
  }
  const lat1 = (centerLatDeg * Math.PI) / 180;
  const lon1 = (centerLonDeg * Math.PI) / 180;
  const delta = radiusKm / EARTH_RADIUS_KM; // angular distance (rad)
  const ring: GeoJsonPosition[] = [];
  for (let i = 0; i < segments; i += 1) {
    const theta = (2 * Math.PI * i) / segments; // bearing (rad)
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(delta) +
        Math.cos(lat1) * Math.sin(delta) * Math.cos(theta),
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(theta) * Math.sin(delta) * Math.cos(lat1),
        Math.cos(delta) - Math.sin(lat1) * Math.sin(lat2),
      );
    const lonDeg = (((lon2 * 180) / Math.PI + 540) % 360) - 180;
    ring.push([lonDeg, (lat2 * 180) / Math.PI]);
  }
  ring.push(ring[0]); // exact closing vertex
  return ring;
}
