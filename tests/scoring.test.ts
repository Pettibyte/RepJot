// Container score derivation from saved child detail. Phase 14.
// REQUIREMENTS 10.12, 10.13, 10.17, 10.18.

import { describe, expect, test } from 'bun:test';
import type {
  ContainerNode,
  Exercise,
  ExerciseResult,
  Workout
} from '../src/domain/types';
import {
  deriveScore,
  isDeterministicRepsSequence,
  isValidProgression,
  prescribedReps
} from '../src/sessions/scoring';
import { exercises, workout, WORKOUT_ID } from './fixtures/semantic';

const exerciseById = new Map<string, Exercise>(exercises().map((e) => [e.id, e]));

/** The scored container of one strategy from the demo workout. */
function containerById(id: string): ContainerNode {
  const found = workout().root.children.find((child) => child.id === id);
  if (found === undefined || found.type !== 'container') {
    throw new Error(`No container ${id} in the demo workout.`);
  }
  return found;
}

/** One completed child result under one container occurrence. */
function child(
  containerPath: { nodeId: string; iteration?: number }[],
  nodeId: string,
  exerciseId: string,
  reps: number
): ExerciseResult {
  return {
    workoutId: WORKOUT_ID,
    executionPath: [...containerPath, { nodeId }],
    exerciseId,
    side: 'both',
    attempt: 1,
    status: 'completed',
    values: { reps: { value: reps, unit: 'reps' } }
  };
}

const cindyPath = [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 1 }];

describe('deriveScore rounds_and_reps', () => {
  const cindy = containerById('cindy');

  test('valid detail derives the exact rounds_and_reps score', () => {
    const children = [
      child(cindyPath, 'pushups', 'push-up', 10),
      child(cindyPath, 'situps', 'sit-up', 15)
    ];
    expect(deriveScore(cindy, children, exerciseById)).toEqual({
      type: 'rounds_and_reps',
      completedRounds: 1,
      additionalReps: 0
    });
  });

  test('a short round becomes additional reps', () => {
    const children = [
      child(cindyPath, 'pushups', 'push-up', 10),
      child(cindyPath, 'situps', 'sit-up', 15),
      child(
        [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 2 }],
        'pushups',
        'push-up',
        4
      ),
      child([{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 2 }], 'situps', 'sit-up', 6)
    ];
    expect(deriveScore(cindy, children, exerciseById)).toEqual({
      type: 'rounds_and_reps',
      completedRounds: 1,
      additionalReps: 10
    });
  });

  test('detail that skips a round yields nonstandard', () => {
    const children = [
      child(cindyPath, 'pushups', 'push-up', 10),
      child(cindyPath, 'situps', 'sit-up', 15),
      // Round 2 is missing. Round 3 holds a full round.
      child(
        [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 3 }],
        'pushups',
        'push-up',
        10
      ),
      child([{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 3 }], 'situps', 'sit-up', 15)
    ];
    expect(deriveScore(cindy, children, exerciseById)).toEqual({ type: 'nonstandard' });
    expect(isValidProgression(cindy, children, exerciseById)).toBe(false);
  });

  test('one leaf short of prescription ends the round', () => {
    const children = [
      child(cindyPath, 'pushups', 'push-up', 10),
      child(cindyPath, 'situps', 'sit-up', 12)
    ];
    expect(deriveScore(cindy, children, exerciseById)).toEqual({
      type: 'rounds_and_reps',
      completedRounds: 0,
      additionalReps: 22
    });
  });
});

describe('deriveScore cycles', () => {
  const complexBlock = containerById('complex-block');

  test('completed cycles count in order', () => {
    const children = [1, 2, 3].map((iteration) =>
      child([{ nodeId: 'root' }, { nodeId: 'complex-block', iteration }], 'complex-press', 'kb-press', 5)
    );
    expect(deriveScore(complexBlock, children, exerciseById)).toEqual({
      type: 'cycles',
      completedCycles: 3
    });
  });

  test('a gap in the cycles yields nonstandard', () => {
    const children = [1, 3].map((iteration) =>
      child([{ nodeId: 'root' }, { nodeId: 'complex-block', iteration }], 'complex-press', 'kb-press', 5)
    );
    expect(deriveScore(complexBlock, children, exerciseById)).toEqual({ type: 'nonstandard' });
  });

  test('no detail derives zero cycles, not a broken score', () => {
    expect(deriveScore(complexBlock, [], exerciseById)).toEqual({
      type: 'cycles',
      completedCycles: 0
    });
  });
});

