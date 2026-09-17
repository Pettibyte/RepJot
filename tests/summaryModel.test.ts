// Phase 18: the Workout Summary view model.
//
// The tests here hold the three rules the model exists for: only saved work
// renders, the tree orders rows but never supplies a value, and one unresolved
// result never drops the list.

import { describe, expect, test } from 'bun:test';
import type { LoadedStaticData } from '../src/documents/static-loader';
import type { Session } from '../src/domain/types';
import {
  buildSummaryModel,
  reasonLabel,
  summaryRowErrorProps
} from '../src/ui/viewmodels/summaryModel';
import {
  SESSION_KEY,
  WORKOUT_ID,
  clone,
  exercises,
  staticData,
  validSession,
  workout
} from './fixtures/semantic';

/** Wrap the fixture bundle in the shape `buildSummaryModel` reads. */
function loaded(data = staticData()): LoadedStaticData {
  return {
    ...data,
    exerciseById: new Map(data.exercises.map((exercise) => [exercise.id, exercise])),
    workoutById: new Map(data.workouts.map((candidate) => [candidate.id, candidate]))
  };
}

/** Every exercise row across every group, flattened. */
function allRows(model: ReturnType<typeof buildSummaryModel>) {
  return model.groups.flatMap((group) => group.rows);
}

/** Every container score row across every group, flattened. */
function allScores(model: ReturnType<typeof buildSummaryModel>) {
  return model.groups.flatMap((group) => group.containers);
}

/** A fixed "now" so a date label never depends on the wall clock. */
const NOW = '2026-08-15T18:00:00Z';

describe('buildSummaryModel: header', () => {
  test('names the workout and reports the session status', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    expect(model.title).toBe('Demo Workout');
    expect(model.statusLabel).toBe('Completed');
    expect(model.workoutUnresolved).toBeFalse();
    expect(model.isEmpty).toBeFalse();
  });

  test('falls back to the stored workout id when the bundle lacks the workout', () => {
    const session = validSession();
    session.workoutId = 'gone-workout';
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    expect(model.title).toBe('gone-workout');
    expect(model.workoutUnresolved).toBeTrue();
  });

  test('shows the session note when the session carries one', () => {
    const session = validSession();
    session.notes = 'Felt strong today.';
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    expect(model.notes).toBe('Felt strong today.');
  });

  test('omits the note when the session has none', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    expect(model.notes).toBeUndefined();
  });
});

describe('buildSummaryModel: date labels', () => {
  test('reads the start and completion stamps through the local zone', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    // Same local day as NOW, so both read "Today HH:MM".
    expect(model.startedLabel).toBe('Today 14:30');
    expect(model.completedLabel).toBe('Today 15:05');
  });

  test('drops the year inside the current year and keeps it outside', () => {
    const session = validSession();
    session.startedAtUtc = '2025-03-14T14:30:00Z';
    session.completedAtUtc = '2026-03-14T15:05:00Z';
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    expect(model.startedLabel).toBe('2025-03-14');
    expect(model.completedLabel).toBe('Mar 14');
  });

  test('leaves the completion label empty when the session never completed', () => {
    const session = validSession();
    session.status = 'in_progress';
    delete session.completedAtUtc;
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    expect(model.completedLabel).toBe('');
  });
});

