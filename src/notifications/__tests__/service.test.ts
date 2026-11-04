/**
 * @format
 *
 * Service tests with a fake `NotificationPort` (applyPlan diffing, permission
 * states) plus the notifee adapter against the controllable module mock.
 */
// The real module is native (TurboModule bridge); the manual mock in
// __mocks__/@notifee/react-native provides a controllable fake.
jest.mock('@notifee/react-native');

import { AuthorizationStatus } from '@notifee/react-native';
import type { PlannedNotification } from '../scheduling';
import {
  CHANNEL_ID,
  CHANNEL_NAME,
  PERMISSION_DENIED_MESSAGE,
  createNotificationService,
  notifeePort,
} from '../service';
import type { NotificationPort, TriggerRequest } from '../service';

type NotifeeMock = {
  __setAuthorizationStatus: (status: AuthorizationStatus) => void;
  __getCreatedChannels: () => Array<{ id: string; name: string }>;
  __getScheduledTriggers: () => Array<{
    notification: {
      id?: string;
      title?: string;
      body?: string;
      android?: { channelId?: string };
    };
    trigger: { type: number; timestamp?: number };
  }>;
  __getCanceledNotificationIds: () => string[];
  __resetNotifee: () => void;
};

const notifeeMock = jest.requireMock<NotifeeMock>('@notifee/react-native');

interface FakePortCalls {
  channels: Array<{ id: string; name: string }>;
  scheduled: TriggerRequest[];
  canceled: string[];
  granted: boolean;
}

function fakePort(
  calls: FakePortCalls,
  initiallyPending: string[] = [],
): NotificationPort {
  let pending = [...initiallyPending];
  return {
    createChannel: channel => {
      calls.channels.push(channel);
      return Promise.resolve(channel.id);
    },
    requestPermission: () => Promise.resolve({ granted: calls.granted }),
    createTriggerNotification: request => {
      calls.scheduled.push(request);
      if (!pending.includes(request.id)) {
        pending.push(request.id);
      }
      return Promise.resolve(request.id);
    },
    getTriggerNotificationIds: () => Promise.resolve([...pending]),
    cancelTriggerNotifications: ids => {
      calls.canceled.push(...ids);
      pending = pending.filter(id => !ids.includes(id));
      return Promise.resolve();
    },
  };
}

function planEntry(id: string, triggerAtMs: number): PlannedNotification {
  return { id, triggerAtMs, title: 'Próximo pase', body: `${id} body` };
}

const CALLS = (): FakePortCalls => ({
  channels: [],
  scheduled: [],
  canceled: [],
  granted: true,
});

beforeEach(() => {
  notifeeMock.__resetNotifee();
});

describe('createNotificationService - ensureReady', () => {
  it('creates the Android channel and requests the runtime permission', async () => {
    const calls = CALLS();
    const service = createNotificationService(fakePort(calls));

    const state = await service.ensureReady();

    expect(calls.channels).toEqual([{ id: CHANNEL_ID, name: CHANNEL_NAME }]);
    expect(state).toEqual({ granted: true, message: null });
  });

  it('surfaces the Spanish message when permission is denied, without crashing', async () => {
    const calls = CALLS();
    calls.granted = false;
    const service = createNotificationService(fakePort(calls));

    const state = await service.ensureReady();

    expect(state.granted).toBe(false);
    expect(state.message).toBe(PERMISSION_DENIED_MESSAGE);
    // The service stays usable after a denial.
    await expect(
      service.applyPlan([planEntry('pass-25544-1', 5000)]),
    ).resolves.toBeUndefined();
    expect(calls.scheduled).toHaveLength(1);
  });
});

describe('createNotificationService - applyPlan', () => {
  it('cancels stale pass notifications and schedules the new plan', async () => {
    const calls = CALLS();
    const service = createNotificationService(
      fakePort(calls, ['pass-25544-1', 'pass-25544-2', 'pass-25544-3']),
    );

    await service.applyPlan([
      planEntry('pass-25544-2', 20000),
      planEntry('pass-25544-4', 40000),
    ]);

    expect(calls.canceled.sort()).toEqual(['pass-25544-1', 'pass-25544-3']);
    expect(calls.scheduled.map(request => request.id)).toEqual([
      'pass-25544-2',
      'pass-25544-4',
    ]);
    expect(calls.scheduled.map(request => request.triggerAtMs)).toEqual([
      20000, 40000,
    ]);
    expect(calls.scheduled[0].title).toBe('Próximo pase');
  });

  it('re-schedules unchanged ids in place (replace semantics)', async () => {
    const calls = CALLS();
    const service = createNotificationService(
      fakePort(calls, ['pass-25544-1']),
    );

    await service.applyPlan([planEntry('pass-25544-1', 15000)]);

    expect(calls.canceled).toEqual([]);
    expect(calls.scheduled).toHaveLength(1);
    expect(calls.scheduled[0].triggerAtMs).toBe(15000);
  });

  it('never cancels foreign notification ids', async () => {
    const calls = CALLS();
    const service = createNotificationService(
      fakePort(calls, ['other-feature-1']),
    );

    await service.applyPlan([planEntry('pass-25544-1', 10000)]);

    expect(calls.canceled).toEqual([]);
  });

  it('cancels every pending pass notification for an empty plan', async () => {
    const calls = CALLS();
    const service = createNotificationService(
      fakePort(calls, ['pass-25544-1', 'pass-25544-2']),
    );

    await service.applyPlan([]);

    expect(calls.canceled.sort()).toEqual(['pass-25544-1', 'pass-25544-2']);
    expect(calls.scheduled).toEqual([]);
  });
});

describe('notifeePort adapter', () => {
  it('maps port calls onto the notifee module (timestamp triggers, channel)', async () => {
    notifeeMock.__setAuthorizationStatus(AuthorizationStatus.DENIED);
    const service = createNotificationService(notifeePort());

    const state = await service.ensureReady();
    expect(state).toEqual({
      granted: false,
      message: PERMISSION_DENIED_MESSAGE,
    });
    expect(notifeeMock.__getCreatedChannels()).toEqual([
      { id: CHANNEL_ID, name: CHANNEL_NAME },
    ]);

    await service.applyPlan([
      planEntry('pass-25544-1700000000000', 1700000600000),
    ]);
    const triggers = notifeeMock.__getScheduledTriggers();
    expect(triggers).toHaveLength(1);
    expect(triggers[0].notification.id).toBe('pass-25544-1700000000000');
    expect(triggers[0].notification.android?.channelId).toBe(CHANNEL_ID);
    expect(triggers[0].trigger).toEqual({ type: 0, timestamp: 1700000600000 });
    expect(notifeeMock.__getCanceledNotificationIds()).toEqual([]);
  });
});
