// The Active Workout screen and its decision logic.
// Phase 17. REQUIREMENTS 11.2, 11.9, 11.15-11.17, 15.1-15.8, 10.19-10.23.

import { describe, expect, test } from 'bun:test';

import ActiveWorkoutScreen from '../src/ui/screens/ActiveWorkoutScreen.svelte';
import {
  amrapPartialScore,
  buildRowDraft,
  finishPlan,
  lastTimeFillText,
  scoreFromText,
  terminalActionsAllowed
} from '../src/ui/screens/activeWorkoutActions';
import type { ActiveExerciseRow, FieldModel } from '../src/ui/viewmodels/activeWorkoutModel';
import type { MissingWorkItem } from '../src/sessions/session-service';
import { isBlankExerciseDraft } from '../src/sessions/drafts';
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
    exerciseId: 'back-squat',
    exerciseName: 'Back Squat',
    path: [
      { nodeId: 'root' },
      { nodeId: 'sets', iteration: 1 },
      { nodeId: 'set' }
    ],
    level: 3,
    showCompactPath: false,
    compactPathLabel: 'root / sets / Round 1',
    recordable: true,
    unresolved: false,
    fields: [
      field({ dimension: 'reps', unit: 'reps', inputmode: 'numeric', step: 1 }),
      field()
    ],
    status: 'completed',
    resultKey: 'root/sets:1/set|both|1',
    hasSavedResult: false,
    lastTime: { kind: 'none', text: 'No history' },
    ...overrides
  };
}

describe('buildRowDraft', () => {
  test('a blank row creates no values, so it records nothing', () => {
    const draft = buildRowDraft({ workoutId: 'w', row: row(), overrides: {} });
    // A blank input must not become a zero. REQUIREMENT 11.2.
    expect(Object.keys(draft.values ?? {})).toHaveLength(0);
    expect(isBlankExerciseDraft(draft)).toBe(true);
  });

  test('typed values are recorded in the unit the field shows', () => {
    const draft = buildRowDraft({
      workoutId: 'w',
      row: row(),
      overrides: { weight: '135', reps: '5' }
    });
    expect(draft.values?.weight).toEqual({ value: 135, unit: 'lb' });
    expect(draft.values?.reps).toEqual({ value: 5, unit: 'reps' });
    expect(isBlankExerciseDraft(draft)).toBe(false);
  });

  test('a unit-only display conversion does not rewrite the stored quantity', () => {
    const source = row({
      hasSavedResult: true,
      storedValues: { weight: { value: 100, unit: 'lb' } },
      fields: [field({ value: '45.4', unit: 'kg', compatibleUnits: ['lb', 'kg'] })]
    });
    const draft = buildRowDraft({
      workoutId: 'w',
      row: source,
      overrides: { weight: '45.4' },
      editedFields: {}
    });
    expect(draft.values?.weight).toEqual({ value: 100, unit: 'lb' });
  });

  test('editing a converted display records the new displayed quantity', () => {
    const source = row({
      hasSavedResult: true,
      storedValues: { weight: { value: 100, unit: 'lb' } },
      fields: [field({ value: '45.4', unit: 'kg', compatibleUnits: ['lb', 'kg'] })]
    });
    const draft = buildRowDraft({
      workoutId: 'w',
      row: source,
      overrides: { weight: '50' },
      editedFields: { weight: true }
    });
    expect(draft.values?.weight).toEqual({ value: 50, unit: 'kg' });
  });

  test('a non-completed status carries a reason code', () => {
    // The validator refuses a skipped result with no reason. REQUIREMENT 11.14.
    const draft = buildRowDraft({
      workoutId: 'w',
      row: row(),
      overrides: {},
      status: 'skipped'
    });
    expect(draft.status).toBe('skipped');
    expect(draft.reasonCode).toBeDefined();
  });

  test('a completed status carries no reason code', () => {
    const draft = buildRowDraft({
      workoutId: 'w',
      row: row({ status: 'completed' }),
      overrides: { weight: '135' },
      reasonCode: 'injured'
    });
    // A completed result must not carry a reason. REQUIREMENT 11.14.
    expect(draft.reasonCode).toBeUndefined();
  });

  test('a starting side survives onto an alternating draft', () => {
    // The schema allows `startingSide` on an alternating set only, so the
    // draft carries it when the row is alternating.
    const draft = buildRowDraft({
      workoutId: 'w',
      row: row({ side: 'alternating', startingSide: 'left' }),
      overrides: { weight: '135' }
    });
    expect(draft.side).toBe('alternating');
    expect(draft.startingSide).toBe('left');
  });

  test('a starting side is dropped on a non-alternating draft', () => {
    // The validator rejects the pair on any other side, so a stale
    // starting side must not ride onto a `both` set.
    const draft = buildRowDraft({
      workoutId: 'w',
      row: row({ side: 'both', startingSide: 'left' }),
      overrides: { weight: '135' }
    });
    expect(draft.startingSide).toBeUndefined();
  });

  test('a draft side override replaces the row side', () => {
    // The side is part of the result key, so a side change writes a
    // different key. REQUIREMENT 11.5.
    const draft = buildRowDraft({
      workoutId: 'w',
      row: row({ side: 'left' }),
      overrides: { weight: '90' },
      side: 'right'
    });
    expect(draft.side).toBe('right');
  });

  test('a draft effort rides onto the draft, and null clears it', () => {
    // The effort is a recorded value, so an effort-only draft is not blank.
    // REQUIREMENT 19.9.
    const withEffort = buildRowDraft({
      workoutId: 'w',
      row: row(),
      overrides: {},
      effort: { type: 'rir', value: 1 }
    });
    expect(withEffort.effort).toEqual({ type: 'rir', value: 1 });
    expect(isBlankExerciseDraft(withEffort)).toBe(false);

    const cleared = buildRowDraft({
      workoutId: 'w',
      row: row({ effort: { type: 'failure', achieved: true } }),
      overrides: {},
      effort: null
    });
    expect(cleared.effort).toBeUndefined();
  });

  test('a row effort survives when no draft effort is given', () => {
    const draft = buildRowDraft({
      workoutId: 'w',
      row: row({ effort: { type: 'rpe', value: 9 } }),
      overrides: { weight: '90' }
    });
    expect(draft.effort).toEqual({ type: 'rpe', value: 9 });
  });

  test('the draft carries the row path, side, and attempt unchanged', () => {
    const source = row({ side: 'left', attempt: 2 });
    const draft = buildRowDraft({ workoutId: 'w', row: source, overrides: { weight: '90' } });
    expect(draft.executionPath).toEqual(source.path);
    expect(draft.side).toBe('left');
    expect(draft.attempt).toBe(2);
    expect(draft.workoutId).toBe('w');
  });
});

