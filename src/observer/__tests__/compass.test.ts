/**
 * Pure compass math: degree normalization, cardinal labels at sector
 * boundaries, declination correction with wrap-around, and magnetometer
 * heading for the four cardinal device orientations (flat device).
 */

import {
  cardinalLabel,
  headingFromMagnetometer,
  normalizeDeg,
  trueHeadingFromMagnetic,
} from '../compass';

describe('normalizeDeg', () => {
  it('keeps values already in range', () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(180)).toBe(180);
    expect(normalizeDeg(359.9)).toBeCloseTo(359.9);
  });

  it('wraps values outside [0, 360)', () => {
    expect(normalizeDeg(360)).toBe(0);
    expect(normalizeDeg(-10)).toBe(350);
    expect(normalizeDeg(725)).toBe(5);
    expect(normalizeDeg(-370)).toBe(350);
  });
});

describe('cardinalLabel', () => {
  it('labels the sector boundaries (N centered on 0 deg, 45 deg sectors)', () => {
    expect(cardinalLabel(0)).toBe('N');
    expect(cardinalLabel(22.5)).toBe('NE');
    expect(cardinalLabel(45)).toBe('NE');
    expect(cardinalLabel(67.5)).toBe('E');
    expect(cardinalLabel(112.5)).toBe('SE');
    expect(cardinalLabel(157.5)).toBe('S');
    expect(cardinalLabel(202.5)).toBe('SW');
    expect(cardinalLabel(247.5)).toBe('W');
    expect(cardinalLabel(292.5)).toBe('NW');
    expect(cardinalLabel(337.5)).toBe('N');
    expect(cardinalLabel(360)).toBe('N');
  });

  it('labels mid-sector angles', () => {
    expect(cardinalLabel(10)).toBe('N');
    expect(cardinalLabel(90)).toBe('E');
    expect(cardinalLabel(180)).toBe('S');
    expect(cardinalLabel(350)).toBe('N');
    expect(cardinalLabel(-45)).toBe('NW');
  });
});

describe('trueHeadingFromMagnetic', () => {
  it('applies the declination (positive east)', () => {
    expect(trueHeadingFromMagnetic(100, 0)).toBe(100);
    expect(trueHeadingFromMagnetic(100, 5)).toBe(105);
    expect(trueHeadingFromMagnetic(100, -5)).toBe(95);
  });

  it('wraps around 360 in both directions', () => {
    expect(trueHeadingFromMagnetic(5, -10)).toBe(355);
    expect(trueHeadingFromMagnetic(350, 20)).toBe(10);
    expect(trueHeadingFromMagnetic(0, -10)).toBe(350);
    expect(trueHeadingFromMagnetic(355, 10)).toBe(5);
  });
});

describe('headingFromMagnetometer', () => {
  // Device frame: X right, Y top. A sample along +Y means the device top
  // points to magnetic north (heading 0); along -X means it points east.
  it('gives 0 deg when the device top points north', () => {
    expect(headingFromMagnetometer(0, 1)).toBeCloseTo(0);
  });

  it('gives 90 deg when the device top points east', () => {
    expect(headingFromMagnetometer(-1, 0)).toBeCloseTo(90);
  });

  it('gives 180 deg when the device top points south', () => {
    expect(headingFromMagnetometer(0, -1)).toBeCloseTo(180);
  });

  it('gives 270 deg when the device top points west', () => {
    expect(headingFromMagnetometer(1, 0)).toBeCloseTo(270);
  });
});
