// The debounce, blur, and pagehide helpers. REQUIREMENTS 4.2.
//
// The helpers own timing only, so the tests use a hand-driven timer. No test
// here waits on a wall clock.

import { describe, expect, test } from 'bun:test';
import {
  debouncedEdit,
  flushOnBlur,
  flushOnPagehide,
  DEFAULT_DEBOUNCE_MS,
  type EditQueue,
  type EventTargetLike
} from '../src/sync/debounce';

/** A timer pair the test drives by hand. */
function manualTimer(): {
  timers: import('../src/sync/debounce').TimerSet;
  fireAll: () => void;
  count: () => number;
} {
  const waiting = new Map<number, () => void>();
  let seq = 1;
  return {
    timers: {
      setTimeout: (callback: () => void, _delayMs: number): unknown => {
        const id = seq;
        seq += 1;
        waiting.set(id, callback);
        return id;
      },
      clearTimeout: (handle: unknown): void => {
        waiting.delete(handle as number);
      }
    },
    fireAll: (): void => {
      const callbacks = Array.from(waiting.values());
      waiting.clear();
      for (const callback of callbacks) callback();
    },
    count: (): number => waiting.size
  };
}

/** A virtual clock that fires only timers whose deadline has passed. */
function virtualClock(): {
  timers: import('../src/sync/debounce').TimerSet;
  advance: (ms: number) => void;
} {
  let now = 0;
  let sequence = 0;
  let waiting: Array<{ id: number; at: number; callback: () => void }> = [];
  return {
    timers: {
      setTimeout: (callback: () => void, delayMs: number): unknown => {
        sequence += 1;
        waiting.push({ id: sequence, at: now + delayMs, callback });
        return sequence;
      },
      clearTimeout: (handle: unknown): void => {
        waiting = waiting.filter((item): boolean => item.id !== handle);
      }
    },
    advance: (ms: number): void => {
      const target = now + ms;
      for (;;) {
        waiting.sort((left, right): number => left.at - right.at);
        const next = waiting[0];
        if (next === undefined || next.at > target) break;
        waiting.shift();
        now = next.at;
        next.callback();
      }
      now = target;
    }
  };
}

/** A minimal event target that records its listeners. */
function fakeTarget(): EventTargetLike & { fire: (type: string) => void; listenerCount: (t: string) => number } {
  const listeners = new Map<string, Array<(event: unknown) => void>>();
  return {
    addEventListener: (type: string, listener: (event: unknown) => void): void => {
      const list = listeners.get(type) ?? [];
      list.push(listener);
      listeners.set(type, list);
    },
    removeEventListener: (type: string, listener: (event: unknown) => void): void => {
      const list = listeners.get(type) ?? [];
      const index = list.indexOf(listener);
      if (index >= 0) list.splice(index, 1);
    },
    fire: (type: string): void => {
      for (const listener of (listeners.get(type) ?? []).slice()) listener({ type });
    },
    listenerCount: (type: string): number => (listeners.get(type) ?? []).length
  };
}