describe('lastTimeFillText', () => {
  test('fills each recorded dimension in the unit the field shows', () => {
    const target = row({
      lastTime: {
        kind: 'value',
        text: '100 kg',
        fill: { reps: { value: 5, unit: 'reps' }, weight: { value: 100, unit: 'kg' } }
      }
    });

    // The field shows pounds, so the fill writes pounds.
    expect(lastTimeFillText(target)).toEqual({ reps: '5', weight: '220.5' });
  });

  test('fills a minute duration as mm:ss', () => {
    const target = row({
      fields: [field({
        dimension: 'duration',
        unit: 'minute',
        compatibleUnits: ['second', 'minute']
      })],
      lastTime: { kind: 'value', text: '135 s', fill: { duration: { value: 135, unit: 'second' } } }
    });

    expect(lastTimeFillText(target)).toEqual({ duration: '2:15' });
  });

  test('a dimension the last session skipped is left alone', () => {
    const target = row({
      lastTime: { kind: 'value', text: '5 reps', fill: { reps: { value: 5, unit: 'reps' } } }
    });

    const filled = lastTimeFillText(target);
    expect(filled.reps).toBe('5');
    // No weight key, so a value the user already typed there survives.
    expect(Object.keys(filled)).toEqual(['reps']);
  });

  test('no history fills nothing', () => {
    expect(lastTimeFillText(row())).toEqual({});
  });

  test('a value the unit vocabulary cannot convert fills nothing', () => {
    const target = row({
      fields: [field({ dimension: 'distance', unit: 'm', compatibleUnits: ['m', 'km'] })],
      lastTime: { kind: 'value', text: '5 kg', fill: { distance: { value: 5, unit: 'kg' } } }
    });

    expect(lastTimeFillText(target)).toEqual({});
  });

  test('the filled text records the same number the field shows', () => {
    const target = row({
      lastTime: { kind: 'value', text: '225 lb', fill: { weight: { value: 225, unit: 'lb' } } }
    });
    const filled = lastTimeFillText(target);

    const draft = buildRowDraft({
      workoutId: 'w',
      row: target,
      overrides: filled,
      editedFields: { weight: true }
    });
    expect(draft.values?.weight).toEqual({ value: 225, unit: 'lb' });
  });
});

