// Static-data semantic checks: the three build-time identity checks, plus the
// prescription checks that need the exercise directory.
// REQUIREMENTS 6.19-6.22, 10.4, 10.5. Spec items 19, 20, 21.

import { describe, expect, test } from 'bun:test';
import {
  validateStaticData,
  validateWorkoutSemantics
} from '../src/validation/semantic-validator';
import { ISSUE_CODES } from '../src/validation/issues';
import { clone, exercises, hasCode, workout } from './fixtures/semantic';

describe('validateStaticData', () => {
  test('the committed fixture set passes', () => {
    expect(validateStaticData(exercises(), [workout()])).toEqual([]);
  });

  test('a duplicate node ID inside one workout fails', () => {
    const target = workout();
    target.root.children.push(clone(target.root.children[0]));

    const issues = validateStaticData(exercises(), [target]);
    expect(hasCode(issues, ISSUE_CODES.DUPLICATE_NODE_ID)).toBe(true);
  });

  test('a duplicate nested inside a duplicate is also reported', () => {
    const target = workout();
    // Put a copy of `warmup` inside `warmup`. The outer copy repeats its ID, and
    // the inner copy repeats it again one level down. Both must report.
    const warmup = target.root.children[0];
    warmup.children.push(clone(warmup));

    const duplicates = validateStaticData(exercises(), [target]).filter(
      (issue) => issue.code === ISSUE_CODES.DUPLICATE_NODE_ID
    );
    expect(duplicates.length).toBe(2);
  });

  test('the same node ID in two different workouts passes', () => {
    const first = workout();
    const second = workout();
    second.id = 'demo-two';

    expect(validateStaticData(exercises(), [first, second])).toEqual([]);
  });

  test('an unresolvable node exerciseId fails', () => {
    const target = workout();
    const node = target.root.children[1].children[0];
    node.exerciseId = 'exercise-that-was-removed';

    const issues = validateStaticData(exercises(), [target]);
    expect(hasCode(issues, ISSUE_CODES.UNKNOWN_EXERCISE)).toBe(true);
  });
});

describe('validateWorkoutSemantics', () => {
  test('the committed fixture set passes', () => {
    expect(validateWorkoutSemantics([workout()], exercises())).toEqual([]);
  });

  test('a prescription dimension the exercise does not declare fails', () => {
    const target = workout();
    const node = target.root.children[1].children[0];
    // push-up declares only reps, so a distance prescription is out of contract.
    node.exerciseId = 'push-up';
    node.prescription.calories = { value: 100, unit: 'kcal' };

    const issues = validateWorkoutSemantics([target], exercises());
    expect(hasCode(issues, ISSUE_CODES.PRESCRIPTION_DIMENSION_UNDECLARED)).toBe(true);
  });

  test('an iteration override that repeats a number fails', () => {
    const target = workout();
    const node = target.root.children[1].children[0];
    node.prescription.iterations = [{ iteration: 2 }, { iteration: 2 }];

    const issues = validateWorkoutSemantics([target], exercises());
    expect(hasCode(issues, ISSUE_CODES.ITERATION_DUPLICATE)).toBe(true);
  });

  test('an iteration override past the container count fails', () => {
    const target = workout();
    const node = target.root.children[1].children[0];
    // squat-sets runs 3 rounds, so iteration 4 has nothing to override.
    node.prescription.iterations = [{ iteration: 4 }];

    const issues = validateWorkoutSemantics([target], exercises());
    expect(hasCode(issues, ISSUE_CODES.ITERATION_OUT_OF_RANGE)).toBe(true);
  });

  test('an iteration override below one fails', () => {
    const target = workout();
    const node = target.root.children[1].children[0];
    node.prescription.iterations = [{ iteration: 0 }];

    const issues = validateWorkoutSemantics([target], exercises());
    expect(hasCode(issues, ISSUE_CODES.ITERATION_OUT_OF_RANGE)).toBe(true);
  });

  test('an iteration override with no repeated container above it fails', () => {
    const target = workout();
    const node = target.root.children[0].children[0];
    // `warmup` and `root` are both sequences, so nothing repeats.
    node.prescription.iterations = [{ iteration: 2 }];

    const issues = validateWorkoutSemantics([target], exercises());
    expect(hasCode(issues, ISSUE_CODES.ITERATION_OUT_OF_RANGE)).toBe(true);
  });

  test('a valid iteration override inside the container count passes', () => {
    const target = workout();
    const node = target.root.children[1].children[0];
    node.prescription.iterations = [{ iteration: 1 }, { iteration: 3 }];

    expect(validateWorkoutSemantics([target], exercises())).toEqual([]);
  });

  test('an AMRAP prescribes no ceiling, so a high iteration passes', () => {
    const target = workout();
    const amrap = target.root.children[2];
    const node = amrap.children[0];
    if (node.type === 'exercise') {
      node.prescription.iterations = [{ iteration: 40 }];
    }

    expect(validateWorkoutSemantics([target], exercises())).toEqual([]);
  });
});
