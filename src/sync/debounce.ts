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

/** Runs one queued batch. Returns a promise the flush awaits. */
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
   * The timer and local write coalesce. Three quick edits become one timer
   * and one composed mutator. The composed mutator applies all three edits in
   * order, so no user edit is lost. REQUIREMENTS 4.4.
   */
  schedule(logicalName: string, mutate: Mutator): void;
  /**
   * Run every queued edit now, skipping the remaining wait.
   *
   * Edits for one logical file apply in queue order. One file drains at a
   * time, so a batch that fails and returns its mutators cannot be jumped
   * by a newer batch for the same file. A file whose drain stopped on a
   * failure keeps its mutators queued for a later flush.
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
  opts: { delayMs?: number; maxDelayMs?: number; timers?: TimerSet } = {}
): EditQueue {
  const delayMs = opts.delayMs === undefined ? DEFAULT_DEBOUNCE_MS : opts.delayMs;
  const maxDelayMs = opts.maxDelayMs;
  const timers = opts.timers === undefined ? wallClock : opts.timers;
  /** Queued mutators per logical file, oldest first. */
  const queues = new Map<string, Mutator[]>();
  /** One quiet timer per logical file. */
  const handles = new Map<string, unknown>();
  /** Optional maximum-wait timer per logical file. */
  const maxHandles = new Map<string, unknown>();
  /**
   * The batch running for one logical file, if any.
   *
   * One batch per file keeps the queue as the source of input order. A timer
   * consumes only the inputs that were ready at its deadline. Inputs queued
   * while that batch runs keep their own quiet period. REQUIREMENTS 4.2, 12.9.
   */
  const drainers = new Map<string, Promise<void>>();

  /**
   * Apply one batch through one local document write.
   *
   * The composed mutator preserves input order. If the write fails, the full
   * batch returns ahead of edits scheduled later. This is necessary because
   * the store transaction either accepted all mutations or accepted none.
   */
  const runBatch = async (logicalName: string, batch: Mutator[]): Promise<void> => {
    const composed = (doc: unknown): unknown => {
      let next = doc;
      for (const mutate of batch) next = mutate(next);
      return next;
    };
    try {
      await run(logicalName, composed);
    } catch (error: unknown) {
      const later = queues.get(logicalName) ?? [];
      queues.set(logicalName, batch.concat(later));
      throw error;
    }
  };

  /** Run one snapshot of this file's queue. */
  const drainOne = (logicalName: string): Promise<void> => {
    const already = drainers.get(logicalName);
    if (already !== undefined) return already;

    // An explicit drain consumes the work for this timer, so cancel the
    // callback too. Otherwise it can consume a later input at the old deadline.
    const armed = handles.get(logicalName);
    if (armed !== undefined) {
      timers.clearTimeout(armed);
      handles.delete(logicalName);
    }
    const maxArmed = maxHandles.get(logicalName);
    if (maxArmed !== undefined) {
      timers.clearTimeout(maxArmed);
      maxHandles.delete(logicalName);
    }

    const batch = queues.get(logicalName) ?? [];
    if (batch.length === 0) return Promise.resolve();
    queues.set(logicalName, []);
    const promise = runBatch(logicalName, batch);
    drainers.set(logicalName, promise);
    const forget = (): void => {
      if (drainers.get(logicalName) === promise) drainers.delete(logicalName);
    };
    void promise.then(forget, forget);
    return promise;
  };

  /** Run the batch whose quiet period expired, after any older batch. */
  const drainAtDeadline = async (logicalName: string): Promise<void> => {
    const older = drainers.get(logicalName);
    if (older !== undefined) await older;
    await drainOne(logicalName);
  };

  const schedule = (logicalName: string, mutate: Mutator): void => {
    const queued = queues.get(logicalName);
    if (queued === undefined) queues.set(logicalName, [mutate]);
    else queued.push(mutate);

    const existing = handles.get(logicalName);
    if (existing !== undefined) timers.clearTimeout(existing);
    handles.set(
      logicalName,
      timers.setTimeout((): void => {
        handles.delete(logicalName);
        // The edit path logs a local failure and keeps the batch queued.
        // A timer has no caller to receive that failure.
        void drainAtDeadline(logicalName).catch((): void => undefined);
      }, delayMs)
    );
    if (maxDelayMs !== undefined && !maxHandles.has(logicalName)) {
      maxHandles.set(
        logicalName,
        timers.setTimeout((): void => {
          maxHandles.delete(logicalName);
          void drainAtDeadline(logicalName).catch((): void => undefined);
        }, maxDelayMs)
      );
    }
  };

  /** Names with mutators still waiting, whether or not a timer is armed. */
  const queuedNames = (): string[] =>
    Array.from(queues.keys()).filter((name: string): boolean => (queues.get(name)?.length ?? 0) > 0);

  const flush = async (): Promise<void> => {
    // Explicit flush ignores quiet periods and drains through inputs queued
    // while an older batch runs. A local failure rejects this flush and leaves
    // the failed input at the queue head for a later retry.
    for (;;) {
      const names = new Set<string>(
        Array.from(handles.keys()).concat(
          Array.from(maxHandles.keys()),
          queuedNames(),
          Array.from(drainers.keys())
        )
      );
      if (names.size === 0) return;
      await Promise.all(Array.from(names).map((name: string): Promise<void> => drainOne(name)));
    }
  };

  const cancel = (): void => {
    for (const handle of handles.values()) timers.clearTimeout(handle);
    for (const handle of maxHandles.values()) timers.clearTimeout(handle);
    handles.clear();
    maxHandles.clear();
    queues.clear();
    drainers.clear();
  };

  const pending = (): string[] => {
    const names = new Set<string>(Array.from(handles.keys()).concat(Array.from(maxHandles.keys())));
    for (const name of queuedNames()) names.add(name);
    return Array.from(names);
  };

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
    void flush().catch((): void => undefined);
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
    void flush().catch((): void => undefined);
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