describe('deriveScore intervals', () => {
  const emom = containerById('emom-block');

  test('an EMOM derives intervals with the correct total', () => {
    const children: ExerciseResult[] = [];
    for (let iteration = 1; iteration <= 4; iteration += 1) {
      const path = [{ nodeId: 'root' }, { nodeId: 'emom-block', iteration }];
      children.push(child(path, 'emom-row', 'row', 0));
      children.push(child(path, 'emom-jump', 'jump-rope', 20));
    }
    expect(deriveScore(emom, children, exerciseById)).toEqual({
      type: 'intervals',
      completedIntervals: 8,
      totalIntervals: 8
    });
  });

  test('a half-finished EMOM counts the completed prefix', () => {
    const children: ExerciseResult[] = [];
    for (let iteration = 1; iteration <= 2; iteration += 1) {
      const path = [{ nodeId: 'root' }, { nodeId: 'emom-block', iteration }];
      children.push(child(path, 'emom-row', 'row', 0));
      children.push(child(path, 'emom-jump', 'jump-rope', 20));
    }
    expect(deriveScore(emom, children, exerciseById)).toEqual({
      type: 'intervals',
      completedIntervals: 4,
      totalIntervals: 8
    });
  });

  test('an interval gap yields nonstandard', () => {
    const children: ExerciseResult[] = [];
    for (const iteration of [1, 3]) {
      const path = [{ nodeId: 'root' }, { nodeId: 'emom-block', iteration }];
      children.push(child(path, 'emom-row', 'row', 0));
      children.push(child(path, 'emom-jump', 'jump-rope', 20));
    }
    expect(deriveScore(emom, children, exerciseById)).toEqual({ type: 'nonstandard' });
  });
});

describe('isDeterministicRepsSequence', () => {
  test('a repetition-only container is deterministic', () => {
    expect(isDeterministicRepsSequence(containerById('cindy'), exerciseById)).toBe(true);
  });

  test('a rounds_and_reps container on a non-repetition sequence is rejected', () => {
    const rowOnly: ContainerNode = {
      id: 'row-only',
      type: 'container',
      strategy: 'rounds',
      strategyConfig: { rounds: 3 },
      resultCapture: { mode: 'scored', scoreType: 'rounds_and_reps', childDetail: 'optional' },
      children: [
        {
          id: 'row-set',
          type: 'exercise',
          exerciseId: 'row',
          stimulus: 'conditioning',
          prescription: { distance: { value: 250, unit: 'm' } }
        }
      ]
    };
    // The `row` exercise measures distance and duration, never repetitions.
    expect(isDeterministicRepsSequence(rowOnly, exerciseById)).toBe(false);
    expect(
      deriveScore(rowOnly, [child([{ nodeId: 'row-only', iteration: 1 }], 'row-set', 'row', 0)], exerciseById)
    ).toEqual({ type: 'nonstandard' });
  });

  test('an empty container is not a repetition sequence', () => {
    const empty: ContainerNode = {
      id: 'empty',
      type: 'container',
      strategy: 'rounds',
      strategyConfig: { rounds: 2 },
      resultCapture: { mode: 'scored', scoreType: 'rounds_and_reps', childDetail: 'optional' },
      children: []
    };
    expect(isDeterministicRepsSequence(empty, exerciseById)).toBe(false);
  });
});

describe('prescribedReps', () => {
  test('reads the top-level target', () => {
    const node = {
      id: 'x',
      type: 'exercise' as const,
      exerciseId: 'push-up',
      stimulus: 'conditioning' as const,
      prescription: { reps: 10 }
    };
    expect(prescribedReps(node, 1)).toBe(10);
  });

  test('a range reads its minimum', () => {
    const node = {
      id: 'x',
      type: 'exercise' as const,
      exerciseId: 'push-up',
      stimulus: 'conditioning' as const,
      prescription: { reps: { min: 8, max: 12 } }
    };
    expect(prescribedReps(node, 1)).toBe(8);
  });

  test('an iteration override wins for its own iteration', () => {
    const node = {
      id: 'x',
      type: 'exercise' as const,
      exerciseId: 'push-up',
      stimulus: 'conditioning' as const,
      prescription: { reps: 10, iterations: [{ iteration: 2, reps: 6 }] }
    };
    expect(prescribedReps(node, 1)).toBe(10);
    expect(prescribedReps(node, 2)).toBe(6);
  });
});

describe('deriveScore without a score capture', () => {
  test('an unscored container cannot derive a score', () => {
    const plain: Workout['root'] = {
      id: 'plain',
      type: 'container',
      strategy: 'sequence',
      strategyConfig: {},
      children: []
    };
    expect(deriveScore(plain, [], exerciseById)).toEqual({ type: 'nonstandard' });
  });
});
