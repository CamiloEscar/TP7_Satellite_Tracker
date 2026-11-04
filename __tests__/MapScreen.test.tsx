/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';

// The real module is native (Fabric/TurboModules); the manual mock in
// __mocks__/@maplibre/maplibre-react-native provides plain
// Map/Camera/GeoJSONSource/Layer/Marker components.
jest.mock('@maplibre/maplibre-react-native');
// Svg components (CompassOverlay) and the native magnetometer both have
// manual mocks in __mocks__ (the sensors mock is controllable).
jest.mock('react-native-svg');
jest.mock('react-native-sensors');

import MapScreen, { type MapScreenProps } from '../src/screens/MapScreen';
import {
  DEFAULT_CONSTELLATION_GROUP,
  DEFAULT_CONSTELLATION_LIMIT,
  setConstellationGroup,
  setConstellationLimit,
} from '../src/constellation';
import { DataProviderContext } from '../src/dataProviderContext';
import type { AppDataProvider } from '../src/dataProviderContext';
import type { CatalogEntry, OrbitalRecord } from '../src/data';
import {
  DEFAULT_SATELLITE_NORAD_ID,
  setSelectedNoradId,
} from '../src/selection';

type SensorsMock = {
  __emitMagnetometer: (x: number, y: number) => void;
  __emitMagnetometerError: (error?: unknown) => void;
  __resetMagnetometer: () => void;
};

const sensorsMock = jest.requireMock<SensorsMock>('react-native-sensors');

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

const STARLINK_RECORD: OrbitalRecord = {
  format: 'tle',
  noradId: 48274,
  name: 'STARLINK-30000',
  source: 'celestrak-gp',
  epoch: new Date('2019-06-05T12:12:58.000Z'),
  fetchedAt: new Date('2019-06-05T13:00:00.000Z'),
  payload: ISS_TLE_A,
};

function fakeProvider(
  overrides: Partial<AppDataProvider> = {},
): AppDataProvider {
  return {
    getCatalog: async () => [],
    getCatalogWithMeta: async () => ({
      value: [],
      fetchedAt: new Date(0),
      epoch: null,
      stale: false,
      ageMs: 0,
    }),
    getOrbitalData: async (noradId: number) => {
      if (noradId === 48274) {
        return STARLINK_RECORD;
      }
      return ISS_RECORD;
    },
    getValidationPosition: async () => {
      throw new Error('not implemented');
    },
    ...overrides,
  };
}

function makeTleRecord(noradId: number, name: string): OrbitalRecord {
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

/** Mixed catalog: 3 Starlink + 1 weather, deliberately out of NORAD order. */
function constellationProvider(): AppDataProvider {
  return fakeProvider({
    getCatalog: async (): Promise<CatalogEntry[]> => [
      { noradId: 48276, name: 'STARLINK-30002', group: 'starlink' },
      { noradId: 48274, name: 'STARLINK-30000', group: 'starlink' },
      { noradId: 33591, name: 'NOAA 19', group: 'weather' },
      { noradId: 48275, name: 'STARLINK-30001', group: 'starlink' },
    ],
    getOrbitalData: async (noradId: number) =>
      noradId === DEFAULT_SATELLITE_NORAD_ID
        ? ISS_RECORD
        : makeTleRecord(noradId, `SAT-${noradId}`),
  });
}

/** NORAD ids of the rendered constellation dots, in source order. */
function dotsOf(renderer: ReactTestRenderer.ReactTestRenderer): number[] {
  const source = renderer.root.findByProps({ id: 'constellation-dots' });
  const data = source.props.data as GeoJSON.FeatureCollection;
  return data.features.map(
    feature => (feature.properties as { noradId: number }).noradId,
  );
}

async function tapConstellationDot(
  renderer: ReactTestRenderer.ReactTestRenderer,
  noradId: number,
) {
  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({ id: 'constellation-dots' }).props.onPress({
      nativeEvent: {
        features: [
          {
            type: 'Feature',
            properties: { noradId },
            geometry: { type: 'Point', coordinates: [0, 0] },
          },
        ],
      },
    });
  });
}

const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];

beforeEach(() => {
  // Fake time near the fixture epoch keeps SGP4 propagation well-conditioned
  // and pins the readout's UTC string.
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2019-06-05T12:13:00.000Z'));
  setSelectedNoradId(DEFAULT_SATELLITE_NORAD_ID);
  setConstellationLimit(DEFAULT_CONSTELLATION_LIMIT);
  setConstellationGroup(DEFAULT_CONSTELLATION_GROUP);
  sensorsMock.__resetMagnetometer();
});

afterEach(() => {
  for (const renderer of mountedRenderers.splice(0)) {
    ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  }
  jest.useRealTimers();
});

async function renderMap(
  provider: AppDataProvider,
  params?: { noradId: number },
) {
  const props = {
    navigation: { navigate: jest.fn() },
    route: { params },
  } as unknown as MapScreenProps;
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <DataProviderContext.Provider value={provider}>
        <MapScreen {...props} />
      </DataProviderContext.Provider>,
    );
  });
  if (!renderer) {
    throw new Error('MapScreen renderer was not created');
  }
  mountedRenderers.push(renderer);
  return renderer;
}

