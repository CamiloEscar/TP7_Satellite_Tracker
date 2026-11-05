import type {
  Clock,
  DataErrorCode,
  HttpClient,
  HttpRequestInit,
  HttpResponse,
  SecretStore,
} from '../types';
import { DataError } from '../types';
import { RateLimiter } from '../rateLimiter';
import { CelesTrakProvider } from '../providers/celestrak';
import { N2yoProvider } from '../providers/n2yo';
import { SpaceTrackProvider } from '../providers/spacetrack';
import { WtiaProvider } from '../providers/wheretheiss';
import gpFixture from './fixtures/celestrak-gp.json';
import supgpFixture from './fixtures/celestrak-supgp-starlink.json';
import spacetrackFixture from './fixtures/spacetrack-gp.json';
import n2yoPositionsFixture from './fixtures/n2yo-positions.json';
import wtiaPositionsFixture from './fixtures/wtia-positions.json';
import wtiaTlesFixture from './fixtures/wtia-tles.json';

// --- Helpers (local fakes only; no network) --------------------------------------

interface FakeRoute {
  match: string;
  status?: number;
  body?: unknown;
  jsonFails?: boolean;
}

interface FakeCall {
  url: string;
  init?: HttpRequestInit;
}

function jsonResponse(status: number, body: unknown): HttpResponse {
  return {
    ok: status < 400,
    status,
    headers: {},
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function fakeHttp(routes: FakeRoute[]): {
  http: HttpClient;
  calls: FakeCall[];
} {
  const calls: FakeCall[] = [];
  const http: HttpClient = async (url, init) => {
    calls.push({ url, init });
    const route = routes.find(r => url.includes(r.match));
    if (!route) {
      throw new Error(`No fake route matches URL: ${url}`);
    }
    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      headers: {},
      json: async () => {
        if (route.jsonFails) {
          throw new Error('invalid json');
        }
        return route.body;
      },
      text: async () => JSON.stringify(route.body ?? ''),
    };
  };
  return { http, calls };
}

function makeClock(ms: number): Clock {
  return { now: () => ms };
}

function fixedRateLimiter(): RateLimiter {
  // Permissive limiter: provider tests exercise one API call per test; the
  // limit behavior itself is covered in rateLimiter.test.ts.
  return new RateLimiter(makeClock(0), {
    wtia: { maxRequests: 1000, windowMs: 1000 },
    spacetrack: { maxRequests: 1000, windowMs: 60000 },
    'n2yo-positions': { maxRequests: 1000, windowMs: 3600000 },
  });
}

async function expectDataError(
  promise: Promise<unknown>,
  code: DataErrorCode,
): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(DataError);
  expect((caught as DataError).code).toBe(code);
}

const FETCHED_AT_MS = Date.UTC(2026, 9, 30, 13, 0, 0);

// --- CelesTrakProvider ------------------------------------------------------------

