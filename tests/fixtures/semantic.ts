// Semantic-validation fixtures: one exercise set, one workout that exercises every
// container strategy, and one shard whose results pass every check.
//
// Tests mutate a deep clone of these, so a mutation in one test cannot leak into
// another. `validShard()` is the baseline: a fixture that fails a check the test
// did not touch means the fixture is wrong, not the validator.

import type {
  Exercise,
  ExerciseResult,
  ResultsShard,
  Session,
  StaticData,
  Workout
} from '../../src/domain/types';
import { exerciseResultKey } from '../../src/domain/execution-path';

export const SESSION_KEY = 'session-11111111-2222-4333-8444-555555555555';
export const WORKOUT_ID = 'demo';
export const SHARD_MONTH = '2026-08';

function backSquat(): Exercise {
  return {
    id: 'back-squat',
    name: 'Back Squat',
    instructions: ['Set the bar on your upper back.'],
    equipment: 'barbell',
    force: 'push',
    mechanic: 'compound',
    category: 'strength',
    level: 'intermediate',
    movementPattern: 'squat',
    primaryMuscles: ['quadriceps'],
    secondaryMuscles: ['glutes'],
    laterality: 'bilateral',
    measurements: [
      { dimension: 'reps', compatibleUnits: ['reps'] },
      { dimension: 'weight', compatibleUnits: ['lb', 'kg'] }
    ],
    loadSemantics: 'total'
  };
}

function pushUp(): Exercise {
  return {
    id: 'push-up',
    name: 'Push Up',
    instructions: ['Lower your chest to the floor.'],
    equipment: null,
    force: 'push',
    mechanic: 'compound',
    category: 'strength',
    level: 'beginner',
    movementPattern: 'horizontal_push',
    primaryMuscles: ['chest'],
    secondaryMuscles: ['triceps'],
    laterality: 'bilateral',
    measurements: [{ dimension: 'reps', compatibleUnits: ['reps'] }],
    loadSemantics: 'total'
  };
}

function sitUp(): Exercise {
  return {
    id: 'sit-up',
    name: 'Sit Up',
    instructions: ['Raise your torso to your knees.'],
    equipment: null,
    force: 'static',
    mechanic: 'isolation',
    category: 'strength',
    level: 'beginner',
    movementPattern: 'flexion',
    primaryMuscles: ['abdominals'],
    secondaryMuscles: [],
    laterality: 'bilateral',
    measurements: [{ dimension: 'reps', compatibleUnits: ['reps'] }],
    loadSemantics: 'total'
  };
}

function row(): Exercise {
  return {
    id: 'row',
    name: 'Row',
    instructions: ['Drive and recover.'],
    equipment: 'machine',
    force: 'pull',
    mechanic: 'compound',
    category: 'cardio',
    level: 'beginner',
    movementPattern: 'locomotion',
    primaryMuscles: ['lats'],
    secondaryMuscles: [],
    laterality: 'bilateral',
    measurements: [
      { dimension: 'distance', compatibleUnits: ['m', 'km'] },
      { dimension: 'duration', compatibleUnits: ['second', 'minute'] }
    ],
    loadSemantics: 'total'
  };
}

function jumpRope(): Exercise {
  return {
    id: 'jump-rope',
    name: 'Jump Rope',
    instructions: ['Turn the rope under both feet.'],
    equipment: 'other',
    force: null,
    mechanic: null,
    category: 'cardio',
    level: 'beginner',
    movementPattern: 'locomotion',
    primaryMuscles: ['calves'],
    secondaryMuscles: [],
    laterality: 'bilateral',
    measurements: [{ dimension: 'reps', compatibleUnits: ['reps'] }],
    loadSemantics: 'total'
  };
}

function kbPress(): Exercise {
  return {
    id: 'kb-press',
    name: 'Kettlebell Press',
    instructions: ['Press the bell overhead.'],
    equipment: 'kettlebell',
    force: 'push',
    mechanic: 'compound',
    category: 'strength',
    level: 'intermediate',
    movementPattern: 'vertical_push',
    primaryMuscles: ['shoulders'],
    secondaryMuscles: ['triceps'],
    laterality: 'unilateral',
    measurements: [
      { dimension: 'reps', compatibleUnits: ['reps'] },
      { dimension: 'weight', compatibleUnits: ['kg'] }
    ],
    loadSemantics: 'total'
  };
}

export function exercises(): Exercise[] {
  return [backSquat(), pushUp(), sitUp(), row(), jumpRope(), kbPress()];
}

