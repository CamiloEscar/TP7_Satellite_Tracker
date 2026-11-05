import type { OmmJson } from '../orbital/types';

/** Catalog classification used by the constellation filters (RF-08). */
export type CatalogGroup = 'starlink' | 'iss' | 'gps-ops' | 'weather' | 'other';

/** One row of the satellite catalog. */
export interface CatalogEntry {
  noradId: number;
  name: string;
  group: CatalogGroup;
}

/** Origin of an orbital element set. */
export type OrbitalSource = 'celestrak-gp' | 'celestrak-supgp' | 'spacetrack';

/** Legacy two-line element set payload (fallback format only). */
export interface TlePayload {
  line1: string;
  line2: string;
}

interface OrbitalRecordBase {
  noradId: number;
  name: string;
  source: OrbitalSource;
  /** Element-set epoch as a UTC instant. */
  epoch: Date;
  /** UTC instant of the download that produced this record. */
  fetchedAt: Date;
}

/** OMM/JSON element set (primary format). */
export interface OmmOrbitalRecord extends OrbitalRecordBase {
  format: 'omm';
  payload: OmmJson;
}

/** Legacy TLE element set (fallback format). */
export interface TleOrbitalRecord extends OrbitalRecordBase {
  format: 'tle';
  payload: TlePayload;
}

/**
 * Orbital element set downloaded from a provider. Discriminated on `format`;
 * OMM/JSON is primary, TLE is legacy fallback only.
 */
export type OrbitalRecord = OmmOrbitalRecord | TleOrbitalRecord;

/** Reference satellite position used by the validation mode (RF-15). Units: degrees / km. */
export interface ValidationPosition {
  noradId: number;
  timestamp: Date;
  latitudeDeg: number;
  longitudeDeg: number;
  altitudeKm: number;
  /** Topocentric azimuth computed by the source for its observer (N2YO only). */
  azimuthDeg?: number;
  /** Topocentric elevation computed by the source for its observer (N2YO only). */
  elevationDeg?: number;
}

/**
 * Source-specific validation position selector (Hito 10). Mode A needs the
 * WTIA samples (same-TLE method), mode B the N2YO ones (az/el); the source
 * identity is part of the evidence, so there is NO cross-fallback here.
 */
export type ValidationPositionSource = 'wtia' | 'n2yo';

/**
 * Contract of the data layer (RF-14). `DataOrchestrator` implements it over
 * the provider set with cache + fallback; individual providers implement only
 * the methods that make sense for their API.
 */
export interface DataProvider {
  getCatalog(): Promise<CatalogEntry[]>;
  getOrbitalData(noradId: number): Promise<OrbitalRecord>;
  getValidationPosition(
    noradId: number,
    timestamp: Date,
  ): Promise<ValidationPosition>;
  /**
   * Element set the validation mode A propagates on BOTH sides (WTIA `/tles`).
   * Optional: only the validation position chain exposes it.
   */
  getValidationTle?(): Promise<TlePayload>;
  /**
   * Source-specific validation position (Hito 10). Optional: unlike
   * `getValidationPosition` there is NO cross-fallback - the source identity
   * ('wtia' | 'n2yo') is part of the validation evidence.
   */
  getValidationPositionFrom?(
    source: ValidationPositionSource,
    noradId: number,
    timestamp: Date,
  ): Promise<ValidationPosition>;
}

/**
 * Typed error codes of the data layer. Raw HTTP/library errors never cross
 * this boundary and error messages must never contain credentials.
 */
export type DataErrorCode =
  | 'DATA_NETWORK'
  | 'DATA_RATE_LIMITED'
  | 'DATA_PARSE'
  | 'DATA_AUTH'
  | 'DATA_NOT_FOUND'
  | 'DATA_ALL_PROVIDERS_FAILED';

/**
 * Typed error of the data layer. `code` is the stable machine-readable
 * discriminator; `retryAfterMs` carries a server-provided Retry-After hint
 * (429 responses) for `withRetry`.
 */
export class DataError extends Error {
  readonly code: DataErrorCode;
  readonly retryAfterMs?: number;

  constructor(
    code: DataErrorCode,
    message: string,
    options?: ErrorOptions & { retryAfterMs?: number },
  ) {
    super(message, options);
    this.name = 'DataError';
    this.code = code;
    this.retryAfterMs = options?.retryAfterMs;
  }
}

/** Maps an HTTP status code to a typed `DataError` (never embeds URLs). */
export function dataErrorFromStatus(
  status: number,
  context: string,
  retryAfterMs?: number,
): DataError {
  if (status === 429) {
    return new DataError(
      'DATA_RATE_LIMITED',
      `${context}: rate limited (429).`,
      {
        retryAfterMs,
      },
    );
  }
  if (status === 401 || status === 403) {
    return new DataError(
      'DATA_AUTH',
      `${context}: authentication failed (${status}).`,
    );
  }
  if (status === 404) {
    return new DataError('DATA_NOT_FOUND', `${context}: not found (404).`);
  }
  if (status >= 400 && status < 500) {
    return new DataError(
      'DATA_PARSE',
      `${context}: rejected request (${status}).`,
    );
  }
  return new DataError(
    'DATA_NETWORK',
    `${context}: request failed with status ${status}.`,
  );
}

/** Catalog snapshot as stored by a `CacheStore`. */
export interface CatalogSnapshot {
  entries: CatalogEntry[];
  /** UTC instant of the download that produced the snapshot. */
  fetchedAt: Date;
}

/**
 * Persistence port for the TTL cache (in-memory vs op-sqlite implementations).
 * Timestamps are UTC instants; the store carries no TTL logic.
 */
export interface CacheStore {
  getCatalogSnapshot(): Promise<CatalogSnapshot | null>;
  setCatalogSnapshot(snapshot: CatalogSnapshot): Promise<void>;
  getOrbitalRecord(noradId: number): Promise<OrbitalRecord | null>;
  setOrbitalRecord(record: OrbitalRecord): Promise<void>;
}

/** Secret identifiers. Values must never reach code, logs, or error messages. */
export type SecretKey =
  | 'n2yo-api-key'
  | 'spacetrack-identity'
  | 'spacetrack-password';

/** Secrets port (Keychain-backed in a later hito; in-memory fake in tests). */
export interface SecretStore {
  get(key: SecretKey): Promise<string | null>;
}

export interface HttpRequestInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Minimal fetch-like response. `headers` uses lowercased keys so callers can
 * read `retry-after` (and similar) without a Headers implementation.
 */
export interface HttpResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

/** Fetch-like seam (real fetch in the app, fakes in tests). */
export type HttpClient = (
  url: string,
  init?: HttpRequestInit,
) => Promise<HttpResponse>;

/** Time source seam so TTL/rate-limit logic is testable without real timers. */
export interface Clock {
  /** Milliseconds since the Unix epoch (UTC). */
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};
