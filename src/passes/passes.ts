import { OrbitalError, lookAnglesAt } from '../orbital';
import type { ObserverGeodetic, Satrec } from '../orbital';

/**
 * One satellite pass: the contiguous interval where elevation stays at or
 * above the threshold (ARCHITECTURE.md §4). All instants are UTC Dates and
 * angles are degrees, matching the engine boundary. A pass already in
 * progress at the window start (or still up at the window end) is clipped to
 * the search window: its AOS/LOS then sits exactly on the window edge.
 */
export interface PassSummary {
  aosUtc: Date;
  aosAzimuthDeg: number;
  maxUtc: Date;
  maxElevationDeg: number;
  losUtc: Date;
  losAzimuthDeg: number;
  durationS: number;
}

/** One az/el sample of a pass trajectory (sky chart input). */
export interface TrajectorySample {
  timeUTC: Date;
  azimuthDeg: number;
  elevationDeg: number;
}

export interface PassSearchOptions {
  /** Minimum elevation (deg) that defines "visible"; 0..90, default 10. */
  minElevationDeg?: number;
  /** Maximum number of passes to return; default 5. */
  count?: number;
  /** Search window after `fromUtc` in seconds; default 48 h. */
  windowS?: number;
  /** Coarse scan step in seconds (ARCHITECTURE.md §4: 30 s); default 30. */
  coarseStepS?: number;
}

const DEFAULT_MIN_ELEVATION_DEG = 10;
const DEFAULT_COUNT = 5;
// ponytail: search window and pass count hardcoded as defaults; expose them
// in the settings screen only if the user actually asks for it.
const DEFAULT_WINDOW_S = 48 * 60 * 60;
const DEFAULT_COARSE_STEP_S = 30;
/** Bisection target precision for AOS/LOS (ARCHITECTURE.md §4: ~1 s). */
const REFINE_PRECISION_MS = 1000;
/** Fine sampling step used to locate the maximum elevation. */
const MAX_SCAN_STEP_MS = 5000;
// ponytail: sample caps keep the work bounded when a pass is clipped to the
// whole search window (always-visible object); upgrade to adaptive sampling
// only if chart detail measurably suffers.
const MAX_MAX_SCAN_SAMPLES = 512;
const MAX_TRAJECTORY_SAMPLES = 256;

function badInput(message: string): OrbitalError {
  return new OrbitalError('ORBIT_BAD_INPUT', message);
}

function assertInstant(value: Date, name: string): number {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw badInput(`${name} must be a valid Date (UTC instant).`);
  }
  return value.getTime();
}

/** Coarse-scan bracket around a threshold crossing: below/above at the ends. */
interface Crossing {
  loMs: number;
  hiMs: number;
}

function bisectCrossing(
  satrec: Satrec,
  observer: ObserverGeodetic,
  minElevationDeg: number,
  crossing: Crossing,
  rising: boolean,
): number {
  let lo = crossing.loMs;
  let hi = crossing.hiMs;
  while (hi - lo > REFINE_PRECISION_MS) {
    const midMs = Math.floor((lo + hi) / 2);
    const look = lookAnglesAt(satrec, observer, new Date(midMs));
    const above = look.elevationDeg >= minElevationDeg;
    if (above === rising) {
      hi = midMs;
    } else {
      lo = midMs;
    }
  }
  return Math.round((lo + hi) / 2);
}

/**
 * Maximum elevation over [aosMs, losMs]: argmax of fine samples plus a
 * parabolic vertex refinement on the argmax neighbours (deterministic; the
 * vertex is only applied for interior samples).
 */
function findMaxElevation(
  satrec: Satrec,
  observer: ObserverGeodetic,
  aosMs: number,
  losMs: number,
): { maxMs: number; maxElevationDeg: number } {
  const spanMs = Math.max(losMs - aosMs, 0);
  const n = Math.min(
    Math.max(1, Math.round(spanMs / MAX_SCAN_STEP_MS)),
    MAX_MAX_SCAN_SAMPLES,
  );
  const stepMs = spanMs / n;
  let bestIndex = 0;
  let bestMs = aosMs;
  let bestEl = -Infinity;
  for (let i = 0; i <= n; i += 1) {
    const tMs = aosMs + Math.round(i * stepMs);
    const look = lookAnglesAt(satrec, observer, new Date(tMs));
    if (look.elevationDeg > bestEl) {
      bestEl = look.elevationDeg;
      bestMs = tMs;
      bestIndex = i;
    }
  }
  if (bestIndex === 0 || bestIndex === n) {
    return { maxMs: bestMs, maxElevationDeg: bestEl };
  }
  const elBefore = lookAnglesAt(
    satrec,
    observer,
    new Date(aosMs + Math.round((bestIndex - 1) * stepMs)),
  ).elevationDeg;
  const elAfter = lookAnglesAt(
    satrec,
    observer,
    new Date(aosMs + Math.round((bestIndex + 1) * stepMs)),
  ).elevationDeg;
  const denominator = elBefore - 2 * bestEl + elAfter;
  if (denominator >= 0) {
    return { maxMs: bestMs, maxElevationDeg: bestEl };
  }
  const offsetMs = (stepMs * (elBefore - elAfter)) / (2 * denominator);
  if (!Number.isFinite(offsetMs) || Math.abs(offsetMs) > stepMs) {
    return { maxMs: bestMs, maxElevationDeg: bestEl };
  }
  return {
    maxMs: Math.round(bestMs + offsetMs),
    maxElevationDeg:
      bestEl -
      ((elBefore - elAfter) * (elBefore - elAfter)) /
        (8 * (elBefore - 2 * bestEl + elAfter)),
  };
}

