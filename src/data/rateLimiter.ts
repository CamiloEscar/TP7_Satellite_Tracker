import type { Clock } from './types';
import { DataError } from './types';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

/**
 * Verified per-provider limits (checked 2026-11-02, see IMPLEMENTATION_PLAN
 * Decisiones). Buckets are per provider and, for N2YO, per transaction class.
 */
export const DEFAULT_RATE_LIMITS: Record<string, RateLimitConfig> = {
  // N2YO: 1000 transactions/h for the tle + positions class.
  'n2yo-positions': { maxRequests: 1000, windowMs: 3600000 },
  // N2YO: 100 transactions/h for the passes + above class (used from Hito 6).
  'n2yo-passes': { maxRequests: 100, windowMs: 3600000 },
  // WTIA: no auth, ~1 req/s.
  wtia: { maxRequests: 1, windowMs: 1000 },
  // Space-Track public guidance: <30 req/min (and <300 req/h). The exact
  // per-account throttle must be confirmed with the account (humano).
  spacetrack: { maxRequests: 30, windowMs: 60000 },
};

/**
 * Sliding-window rate limiter. A call over the limit is rejected immediately
 * with `DATA_RATE_LIMITED` (the caller's `withRetry` decides whether to back
 * off and retry). Window accounting uses the injected `Clock`, so tests never
 * need real timers.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly limits: Record<
      string,
      RateLimitConfig
    > = DEFAULT_RATE_LIMITS,
  ) {}

  /** Records one request against `bucket`, or throws `DATA_RATE_LIMITED`. */
  acquire(bucket: string): void {
    const config = this.limits[bucket];
    if (!config) {
      throw new Error(`Unknown rate-limit bucket: ${bucket}.`);
    }
    const now = this.clock.now();
    const windowStart = now - config.windowMs;
    const recent = (this.hits.get(bucket) ?? []).filter(t => t > windowStart);
    if (recent.length >= config.maxRequests) {
      throw new DataError(
        'DATA_RATE_LIMITED',
        `Rate limit exceeded for bucket "${bucket}" (${config.maxRequests} requests / ${config.windowMs} ms).`,
      );
    }
    recent.push(now);
    this.hits.set(bucket, recent);
  }
}

export interface RetryOptions {
  /** Total attempts including the first one. Default: 3. */
  attempts?: number;
  /** First backoff delay; doubles on every retry. Default: 1000 ms. */
  baseDelayMs?: number;
  /** Delay seam so tests never sleep. Default: setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

/**
 * Bounded exponential backoff over retryable `DataError`s
 * (`DATA_NETWORK`, `DATA_RATE_LIMITED`). On 429 the server-provided
 * `retryAfterMs` (Retry-After) wins over the exponential schedule. Non
 * retryable errors are rethrown immediately; after the last attempt the last
 * typed error is rethrown.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (e) {
      const retryable =
        e instanceof DataError &&
        (e.code === 'DATA_NETWORK' || e.code === 'DATA_RATE_LIMITED');
      if (!retryable || attempt >= attempts) {
        throw e;
      }
      await sleep(e.retryAfterMs ?? baseDelayMs * 2 ** (attempt - 1));
    }
  }
}

/** Reads a Retry-After header (delta-seconds) as milliseconds. */
export function retryAfterMsFromHeaders(
  headers: Record<string, string>,
): number | undefined {
  const raw = headers['retry-after'];
  if (raw === undefined) {
    return undefined;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : undefined;
}
