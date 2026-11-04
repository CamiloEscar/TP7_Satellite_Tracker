/**
 * @format
 *
 * Background-fetch handler tests: refresh via the data provider, pass
 * re-computation (real `findUpcomingPasses` on the locked ISS fixture),
 * plan application and clean finish. The real notification fire is never
 * simulated here - only the scheduling contract.
 */
// The real module is native (TurboModule + HeadlessJS); the manual mock in
// __mocks__/react-native-background-fetch provides controllable fakes.
jest.mock('react-native-background-fetch');

import BackgroundFetch from 'react-native-background-fetch';
import type { DataProvider, OrbitalRecord } from '../../data';
import { DEFAULT_OBSERVER, setObserver } from '../../observer';
import {
  createBackgroundFetchHandler,
  createHeadlessTask,
} from '../background';
import type { PassRefreshDeps } from '../background';
import { DEFAULT_LEAD_MINUTES, setLeadMinutes } from '../config';
import type { PlannedNotification } from '../scheduling';

type BackgroundFetchMock = {
  __emitFetchEvent: (taskId: string) => Promise<void>;
  __emitFetchTimeout: (taskId: string) => Promise<void>;
  __emitHeadlessEvent: (event: {
    taskId: string;
    timeout: boolean;
  }) => Promise<void>;
  __getFinishedTaskIds: () => string[];
  __resetBackgroundFetch: () => void;
};

const backgroundFetchMock = jest.requireMock<BackgroundFetchMock>(
  'react-native-background-fetch',
);

// ISS TLE A - satellite.js README example, epoch 2019-06-05T12:12:57.999883Z.
const ISS_TLE_A = {
  line1:
    '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  line2:
    '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
};

const ISS_RECORD: OrbitalRecord = {
  format: 'tle',
  noradId: 25544,
  name: 'ISS (ZARYA)',
  source: 'celestrak-gp',
  epoch: new Date('2019-06-05T12:12:58.000Z'),
  fetchedAt: new Date('2019-06-05T13:00:00.000Z'),
  payload: ISS_TLE_A,
};

// Same search start as `src/passes/__tests__/passes.test.ts`: the first ISS
// pass above 10 deg from Buenos Aires is locked at AOS 13:32:00.469Z.
const NOW = new Date('2019-06-05T12:13:00.000Z');

function fakeProvider(result: OrbitalRecord | Error) {
  const requested: number[] = [];
  return {
    requested,
    provider: {
      getOrbitalData: (noradId: number) => {
        requested.push(noradId);
        return result instanceof Error
          ? Promise.reject(result)
          : Promise.resolve(result);
      },
    } satisfies Pick<DataProvider, 'getOrbitalData'>,
  };
}

function fakeService() {
  const plans: PlannedNotification[][] = [];
  return {
    plans,
    service: {
      applyPlan: (plan: readonly PlannedNotification[]) => {
        plans.push([...plan]);
        return Promise.resolve();
      },
    },
  };
}

function makeDeps(): PassRefreshDeps & {
  requested: number[];
  plans: PlannedNotification[][];
} {
  const provider = fakeProvider(ISS_RECORD);
  const service = fakeService();
  return {
    provider: provider.provider,
    getSelectedNoradId: () => 25544,
    service: service.service,
    now: () => NOW,
    requested: provider.requested,
    plans: service.plans,
  };
}

beforeEach(() => {
  backgroundFetchMock.__resetBackgroundFetch();
  setObserver(DEFAULT_OBSERVER);
  setLeadMinutes(DEFAULT_LEAD_MINUTES);
});

describe('background fetch handler - refresh, recompute, apply', () => {
  it('refreshes via the provider, recomputes passes and applies the plan', async () => {
    const deps = makeDeps();
    const handler = createBackgroundFetchHandler(deps);

    BackgroundFetch.configure({ minimumFetchInterval: 15 }, handler, () => {});
    await backgroundFetchMock.__emitFetchEvent('task-1');

    // (1) orbital set refreshed through the provider's normal TTL path.
    expect(deps.requested).toEqual([25544]);
    // (2)+(3) passes recomputed and applied as a plan.
    expect(deps.plans).toHaveLength(1);
    const plan = deps.plans[0];
    expect(plan.length).toBeGreaterThanOrEqual(1);
    for (const entry of plan) {
      expect(entry.id).toMatch(/^pass-25544-\d+$/);
      const aosMs = Number(entry.id.slice('pass-25544-'.length));
      expect(entry.triggerAtMs).toBe(aosMs - DEFAULT_LEAD_MINUTES * 60000);
      expect(entry.triggerAtMs).toBeGreaterThan(NOW.getTime());
      expect(entry.title).toBe('Próximo pase');
      expect(entry.body).toContain('ISS (ZARYA)');
      expect(entry.body).toContain(new Date(aosMs).toISOString());
    }
    const triggers = plan.map(entry => entry.triggerAtMs);
    expect([...triggers].sort((a, b) => a - b)).toEqual(triggers);
    // The fetch event is finished per the background-fetch API.
    expect(backgroundFetchMock.__getFinishedTaskIds()).toEqual(['task-1']);
  });

  it('skips pass computation but finishes cleanly when no satellite is selected', async () => {
    const provider = fakeProvider(ISS_RECORD);
    const service = fakeService();
    const handler = createBackgroundFetchHandler({
      provider: provider.provider,
      getSelectedNoradId: () => null,
      service: service.service,
      now: () => NOW,
    });

    await handler('task-2');

    expect(provider.requested).toEqual([]);
    expect(service.plans).toEqual([]);
    expect(backgroundFetchMock.__getFinishedTaskIds()).toEqual(['task-2']);
  });

  it('still finishes the fetch event when the provider fails', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = fakeProvider(new Error('offline'));
    const service = fakeService();
    const handler = createBackgroundFetchHandler({
      provider: provider.provider,
      getSelectedNoradId: () => 25544,
      service: service.service,
      now: () => NOW,
    });

    await handler('task-3');

    expect(service.plans).toEqual([]);
    expect(backgroundFetchMock.__getFinishedTaskIds()).toEqual(['task-3']);
  });
});

describe('background fetch headless task', () => {
  it('refreshes and finishes on a headless event', async () => {
    const deps = makeDeps();
    BackgroundFetch.registerHeadlessTask(createHeadlessTask(deps));

    await backgroundFetchMock.__emitHeadlessEvent({
      taskId: 'headless-1',
      timeout: false,
    });

    expect(deps.requested).toEqual([25544]);
    expect(deps.plans).toHaveLength(1);
    expect(backgroundFetchMock.__getFinishedTaskIds()).toEqual(['headless-1']);
  });

  it('finishes immediately on timeout without refreshing', async () => {
    const deps = makeDeps();
    BackgroundFetch.registerHeadlessTask(createHeadlessTask(deps));

    await backgroundFetchMock.__emitHeadlessEvent({
      taskId: 'headless-2',
      timeout: true,
    });

    expect(deps.requested).toEqual([]);
    expect(backgroundFetchMock.__getFinishedTaskIds()).toEqual(['headless-2']);
  });
});
