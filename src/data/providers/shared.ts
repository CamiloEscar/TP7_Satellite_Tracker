import type { OmmJson } from '../../orbital/types';
import type {
  CatalogGroup,
  HttpClient,
  HttpRequestInit,
  HttpResponse,
  OmmOrbitalRecord,
  OrbitalRecord,
  OrbitalSource,
  TleOrbitalRecord,
} from '../types';
import { DataError, dataErrorFromStatus } from '../types';
import type { RateLimiter } from '../rateLimiter';
import { retryAfterMsFromHeaders, withRetry } from '../rateLimiter';

// --- Response shape helpers ----------------------------------------------------

function parseError(message: string): DataError {
  return new DataError('DATA_PARSE', message);
}

export function asObject(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw parseError(`${context}: expected a JSON object.`);
  }
  return value as Record<string, unknown>;
}

export function asObjectArray(
  value: unknown,
  context: string,
): Record<string, unknown>[] {
  const rows = Array.isArray(value) ? value : [value];
  return rows.map(row => asObject(row, context));
}

export function fieldString(
  row: Record<string, unknown>,
  field: string,
  context: string,
): string {
  const value = row[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw parseError(
      `${context}: field "${field}" must be a non-empty string.`,
    );
  }
  return value;
}

/** Reads a numeric field that sources may encode as string or number. */
export function fieldNumber(
  row: Record<string, unknown>,
  field: string,
  context: string,
): number {
  const value = row[field];
  const num = typeof value === 'number' ? value : Number(value);
  if (value === null || value === undefined || !Number.isFinite(num)) {
    throw parseError(`${context}: field "${field}" must be numeric.`);
  }
  return num;
}

/**
 * Reads an optional numeric field: absent/null means "the source does not
 * provide it" (no error), a present value goes through `fieldNumber`.
 */
export function optionalFieldNumber(
  row: Record<string, unknown>,
  field: string,
  context: string,
): number | undefined {
  const value = row[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  return fieldNumber(row, field, context);
}

// --- Epoch / record parsing ----------------------------------------------------

/**
 * Parses an OMM `EPOCH` string as a UTC instant. The OMM spec allows
 * sub-millisecond fractions and leaves the zone designator optional (UTC is
 * implied); both are normalized so `Date.parse` is unambiguous in every JS
 * engine (without a zone designator it would parse as local time).
 */
export function parseEpochUtc(raw: string): Date {
  const iso = raw.replace(/(\.\d{3})\d+/, '$1');
  const withZone = /Z|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
  const ms = Date.parse(withZone);
  if (Number.isNaN(ms)) {
    throw parseError(`Invalid OMM EPOCH value: ${raw}`);
  }
  return new Date(ms);
}

/** Epoch embedded in TLE line 1 (cols 19-32: YY + day-of-year, UTC). */
function tleEpoch(line1: string): Date {
  const yy = Number(line1.substring(18, 20));
  const doy = Number(line1.substring(20, 32));
  if (!Number.isFinite(yy) || !Number.isFinite(doy)) {
    throw parseError('Invalid TLE epoch in line 1.');
  }
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return new Date(Date.UTC(year, 0, 1) + (doy - 1) * 86400000);
}

const OMM_NUMERIC_FIELDS = [
  'NORAD_CAT_ID',
  'MEAN_MOTION',
  'ECCENTRICITY',
  'INCLINATION',
  'RA_OF_ASC_NODE',
  'ARG_OF_PERICENTER',
  'MEAN_ANOMALY',
  'ELEMENT_SET_NO',
  'BSTAR',
  'MEAN_MOTION_DOT',
  'MEAN_MOTION_DDOT',
] as const;

/**
 * Validates one CCSDS OMM JSON object and maps it to an `OrbitalRecord`.
 * Numeric fields may arrive as strings (Space-Track) or numbers (CelesTrak).
 */
export function parseOmmRecord(
  raw: unknown,
  source: OrbitalSource,
  fetchedAt: Date,
): OmmOrbitalRecord {
  const context = 'OMM record';
  const row = asObject(raw, context);
  const name = fieldString(row, 'OBJECT_NAME', context);
  const epoch = parseEpochUtc(fieldString(row, 'EPOCH', context));
  for (const field of OMM_NUMERIC_FIELDS) {
    fieldNumber(row, field, context);
  }
  return {
    format: 'omm',
    noradId: fieldNumber(row, 'NORAD_CAT_ID', context),
    name,
    source,
    payload: row as unknown as OmmJson,
    epoch,
    fetchedAt,
  };
}

/**
 * Validates one GP row that carries only legacy TLE lines and maps it to a
 * TLE `OrbitalRecord` (fallback format).
 */
export function parseTleRecord(
  raw: unknown,
  source: OrbitalSource,
  fetchedAt: Date,
): TleOrbitalRecord {
  const context = 'GP TLE row';
  const row = asObject(raw, context);
  const line1 = fieldString(row, 'TLE_LINE1', context);
  const line2 = fieldString(row, 'TLE_LINE2', context);
  if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
    throw parseError(`${context}: TLE lines must start with "1 " and "2 ".`);
  }
  return {
    format: 'tle',
    noradId: fieldNumber(row, 'NORAD_CAT_ID', context),
    name: typeof row.OBJECT_NAME === 'string' ? row.OBJECT_NAME : '',
    source,
    payload: { line1, line2 },
    epoch: tleEpoch(line1),
    fetchedAt,
  };
}