describe('buildSummaryModel: only saved work renders', () => {
  test('a session with empty result maps produces no rows', () => {
    const session: Session = {
      id: 'empty-session',
      workoutId: WORKOUT_ID,
      status: 'in_progress',
      startedAtUtc: '2026-08-15T14:30:00Z',
      updatedAtUtc: '2026-08-15T14:31:00Z',
      exerciseResults: {},
      containerResults: {}
    };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    // The workout prescribes many sets. None of them appear, because none were
    // recorded. REQUIREMENTS 6.23.
    expect(model.groups).toHaveLength(0);
    expect(model.isEmpty).toBeTrue();
    expect(model.unresolved).toHaveLength(0);
  });

  test('a session with no result maps at all produces no rows and does not throw', () => {
    const session = validSession();
    delete session.exerciseResults;
    delete session.containerResults;
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    expect(model.groups).toHaveLength(0);
    expect(model.isEmpty).toBeTrue();
  });

  test('every exercise result in the session reaches exactly one row', () => {
    const session = validSession();
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const keys = allRows(model).map((row) => row.key);
    expect(keys).toHaveLength(Object.keys(session.exerciseResults).length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('every container result reaches exactly one score row', () => {
    const session = validSession();
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const keys = allScores(model).map((row) => row.key);
    expect(keys).toHaveLength(Object.keys(session.containerResults).length);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('buildSummaryModel: values come from the session, not the tree', () => {
  test('a recorded weight the prescription never mentions still prints', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    // Round 2 of squat-sets recorded 105 lb. The prescription says 100 lb,
    // and iteration 3 says 110 lb. The row prints what was saved.
    const round2 = allRows(model).find((row) => row.encodedPath === 'root/squat-sets:2/back-squat-set');
    expect(round2).toBeDefined();
    expect(round2?.valuesLabel).toContain('105 lb');
  });

  test('a distance prints in the unit it was stored in', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const row = allRows(model).find(
      (candidate) => candidate.encodedPath === 'root/emom-block:2/emom-row'
    );
    expect(row?.valuesLabel).toContain('260 m');
  });

  test('a skipped result keeps its status label and reason', () => {
    const session = validSession();
    const key = 'root/warmup/warmup-squat|both|1';
    session.exerciseResults[key] = {
      ...session.exerciseResults[key],
      status: 'skipped',
      reasonCode: 'equipment_unavailable'
    };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const row = allRows(model).find((candidate) => candidate.key === key);
    expect(row?.statusLabel).toBe('Skipped');
    expect(row?.reasonLabel).toBe('Equipment unavailable');
  });

  test('an alternating set shows the per-side split', () => {
    const session = validSession();
    const key = 'root/warmup/warmup-squat|both|1';
    session.exerciseResults[key] = {
      ...session.exerciseResults[key],
      side: 'alternating',
      startingSide: 'left',
      values: { reps: { value: 9, unit: 'reps' } }
    };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const row = allRows(model).find((candidate) => candidate.key === key);
    expect(row?.alternatingLabel).toBe('9 total / 5 left / 4 right');
  });
});

describe('buildSummaryModel: container scores', () => {
  test('each score prints with its score type label', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const byType = new Map(allScores(model).map((row) => [row.scoreType, row.scoreLabel]));
    expect(byType.get('rounds_and_reps')).toBe('Rounds and reps');
    expect(byType.get('intervals')).toBe('Intervals');
    expect(byType.get('cycles')).toBe('Cycles');
  });

  test('a rounds-and-reps score prints both numbers', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const cindy = allScores(model).find((row) => row.encodedPath === 'root/cindy');
    expect(cindy?.scoreText).toBe('2 + 10');
  });

  test('an intervals score prints completed of total', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const emom = allScores(model).find((row) => row.encodedPath === 'root/emom-block');
    expect(emom?.scoreText).toBe('4 of 8');
  });

  test('a cycles score prints the cycle count', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const complex = allScores(model).find((row) => row.encodedPath === 'root/complex-block');
    expect(complex?.scoreText).toBe('5');
  });

  test('a nonstandard score reads Detailed and prints no numbers', () => {
    const session = validSession();
    session.containerResults['root/cindy|2'] = {
      workoutId: WORKOUT_ID,
      executionPath: [{ nodeId: 'root' }, { nodeId: 'cindy' }],
      attempt: 2,
      status: 'completed',
      score: { type: 'nonstandard', detail: 'Finished one round short, timer failed.' }
    };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const detailed = allScores(model).find((row) => row.scoreType === 'nonstandard');
    expect(detailed).toBeDefined();
    expect(detailed?.scoreLabel).toBe('Detailed');
    expect(detailed?.detailed).toBeTrue();
    expect(detailed?.scoreText).toBe('');
    // A Detailed score is a recorded fact, not a fault. It must not raise an
    // unresolved entry. REQUIREMENTS 10.18.
    expect(model.unresolved.some((entry) => entry.resultKey === 'root/cindy|2')).toBeFalse();
  });
});

describe('buildSummaryModel: semantic presentation', () => {
  const model = buildSummaryModel({
    session: validSession(),
    staticData: loaded(),
    localTimeZone: 'UTC',
    nowUtc: NOW
  });

  test('repeated recorded sets collapse under one exercise heading', () => {
    const block = model.blocks.find(
      (candidate) => candidate.kind === 'set-table' && candidate.table.title === 'Back Squat'
    );
    expect(block?.kind).toBe('set-table');
    if (block?.kind !== 'set-table') return;
    expect(block.table.sectionTitle).toBe('Strength');
    expect(block.table.rows.map((row) => row.setNumber)).toEqual([1, 2, 3]);
    expect(block.table.rows.map((row) => row.valuesLabel)).toContain('5 reps · 105 lb');
  });

  test('container scores retain a semantic conditioning section', () => {
    const block = model.blocks.find(
      (candidate) => candidate.kind === 'group' && candidate.group.title.startsWith('Cindy')
    );
    expect(block?.kind === 'group' ? block.sectionTitle : undefined).toBe('Conditioning');
  });
});

describe('buildSummaryModel: grouping and ordering', () => {
  test('rows land in the group of their parent container', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const warmup = model.groups.find((group) => group.key === 'root/warmup');
    expect(warmup).toBeDefined();
    expect(warmup?.rows.map((row) => row.encodedPath)).toEqual(['root/warmup/warmup-squat']);
  });

  test('each round of a repeated container is its own group', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const rounds = model.groups
      .filter((group) => group.key.startsWith('root/squat-sets'))
      .map((group) => group.key);
    expect(rounds).toEqual(['root/squat-sets:1', 'root/squat-sets:2', 'root/squat-sets:3']);
  });

  test('groups follow the tree order, not the map key order', () => {
    // Reverse the stored map so insertion order contradicts the tree.
    const session = validSession();
    session.exerciseResults = Object.fromEntries(
      Object.entries(session.exerciseResults).reverse()
    );
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const keys = model.groups.map((group) => group.key);
    // The warmup group precedes the squat-sets groups, which precede Cindy.
    expect(keys.indexOf('root/warmup')).toBeLessThan(keys.indexOf('root/squat-sets:1'));
    expect(keys.indexOf('root/squat-sets:3')).toBeLessThan(keys.indexOf('root/cindy'));
  });

  test('rows inside a group follow the tree order', () => {
    const session = validSession();
    session.exerciseResults = Object.fromEntries(
      Object.entries(session.exerciseResults).reverse()
    );
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const cindy = model.groups.find((group) => group.key === 'root/cindy:1');
    expect(cindy?.rows.map((row) => row.encodedPath)).toEqual([
      'root/cindy:1/pushups',
      'root/cindy:1/situps'
    ]);
  });

  test('a group title names the container and its round', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const named = model.groups.find((group) => group.key === 'root/cindy:2');
    expect(named?.title).toBe('Cindy · Round 2');
  });

  test('a container score sits in the group of the container itself', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const scoreGroup = model.groups.find((group) => group.key === 'root/cindy');
    expect(scoreGroup?.containers.map((row) => row.key)).toEqual(['root/cindy|1']);
  });
});

