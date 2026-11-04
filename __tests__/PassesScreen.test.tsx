/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text } from 'react-native';

// The real module is native (Fabric view managers); the manual mock in
// __mocks__/react-native-svg provides no-op Svg/Circle/Polyline/Text.
jest.mock('react-native-svg');

import PassesScreen, {
  type ComputePasses,
  type PassesScreenProps,
} from '../src/screens/PassesScreen';
import { DataProviderContext } from '../src/dataProviderContext';
import type { AppDataProvider } from '../src/dataProviderContext';
import type { OrbitalRecord } from '../src/data';
import type { PassSummary } from '../src/passes';
import {
  DEFAULT_SATELLITE_NORAD_ID,
  setSelectedNoradId,
} from '../src/selection';

// ISS TLE A - satellite.js README example, epoch 2019-06-05T12:12:57.999883Z.
const ISS_RECORD: OrbitalRecord = {
  format: 'tle',
  noradId: 25544,
  name: 'ISS (ZARYA)',
  source: 'celestrak-gp',
  epoch: new Date('2019-06-05T12:12:58.000Z'),
  fetchedAt: new Date('2019-06-05T13:00:00.000Z'),
  payload: {
    line1:
      '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
    line2:
      '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
  },
};

// Fixed fake passes near the fixture epoch: the screen still samples the
// trajectory with the real engine, so SGP4 stays well-conditioned.
const PASS_A: PassSummary = {
  aosUtc: new Date('2019-06-05T13:32:00.469Z'),
  aosAzimuthDeg: 256.1,
  maxUtc: new Date('2019-06-05T13:34:42.018Z'),
  maxElevationDeg: 22.2,
  losUtc: new Date('2019-06-05T13:37:22.031Z'),
  losAzimuthDeg: 2.7,
  durationS: 322,
};

const PASS_B: PassSummary = {
  aosUtc: new Date('2019-06-06T04:34:02.344Z'),
  aosAzimuthDeg: 324.4,
  maxUtc: new Date('2019-06-06T04:37:22.870Z'),
  maxElevationDeg: 61.7,
  losUtc: new Date('2019-06-06T04:40:45.469Z'),
  losAzimuthDeg: 126.2,
  durationS: 403,
};

const NOW = new Date('2019-06-05T12:13:00.000Z');

function fakeProvider(): AppDataProvider {
  return {
    getCatalog: async () => [],
    getCatalogWithMeta: async () => ({
      value: [],
      fetchedAt: new Date(0),
      epoch: null,
      stale: false,
      ageMs: 0,
    }),
    getOrbitalData: async () => ISS_RECORD,
    getValidationPosition: async () => {
      throw new Error('not implemented');
    },
  };
}

const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
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

async function renderPasses(
  computePasses: ComputePasses,
  overrides: Partial<PassesScreenProps> = {},
) {
  const props = {
    navigation: { navigate: jest.fn() },
    route: { params: undefined },
    now: NOW,
    computePasses,
    ...overrides,
  } as unknown as PassesScreenProps;
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <DataProviderContext.Provider value={fakeProvider()}>
        <PassesScreen {...props} />
      </DataProviderContext.Provider>,
    );
  });
  if (!renderer) {
    throw new Error('PassesScreen renderer was not created');
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

describe('PassesScreen', () => {
  it('renders the pass rows with AOS, maximum, LOS and duration', async () => {
    const renderer = await renderPasses(() => [PASS_A, PASS_B]);
    const text = visibleText(renderer);
    expect(text).toContain('ISS (ZARYA)');
    expect(text).toContain('Elevación mínima:');
    expect(text).toContain('AOS: 2019-06-05T13:32:00.469Z · Az 256.1°');
    expect(text).toContain('Máximo: 2019-06-05T13:34:42.018Z · El 22.2°');
    expect(text).toContain('LOS: 2019-06-05T13:37:22.031Z · Az 2.7°');
    expect(text).toContain('Duración: 322 s');
    expect(text).toContain('AOS: 2019-06-06T04:34:02.344Z · Az 324.4°');
    expect(text).toContain('Duración: 403 s');
  });

  it('recomputes the pass list with the selected threshold chip', async () => {
    const computePasses = jest.fn<PassSummary[], Parameters<ComputePasses>>(
      () => [PASS_A],
    );
    const renderer = await renderPasses(computePasses);
    expect(computePasses).toHaveBeenCalledTimes(1);
    expect(computePasses.mock.calls[0][3]).toBe(10);

    ReactTestRenderer.act(() => {
      renderer.root
        .findByProps({ testID: 'threshold-chip-20' })
        .props.onPress();
    });

    expect(computePasses).toHaveBeenCalledTimes(2);
    expect(computePasses.mock.calls[1][3]).toBe(20);
  });

  it('shows the empty state when no passes are found', async () => {
    const renderer = await renderPasses(() => []);
    expect(visibleText(renderer)).toContain('Sin pases sobre el umbral');
    expect(visibleText(renderer)).not.toContain('AOS:');
  });

  it('switches the selected pass when a row is pressed', async () => {
    const renderer = await renderPasses(() => [PASS_A, PASS_B]);
    ReactTestRenderer.act(() => {
      renderer.root.findByProps({ testID: 'pass-row-1' }).props.onPress();
    });
    // Row selection only changes styling (the chart is mocked out); assert
    // the screen keeps rendering both rows after the state change.
    const text = visibleText(renderer);
    expect(text).toContain('Duración: 322 s');
    expect(text).toContain('Duración: 403 s');
  });
});
