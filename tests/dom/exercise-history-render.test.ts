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

  test('groups by session and joins sets loaded across a page boundary', async () => {
    harness = await signIn();
    const occurrences = Array.from({ length: 23 }, (_, index) => ({
      sessionId: index < 21 ? 'session-first' : 'session-second',
      exerciseId: 'back-squat', resultKey: `set-${index}`, encodedPath: 'set',
      attempt: 1, status: 'completed' as const,
      completedAtUtc: '2026-08-01T12:00:00Z',
      values: { reps: { value: index + 1, unit: 'reps' as const } }
    }));
    for (const [id, hour] of [['session-first', '12'], ['session-second', '09']]) {
      harness.lookup.index.sessionsById.set(id!, {
        id: id!, workoutId: 'demo', workoutName: 'Demo', status: 'completed',
        startedAtUtc: `2026-08-01T${hour}:00:00Z`,
        updatedAtUtc: `2026-08-01T${hour}:00:00Z`, shardName: 'results-2026-08.json'
      });
    }
    harness.coordinator.ensureLoaded = async () => null;
    harness.lookup.getExerciseHistory = (_id, { offset, limit }) => ({
      items: occurrences.slice(offset, offset + limit), total: occurrences.length,
      offset, limit, hasMore: offset + limit < occurrences.length
    });
    const { target } = mountTo(ExerciseHistoryScreen, { exerciseId: 'back-squat' });
    await settle(20);
    expect(target.querySelectorAll('.exercise-history-group').length).toBe(1);
    const load = Array.from(target.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Load older')
    );
    expect(load).toBeDefined();
    load!.click();
    await settle(20);
    const groups = target.querySelectorAll('.exercise-history-group');
    expect(groups.length).toBe(2);
    expect(groups[0]!.querySelectorAll('li').length).toBe(21);
    expect(groups[1]!.querySelectorAll('li').length).toBe(2);
    const headings = target.querySelectorAll('h2');
    expect(headings[0]!.textContent).not.toBe(headings[1]!.textContent);
    expect(headings[0]!.querySelector('time')!.dateTime).toBe('2026-08-01T12:00:00Z');
    expect(target.textContent).not.toContain('session-first');
    expect(target.textContent).toContain('23 reps');
  });

  test('an unknown exercise id renders the missing state and settles', async () => {
    harness = await signIn();

    const { target } = mountTo(ExerciseHistoryScreen, { exerciseId: 'no-such-exercise' });
    await settle(20);

    expect(target.textContent).toContain('No exercise with that id');
  });
});
