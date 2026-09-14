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

  test('repeated schedules coalesce into one timer but all apply', async () => {
    const ran: string[] = [];
    const clock = manualTimer();
    const queue = debouncedEdit(
      async (name: string): Promise<void> => {
        ran.push(name);
      },
      { timers: clock.timers }
    );

    queue.schedule('a.json', (doc: unknown) => doc);
    queue.schedule('a.json', (doc: unknown) => doc);
    queue.schedule('a.json', (doc: unknown) => doc);
    // One timer, because each schedule cleared the previous one.
    expect(clock.count()).toBe(1);
    expect(queue.pending()).toEqual(['a.json']);

    clock.fireAll();
    // Await the whole chain. `flush` waits for the wave already running.
    await queue.flush();
    // Every queued mutator applied, in schedule order.
    expect(ran.length).toBe(3);
    expect(ran).toEqual(['a.json', 'a.json', 'a.json']);
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

  test('a failed run keeps that mutator and the ones behind it queued', async () => {
    const ran: string[] = [];
    const clock = manualTimer();
    let attempts = 0;
    const queue = debouncedEdit(
      async (name: string): Promise<void> => {
        attempts += 1;
        // The first run fails before it reaches storage, so nothing applied.
        if (attempts === 1) throw new Error('local write failed');
        ran.push(name);
      },
      { timers: clock.timers }
    );

    queue.schedule('a.json', (doc: unknown) => doc);
    queue.schedule('a.json', (doc: unknown) => doc);

    // The flush reports the local failure, and the queue still holds work.
    await expect(queue.flush()).rejects.toThrow('local write failed');
    expect(ran).toEqual([]);
    expect(queue.pending()).toEqual(['a.json']);

    // The next flush applies both mutators, in the original order.
    await queue.flush();
    expect(ran).toEqual(['a.json', 'a.json']);
    expect(queue.pending()).toEqual([]);
  });

  test('a failed run keeps its place ahead of later schedules', async () => {
    const order: string[] = [];
    const clock = manualTimer();
    let attempts = 0;
    const queue = debouncedEdit(
      async (_name: string, mutate: (doc: unknown) => unknown): Promise<void> => {
        attempts += 1;
        if (attempts === 1) throw new Error('local write failed');
        order.push(String(mutate('')));
      },
      { timers: clock.timers }
    );

    queue.schedule('a.json', (): string => 'first');
    await expect(queue.flush()).rejects.toThrow('local write failed');
    expect(order).toEqual([]);

    // This mutator arrives after the failure, so it must run last.
    queue.schedule('a.json', (): string => 'later');
    await queue.flush();
    expect(order).toEqual(['first', 'later']);
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
