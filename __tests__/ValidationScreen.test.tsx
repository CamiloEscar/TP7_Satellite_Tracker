/**
 * @format
 *
 * ValidationScreen tests (RF-15, Hito 10): mode selection, run action
 * through the injected provider ports, error-table rendering, export action
 * and the Spanish error copy. Offline: fakes only, the reference samples are
 * computed by the real engine so the machinery reports ~0 error.
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Share } from 'react-native';
import ValidationScreen from '../src/screens/ValidationScreen';
import { DataProviderContext } from '../src/dataProviderContext';
import type { AppDataProvider } from '../src/dataProviderContext';
import type { OrbitalRecord, TlePayload } from '../src/data';
import { DataError } from '../src/data';
import { createSatrecFromTle, lookAnglesAt, subpointAt } from '../src/orbital';
import { getObserver } from '../src/observer';
import { setSelectedNoradId } from '../src/selection';

// ISS TLE A - satellite.js README example, epoch 2019-06-05T12:12:57.999883Z.
const ISS_TLE_A: TlePayload = {
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

const issSatrec = createSatrecFromTle(ISS_TLE_A.line1, ISS_TLE_A.line2);

interface FakeProviderOptions {
  positionError?: DataError;
  missingPorts?: boolean;
}

interface RecordedCall {
  source: string;
  noradId: number;
  timestamp: Date;
}

function fakeProvider(options: FakeProviderOptions = {}): {
  provider: AppDataProvider;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  const provider: AppDataProvider = {
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
  if (!options.missingPorts) {
    provider.getValidationTle = async () => ISS_TLE_A;
    provider.getValidationPositionFrom = async (source, noradId, timestamp) => {
      calls.push({ source, noradId, timestamp });
      if (options.positionError) {
        throw options.positionError;
      }
      const subpoint = subpointAt(issSatrec, timestamp);
      const look = lookAnglesAt(issSatrec, getObserver(), timestamp);
      return {
        noradId,
        timestamp,
        latitudeDeg: subpoint.latitudeDeg,
        longitudeDeg: subpoint.longitudeDeg,
        altitudeKm: subpoint.altitudeKm,
        azimuthDeg: look.azimuthDeg,
        elevationDeg: look.elevationDeg,
      };
    };
  }
  return { provider, calls };
}

const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];

afterEach(() => {
  for (const renderer of mountedRenderers.splice(0)) {
    ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  }
  setSelectedNoradId(25544);
  jest.restoreAllMocks();
});

async function renderScreen(provider: AppDataProvider) {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(
      <DataProviderContext.Provider value={provider}>
        <ValidationScreen />
      </DataProviderContext.Provider>,
    );
  });
  mountedRenderers.push(renderer!);
  return renderer!;
}

function textOf(
  renderer: ReactTestRenderer.ReactTestRenderer,
  testID: string,
): string {
  const node = renderer.root.findByProps({ testID });
  return String(node.props.children ?? '');
}

describe('ValidationScreen', () => {
  it('renders the mode selector, the run action and the empty state', async () => {
    const { provider } = fakeProvider();
    const renderer = await renderScreen(provider);
    expect(renderer.root.findByProps({ testID: 'mode-chip-A' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'mode-chip-B' })).toBeTruthy();
    expect(renderer.root.findByProps({ testID: 'run-button' })).toBeTruthy();
    expect(
      renderer.root.findByProps({ testID: 'empty-message' }).props.children,
    ).toBe('Sin validaciones ejecutadas todavía.');
  });

  it('runs mode A against WTIA and renders the error table (3 samples)', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    const { provider, calls } = fakeProvider();
    const renderer = await renderScreen(provider);

    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({ testID: 'run-button' }).props.onPress();
    });

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.source).toBe('wtia');
      expect(call.noradId).toBe(25544); // mode A is ISS-only
    }
    for (let index = 0; index < 3; index += 1) {
      expect(
        renderer.root.findByProps({ testID: `table-row-${index}` }),
      ).toBeTruthy();
    }
    const summary = textOf(renderer, 'validation-summary');
    expect(summary).toContain('Muestras: 3');
    expect(summary).toContain('Error medio: 0.000 km');
    const elementSet = textOf(renderer, 'element-set');
    expect(elementSet).toContain('Set orbital: epoch');
  });

  it('runs mode B against N2YO for the selected satellite', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    setSelectedNoradId(25544);
    const { provider, calls } = fakeProvider();
    const renderer = await renderScreen(provider);

    await ReactTestRenderer.act(async () => {
      renderer.root.findByProps({ testID: 'mode-chip-B' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({ testID: 'run-button' }).props.onPress();
    });

    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.source).toBe('n2yo');
      expect(call.noradId).toBe(25544);
    }
  });

  it('exports the table as CSV and as Markdown', async () => {
    jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    const { provider } = fakeProvider();
    const renderer = await renderScreen(provider);

    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({ testID: 'run-button' }).props.onPress();
    });
    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({ testID: 'export-csv' }).props.onPress();
    });
    let exportText = textOf(renderer, 'export-text');
    expect(exportText).toContain(
      'timestamp_utc,error_km,altitude_delta_km,azimuth_delta_deg',
    );

    await ReactTestRenderer.act(async () => {
      await renderer.root
        .findByProps({ testID: 'export-markdown' })
        .props.onPress();
    });
    exportText = textOf(renderer, 'export-text');
    expect(exportText).toContain('# Tabla de errores - Modo A');
    expect(Share.share).toHaveBeenCalled();
  });

  it('shows the Spanish error copy when the provider fails (DATA_AUTH)', async () => {
    const { provider } = fakeProvider({
      positionError: new DataError(
        'DATA_AUTH',
        'N2YO API key is not configured.',
      ),
    });
    const renderer = await renderScreen(provider);

    await ReactTestRenderer.act(async () => {
      await renderer.root.findByProps({ testID: 'run-button' }).props.onPress();
    });

    expect(
      renderer.root.findByProps({ testID: 'error-message' }).props.children,
    ).toBe('Falta configurar la clave API de N2YO.');
    expect(renderer.root.findByProps({ testID: 'run-button' })).toBeTruthy();
  });
});
