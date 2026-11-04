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

import MapScreen, { type MapScreenProps } from '../src/screens/MapScreen';
import { DataProviderContext } from '../src/dataProviderContext';
import type { AppDataProvider } from '../src/dataProviderContext';
import type { OrbitalRecord } from '../src/data';
import {
  DEFAULT_SATELLITE_NORAD_ID,
  setSelectedNoradId,
} from '../src/selection';

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

const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];

beforeEach(() => {
  // Fake time near the fixture epoch keeps SGP4 propagation well-conditioned
  // and pins the readout's UTC string.
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2019-06-05T12:13:00.000Z'));
  setSelectedNoradId(DEFAULT_SATELLITE_NORAD_ID);
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