/**
 * Maps one GP row (OMM or legacy TLE) to an `OrbitalRecord`.
 */
export function parseGpRecord(
  raw: unknown,
  source: OrbitalSource,
  fetchedAt: Date,
): OrbitalRecord {
  const row = asObject(raw, 'GP row');
  const looksLikeTle =
    typeof row.TLE_LINE1 === 'string' &&
    typeof row.MEAN_MOTION !== 'number' &&
    typeof row.MEAN_MOTION !== 'string';
  return looksLikeTle
    ? parseTleRecord(row, source, fetchedAt)
    : parseOmmRecord(row, source, fetchedAt);
}

const ISS_NORAD_ID = 25544;

/**
 * Catalog classification (RF-08): SupGP Starlink download -> 'starlink';
 * NORAD 25544 or name containing "ISS" -> 'iss'; gps-ops/weather/starlink
 * query group -> that group; everything else -> 'other'.
 */
export function classifyCatalogGroup(
  noradId: number,
  name: string,
  source: OrbitalSource,
  queryGroup?: string,
): CatalogGroup {
  if (source === 'celestrak-supgp') {
    return 'starlink';
  }
  if (noradId === ISS_NORAD_ID || name.toUpperCase().includes('ISS')) {
    return 'iss';
  }
  if (
    queryGroup === 'gps-ops' ||
    queryGroup === 'weather' ||
    queryGroup === 'starlink'
  ) {
    return queryGroup;
  }
  return 'other';
}

// --- HTTP helper ----------------------------------------------------------------

export interface RequestJsonOptions {
  init?: HttpRequestInit;
  limiter?: RateLimiter;
  bucket?: string;
}

/**
 * One JSON GET/POST wrapped in `withRetry`: rate-limits the bucket, maps
 * transport/status failures to typed `DataError`s and never embeds the URL
 * (URLs may carry API keys) in error messages.
 */
export async function requestJson(
  http: HttpClient,
  url: string,
  context: string,
  options: RequestJsonOptions = {},
): Promise<unknown> {
  return withRetry(async () => {
    if (options.limiter && options.bucket) {
      options.limiter.acquire(options.bucket);
    }
    let response: HttpResponse;
    try {
      response = await http(url, options.init);
    } catch (e) {
      throw new DataError('DATA_NETWORK', `${context}: network failure.`, {
        cause: e,
      });
    }
    if (!response.ok) {
      throw dataErrorFromStatus(
        response.status,
        context,
        retryAfterMsFromHeaders(response.headers),
      );
    }
    try {
      return await response.json();
    } catch {
      throw parseError(`${context}: response is not valid JSON.`);
    }
  });
}
