/**
 * Pure compass math: degree normalization, 8-point cardinal labels,
 * magnetic-declination correction and magnetometer heading.
 *
 * Heading convention (Android magnetometer, device frame): X right, Y top,
 * Z out of the screen. With the device held flat, the magnetic heading of
 * the device top is `atan2(-x, y)` in degrees, normalized to [0, 360).
 *
 * Limitations (documented, out of scope):
 * - Flat-device assumption: tilt compensation is not implemented; holding
 *   the device at an angle skews the heading.
 * - No soft-iron/hard-iron calibration; raw sensor values are used.
 *
 * Magnetic declination: positive east of true north.
 * `true = (magnetic + declination + 360) % 360`. Default -10 deg
 * (Buenos Aires).
 */

/** Normalizes any degree value to [0, 360). */
export function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

const CARDINAL_LABELS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/**
 * 8-point cardinal label: N centered on 0 deg, 45 deg sectors with
 * boundaries at 22.5 + k * 45. The boundary angle belongs to the sector
 * clockwise of it (22.5 -> NE).
 */
export function cardinalLabel(
  azimuthDeg: number,
): (typeof CARDINAL_LABELS)[number] {
  const sector = Math.floor((normalizeDeg(azimuthDeg) + 22.5) / 45) % 8;
  return CARDINAL_LABELS[sector];
}

/**
 * True heading from a magnetic compass heading. Declination is positive
 * east; the +360 handles one wrap for inputs in the validated ranges
 * (magnetic [0, 360), declination [-180, 180]).
 */
export function trueHeadingFromMagnetic(
  magneticHeadingDeg: number,
  declinationDeg: number,
): number {
  return (magneticHeadingDeg + declinationDeg + 360) % 360;
}

/**
 * Magnetic heading of the device top from magnetometer readings (any unit,
 * only the x/y ratio matters). Flat-device assumption - see file header.
 */
export function headingFromMagnetometer(x: number, y: number): number {
  return normalizeDeg((Math.atan2(-x, y) * 180) / Math.PI);
}