describe('CelesTrakProvider', () => {
  const standardRoutes: FakeRoute[] = [
    { match: 'GROUP=stations', body: [gpFixture[0]] },
    { match: 'GROUP=gps-ops', body: [gpFixture[1]] },
    { match: 'GROUP=weather', body: [gpFixture[2]] },
    { match: 'GROUP=starlink', body: [] },
    { match: 'sup-gp.php', body: supgpFixture },
  ];

  function makeProvider(routes: FakeRoute[], gpGroups?: readonly string[]) {
    const { http, calls } = fakeHttp(routes);
    const provider = new CelesTrakProvider({
      http,
      clock: makeClock(FETCHED_AT_MS),
      gpGroups,
    });
    return { provider, calls };
  }

  it('derives catalog entries with the group classification rules', async () => {
    const { provider } = makeProvider(standardRoutes);
    await expect(provider.getCatalog()).resolves.toEqual([
      { noradId: 25544, name: 'ISS (ZARYA)', group: 'iss' },
      { noradId: 43873, name: 'NAVSTAR 77 (USA 248)', group: 'gps-ops' },
      { noradId: 33591, name: 'NOAA 19', group: 'weather' },
      { noradId: 47964, name: 'STARLINK-30000', group: 'starlink' },
      { noradId: 47965, name: 'STARLINK-30001', group: 'starlink' },
    ]);
  });

  it('maps GP OMM rows to orbital records (UTC epoch, source, format)', async () => {
    const { provider, calls } = makeProvider(standardRoutes);
    await provider.getCatalog();
    const record = await provider.getOrbitalData(25544);
    expect(record.format).toBe('omm');
    expect(record.source).toBe('celestrak-gp');
    expect(record.noradId).toBe(25544);
    expect(record.name).toBe('ISS (ZARYA)');
    // EPOCH "2026-10-30T12:00:00.000000" (no zone designator) is UTC.
    expect(record.epoch.getTime()).toBe(Date.UTC(2026, 9, 30, 12, 0, 0));
    expect(record.fetchedAt.getTime()).toBe(FETCHED_AT_MS);
    // One download feeds both the catalog and the per-satellite lookups.
    expect(calls).toHaveLength(5);
  });

  it('maps SupGP Starlink rows with source celestrak-supgp', async () => {
    const { provider, calls } = makeProvider(standardRoutes);
    await provider.getCatalog();
    const record = await provider.getOrbitalData(47964);
    expect(record.format).toBe('omm');
    expect(record.source).toBe('celestrak-supgp');
    expect(record.name).toBe('STARLINK-30000');
    expect(calls).toHaveLength(5);
  });

  it('classifies by name and NORAD id when the query group is generic', async () => {
    const { provider } = makeProvider(
      [
        { match: 'GROUP=stations', body: gpFixture },
        { match: 'sup-gp.php', body: [] },
      ],
      ['stations'],
    );
    const entries = await provider.getCatalog();
    expect(entries.map(e => e.group)).toEqual(['iss', 'other', 'other']);
  });

  it('downloads a single CATNR record when the set is cold', async () => {
    const { provider, calls } = makeProvider([
      { match: 'CATNR=25544', body: [gpFixture[0]] },
    ]);
    const record = await provider.getOrbitalData(25544);
    expect(record.noradId).toBe(25544);
    expect(record.fetchedAt.getTime()).toBe(FETCHED_AT_MS);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('CATNR=25544');
  });

  it('throws DATA_NOT_FOUND for satellites absent from CelesTrak', async () => {
    const { provider } = makeProvider([{ match: 'CATNR=', body: [] }]);
    await expectDataError(provider.getOrbitalData(999999), 'DATA_NOT_FOUND');
  });

  it('tolerates a failing source and serves the remaining catalog', async () => {
    const { provider } = makeProvider([
      { match: 'GROUP=stations', body: [gpFixture[0]] },
      { match: 'GROUP=gps-ops', body: [gpFixture[1]] },
      { match: 'GROUP=weather', body: [gpFixture[2]] },
      { match: 'GROUP=starlink', body: [] },
      { match: 'sup-gp.php', status: 404, body: [] },
    ]);
    const entries = await provider.getCatalog();
    expect(entries.map(e => e.noradId)).toEqual([25544, 43873, 33591]);
  });

  it('serves Starlink from GP when SupGP refuses repeat downloads (403)', async () => {
    // Real-world behavior (verified 2026-11-03): CelesTrak answers SupGP FILE
    // repeats within 2 h with a 403 text notice instead of the JSON set.
    const { provider } = makeProvider([
      { match: 'GROUP=stations', body: [] },
      { match: 'GROUP=gps-ops', body: [] },
      { match: 'GROUP=weather', body: [] },
      { match: 'GROUP=starlink', body: [supgpFixture[0]] },
      { match: 'sup-gp.php', status: 403, body: [] },
    ]);
    const entries = await provider.getCatalog();
    expect(entries).toEqual([
      { noradId: 47964, name: 'STARLINK-30000', group: 'starlink' },
    ]);
  });

  it('keeps the newest SupGP element when an object has several epochs', async () => {
    const base = supgpFixture[0] as unknown as Record<string, unknown>;
    const older = { ...base, EPOCH: '2026-10-29T12:00:00.000000' };
    const newer = { ...base, EPOCH: '2026-10-30T12:00:00.000000' };
    const { provider } = makeProvider([
      { match: 'GROUP=stations', body: [] },
      { match: 'GROUP=gps-ops', body: [] },
      { match: 'GROUP=weather', body: [] },
      { match: 'GROUP=starlink', body: [] },
      { match: 'sup-gp.php', body: [older, newer] },
    ]);
    await provider.getCatalog();
    const record = await provider.getOrbitalData(base.NORAD_CAT_ID as number);
    expect(record.epoch.getTime()).toBe(Date.UTC(2026, 9, 30, 12, 0, 0));
  });

  it('throws when every CelesTrak source fails', async () => {
    const { provider } = makeProvider([
      { match: 'GROUP=', status: 404, body: [] },
      { match: 'sup-gp.php', status: 404, body: [] },
    ]);
    await expectDataError(provider.getCatalog(), 'DATA_NOT_FOUND');
  });

  it('throws DATA_PARSE on malformed OMM rows or non-JSON responses', async () => {
    const { provider: badRow } = makeProvider(
      [
        { match: 'GROUP=stations', body: [{ OBJECT_NAME: 'INCOMPLETE' }] },
        { match: 'sup-gp.php', jsonFails: true },
      ],
      ['stations'],
    );
    await expectDataError(badRow.getCatalog(), 'DATA_PARSE');

    const { provider: badJson } = makeProvider(
      [
        { match: 'GROUP=stations', jsonFails: true },
        { match: 'sup-gp.php', body: [{ OBJECT_NAME: 'INCOMPLETE' }] },
      ],
      ['stations'],
    );
    await expectDataError(badJson.getCatalog(), 'DATA_PARSE');
  });
});

