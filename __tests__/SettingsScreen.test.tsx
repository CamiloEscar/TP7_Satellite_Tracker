/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { PermissionsAndroid, Text } from 'react-native';
import Geolocation from 'react-native-geolocation-service';

// The real module is native (RNFusedLocation TurboModule); the manual mock
// in __mocks__/react-native-geolocation-service provides jest.fn()s.
jest.mock('react-native-geolocation-service');
// The real notifee module is native (TurboModule bridge); the manual mock in
// __mocks__/@notifee/react-native provides a controllable fake.
jest.mock('@notifee/react-native');

import { AuthorizationStatus } from '@notifee/react-native';
import SettingsScreen from '../src/screens/SettingsScreen';
import {
  DEFAULT_CONSTELLATION_GROUP,
  DEFAULT_CONSTELLATION_LIMIT,
  getConstellationGroup,
  getConstellationLimit,
  setConstellationGroup,
  setConstellationLimit,
} from '../src/constellation';
import {
  DEFAULT_DECLINATION_DEG,
  DEFAULT_OBSERVER,
  getDeclinationDeg,
  getObserver,
  setDeclinationDeg,
  setObserver,
} from '../src/observer';
import {
  DEFAULT_LEAD_MINUTES,
  PERMISSION_DENIED_MESSAGE,
  getLeadMinutes,
  setLeadMinutes,
} from '../src/notifications';

type NotifeeMock = {
  __setAuthorizationStatus: (status: AuthorizationStatus) => void;
  __resetNotifee: () => void;
};

const notifeeMock = jest.requireMock<NotifeeMock>('@notifee/react-native');

type PermissionMap = Awaited<
  ReturnType<typeof PermissionsAndroid.requestMultiple>
>;

const GRANTED = {
  'android.permission.ACCESS_FINE_LOCATION': 'granted',
  'android.permission.ACCESS_COARSE_LOCATION': 'granted',
} as PermissionMap;

const DENIED = {
  'android.permission.ACCESS_FINE_LOCATION': 'denied',
  'android.permission.ACCESS_COARSE_LOCATION': 'denied',
} as PermissionMap;

const mountedRenderers: ReactTestRenderer.ReactTestRenderer[] = [];

beforeEach(() => {
  setObserver(DEFAULT_OBSERVER);
  setDeclinationDeg(DEFAULT_DECLINATION_DEG);
  setLeadMinutes(DEFAULT_LEAD_MINUTES);
  setConstellationLimit(DEFAULT_CONSTELLATION_LIMIT);
  setConstellationGroup(DEFAULT_CONSTELLATION_GROUP);
  notifeeMock.__resetNotifee();
  jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue(GRANTED);
  jest.mocked(Geolocation.getCurrentPosition).mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const renderer of mountedRenderers.splice(0)) {
    ReactTestRenderer.act(() => {
      renderer.unmount();
    });
  }
});

