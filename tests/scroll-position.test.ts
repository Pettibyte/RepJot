// Scroll rule tests for same-document route changes.
//
// The environment is a recorder. `happy-dom` and the server renderer perform no
// layout, so a real scroll offset cannot be read or asserted there. The recorder
// proves the rule instead: which navigations write, and which leave the page
// alone.

import { describe, expect, test } from 'bun:test';
import { createScrollController, type ScrollEnv } from '../src/routing/scroll-position';
import type { NavigationInfo } from '../src/routing/hash-router';
import type { Route } from '../src/routing/routes';

/** A scroll environment that records every write. */
function fakeScrollEnv(startY = 640): ScrollEnv & { writes: number[]; y: number } {
  const env = {
    y: startY,
    writes: [] as number[],
    getY(): number {
      return env.y;
    },
    setY(y: number): void {
      env.writes.push(y);
      env.y = y;
    }
  };
  return env;
}

const HOME: Route = { name: 'home' };
const HISTORY: Route = { name: 'history' };
const EXERCISE_HISTORY: Route = { name: 'exercise-history', exerciseId: 'Barbell_Squat' };

describe('scroll control', () => {
  test('a forward navigation scrolls the new screen to the top', () => {
    const env = fakeScrollEnv(640);
    const controller = createScrollController(env);
    const nav: NavigationInfo = { from: HOME, to: EXERCISE_HISTORY, traversed: false };

    controller.handle(nav);

    expect(env.writes).toEqual([0]);
  });

  test('a back traversal writes nothing, so the browser restores the position', () => {
    const env = fakeScrollEnv(640);
    const controller = createScrollController(env);
    const nav: NavigationInfo = { from: EXERCISE_HISTORY, to: HISTORY, traversed: true };

    controller.handle(nav);

    expect(env.writes).toEqual([]);
  });

  test('a navigation that stays on the same route writes nothing', () => {
    const env = fakeScrollEnv(640);
    const controller = createScrollController(env);
    const nav: NavigationInfo = {
      from: EXERCISE_HISTORY,
      to: { name: 'exercise-history', exerciseId: 'Barbell_Squat' },
      traversed: false
    };

    controller.handle(nav);

    expect(env.writes).toEqual([]);
  });

  test('a same-name route with different params is a different screen and scrolls', () => {
    const env = fakeScrollEnv(640);
    const controller = createScrollController(env);
    const nav: NavigationInfo = {
      from: EXERCISE_HISTORY,
      to: { name: 'exercise-history', exerciseId: 'Bench_Press' },
      traversed: false
    };

    controller.handle(nav);

    expect(env.writes).toEqual([0]);
  });

  test('no recorded navigation writes nothing', () => {
    const env = fakeScrollEnv(640);
    const controller = createScrollController(env);

    controller.handle(null);

    expect(env.writes).toEqual([]);
  });

  test('a page already at the top is not written to again', () => {
    const env = fakeScrollEnv(0);
    const controller = createScrollController(env);
    const nav: NavigationInfo = { from: HOME, to: EXERCISE_HISTORY, traversed: false };

    controller.handle(nav);

    expect(env.writes).toEqual([]);
  });

  test('the first publish after load scrolls to the top', () => {
    const env = fakeScrollEnv(320);
    const controller = createScrollController(env);
    const nav: NavigationInfo = { from: null, to: EXERCISE_HISTORY, traversed: false };

    controller.handle(nav);

    expect(env.writes).toEqual([0]);
  });
});
