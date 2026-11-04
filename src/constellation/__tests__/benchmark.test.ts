import type { OrbitalRecord } from '../../data/types';
import { buildConstellation, propagateConstellation } from '../index';
import type { ConstellationObject } from '../index';

/**
 * Deterministic batch-propagation benchmark (Hito 9 perf measurement):
 * fixed fixtures, fixed timestamp, median of 21 runs at the configured
 * limits. The medians are registered in IMPLEMENTATION_PLAN.md; the ceiling
 * assertion is deliberately generous (regression guard, not a timing test).
 */

// ISS TLE A - satellite.js README example, epoch 2019-06-05T12:12:57.999883Z.
const ISS_TLE_A = {
  line1:
    '1 25544U 98067A   19156.50900463  .00003075  00000-0  59442-4 0  9992',
  line2:
    '2 25544  51.6433  59.2583 0008217  16.4489 347.6017 15.51174618173442',
};

const WHEN_UTC = new Date('2019-06-05T12:13:00.000Z');
const RUNS = 21;
// ponytail: generous ceiling (~600x the measured median) - only catches a
// pathological regression; the real numbers live in the tracker.
const CEILING_MS = 250;

// jest exposes the node performance clock; the project has no @types/node.
declare const performance: { now(): number };

function buildObjects(count: number): ConstellationObject[] {
  const records: OrbitalRecord[] = [];
  for (let i = 0; i < count; i += 1) {
    records.push({
      format: 'tle',
      noradId: 40000 + i,
      name: `BENCH-${40000 + i}`,
      source: 'celestrak-gp',
      epoch: new Date('2019-06-05T12:12:58.000Z'),
      fetchedAt: new Date('2019-06-05T13:00:00.000Z'),
      payload: ISS_TLE_A,
    });
  }
  return buildConstellation(records);
}

function medianMs(objects: ConstellationObject[]): number {
  // Warmup for the JIT so the medians measure steady state.
  for (let i = 0; i < 3; i += 1) {
    propagateConstellation(objects, WHEN_UTC);
  }
  const times: number[] = [];
  for (let run = 0; run < RUNS; run += 1) {
    const start = performance.now();
    propagateConstellation(objects, WHEN_UTC);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(RUNS / 2)];
}

describe('constellation batch propagation benchmark', () => {
  it.each([50, 100])(
    'propagates %i objects at one timestamp within the ceiling',
    count => {
      const objects = buildObjects(count);
      const median = medianMs(objects);
      console.log(
        `constellation benchmark: N=${count} median ${median.toFixed(3)} ms ` +
          `(${(median / count).toFixed(4)} ms/object)`,
      );
      const dots = propagateConstellation(objects, WHEN_UTC);
      expect(dots).toHaveLength(count);
      expect(median).toBeLessThan(CEILING_MS);
    },
  );
});
