import { magnetometer } from 'react-native-sensors';
import { headingFromMagnetometer, normalizeDeg } from './compass';

/**
 * Heading-source seam: a `HeadingSource` reports the raw *magnetic*
 * heading of the device; the declination-corrected true heading is derived
 * at render time with `trueHeadingFromMagnetic`. When the reading is
 * 'unavailable' the UI falls back to `ManualHeadingSource`.
 */

export type HeadingReading =
  | { status: 'starting' }
  | { status: 'ok'; magneticHeadingDeg: number }
  | { status: 'unavailable' };

type HeadingListener = (reading: HeadingReading) => void;

export interface HeadingSource {
  getReading(): HeadingReading;
  subscribe(listener: HeadingListener): () => void;
}

/** Magnetometer sample (device frame: X right, Y top, Z out). */
export interface MagnetometerEvent {
  x: number;
  y: number;
  z: number;
  timestamp: number;
}

/** Minimal structural view of the `react-native-sensors` observable. */
export interface MagnetometerObservable {
  subscribe(handlers: {
    next: (event: MagnetometerEvent) => void;
    error: (error: unknown) => void;
  }): { unsubscribe: () => void };
}

/**
 * Heading source over the device magnetometer. The observable is opened on
 * the first subscriber and closed when the last one leaves, so the sensor
 * is not polled while the compass overlay is closed.
 */
// ponytail: single observable bridge per instance; good enough for one
// overlay. Add per-listener batching if more consumers appear.
export class MagnetometerHeadingSource implements HeadingSource {
  private reading: HeadingReading = { status: 'starting' };
  private readonly listeners = new Set<HeadingListener>();
  private subscription: { unsubscribe: () => void } | null = null;

  constructor(
    private readonly observable: MagnetometerObservable = magnetometer,
  ) {}

  getReading = (): HeadingReading => this.reading;

  subscribe = (listener: HeadingListener): (() => void) => {
    this.listeners.add(listener);
    if (!this.subscription) {
      this.subscription = this.observable.subscribe({
        next: event =>
          this.update({
            status: 'ok',
            magneticHeadingDeg: headingFromMagnetometer(event.x, event.y),
          }),
        error: () => this.update({ status: 'unavailable' }),
      });
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.subscription) {
        this.subscription.unsubscribe();
        this.subscription = null;
      }
    };
  };

  private update(reading: HeadingReading): void {
    this.reading = reading;
    for (const listener of this.listeners) {
      listener(reading);
    }
  }
}

/**
 * Manual heading fallback: the user enters the magnetic heading directly
 * (degrees). Starts 'unavailable' until a value is set.
 */
// ponytail: in-memory value only - not persisted (see the config store).
export class ManualHeadingSource implements HeadingSource {
  private reading: HeadingReading = { status: 'unavailable' };
  private readonly listeners = new Set<HeadingListener>();

  getReading = (): HeadingReading => this.reading;

  subscribe = (listener: HeadingListener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Sets the magnetic heading in degrees (normalized to [0, 360)). */
  setHeading(magneticHeadingDeg: number): void {
    this.reading = {
      status: 'ok',
      magneticHeadingDeg: normalizeDeg(magneticHeadingDeg),
    };
    for (const listener of this.listeners) {
      listener(this.reading);
    }
  }
}
