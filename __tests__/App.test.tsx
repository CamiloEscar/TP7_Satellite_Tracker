/**
 * @format
 */

import React from 'react';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';
import { Text } from 'react-native';
import App from '../App';
import HomeScreen, { type HomeScreenProps } from '../src/screens/HomeScreen';

// The real bootstrap wires op-sqlite + network providers (native module);
// tests must never load it. The factory keeps the real module unimported.
jest.mock('../src/bootstrap', () => ({
  createDataProvider: () => ({
    getCatalog: async () => [],
    getCatalogWithMeta: async () => ({
      value: [],
      fetchedAt: new Date(0),
      epoch: null,
      stale: false,
      ageMs: 0,
    }),
    getOrbitalData: async () => {
      throw new Error('not implemented');
    },
    getValidationPosition: async () => {
      throw new Error('not implemented');
    },
  }),
  startBackgroundRefresh: () => {},
}));

function createHomeScreen() {
  const navigate = jest.fn();
  const props = { navigation: { navigate } } as unknown as HomeScreenProps;
  let renderer: ReactTestRenderer.ReactTestRenderer | undefined;
  ReactTestRenderer.act(() => {
    renderer = ReactTestRenderer.create(<HomeScreen {...props} />);
  });
  if (!renderer) {
    throw new Error('HomeScreen renderer was not created');
  }
  return { navigate, renderer };
}

test('renders without crashing', async () => {
  await ReactTestRenderer.act(async () => {
    ReactTestRenderer.create(<App />);
  });
});

test('home menu lists all screens', () => {
  const { renderer } = createHomeScreen();
  const titles = renderer.root
    .findAllByType(Text)
    .map(node => String(node.props.children));

  for (const title of [
    'Mapa',
    'Catálogo',
    'Pases',
    'Validación',
    'Configuración',
  ]) {
    expect(titles).toContain(title);
  }
});

test('tapping a menu entry navigates to its screen', () => {
  const { navigate, renderer } = createHomeScreen();
  let node: ReactTestInstance | null | undefined = renderer.root.findByProps({
    children: 'Mapa',
  });
  while (node && node.props.onPress === undefined) {
    node = node.parent;
  }
  expect(node).toBeDefined();

  ReactTestRenderer.act(() => {
    node?.props.onPress();
  });

  expect(navigate).toHaveBeenCalledWith('Mapa');
});