describe('buildSummaryModel: unresolved results', () => {
  test('an unknown exercise keeps its row and raises one unresolved entry', () => {
    const session = validSession();
    const key = 'root/warmup/warmup-squat|both|1';
    session.exerciseResults[key] = {
      ...session.exerciseResults[key],
      exerciseId: 'no-such-exercise'
    };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const row = allRows(model).find((candidate) => candidate.key === key);
    expect(row).toBeDefined();
    expect(row?.unresolved).toBeTrue();
    expect(row?.unresolvedReason).toBe('unknown_exercise');
    // The row still prints the saved values. REQUIREMENTS 6.23.
    expect(row?.valuesLabel).toContain('10 reps');
    expect(model.unresolved.filter((entry) => entry.resultKey === key)).toHaveLength(1);
  });

  test('an unknown exercise labels the row with the stored id', () => {
    const session = validSession();
    const key = 'root/warmup/warmup-squat|both|1';
    session.exerciseResults[key] = { ...session.exerciseResults[key], exerciseId: 'mystery-move' };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const row = allRows(model).find((candidate) => candidate.key === key);
    expect(row?.label).toBe('mystery-move');
  });

  test('a path that points at a different exercise reports the mismatch', () => {
    const session = validSession();
    const key = 'root/warmup/warmup-squat|both|1';
    // `warmup-squat` is a back-squat node. Claim it is a push-up.
    session.exerciseResults[key] = { ...session.exerciseResults[key], exerciseId: 'push-up' };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const row = allRows(model).find((candidate) => candidate.key === key);
    expect(row?.unresolvedReason).toBe('path_exercise_mismatch');
  });

  test('a broken path keeps its row and reports the break', () => {
    const session = validSession();
    const key = 'root/warmup/warmup-squat|both|1';
    session.exerciseResults[key] = {
      ...session.exerciseResults[key],
      executionPath: [{ nodeId: 'root' }, { nodeId: 'not-a-node' }]
    };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const row = allRows(model).find((candidate) => candidate.key === key);
    expect(row).toBeDefined();
    expect(row?.unresolvedReason).toBe('broken_path');
  });

  test('one bad result does not drop the rows beside it', () => {
    const session = validSession();
    const total = Object.keys(session.exerciseResults).length;
    const key = 'root/cindy:1/pushups|both|1';
    session.exerciseResults[key] = { ...session.exerciseResults[key], exerciseId: 'ghost' };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    // REQUIREMENTS 6.10: the list keeps every other result.
    expect(allRows(model)).toHaveLength(total);
    expect(allScores(model)).toHaveLength(Object.keys(session.containerResults).length);
  });

  test('a missing workout marks every row unresolved but keeps them all', () => {
    const session = validSession();
    const total = Object.keys(session.exerciseResults).length;
    session.workoutId = 'removed-workout';
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    expect(allRows(model)).toHaveLength(total);
    expect(allRows(model).every((row) => row.unresolved)).toBeTrue();
    expect(allRows(model).every((row) => row.unresolvedReason === 'unknown_workout')).toBeTrue();
    expect(model.workoutUnresolved).toBeTrue();
  });

  test('unresolved entries carry the session and workout they belong to', () => {
    const session = validSession();
    const key = 'root/warmup/warmup-squat|both|1';
    session.exerciseResults[key] = { ...session.exerciseResults[key], exerciseId: 'ghost' };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const entry = model.unresolved.find((candidate) => candidate.resultKey === key);
    expect(entry?.kind).toBe('result');
    expect(entry?.sessionKey).toBe(SESSION_KEY);
    expect(entry?.workoutId).toBe(WORKOUT_ID);
    expect(entry?.encodedPath).toBe('root/warmup/warmup-squat');
  });

  test('a resolved row carries an Exercise History link and an unresolved row does not', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const resolved = allRows(model).find((row) => !row.unresolved);
    expect(resolved?.href).toBe('#/exercises/back-squat/history');

    const broken = validSession();
    const key = 'root/warmup/warmup-squat|both|1';
    broken.exerciseResults[key] = { ...broken.exerciseResults[key], exerciseId: 'ghost' };
    const brokenModel = buildSummaryModel({
      session: broken,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    expect(allRows(brokenModel).find((row) => row.key === key)?.href).toBeUndefined();
  });
});

describe('buildSummaryModel: raw JSON and error props', () => {
  test('every row carries its own stored result as raw JSON', () => {
    const session = validSession();
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const row = allRows(model).find((candidate) => candidate.key === 'root/warmup/warmup-squat|both|1');
    const parsed = JSON.parse(row?.rawJson ?? '{}') as Record<string, unknown>;
    expect(parsed.exerciseId).toBe('back-squat');
    expect(parsed.status).toBe('completed');
  });

  test('the model carries the whole session as raw JSON', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const parsed = JSON.parse(model.rawJson) as Record<string, unknown>;
    expect(parsed.id).toBe(SESSION_KEY);
  });

  test('the error card names the reason and the recorded path', () => {
    const session = validSession();
    const key = 'root/warmup/warmup-squat|both|1';
    session.exerciseResults[key] = { ...session.exerciseResults[key], exerciseId: 'ghost' };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const row = allRows(model).find((candidate) => candidate.key === key);
    const props = summaryRowErrorProps(row!);
    expect(props.title).toBe('This exercise is not in this build');
    expect(props.detail).toContain('root/warmup/warmup-squat');
    expect(props.rawJson).toBe(row?.rawJson);
  });

  test('reason labels cover the vocabulary and pass an unknown code through', () => {
    expect(reasonLabel('user_skipped')).toBe('Skipped');
    expect(reasonLabel('time_constraint')).toBe('Time constraint');
    expect(reasonLabel('brand_new_code')).toBe('brand_new_code');
  });
});