describe('scoreFromText', () => {
  test('a cycles score carries the typed count', () => {
    expect(scoreFromText('cycles', 4, 0)).toEqual({ type: 'cycles', completedCycles: 4 });
  });

  test('a rounds-and-reps score starts with no extra reps', () => {
    expect(scoreFromText('rounds_and_reps', 3, 0)).toEqual({
      type: 'rounds_and_reps',
      completedRounds: 3,
      additionalReps: 0
    });
  });

  test('an intervals score clamps to the programmed total', () => {
    // A score that claims more intervals than were programmed cannot
    // validate. REQUIREMENT 10.21.
    expect(scoreFromText('intervals', 99, 12)).toEqual({
      type: 'intervals',
      completedIntervals: 12,
      totalIntervals: 12
    });
  });

  test('an intervals score under the total is kept', () => {
    expect(scoreFromText('intervals', 7, 12)).toEqual({
      type: 'intervals',
      completedIntervals: 7,
      totalIntervals: 12
    });
  });

  test('a negative count floors at zero', () => {
    expect(scoreFromText('cycles', -5, 0)).toEqual({ type: 'cycles', completedCycles: 0 });
  });

  test('a fractional count truncates to a whole number', () => {
    expect(scoreFromText('cycles', 3.9, 0)).toEqual({ type: 'cycles', completedCycles: 3 });
  });
});

describe('amrapPartialScore', () => {
  test('the existing round count survives', () => {
    // Typing extra reps must not reset completed rounds. REQUIREMENT 10.22.
    const existing = { type: 'rounds_and_reps' as const, completedRounds: 7, additionalReps: 2 };
    expect(amrapPartialScore(existing, 5)).toEqual({
      type: 'rounds_and_reps',
      completedRounds: 7,
      additionalReps: 5
    });
  });

  test('a missing prior score starts at zero rounds', () => {
    expect(amrapPartialScore(undefined, 3)).toEqual({
      type: 'rounds_and_reps',
      completedRounds: 0,
      additionalReps: 3
    });
  });

  test('a prior score of another kind does not leak its count', () => {
    const existing = { type: 'cycles' as const, completedCycles: 9 };
    expect(amrapPartialScore(existing, 4)).toEqual({
      type: 'rounds_and_reps',
      completedRounds: 0,
      additionalReps: 4
    });
  });

  test('a negative extra-rep count floors at zero', () => {
    expect(amrapPartialScore(undefined, -2)).toEqual({
      type: 'rounds_and_reps',
      completedRounds: 0,
      additionalReps: 0
    });
  });
});

describe('finishPlan', () => {
  const gaps: MissingWorkItem[] = [
    {
      nodeKey: 'w|a',
      rowKey: 'w|root/a:2|both|1',
      exerciseName: 'Back Squat',
      compactPathLabel: 'Round 2',
      reason: 'no_result'
    }
  ];

  test('no gaps means the plain Finish button is live', () => {
    const plan = finishPlan([], false);
    expect(plan.showPrompt).toBe(false);
    expect(plan.canFinish).toBe(true);
  });

  test('gaps with no request still show the plain bar', () => {
    // The prompt appears only after the user presses Finish. A bar that
    // warned on every render would nag.
    const plan = finishPlan(gaps, false);
    expect(plan.showPrompt).toBe(false);
    expect(plan.canFinish).toBe(true);
  });

  test('a finish request with gaps opens the prompt', () => {
    const plan = finishPlan(gaps, true);
    expect(plan.showPrompt).toBe(true);
    expect(plan.items).toHaveLength(1);
  });

  test('a finish request with no gaps needs no prompt', () => {
    const plan = finishPlan([], true);
    expect(plan.showPrompt).toBe(false);
    expect(plan.canFinish).toBe(true);
  });
});

describe('terminalActionsAllowed', () => {
  test('an in-progress session may finish or abandon', () => {
    expect(terminalActionsAllowed('in_progress')).toBe(true);
  });

  test('a completed session may not finish again', () => {
    expect(terminalActionsAllowed('completed')).toBe(false);
  });

  test('an abandoned session may not finish again', () => {
    expect(terminalActionsAllowed('abandoned')).toBe(false);
  });
});

describe('ActiveWorkoutScreen render', () => {
  test('a screen with no session degrades to a named not-available state', () => {
    // No blank page and no dead form. The user gets a reason and a way out.
    const html = renderHtml(ActiveWorkoutScreen, { sessionId: 's-1' });
    expect(html).toContain('This workout is not available');
    expect(html).toContain('Back to workouts');
    // No editable tree is drawn over a session that does not exist.
    expect(html).not.toContain('edit-tree');
  });

  test('the not-available state never renders a finish action', () => {
    const html = renderHtml(ActiveWorkoutScreen, { sessionId: '' });
    expect(html).not.toContain('Finish Workout');
    expect(html).not.toContain('Abandon workout');
  });
});
