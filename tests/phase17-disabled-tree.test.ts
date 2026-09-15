// The disabled tree with no session service.
//
// When REP JOT has no Drive connection, `sessionService` is null. Every
// control that writes must be inert, or the user types into a form that
// cannot persist anything and every keystroke is lost in silence. The
// finish bar already did this; the tree and the container controls did not.
//
// REQUIREMENTS 11.1, 19.9.

import { describe, expect, test } from 'bun:test';

import AmrapControls from '../src/ui/components/AmrapControls.svelte';
import ContainerScoreEditor from '../src/ui/components/ContainerScoreEditor.svelte';
import EffortControl from '../src/ui/components/EffortControl.svelte';
import EmomControls from '../src/ui/components/EmomControls.svelte';
import ExerciseRow from '../src/ui/components/ExerciseRow.svelte';
import SideControl from '../src/ui/components/SideControl.svelte';
import WorkoutTreeEditable from '../src/ui/components/WorkoutTreeEditable.svelte';
import type {
  ActiveExerciseRow,
  FieldModel,
  GroupModel
} from '../src/ui/viewmodels/activeWorkoutModel';
import { html as renderHtml } from './support/render';

function field(overrides: Partial<FieldModel> = {}): FieldModel {
  return {
    dimension: 'weight',
    label: 'Weight',
    value: '',
    unit: 'lb',
    compatibleUnits: ['lb', 'kg'],
    inputmode: 'decimal',
    stored: false,
    step: 0.1,
    ...overrides
  };
}

function row(overrides: Partial<ActiveExerciseRow> = {}): ActiveExerciseRow {
  return {
    key: 'w|set|1|both|1',
    nodeKey: 'w|set',
    resultKey: 'root/set|both|1',
    path: [{ nodeId: 'root' }, { nodeId: 'set' }],
    exerciseId: 'back-squat',
    exerciseName: 'Back Squat',
    prescriptionText: '8 reps @ 60 lb',
    fields: [
      field({ dimension: 'reps', unit: 'reps', inputmode: 'numeric', step: 1 }),
      field()
    ],
    lastTime: { kind: 'none', text: 'No history' },
    side: 'both',
    attempt: 1,
    status: 'completed',
    unresolved: false,
    recordable: true,
    level: 2,
    showCompactPath: false,
    compactPathLabel: '',
    hasSavedResult: false,
    unilateral: false,
    ...overrides
  };
}

function group(overrides: Partial<GroupModel> = {}): GroupModel {
  return {
    key: 'w|cindy|1',
    nodeKey: 'w|cindy',
    containerNodeId: 'cindy',
    storedPath: [{ nodeId: 'root' }, { nodeId: 'cindy' }],
    title: 'Cindy',
    level: 2,
    showCompactPath: false,
    compactPathLabel: 'root / Cindy',
    strategy: 'amrap',
    summaryText: 'AMRAP 20 min',
    scored: true,
    scoreType: 'rounds_and_reps',
    childDetail: 'optional',
    detailed: false,
    hasSavedDetail: false,
    canExpand: false,
    isAmrap: true,
    isEmom: false,
    totalIntervals: 0,
    rowKeys: [],
    ...overrides
  };
}

/** True when every `<input>` or `<select>` tag in the markup is disabled. */
function everyControlDisabled(markup: string): boolean {
  const tags = markup.match(/<(input|select)\b[^>]*>/g) ?? [];
  if (tags.length === 0) return true;
  return tags.every((tag) => tag.includes('disabled'));
}

describe('the tree locks when there is no session service', () => {
  test('a disabled tree renders no live input', () => {
    const markup = renderHtml(WorkoutTreeEditable, {
      blocks: [{ kind: 'row', row: row() }],
      disabled: true
    });
    // The tree carries inputs, so the guard has something to lock.
    expect(markup).toContain('<input');
    expect(everyControlDisabled(markup)).toBe(true);
  });

  test('an enabled tree leaves the inputs live', () => {
    const markup = renderHtml(WorkoutTreeEditable, {
      blocks: [{ kind: 'row', row: row() }],
      disabled: false
    });
    expect(everyControlDisabled(markup)).toBe(false);
  });

  test('a disabled row locks its status and reason selects', () => {
    const markup = renderHtml(ExerciseRow, { row: row(), disabled: true });
    expect(markup).toContain('<select');
    expect(everyControlDisabled(markup)).toBe(true);
  });

  test('a disabled row locks its attempt button', () => {
    const markup = renderHtml(ExerciseRow, {
      row: row({ hasSavedResult: true }),
      disabled: true
    });
    expect(markup).toContain('Add another attempt');
    const button = markup.slice(markup.indexOf('<button'), markup.indexOf('</button>'));
    expect(button).toContain('disabled');
  });
});

describe('the container controls lock with no session service', () => {
  test('the AMRAP partial field locks', () => {
    const markup = renderHtml(AmrapControls, { group: group(), disabled: true });
    expect(markup).toContain('Extra reps');
    expect(everyControlDisabled(markup)).toBe(true);
  });

  test('the EMOM interval field locks', () => {
    const markup = renderHtml(EmomControls, {
      group: group({ isEmom: true, scoreType: 'intervals', totalIntervals: 12 }),
      disabled: true
    });
    expect(everyControlDisabled(markup)).toBe(true);
  });

  test('the container score field locks', () => {
    const markup = renderHtml(ContainerScoreEditor, { group: group(), disabled: true });
    expect(everyControlDisabled(markup)).toBe(true);
  });
});

describe('the side and effort controls honor disabled', () => {
  test('a unilateral side control locks its selects', () => {
    const markup = renderHtml(SideControl, {
      row: row({ unilateral: true, side: 'left' }),
      side: 'alternating',
      disabled: true
    });
    expect(markup).toContain('<select');
    expect(everyControlDisabled(markup)).toBe(true);
  });

  test('a bilateral row shows no side control at all', () => {
    const markup = renderHtml(SideControl, { row: row({ unilateral: false }), side: 'both' });
    expect(markup).not.toContain('<select');
  });

  test('the effort control locks its select', () => {
    const markup = renderHtml(EffortControl, {
      target: { type: 'rir', target: 2 },
      disabled: true
    });
    expect(markup).toContain('<select');
    expect(everyControlDisabled(markup)).toBe(true);
  });

  test('a row with no programmed effort shows no effort control', () => {
    const markup = renderHtml(EffortControl, { target: undefined });
    expect(markup).not.toContain('<select');
  });
});
