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
    sideSelectable: false,
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

/**
 * True when every chip button in the markup is disabled.
 *
 * The short-choice controls are chips, not selects, so the input-and-select
 * sweep above cannot see them. A chip left live while the row is locked is a
 * real bug, so this checks them on their own terms.
 */
function everyChipDisabled(markup: string): boolean {
  const chips = markup.match(/<button\b[^>]*class="pill chip[^"]*"[^>]*>/g) ?? [];
  if (chips.length === 0) return false;
  return chips.every((tag) => tag.includes('disabled'));
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

  test('a disabled row locks its status and reason chips', () => {
    // A non-completed status is what makes the reason group appear.
    const markup = renderHtml(ExerciseRow, {
      row: row({ status: 'incomplete' }),
      status: 'incomplete',
      disabled: true
    });
    // No select survives on the workout screens: the e-ink target renders
    // the popup blank.
    expect(markup).not.toContain('<select');
    expect(everyChipDisabled(markup)).toBe(true);
    // Both groups print their label and their full vocabulary.
    expect(markup).toContain('>Status<');
    expect(markup).toContain('>Reason<');
    expect(markup).toContain('>Completed</button>');
    expect(markup).toContain('>Equipment unavailable</button>');
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
  test('a unilateral side control locks its chips', () => {
    const markup = renderHtml(SideControl, {
      row: row({ unilateral: true, sideSelectable: true, side: 'left' }),
      side: 'alternating',
      disabled: true
    });
    // The side control is chips, not a native select. A select opens its
    // list in a browser-drawn popup the e-ink target renders blank.
    expect(markup).not.toContain('<select');
    const chips = markup.match(/<button\b[^>]*>/g) ?? [];
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.every((tag) => tag.includes('disabled'))).toBe(true);
    // The chosen chip is marked, so the counting method reads without
    // opening anything.
    expect(markup).toContain('aria-pressed="true"');
  });

  test('a row that cannot split sides shows no side control at all', () => {
    const markup = renderHtml(SideControl, { row: row({ sideSelectable: false }), side: 'both' });
    expect(markup).not.toContain('<select');
    expect(markup).not.toContain('class="pill chip');
  });

  test('a bilateral per-implement row still shows the side control', () => {
    // A bilateral exercise loaded one weight per side can still be worked
    // one side at a time, so the choice stays reachable. REQUIREMENT 11.5.
    const markup = renderHtml(SideControl, { row: row({ sideSelectable: true }), side: 'both' });
    expect(markup).toContain('Side');
    expect(markup).toContain('Alternate');
  });

  test('the effort control locks its chips', () => {
    const markup = renderHtml(EffortControl, {
      target: { type: 'rir', target: 2 },
      disabled: true
    });
    expect(markup).not.toContain('<select');
    expect(everyChipDisabled(markup)).toBe(true);
    // An RIR row lists Not recorded plus RIR 0 through 10, so twelve.
    const chips = markup.match(/<button\b[^>]*class="pill chip[^"]*"[^>]*>/g) ?? [];
    expect(chips.length).toBe(12);
  });

  test('a row with no programmed effort shows no effort control', () => {
    const markup = renderHtml(EffortControl, { target: undefined });
    expect(markup).not.toContain('<select');
  });
});
