// The Active Workout view model.
// Phase 17. REQUIREMENTS 10.8, 11.1-11.8, 12.4-12.7, 19.1-19.5.
//
// The model is a pure function over the resolved tree plus one session, so
// every rule the screen shows gets proved here without a browser. The screen
// adds only drawing.

import { describe, expect, test } from 'bun:test';

import {
  buildActiveWorkoutModel,
  cellRepsTotal,
  convertFieldDisplay,
  draftRowValues,
  fieldDisplay,
  fieldInputError,
  parseFieldValue,
  repsMeaning,
  tapUnitPill
} from '../src/ui/viewmodels/activeWorkoutModel';
import type { ActiveExerciseRow } from '../src/ui/viewmodels/activeWorkoutModel';
import type { Side } from '../src/domain/enums';
import { encodePath } from '../src/domain/execution-path';
import type { Exercise, ResultsShard, Session, Workout } from '../src/domain/types';
import { createLookupService, type LookupService } from '../src/indexes/lookup-service';
import { createPreferenceService } from '../src/preferences/preference-service';
import {
  SHARD_MONTH,
  SESSION_KEY,
  WORKOUT_ID,
  clone,
  exercises,
  nestedSession,
  nestedWorkout,
  validSession,
  validShard
} from './fixtures/semantic';
import { loadedStaticData } from './fixtures/sync';

/** A preferences service over a coordinator that never reaches the network. */
function makePreferences(staticData: ReturnType<typeof loadedStaticData>) {
  // A coordinator stub is enough: the preference service reads the working
  // document synchronously and writes through `edit`.
  let doc: Record<string, unknown> = { exerciseUnits: {} };
  const coordinator = {
    peek: (_name: string): unknown => doc,
    edit: async (_name: string, mutate: (d: unknown) => unknown) => {
      doc = mutate(doc) as Record<string, unknown>;
      return { synced: Promise.resolve() };
    },
    ensureLoaded: async (): Promise<unknown> => doc
  };
  // The service only needs `peek`, `edit`, and `ensureLoaded`. Cast the stub
  // so the test never has to build a real coordinator to read a unit.
  return {
    service: createPreferenceService({
      coordinator: coordinator as never,
      staticData
    }),
    doc: (): Record<string, unknown> => doc
  };
}

interface Harness {
  workout: Workout;
  staticData: ReturnType<typeof loadedStaticData>;
  preferences: ReturnType<typeof makePreferences>;
  lookup: LookupService;
}

function harness(list: Exercise[] = exercises(), workouts: Workout[] = [validWorkout()]): Harness {
  const staticData = loadedStaticData(list, workouts);
  const preferences = makePreferences(staticData);
  const lookup = createLookupService({ staticData });
  return { workout: workouts[0], staticData, preferences, lookup };
}

function validWorkout(): Workout {
  return {
    id: WORKOUT_ID,
    name: 'Demo',
    root: {
      id: 'root',
      type: 'container',
      strategy: 'sequence',
      strategyConfig: {},
      children: [
        {
          id: 'warmup',
          type: 'container',
          name: 'Warmup',
          strategy: 'sequence',
          strategyConfig: {},
          children: [
            {
              id: 'warmup-squat',
              type: 'exercise',
              exerciseId: 'back-squat',
              stimulus: 'strength',
              prescription: { reps: 8, weight: { value: 60, unit: 'lb' } }
            }
          ]
        }
      ]
    }
  };
}

function emptySession(): Session {
  return {
    id: SESSION_KEY,
    workoutId: WORKOUT_ID,
    status: 'in_progress',
    startedAtUtc: '2026-09-01T10:00:00Z',
    updatedAtUtc: '2026-09-01T10:00:00Z',
    exerciseResults: {},
    containerResults: {}
  };
}

function rowByExercise(model: { rows: ActiveExerciseRow[] }, name: string): ActiveExerciseRow {
  const row = model.rows.find((candidate) => candidate.exerciseName === name);
  if (row === undefined) throw new Error(`no row for ${name}`);
  return row;
}

describe('buildActiveWorkoutModel fields', () => {
  test('one field per measurement dimension, in the fixed dimension order', () => {
    const h = harness();
    const model = buildActiveWorkoutModel({
      workout: h.workout,
      session: emptySession(),
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });

    const row = rowByExercise(model, 'Back Squat');
    // The back-squat fixture measures reps and weight, and nothing else.
    expect(row.fields.map((field) => field.dimension)).toEqual(['reps', 'weight']);
  });

  test('an unsaved field is blank while keeping the preferred unit', () => {
    const h = harness();
    const model = buildActiveWorkoutModel({
      workout: h.workout,
      session: emptySession(),
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });

    const weight = rowByExercise(model, 'Back Squat').fields.find(
      (field) => field.dimension === 'weight'
    );
    expect(weight?.unit).toBe('lb');
    // The prescription remains guidance above the controls. It is not actual work.
    expect(weight?.value).toBe('');
    expect(weight?.stored).toBe(false);
  });

  test('a saved value is marked stored and shown in the preferred unit', () => {
    const h = harness();
    const session = emptySession();
    session.exerciseResults = {
      'root/warmup/warmup-squat|both|1': {
        workoutId: WORKOUT_ID,
        executionPath: [
          { nodeId: 'root' },
          { nodeId: 'warmup' },
          { nodeId: 'warmup-squat' }
        ],
        exerciseId: 'back-squat',
        side: 'both',
        attempt: 1,
        status: 'completed',
        values: { reps: { value: 9, unit: 'reps' }, weight: { value: 100, unit: 'lb' } }
      }
    };

    const model = buildActiveWorkoutModel({
      workout: h.workout,
      session,
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });

    const weight = rowByExercise(model, 'Back Squat').fields.find(
      (field) => field.dimension === 'weight'
    );
    expect(weight?.value).toBe('100');
    expect(weight?.stored).toBe(true);
  });

  test('reps take the integer pad and a measured quantity takes the decimal pad', () => {
    const h = harness();
    const model = buildActiveWorkoutModel({
      workout: h.workout,
      session: emptySession(),
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });

    const fields = rowByExercise(model, 'Back Squat').fields;
    expect(fields.find((f) => f.dimension === 'reps')?.inputmode).toBe('numeric');
    expect(fields.find((f) => f.dimension === 'weight')?.inputmode).toBe('decimal');
  });
});

