/**
 * Jest manual mock for the native `@notifee/react-native` module
 * (TurboModule bridge - jest must never load it). Placed in the root
 * `__mocks__` directory like the MapLibre mock; tests control the permission
 * outcome through `__setAuthorizationStatus` and inspect the recorded
 * channel/trigger calls. Applied automatically to the package in every
 * suite; the enum values mirror the real module.
 */

export enum TriggerType {
  TIMESTAMP = 0,
  INTERVAL = 1,
}

export enum AuthorizationStatus {
  NOT_DETERMINED = -1,
  DENIED = 0,
  AUTHORIZED = 1,
  PROVISIONAL = 2,
}

interface MockChannel {
  id: string;
  name: string;
}

interface MockTriggerNotification {
  notification: {
    id?: string;
    title?: string;
    body?: string;
    android?: { channelId?: string };
  };
  trigger: { type: TriggerType; timestamp?: number };
}

let authorizationStatus: AuthorizationStatus = AuthorizationStatus.AUTHORIZED;
let createdChannels: MockChannel[] = [];
let scheduledTriggers: MockTriggerNotification[] = [];
let canceledIds: string[] = [];

const notifee = {
  createChannel(channel: MockChannel): Promise<string> {
    createdChannels.push(channel);
    return Promise.resolve(channel.id);
  },
  requestPermission(): Promise<{ authorizationStatus: AuthorizationStatus }> {
    return Promise.resolve({ authorizationStatus });
  },
  createTriggerNotification(
    notification: MockTriggerNotification['notification'],
    trigger: MockTriggerNotification['trigger'],
  ): Promise<string> {
    scheduledTriggers.push({ notification, trigger });
    return Promise.resolve(notification.id ?? '');
  },
  getTriggerNotificationIds(): Promise<string[]> {
    return Promise.resolve(
      scheduledTriggers.map(entry => entry.notification.id ?? ''),
    );
  },
  cancelTriggerNotifications(ids?: string[]): Promise<void> {
    const dropped = new Set(
      ids ?? scheduledTriggers.map(e => e.notification.id ?? ''),
    );
    canceledIds.push(...dropped);
    scheduledTriggers = scheduledTriggers.filter(
      entry => !dropped.has(entry.notification.id ?? ''),
    );
    return Promise.resolve();
  },
};

export default notifee;

/** Controls the outcome of `requestPermission` (default AUTHORIZED). */
export function __setAuthorizationStatus(status: AuthorizationStatus): void {
  authorizationStatus = status;
}

export function __getCreatedChannels(): MockChannel[] {
  return [...createdChannels];
}

export function __getScheduledTriggers(): MockTriggerNotification[] {
  return [...scheduledTriggers];
}

export function __getCanceledNotificationIds(): string[] {
  return [...canceledIds];
}

export function __resetNotifee(): void {
  authorizationStatus = AuthorizationStatus.AUTHORIZED;
  createdChannels = [];
  scheduledTriggers = [];
  canceledIds = [];
}
