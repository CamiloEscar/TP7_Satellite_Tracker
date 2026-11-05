/**
 * Validation layer (RF-15, ARCHITECTURE.md 2): comparison of local SGP4
 * propagation against independent sources (WTIA / N2YO), the error table
 * with element-set age and its CSV/Markdown exports. Pure TypeScript.
 */
export {
  MEAN_EARTH_RADIUS_KM,
  angleDeltaDeg,
  comparePositions,
  haversineKm,
} from './compare';
export type { GeodeticPoint, LookAngles, SampleComparison } from './compare';
export { VALIDATION_METHOD, buildErrorTable } from './table';
export type {
  BuildErrorTableInput,
  ElementSetInfo,
  ErrorSummary,
  ErrorTable,
  ErrorTableRow,
  ValidationMode,
  ValidationReference,
} from './table';
export { errorTableToCsv, errorTableToMarkdown } from './export';
export {
  ISS_NORAD_ID,
  runValidation,
  sourcesFromProvider,
} from './runValidation';
export type {
  RunValidationOptions,
  ValidationProviderSlice,
  ValidationSources,
} from './runValidation';