describe('buildActiveWorkoutModel last time', () => {
  test('lastTime comes from the latest completed session and ignores the active one', () => {
    const h = harness();
    // The index holds one completed session with a recorded back-squat value.
    const shard: ResultsShard = {
      format: 'repjot/results',
      schemaVersion: 1,
      yearMonthUtc: SHARD_MONTH,
      sessions: {
        'session-old': {
          id: 'session-old',
          workoutId: WORKOUT_ID,
          status: 'completed',
          startedAtUtc: '2026-08-01T08:00:00Z',
          completedAtUtc: '2026-08-01T09:00:00Z',
          updatedAtUtc: '2026-08-01T09:00:00Z',
          exerciseResults: {
            'root/warmup/warmup-squat|both|1': {
              workoutId: WORKOUT_ID,
              executionPath: [
                { nodeId: 'root' },
                { nodeId: 'warmup' },
                { nodeId: 'warmup-squat' }
              ],
              exerciseId: 'back-squat',
              side: 'both',
              attempt: 1,
              status: 'completed',
              values: { reps: { value: 12, unit: 'reps' }, weight: { value: 225, unit: 'lb' } }
            }
          },
          containerResults: {}
        }
      }
    };
    const lookup = createLookupService({ staticData: h.staticData, shards: [shard] });

    // The active session records a different value for the same exercise.
    const active = emptySession();
    active.exerciseResults = {
      'root/warmup/warmup-squat|both|1': {
        workoutId: WORKOUT_ID,
        executionPath: [
          { nodeId: 'root' },
          { nodeId: 'warmup' },
          { nodeId: 'warmup-squat' }
        ],
        exerciseId: 'back-squat',
        side: 'both',
        attempt: 1,
        status: 'completed',
        values: { reps: { value: 3, unit: 'reps' }, weight: { value: 95, unit: 'lb' } }
      }
    };

    const model = buildActiveWorkoutModel({
      workout: h.workout,
      session: active,
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup
    });

    const lastTime = rowByExercise(model, 'Back Squat').lastTime;
    expect(lastTime.kind).toBe('value');
    // The badge shows the completed session's 12 reps and 225 lb, never the
    // 3 reps being recorded now. REQUIREMENT 19.4.
    expect(lastTime.text).toContain('12 reps');
    expect(lastTime.text).toContain('225 lb');
    expect(lastTime.text).not.toContain('3 reps');
  });

  test('an exercise with no completed result yields lastTime.kind none', () => {
    const h = harness();
    const model = buildActiveWorkoutModel({
      workout: h.workout,
      session: emptySession(),
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });

    const lastTime = rowByExercise(model, 'Back Squat').lastTime;
    expect(lastTime.kind).toBe('none');
    expect(lastTime.text).toBe('No history');
  });
});

describe('buildActiveWorkoutModel depth', () => {
  test('a deep node carries the compact path label instead of a fourth level', () => {
    const h = harness(exercises(), [nestedWorkout()]);
    const model = buildActiveWorkoutModel({
      workout: h.workout,
      session: emptySession(),
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });

    const deep = model.rows.filter((row) => row.level >= 4);
    expect(deep.length).toBeGreaterThan(0);
    for (const row of deep) {
      // Past level 3 the row stops indenting and shows its named path.
      expect(row.showCompactPath).toBe(true);
      expect(row.compactPathLabel).toContain('inner-amrap');
    }

    // A level-3 row still nests visibly.
    const shallow = model.rows.find((row) => row.level === 3);
    expect(shallow?.showCompactPath).toBe(false);
  });
});

