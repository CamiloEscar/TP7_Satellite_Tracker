/** A throttled function plus `cancel` (drops the pending trailing call). */
export interface ThrottledFn<A extends unknown[]> {
  (...args: A): void;
  cancel(): void;
}

/**
 * Leading + trailing throttle for constellation state updates
 * (ARCHITECTURE.md §4 "throttling del estado"): the first call runs
 * immediately, calls inside the window are coalesced into one trailing call
 * carrying the latest arguments. `cancel` drops the pending trailing call
 * (used on unmount / config change).
 */
export function createThrottle<A extends unknown[]>(
  fn: (...args: A) => void,
  intervalMs: number,
): ThrottledFn<A> {
  let lastRunMs = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: A | null = null;

  const run = (args: A): void => {
    lastRunMs = Date.now();
    fn(...args);
  };

  const throttled = ((...args: A) => {
    const waitMs = intervalMs - (Date.now() - lastRunMs);
    if (waitMs <= 0) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
        pending = null;
      }
      run(args);
      return;
    }
    pending = args;
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        const latest = pending;
        pending = null;
        if (latest !== null) {
          run(latest);
        }
      }, waitMs);
    }
  }) as ThrottledFn<A>;

  throttled.cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  };

  return throttled;
}
