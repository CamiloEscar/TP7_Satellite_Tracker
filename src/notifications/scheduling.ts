import { OrbitalError } from '../orbital';
import { MAX_LEAD_MINUTES, MIN_LEAD_MINUTES } from './config';

/**
 * Pure notification scheduling (ARCHITECTURE.md `notifications/` layer):
 * turns upcoming passes into an ordered plan of timestamped notifications.
 * No React Native, no notifee - the service layer applies the plan.
 */

/**
 * Prefix of every notification id produced here. Stable ids
 * (`pass-{noradId}-{aosMs}`) make re-planning replace pending triggers
 * instead of duplicating them.
 */
export const NOTIFICATION_ID_PREFIX = 'pass-';

/** Title copy for pass notifications (UI copy: Spanish). */
export const NOTIFICATION_TITLE = 'Próximo pase';

/**
 * The pass data a notification needs: satellite identity plus the AOS
 * instant. `background.ts` pairs `PassSummary` rows with the selected
 * satellite's record to build these.
 */
export interface PlannablePass {
  /** NORAD catalog id; part of the stable notification id. */
  noradId: number;
  /** Satellite display name (notification body copy). */
  name: string;
  /** AOS of the pass (UTC); the trigger fires `leadMinutes` before it. */
  aosUtc: Date;
}

/** One scheduled notification of the plan. */
export interface PlannedNotification {
  /** Stable id `pass-{noradId}-{aosMs}` (re-planning replaces in place). */
  id: string;
  /** When to fire: `aosMs - leadMinutes * 60000`. */
  triggerAtMs: number;
  title: string;
  body: string;
}

function badInput(message: string): OrbitalError {
  return new OrbitalError('ORBIT_BAD_INPUT', message);
}

function assertInstant(value: Date, name: string): number {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw badInput(`${name} must be a valid Date (UTC instant).`);
  }
  return value.getTime();
}

/**
 * Plans one notification per pass, each firing `leadMinutes` before its AOS
 * (`triggerAtMs = aosMs - leadMinutes * 60000`), ordered by trigger time.
 *
 * Edge rule: a trigger not strictly in the future is skipped - an
 * already-started/overdue pass is never fired late.
 *
 * Throws `OrbitalError` (`ORBIT_BAD_INPUT`) for `leadMinutes` outside the
 * integer range [MIN_LEAD_MINUTES, MAX_LEAD_MINUTES] or invalid instants,
 * mirroring `lookAnglesAt` validation style.
 */
export function planNotifications(
  passes: readonly PlannablePass[],
  nowUtc: Date,
  leadMinutes: number,
): PlannedNotification[] {
  if (
    !Number.isInteger(leadMinutes) ||
    leadMinutes < MIN_LEAD_MINUTES ||
    leadMinutes > MAX_LEAD_MINUTES
  ) {
    throw badInput(
      `leadMinutes must be an integer in [${MIN_LEAD_MINUTES}, ${MAX_LEAD_MINUTES}].`,
    );
  }
  const nowMs = assertInstant(nowUtc, 'nowUtc');
  const leadMs = leadMinutes * 60000;
  const planned: PlannedNotification[] = [];
  for (const pass of passes) {
    const aosMs = assertInstant(pass.aosUtc, 'pass.aosUtc');
    const triggerAtMs = aosMs - leadMs;
    if (triggerAtMs <= nowMs) {
      continue;
    }
    planned.push({
      id: `${NOTIFICATION_ID_PREFIX}${pass.noradId}-${aosMs}`,
      triggerAtMs,
      title: NOTIFICATION_TITLE,
      body: `${pass.name}: AOS ${pass.aosUtc.toISOString()}`,
    });
  }
  planned.sort((a, b) => a.triggerAtMs - b.triggerAtMs);
  return planned;
}
