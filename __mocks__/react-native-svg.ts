import type { PropsWithChildren } from 'react';

/**
 * Jest manual mock for the native `react-native-svg` module (Fabric view
 * managers - jest must never load it). Placed in the root `__mocks__`
 * directory like the MapLibre mock: Svg/Circle/Polyline/Text become plain
 * no-op components so tests stay pure JS.
 */
const Hidden = (_props: PropsWithChildren) => null;

export default Hidden;
export const Circle = Hidden;
export const Line = Hidden;
export const Polyline = Hidden;
export const Path = Hidden;
export const Text = Hidden;