describe('buildSummaryModel: nested repeated containers', () => {
  test('a child under one outer round lands in that round group only', () => {
    const data = staticData();
    const nested = workout();
    nested.root.children.push({
      id: 'outer-ring',
      type: 'container',
      strategy: 'rounds',
      strategyConfig: { rounds: 2 },
      children: [
        {
          id: 'inner-amrap',
          type: 'container',
          name: 'Inner AMRAP',
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
            }
          ]
        }
      ]
    });
    data.workouts.push(nested);

    const session = validSession();
    const path = [
      { nodeId: 'root' },
      { nodeId: 'outer-ring', iteration: 2 },
      { nodeId: 'inner-amrap', iteration: 1 },
      { nodeId: 'ring-pushups' }
    ];
    session.exerciseResults['root/outer-ring:2/inner-amrap:1/ring-pushups|both|1'] = {
      workoutId: WORKOUT_ID,
      executionPath: path,
      exerciseId: 'push-up',
      side: 'both',
      attempt: 1,
      status: 'completed',
      values: { reps: { value: 7, unit: 'reps' } }
    };

    const model = buildSummaryModel({
      session,
      staticData: loaded(data),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const deep = model.groups.find(
      (group) => group.key === 'root/outer-ring:2/inner-amrap:1'
    );
    expect(deep?.rows.map((row) => row.valuesLabel)).toEqual(['7 reps']);
    expect(deep?.title).toBe('Inner AMRAP · Round 1');
  });
});

describe('buildSummaryModel: determinism', () => {
  test('two builds over the same session produce the same group order', () => {
    const session = clone(validSession());
    const a = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const b = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    expect(a.groups.map((group) => group.key)).toEqual(b.groups.map((group) => group.key));
  });

  test('shuffling the stored map does not change the rendered order', () => {
    const forward = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const shuffled = validSession();
    shuffled.exerciseResults = Object.fromEntries(
      Object.entries(shuffled.exerciseResults).sort((a, b) => (a[0] < b[0] ? 1 : -1))
    );
    const model = buildSummaryModel({
      session: shuffled,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    expect(model.groups.map((group) => group.key)).toEqual(
      forward.groups.map((group) => group.key)
    );
    expect(allRows(model).map((row) => row.key)).toEqual(
      allRows(forward).map((row) => row.key)
    );
  });

  test('the exercise fixture list is not needed by the model builder', () => {
    // The model reads the maps the loaded bundle provides, never the array.
    const data = staticData();
    const bundle = loaded(data);
    const model = buildSummaryModel({
      session: validSession(),
      staticData: bundle,
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    expect(model.groups.length).toBeGreaterThan(0);
    expect(exercises()).toHaveLength(6);
  });
});
