/** Chart point in SVG units, relative to the chart center. */
export interface ChartPoint {
  x: number;
  y: number;
}

/**
 * Radius of the elevation ring at `elevationDeg`: 0 at the zenith (chart
 * center), `radius` at the horizon (outer edge).
 */
export function elevationRingRadius(
  elevationDeg: number,
  radius: number,
): number {
  return (radius * (90 - elevationDeg)) / 90;
}

/**
 * Projects topocentric az/el to polar sky-chart coordinates relative to the
 * chart center: zenith at (0, 0), horizon at distance `radius`, north up
 * (negative y) and east to the right (positive x).
 */
export function projectSkyPoint(
  azimuthDeg: number,
  elevationDeg: number,
  radius: number,
): ChartPoint {
  const r = elevationRingRadius(elevationDeg, radius);
  const azRad = (azimuthDeg * Math.PI) / 180;
  return { x: r * Math.sin(azRad), y: -r * Math.cos(azRad) };
}
