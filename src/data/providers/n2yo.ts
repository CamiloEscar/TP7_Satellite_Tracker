import type { ObserverGeodetic } from '../../orbital/types';
import type {
  Clock,
  HttpClient,
  SecretStore,
  ValidationPosition,
} from '../types';
import { DataError, systemClock } from '../types';
import type { RateLimiter } from '../rateLimiter';
import { asObject, asObjectArray, fieldNumber, requestJson } from './shared';

const BASE_URL = 'https://api.n2yo.com/rest/v1/satellite';
const MAX_SAMPLES = 300;

export interface N2yoProviderOptions {
  http: HttpClient;
  secrets: SecretStore;
  limiter: RateLimiter;
  clock?: Clock;
  /** Observer used for the az/el fields N2YO computes per sample. */
  observer: ObserverGeodetic;
}

/**
 * N2YO provider (validation mode B source, Hito 10). The API key is read ONLY
 * from the injected `SecretStore`; it is never hardcoded, logged, or included
 * in error messages.
 *
 * NOTE: `/positions` serves NOW-FORWARD samples only (first sample = current
 * UTC, one per second, max 300 s). Past timestamps cannot be resolved; the
 * returned sample is matched at the API's 1-second resolution (with 1 s of
 * tolerance for client/server clock skew).
 */
export class N2yoProvider {
  private readonly http: HttpClient;
  private readonly secrets: SecretStore;
  private readonly limiter: RateLimiter;
  private readonly clock: Clock;
  private readonly observer: ObserverGeodetic;

  constructor(options: N2yoProviderOptions) {
    this.http = options.http;
    this.secrets = options.secrets;
    this.limiter = options.limiter;
    this.clock = options.clock ?? systemClock;
    this.observer = options.observer;
  }

  async getValidationPosition(
    noradId: number,
    timestamp: Date,
  ): Promise<ValidationPosition> {
    const apiKey = await this.secrets.get('n2yo-api-key');
    if (!apiKey) {
      throw new DataError('DATA_AUTH', 'N2YO API key is not configured.');
    }
    const nowSec = Math.floor(this.clock.now() / 1000);
    const targetSec = Math.floor(timestamp.getTime() / 1000);
    if (targetSec < nowSec - 1) {
      throw new DataError(
        'DATA_NOT_FOUND',
        'N2YO serves now-forward samples only; past timestamps cannot be resolved.',
      );
    }
    // +2 s of slack absorbs client/server clock skew at the range edges.
    const seconds = Math.min(MAX_SAMPLES, Math.max(1, targetSec - nowSec + 2));
    const { latitudeDeg, longitudeDeg, altitudeKm } = this.observer;
    // The URL necessarily carries the key; it must never reach error output.
    const url =
      `${BASE_URL}/positions/${noradId}/` +
      `${latitudeDeg}/${longitudeDeg}/${altitudeKm * 1000}/${seconds}/` +
      `&apiKey=${apiKey}`;
    const raw = await requestJson(this.http, url, 'N2YO positions', {
      limiter: this.limiter,
      bucket: 'n2yo-positions',
    });
    const context = 'N2YO positions';
    const body = asObject(raw, context);
    const rows = asObjectArray(body.positions, context);
    let best: Record<string, unknown> | undefined;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (const row of rows) {
      const delta = Math.abs(
        fieldNumber(row, 'timestamp', context) - targetSec,
      );
      if (delta < bestDelta) {
        best = row;
        bestDelta = delta;
      }
    }
    if (!best || bestDelta > 1) {
      throw new DataError(
        'DATA_NOT_FOUND',
        `N2YO returned no position at the requested second (${targetSec}).`,
      );
    }
    return {
      noradId,
      timestamp: new Date(fieldNumber(best, 'timestamp', context) * 1000),
      latitudeDeg: fieldNumber(best, 'satlatitude', context),
      longitudeDeg: fieldNumber(best, 'satlongitude', context),
      altitudeKm: fieldNumber(best, 'sataltitude', context),
    };
  }
}
