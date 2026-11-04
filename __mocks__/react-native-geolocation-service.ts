/**
 * Jest manual mock for the native `react-native-geolocation-service`
 * module (RNFusedLocation TurboModule - jest must never load it). Mirrors
 * the real module shape (one default export object); tests set the
 * success/error behavior of `getCurrentPosition` per scenario (fix,
 * permission denied, GPS off, timeout). Placed in the root `__mocks__`
 * directory like the `react-native-svg` mock.
 */

const Geolocation = {
  getCurrentPosition: jest.fn(),
  watchPosition: jest.fn(),
  clearWatch: jest.fn(),
  stopObserving: jest.fn(),
  requestAuthorization: jest.fn(async () => 'granted'),
};

export default Geolocation;
