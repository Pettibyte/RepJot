// The circuit set table renderer.
//
// The view models decide which blocks collapse; this holds the contract the
// page actually shows: a circuit prints one `Round N` divider per round and
// names the exercise on every row, and the set label never repeats that
// name.

import { describe, expect, test } from 'bun:test';

import ExerciseSetTable from '../src/ui/components/ExerciseSetTable.svelte';
import type { ActiveSetTable } from '../src/ui/viewmodels/activeWorkoutModel';
import { html } from './support/render';

/** One row, shaped enough for the table to draw it. */
function row(key: string, name: string, setNumber: number) {
  return {
    key,
    nodeKey: `w|${key}`,
    resultKey: `${key}|both|1`,
    path: [],
    exerciseId: 'back-squat',
    exerciseName: name,
    prescriptionText: '8 reps',
    fields: [],
    lastTime: { hasAny: false, label: '' },
    side: 'both',
    attempt: 1,
    status: 'completed',
    unresolved: false,
    recordable: true,
    level: 3,
    showCompactPath: false,
    compactPathLabel: '',
    hasSavedResult: false,
    unilateral: false,
    setNumber,
    latestAttempt: true
  } as never;
}

describe('ExerciseSetTable: circuit', () => {
  const circuit: ActiveSetTable = {
    key: 'sets-w|superset',
    title: 'Superset A',
    sectionTitle: 'Strength',
    label: 'Working sets',
    level: 3,
    multiExercise: true,
    rounds: [
      {
        key: 'r1',
        label: 'Round 1',
        rows: [row('a', 'Preacher Curl', 1), row('b', 'Triceps Extension', 1)]
      },
      {
        key: 'r2',
        label: 'Round 2',
        rows: [row('c', 'Preacher Curl', 2), row('d', 'Triceps Extension', 2)]
      }
    ],
    rows: [row('a', 'Preacher Curl', 1), row('b', 'Triceps Extension', 1),
           row('c', 'Preacher Curl', 2), row('d', 'Triceps Extension', 2)]
  };

  const out = html(ExerciseSetTable as never, { table: circuit, idPrefix: 't' });

  test('one round divider per round', () => {
    const dividers = [...out.matchAll(/class="set-table__round"[^>]*>([^<]+)</g)]
      .map((match) => match[1].trim());
    expect(dividers).toEqual(['Round 1', 'Round 2']);
  });

  test('every row names its own exercise', () => {
    const names = [...out.matchAll(/class="exercise-row__set-name"[^>]*>([^<]+)</g)]
      .map((match) => match[1].trim());
    expect(names).toEqual([
      'Preacher Curl',
      'Triceps Extension',
      'Preacher Curl',
      'Triceps Extension'
    ]);
  });

  test('the set label carries the set only, never the exercise name', () => {
    const labels = [...out.matchAll(/class="exercise-row__set-label"[^>]*>([^<]+)</g)]
      .map((match) => match[1].trim());
    expect(labels).toEqual(['Set 1', 'Set 1', 'Set 2', 'Set 2']);
  });

  test('a circuit table draws no single Last Time badge in its head', () => {
    // The badge rides each row, so one exercise cannot read as the whole
    // circuit's history.
    const head = out.slice(out.indexOf('set-table__head'), out.indexOf('set-table__label'));
    expect(head).not.toContain('last-time');
  });
});

describe('ExerciseSetTable: single exercise', () => {
  const single: ActiveSetTable = {
    key: 'sets-w|squat',
    title: 'Back Squat',
    sectionTitle: 'Strength',
    label: 'Working sets',
    level: 2,
    multiExercise: false,
    rounds: [
      { key: 'r1', label: '', rows: [row('a', 'Back Squat', 1)] },
      { key: 'r2', label: '', rows: [row('b', 'Back Squat', 2)] }
    ],
    rows: [row('a', 'Back Squat', 1), row('b', 'Back Squat', 2)],
    lastTime: { hasAny: false, label: '' }
  };

  const out = html(ExerciseSetTable as never, { table: single, idPrefix: 's' });

  test('no round divider prints, because the set number already orders it', () => {
    expect(out).not.toContain('set-table__round');
  });

  test('no per-row exercise name prints, because the heading already names it', () => {
    expect(out).not.toContain('exercise-row__set-name');
  });

  test('rows still read as a plain set list', () => {
    const labels = [...out.matchAll(/class="exercise-row__set-label"[^>]*>([^<]+)</g)]
      .map((match) => match[1].trim());
    expect(labels).toEqual(['Set 1', 'Set 2']);
  });
});