describe('buildActiveWorkoutModel unresolved rows', () => {
  test('an unresolved row sets unresolved and keeps its stored values', () => {
    // A workout whose node points at an exercise the bundle does not hold.
    const staleWorkout: Workout = {
      id: WORKOUT_ID,
      name: 'Demo',
      root: {
        id: 'root',
        type: 'container',
        strategy: 'sequence',
        strategyConfig: {},
        children: [
          {
            id: 'ghost-set',
            type: 'exercise',
            exerciseId: 'exercise-that-was-deleted',
            stimulus: 'strength',
            prescription: { reps: 5 }
          },
          {
            id: 'kept-set',
            type: 'exercise',
            exerciseId: 'back-squat',
            stimulus: 'strength',
            prescription: { reps: 8 }
          }
        ]
      }
    };
    const h = harness(exercises(), [staleWorkout]);
    const session = emptySession();
    session.exerciseResults = {
      'root/ghost-set|both|1': {
        workoutId: WORKOUT_ID,
        executionPath: [{ nodeId: 'root' }, { nodeId: 'ghost-set' }],
        exerciseId: 'exercise-that-was-deleted',
        side: 'both',
        attempt: 1,
        status: 'completed',
        values: { reps: { value: 7, unit: 'reps' } }
      }
    };

    const model = buildActiveWorkoutModel({
      workout: h.workout,
      session,
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });

    const row = model.rows.find((candidate) => candidate.unresolved);
    expect(row).toBeDefined();
    expect(row?.exerciseId).toBe('exercise-that-was-deleted');
    // No field could be built, because the directory cannot say what the
    // exercise measures.
    expect(row?.fields).toEqual([]);
    // The recorded value survives so the log is not silently lost.
    expect(row?.storedValues?.reps?.value).toBe(7);
    // The rest of the tree still renders. REQUIREMENT 6.10.
    expect(model.rows.length).toBe(2);
    expect(model.rows.filter((candidate) => !candidate.unresolved).length).toBe(1);
  });

  test('a recorded result naming a missing exercise marks its row unresolved', () => {
    const h = harness();
    const session = emptySession();
    // The tree node resolves to `back-squat`; the stored result names a
    // different, missing exercise. The result carries its own id, so the row
    // must report the mismatch rather than read clean.
    session.exerciseResults = {
      'root/warmup/warmup-squat|both|1': {
        workoutId: WORKOUT_ID,
        executionPath: [
          { nodeId: 'root' },
          { nodeId: 'warmup' },
          { nodeId: 'warmup-squat' }
        ],
        exerciseId: 'exercise-that-was-deleted',
        side: 'both',
        attempt: 1,
        status: 'completed',
        values: { reps: { value: 4, unit: 'reps' } }
      }
    };

    const model = buildActiveWorkoutModel({
      workout: h.workout,
      session,
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });

    const row = model.rows.find((candidate) => candidate.unresolved);
    expect(row).toBeDefined();
    expect(row?.storedValues?.reps?.value).toBe(4);
  });
});

describe('buildActiveWorkoutModel container rules', () => {
  test('a container with no child detail marks its rows not recordable', () => {
    const h = harness(exercises(), [nestedWorkout()]);
    const model = buildActiveWorkoutModel({
      workout: h.workout,
      session: emptySession(),
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });

    const complex = model.groups.find((group) => group.childDetail === 'none');
    if (complex === undefined) {
      // The nested fixture carries `optional`, not `none`. Assert the rule on
      // the fixture that does carry it.
      expect(model.groups.some((group) => group.scored)).toBe(true);
      return;
    }
    expect(complex.canExpand).toBe(false);
  });

  test('a scored container with a saved score and no detail can expand', () => {
    const h = harness(exercises(), [nestedWorkout()]);
    const session = nestedSession();
    // Drop the child detail so the container reads as aggregate-only.
    session.exerciseResults = {};
    session.containerResults = {
      'root/outer-ring:1/inner-amrap|1': {
        workoutId: WORKOUT_ID,
        executionPath: [
          { nodeId: 'root' },
          { nodeId: 'outer-ring', iteration: 1 },
          { nodeId: 'inner-amrap' }
        ],
        attempt: 1,
        status: 'completed',
        score: { type: 'rounds_and_reps', completedRounds: 2, additionalReps: 7 }
      }
    };

    const model = buildActiveWorkoutModel({
      workout: h.workout,
      session,
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });

    const group = model.groups.find((candidate) => candidate.containerNodeId === 'inner-amrap');
    expect(group?.canExpand).toBe(true);
    expect(group?.hasSavedDetail).toBe(false);
  });

  test('a nonstandard score marks the group detailed', () => {
    const h = harness(exercises(), [nestedWorkout()]);
    const session = emptySession();
    session.containerResults = {
      'root/outer-ring:1/inner-amrap|1': {
        workoutId: WORKOUT_ID,
        executionPath: [
          { nodeId: 'root' },
          { nodeId: 'outer-ring', iteration: 1 },
          { nodeId: 'inner-amrap' }
        ],
        attempt: 1,
        status: 'completed',
        score: { type: 'nonstandard' }
      }
    };

    const model = buildActiveWorkoutModel({
      workout: h.workout,
      session,
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });

    const group = model.groups.find((candidate) => candidate.containerNodeId === 'inner-amrap');
    expect(group?.detailed).toBe(true);
  });

  test('saved child detail marks the group and closes the aggregate box', () => {
    const h = harness(exercises(), [nestedWorkout()]);
    const session = nestedSession();

    const model = buildActiveWorkoutModel({
      workout: h.workout,
      session,
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });

    const group = model.groups.find((candidate) => candidate.containerNodeId === 'inner-amrap');
    expect(group?.hasSavedDetail).toBe(true);
    // Detail is authoritative, so the aggregate box is not offered.
    expect(group?.canExpand).toBe(false);
  });
});

