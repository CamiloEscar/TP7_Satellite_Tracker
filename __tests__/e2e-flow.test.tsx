/**
 * @format
 *
 * E2E walkthrough (logic level, Hito 10): catálogo -> selección -> datos del
 * mapa (marcador / ground track / footprint) -> constelación -> próximo pase
 * + sky chart -> programación de la notificación. Each step composes the REAL
 * modules of the app; only the native notification module is mocked (the
 * repo's manual mock). Visual verification on device stays (humano).
 */
import type { CatalogEntry, OrbitalRecord, TlePayload } from '../src/data';
import {
  DEFAULT_LEAD_MINUTES,
  NOTIFICATION_ID_PREFIX,
  createNotificationService,
  planNotifications,
} from '../src/notifications';
import type { NotificationPort, TriggerRequest } from '../src/notifications';
import {
  buildConstellation,
  propagateConstellation,
  selectConstellationSubset,
} from '../src/constellation';
import {
  footprintPolygonKm,
  footprintRadiusKm,
  sampleGroundTrack,
  splitAtAntimeridian,
} from '../src/geo';
import { createSatrecFromTle, lookAnglesAt, subpointAt } from '../src/orbital';
import type { Satrec } from '../src/orbital';
import {
  findUpcomingPasses,
  projectSkyPoint,
  samplePassTrajectory,
} from '../src/passes';
import { filterCatalog } from '../src/data';
import {
  DEFAULT_SATELLITE_NORAD_ID,
  getSelectedNoradId,
  setSelectedNoradId,
} from '../src/selection';

jest.mock('@notifee/react-native');

// ISS TLE A - satellite.js README example, epoch 2019-06-05T12:12:57.999883Z.
const ISS_TLE_A: TlePayload = {
  line1:
    '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  line2:
    '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
};

const CATALOG: CatalogEntry[] = [
  { noradId: 25544, name: 'ISS (ZARYA)', group: 'iss' },
  { noradId: 48274, name: 'STARLINK-30000', group: 'starlink' },
  { noradId: 48275, name: 'STARLINK-30001', group: 'starlink' },
  { noradId: 48276, name: 'STARLINK-30002', group: 'starlink' },
  { noradId: 32711, name: 'NOAA 19', group: 'weather' },
];

/** Buenos Aires, the app default observer. */
const BUENOS_AIRES = {
  latitudeDeg: -34.6037,
  longitudeDeg: -58.3816,
  altitudeKm: 0.025,
};

/** Fixed walk instant: right after the fixture element-set epoch. */
const WALK_UTC = new Date('2019-06-05T12:13:00.000Z');
const CHART_RADIUS = 120;

function tleRecord(noradId: number, name: string): OrbitalRecord {
  return {
    format: 'tle',
    noradId,
    name,
    source: 'celestrak-gp',
    epoch: new Date('2019-06-05T12:12:58.000Z'),
    fetchedAt: new Date('2019-06-05T13:00:00.000Z'),
    payload: ISS_TLE_A,
  };
}

function recordingPort(): {
  port: NotificationPort;
  scheduled: TriggerRequest[];
  cancelled: string[];
} {
  const scheduled: TriggerRequest[] = [];
  const cancelled: string[] = [];
  const port: NotificationPort = {
    createChannel: async () => 'pass-alerts',
    requestPermission: async () => ({ granted: true }),
    createTriggerNotification: async request => {
      scheduled.push(request);
      return request.id;
    },
    getTriggerNotificationIds: async () => scheduled.map(row => row.id),
    cancelTriggerNotifications: async ids => {
      cancelled.push(...ids);
    },
  };
  return { port, scheduled, cancelled };
}

afterEach(() => {
  setSelectedNoradId(DEFAULT_SATELLITE_NORAD_ID);
});