async function renderSettings() {
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    renderer = ReactTestRenderer.create(<SettingsScreen />);
  });
  if (!renderer) {
    throw new Error('SettingsScreen renderer was not created');
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

function setText(
  renderer: ReactTestRenderer.ReactTestRenderer,
  testID: string,
  value: string,
) {
  ReactTestRenderer.act(() => {
    renderer.root.findByProps({ testID }).props.onChangeText(value);
  });
}

async function press(
  renderer: ReactTestRenderer.ReactTestRenderer,
  testID: string,
) {
  await ReactTestRenderer.act(async () => {
    renderer.root.findByProps({ testID }).props.onPress();
  });
}

describe('SettingsScreen', () => {
  it('renders the observer readout, GPS button, manual form and declination input', async () => {
    const renderer = await renderSettings();
    const text = visibleText(renderer);
    expect(text).toContain('Ubicación del observador');
    expect(text).toContain('Lat:');
    expect(text).toContain('Usar GPS');
    expect(text).toContain('Guardar ubicación');
    expect(text).toContain('Brújula');
    expect(text).toContain('Declinación magnética (°)');
  });

  it('saves a valid manual location into the observer store', async () => {
    const renderer = await renderSettings();
    setText(renderer, 'manual-lat', '-31.4201');
    setText(renderer, 'manual-lon', '-64.1888');
    setText(renderer, 'manual-alt', '0.32');
    await press(renderer, 'save-manual-button');

    expect(getObserver()).toEqual({
      latitudeDeg: -31.4201,
      longitudeDeg: -64.1888,
      altitudeKm: 0.32,
    });
    expect(visibleText(renderer)).toContain('Ubicación guardada.');
  });

  it('rejects an out-of-range latitude without touching the store', async () => {
    const renderer = await renderSettings();
    setText(renderer, 'manual-lat', '91');
    await press(renderer, 'save-manual-button');

    expect(getObserver()).toEqual(DEFAULT_OBSERVER);
    expect(visibleText(renderer)).toContain(
      'Latitud fuera de rango (-90 a 90).',
    );
  });

  it('rejects out-of-range longitude and altitude with distinct messages', async () => {
    const renderer = await renderSettings();
    setText(renderer, 'manual-lon', '181');
    await press(renderer, 'save-manual-button');
    expect(visibleText(renderer)).toContain(
      'Longitud fuera de rango (-180 a 180).',
    );

    setText(renderer, 'manual-lon', '-58.3816');
    setText(renderer, 'manual-alt', '250');
    await press(renderer, 'save-manual-button');
    expect(visibleText(renderer)).toContain(
      'Altitud fuera de rango (-1 a 100 km).',
    );
    expect(getObserver()).toEqual(DEFAULT_OBSERVER);
  });

  it('writes a GPS fix into the observer store', async () => {
    jest.mocked(Geolocation.getCurrentPosition).mockImplementation(success => {
      success({
        coords: {
          latitude: -31.4201,
          longitude: -64.1888,
          accuracy: 5,
          altitude: 320,
          heading: null,
          speed: null,
        },
        timestamp: 0,
      });
    });
    const renderer = await renderSettings();
    await press(renderer, 'use-gps-button');

    expect(getObserver()).toEqual({
      latitudeDeg: -31.4201,
      longitudeDeg: -64.1888,
      altitudeKm: 0.32,
    });
    expect(visibleText(renderer)).toContain('Ubicación actualizada por GPS.');
  });

  it('shows the permission-denied state without calling getCurrentPosition', async () => {
    jest.spyOn(PermissionsAndroid, 'requestMultiple').mockResolvedValue(DENIED);
    const renderer = await renderSettings();
    await press(renderer, 'use-gps-button');

    expect(jest.mocked(Geolocation.getCurrentPosition)).not.toHaveBeenCalled();
    expect(getObserver()).toEqual(DEFAULT_OBSERVER);
    expect(visibleText(renderer)).toContain(
      'Permiso de ubicación rechazado. Use la ubicación manual.',
    );
  });

  it('shows a distinct message per GPS error code', async () => {
    const renderer = await renderSettings();

    jest
      .mocked(Geolocation.getCurrentPosition)
      .mockImplementation((_success, error) => {
        error?.({ code: 1, message: 'denied' });
      });
    await press(renderer, 'use-gps-button');
    expect(visibleText(renderer)).toContain(
      'Permiso de ubicación rechazado. Use la ubicación manual.',
    );

    jest
      .mocked(Geolocation.getCurrentPosition)
      .mockImplementation((_success, error) => {
        error?.({ code: 2, message: 'unavailable' });
      });
    await press(renderer, 'use-gps-button');
    expect(visibleText(renderer)).toContain('Posición no disponible');

    jest
      .mocked(Geolocation.getCurrentPosition)
      .mockImplementation((_success, error) => {
        error?.({ code: 3, message: 'timeout' });
      });
    await press(renderer, 'use-gps-button');
    expect(visibleText(renderer)).toContain('Sin señal GPS');
  });

  it('saves a valid magnetic declination into the config store', async () => {
    const renderer = await renderSettings();
    setText(renderer, 'declination-input', '5');
    await press(renderer, 'save-declination-button');

    expect(getDeclinationDeg()).toBe(5);
    expect(visibleText(renderer)).toContain('Declinación guardada: 5°');
  });

  it('rejects an out-of-range declination', async () => {
    const renderer = await renderSettings();
    setText(renderer, 'declination-input', '200');
    await press(renderer, 'save-declination-button');

    expect(getDeclinationDeg()).toBe(DEFAULT_DECLINATION_DEG);
    expect(visibleText(renderer)).toContain(
      'Declinación fuera de rango (-180 a 180).',
    );
  });

  it('saves a valid notification lead time into the config store', async () => {
    const renderer = await renderSettings();
    setText(renderer, 'lead-input', '15');
    await press(renderer, 'save-lead-button');

    expect(getLeadMinutes()).toBe(15);
    expect(visibleText(renderer)).toContain('Aviso guardado: 15 min');
  });

  it('rejects out-of-range or non-integer lead minutes without touching the store', async () => {
    const renderer = await renderSettings();
    for (const bad of ['0', '121', '7.5', '']) {
      setText(renderer, 'lead-input', bad);
      await press(renderer, 'save-lead-button');
      expect(getLeadMinutes()).toBe(DEFAULT_LEAD_MINUTES);
      expect(visibleText(renderer)).toContain(
        'Minutos de aviso fuera de rango (1 a 120).',
      );
    }
  });

  it('shows the Spanish permission-denied message in the notifications section', async () => {
    notifeeMock.__setAuthorizationStatus(AuthorizationStatus.DENIED);
    const renderer = await renderSettings();

    expect(visibleText(renderer)).toContain(PERMISSION_DENIED_MESSAGE);
  });

  it('shows no permission message when notifications are allowed', async () => {
    const renderer = await renderSettings();

    expect(visibleText(renderer)).not.toContain(PERMISSION_DENIED_MESSAGE);
  });
});

describe('SettingsScreen - constellation settings', () => {
  it('renders the constellation section with group chips and the limit input', async () => {
    const renderer = await renderSettings();
    const text = visibleText(renderer);
    expect(text).toContain('Capa de constelación');
    expect(text).toContain('Grupo');
    expect(text).toContain('Starlink');
    expect(text).toContain('Límite de objetos');
    expect(text).toContain('Guardar límite');
  });

  it('saves a valid object limit into the config store', async () => {
    const renderer = await renderSettings();
    setText(renderer, 'constellation-limit-input', '75');
    await press(renderer, 'constellation-limit-save');

    expect(getConstellationLimit()).toBe(75);
    expect(visibleText(renderer)).toContain('Límite guardado: 75 objetos.');
  });

  it('rejects an invalid object limit without touching the store', async () => {
    const renderer = await renderSettings();
    for (const bad of ['0', '101', '7.5', 'abc', '']) {
      setText(renderer, 'constellation-limit-input', bad);
      await press(renderer, 'constellation-limit-save');
      expect(getConstellationLimit()).toBe(DEFAULT_CONSTELLATION_LIMIT);
      expect(visibleText(renderer)).toContain(
        'Límite fuera de rango (1 a 100).',
      );
    }
  });

  it('saves the selected constellation group chip into the config store', async () => {
    const renderer = await renderSettings();
    await press(renderer, 'constellation-group-iss');

    expect(getConstellationGroup()).toBe('iss');
    await press(renderer, 'constellation-group-all');
    expect(getConstellationGroup()).toBe('all');
  });
});