function summarizePass(
  satrec: Satrec,
  observer: ObserverGeodetic,
  aosMs: number,
  losMs: number,
): PassSummary {
  const max = findMaxElevation(satrec, observer, aosMs, losMs);
  const aosLook = lookAnglesAt(satrec, observer, new Date(aosMs));
  const losLook = lookAnglesAt(satrec, observer, new Date(losMs));
  return {
    aosUtc: new Date(aosMs),
    aosAzimuthDeg: aosLook.azimuthDeg,
    maxUtc: new Date(max.maxMs),
    maxElevationDeg: max.maxElevationDeg,
    losUtc: new Date(losMs),
    losAzimuthDeg: losLook.azimuthDeg,
    durationS: Math.round((losMs - aosMs) / 1000),
  };
}

/**
 * Finds the next passes of `satrec` over `observer` starting at `fromUtc`
 * (ARCHITECTURE.md §4): coarse scan at `coarseStepS` detecting threshold
 * crossings, refined to ~1 s by bisection. Returns at most `count` passes;
 * an empty array means no pass rises above `minElevationDeg` in the window.
 * Throws `OrbitalError` (`ORBIT_BAD_INPUT`) for invalid options/instants and
 * for propagation failures surfacing from the engine.
 */
export function findUpcomingPasses(
  satrec: Satrec,
  observer: ObserverGeodetic,
  fromUtc: Date,
  options: PassSearchOptions = {},
): PassSummary[] {
  const { minElevationDeg, count, windowS, coarseStepS } = {
    minElevationDeg: options.minElevationDeg ?? DEFAULT_MIN_ELEVATION_DEG,
    count: options.count ?? DEFAULT_COUNT,
    windowS: options.windowS ?? DEFAULT_WINDOW_S,
    coarseStepS: options.coarseStepS ?? DEFAULT_COARSE_STEP_S,
  };
  if (
    !Number.isFinite(minElevationDeg) ||
    minElevationDeg < 0 ||
    minElevationDeg > 90
  ) {
    throw badInput('minElevationDeg must be a finite number in [0, 90].');
  }
  if (!Number.isInteger(count) || count < 1) {
    throw badInput('count must be an integer >= 1.');
  }
  if (!Number.isFinite(windowS) || windowS <= 0) {
    throw badInput('windowS must be a positive finite number.');
  }
  if (!Number.isFinite(coarseStepS) || coarseStepS <= 0) {
    throw badInput('coarseStepS must be a positive finite number.');
  }
  const fromMs = assertInstant(fromUtc, 'fromUtc');
  const stepMs = coarseStepS * 1000;
  const endMs = fromMs + windowS * 1000;

  const passes: PassSummary[] = [];
  const resolveAosMs = (aos: Crossing | 'clipped'): number =>
    // 'clipped': the window starts already above the threshold (AOS sits
    // before `fromUtc`), so the pass is reported clipped at the window edge.
    aos === 'clipped'
      ? fromMs
      : bisectCrossing(satrec, observer, minElevationDeg, aos, true);
  // Scan state; the AOS bracket only exists while a pass is in progress.
  let state: { kind: 'below' } | { kind: 'above'; aos: Crossing | 'clipped' } =
    lookAnglesAt(satrec, observer, new Date(fromMs)).elevationDeg >=
    minElevationDeg
      ? { kind: 'above', aos: 'clipped' }
      : { kind: 'below' };
  for (let tMs = fromMs + stepMs; tMs <= endMs; tMs += stepMs) {
    if (passes.length >= count) {
      break;
    }
    const look = lookAnglesAt(satrec, observer, new Date(tMs));
    const nowAbove = look.elevationDeg >= minElevationDeg;
    if (state.kind === 'below' && nowAbove) {
      state = { kind: 'above', aos: { loMs: tMs - stepMs, hiMs: tMs } };
    } else if (state.kind === 'above' && !nowAbove) {
      const losMs = bisectCrossing(
        satrec,
        observer,
        minElevationDeg,
        { loMs: tMs - stepMs, hiMs: tMs },
        false,
      );
      passes.push(
        summarizePass(satrec, observer, resolveAosMs(state.aos), losMs),
      );
      state = { kind: 'below' };
    }
  }
  if (state.kind === 'above' && passes.length < count) {
    // Still above the threshold at the window end: LOS clipped at the edge.
    passes.push(
      summarizePass(satrec, observer, resolveAosMs(state.aos), endMs),
    );
  }
  return passes;
}

/**
 * Samples az/el along a pass from `aosUtc` to `losUtc` for the sky chart:
 * evenly spaced samples including both endpoints, at most `stepS` apart
 * (bounded by MAX_TRAJECTORY_SAMPLES).
 */
export function samplePassTrajectory(
  satrec: Satrec,
  observer: ObserverGeodetic,
  aosUtc: Date,
  losUtc: Date,
  stepS = 10,
): TrajectorySample[] {
  const aosMs = assertInstant(aosUtc, 'aosUtc');
  const losMs = assertInstant(losUtc, 'losUtc');
  if (!Number.isFinite(stepS) || stepS <= 0) {
    throw badInput('stepS must be a positive finite number.');
  }
  if (losMs < aosMs) {
    throw badInput('losUtc must not precede aosUtc.');
  }
  const spanMs = losMs - aosMs;
  const n = Math.min(
    Math.max(1, Math.ceil(spanMs / (stepS * 1000))),
    MAX_TRAJECTORY_SAMPLES,
  );
  const samples: TrajectorySample[] = [];
  for (let i = 0; i <= n; i += 1) {
    const timeUTC = new Date(aosMs + Math.round((spanMs * i) / n));
    const look = lookAnglesAt(satrec, observer, timeUTC);
    samples.push({
      timeUTC,
      azimuthDeg: look.azimuthDeg,
      elevationDeg: look.elevationDeg,
    });
  }
  return samples;
}
