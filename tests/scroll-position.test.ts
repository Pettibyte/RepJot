// Layout-free tests for the rule applied after the shell's screen-ready signal.
import { describe, expect, test } from 'bun:test';
import {
  createScrollController, manageScrollRestoration, type ScrollEnv
} from '../src/routing/scroll-position';
import type { NavigationInfo } from '../src/routing/hash-router';
import type { Route } from '../src/routing/routes';

function fakeScrollEnv(startY = 640): ScrollEnv & { writes: number[]; y: number } {
  const env = {
    y: startY,
    writes: [] as number[],
    getY(): number { return env.y; },
    setY(y: number): void { env.writes.push(y); env.y = y; }
  };
  return env;
}

const HOME: Route = { name: 'home' };
const HISTORY: Route = { name: 'history' };
const EXERCISE_HISTORY: Route = { name: 'exercise-history', exerciseId: 'Barbell_Squat' };
function navigation(from: Route | null, to: Route, traversed = false): NavigationInfo {
  return { from, to, traversed, entryId: 'destination', fromEntryId: from === null ? null : 'source', scrollY: null };
}

function withHistory(history: object, run: () => void): void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { history } });
  try { run(); } finally {
    if (previous !== undefined) Object.defineProperty(globalThis, 'window', previous);
    else delete (globalThis as { window?: unknown }).window;
  }
}

describe('native scroll restoration capability', () => {
  test('supported hosts use manual mode and restore their original setting', () => {
    const history = { scrollRestoration: 'auto' };
    withHistory(history, () => {
      const cleanup = manageScrollRestoration();
      expect(history.scrollRestoration).toBe('manual');
      cleanup();
      expect(history.scrollRestoration).toBe('auto');
    });
  });

  test('unsupported hosts do not gain an invented capability', () => {
    const history = {};
    withHistory(history, () => {
      manageScrollRestoration()();
      expect('scrollRestoration' in history).toBe(false);
    });
  });

  test('hosts that reject the manual setting do not prevent startup', () => {
    const history = Object.defineProperty({}, 'scrollRestoration', {
      get: () => 'auto', set: () => { throw new Error('restricted'); }
    });
    withHistory(history, () => {
      expect(() => manageScrollRestoration()()).not.toThrow();
    });
  });
});

describe('scroll control', () => {
  test('a forward navigation scrolls the new screen to the top', () => {
    const env = fakeScrollEnv(640);
    createScrollController(env).handle(navigation(HOME, EXERCISE_HISTORY));
    expect(env.writes).toEqual([0]);
  });

  test('a traversal explicitly restores the destination entry after content is ready', () => {
    const env = fakeScrollEnv(640);
    createScrollController(env).handle(navigation(EXERCISE_HISTORY, HISTORY, true), 6000);
    expect(env.writes).toEqual([6000]);
  });

  test('a navigation that stays on the same route writes nothing', () => {
    const env = fakeScrollEnv(640);
    createScrollController(env).handle({
      ...navigation(EXERCISE_HISTORY, { ...EXERCISE_HISTORY }), fromEntryId: 'destination'
    });
    expect(env.writes).toEqual([]);
  });

  test('a new forward entry with the same canonical URL still opens at the top', () => {
    const env = fakeScrollEnv(640);
    createScrollController(env).handle(navigation(EXERCISE_HISTORY, EXERCISE_HISTORY));
    expect(env.writes).toEqual([0]);
  });

  test('a same-name route with different params is a different screen and scrolls', () => {
    const env = fakeScrollEnv(640);
    createScrollController(env).handle(navigation(EXERCISE_HISTORY, {
      name: 'exercise-history', exerciseId: 'Bench_Press'
    }));
    expect(env.writes).toEqual([0]);
  });

  test('no recorded navigation writes nothing', () => {
    const env = fakeScrollEnv(640);
    createScrollController(env).handle(null);
    expect(env.writes).toEqual([]);
  });

  test('a page already at the top is not written to again', () => {
    const env = fakeScrollEnv(0);
    createScrollController(env).handle(navigation(HOME, EXERCISE_HISTORY));
    expect(env.writes).toEqual([]);
  });

  test('a fresh first publish without saved state scrolls to the top', () => {
    const env = fakeScrollEnv(320);
    createScrollController(env).handle(navigation(null, EXERCISE_HISTORY));
    expect(env.writes).toEqual([0]);
  });

  test('reload restores the current entry after its content loads', () => {
    const env = fakeScrollEnv(0);
    createScrollController(env).handle(navigation(null, EXERCISE_HISTORY), 420);
    expect(env.writes).toEqual([420]);
  });

  test('a new forward entry ignores the old screen position', () => {
    const env = fakeScrollEnv(640);
    createScrollController(env).handle(navigation(HOME, EXERCISE_HISTORY), 420);
    expect(env.writes).toEqual([0]);
  });

  test('repeated readiness reports do not reset a page the user has scrolled', () => {
    const env = fakeScrollEnv(640);
    const controller = createScrollController(env);
    const nav = navigation(HOME, EXERCISE_HISTORY);
    controller.handle(nav);
    env.y = 300;
    controller.handle(nav);
    expect(env.writes).toEqual([0]);
    expect(env.y).toBe(300);
  });

  test('a user scroll gesture cancels pending restoration', () => {
    const env = fakeScrollEnv(300);
    const controller = createScrollController(env);
    const nav = navigation(EXERCISE_HISTORY, HISTORY, true);
    controller.cancel(nav);
    controller.handle(nav, 6000);
    expect(env.writes).toEqual([]);
  });

  test('a traversal to the same hash is still a distinct entry', () => {
    const env = fakeScrollEnv(300);
    createScrollController(env).handle(navigation(EXERCISE_HISTORY, EXERCISE_HISTORY, true), 750);
    expect(env.writes).toEqual([750]);
  });
});
