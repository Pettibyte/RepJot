// The in-app Back control through the real router and the real shell.
//
// The unit suite proves the router and the scroll controller in isolation. This
// proves the wiring in `App.svelte`: the shell reads the origin the real router
// recorded, and a browser traversal leaves the origin of the screen it lands on
// alone.
//
// Only the header is asserted. The shell renders the back header before the
// outlet, so the assertion does not depend on the screen behind it finishing its
// own load.

import { afterEach, describe, expect, test } from 'bun:test';
import App from '../../src/App.svelte';
import { createRouter, type RouterEnv } from '../../src/routing/hash-router';
import { getRouter, setRouter } from '../../src/routing/router-registry';
import { setStartupStatus } from '../../src/state/app-state';
import { mountTo, settle, signIn, teardown, type Harness } from './harness';
import { WORKOUT_ID } from '../fixtures/semantic';

const ACCOUNT = { accountKey: 'acct-1', displayName: 'Test User' };
const EXERCISE_ID = 'back-squat';
const OVERVIEW_HASH = `#/workouts/${WORKOUT_ID}`;

let harness: Harness;

/**
 * In-memory router environment.
 *
 * Mirrors the fake in the router unit suite. `replaceHash` fires no `hashchange`,
 * because `history.replaceState` does not either. `traverseTo` fires `popstate`
 * then `hashchange`, which is the order the browser uses.
 */
function fakeEnv(initial: string): RouterEnv & { traverseTo(hash: string): void } {
  const env = {
    hash: initial,
    listeners: [] as Array<() => void>,
    popStateListeners: [] as Array<() => void>,
    getHash(): string {
      return env.hash;
    },
    setHash(hash: string): void {
      env.hash = hash;
      env.listeners.forEach((listener: () => void): void => listener());
    },
    replaceHash(hash: string): void {
      env.hash = hash;
    },
    traverseTo(hash: string): void {
      env.hash = hash;
      env.popStateListeners.forEach((listener: () => void): void => listener());
      env.listeners.forEach((listener: () => void): void => listener());
    },
    onHashChange(listener: () => void): () => void {
      env.listeners.push(listener);
      return (): void => {
        env.listeners = env.listeners.filter((item: () => void): boolean => item !== listener);
      };
    },
    onPopState(listener: () => void): () => void {
      env.popStateListeners.push(listener);
      return (): void => {
        env.popStateListeners = env.popStateListeners.filter(
          (item: () => void): boolean => item !== listener
        );
      };
    }
  };
  return env;
}

/** The href the shell's back control carries right now. */
function backHref(target: HTMLElement): string {
  const link = target.querySelector('.back-header__back');
  return link?.getAttribute('href') ?? '';
}

/** Mount the shell over a real router on a fake address bar. */
async function mountShell(
  initialHash: string,
  startup: 'ready' | 'loading_static' | 'blocked' | 'static_failed' = 'ready'
): Promise<{
  target: HTMLElement;
  env: RouterEnv & { traverseTo(hash: string): void };
}> {
  harness = await signIn();
  setStartupStatus(startup);
  const env = fakeEnv(initialHash);
  const router = createRouter({ env });
  setRouter(router);
  router.start();

  const { target } = mountTo(App, {
    route: router.current(),
    account: ACCOUNT,
    clientId: 'cid'
  });
  await settle(8);
  return { target, env };
}

afterEach(() => {
  setRouter(null);
  teardown();
});

