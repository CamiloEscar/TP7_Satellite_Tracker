/**
 * Constellation layer (RF-13, ARCHITECTURE.md §2): deterministic subset
 * selection, batch propagation at one timestamp and throttled state updates.
 * No Web Workers in React Native - batch + throttle is the strategy.
 */
export {
  CONSTELLATION_GROUP_CHIPS,
  DEFAULT_CONSTELLATION_GROUP,
  DEFAULT_CONSTELLATION_LIMIT,
  MAX_CONSTELLATION_LIMIT,
  MIN_CONSTELLATION_LIMIT,
  getConstellationGroup,
  getConstellationLimit,
  parseConstellationLimit,
  setConstellationGroup,
  setConstellationLimit,
  subscribeConstellationGroup,
  subscribeConstellationLimit,
} from './config';
export { loadConstellation } from './load';
export type { ConstellationDataSource } from './load';
export { buildConstellation, propagateConstellation } from './propagate';
export type { ConstellationDot, ConstellationObject } from './propagate';
export { selectConstellationSubset } from './subset';
export { createThrottle } from './throttle';
export type { ThrottledFn } from './throttle';
