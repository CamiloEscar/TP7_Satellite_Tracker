import { View } from 'react-native';

/**
 * Jest manual mock for the native `react-native-maps` module. Placed in the
 * root `__mocks__` directory, jest applies it automatically to the node
 * module in every suite (MapView/Marker/Polyline/Circle become plain
 * components so tests stay pure JS).
 */
const Hidden = () => null;

export const Marker = Hidden;
export const Polyline = Hidden;
export const Circle = Hidden;
export default View;