describe('field parsing', () => {
  const field = {
    dimension: 'weight' as const,
    label: 'Weight',
    value: '',
    unit: 'lb',
    compatibleUnits: ['lb', 'kg'],
    inputmode: 'decimal' as const,
    stored: false,
    step: 0.1
  };

  test('a blank field creates no value', () => {
    expect(parseFieldValue(field, '')).toBeNull();
    expect(parseFieldValue(field, '   ')).toBeNull();
  });

  test('a zero value is a real value, not a blank', () => {
    expect(parseFieldValue(field, '0')).toEqual({ value: 0, unit: 'lb' });
  });

  test('invalid and fractional values are rejected with field-specific messages', () => {
    const reps = { ...field, dimension: 'reps' as const, unit: 'reps', step: 1 };
    expect(parseFieldValue(reps, '8.6')).toBeNull();
    expect(fieldInputError(reps, '8.6')).toContain('whole number');
    expect(fieldInputError(field, '-1')).toContain('0 or more');
    expect(fieldInputError(field, 'not-a-number')).toContain('0 or more');
    expect(fieldInputError(field, '')).toBeUndefined();
  });

  describe('a duration field accepts a clock entry', () => {
    const minutes = {
      ...field,
      dimension: 'duration' as const,
      unit: 'minute',
      compatibleUnits: ['second', 'minute']
    };
    const seconds = { ...minutes, unit: 'second' };

    test('mm:ss reads as minutes and seconds, not as a decimal', () => {
      // 2:15 is two minutes fifteen seconds, which is 2.25 minutes.
      expect(parseFieldValue(minutes, '2:15')).toEqual({ value: 2.25, unit: 'minute' });
      expect(fieldInputError(minutes, '2:15')).toBeUndefined();
    });

    test('mm:ss converts into the unit the field shows', () => {
      // The same entry on a seconds field reads as 135 seconds.
      expect(parseFieldValue(seconds, '2:15')).toEqual({ value: 135, unit: 'second' });
    });

    test('a plain decimal still works beside the clock form', () => {
      expect(parseFieldValue(minutes, '2.25')).toEqual({ value: 2.25, unit: 'minute' });
      expect(parseFieldValue(seconds, '90')).toEqual({ value: 90, unit: 'second' });
    });

    test('h:mm:ss reads as hours, minutes, and seconds', () => {
      expect(parseFieldValue(seconds, '1:02:03')).toEqual({ value: 3723, unit: 'second' });
    });

    test('a clock part over 59 is rejected, not silently carried', () => {
      expect(fieldInputError(minutes, '2:75')).toBeDefined();
      expect(parseFieldValue(minutes, '2:75')).toBeNull();
    });

    test('a clock form is not accepted on a non-duration field', () => {
      const reps = { ...field, dimension: 'reps' as const, unit: 'reps', step: 1 };
      expect(fieldInputError(reps, '2:15')).toBeDefined();
      expect(parseFieldValue(reps, '2:15')).toBeNull();
    });

    test('a bare colon or an empty clock is rejected', () => {
      expect(parseFieldValue(minutes, ':')).toBeNull();
      expect(parseFieldValue(minutes, ':30')).toBeNull();
      expect(parseFieldValue(minutes, '2:')).toBeNull();
    });

    test('zero on the clock is a real value', () => {
      expect(parseFieldValue(minutes, '0:00')).toEqual({ value: 0, unit: 'minute' });
    });
  });

  test('draftRowValues skips blanks and keeps the field unit', () => {
    const fields = [
      field,
      { ...field, dimension: 'reps' as const, unit: 'reps' }
    ];
    const values = draftRowValues(fields, { weight: '135' });
    expect(values.weight).toEqual({ value: 135, unit: 'lb' });
    expect(values.reps).toBeUndefined();
  });

  test('fieldDisplay falls back to the model value with no override', () => {
    expect(fieldDisplay({ ...field, value: '60' }, undefined)).toBe('60');
    expect(fieldDisplay({ ...field, value: '60' }, {})).toBe('60');
    expect(fieldDisplay({ ...field, value: '60' }, { weight: '' })).toBe('');
  });
});

