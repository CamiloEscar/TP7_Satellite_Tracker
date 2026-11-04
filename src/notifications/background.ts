import BackgroundFetch from 'react-native-background-fetch';
import type { HeadlessEvent } from 'react-native-background-fetch';
import type { DataProvider, OrbitalRecord } from '../data';
import { getObserver } from '../observer';
import { createSatrecFromOmm, createSatrecFromTle } from '../orbital';
import type { Satrec } from '../orbital';
import { findUpcomingPasses } from '../passes';
import { getLeadMinutes } from './config';
import { planNotifications } from './scheduling';
import type { PlannablePass } from './scheduling';
import type { NotificationService } from './service';

/**
 * Background refresh (react-native-background-fetch): recompute upcoming
 * passes and refresh the selected satellite's orbital set. The handler runs
 * outside React: everything it needs is injected from the composition root
 * (`src/bootstrap.ts`), never from `src/dataProviderContext.ts`.
 */

/** Dependencies injected by the composition root. */
export interface PassRefreshDeps {
  /** TTL-expired orbital sets refresh themselves inside `getOrbitalData`. */
  provider: Pick<DataProvider, 'getOrbitalData'>;
  /** Selected-satellite resolver (`src/selection.ts`); null = no selection. */
  getSelectedNoradId: () => number | null;
  service: Pick<NotificationService, 'applyPlan'>;
  /** Injectable UTC clock for deterministic tests. Defaults to `new Date()`. */
  now?: () => Date;
}

function satrecFromRecord(record: OrbitalRecord): Satrec {
  return record.format === 'omm'
    ? createSatrecFromOmm(record.payload)
    : createSatrecFromTle(record.payload.line1, record.payload.line2);
}

async function refreshPasses(deps: PassRefreshDeps): Promise<void> {
  const nowUtc = deps.now ? deps.now() : new Date();
  const noradId = deps.getSelectedNoradId();
  if (noradId == null) {
    // No selection: no notifications (documented edge rule).
    return;
  }
  const record = await deps.provider.getOrbitalData(noradId);
  const passes = findUpcomingPasses(
    satrecFromRecord(record),
    getObserver(),
    nowUtc,
  );
  const plannable: PlannablePass[] = passes.map(pass => ({
    noradId: record.noradId,
    name: record.name,
    aosUtc: pass.aosUtc,
  }));
  await deps.service.applyPlan(
    planNotifications(plannable, nowUtc, getLeadMinutes()),
  );
}

/**
 * Refresh routine for selection changes and other non-fetch triggers. Never
 * rejects: background work must not break its caller.
 */
export function createPassRefresh(deps: PassRefreshDeps): () => Promise<void> {
  return async () => {
    try {
      await refreshPasses(deps);
    } catch (error) {
      console.warn('[notifications] pass refresh failed', error);
    }
  };
}

/**
 * background-fetch `onEvent` handler factory: refreshes, then finishes the
 * fetch event per the background-fetch API (always, even on failure).
 */
export function createBackgroundFetchHandler(
  deps: PassRefreshDeps,
): (taskId: string) => Promise<void> {
  const refresh = createPassRefresh(deps);
  return async taskId => {
    await refresh();
    BackgroundFetch.finish(taskId);
  };
}

/**
 * Headless task for events fired after app termination (Android). A timeout
 * signal means background time is gone: finish immediately.
 */
export function createHeadlessTask(
  deps: PassRefreshDeps,
): (event: HeadlessEvent) => Promise<void> {
  const refresh = createPassRefresh(deps);
  return async event => {
    if (!event.timeout) {
      await refresh();
    }
    BackgroundFetch.finish(event.taskId);
  };
}