/**
 * One workout with every container strategy.
 *
 * ```text
 * root (sequence)
 *   warmup (sequence)
 *     warmup-squat        exercise
 *   squat-sets (rounds 3)
 *     back-squat-set      exercise
 *   cindy (amrap, rounds_and_reps, childDetail optional)
 *     pushups             exercise
 *     situps              exercise
 *   emom-block (emom, 4 cycles, intervals, childDetail optional)
 *     emom-row            exercise
 *     emom-jump           exercise
 *   complex-block (complex, 5 cycles, cycles, childDetail none)
 *     complex-press       exercise
 * ```
 */
export function workout(): Workout {
  return {
    id: WORKOUT_ID,
    name: 'Demo Workout',
    root: {
      id: 'root',
      type: 'container',
      strategy: 'sequence',
      strategyConfig: {},
      children: [
        {
          id: 'warmup',
          type: 'container',
          strategy: 'sequence',
          strategyConfig: {},
          children: [
            {
              id: 'warmup-squat',
              type: 'exercise',
              exerciseId: 'back-squat',
              stimulus: 'mobility',
              setType: 'warmup',
              prescription: { reps: 10, weight: { value: 60, unit: 'lb' } }
            }
          ]
        },
        {
          id: 'squat-sets',
          type: 'container',
          strategy: 'rounds',
          strategyConfig: { rounds: 3 },
          children: [
            {
              id: 'back-squat-set',
              type: 'exercise',
              exerciseId: 'back-squat',
              stimulus: 'strength',
              setType: 'working',
              prescription: {
                reps: 5,
                weight: { value: 100, unit: 'lb' },
                iterations: [{ iteration: 3, weight: { value: 110, unit: 'lb' } }]
              }
            }
          ]
        },
        {
          id: 'cindy',
          type: 'container',
          name: 'Cindy',
          strategy: 'amrap',
          strategyConfig: { duration: { value: 20, unit: 'minute' } },
          resultCapture: {
            mode: 'scored',
            scoreType: 'rounds_and_reps',
            childDetail: 'optional'
          },
          benchmark: { name: 'Cindy', organization: 'CrossFit' },
          children: [
            {
              id: 'pushups',
              type: 'exercise',
              exerciseId: 'push-up',
              stimulus: 'conditioning',
              prescription: { reps: 10 }
            },
            {
              id: 'situps',
              type: 'exercise',
              exerciseId: 'sit-up',
              stimulus: 'conditioning',
              prescription: { reps: 15 }
            }
          ]
        },
        {
          id: 'emom-block',
          type: 'container',
          strategy: 'emom',
          strategyConfig: { cycles: 4, interval: { value: 60, unit: 'second' } },
          resultCapture: { mode: 'scored', scoreType: 'intervals', childDetail: 'optional' },
          children: [
            {
              id: 'emom-row',
              type: 'exercise',
              exerciseId: 'row',
              stimulus: 'conditioning',
              prescription: { distance: { value: 250, unit: 'm' } }
            },
            {
              id: 'emom-jump',
              type: 'exercise',
              exerciseId: 'jump-rope',
              stimulus: 'conditioning',
              prescription: { reps: 20 }
            }
          ]
        },
        {
          id: 'complex-block',
          type: 'container',
          strategy: 'complex',
          strategyConfig: { cycles: 5 },
          resultCapture: { mode: 'scored', scoreType: 'cycles', childDetail: 'none' },
          children: [
            {
              id: 'complex-press',
              type: 'exercise',
              exerciseId: 'kb-press',
              stimulus: 'strength',
              prescription: { reps: 5, weight: { value: 16, unit: 'kg' } }
            }
          ]
        }
      ]
    }
  };
}

export function staticData(): StaticData {
  return { exercises: exercises(), workouts: [workout()] };
}

/**
 * The demo workout plus two repeated containers nested on one path.
 *
 * ```text
 * root (sequence)
 *   ... every `workout()` child ...
 *   outer-ring (rounds 2)
 *     inner-amrap (amrap, rounds_and_reps, childDetail optional)
 *       ring-pushups  exercise, 10 reps
 *       ring-situps   exercise, 15 reps
 * ```
 *
 * The pair puts two repeated containers on one path, so a test can store a child
 * under one outer round and score another.
 */
export function nestedWorkout(): Workout {
  const base = workout();
  base.root.children.push({
    id: 'outer-ring',
    type: 'container',
    strategy: 'rounds',
    strategyConfig: { rounds: 2 },
    children: [
      {
        id: 'inner-amrap',
        type: 'container',
        strategy: 'amrap',
        strategyConfig: { duration: { value: 10, unit: 'minute' } },
        resultCapture: { mode: 'scored', scoreType: 'rounds_and_reps', childDetail: 'optional' },
        children: [
          {
            id: 'ring-pushups',
            type: 'exercise',
            exerciseId: 'push-up',
            stimulus: 'conditioning',
            prescription: { reps: 10 }
          },
          {
            id: 'ring-situps',
            type: 'exercise',
            exerciseId: 'sit-up',
            stimulus: 'conditioning',
            prescription: { reps: 15 }
          }
        ]
      }
    ]
  });
  return base;
}

