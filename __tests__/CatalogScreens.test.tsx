/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Text, TextInput } from 'react-native';
import CatalogScreen, {
  type CatalogScreenProps,
} from '../src/screens/CatalogScreen';
import CatalogDetailScreen, {
  type CatalogDetailScreenProps,
} from '../src/screens/CatalogDetailScreen';
import { DataProviderContext } from '../src/dataProviderContext';
import type { AppDataProvider } from '../src/dataProviderContext';
import type { CacheHit, CatalogEntry, OrbitalRecord } from '../src/data';
import type { OmmJson } from '../src/orbital/types';

const ENTRIES: CatalogEntry[] = [
  { noradId: 25544, name: 'ISS (ZARYA)', group: 'iss' },
  { noradId: 48274, name: 'STARLINK-30000', group: 'starlink' },
  { noradId: 32711, name: 'NOAA 19', group: 'weather' },
];

const HOUR_MS = 3600000;

// FlatList schedules a delayed cell-batch update; unmounting in afterEach
// clears that pending timer so it cannot fire after the test is done.
const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  for (const renderer of mountedRenderers.splice(0)) {
    ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  }
});

function catalogHit(ageMs: number): CacheHit<CatalogEntry[]> {
  return {
    value: ENTRIES,
    fetchedAt: new Date('2026-11-03T09:00:00.000Z'),
    epoch: null,
    stale: false,
    ageMs,
  };
}

function fakeProvider(
  overrides: Partial<AppDataProvider> = {},
): AppDataProvider {
  return {
    getCatalog: async () => ENTRIES,
    getCatalogWithMeta: async () => catalogHit(3 * HOUR_MS),
    getOrbitalData: async () => {
      throw new Error('not implemented');
    },
    getValidationPosition: async () => {
      throw new Error('not implemented');
    },
    ...overrides,
  };
}

const RECORD: OrbitalRecord = {
  format: 'omm',
  noradId: 25544,
  name: 'ISS (ZARYA)',
  source: 'celestrak-gp',
  epoch: new Date('2026-11-01T10:00:00.000Z'),
  fetchedAt: new Date('2026-11-03T09:30:00.000Z'),
  payload: {} as OmmJson,
};

async function renderCatalog(provider: AppDataProvider) {
  const navigate = jest.fn();
  const props = {
    navigation: { navigate },
  } as unknown as CatalogScreenProps;
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <DataProviderContext.Provider value={provider}>
        <CatalogScreen {...props} />
      </DataProviderContext.Provider>,
    );
  });
  if (!renderer) {
    throw new Error('CatalogScreen renderer was not created');
  }
  mountedRenderers.push(renderer);
  return { navigate, renderer };
}

async function renderDetail(provider: AppDataProvider) {
  const props = {
    navigation: { navigate: jest.fn() },
    route: { params: { noradId: 25544, name: 'ISS (ZARYA)' } },
  } as unknown as CatalogDetailScreenProps;
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <DataProviderContext.Provider value={provider}>
        <CatalogDetailScreen {...props} />
      </DataProviderContext.Provider>,
    );
  });
  if (!renderer) {
    throw new Error('CatalogDetailScreen renderer was not created');
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

function pressLabel(
  renderer: ReactTestRenderer.ReactTestRenderer,
  label: string,
) {
  let node: ReactTestRenderer.ReactTestInstance | null | undefined =
    renderer.root.findByProps({ children: label });
  while (node && node.props.onPress === undefined) {
    node = node.parent;
  }
  if (!node) {
    throw new Error(`No pressable found for label: ${label}`);
  }
  ReactTestRenderer.act(() => {
    node?.props.onPress();
  });
}

describe('CatalogScreen', () => {
  it('renders catalog entries from the provider', async () => {
    const { renderer } = await renderCatalog(fakeProvider());
    const text = visibleText(renderer);
    expect(text).toContain('ISS (ZARYA)');
    expect(text).toContain('STARLINK-30000');
    expect(text).toContain('NOAA 19');
    expect(text).toContain('NORAD 25544');
    expect(text).toContain('Datos: hace 3 h');
    expect(
      renderer.root.findAllByProps({ testID: 'age-warning' }),
    ).toHaveLength(0);
  });

  it('narrows the list when searching by name', async () => {
    const { renderer } = await renderCatalog(fakeProvider());
    const input = renderer.root.findByType(TextInput);
    ReactTestRenderer.act(() => {
      input.props.onChangeText('starlink');
    });
    const text = visibleText(renderer);
    expect(text).toContain('STARLINK-30000');
    expect(text).not.toContain('ISS (ZARYA)');
    expect(text).not.toContain('NOAA 19');
  });

  it('narrows the list when searching by NORAD ID', async () => {
    const { renderer } = await renderCatalog(fakeProvider());
    const input = renderer.root.findByType(TextInput);
    ReactTestRenderer.act(() => {
      input.props.onChangeText('255');
    });
    const text = visibleText(renderer);
    expect(text).toContain('ISS (ZARYA)');
    expect(text).not.toContain('STARLINK-30000');
    expect(text).not.toContain('NOAA 19');
  });

  it('narrows the list with the group filter chips', async () => {
    const { renderer } = await renderCatalog(fakeProvider());
    pressLabel(renderer, 'Meteorológicos');
    const text = visibleText(renderer);
    expect(text).toContain('NOAA 19');
    expect(text).not.toContain('ISS (ZARYA)');
    expect(text).not.toContain('STARLINK-30000');
  });

  it('shows the over-TTL warning when the data is stale', async () => {
    const provider = fakeProvider({
      getCatalogWithMeta: async () => catalogHit(25 * HOUR_MS),
    });
    const { renderer } = await renderCatalog(provider);
    expect(
      renderer.root.findAllByProps({ testID: 'age-warning' }).length,
    ).toBeGreaterThan(0);
    expect(visibleText(renderer)).toContain('Datos desactualizados');
    expect(visibleText(renderer)).toContain('Datos: hace 1 d');
  });

  it('navigates to the detail screen on row tap', async () => {
    const { navigate, renderer } = await renderCatalog(fakeProvider());
    pressLabel(renderer, 'ISS (ZARYA)');
    expect(navigate).toHaveBeenCalledWith('CatalogDetail', {
      noradId: 25544,
      name: 'ISS (ZARYA)',
    });
  });
});

describe('CatalogDetailScreen', () => {
  it('renders NORAD ID, epoch, source and fetch date from the provider', async () => {
    const provider = fakeProvider({
      getOrbitalData: async () => RECORD,
    });
    const renderer = await renderDetail(provider);
    const text = visibleText(renderer);
    expect(text).toContain('NORAD ID: 25544');
    expect(text).toContain('Epoch (UTC): 2026-11-01T10:00:00.000Z');
    expect(text).toContain('Fuente: celestrak-gp');
    expect(text).toContain('Descargado (UTC): 2026-11-03T09:30:00.000Z');
  });

  it('shows the error state when the provider fails', async () => {
    const provider = fakeProvider({
      getOrbitalData: async () => {
        throw new Error('offline');
      },
    });
    const renderer = await renderDetail(provider);
    expect(visibleText(renderer)).toContain(
      'No se pudieron cargar los datos orbitales.',
    );
  });
});