describe('debouncedEdit', () => {
  test('a scheduled edit does not run before the timer fires', async () => {
    const ran: string[] = [];
    const clock = manualTimer();
    const queue: EditQueue = debouncedEdit(
      async (name: string): Promise<void> => {
        ran.push(name);
      },
      { timers: clock.timers }
    );

    queue.schedule('a.json', (doc: unknown) => doc);
    expect(ran).toEqual([]);
    expect(queue.pending()).toEqual(['a.json']);

    clock.fireAll();
    await queue.flush();
    expect(ran).toEqual(['a.json']);
  });

  test('repeated schedules invoke the runner once and apply the batch in order', async () => {
    const calls: Array<{ name: string; result: string }> = [];
    const clock = manualTimer();
    const queue = debouncedEdit(
      async (name: string, mutate: (doc: unknown) => unknown): Promise<void> => {
        calls.push({ name, result: String(mutate('')) });
      },
      { timers: clock.timers }
    );

    queue.schedule('a.json', (doc: unknown): string => `${String(doc)}A`);
    queue.schedule('a.json', (doc: unknown): string => `${String(doc)}B`);
    queue.schedule('a.json', (doc: unknown): string => `${String(doc)}C`);
    // One timer, because each schedule cleared the previous one.
    expect(clock.count()).toBe(1);
    expect(queue.pending()).toEqual(['a.json']);

    clock.fireAll();
    // Await the whole chain. `flush` waits for the wave already running.
    await queue.flush();
    // One runner call means one coordinator edit and one reconciliation.
    expect(calls).toEqual([{ name: 'a.json', result: 'ABC' }]);
  });

  test('maxDelayMs drains continuous edits even while the quiet timer keeps moving', async () => {
    const clock = virtualClock();
    const results: string[] = [];
    const queue = debouncedEdit(
      async (_name: string, mutate: (doc: unknown) => unknown): Promise<void> => {
        results.push(String(mutate('')));
      },
      { timers: clock.timers, delayMs: 100, maxDelayMs: 250 }
    );

    queue.schedule('a.json', (doc: unknown): string => `${String(doc)}A`);
    clock.advance(90);
    queue.schedule('a.json', (doc: unknown): string => `${String(doc)}B`);
    clock.advance(90);
    queue.schedule('a.json', (doc: unknown): string => `${String(doc)}C`);

    // The latest quiet deadline is t=280, but the original maximum is t=250.
    clock.advance(69);
    expect(results).toEqual([]);
    clock.advance(1);
    await Promise.resolve();
    expect(results).toEqual(['ABC']);
    await queue.flush();
  });

  test('flush runs the queue without waiting for the timer', async () => {
    const ran: string[] = [];
    const clock = manualTimer();
    const queue = debouncedEdit(
      async (name: string): Promise<void> => {
        ran.push(name);
      },
      { timers: clock.timers }
    );

    queue.schedule('a.json', (doc: unknown) => doc);
    await queue.flush();
    expect(ran).toEqual(['a.json']);
    expect(queue.pending()).toEqual([]);
  });

  test('a failed run keeps the whole batch queued', async () => {
    const ran: string[] = [];
    const clock = manualTimer();
    let attempts = 0;
    const queue = debouncedEdit(
      async (_name: string, mutate: (doc: unknown) => unknown): Promise<void> => {
        attempts += 1;
        // The first run fails before it reaches storage, so nothing applied.
        if (attempts === 1) throw new Error('local write failed');
        ran.push(String(mutate('')));
      },
      { timers: clock.timers }
    );

    queue.schedule('a.json', (doc: unknown): string => `${String(doc)}A`);
    queue.schedule('a.json', (doc: unknown): string => `${String(doc)}B`);

    // The flush reports the local failure, and the queue still holds work.
    await expect(queue.flush()).rejects.toThrow('local write failed');
    expect(ran).toEqual([]);
    expect(queue.pending()).toEqual(['a.json']);

    // The next flush retries one runner call with both mutators in order.
    await queue.flush();
    expect(attempts).toBe(2);
    expect(ran).toEqual(['AB']);
    expect(queue.pending()).toEqual([]);
  });

  test('a failed run keeps its place ahead of later schedules', async () => {
    const results: string[] = [];
    const clock = manualTimer();
    let attempts = 0;
    const queue = debouncedEdit(
      async (_name: string, mutate: (doc: unknown) => unknown): Promise<void> => {
        attempts += 1;
        if (attempts === 1) throw new Error('local write failed');
        results.push(String(mutate('')));
      },
      { timers: clock.timers }
    );

    queue.schedule('a.json', (doc: unknown): string => `${String(doc)}first`);
    await expect(queue.flush()).rejects.toThrow('local write failed');
    expect(results).toEqual([]);

    // This mutator arrives after the failure, so it must run last in the retry batch.
    queue.schedule('a.json', (doc: unknown): string => `${String(doc)}-later`);
    await queue.flush();
    expect(results).toEqual(['first-later']);
  });

  test('an edit queued during a running timer batch keeps its own delay', async () => {
    const clock = manualTimer();
    const order: string[] = [];
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve: () => void): void => {
      release = resolve;
    });
    const queue = debouncedEdit(
      async (_name: string, mutate: (doc: unknown) => unknown): Promise<void> => {
        const value = String(mutate(''));
        if (value === 'first') await gate;
        order.push(value);
      },
      { timers: clock.timers }
    );

    queue.schedule('a.json', (): string => 'first');
    clock.fireAll();
    await Promise.resolve();
    queue.schedule('a.json', (): string => 'later');
    release();
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(['first']);
    expect(clock.count()).toBe(1);
    clock.fireAll();
    await queue.flush();
    expect(order).toEqual(['first', 'later']);
  });

  test('cancel drops the queue', async () => {
    const ran: string[] = [];
    const clock = manualTimer();
    const queue = debouncedEdit(
      async (name: string): Promise<void> => {
        ran.push(name);
      },
      { timers: clock.timers }
    );

    queue.schedule('a.json', (doc: unknown) => doc);
    queue.cancel();
    clock.fireAll();
    await queue.flush();
    expect(ran).toEqual([]);
  });

  test('different logical files are independent', async () => {
    const ran: string[] = [];
    const clock = manualTimer();
    const queue = debouncedEdit(
      async (name: string): Promise<void> => {
        ran.push(name);
      },
      { timers: clock.timers }
    );

    queue.schedule('a.json', (doc: unknown) => doc);
    queue.schedule('b.json', (doc: unknown) => doc);
    expect(queue.pending().sort()).toEqual(['a.json', 'b.json']);

    await queue.flush();
    expect(ran.sort()).toEqual(['a.json', 'b.json']);
  });

  test('the default delay is exported and positive', () => {
    expect(DEFAULT_DEBOUNCE_MS).toBeGreaterThan(0);
  });
});

describe('flushOnBlur and flushOnPagehide', () => {
  test('a blur flushes', async () => {
    let flushed = 0;
    const target = fakeTarget();
    const detach = flushOnBlur(target, async (): Promise<void> => {
      flushed += 1;
    });

    target.fire('blur');
    await Promise.resolve();
    expect(flushed).toBe(1);

    detach();
    expect(target.listenerCount('blur')).toBe(0);
  });

  test('pagehide flushes', async () => {
    let flushed = 0;
    const target = fakeTarget();
    const detach = flushOnPagehide(target, async (): Promise<void> => {
      flushed += 1;
    });

    target.fire('pagehide');
    await Promise.resolve();
    expect(flushed).toBe(1);

    detach();
    expect(target.listenerCount('pagehide')).toBe(0);
  });

  test('a missing target yields a no-op detach, not a throw', () => {
    expect(() => flushOnBlur(null, async (): Promise<void> => undefined)).not.toThrow();
    expect(() => flushOnPagehide(undefined, async (): Promise<void> => undefined)).not.toThrow();
  });
});
