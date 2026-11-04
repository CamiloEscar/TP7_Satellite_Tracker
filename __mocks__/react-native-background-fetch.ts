/**
 * Jest manual mock for the native `react-native-background-fetch` module
 * (TurboModule + HeadlessJS - jest must never load it). `configure` and
 * `registerHeadlessTask` record their callbacks so tests drive events through
 * the `__emit*` helpers, and `finish` records finished task ids. Placed in
 * the root `__mocks__` directory like the react-native-svg mock.
 */

type TaskCallback = (taskId: string) => void | Promise<void>;
type HeadlessTask = (event: {
  taskId: string;
  timeout: boolean;
}) => Promise<void>;

interface MockBackgroundFetchConfig {
  minimumFetchInterval?: number;
  stopOnTerminate?: boolean;
  startOnBoot?: boolean;
  enableHeadless?: boolean;
}

let onEvent: TaskCallback | null = null;
let onTimeout: TaskCallback | null = null;
let headlessTask: HeadlessTask | null = null;
let finishedTaskIds: string[] = [];

const BackgroundFetch = {
  STATUS_RESTRICTED: 0,
  STATUS_DENIED: 1,
  STATUS_AVAILABLE: 2,
  NETWORK_TYPE_NONE: 0,
  NETWORK_TYPE_ANY: 1,
  NETWORK_TYPE_UNMETERED: 2,
  NETWORK_TYPE_NOT_ROAMING: 3,
  NETWORK_TYPE_CELLULAR: 4,
  configure(
    _config: MockBackgroundFetchConfig,
    eventCallback: TaskCallback,
    timeoutCallback?: TaskCallback,
  ): Promise<number> {
    onEvent = eventCallback;
    onTimeout = timeoutCallback ?? null;
    return Promise.resolve(BackgroundFetch.STATUS_AVAILABLE);
  },
  finish(taskId: string): void {
    finishedTaskIds.push(taskId);
  },
  status(): Promise<number> {
    return Promise.resolve(BackgroundFetch.STATUS_AVAILABLE);
  },
  start(): Promise<number> {
    return Promise.resolve(BackgroundFetch.STATUS_AVAILABLE);
  },
  stop(_taskId?: string): Promise<boolean> {
    return Promise.resolve(true);
  },
  scheduleTask(_config: unknown): Promise<boolean> {
    return Promise.resolve(true);
  },
  registerHeadlessTask(task: HeadlessTask): void {
    headlessTask = task;
  },
};

export default BackgroundFetch;

/** Fires the `onEvent` callback registered via `configure`. */
export function __emitFetchEvent(taskId: string): Promise<void> {
  return Promise.resolve(onEvent?.(taskId));
}

/** Fires the `onTimeout` callback registered via `configure`. */
export function __emitFetchTimeout(taskId: string): Promise<void> {
  return Promise.resolve(onTimeout?.(taskId));
}

/** Runs the task registered via `registerHeadlessTask`. */
export function __emitHeadlessEvent(event: {
  taskId: string;
  timeout: boolean;
}): Promise<void> {
  return headlessTask ? headlessTask(event) : Promise.resolve();
}

export function __getFinishedTaskIds(): string[] {
  return [...finishedTaskIds];
}

export function __resetBackgroundFetch(): void {
  onEvent = null;
  onTimeout = null;
  headlessTask = null;
  finishedTaskIds = [];
}