/** Static bundle for the nested workout. */
export function nestedStaticData(): StaticData {
  return { exercises: exercises(), workouts: [nestedWorkout()] };
}

/** One nested child result: outer round `outer`, inner round `inner`. */
export function ringResult(
  outer: number,
  inner: number,
  nodeId: 'ring-pushups' | 'ring-situps',
  exerciseId: 'push-up' | 'sit-up',
  reps: number
): readonly [string, ExerciseResult] {
  const path = [
    { nodeId: 'root' },
    { nodeId: 'outer-ring', iteration: outer },
    { nodeId: 'inner-amrap', iteration: inner },
    { nodeId }
  ];
  return [
    exerciseResultKey(path, 'both', 1),
    {
      workoutId: WORKOUT_ID,
      executionPath: path,
      exerciseId,
      side: 'both',
      attempt: 1,
      status: 'completed',
      values: { reps: { value: reps, unit: 'reps' } }
    }
  ];
}

/**
 * A session whose nested container holds its own child detail in both outer
 * rounds: round 1 runs two full inner rounds plus a partial, round 2 runs one
 * full inner round plus a partial.
 */
export function nestedSession(): Session {
  const session = validSession();
  const ring: Record<string, ExerciseResult> = {};

  for (let inner = 1; inner <= 3; inner += 1) {
    const full = inner < 3;
    const push = ringResult(1, inner, 'ring-pushups', 'push-up', full ? 10 : 3);
    const sit = ringResult(1, inner, 'ring-situps', 'sit-up', full ? 15 : 4);
    ring[push[0]] = push[1];
    ring[sit[0]] = sit[1];
  }
  for (let inner = 1; inner <= 2; inner += 1) {
    const full = inner < 2;
    const push = ringResult(2, inner, 'ring-pushups', 'push-up', full ? 10 : 1);
    const sit = ringResult(2, inner, 'ring-situps', 'sit-up', full ? 15 : 2);
    ring[push[0]] = push[1];
    ring[sit[0]] = sit[1];
  }

  const scored = (outer: number, completedRounds: number, additionalReps: number) => ({
    workoutId: WORKOUT_ID,
    executionPath: [{ nodeId: 'root' }, { nodeId: 'outer-ring', iteration: outer }, { nodeId: 'inner-amrap' }],
    attempt: 1,
    status: 'completed' as const,
    score: { type: 'rounds_and_reps' as const, completedRounds, additionalReps }
  });

  session.exerciseResults = { ...session.exerciseResults, ...ring };
  session.containerResults = {
    ...session.containerResults,
    'root/outer-ring:1/inner-amrap|1': scored(1, 2, 7),
    'root/outer-ring:2/inner-amrap|1': scored(2, 1, 3)
  };
  return session;
}

