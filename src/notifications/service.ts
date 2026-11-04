import notifee, {
  AuthorizationStatus,
  TriggerType,
} from '@notifee/react-native';
import type { PlannedNotification } from './scheduling';
import { NOTIFICATION_ID_PREFIX } from './scheduling';

/**
 * Notifee-backed notification service: Android channel, runtime permission
 * (Android 13+ POST_NOTIFICATIONS) and plan application. notifee sits behind
 * `NotificationPort` so tests inject a fake and the real module is only
 * touched through `notifeePort()`.
 */

/** Android channel for pass alerts. */
export const CHANNEL_ID = 'pass-alerts';
/** Channel name (UI copy: Spanish). */
export const CHANNEL_NAME = 'Pases de satélites';
/** Visible state message when the permission is denied (UI copy: Spanish). */
export const PERMISSION_DENIED_MESSAGE =
  'Permiso de notificaciones rechazado. Active el permiso en la configuración de la aplicación.';

/** Result of the channel/permission step. `message` is UI copy (Spanish). */
export interface NotificationPermissionState {
  granted: boolean;
  message: string | null;
}

/** One notification to schedule at `triggerAtMs` (UTC ms since epoch). */
export interface TriggerRequest {
  id: string;
  title: string;
  body: string;
  triggerAtMs: number;
}

/** Tiny port over the native notification module (notifee in production). */
export interface NotificationPort {
  createChannel(channel: { id: string; name: string }): Promise<string>;
  requestPermission(): Promise<{ granted: boolean }>;
  createTriggerNotification(request: TriggerRequest): Promise<string>;
  getTriggerNotificationIds(): Promise<string[]>;
  cancelTriggerNotifications(ids: string[]): Promise<void>;
}

export interface NotificationService {
  /** Creates the Android channel and requests the runtime permission. */
  ensureReady(): Promise<NotificationPermissionState>;
  /**
   * Replaces the pending pass notifications with `plan`: cancels previously
   * scheduled ones that dropped out and schedules the plan entries
   * (same id replaces the pending trigger in place).
   */
  applyPlan(plan: readonly PlannedNotification[]): Promise<void>;
}

export function createNotificationService(
  port: NotificationPort,
): NotificationService {
  return {
    async ensureReady() {
      await port.createChannel({ id: CHANNEL_ID, name: CHANNEL_NAME });
      const { granted } = await port.requestPermission();
      return { granted, message: granted ? null : PERMISSION_DENIED_MESSAGE };
    },
    async applyPlan(plan) {
      const planIds = new Set(plan.map(entry => entry.id));
      const existing = await port.getTriggerNotificationIds();
      const stale = existing.filter(
        id => id.startsWith(NOTIFICATION_ID_PREFIX) && !planIds.has(id),
      );
      if (stale.length > 0) {
        await port.cancelTriggerNotifications(stale);
      }
      for (const entry of plan) {
        await port.createTriggerNotification({
          id: entry.id,
          title: entry.title,
          body: entry.body,
          triggerAtMs: entry.triggerAtMs,
        });
      }
    },
  };
}

/** Adapts the real notifee module to `NotificationPort`. */
export function notifeePort(): NotificationPort {
  return {
    createChannel: channel =>
      notifee.createChannel({ id: channel.id, name: channel.name }),
    requestPermission: async () => ({
      granted:
        (await notifee.requestPermission()).authorizationStatus ===
        AuthorizationStatus.AUTHORIZED,
    }),
    createTriggerNotification: request =>
      notifee.createTriggerNotification(
        {
          id: request.id,
          title: request.title,
          body: request.body,
          android: { channelId: CHANNEL_ID },
        },
        { type: TriggerType.TIMESTAMP, timestamp: request.triggerAtMs },
      ),
    getTriggerNotificationIds: () => notifee.getTriggerNotificationIds(),
    cancelTriggerNotifications: ids => notifee.cancelTriggerNotifications(ids),
  };
}
