import type { PropsWithChildren } from 'react';

/**
 * Jest manual mock for the native `@maplibre/maplibre-react-native` module
 * (Fabric/TurboModules — jest must never load it). Placed in the root
 * `__mocks__` directory, jest applies it automatically to the package in
 * every suite (Map/Camera/GeoJSONSource/Layer/Marker become plain
 * components so tests stay pure JS).
 */
const Hidden = (_props: PropsWithChildren) => null;

export const Map = Hidden;
export const Camera = Hidden;
export const GeoJSONSource = Hidden;
export const Layer = Hidden;
export const Marker = Hidden;