/** A completed session whose every result passes every check. */
export function validSession(): Session {
  const result = (
    path: { nodeId: string; iteration?: number }[],
    exerciseId: string,
    values: Record<string, { value: number; unit: string }>,
    side = 'both'
  ) => {
    const encoded = path
      .map((segment) =>
        segment.iteration === undefined ? segment.nodeId : `${segment.nodeId}:${String(segment.iteration)}`
      )
      .join('/');
    const key = `${encoded}|${side}|1`;
    return [
      key,
      {
        workoutId: WORKOUT_ID,
        executionPath: path,
        exerciseId,
        side,
        attempt: 1,
        status: 'completed' as const,
        values
      }
    ] as const;
  };

  const exerciseResults: Record<string, unknown> = {};
  const add = (entry: readonly [string, unknown]): void => {
    exerciseResults[entry[0]] = entry[1];
  };

  add(result([{ nodeId: 'root' }, { nodeId: 'warmup' }, { nodeId: 'warmup-squat' }], 'back-squat', {
    reps: { value: 10, unit: 'reps' },
    weight: { value: 60, unit: 'lb' }
  }));

  add(
    result(
      [{ nodeId: 'root' }, { nodeId: 'squat-sets', iteration: 1 }, { nodeId: 'back-squat-set' }],
      'back-squat',
      { reps: { value: 5, unit: 'reps' }, weight: { value: 100, unit: 'lb' } }
    )
  );
  add(
    result(
      [{ nodeId: 'root' }, { nodeId: 'squat-sets', iteration: 2 }, { nodeId: 'back-squat-set' }],
      'back-squat',
      { reps: { value: 5, unit: 'reps' }, weight: { value: 105, unit: 'lb' } }
    )
  );
  add(
    result(
      [{ nodeId: 'root' }, { nodeId: 'squat-sets', iteration: 3 }, { nodeId: 'back-squat-set' }],
      'back-squat',
      { reps: { value: 5, unit: 'reps' }, weight: { value: 110, unit: 'lb' } }
    )
  );

  // Cindy: two full rounds of 10 push-ups and 15 sit-ups, then a partial round.
  add(
    result([{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 1 }, { nodeId: 'pushups' }], 'push-up', {
      reps: { value: 10, unit: 'reps' }
    })
  );
  add(
    result([{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 1 }, { nodeId: 'situps' }], 'sit-up', {
      reps: { value: 15, unit: 'reps' }
    })
  );
  add(
    result([{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 2 }, { nodeId: 'pushups' }], 'push-up', {
      reps: { value: 10, unit: 'reps' }
    })
  );
  add(
    result([{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 2 }, { nodeId: 'situps' }], 'sit-up', {
      reps: { value: 15, unit: 'reps' }
    })
  );
  add(
    result([{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 3 }, { nodeId: 'pushups' }], 'push-up', {
      reps: { value: 4, unit: 'reps' }
    })
  );
  add(
    result([{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 3 }, { nodeId: 'situps' }], 'sit-up', {
      reps: { value: 6, unit: 'reps' }
    })
  );

  // EMOM: two of four intervals filled, in order.
  add(
    result(
      [{ nodeId: 'root' }, { nodeId: 'emom-block', iteration: 1 }, { nodeId: 'emom-row' }],
      'row',
      { distance: { value: 250, unit: 'm' } }
    )
  );
  add(
    result(
      [{ nodeId: 'root' }, { nodeId: 'emom-block', iteration: 1 }, { nodeId: 'emom-jump' }],
      'jump-rope',
      { reps: { value: 20, unit: 'reps' } }
    )
  );
  add(
    result(
      [{ nodeId: 'root' }, { nodeId: 'emom-block', iteration: 2 }, { nodeId: 'emom-row' }],
      'row',
      { distance: { value: 260, unit: 'm' } }
    )
  );
  add(
    result(
      [{ nodeId: 'root' }, { nodeId: 'emom-block', iteration: 2 }, { nodeId: 'emom-jump' }],
      'jump-rope',
      { reps: { value: 20, unit: 'reps' } }
    )
  );

  const containerResults: Record<string, unknown> = {
    // Two full rounds, plus 4 + 6 = 10 additional reps.
    'root/cindy|1': {
      workoutId: WORKOUT_ID,
      executionPath: [{ nodeId: 'root' }, { nodeId: 'cindy' }],
      attempt: 1,
      status: 'completed',
      score: { type: 'rounds_and_reps', completedRounds: 2, additionalReps: 10 }
    },
    // Four cycles x two children = eight intervals. Four filled, in order.
    'root/emom-block|1': {
      workoutId: WORKOUT_ID,
      executionPath: [{ nodeId: 'root' }, { nodeId: 'emom-block' }],
      attempt: 1,
      status: 'completed',
      score: { type: 'intervals', completedIntervals: 4, totalIntervals: 8 }
    },
    // Aggregate-only entry: childDetail "none", so no child results exist.
    'root/complex-block|1': {
      workoutId: WORKOUT_ID,
      executionPath: [{ nodeId: 'root' }, { nodeId: 'complex-block' }],
      attempt: 1,
      status: 'completed',
      score: { type: 'cycles', completedCycles: 5 }
    }
  };

  return {
    id: SESSION_KEY,
    workoutId: WORKOUT_ID,
    status: 'completed',
    startedAtUtc: '2026-08-15T14:30:00Z',
    completedAtUtc: '2026-08-15T15:05:00Z',
    updatedAtUtc: '2026-08-15T15:05:00Z',
    exerciseResults: exerciseResults as Session['exerciseResults'],
    containerResults: containerResults as Session['containerResults']
  };
}

export function validShard(): ResultsShard {
  return {
    format: 'repjot/results',
    schemaVersion: 1,
    yearMonthUtc: SHARD_MONTH,
    sessions: { [SESSION_KEY]: validSession() }
  };
}

/** Deep clone so a test mutation cannot reach another test. */
export function clone<T>(value: T): T {
  return structuredClone(value);
}

/** True when any issue carries `code`. */
export function hasCode(issues: { code: string }[], code: string): boolean {
  return issues.some((candidate) => candidate.code === code);
}

/** True when any unresolved entry carries `reason`. */
export function hasReason(
  unresolved: { reason: string }[],
  reason: string
): boolean {
  return unresolved.some((candidate) => candidate.reason === reason);
}
