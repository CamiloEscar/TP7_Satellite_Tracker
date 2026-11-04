/**
 * Notification layer: pure pass scheduling, the notifee-backed service and
 * the background-fetch refresh handler (ARCHITECTURE.md §2).
 */
export {
  DEFAULT_LEAD_MINUTES,
  MAX_LEAD_MINUTES,
  MIN_LEAD_MINUTES,
  getLeadMinutes,
  setLeadMinutes,
  subscribeLeadMinutes,
} from './config';
export {
  NOTIFICATION_ID_PREFIX,
  NOTIFICATION_TITLE,
  planNotifications,
} from './scheduling';
export type { PlannedNotification, PlannablePass } from './scheduling';
export {
  CHANNEL_ID,
  CHANNEL_NAME,
  PERMISSION_DENIED_MESSAGE,
  createNotificationService,
  notifeePort,
} from './service';
export type {
  NotificationPermissionState,
  NotificationPort,
  NotificationService,
  TriggerRequest,
} from './service';
export {
  createBackgroundFetchHandler,
  createHeadlessTask,
  createPassRefresh,
} from './background';
export type { PassRefreshDeps } from './background';
