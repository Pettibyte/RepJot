import { describe, expect, test } from 'bun:test';
import { createRouter, type Router, type RouterEnv } from '../src/routing/hash-router';
import {
  TAB_ROOTS,
  formatRoute,
  isTabRoot,
  parentRoute,
  parseHash,
  type Route
} from '../src/routing/routes';
import { get } from 'svelte/store';

/** Every route in the table, with the hash that must produce it. */
const CASES: Array<{ hash: string; route: Route }> = [
  { hash: '#/', route: { name: 'home' } },
  { hash: '#/workouts/arms-day-a', route: { name: 'workout-overview', workoutId: 'arms-day-a' } },
  {
    hash: '#/sessions/session-0f1c2b3a-4d5e-4f60-8a1b-2c3d4e5f6a7b/active',
    route: {
      name: 'session-active',
      sessionId: 'session-0f1c2b3a-4d5e-4f60-8a1b-2c3d4e5f6a7b'
    }
  },
  {
    hash: '#/sessions/session-0f1c2b3a-4d5e-4f60-8a1b-2c3d4e5f6a7b/summary',
    route: {
      name: 'session-summary',
      sessionId: 'session-0f1c2b3a-4d5e-4f60-8a1b-2c3d4e5f6a7b'
    }
  },
  { hash: '#/history', route: { name: 'history' } },
  {
    hash: '#/exercises/Barbell_Squat/history',
    route: { name: 'exercise-history', exerciseId: 'Barbell_Squat' }
  },
  { hash: '#/settings', route: { name: 'settings' } },
  { hash: '#/raw/rp-1a2b3c4d', route: { name: 'raw-json', source: 'rp-1a2b3c4d' } }
];

describe('parseHash and formatRoute', () => {
  test('each route parses to its typed Route', () => {
    for (const { hash, route } of CASES) {
      expect(parseHash(hash)).toEqual(route);
    }
  });

  test('each route formats back to the same hash', () => {
    for (const { hash, route } of CASES) {
      expect(formatRoute(route)).toBe(hash);
    }
  });

  test('parse and format round-trip through both directions', () => {
    for (const { hash } of CASES) {
      expect(formatRoute(parseHash(hash))).toBe(hash);
    }
  });

  test('an empty hash and a bare hash are the home route', () => {
    expect(parseHash('')).toEqual({ name: 'home' });
    expect(parseHash('#')).toEqual({ name: 'home' });
    expect(parseHash('#/')).toEqual({ name: 'home' });
  });

  test('a trailing slash normalizes to the same route', () => {
    expect(parseHash('#/history/')).toEqual({ name: 'history' });
    expect(parseHash('#/workouts/arms-day-a/')).toEqual({
      name: 'workout-overview',
      workoutId: 'arms-day-a'
    });
  });

  test('an unknown path parses to not-found and keeps the attempted hash', () => {
    const route = parseHash('#/does-not-exist');
    expect(route).toEqual({ name: 'not-found', attempted: '#/does-not-exist' });
    expect(formatRoute(route)).toBe('#/does-not-exist');
  });

  test('an unknown first segment keeps the attempted text through a round trip', () => {
    const attempted = '#/programs/7';
    expect(parseHash(attempted)).toEqual({ name: 'not-found', attempted });
    expect(formatRoute(parseHash(attempted))).toBe(attempted);
  });

  test('a missing id segment parses to not-found', () => {
    expect(parseHash('#/workouts')).toEqual({ name: 'not-found', attempted: '#/workouts' });
    expect(parseHash('#/raw/')).toEqual({ name: 'not-found', attempted: '#/raw/' });
  });

  test('a malformed session id segment parses to not-found rather than throwing', () => {
    const hashes = [
      '#/sessions//active',
      '#/sessions/a|b/active',
      '#/sessions/a:b/active',
      '#/sessions/%zz/active',
      '#/sessions/12345/active',
      '#/sessions/abc/unknown',
      '#/sessions/abc'
    ];
    for (const hash of hashes) {
      expect(() => parseHash(hash)).not.toThrow();
      expect(parseHash(hash).name).toBe('not-found');
    }
  });

  test('an all-digit id is rejected because JavaScript reorders such a key', () => {
    expect(parseHash('#/workouts/12345').name).toBe('not-found');
    expect(parseHash('#/exercises/9/history').name).toBe('not-found');
  });

  test('a percent-encoded slash inside an id is rejected', () => {
    expect(parseHash('#/workouts/a%2Fb').name).toBe('not-found');
  });

  test('an over-long id is rejected', () => {
    const long = 'a'.repeat(200);
    expect(parseHash(`#/workouts/${long}`).name).toBe('not-found');
  });
});

describe('tab roots and parents', () => {
  test('TAB_ROOTS lists the three tab routes', () => {
    expect(TAB_ROOTS).toEqual(['home', 'history', 'settings']);
  });

  test('a tab root selects the tab header', () => {
    expect(isTabRoot({ name: 'home' })).toBe(true);
    expect(isTabRoot({ name: 'history' })).toBe(true);
    expect(isTabRoot({ name: 'settings' })).toBe(true);
  });

  test('every other route uses the back header', () => {
    expect(isTabRoot({ name: 'session-active', sessionId: 'session-1' })).toBe(false);
    expect(isTabRoot({ name: 'workout-overview', workoutId: 'w' })).toBe(false);
    expect(isTabRoot({ name: 'raw-json', source: 'ab' })).toBe(false);
    expect(isTabRoot({ name: 'not-found', attempted: '#/x' })).toBe(false);
  });

  test('exercise history returns to history, and every other detail route returns home', () => {
    expect(parentRoute({ name: 'exercise-history', exerciseId: 'x' })).toEqual({ name: 'history' });
    expect(parentRoute({ name: 'session-active', sessionId: 's' })).toEqual({ name: 'home' });
    expect(parentRoute({ name: 'raw-json', source: 'ab' })).toEqual({ name: 'home' });
    expect(parentRoute({ name: 'home' })).toEqual({ name: 'home' });
  });
});

