import { Fragment, createElement } from 'react';
import type { PropsWithChildren } from 'react';

/**
 * Jest manual mock for the native `@maplibre/maplibre-react-native` module
 * (Fabric/TurboModules - jest must never load it). Placed in the root
 * `__mocks__` directory, jest applies it automatically to the package in
 * every suite. Each export is a distinct plain component that renders its
 * children, so tests can target one component type and inspect the nested
 * map layers (sources, layers, markers) as ordinary test instances.
 */
function mockComponent(name: string) {
  const Component = ({ children }: PropsWithChildren) =>
    createElement(Fragment, null, children);
  Component.displayName = name;
  return Component;
}

export const Map = mockComponent('Map');
export const Camera = mockComponent('Camera');
export const GeoJSONSource = mockComponent('GeoJSONSource');
export const Layer = mockComponent('Layer');
export const Marker = mockComponent('Marker');
