import type { CacheStore, HttpClient, SecretStore } from './data';
import {
  CacheService,
  CelesTrakProvider,
  DataOrchestrator,
  N2yoProvider,
  SpaceTrackProvider,
  WtiaProvider,
  RateLimiter,
  systemClock,
} from './data';
import type { AppDataProvider } from './dataProviderContext';
import { OpSqliteStore } from './db';
import { getObserver } from './observer';

/** Real `HttpClient` over the platform fetch (RN provides it globally). */
const fetchHttpClient: HttpClient = async (url, init) => {
  const response = await fetch(url, {
    method: init?.method ?? 'GET',
    headers: init?.headers,
    body: init?.body,
  });
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return {
    ok: response.ok,
    status: response.status,
    headers,
    json: () => response.json(),
    text: () => response.text(),
  };
};

// ponytail: secrets return null until the Keychain adapter (Hito 10); the
// Space-Track/N2YO fallbacks just fail with DATA_AUTH until then.
const secrets: SecretStore = {
  get: async () => null,
};

/**
 * Composition root: wires the real data layer once (op-sqlite cache, real
 * providers, real fetch). Screens consume it only through
 * `DataProviderContext`.
 */
export function createDataProvider(): AppDataProvider {
  const store: CacheStore = new OpSqliteStore();
  const cache = new CacheService(store);
  const limiter = new RateLimiter(systemClock);
  return new DataOrchestrator({
    catalogPrimary: new CelesTrakProvider({ http: fetchHttpClient }),
    catalogFallback: new SpaceTrackProvider({
      http: fetchHttpClient,
      secrets,
      limiter,
    }),
    positionPrimary: new WtiaProvider({ http: fetchHttpClient, limiter }),
    positionFallback: new N2yoProvider({
      http: fetchHttpClient,
      secrets,
      limiter,
      // ponytail: the observer is captured at composition time (app start,
      // the store default). Pass a getter if live updates matter for the
      // Hito 10 validation flow.
      observer: getObserver(),
    }),
    cache,
  });
}
