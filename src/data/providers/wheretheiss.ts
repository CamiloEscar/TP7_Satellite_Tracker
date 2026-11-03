import type { HttpClient, TlePayload, ValidationPosition } from '../types';
import { DataError } from '../types';
import type { RateLimiter } from '../rateLimiter';
import {
  asObject,
  asObjectArray,
  fieldNumber,
  fieldString,
  requestJson,
} from './shared';

const BASE_URL = 'https://api.wheretheiss.at/v1/satellites/25544';

export interface WtiaProviderOptions {
  http: HttpClient;
  limiter: RateLimiter;
}

/**
 * Where The ISS at? provider (validation mode A source). Only tracks the ISS
 * (NORAD 25544); the API needs no auth and is limited to ~1 req/s.
 */
export class WtiaProvider {
  private readonly http: HttpClient;
  private readonly limiter: RateLimiter;

  constructor(options: WtiaProviderOptions) {
    this.http = options.http;
    this.limiter = options.limiter;
  }

  /** Downloads the TLE currently served by WTIA (`/tles`). */
  async getTle(): Promise<TlePayload> {
    const raw = await requestJson(this.http, `${BASE_URL}/tles`, 'WTIA tles', {
      limiter: this.limiter,
      bucket: 'wtia',
    });
    const row = asObject(raw, 'WTIA tles');
    return {
      line1: fieldString(row, 'line1', 'WTIA tles'),
      line2: fieldString(row, 'line2', 'WTIA tles'),
    };
  }

  /**
   * Reference position at an exact timestamp (`/positions?timestamps=`).
   * The endpoint echoes the requested epoch seconds, so the response row is
   * matched by EXACT timestamp; a missing match is `DATA_NOT_FOUND`.
   */
  async getValidationPosition(
    noradId: number,
    timestamp: Date,
  ): Promise<ValidationPosition> {
    if (noradId !== 25544) {
      throw new DataError(
        'DATA_NOT_FOUND',
        'WTIA only tracks the ISS (NORAD 25544).',
      );
    }
    const tsSec = Math.floor(timestamp.getTime() / 1000);
    const raw = await requestJson(
      this.http,
      `${BASE_URL}/positions?timestamps=${tsSec}`,
      'WTIA positions',
      { limiter: this.limiter, bucket: 'wtia' },
    );
    const rows = asObjectArray(raw, 'WTIA positions');
    const match = rows.find(
      row => fieldNumber(row, 'timestamp', 'WTIA positions') === tsSec,
    );
    if (!match) {
      throw new DataError(
        'DATA_NOT_FOUND',
        `WTIA returned no position for timestamp ${tsSec}.`,
      );
    }
    const context = 'WTIA positions';
    return {
      noradId,
      timestamp: new Date(fieldNumber(match, 'timestamp', context) * 1000),
      latitudeDeg: fieldNumber(match, 'latitude', context),
      longitudeDeg: fieldNumber(match, 'longitude', context),
      altitudeKm: fieldNumber(match, 'altitude', context),
    };
  }
}
