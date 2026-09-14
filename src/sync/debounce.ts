// Debounce, blur save, and `pagehide` flush helpers. Phase 10.
// REQUIREMENTS 4.2. ARCHITECTURE section 11 "Writes, preflight, and retry".
//
// A user types or taps repeatedly. Each keystroke must not start a Drive
// round trip, so the edit is held for a short quiet period and then applied
// once. Two other events cut the wait short: a control losing focus means the
// user finished with that field, and `pagehide` means the page may be gone in
// milliseconds.
//
// The helpers own timing only. They never touch a document, a store, or
// Drive. The caller passes the function that performs the edit, so the same
// helpers serve every screen and every test can inject a fake clock.
//
// Coalescing rule: edits to one logical file queue in the order they were
// made, and one flush applies the whole queue for that file. Edits to
// different logical files are independent, because each is one Drive file and
// one merge.

/** A pure document edit. Same shape the coordinator takes. */
export type Mutator = (doc: unknown) => unknown;

/** Runs one queued edit. Returns a promise the flush awaits. */
export type EditRunner = (logicalName: string, mutate: Mutator) => Promise<void>;

/** The timer pair this module needs. Injectable so tests need no wall clock. */
export interface TimerSet {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** The real browser timers. */
export const wallClock: TimerSet = {
  setTimeout: (callback: () => void, delayMs: number): unknown =>
    (globalThis as unknown as { setTimeout: (cb: () => void, ms: number) => unknown }).setTimeout(
      callback,
      delayMs
    ),
  clearTimeout: (handle: unknown): void => {
    const fn = (globalThis as unknown as { clearTimeout?: (h: unknown) => void }).clearTimeout;
    if (typeof fn === 'function') fn(handle);
  }
};

/** Default quiet period before a queued edit runs. */
export const DEFAULT_DEBOUNCE_MS = 400;

/** One edit queue keyed by logical file. */
export interface EditQueue {
  /**
   * Queue one edit. Restarts the quiet timer for that logical file.
   *
   * The timer coalesces. The mutators never do. Three quick edits become one
   * timer that applies all three mutators in order, so no keystroke is lost.
   * Dropping a queued mutator would discard a user edit, which
   * REQUIREMENTS 4.4 forbids.
   */
  schedule(logicalName: string, mutate: Mutator): void;
  /**
   * Run every queued edit now, skipping the remaining wait.
   *
   * Edits for one logical file apply in queue order. Files are applied one at
   * a time, because each file's edit starts a reconciliation that must not
   * overlap another write of the same records.
   */
  flush(): Promise<void>;
  /** Drop every queued edit without running it. */
  cancel(): void;
  /** Logical names with work still queued, in schedule order. */
  pending(): string[];
}

/**
 * Build a debounced edit queue.
 *
 * `run` performs one edit and resolves when that edit is durable locally.
 * The queue does not care what "durable" means.
 */
export function debouncedEdit(
  run: EditRunner,
  opts: { delayMs?: number; timers?: TimerSet } = {}
): EditQueue {
  const delayMs = opts.delayMs === undefined ? DEFAULT_DEBOUNCE_MS : opts.delayMs;
  const timers = opts.timers === undefined ? wallClock : opts.timers;

  /** Queued mutators per logical file, oldest first. */
  const queues = new Map<string, Mutator[]>();
  /** One timer per logical file. */
  const handles = new Map<string, unknown>();
  /** The flush already running, so a second flush waits instead of racing. */
  let running: Promise<void> | null = null;
  /** Waves started by the timer, so a later `flush` still waits for them. */
  const inFlight = new Set<Promise<void>>();

  const fire = (logicalName: string): Promise<void> => {
    handles.delete(logicalName);
    const queued = queues.get(logicalName);
    if (queued === undefined || queued.length === 0) return Promise.resolve();
    // Take the whole queue. The timer collapsed the wait, not the edits.
    queues.set(logicalName, []);
    // Sequential, so two edits to one file cannot both hold the records.
    const wave = queued.reduce(
      (chain: Promise<void>, mutate: Mutator): Promise<void> =>
        chain.then(() => run(logicalName, mutate)),
      Promise.resolve()
    );
    inFlight.add(wave);
    void wave.then(
      () => {
        inFlight.delete(wave);
      },
      () => {
        inFlight.delete(wave);
      }
    );
    return wave;
  };

  const schedule = (logicalName: string, mutate: Mutator): void => {
    const queued = queues.get(logicalName);
    if (queued === undefined) queues.set(logicalName, [mutate]);
    else queued.push(mutate);

    const existing = handles.get(logicalName);
    if (existing !== undefined) timers.clearTimeout(existing);
    handles.set(logicalName, timers.setTimeout(() => void fire(logicalName), delayMs));
  };

  const flush = (): Promise<void> => {
    const names = Array.from(handles.keys());
    const fires: Array<Promise<unknown>> = names.map((name) => fire(name));
    // Include waves the timer already started. A flush that only looked at
    // the queue would report success while a timer wave was still running.
    const settled = Array.from(inFlight).map((p: Promise<void>): Promise<unknown> =>
      p.catch((error: unknown): unknown => error)
    );
    const wave = Promise.all<unknown>(fires.concat(settled)).then(
      () => undefined,
      () => undefined
    );
    // Chain on any wave already running, so callers of flush() all wait for
    // everything queued up to their call.
    const chained = running === null ? wave : running.then(() => wave);
    running = chained;
    void chained.then(() => {
      if (running === chained) running = null;
    });
    return chained;
  };

  const cancel = (): void => {
    for (const handle of handles.values()) timers.clearTimeout(handle);
    handles.clear();
    queues.clear();
  };

  const pending = (): string[] => Array.from(handles.keys());

  return { schedule, flush, cancel, pending };
}

/** The listener shape a blur or pagehide target needs. */
export interface EventTargetLike {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
}

/** Detach function returned by every listener helper. */
export type Detach = () => void;

/**
 * Flush queued edits when the target blurs.
 *
 * A blur means the user left the field, so the value in it is final. Returns
 * the detach function, because a screen that unmounts must stop the listener.
 * Returns a no-op when there is no target to listen on.
 */
export function flushOnBlur(target: EventTargetLike | null | undefined, flush: () => Promise<void>): Detach {
  if (target === null || target === undefined) return () => undefined;
  const listener = (): void => {
    void flush();
  };
  target.addEventListener('blur', listener);
  return () => target.removeEventListener('blur', listener);
}

/**
 * Flush queued edits on `pagehide`.
 *
 * `pagehide` is the last reliable signal before the page goes away. The
 * listener fires the flush and does not wait for it: a hidden page has no
 * budget for a Drive round trip, and the local write is what must land.
 *
 * Returns the detach function, and a no-op when the host has no target.
 */
export function flushOnPagehide(
  target: EventTargetLike | null | undefined,
  flush: () => Promise<void>
): Detach {
  if (target === null || target === undefined) return () => undefined;
  const listener = (): void => {
    void flush();
  };
  target.addEventListener('pagehide', listener);
  return () => target.removeEventListener('pagehide', listener);
}

/**
 * The `window` object, when this host has one.
 *
 * A test runner or a worker has no `window`, so every listener helper takes
 * the target as an argument and this accessor exists only for the bootstrap
 * call site.
 */
export function pageTarget(): EventTargetLike | null {
  const candidate = (globalThis as unknown as { window?: unknown }).window;
  if (
    typeof candidate === 'object' &&
    candidate !== null &&
    typeof (candidate as EventTargetLike).addEventListener === 'function'
  ) {
    return candidate as EventTargetLike;
  }
  return null;
}