describe('E2E walkthrough (logic level)', () => {
  it('walks catalog -> selection -> map data -> constellation -> pass + sky chart -> notification', async () => {
    // --- 1. Catalog: search by name (RF-01) and pick the ISS.
    const results = filterCatalog(CATALOG, 'iss', 'all');
    expect(results.map(entry => entry.noradId)).toEqual([25544]);

    // --- 2. Selection store: the detail screen promotes the tapped entry.
    setSelectedNoradId(results[0].noradId);
    expect(getSelectedNoradId()).toBe(25544);

    // --- 3. Map data for the selected satellite (RF-02/10/11/12).
    const satrec: Satrec = createSatrecFromTle(
      ISS_TLE_A.line1,
      ISS_TLE_A.line2,
    );
    const marker = subpointAt(satrec, WALK_UTC);
    expect(Math.abs(marker.latitudeDeg)).toBeLessThanOrEqual(52);
    expect(marker.altitudeKm).toBeGreaterThan(350);
    expect(marker.altitudeKm).toBeLessThan(460);

    const track = sampleGroundTrack(satrec, WALK_UTC);
    expect(track.length).toBeGreaterThan(60);
    const segments = splitAtAntimeridian(track);
    for (const segment of segments) {
      for (let i = 1; i < segment.length; i += 1) {
        expect(
          Math.abs(segment[i].longitudeDeg - segment[i - 1].longitudeDeg),
        ).toBeLessThanOrEqual(180);
      }
    }

    const footprintRadius = footprintRadiusKm(marker.altitudeKm, 10);
    // ~1363 km at ~420 km altitude with a 10° minimum elevation (0° would be
    // ~2252 km; the geometry is locked in src/geo tests).
    expect(footprintRadius).toBeGreaterThan(1000);
    expect(footprintRadius).toBeLessThan(1600);
    const footprint = footprintPolygonKm(
      marker.latitudeDeg,
      marker.longitudeDeg,
      footprintRadius,
    );
    expect(footprint[0]).toEqual(footprint[footprint.length - 1]);

    // --- 4. Constellation layer (RF-13): deterministic subset + batch dots.
    const subset = selectConstellationSubset(CATALOG, 5, 'starlink');
    expect(subset.map(entry => entry.noradId)).toEqual([48274, 48275, 48276]);
    const objects = buildConstellation(
      subset.map(entry => tleRecord(entry.noradId, entry.name)),
    );
    const dots = propagateConstellation(objects, WALK_UTC);
    expect(dots).toHaveLength(3);
    for (const dot of dots) {
      expect(Number.isFinite(dot.latitudeDeg)).toBe(true);
      expect(Number.isFinite(dot.longitudeDeg)).toBe(true);
    }

    // --- 5. Next pass + sky chart (RF-04/05) for the selected satellite.
    const passes = findUpcomingPasses(satrec, BUENOS_AIRES, WALK_UTC, {
      minElevationDeg: 10,
      count: 2,
    });
    expect(passes.length).toBeGreaterThan(0);
    const pass = passes[0];
    expect(pass.losUtc.getTime()).toBeGreaterThan(pass.aosUtc.getTime());
    expect(pass.maxElevationDeg).toBeGreaterThanOrEqual(10);

    const trajectory = samplePassTrajectory(
      satrec,
      BUENOS_AIRES,
      pass.aosUtc,
      pass.losUtc,
    );
    expect(trajectory.length).toBeGreaterThan(2);
    for (const sample of trajectory) {
      const point = projectSkyPoint(
        sample.azimuthDeg,
        sample.elevationDeg,
        CHART_RADIUS,
      );
      expect(Math.hypot(point.x, point.y)).toBeLessThanOrEqual(
        CHART_RADIUS + 1e-9,
      );
    }

    // --- 6. Notification scheduling (RF-06): plan from the pass, then apply
    // through the real service (notifee seam mocked).
    const plan = planNotifications(
      [
        {
          noradId: getSelectedNoradId(),
          name: 'ISS (ZARYA)',
          aosUtc: pass.aosUtc,
        },
      ],
      WALK_UTC,
      DEFAULT_LEAD_MINUTES,
    );
    expect(plan).toHaveLength(1);
    expect(plan[0].id).toBe(
      `${NOTIFICATION_ID_PREFIX}25544-${pass.aosUtc.getTime()}`,
    );
    expect(plan[0].triggerAtMs).toBe(
      pass.aosUtc.getTime() - DEFAULT_LEAD_MINUTES * 60000,
    );

    const { port, scheduled } = recordingPort();
    const service = createNotificationService(port);
    const permission = await service.ensureReady();
    expect(permission.granted).toBe(true);
    await service.applyPlan(plan);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].id).toBe(plan[0].id);
    expect(scheduled[0].triggerAtMs).toBe(plan[0].triggerAtMs);
  });

  it('re-planning through the service replaces triggers in place (stable ids)', async () => {
    const { port, scheduled, cancelled } = recordingPort();
    const service = createNotificationService(port);
    const first = planNotifications(
      [
        {
          noradId: 25544,
          name: 'ISS (ZARYA)',
          aosUtc: new Date(WALK_UTC.getTime() + 7200000),
        },
        {
          noradId: 25544,
          name: 'ISS (ZARYA)',
          aosUtc: new Date(WALK_UTC.getTime() + 10800000),
        },
      ],
      WALK_UTC,
      DEFAULT_LEAD_MINUTES,
    );
    await service.applyPlan(first);
    expect(scheduled).toHaveLength(2);

    // The second pass dropped out of the plan (e.g. selection changed).
    const second = first.slice(0, 1);
    await service.applyPlan(second);
    expect(cancelled).toEqual([first[1].id]);
    // Same id replaces in place: the surviving entry is re-scheduled, not
    // duplicated under a new id.
    expect(scheduled.map(row => row.id)).toEqual([
      first[0].id,
      first[1].id,
      first[0].id,
    ]);
    expect(scheduled[0].id.startsWith(NOTIFICATION_ID_PREFIX)).toBe(true);
  });

  it('look angles in the walkthrough stay consistent with the engine boundary', () => {
    const satrec = createSatrecFromTle(ISS_TLE_A.line1, ISS_TLE_A.line2);
    const look = lookAnglesAt(satrec, BUENOS_AIRES, WALK_UTC);
    expect(look.azimuthDeg).toBeGreaterThanOrEqual(0);
    expect(look.azimuthDeg).toBeLessThan(360);
    expect(look.elevationDeg).toBeGreaterThanOrEqual(-90);
    expect(look.elevationDeg).toBeLessThanOrEqual(90);
  });
});
