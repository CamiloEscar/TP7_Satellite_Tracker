import type { Clock, HttpClient, SecretStore } from '../types';
import { DataError } from '../types';
import { RateLimiter } from '../rateLimiter';
import { N2yoProvider } from '../providers/n2yo';
import { SpaceTrackProvider } from '../providers/spacetrack';

// --- Helpers (local fakes only; no network) --------------------------------------

const API_KEY = 'TOPSECRET-API-KEY-123456';
const ST_IDENTITY = 'analyst@example.com';
const ST_PASSWORD = 'sup3r-s3cret-pass';
const NOW_SEC = 1521354417;

const clock: Clock = { now: () => NOW_SEC * 1000 };
const limiter = new RateLimiter(clock, {
  spacetrack: { maxRequests: 1000, windowMs: 60000 },
  'n2yo-positions': { maxRequests: 1000, windowMs: 3600000 },
});

interface FakeCall {
  url: string;
  body?: string;
}

function fakeHttp(
  respond: (url: string) => { status: number; body: unknown },
): { http: HttpClient; calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const http: HttpClient = async (url, init) => {
    calls.push({ url, body: init?.body });
    const { status, body } = respond(url);
    return {
      ok: status < 400,
      status,
      headers: {},
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return { http, calls };
}

async function captureError(promise: Promise<unknown>): Promise<DataError> {
  let caught: unknown;
  try {
    await promise;
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(DataError);
  return caught as DataError;
}

function expectNoSecrets(error: DataError, secret: string): void {
  expect(error.message).not.toContain(secret);
  expect(String(error)).not.toContain(secret);
  expect(JSON.stringify(error)).not.toContain(secret);
}

// --- N2YO ---------------------------------------------------------------------------

describe('N2YO credentials', () => {
  it('reads the API key from the SecretStore and never leaks it in errors', async () => {
    const { http, calls } = fakeHttp(() => ({ status: 404, body: {} }));
    const secrets: SecretStore = { get: async () => API_KEY };
    const provider = new N2yoProvider({
      http,
      secrets,
      limiter,
      clock,
      observer: {
        latitudeDeg: 41.702,
        longitudeDeg: -76.014,
        altitudeKm: 0,
      },
    });

    const error = await captureError(
      provider.getValidationPosition(25544, new Date(NOW_SEC * 1000)),
    );

    expect(error.code).toBe('DATA_NOT_FOUND');
    // The key was taken from the store and used in the request...
    expect(calls[0].url).toContain(API_KEY);
    // ...but it never reaches the thrown error.
    expectNoSecrets(error, API_KEY);
  });

  it('fails with DATA_AUTH without calling the API when no key is configured', async () => {
    const { http, calls } = fakeHttp(() => ({ status: 200, body: {} }));
    const get = jest.fn(async () => null);
    const provider = new N2yoProvider({
      http,
      secrets: { get },
      limiter,
      clock,
      observer: {
        latitudeDeg: 41.702,
        longitudeDeg: -76.014,
        altitudeKm: 0,
      },
    });

    const error = await captureError(
      provider.getValidationPosition(25544, new Date(NOW_SEC * 1000)),
    );

    expect(error.code).toBe('DATA_AUTH');
    expect(get).toHaveBeenCalledWith('n2yo-api-key');
    expect(calls).toHaveLength(0);
    expectNoSecrets(error, API_KEY);
  });
});

// --- Space-Track ------------------------------------------------------------------------

describe('Space-Track credentials', () => {
  const secrets: SecretStore = {
    get: async key =>
      key === 'spacetrack-identity'
        ? ST_IDENTITY
        : key === 'spacetrack-password'
        ? ST_PASSWORD
        : null,
  };

  it('reads credentials from the SecretStore and never leaks them in errors', async () => {
    const { http, calls } = fakeHttp(url =>
      url.includes('ajaxauth/login')
        ? { status: 401, body: {} }
        : { status: 200, body: [] },
    );
    const provider = new SpaceTrackProvider({ http, secrets, limiter, clock });

    const error = await captureError(provider.getCatalog());

    expect(error.code).toBe('DATA_AUTH');
    // Credentials were taken from the store and sent to the login endpoint...
    expect(calls[0].body).toContain('identity=analyst%40example.com');
    expect(calls[0].body).toContain(
      `password=${encodeURIComponent(ST_PASSWORD)}`,
    );
    // ...but they never reach the thrown error.
    expectNoSecrets(error, ST_PASSWORD);
    expectNoSecrets(error, ST_IDENTITY);
  });

  it('fails with DATA_AUTH without calling the API when credentials are missing', async () => {
    const { http, calls } = fakeHttp(() => ({ status: 200, body: [] }));
    const get = jest.fn(async () => null);
    const provider = new SpaceTrackProvider({
      http,
      secrets: { get },
      limiter,
      clock,
    });

    const error = await captureError(provider.getCatalog());

    expect(error.code).toBe('DATA_AUTH');
    expect(get).toHaveBeenCalledWith('spacetrack-identity');
    expect(get).toHaveBeenCalledWith('spacetrack-password');
    expect(calls).toHaveLength(0);
    expectNoSecrets(error, ST_PASSWORD);
    expectNoSecrets(error, ST_IDENTITY);
  });
});
