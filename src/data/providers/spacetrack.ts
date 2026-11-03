import type {
  CatalogEntry,
  Clock,
  HttpClient,
  HttpRequestInit,
  HttpResponse,
  OrbitalRecord,
  SecretStore,
} from '../types';
import { DataError, systemClock } from '../types';
import type { RateLimiter } from '../rateLimiter';
import {
  asObjectArray,
  classifyCatalogGroup,
  parseGpRecord,
  requestJson,
} from './shared';

const LOGIN_URL = 'https://www.space-track.org/ajaxauth/login';
const QUERY_BASE_URL = 'https://www.space-track.org/basicspacedata/query';

// GP retrieval policy from Space-Track: at most 1 GP pull/hour and only
// propagable ephemerides for on-orbit objects (decay_date null-val,
// epoch > now-10). The fallback catalog is the on-orbit payload set because
// Space-Track has no equivalent of the CelesTrak GROUPs.
const CATALOG_QUERY =
  'class/gp/OBJECT_TYPE/PAYLOAD/DECAY_DATE/null-val/EPOCH/%3Enow-10/orderby/NORAD_CAT_ID/format/json';

export interface SpaceTrackProviderOptions {
  http: HttpClient;
  secrets: SecretStore;
  limiter: RateLimiter;
  clock?: Clock;
}

/**
 * Space-Track fallback provider (login + GP queries). Credentials come ONLY
 * from the injected `SecretStore` and never appear in code, logs, or error
 * messages. The session cookie from the login response is carried by the
 * platform cookie jar (RN/OkHttp persists Set-Cookie in memory) on subsequent
 * queries; on a 401 the provider re-logs-in once and retries the query once.
 *
 * ponytail: session cookie delegated to the platform cookie jar; if a stack
 * drops cookies, capture Set-Cookie from the login response and send a Cookie
 * header manually (upgrade path: expose response headers capture here).
 */
export class SpaceTrackProvider {
  private readonly http: HttpClient;
  private readonly secrets: SecretStore;
  private readonly limiter: RateLimiter;
  private readonly clock: Clock;
  private loggedIn = false;

  constructor(options: SpaceTrackProviderOptions) {
    this.http = options.http;
    this.secrets = options.secrets;
    this.limiter = options.limiter;
    this.clock = options.clock ?? systemClock;
  }

  /** Fallback catalog: current on-orbit payloads from the GP class. */
  async getCatalog(): Promise<CatalogEntry[]> {
    const rows = await this.query(CATALOG_QUERY);
    const fetchedAt = new Date(this.clock.now());
    return asObjectArray(rows, 'Space-Track GP').map(row => {
      const record = parseGpRecord(row, 'spacetrack', fetchedAt);
      return {
        noradId: record.noradId,
        name: record.name,
        group: classifyCatalogGroup(record.noradId, record.name, record.source),
      };
    });
  }

  /** Fallback per-satellite element set (OMM when present, legacy TLE else). */
  async getOrbitalData(noradId: number): Promise<OrbitalRecord> {
    const rows = await this.query(
      `class/gp/NORAD_CAT_ID/${noradId}/format/json`,
    );
    const fetchedAt = new Date(this.clock.now());
    const records = asObjectArray(rows, 'Space-Track GP').map(row =>
      parseGpRecord(row, 'spacetrack', fetchedAt),
    );
    const record = records.find(r => r.noradId === noradId);
    if (!record) {
      throw new DataError(
        'DATA_NOT_FOUND',
        `Space-Track has no GP data for NORAD ${noradId}.`,
      );
    }
    return record;
  }

  private async query(path: string): Promise<unknown> {
    try {
      return await this.queryOnce(path);
    } catch (e) {
      // Session expired (or never established): re-login once and retry once.
      if (e instanceof DataError && e.code === 'DATA_AUTH') {
        this.loggedIn = false;
        await this.login();
        return this.queryOnce(path);
      }
      throw e;
    }
  }

  private async queryOnce(path: string): Promise<unknown> {
    await this.ensureSession();
    return requestJson(
      this.http,
      `${QUERY_BASE_URL}/${path}`,
      'Space-Track query',
      {
        limiter: this.limiter,
        bucket: 'spacetrack',
      },
    );
  }

  private async ensureSession(): Promise<void> {
    if (!this.loggedIn) {
      await this.login();
    }
  }

  private async login(): Promise<void> {
    const identity = await this.secrets.get('spacetrack-identity');
    const password = await this.secrets.get('spacetrack-password');
    if (!identity || !password) {
      throw new DataError(
        'DATA_AUTH',
        'Space-Track credentials are not configured.',
      );
    }
    const init: HttpRequestInit = {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:
        `identity=${encodeURIComponent(identity)}` +
        `&password=${encodeURIComponent(password)}`,
    };
    let response: HttpResponse;
    try {
      response = await this.http(LOGIN_URL, init);
    } catch {
      // No `cause` here: transport errors can echo the request body.
      throw new DataError(
        'DATA_NETWORK',
        'Space-Track login: network failure.',
      );
    }
    if (!response.ok) {
      throw new DataError(
        'DATA_AUTH',
        `Space-Track login failed (status ${response.status}).`,
      );
    }
    this.loggedIn = true;
  }
}