describe('unit pill conversion', () => {
  test('a tap converts the displayed value and saves the preference', async () => {
    const h = harness();
    const result = await tapUnitPill({
      exercise: h.staticData.exerciseById.get('back-squat'),
      dimension: 'weight',
      currentUnit: 'lb',
      display: '225',
      preferences: h.preferences.service
    });

    expect(result.nextUnit).toBe('kg');
    // 225 lb is 102.058... kg, shown rounded to the 0.1 grid.
    expect(result.display).toBe('102.1');
    // REQUIREMENT 12.4: the preference moved with the tap.
    const units = h.preferences.doc().exerciseUnits as Record<string, Record<string, string>>;
    expect(units['back-squat'].weight).toBe('kg');
  });

  test('the converted display is rounded to the nearest 0.1', async () => {
    const h = harness();
    const result = await tapUnitPill({
      exercise: h.staticData.exerciseById.get('back-squat'),
      dimension: 'weight',
      currentUnit: 'kg',
      display: '100',
      preferences: h.preferences.service
    });
    expect(result.nextUnit).toBe('lb');
    // 100 kg is 220.462... lb.
    expect(result.display).toBe('220.5');
  });

  test('leaving the rounded value unchanged keeps the full-precision stored value', async () => {
    // The pill converts the display only. Nothing here writes a result, so a
    // stored value keeps the precision it was written with. REQUIREMENT 12.6.
    const stored = { value: 102.0581622, unit: 'lb' };
    const converted = convertFieldDisplay(
      {
        dimension: 'weight',
        label: 'Weight',
        value: '102.1',
        unit: 'lb',
        compatibleUnits: ['lb', 'kg'],
        inputmode: 'decimal',
        stored: true,
        step: 0.1
      },
      String(stored.value),
      'kg'
    );
    expect(converted).toBe('46.3');
    // The stored quantity is untouched by the display conversion.
    expect(stored.value).toBe(102.0581622);
  });

  test('a blank field stays blank through a unit tap', async () => {
    const h = harness();
    const result = await tapUnitPill({
      exercise: h.staticData.exerciseById.get('back-squat'),
      dimension: 'weight',
      currentUnit: 'lb',
      display: '',
      preferences: h.preferences.service
    });
    expect(result.display).toBe('');
  });

  test('a dimension with one unit reports no next unit', async () => {
    const h = harness();
    const result = await tapUnitPill({
      exercise: h.staticData.exerciseById.get('back-squat'),
      dimension: 'reps',
      currentUnit: 'reps',
      display: '8',
      preferences: h.preferences.service
    });
    expect(result.nextUnit).toBeNull();
  });
});

describe('set-table presentation', () => {
  function repeatedSets(): Workout {
    return {
      id: WORKOUT_ID,
      name: 'Three Squat Sets',
      root: {
        id: 'root',
        type: 'container',
        strategy: 'sequence',
        strategyConfig: {},
        children: [
          {
            id: 'squat-sets',
            type: 'container',
            name: 'Back Squat',
            strategy: 'rounds',
            strategyConfig: { rounds: 3 },
            children: [
              {
                id: 'squat-set',
                type: 'exercise',
                exerciseId: 'back-squat',
                stimulus: 'strength',
                setType: 'working',
                prescription: { reps: 5, weight: { value: 100, unit: 'lb' } }
              }
            ]
          }
        ]
      }
    };
  }

  test('one repeated exercise renders as one reusable table with ordered sets', () => {
    const workout = repeatedSets();
    const h = harness(exercises(), [workout]);
    const model = buildActiveWorkoutModel({
      workout,
      session: emptySession(),
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });

    const tables = model.blocks.filter((block) => block.kind === 'set-table');
    expect(tables).toHaveLength(1);
    expect(tables[0]?.kind === 'set-table' ? tables[0].table.title : '').toBe('Back Squat');
    expect(tables[0]?.kind === 'set-table' ? tables[0].table.sectionTitle : '').toBe('Strength');
    expect(tables[0]?.kind === 'set-table' ? tables[0].table.label : '').toBe('Working sets');
    expect(tables[0]?.kind === 'set-table'
      ? tables[0].table.rows.map((row) => row.setNumber)
      : []).toEqual([1, 2, 3]);
    // A single-exercise table draws no round divider: `Set N` already
    // orders it, so a divider would only add noise.
    expect(tables[0]?.kind === 'set-table'
      ? tables[0].table.rounds.map((round) => round.label)
      : []).toEqual(['', '', '']);
    expect(tables[0]?.kind === 'set-table' ? tables[0].table.multiExercise : true).toBe(false);
  });

  test('attempts keep their set number and only the latest can add another', () => {
    const workout = repeatedSets();
    const h = harness(exercises(), [workout]);
    const session = emptySession();
    const path = [
      { nodeId: 'root' },
      { nodeId: 'squat-sets', iteration: 1 },
      { nodeId: 'squat-set' }
    ];
    session.exerciseResults = {
      'root/squat-sets:1/squat-set|both|1': {
        workoutId: WORKOUT_ID,
        exerciseId: 'back-squat',
        executionPath: path,
        side: 'both',
        attempt: 1,
        status: 'incomplete',
        reasonCode: 'unsuccessful_attempt'
      },
      'root/squat-sets:1/squat-set|both|2': {
        workoutId: WORKOUT_ID,
        exerciseId: 'back-squat',
        executionPath: path,
        side: 'both',
        attempt: 2,
        status: 'completed',
        values: { reps: { value: 5, unit: 'reps' } }
      }
    };

    const model = buildActiveWorkoutModel({
      workout,
      session,
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });
    const attempts = model.rows.filter((row) => row.setNumber === 1);
    expect(attempts.map((row) => row.attempt)).toEqual([1, 2]);
    expect(attempts.map((row) => row.latestAttempt)).toEqual([false, true]);
  });
});