// --- WtiaProvider ------------------------------------------------------------------

describe('WtiaProvider', () => {
  function makeProvider(routes: FakeRoute[]) {
    const { http, calls } = fakeHttp(routes);
    return {
      provider: new WtiaProvider({ http, limiter: fixedRateLimiter() }),
      calls,
    };
  }

  it('maps a WTIA position at the exact requested timestamp', async () => {
    const { provider, calls } = makeProvider([
      { match: 'positions?timestamps=', body: wtiaPositionsFixture },
    ]);
    const pos = await provider.getValidationPosition(
      25544,
      new Date(1793741255 * 1000),
    );
    expect(pos.noradId).toBe(25544);
    expect(pos.timestamp.getTime()).toBe(1793741255 * 1000);
    expect(pos.latitudeDeg).toBeCloseTo(-35.244324058527);
    expect(pos.longitudeDeg).toBeCloseTo(177.50003525153);
    expect(pos.altitudeKm).toBeCloseTo(432.47335839041);
    expect(calls[0].url).toBe(
      'https://api.wheretheiss.at/v1/satellites/25544/positions?timestamps=1793741255',
    );
  });

  it('throws DATA_NOT_FOUND when the exact timestamp is missing', async () => {
    const { provider } = makeProvider([
      { match: 'positions?timestamps=', body: wtiaPositionsFixture },
    ]);
    await expectDataError(
      provider.getValidationPosition(25544, new Date(1793741260 * 1000)),
      'DATA_NOT_FOUND',
    );
  });

  it('rejects satellites other than the ISS without calling the API', async () => {
    const { provider, calls } = makeProvider([
      { match: 'positions?timestamps=', body: wtiaPositionsFixture },
    ]);
    await expectDataError(
      provider.getValidationPosition(33591, new Date(1793741255 * 1000)),
      'DATA_NOT_FOUND',
    );
    expect(calls).toHaveLength(0);
  });

  it('parses the WTIA TLE', async () => {
    const { provider } = makeProvider([
      { match: '/tles', body: wtiaTlesFixture },
    ]);
    await expect(provider.getValidationTle()).resolves.toEqual({
      line1: wtiaTlesFixture.line1,
      line2: wtiaTlesFixture.line2,
    });
  });
});

// --- N2yoProvider -------------------------------------------------------------------

describe('N2yoProvider', () => {
  const API_KEY = 'TEST-KEY-123';
  const NOW_SEC = 1521354417;

  function makeProvider(routes: FakeRoute[]) {
    const { http, calls } = fakeHttp(routes);
    const secrets: SecretStore = {
      get: async key => (key === 'n2yo-api-key' ? API_KEY : null),
    };
    const provider = new N2yoProvider({
      http,
      secrets,
      limiter: fixedRateLimiter(),
      clock: makeClock(NOW_SEC * 1000),
      observer: {
        latitudeDeg: 41.702,
        longitudeDeg: -76.014,
        altitudeKm: 0,
      },
    });
    return { provider, calls };
  }

  it('maps the N2YO sample at the requested second (now-forward)', async () => {
    const { provider, calls } = makeProvider([
      { match: '/positions/', body: n2yoPositionsFixture },
    ]);
    const pos = await provider.getValidationPosition(
      25544,
      new Date(1521354418 * 1000),
    );
    expect(pos.noradId).toBe(25544);
    expect(pos.timestamp.getTime()).toBe(1521354418 * 1000);
    expect(pos.latitudeDeg).toBeCloseTo(-39.90318514);
    expect(pos.longitudeDeg).toBeCloseTo(158.28897924);
    expect(pos.altitudeKm).toBeCloseTo(417.85);
    // Look angles N2YO computes for the observer (mode B reference).
    expect(pos.azimuthDeg).toBeCloseTo(254.31);
    expect(pos.elevationDeg).toBeCloseTo(-69.09);
    expect(calls[0].url).toContain(
      '/positions/25544/41.702/-76.014/0/3/&apiKey=TEST-KEY-123',
    );
  });

  it('throws DATA_NOT_FOUND for timestamps before now', async () => {
    const { provider, calls } = makeProvider([
      { match: '/positions/', body: n2yoPositionsFixture },
    ]);
    await expectDataError(
      provider.getValidationPosition(25544, new Date((NOW_SEC - 60) * 1000)),
      'DATA_NOT_FOUND',
    );
    expect(calls).toHaveLength(0);
  });

  it('matches the sample with 1 s of client/server clock-skew tolerance', async () => {
    const { provider } = makeProvider([
      { match: '/positions/', body: n2yoPositionsFixture },
    ]);
    // Fixture samples are at NOW_SEC+1 and NOW_SEC+2; target is +3 (skew).
    const pos = await provider.getValidationPosition(
      25544,
      new Date((NOW_SEC + 3) * 1000),
    );
    expect(pos.timestamp.getTime()).toBe(1521354419 * 1000);
  });
});