/** Drain the microtask and macrotask queue. */
function drain(): Promise<void> {
  return new Promise((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

/**
 * An in-memory router environment.
 *
 * `setHash` fires the registered listeners, the way a browser fires
 * `hashchange` after a write. That makes the fake prove the real publish path:
 * a programmatic `navigate` publishes through the listener, once.
 */
function fakeEnv(initial = '#/'): RouterEnv & {
  hash: string;
  writes: string[];
  listeners: Array<() => void>;
} {
  const env = {
    hash: initial,
    writes: [] as string[],
    listeners: [] as Array<() => void>,
    getHash(): string {
      return env.hash;
    },
    setHash(hash: string): void {
      env.writes.push(hash);
      env.hash = hash;
      env.listeners.forEach((listener: () => void): void => listener());
    },
    onHashChange(listener: () => void): () => void {
      env.listeners.push(listener);
      return (): void => {
        env.listeners = env.listeners.filter((item: () => void): boolean => item !== listener);
      };
    }
  };
  return env;
}

describe('createRouter', () => {
  test('start publishes the hash the environment reports', () => {
    const env = fakeEnv('#/settings');
    const router: Router = createRouter({ env });
    router.start();
    expect(get(router.current())).toEqual({ name: 'settings' });
  });

  test('a hash change updates the current route', () => {
    const env = fakeEnv('#/');
    const router = createRouter({ env });
    router.start();

    env.hash = '#/history';
    env.listeners.forEach((listener: () => void): void => listener());

    expect(get(router.current())).toEqual({ name: 'history' });
  });

  test('navigate writes the formatted hash and publishes the route', () => {
    const env = fakeEnv('#/');
    const router = createRouter({ env });
    router.start();

    router.navigate({ name: 'workout-overview', workoutId: 'arms-day-a' });

    expect(env.writes).toEqual(['#/workouts/arms-day-a']);
    expect(get(router.current())).toEqual({ name: 'workout-overview', workoutId: 'arms-day-a' });
  });

  // A browser fires `hashchange` after a programmatic write, so the listener
  // publishes. A second direct publish would run the pre-route hook twice per
  // navigation and flush the coordinator twice for nothing.
  test('navigate to a different hash runs the pre-route hook once', async () => {
    const seen: string[] = [];
    const env = fakeEnv('#/');
    const router = createRouter({
      env,
      beforeRouteChange: (next: Route): void => {
        seen.push(next.name);
      }
    });
    router.start();
    await drain();
    seen.length = 0;

    router.navigate({ name: 'settings' });
    await drain();

    expect(seen).toEqual(['settings']);
    expect(get(router.current())).toEqual({ name: 'settings' });
  });

  test('navigate to the same hash still publishes once', async () => {
    const seen: string[] = [];
    const env = fakeEnv('#/settings');
    const router = createRouter({
      env,
      beforeRouteChange: (next: Route): void => {
        seen.push(next.name);
      }
    });
    router.start();
    await drain();
    seen.length = 0;

    router.navigate({ name: 'settings' });
    await drain();

    expect(seen).toEqual(['settings']);
    expect(env.writes).toEqual([]);
  });

  test('an unknown hash publishes not-found', () => {
    const env = fakeEnv('#/nope/1');
    const router = createRouter({ env });
    router.start();
    expect(get(router.current())).toEqual({ name: 'not-found', attempted: '#/nope/1' });
  });

  test('stop unsubscribes, so a later hash change is ignored', () => {
    const env = fakeEnv('#/');
    const router = createRouter({ env });
    router.start();
    router.stop();

    env.hash = '#/settings';
    env.listeners.forEach((listener: () => void): void => listener());

    expect(env.listeners).toHaveLength(0);
    expect(get(router.current())).toEqual({ name: 'home' });
  });

  test('start is idempotent and adds one listener only', () => {
    const env = fakeEnv('#/');
    const router = createRouter({ env });
    router.start();
    router.start();
    expect(env.listeners).toHaveLength(1);
  });

  test('beforeRouteChange runs before the route publishes', async () => {
    const seen: string[] = [];
    const env = fakeEnv('#/');
    const router = createRouter({
      env,
      beforeRouteChange: (next: Route): Promise<void> => {
        seen.push(`hook:${next.name}`);
        return drain();
      }
    });
    router.start();

    env.hash = '#/settings';
    env.listeners.forEach((listener: () => void): void => listener());
    expect(get(router.current())).toEqual({ name: 'home' });

    await drain();
    await drain();

    expect(seen).toEqual(['hook:home', 'hook:settings']);
    expect(get(router.current())).toEqual({ name: 'settings' });
  });

  test('a rejected hook still publishes the route', async () => {
    const env = fakeEnv('#/');
    const router = createRouter({
      env,
      beforeRouteChange: async (): Promise<void> => {
        throw new Error('flush failed');
      }
    });
    router.start();

    env.hash = '#/settings';
    env.listeners.forEach((listener: () => void): void => listener());
    await drain();

    expect(get(router.current())).toEqual({ name: 'settings' });
  });
});