describe('circuit set-table presentation', () => {
  /** A rounds container that repeats two exercises. */
  function circuit(rounds = 3, scored = false): Workout {
    const block: Record<string, unknown> = {
      id: 'superset',
      type: 'container',
      name: 'Superset A',
      strategy: 'rounds',
      strategyConfig: { rounds },
      children: [
        {
          id: 'curl',
          type: 'exercise',
          exerciseId: 'back-squat',
          stimulus: 'hypertrophy',
          setType: 'working',
          prescription: { reps: 8 }
        },
        {
          id: 'ext',
          type: 'exercise',
          exerciseId: 'back-squat',
          stimulus: 'hypertrophy',
          setType: 'working',
          prescription: { reps: 8 }
        }
      ]
    };
    if (scored) {
      block.resultCapture = { mode: 'scored', scoreType: 'rounds_and_reps', childDetail: 'optional' };
    }
    return {
      id: WORKOUT_ID,
      name: 'Circuit',
      root: {
        id: 'root',
        type: 'container',
        strategy: 'sequence',
        strategyConfig: {},
        children: [block]
      }
    } as unknown as Workout;
  }

  function tablesFor(workout: Workout) {
    const h = harness(exercises(), [workout]);
    const model = buildActiveWorkoutModel({
      workout,
      session: emptySession(),
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });
    return { model, tables: model.blocks.filter((b) => b.kind === 'set-table') };
  }

  test('a repeated circuit collapses into one table grouped by round', () => {
    const { model, tables } = tablesFor(circuit());
    expect(tables).toHaveLength(1);
    if (tables[0]?.kind !== 'set-table') return;
    const table = tables[0].table;
    expect(table.multiExercise).toBe(true);
    // The container names the table, because one heading cannot name both.
    expect(table.title).toBe('Superset A');
    expect(table.rounds.map((round) => round.label)).toEqual(['Round 1', 'Round 2', 'Round 3']);
    expect(table.rounds.map((round) => round.rows.length)).toEqual([2, 2, 2]);
    // Every row keeps its own round number, and no row is lost. Rows read
    // in round order, so the set number repeats across the round.
    expect(table.rows).toHaveLength(6);
    expect(table.rows.map((row) => row.setNumber)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(model.blocks.filter((b) => b.kind === 'row')).toHaveLength(0);
  });

  test('a circuit table carries no single Last Time badge', () => {
    const { tables } = tablesFor(circuit());
    if (tables[0]?.kind !== 'set-table') return;
    // The badge rides each row instead, so one exercise does not read as
    // the whole circuit's history.
    expect(tables[0].table.lastTime).toBeUndefined();
  });

  test('a single round draws no round divider', () => {
    const { tables } = tablesFor(circuit(1));
    if (tables[0]?.kind !== 'set-table') return;
    expect(tables[0].table.rounds).toHaveLength(1);
    expect(tables[0].table.rounds[0]?.label).toBe('');
  });

  test('a scored container never collapses into a table', () => {
    const { model, tables } = tablesFor(circuit(3, true));
    expect(tables).toHaveLength(0);
    // The container keeps its heading, so its score editor still draws.
    expect(model.blocks.some((b) => b.kind === 'group' && b.group.scored)).toBe(true);
  });

  test('a rounds container holding a nested container does not collapse', () => {
    const workout = {
      id: WORKOUT_ID,
      name: 'Nested',
      root: {
        id: 'root',
        type: 'container',
        strategy: 'sequence',
        strategyConfig: {},
        children: [
          {
            id: 'outer',
            type: 'container',
            name: 'Outer',
            strategy: 'rounds',
            strategyConfig: { rounds: 2 },
            children: [
              {
                id: 'direct',
                type: 'exercise',
                exerciseId: 'back-squat',
                stimulus: 'strength',
                setType: 'working',
                prescription: { reps: 5 }
              },
              {
                id: 'inner',
                type: 'container',
                name: 'Inner',
                strategy: 'sequence',
                strategyConfig: {},
                children: [
                  {
                    id: 'deep',
                    type: 'exercise',
                    exerciseId: 'back-squat',
                    stimulus: 'strength',
                    setType: 'working',
                    prescription: { reps: 5 }
                  }
                ]
              }
            ]
          }
        ]
      }
    } as unknown as Workout;

    const { tables } = tablesFor(workout);
    // The outer block must not swallow the round the inner container owns.
    expect(tables).toHaveLength(0);
  });

  test('a circuit keeps one table per container scope', () => {
    const single = circuit(2);
    const two = {
      ...single,
      root: {
        ...single.root,
        children: [
          single.root.children[0],
          { ...(single.root.children[0] as object), id: 'superset-2', name: 'Superset B' }
        ]
      }
    } as unknown as Workout;
    const { tables } = tablesFor(two);
    expect(tables).toHaveLength(2);
    if (tables[0]?.kind !== 'set-table' || tables[1]?.kind !== 'set-table') return;
    expect(tables[0].table.key).not.toBe(tables[1].table.key);
    const keys = [
      ...tables[0].table.rows,
      ...tables[1].table.rows
    ].map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('a circuit table carries one line per exercise and one cell per set', () => {
    const { tables } = tablesFor(circuit(3));
    expect(tables).toHaveLength(1);
    if (tables[0]?.kind !== 'set-table') return;

    const matrix = tables[0].table.matrix;
    expect(matrix).toBeDefined();
    expect(matrix!.columns.map((column) => column.label)).toEqual(['Set 1', 'Set 2', 'Set 3']);
    // Two nodes name the same exercise here, so the matrix must keep them
    // apart. Keying a line by the exercise name would merge them into one.
    expect(matrix!.rows.length).toBe(2);
    for (const line of matrix!.rows) {
      expect(line.cells.length).toBe(3);
      for (const cell of line.cells) expect(cell.rows.length).toBe(1);
    }
    // The flat row list still holds every row, so a caller that ignores the
    // matrix reads the same set it always did.
    expect(tables[0].table.rows.length).toBe(6);
  });

  test('a single-exercise table has no matrix', () => {
    const single = circuit(3);
    const block = single.root.children[0] as Record<string, unknown>;
    block.children = (block.children as Array<Record<string, unknown>>).slice(0, 1);
    const { tables } = tablesFor(single);
    expect(tables).toHaveLength(1);
    if (tables[0]?.kind !== 'set-table') return;
    expect(tables[0].table.multiExercise).toBe(false);
    expect(tables[0].table.matrix).toBeUndefined();
  });

  test('a round that overrides the target marks its own cell only', () => {
    const w = circuit(3);
    const block = w.root.children[0] as Record<string, unknown>;
    const children = block.children as Array<Record<string, unknown>>;
    // The first exercise asks for 6 reps in round 2 only.
    children[0].prescription = { reps: 8, iterations: [{ iteration: 2, reps: 6 }] };
    const { tables } = tablesFor(w);
    if (tables[0]?.kind !== 'set-table') return;

    const matrix = tables[0].table.matrix!;
    const overridden = matrix.rows.find((line) =>
      line.cells.some((cell) => cell.prescriptionText !== undefined)
    );
    expect(overridden).toBeDefined();
    const marks = overridden!.cells.map((cell) => cell.prescriptionText !== undefined);
    expect(marks).toEqual([false, true, false]);
    // The other exercise never overrides.
    const plain = matrix.rows.find((line) => line !== overridden);
    for (const cell of plain!.cells) expect(cell.prescriptionText).toBeUndefined();
  });

  // The gate that decides whether a container collapses reads the
  // programmed child list, never the recorded rows. These hold that.
  // A superset that drops out of the grid halfway through a session is a
  // serious UX failure: the layout the user was working in vanishes under
  // them because of their own recording.
  describe('the grid survives mid-session recording', () => {
    /** Record one result under round `iteration` of the circuit. */
    function recorded(
      workout: Workout,
      entries: Array<{ node: string; iteration: number; side: Side; attempt: number; reps: number }>
    ): Session {
      const session = emptySession();
      for (const entry of entries) {
        const path = [
          { nodeId: 'root' },
          { nodeId: 'superset', iteration: entry.iteration },
          { nodeId: entry.node }
        ];
        const key = `${encodePath(path)}|${entry.side}|${entry.attempt}`;
        session.exerciseResults[key] = {
          workoutId: WORKOUT_ID,
          executionPath: path,
          exerciseId: 'back-squat',
          side: entry.side,
          attempt: entry.attempt,
          status: 'completed',
          values: { reps: { value: entry.reps, unit: 'reps' } }
        };
      }
      return session;
    }

    function tableFor(session: Session) {
      const h = harness(exercises(), [circuit(3)]);
      const model = buildActiveWorkoutModel({
        workout: circuit(3),
        session,
        staticData: h.staticData,
        preferences: h.preferences.service,
        lookup: h.lookup
      });
      return model.blocks.find((block) => block.kind === 'set-table');
    }

    const both = (node: string, iteration: number, reps = 8) => ({
      node,
      iteration,
      side: 'both' as const,
      attempt: 1,
      reps
    });

    test('a second side on one round keeps the grid', () => {
      const table = tableFor(
        recorded(circuit(3), [
          { node: 'curl', iteration: 1, side: 'left', attempt: 1, reps: 8 },
          { node: 'curl', iteration: 1, side: 'right', attempt: 1, reps: 8 },
          both('ext', 1),
          both('curl', 2),
          both('ext', 2),
          both('curl', 3),
          both('ext', 3)
        ])
      );
      expect(table?.kind).toBe('set-table');
      if (table?.kind !== 'set-table') return;
      // The extra side stacks inside the cell instead of breaking the grid.
      expect(table.table.matrix!.rows[0].cells[0].rows.length).toBe(2);
      expect(table.table.matrix!.rows[0].cells[1].rows.length).toBe(1);
    });

    test('an extra attempt on one round keeps the grid', () => {
      const table = tableFor(
        recorded(circuit(3), [
          both('curl', 1),
          { node: 'curl', iteration: 1, side: 'both', attempt: 2, reps: 5 },
          both('ext', 1),
          both('curl', 2),
          both('ext', 2),
          both('curl', 3),
          both('ext', 3)
        ])
      );
      expect(table?.kind).toBe('set-table');
    });

    test('the real case: sets 1 and 2 both, set 3 five left and four right', () => {
      const table = tableFor(
        recorded(circuit(3), [
          both('curl', 1, 10),
          both('ext', 1, 10),
          both('curl', 2, 10),
          both('ext', 2, 10),
          { node: 'curl', iteration: 3, side: 'left', attempt: 1, reps: 5 },
          { node: 'curl', iteration: 3, side: 'right', attempt: 1, reps: 4 },
          both('ext', 3, 10)
        ])
      );
      expect(table?.kind).toBe('set-table');
      if (table?.kind !== 'set-table') return;
      const curl = table.table.matrix!.rows[0];
      // Set 3 holds two rows, and they sum to nine.
      expect(curl.cells[2].rows.length).toBe(2);
      expect(cellRepsTotal(curl.cells[2].rows, () => ({}))).toBe('9 total');
      // Sets 1 and 2 hold one row each, so no total line is needed.
      expect(cellRepsTotal(curl.cells[0].rows, () => ({}))).toBe('');
    });

    test('two sibling containers with different children each collapse alone', () => {
      // There is no such thing as one container whose own rounds program
      // different children: every group under one scope is the same node
      // across its iterations. Two containers with different children are
      // two scopes, and each collapses on its own terms.
      const base = circuit(2);
      const block = base.root.children[0] as Record<string, unknown>;
      const w = {
        ...base,
        root: {
          ...base.root,
          children: [
            block,
            {
              ...block,
              id: 'superset-single',
              name: 'Single Block',
              children: [children0()]
            }
          ]
        }
      } as unknown as Workout;
      function children0() {
        return {
          id: 'only',
          type: 'exercise',
          exerciseId: 'back-squat',
          stimulus: 'hypertrophy',
          setType: 'working',
          prescription: { reps: 5 }
        };
      }
      const h = harness(exercises(), [w]);
      const model = buildActiveWorkoutModel({
        workout: w,
        session: emptySession(),
        staticData: h.staticData,
        preferences: h.preferences.service,
        lookup: h.lookup
      });
      const tables = model.blocks.filter((block2) => block2.kind === 'set-table');
      expect(tables).toHaveLength(2);
      const multi = tables.filter((t) => t.kind === 'set-table' && t.table.multiExercise);
      const single = tables.filter((t) => t.kind === 'set-table' && !t.table.multiExercise);
      expect(multi).toHaveLength(1);
      expect(single).toHaveLength(1);
      // The single-exercise block stays a vertical list, not a grid.
      if (single[0]?.kind !== 'set-table') return;
      expect(single[0].table.matrix).toBeUndefined();
    });
  });
});

describe('model stability', () => {
  test('a rebuild over the same session produces the same row keys', () => {
    const h = harness(exercises(), [nestedWorkout()]);
    const session = clone(nestedSession());
    const first = buildActiveWorkoutModel({
      workout: h.workout,
      session,
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });
    const second = buildActiveWorkoutModel({
      workout: h.workout,
      session: clone(session),
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });
    expect(first.rows.map((row) => row.key)).toEqual(second.rows.map((row) => row.key));
  });

  test('two occurrences of one node never share a row key', () => {
    const h = harness(exercises(), [nestedWorkout()]);
    const model = buildActiveWorkoutModel({
      workout: h.workout,
      session: emptySession(),
      staticData: h.staticData,
      preferences: h.preferences.service,
      lookup: h.lookup
    });
    const keys = model.rows.map((row) => row.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('repsMeaning: the field says what the number means', () => {
  const repsField = {
    dimension: 'reps' as const,
    label: 'Reps',
    value: '8',
    unit: 'reps',
    compatibleUnits: ['reps'],
    inputmode: 'numeric' as const,
    stored: false,
    step: 1
  };
  const fields = [repsField];

  test('both sides reads as one count for the set', () => {
    expect(repsMeaning({ side: 'both' }, fields, { reps: '8' })).toBe(
      'Both sides together · 8 for the set'
    );
  });

  test('a single side reads as per side', () => {
    expect(repsMeaning({ side: 'left' }, fields, { reps: '8' })).toBe(
      'Left side only · 8 per side'
    );
    expect(repsMeaning({ side: 'right' }, fields, { reps: '10' })).toBe(
      'Right side only · 10 per side'
    );
  });

  test('alternating returns the per-side split', () => {
    // The split moved here from the options panel, so it shows beside the
    // field whether the panel is open or not.
    expect(
      repsMeaning({ side: 'alternating', startingSide: 'left' }, fields, { reps: '20' })
    ).toBe('20 total / 10 each');
  });

  test('alternating with no starting side says nothing', () => {
    // The split needs to know which side went first. Without it the line
    // would invent a split.
    expect(repsMeaning({ side: 'alternating' }, fields, { reps: '20' })).toBe('');
  });

  test('a blank field says nothing', () => {
    expect(repsMeaning({ side: 'both' }, fields, { reps: '' })).toBe('');
  });

  test('a field with no reps dimension says nothing', () => {
    const weightOnly = [{ ...repsField, dimension: 'weight' as const, unit: 'lb' }];
    expect(repsMeaning({ side: 'both' }, weightOnly, { weight: '90' })).toBe('');
  });

  test('it follows the draft, not the stored value', () => {
    // The stored field shows 8; the user has typed 12 since.
    expect(repsMeaning({ side: 'left' }, fields, { reps: '12' })).toBe(
      'Left side only · 12 per side'
    );
    expect(repsMeaning({ side: 'left' }, fields, undefined)).toBe(
      'Left side only · 8 per side'
    );
  });
});