function visibleText(renderer: ReactTestRenderer.ReactTestRenderer): string {
  return renderer.root
    .findAllByType(Text)
    .map(node => node.props.children)
    .map(children => (Array.isArray(children) ? children.join('') : children))
    .join('\n');
}

async function press(
  renderer: ReactTestRenderer.ReactTestRenderer,
  testID: string,
) {
  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({ testID }).props.onPress();
  });
}

describe('MapScreen', () => {
  it('renders the position readout with UTC time for the selected satellite', async () => {
    const renderer = await renderMap(fakeProvider());
    const text = visibleText(renderer);
    expect(text).toContain('ISS (ZARYA)');
    expect(text).toContain('Lat:');
    expect(text).toContain('Lon:');
    expect(text).toContain('Alt:');
    expect(text).toContain('2019-06-05T12:13:00.000Z');
  });

  it('re-renders when the selected satellite changes', async () => {
    const renderer = await renderMap(fakeProvider());
    expect(visibleText(renderer)).toContain('ISS (ZARYA)');

    ReactTestRenderer.act(() => {
      setSelectedNoradId(48274);
    });
    await ReactTestRenderer.act(async () => {});

    const text = visibleText(renderer);
    expect(text).toContain('STARLINK-30000');
    expect(text).not.toContain('ISS (ZARYA)');
    expect(text).toContain('Lat:');
  });

  it('uses the noradId route param when provided', async () => {
    const renderer = await renderMap(fakeProvider(), { noradId: 48274 });
    expect(visibleText(renderer)).toContain('STARLINK-30000');
  });
});

describe('MapScreen - az/el readout and compass overlay', () => {
  it('renders the live az/el readout with a cardinal label', async () => {
    const renderer = await renderMap(fakeProvider());
    expect(visibleText(renderer)).toMatch(
      /Az: \d+\.\d° \((N|NE|E|SE|S|SW|W|NW)\) El: -?\d+\.\d°/,
    );
  });

  it('toggles the compass overlay with the Brújula button', async () => {
    const renderer = await renderMap(fakeProvider());
    // `testID` matches both the composite and its host node, so count > 0.
    const overlayNodes = () =>
      renderer.root.findAllByProps({ testID: 'compass-overlay' }).length;
    expect(overlayNodes()).toBe(0);

    await press(renderer, 'compass-toggle');
    expect(overlayNodes()).toBeGreaterThan(0);

    await press(renderer, 'compass-toggle');
    expect(overlayNodes()).toBe(0);
  });

  it('shows the declination-corrected true heading from the magnetometer', async () => {
    const renderer = await renderMap(fakeProvider());
    await press(renderer, 'compass-toggle');

    // Device top pointing to magnetic north (x=0, y=1) -> magnetic 0°;
    // with the default -10° declination the true heading is 350°.
    ReactTestRenderer.act(() => {
      sensorsMock.__emitMagnetometer(0, 1);
    });

    expect(visibleText(renderer)).toContain('Rumbo verdadero: 350.0° (N)');
  });

  it('falls back to a manual heading when the magnetometer is unavailable', async () => {
    const renderer = await renderMap(fakeProvider());
    await press(renderer, 'compass-toggle');

    ReactTestRenderer.act(() => {
      sensorsMock.__emitMagnetometerError();
    });

    expect(visibleText(renderer)).toContain('Magnetómetro no disponible');
    ReactTestRenderer.act(() => {
      renderer.root
        .findByProps({ testID: 'compass-manual-heading' })
        .props.onChangeText('90');
    });
    await press(renderer, 'compass-manual-apply');

    // Manual magnetic heading 90°; default -10° declination -> true 80°.
    expect(visibleText(renderer)).toContain('Rumbo verdadero: 80.0° (E)');
    expect(visibleText(renderer)).toContain('Ángulo al satélite:');
  });
});

describe('MapScreen - constellation layer', () => {
  it('renders the Starlink subset as dots ordered by NORAD ID', async () => {
    const renderer = await renderMap(constellationProvider());
    expect(dotsOf(renderer)).toEqual([48274, 48275, 48276]);
  });

  it('promotes a tapped constellation dot to the current selection', async () => {
    const renderer = await renderMap(constellationProvider());
    await tapConstellationDot(renderer, 48275);

    const text = visibleText(renderer);
    expect(text).toContain('SAT-48275');
    expect(text).toContain('(NORAD 48275)');
  });

  it('respects the configured object limit', async () => {
    setConstellationLimit(2);
    const renderer = await renderMap(constellationProvider());
    expect(dotsOf(renderer)).toEqual([48274, 48275]);
  });

  it('filters the dots by the configured group', async () => {
    setConstellationGroup('weather');
    const renderer = await renderMap(constellationProvider());
    expect(dotsOf(renderer)).toEqual([33591]);
  });

  it('keeps the selected satellite out of the dots (it has its own marker)', async () => {
    setSelectedNoradId(48274);
    const renderer = await renderMap(constellationProvider());
    expect(dotsOf(renderer)).toEqual([48275, 48276]);
  });
});