// --- SpaceTrackProvider ----------------------------------------------------------------

describe('SpaceTrackProvider', () => {
  const secrets: SecretStore = {
    get: async key =>
      key === 'spacetrack-identity'
        ? 'user@example.com'
        : key === 'spacetrack-password'
        ? 'hunter2-secret'
        : null,
  };

  function makeProvider(routes: FakeRoute[]) {
    const { http, calls } = fakeHttp(routes);
    const provider = new SpaceTrackProvider({
      http,
      secrets,
      limiter: fixedRateLimiter(),
      clock: makeClock(FETCHED_AT_MS),
    });
    return { provider, calls };
  }

  const loginRoutes: FakeRoute[] = [
    { match: 'ajaxauth/login', body: 'logged in' },
    { match: 'basicspacedata', body: spacetrackFixture },
  ];

  it('logs in with SecretStore credentials and maps GP rows to records', async () => {
    const { provider, calls } = makeProvider(loginRoutes);
    const record = await provider.getOrbitalData(33591);
    expect(record.format).toBe('omm');
    expect(record.source).toBe('spacetrack');
    expect(record.noradId).toBe(33591);
    expect(record.name).toBe('NOAA 19');
    // Space-Track encodes numerics as strings; EPOCH is UTC.
    expect(record.epoch.getTime()).toBe(Date.UTC(2026, 9, 30, 10, 15, 30, 500));
    expect(calls[0].url).toBe('https://www.space-track.org/ajaxauth/login');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].init?.body).toContain('identity=user%40example.com');
    expect(calls[0].init?.body).toContain('password=hunter2-secret');
    expect(calls[1].url).toContain('NORAD_CAT_ID/33591');
  });

  it('maps legacy TLE-only GP rows to TLE records with the embedded epoch', async () => {
    const { provider } = makeProvider(loginRoutes);
    const record = await provider.getOrbitalData(25544);
    expect(record.format).toBe('tle');
    if (record.format !== 'tle') {
      return;
    }
    expect(record.payload.line1.startsWith('1 25544U')).toBe(true);
    expect(record.payload.line2.startsWith('2 25544')).toBe(true);
    // TLE line 1 epoch "26306.75682168" -> 2026-11-02T18:09:49Z.
    expect(record.epoch.getTime()).toBeGreaterThan(
      Date.UTC(2026, 10, 2, 18, 9, 48),
    );
    expect(record.epoch.getTime()).toBeLessThan(
      Date.UTC(2026, 10, 2, 18, 9, 50),
    );
  });

  it('re-logs in once when the session expires (401)', async () => {
    let queryCalls = 0;
    let loginCalls = 0;
    const calls: FakeCall[] = [];
    const http: HttpClient = async (url, init) => {
      calls.push({ url, init });
      if (url.includes('ajaxauth/login')) {
        loginCalls += 1;
        return jsonResponse(200, 'logged in');
      }
      queryCalls += 1;
      return queryCalls === 1
        ? jsonResponse(401, {})
        : jsonResponse(200, spacetrackFixture);
    };
    const provider = new SpaceTrackProvider({
      http,
      secrets,
      limiter: fixedRateLimiter(),
      clock: makeClock(FETCHED_AT_MS),
    });

    const record = await provider.getOrbitalData(33591);

    expect(record.noradId).toBe(33591);
    expect(queryCalls).toBe(2);
    expect(loginCalls).toBe(2);
  });

  it('throws DATA_AUTH when credentials are not configured', async () => {
    const { http, calls } = fakeHttp(loginRoutes);
    const provider = new SpaceTrackProvider({
      http,
      secrets: { get: async () => null },
      limiter: fixedRateLimiter(),
      clock: makeClock(FETCHED_AT_MS),
    });
    await expectDataError(provider.getCatalog(), 'DATA_AUTH');
    expect(calls).toHaveLength(0);
  });
});
