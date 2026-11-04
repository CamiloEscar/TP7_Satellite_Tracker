/**
 * @format
 *
 * Pure scheduling tests for the notification layer: trigger = AOS - N
 * minutes, the overdue-pass skip edge rule, stable ids across re-planning,
 * plan ordering and leadMinutes bounds (mirroring `lookAnglesAt` style).
 */
import { OrbitalError } from '../../orbital';
import {
  NOTIFICATION_ID_PREFIX,
  NOTIFICATION_TITLE,
  planNotifications,
} from '../scheduling';
import type { PlannablePass } from '../scheduling';
import {
  DEFAULT_LEAD_MINUTES,
  MAX_LEAD_MINUTES,
  MIN_LEAD_MINUTES,
} from '../config';

const NOW = new Date('2026-11-04T12:00:00.000Z');

function pass(
  overrides: Partial<PlannablePass> & { aosIso: string },
): PlannablePass {
  return {
    noradId: overrides.noradId ?? 25544,
    name: overrides.name ?? 'ISS (ZARYA)',
    aosUtc: new Date(overrides.aosIso),
  };
}

function expectOrbitalError(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  if (!caught) {
    throw new Error(`Expected an OrbitalError with code ${code}.`);
  }
  expect(caught).toBeInstanceOf(OrbitalError);
  expect((caught as OrbitalError).code).toBe(code);
}

describe('planNotifications - trigger timing', () => {
  it('fires the trigger exactly N minutes before AOS', () => {
    const planned = planNotifications(
      [pass({ aosIso: '2026-11-04T13:00:00.000Z' })],
      NOW,
      10,
    );
    expect(planned).toHaveLength(1);
    expect(planned[0].triggerAtMs).toBe(
      Date.parse('2026-11-04T13:00:00.000Z') - 10 * 60000,
    );
  });

  it('shifts the trigger when the lead time changes', () => {
    const aosMs = Date.parse('2026-11-04T15:00:00.000Z');
    for (const leadMinutes of [MIN_LEAD_MINUTES, 30, MAX_LEAD_MINUTES]) {
      const planned = planNotifications(
        [pass({ aosIso: '2026-11-04T15:00:00.000Z' })],
        NOW,
        leadMinutes,
      );
      expect(planned[0].triggerAtMs).toBe(aosMs - leadMinutes * 60000);
    }
  });

  it('produces an empty plan for an empty pass list', () => {
    expect(planNotifications([], NOW, 10)).toEqual([]);
  });
});

describe('planNotifications - overdue pass edge rule', () => {
  it('skips a pass whose trigger is already in the past', () => {
    const planned = planNotifications(
      [pass({ aosIso: '2026-11-04T12:05:00.000Z' })],
      NOW,
      10,
    );
    expect(planned).toEqual([]);
  });

  it('skips an already-started pass (AOS before now) instead of firing late', () => {
    const planned = planNotifications(
      [pass({ aosIso: '2026-11-04T11:50:00.000Z' })],
      NOW,
      10,
    );
    expect(planned).toEqual([]);
  });

  it('keeps a trigger that lands exactly after now and drops one exactly at now', () => {
    const atNow = planNotifications(
      [pass({ aosIso: '2026-11-04T12:10:00.000Z' })],
      NOW,
      10,
    );
    expect(atNow).toEqual([]);
    const justFuture = planNotifications(
      [pass({ aosIso: '2026-11-04T12:10:00.001Z' })],
      NOW,
      10,
    );
    expect(justFuture).toHaveLength(1);
  });
});

describe('planNotifications - stable ids', () => {
  it('uses pass-{noradId}-{aosMs} ids that survive re-planning', () => {
    const passes = [
      pass({ noradId: 25544, aosIso: '2026-11-04T13:00:00.000Z' }),
      pass({ noradId: 25544, aosIso: '2026-11-04T15:00:00.000Z' }),
    ];
    const first = planNotifications(passes, NOW, 10);
    const second = planNotifications(passes, NOW, 30);
    expect(first.map(entry => entry.id)).toEqual(second.map(entry => entry.id));
    expect(first[0].id).toBe(
      `${NOTIFICATION_ID_PREFIX}25544-${Date.parse(
        '2026-11-04T13:00:00.000Z',
      )}`,
    );
  });
});

describe('planNotifications - ordering and copy', () => {
  it('orders the plan by trigger time regardless of input order', () => {
    const planned = planNotifications(
      [
        pass({ aosIso: '2026-11-04T15:00:00.000Z' }),
        pass({ aosIso: '2026-11-04T13:00:00.000Z' }),
        pass({ aosIso: '2026-11-04T14:00:00.000Z' }),
      ],
      NOW,
      10,
    );
    expect(planned.map(entry => entry.triggerAtMs)).toEqual([
      Date.parse('2026-11-04T12:50:00.000Z'),
      Date.parse('2026-11-04T13:50:00.000Z'),
      Date.parse('2026-11-04T14:50:00.000Z'),
    ]);
  });

  it('writes Spanish copy with the satellite name and AOS in UTC', () => {
    const [entry] = planNotifications(
      [
        pass({
          noradId: 48274,
          name: 'STARLINK-30000',
          aosIso: '2026-11-04T13:00:00.000Z',
        }),
      ],
      NOW,
      10,
    );
    expect(entry.title).toBe(NOTIFICATION_TITLE);
    expect(entry.body).toBe('STARLINK-30000: AOS 2026-11-04T13:00:00.000Z');
  });
});

describe('planNotifications - input validation', () => {
  it('rejects leadMinutes outside the integer range [1, 120]', () => {
    const passes = [pass({ aosIso: '2026-11-04T13:00:00.000Z' })];
    for (const bad of [
      0,
      MIN_LEAD_MINUTES - 1,
      MAX_LEAD_MINUTES + 1,
      1.5,
      NaN,
    ]) {
      expectOrbitalError(
        () => planNotifications(passes, NOW, bad),
        'ORBIT_BAD_INPUT',
      );
    }
  });

  it('accepts the inclusive bounds 1 and 120', () => {
    const passes = [pass({ aosIso: '2026-11-04T20:00:00.000Z' })];
    expect(planNotifications(passes, NOW, MIN_LEAD_MINUTES)).toHaveLength(1);
    expect(planNotifications(passes, NOW, MAX_LEAD_MINUTES)).toHaveLength(1);
  });

  it('rejects invalid instants (nowUtc, pass.aosUtc)', () => {
    const passes = [pass({ aosIso: '2026-11-04T13:00:00.000Z' })];
    expectOrbitalError(
      () => planNotifications(passes, new Date(NaN), 10),
      'ORBIT_BAD_INPUT',
    );
    expectOrbitalError(
      () =>
        planNotifications(
          [{ noradId: 25544, name: 'ISS', aosUtc: new Date(NaN) }],
          NOW,
          DEFAULT_LEAD_MINUTES,
        ),
      'ORBIT_BAD_INPUT',
    );
  });
});
