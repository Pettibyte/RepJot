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

describe('ExerciseSetTable: circuit matrix', () => {
  /** The exercise-by-set grid the model produces for the fixture above. */
  const matrix = {
    columns: [
      { key: 'r1', label: 'Set 1', setNumber: 1 },
      { key: 'r2', label: 'Set 2', setNumber: 2 }
    ],
    rows: [
      {
        key: 'curl-node',
        exerciseName: 'Preacher Curl',
        prescriptionText: '8 reps',
        lastTime: { kind: 'none' as const, text: '' },
        cells: [
          { key: 'curl@r1', rows: [row('a', 'Preacher Curl', 1)] },
          { key: 'curl@r2', rows: [row('c', 'Preacher Curl', 2)] }
        ]
      },
      {
        key: 'ext-node',
        exerciseName: 'Triceps Extension',
        prescriptionText: '8 reps',
        lastTime: { kind: 'none' as const, text: '' },
        cells: [
          { key: 'ext@r1', rows: [row('b', 'Triceps Extension', 1)] },
          { key: 'ext@r2', rows: [row('d', 'Triceps Extension', 2)] }
        ]
      }
    ]
  };

  const table: ActiveSetTable = {
    key: 'sets-w|superset',
    title: 'Superset A',
    sectionTitle: 'Strength',
    label: 'Working sets',
    level: 3,
    multiExercise: true,
    rounds: [],
    rows: [row('a', 'Preacher Curl', 1), row('b', 'Triceps Extension', 1),
           row('c', 'Preacher Curl', 2), row('d', 'Triceps Extension', 2)],
    matrix: matrix as never
  };

  const clean = html(ExerciseSetTable as never, { table, idPrefix: 'm' });

  test('the exercise name prints once per line, not once per set', () => {
    // Two exercises, so two name cells. The old round-grouped layout printed
    // one per set, which is four.
    expect([...clean.matchAll(/class="set-matrix__exercise"/g)]).toHaveLength(2);
  });

  test('the column headers name the sets', () => {
    const cols = [...clean.matchAll(/class="set-matrix__col"[^>]*>([^<]+)</g)]
      .map((match) => match[1].trim());
    expect(cols).toEqual(['Set 1', 'Set 2']);
  });

  test('a clean table raises no attention marks anywhere', () => {
    expect(clean).not.toContain('Needs attention');
    expect(clean).not.toContain('--error');
  });

  test('a missing row marks its line, its cell, and the section head', () => {
    const out = html(ExerciseSetTable as never, {
      table,
      idPrefix: 'm',
      missingRowKeys: ['c']
    });
    // The section head says it once, so the user finds the table.
    const head = out.slice(out.indexOf('set-table__head'), out.indexOf('set-table__label'));
    expect(head).toContain('Needs attention');
    // The exercise line is tinted, so the user finds the row.
    expect(out).toContain('set-matrix__line--error');
    // The cell is tinted, so the user finds the set.
    expect(out).toContain('set-matrix__cell--error');
    // The cell itself says it, because a cell has no left border to carry it.
    expect(out).toContain('exercise-row--cell');
    expect(out).toContain('exercise-row--missing');
  });

  test('an invalid field marks the row even when nothing is missing', () => {
    const out = html(ExerciseSetTable as never, {
      table,
      idPrefix: 'm',
      rowFieldErrors: { d: { reps: 'Enter a whole number of 0 or more.' } }
    });
    expect(out).toContain('set-matrix__line--error');
    expect(out).toContain('set-matrix__cell--error');
    const head = out.slice(out.indexOf('set-table__head'), out.indexOf('set-table__label'));
    expect(head).toContain('Needs attention');
  });

  test('one bad line does not mark the other lines', () => {
    const out = html(ExerciseSetTable as never, {
      table,
      idPrefix: 'm',
      missingRowKeys: ['c']
    });
    // Only the Preacher Curl line is bad, so exactly one line carries the mark.
    expect([...out.matchAll(/set-matrix__line--error/g)]).toHaveLength(1);
    // And exactly one cell, not every cell in the row.
    expect([...out.matchAll(/set-matrix__cell--error/g)]).toHaveLength(1);
  });
});

describe('ExerciseSetTable: chip controls replace selects', () => {
  const table: ActiveSetTable = {
    key: 'sets-w|chips',
    title: 'Superset C',
    sectionTitle: 'Strength',
    label: 'Working sets',
    level: 3,
    multiExercise: true,
    rounds: [],
    rows: [row('a', 'Preacher Curl', 1)],
    matrix: {
      columns: [{ key: 'r1', label: 'Set 1', setNumber: 1 }],
      rows: [
        {
          key: 'curl-node',
          exerciseName: 'Preacher Curl',
          prescriptionText: '8 reps',
          lastTime: { kind: 'none' as const, text: '' },
          cells: [{ key: 'curl@r1', rows: [row('a', 'Preacher Curl', 1)] }]
        }
      ]
    } as never
  };

  const out = html(ExerciseSetTable as never, { table, idPrefix: 'c' });

  test('no native select survives anywhere in the grid', () => {
    // The e-ink target renders a select popup as a blank white rectangle,
    // so no workout control may use one.
    expect(out).not.toContain('<select');
    expect(out).not.toContain('<option');
  });

  test('the status group renders all three statuses as chips', () => {
    expect(out).toContain('>Status<');
    expect(out).toContain('>Completed</button>');
    expect(out).toContain('>Incomplete</button>');
    expect(out).toContain('>Skipped</button>');
  });

  test('the chosen status is marked, so it reads without opening', () => {
    // The fixture row is `completed`.
    const on = out.match(/<button class="pill chip chip--on"[^>]*aria-pressed="true">([^<]+)</);
    expect(on?.[1]).toBe('Completed');
  });

  test('the chip group is a labelled group for assistive tech', () => {
    expect(out).toContain('role="group"');
    expect(out).toContain('aria-labelledby=');
  });
});
