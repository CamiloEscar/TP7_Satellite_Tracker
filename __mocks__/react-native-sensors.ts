/**
 * Jest manual mock for the native `react-native-sensors` module
 * (TurboModule bridge - jest must never load it). `magnetometer` becomes a
 * controllable fake observable: tests push samples/errors through the
 * `__emit*` helpers. Placed in the root `__mocks__` directory like the
 * `react-native-svg` mock.
 */

export interface MockMagnetometerEvent {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

type MockMagnetometerHandlers = {
  next: (event: MockMagnetometerEvent) => void;
  error: (error: unknown) => void;
};

let handlers: MockMagnetometerHandlers | null = null;

export const magnetometer = {
  subscribe(next: MockMagnetometerHandlers) {
    handlers = next;
    return {
      unsubscribe: () => {
        if (handlers === next) {
          handlers = null;
        }
      },
    };
  },
};

export function __emitMagnetometer(x: number, y: number, z = 0): void {
  handlers?.next({ x, y, z, timestamp: 0 });
}

export function __emitMagnetometerError(error: unknown = 'no sensor'): void {
  handlers?.error(error);
}

export function __resetMagnetometer(): void {
  handlers = null;
}
