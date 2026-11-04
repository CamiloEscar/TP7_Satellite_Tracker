import BackgroundFetch from 'react-native-background-fetch';
import type { HeadlessEvent } from 'react-native-background-fetch';
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
import {
  createBackgroundFetchHandler,
  createHeadlessTask,
  createNotificationService,
  createPassRefresh,
  notifeePort,
} from './notifications';
import { getObserver } from './observer';
import { getSelectedNoradId, subscribeSelectedNoradId } from './selection';

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

/**
 * Wires notifications + background refresh (Hito 8): Android channel and
 * runtime permission, background-fetch registration (its README: `configure`
 * auto-starts; `stopOnTerminate: false` + `enableHeadless` keep events
 * flowing after app termination) and pass re-scheduling on selection change.
 * Runs outside React: only module stores and injected providers.
 */
export function startBackgroundRefresh(provider: AppDataProvider): void {
  const service = createNotificationService(notifeePort());
  const deps = { provider, getSelectedNoradId, service };
  service.ensureReady().catch(() => {
    // Best-effort setup: a missing native module must not break startup.
  });
  BackgroundFetch.configure(
    {
      minimumFetchInterval: 15,
      stopOnTerminate: false,
      startOnBoot: true,
      enableHeadless: true,
    },
    createBackgroundFetchHandler(deps),
    taskId => BackgroundFetch.finish(taskId),
  ).catch(() => {
    // Best-effort registration: retried on the next app start.
  });
  const refresh = createPassRefresh(deps);
  subscribeSelectedNoradId(() => {
    refresh();
  });
}

/**
 * Headless task for background-fetch events after app termination. Self-
 * composes the data layer: the headless JS context shares no React state
 * with the app. Registered from `index.js` per the background-fetch README.
 */
export function backgroundFetchHeadlessTask(
  event: HeadlessEvent,
): Promise<void> {
  return createHeadlessTask({
    provider: createDataProvider(),
    getSelectedNoradId,
    service: createNotificationService(notifeePort()),
  })(event);
}
