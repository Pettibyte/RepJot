// Exercise History render regression.
//
// The screen loads its first page inside a `$effect` and assigns the pager
// state there. `appendPage` returned a fresh object on every empty read, so the
// effect re-ran forever and Svelte threw `effect_update_depth_exceeded`. Any
// exercise with fewer than one page of recorded history hit this.
//
// `mountTo` calls `flushSync`, so the loop throws inside the mount. A clean
// render is therefore the assertion.

import { afterEach, describe, expect, test } from 'bun:test';
import ExerciseHistoryScreen from '../../src/ui/screens/ExerciseHistoryScreen.svelte';
import { mountTo, settle, signIn, teardown, type Harness } from './harness';

let harness: Harness;

afterEach(() => {
  teardown();
});

describe('Exercise History render', () => {
  test('an exercise with no recorded history renders the empty state and settles', async () => {
    harness = await signIn();

    const { target } = mountTo(ExerciseHistoryScreen, { exerciseId: 'back-squat' });
    await settle(20);

    expect(target.textContent).toContain('Back Squat');
    expect(target.textContent).toContain('No recorded sets yet for this exercise.');
  });

  test('an unknown exercise id renders the missing state and settles', async () => {
    harness = await signIn();

    const { target } = mountTo(ExerciseHistoryScreen, { exerciseId: 'no-such-exercise' });
    await settle(20);

    expect(target.textContent).toContain('No exercise with that id');
  });
});
