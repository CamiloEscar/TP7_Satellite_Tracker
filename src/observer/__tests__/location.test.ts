/**
 * Manual lat/lon/alt validation (bounds mirror `lookAnglesAt`) and GPS
 * error-code mapping (react-native-geolocation-service codes 1/2/3).
 */

import {
  gpsErrorToResult,
  gpsPositionToResult,
  parseManualLocation,
} from '../location';

describe('parseManualLocation', () => {
  it('accepts in-range values and builds the observer', () => {
    const result = parseManualLocation({
      latitudeDeg: '-34.6037',
      longitudeDeg: '-58.3816',
      altitudeKm: '0.025',
    });
    expect(result).toEqual({
      status: 'ok',
      observer: {
        latitudeDeg: -34.6037,
        longitudeDeg: -58.3816,
        altitudeKm: 0.025,
      },
    });
  });

  it('accepts the inclusive bounds (lat +-90, lon +-180, alt -1..100 km)', () => {
    expect(
      parseManualLocation({
        latitudeDeg: '90',
        longitudeDeg: '180',
        altitudeKm: '100',
      }).status,
    ).toBe('ok');
    expect(
      parseManualLocation({
        latitudeDeg: '-90',
        longitudeDeg: '-180',
        altitudeKm: '-1',
      }).status,
    ).toBe('ok');
  });

  it('rejects out-of-range latitude', () => {
    expect(
      parseManualLocation({
        latitudeDeg: '90.1',
        longitudeDeg: '0',
        altitudeKm: '0',
      }),
    ).toEqual({ status: 'invalid', field: 'latitude' });
    expect(
      parseManualLocation({
        latitudeDeg: '-91',
        longitudeDeg: '0',
        altitudeKm: '0',
      }),
    ).toEqual({ status: 'invalid', field: 'latitude' });
  });

  it('rejects out-of-range longitude', () => {
    expect(
      parseManualLocation({
        latitudeDeg: '0',
        longitudeDeg: '180.1',
        altitudeKm: '0',
      }),
    ).toEqual({ status: 'invalid', field: 'longitude' });
  });

  it('rejects out-of-range altitude', () => {
    expect(
      parseManualLocation({
        latitudeDeg: '0',
        longitudeDeg: '0',
        altitudeKm: '100.1',
      }),
    ).toEqual({ status: 'invalid', field: 'altitude' });
    expect(
      parseManualLocation({
        latitudeDeg: '0',
        longitudeDeg: '0',
        altitudeKm: '-1.1',
      }),
    ).toEqual({ status: 'invalid', field: 'altitude' });
  });

  it('rejects empty and non-numeric fields', () => {
    expect(
      parseManualLocation({
        latitudeDeg: '',
        longitudeDeg: '0',
        altitudeKm: '0',
      }),
    ).toEqual({ status: 'invalid', field: 'latitude' });
    expect(
      parseManualLocation({
        latitudeDeg: 'abc',
        longitudeDeg: '0',
        altitudeKm: '0',
      }),
    ).toEqual({ status: 'invalid', field: 'latitude' });
    expect(
      parseManualLocation({
        latitudeDeg: '0',
        longitudeDeg: '',
        altitudeKm: '0',
      }),
    ).toEqual({ status: 'invalid', field: 'longitude' });
    expect(
      parseManualLocation({
        latitudeDeg: '0',
        longitudeDeg: '0',
        altitudeKm: 'abc',
      }),
    ).toEqual({ status: 'invalid', field: 'altitude' });
  });
});

describe('gpsErrorToResult', () => {
  it('maps code 1 to permission_denied', () => {
    expect(gpsErrorToResult(1)).toEqual({ status: 'permission_denied' });
  });

  it('maps code 2 to position_unavailable (GPS off)', () => {
    expect(gpsErrorToResult(2)).toEqual({ status: 'position_unavailable' });
  });

  it('maps code 3 to timeout (no signal)', () => {
    expect(gpsErrorToResult(3)).toEqual({ status: 'timeout' });
  });

  it('maps unknown codes to position_unavailable', () => {
    expect(gpsErrorToResult(4)).toEqual({ status: 'position_unavailable' });
    expect(gpsErrorToResult(-1)).toEqual({ status: 'position_unavailable' });
  });
});

describe('gpsPositionToResult', () => {
  it('converts the GPS fix (altitude in meters) into the observer', () => {
    expect(gpsPositionToResult(-34.6037, -58.3816, 25)).toEqual({
      status: 'ok',
      observer: {
        latitudeDeg: -34.6037,
        longitudeDeg: -58.3816,
        altitudeKm: 0.025,
      },
    });
  });

  it('treats a missing (null) altitude as sea level', () => {
    expect(gpsPositionToResult(1, 2, null)).toEqual({
      status: 'ok',
      observer: { latitudeDeg: 1, longitudeDeg: 2, altitudeKm: 0 },
    });
  });
});
