import type { Clock, DataErrorCode } from '../types';
import { DataError } from '../types';
import {
  DEFAULT_RATE_LIMITS,
  RateLimiter,
  retryAfterMsFromHeaders,
  withRetry,
} from '../rateLimiter';

// --- Helpers (local fakes only; no real timers) --------------------------------

function makeClock(startMs: number): {
  clock: Clock;
  advance(ms: number): void;
} {
  let now = startMs;
  return {
    clock: { now: () => now },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function makeSleepRecorder(): {
  sleep: (ms: number) => Promise<void>;
  delays: number[];
} {
  const delays: number[] = [];
  return {
    delays,
    sleep: async (ms: number) => {
      delays.push(ms);
    },
  };
}

function expectDataError(e: unknown, code: DataErrorCode): void {
  expect(e).toBeInstanceOf(DataError);
  expect((e as DataError).code).toBe(code);
}

// --- RateLimiter ---------------------------------------------------------------

describe('RateLimiter', () => {
  it('rejects calls over the sliding-window limit and recovers after it slides', () => {
    const { clock, advance } = makeClock(100000);
    const limiter = new RateLimiter(clock, {
      demo: { maxRequests: 2, windowMs: 1000 },
    });
    limiter.acquire('demo');
    limiter.acquire('demo');
    let caught: unknown;
    try {
      limiter.acquire('demo');
    } catch (e) {
      caught = e;
    }
    expectDataError(caught, 'DATA_RATE_LIMITED');
    advance(1001);
    expect(() => limiter.acquire('demo')).not.toThrow();
  });

  it('keeps separate buckets per provider and transaction class', () => {
    const { clock } = makeClock(200000);
    const limiter = new RateLimiter(clock); // default limits
    limiter.acquire('wtia');
    let caught: unknown;
    try {
      limiter.acquire('wtia'); // WTIA allows 1 req/s
    } catch (e) {
      caught = e;
    }
    expectDataError(caught, 'DATA_RATE_LIMITED');
    // N2YO positions (1000/h) and passes (100/h) are independent buckets.
    expect(() => limiter.acquire('n2yo-positions')).not.toThrow();
    expect(() => limiter.acquire('n2yo-passes')).not.toThrow();
    expect(DEFAULT_RATE_LIMITS.spacetrack.maxRequests).toBe(30);
  });

  it('rejects unknown buckets', () => {
    const { clock } = makeClock(0);
    const limiter = new RateLimiter(clock);
    expect(() => limiter.acquire('nope')).toThrow(/Unknown rate-limit bucket/);
  });
});

// --- withRetry -----------------------------------------------------------------

describe('withRetry', () => {
  it('retries transient failures with bounded exponential backoff', async () => {
    const { sleep, delays } = makeSleepRecorder();
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new DataError('DATA_NETWORK', 'boom 1'))
      .mockRejectedValueOnce(new DataError('DATA_RATE_LIMITED', 'boom 2'))
      .mockResolvedValue('ok');
    await expect(withRetry(fn, { sleep })).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it('respects Retry-After over the exponential schedule', async () => {
    const { sleep, delays } = makeSleepRecorder();
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(
        new DataError('DATA_RATE_LIMITED', '429', { retryAfterMs: 5000 }),
      )
      .mockResolvedValue('ok');
    await expect(withRetry(fn, { sleep })).resolves.toBe('ok');
    expect(delays).toEqual([5000]);
  });

  it('gives up after the max attempts with the typed error', async () => {
    const { sleep, delays } = makeSleepRecorder();
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValue(new DataError('DATA_NETWORK', 'permanent'));
    let caught: unknown;
    try {
      await withRetry(fn, { sleep });
    } catch (e) {
      caught = e;
    }
    expectDataError(caught, 'DATA_NETWORK');
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([1000, 2000]);
  });

  it('does not retry non-retryable errors', async () => {
    const { sleep, delays } = makeSleepRecorder();
    const fn = jest
      .fn<Promise<string>, []>()
      .mockRejectedValue(new DataError('DATA_PARSE', 'bad payload'));
    let caught: unknown;
    try {
      await withRetry(fn, { sleep });
    } catch (e) {
      caught = e;
    }
    expectDataError(caught, 'DATA_PARSE');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });
});

// --- Retry-After parsing ---------------------------------------------------------

describe('retryAfterMsFromHeaders', () => {
  it('reads delta-seconds and ignores missing or malformed values', () => {
    expect(retryAfterMsFromHeaders({ 'retry-after': '7' })).toBe(7000);
    expect(retryAfterMsFromHeaders({})).toBeUndefined();
    expect(retryAfterMsFromHeaders({ 'retry-after': 'soon' })).toBeUndefined();
  });
});