describe('in-app Back through the real router and shell', () => {
  test('with no origin recorded the back control uses the static parent', async () => {
    const { target } = await mountShell(OVERVIEW_HASH);

    expect(backHref(target)).toBe('#/');
  });

  test('Exercise History returns to the workout overview that opened it', async () => {
    const { target } = await mountShell(OVERVIEW_HASH);

    // The reported bug: this answered `#/history` no matter where the user
    // came from.
    getRouter()?.navigate({ name: 'exercise-history', exerciseId: EXERCISE_ID });
    await settle(8);

    expect(backHref(target)).toBe(OVERVIEW_HASH);
  });

  test('a browser back leaves the origin of the screen it lands on alone', async () => {
    const { target, env } = await mountShell(OVERVIEW_HASH);

    getRouter()?.navigate({ name: 'exercise-history', exerciseId: EXERCISE_ID });
    await settle(8);
    expect(backHref(target)).toBe(OVERVIEW_HASH);

    env.traverseTo(OVERVIEW_HASH);
    await settle(8);

    // Without the traversal signal this becomes the exercise-history route,
    // and Back then bounces between the two screens forever.
    expect(backHref(target)).toBe('#/');
  });

  test('a forward navigation after a browser back records the new origin', async () => {
    const { target, env } = await mountShell(OVERVIEW_HASH);

    getRouter()?.navigate({ name: 'exercise-history', exerciseId: EXERCISE_ID });
    await settle(8);
    env.traverseTo(OVERVIEW_HASH);
    await settle(8);
    expect(backHref(target)).toBe('#/');

    getRouter()?.navigate({ name: 'exercise-history', exerciseId: 'push-up' });
    await settle(8);

    expect(backHref(target)).toBe(OVERVIEW_HASH);
  });
});

describe('startup scroll readiness', () => {
  test('the loading placeholder does not consume a generic route restoration', async () => {
    const { target } = await mountShell(OVERVIEW_HASH, 'loading_static');
    expect(target.textContent).toContain('Loading REP JOT');
    expect(getRouter()?.scrollForCurrent()).toBeNull();
    document.documentElement.scrollTop = 640;

    setStartupStatus('ready');
    await settle(12);

    expect(document.documentElement.scrollTop).toBe(0);
    expect(getRouter()?.scrollForCurrent()).toBe(0);
  });

  for (const status of ['blocked', 'static_failed'] as const) {
    test(`${status} treats a terminal blocker as rendered content`, async () => {
      const { target } = await mountShell('#/sessions/session-one/active', status);
      expect(target.textContent).toContain('REP JOT cannot start');
      expect(getRouter()?.scrollForCurrent()).toBe(0);
    });
  }
});

describe('scroll on route change through the real shell', () => {
  /** The offset the shell sees. happy-dom backs this with `documentElement`. */
  function scrollOffset(): number {
    return document.documentElement.scrollTop;
  }

  function setScrollOffset(px: number): void {
    document.documentElement.scrollTop = px;
  }

  test('a forward navigation scrolls the new screen to the top', async () => {
    const { target } = await mountShell(OVERVIEW_HASH);
    void target;
    setScrollOffset(640);

    getRouter()?.navigate({ name: 'exercise-history', exerciseId: EXERCISE_ID });
    await settle(8);

    // The reported bug: the offset from the workout editor carried onto the
    // history page and landed the reader midway down the list.
    expect(scrollOffset()).toBe(0);
  });

  test('a browser back explicitly restores the destination entry offset', async () => {
    const { env } = await mountShell(OVERVIEW_HASH);
    setScrollOffset(512);
    window.dispatchEvent(new Event('scroll'));

    getRouter()?.navigate({ name: 'exercise-history', exerciseId: EXERCISE_ID });
    await settle(8);
    setScrollOffset(200);
    window.dispatchEvent(new Event('scroll'));

    env.traverseTo(OVERVIEW_HASH);
    await settle(8);

    // The outgoing screen has a different offset. Restoration belongs to the
    // destination entry and happens only after its content has rendered.
    expect(scrollOffset()).toBe(512);
  });

  test('a navigation that stays on the same route does not move the page', async () => {
    const { env } = await mountShell(OVERVIEW_HASH);
    void env;
    setScrollOffset(300);

    getRouter()?.navigate({ name: 'workout-overview', workoutId: WORKOUT_ID });
    await settle(8);

    expect(scrollOffset()).toBe(300);
  });
});
