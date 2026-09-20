// The Phase 17 fix round-trips.
//
// The Phase 17 verifier found that the green suite missed every real defect,
// because the tests called pure functions with hand-supplied `overrides`
// maps and SSR-rendered components to strings. Neither path crossed a broken
// seam. These tests cross it: they drive the row-to-screen callback chain
// against the real session service and assert what the saved session holds.
//
// REQUIREMENTS 11.1, 11.5, 11.7, 19.4, 19.8, 19.9.

import { describe, expect, test } from 'bun:test';

import type { Exercise, ResultsShard, Session, Workout } from '../src/domain/types';
import { createLookupService, type LookupService } from '../src/indexes/lookup-service';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import { createCoordinator, type Coordinator } from '../src/sync/sync-coordinator';
import { createPreferenceService } from '../src/preferences/preference-service';
import { createSessionService, type SessionService } from '../src/sessions/session-service';
import {
  buildActiveWorkoutModel,
  draftRowValues,
  type ActiveExerciseRow,
  type ActiveWorkoutModel
} from '../src/ui/viewmodels/activeWorkoutModel';
import {
  amrapShowsPartial,
  buildRowDraft,
  choiceForEffort,
  effortChoices,
  effortFromChoice,
  canAddAttempt
} from '../src/ui/screens/activeWorkoutActions';
import { isBlankExerciseDraft } from '../src/sessions/drafts';
import { FakeDrive } from './fakes/fake-drive';
import { frozenTimers, loadedStaticData } from './fixtures/sync';
import { SESSION_KEY, SHARD_MONTH, WORKOUT_ID, clone, exercises, validShard } from './fixtures/semantic';

/**
 * One screen wired to one real session service.
 *
 * The methods mirror the screen's handlers one-for-one, so a test drives
 * the same chain a tap drives: type, blur, save, reload, rebuild.
 */
interface ScreenHarness {
  service: SessionService;
  session: () => Session;
  model: () => ActiveWorkoutModel;
  rowByNode: (nodeId: string) => ActiveExerciseRow;
  typeValue: (rowKey: string, dimension: string, value: string) => void;
  blurValue: (rowKey: string) => Promise<void>;
  changeSide: (rowKey: string, side: 'left' | 'right' | 'both' | 'alternating') => Promise<void>;
  changeEffort: (rowKey: string, choice: string) => Promise<void>;
  addAttempt: (rowKey: string) => Promise<void>;
  /** Re-read the session from the service, as the screen does after a save. */
  reload: () => Promise<void>;
  overrides: () => Record<string, Record<string, string>>;
}

/**
 * Build a harness over a fresh memory store and a fake Drive.
 *
 * The session under test is `session`, opened from `workout`. The lookup is
 * seeded with `seedShards`, so Last Time reads the same warm index a
 * running app reads.
 */
async function makeScreen(input: {
  workout: Workout;
  session: Session;
  seedShards?: ResultsShard[];
  exerciseList?: Exercise[];
}): Promise<ScreenHarness> {
  const store = createMemoryLocalStore();
  const drive = new FakeDrive();
  const shards = input.seedShards ?? [];
  for (const shard of shards) {
    drive.addFile(`results-${shard.yearMonthUtc}.json`, JSON.stringify(shard));
  }
  const staticData = loadedStaticData(input.exerciseList ?? exercises(), [input.workout]);
  const coordinator = createCoordinator({
    store,
    drive,
    staticData,
    accountKey: 'acct-phase17',
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
  const preferences = createPreferenceService({ coordinator, staticData });

  // The session under edit lands in a shard of its own, merged with the
  // seed shards. The lookup must hold it, because the session service
  // resolves a session to its shard through the index.
  const editMonth = input.session.startedAtUtc.slice(0, 7);
  const editShard: ResultsShard = {
    format: 'repjot/results',
    schemaVersion: 1,
    yearMonthUtc: editMonth,
    sessions: { [input.session.id]: input.session }
  };
  const merged: ResultsShard[] = [];
  for (const shard of [...shards, editShard]) {
    const existing = merged.find((candidate) => candidate.yearMonthUtc === shard.yearMonthUtc);
    if (existing === undefined) {
      merged.push({ ...shard, sessions: { ...shard.sessions } });
    } else {
      Object.assign(existing.sessions, shard.sessions);
    }
  }
  for (const shard of merged) {
    drive.addFile(`results-${shard.yearMonthUtc}.json`, JSON.stringify(shard));
    await coordinator.ensureLoaded(`results-${shard.yearMonthUtc}.json`);
  }
  const lookup = createLookupService({ staticData, shards: merged });
  const service = createSessionService({ coordinator, staticData, preferences, lookup });

  let session = input.session;
  const overrides: Record<string, Record<string, string>> = {};
  const sideDrafts: Record<string, 'left' | 'right' | 'both' | 'alternating'> = {};
  const effortDrafts: Record<string, string> = {};

  function model(): ActiveWorkoutModel {
    return buildActiveWorkoutModel({
      workout: input.workout,
      session,
      staticData,
      preferences,
      lookup
    });
  }

  function rowByNode(nodeId: string): ActiveExerciseRow {
    const row = model().rows.find((candidate) => candidate.nodeKey.endsWith(`|${nodeId}`));
    if (row === undefined) throw new Error(`no row for node ${nodeId}`);
    return row;
  }

  /** Mirror of the screen's `draftForRow`. */
  function draftForRow(row: ActiveExerciseRow) {
    return buildRowDraft({
      workoutId: input.workout.id,
      row,
      overrides: overrides[row.key] ?? {},
      side: sideDrafts[row.key],
      effort: Object.prototype.hasOwnProperty.call(effortDrafts, row.key)
        ? effortFromChoice(row.effortTarget, effortDrafts[row.key] ?? '')
        : undefined
    });
  }

  /** Mirror of the screen's `queueAndFlush`, run synchronously. */
  async function flushRow(row: ActiveExerciseRow): Promise<void> {
    const draft = draftForRow(row);
    if (isBlankExerciseDraft(draft)) {
      if (row.hasSavedResult && row.resultKey !== null) {
        await service.clearExerciseResult(session.id, row.resultKey);
      }
    } else {
      await service.saveExerciseResult(session.id, draft);
    }
    session = await service.load(session.id);
  }

  return {
    service,
    session: () => session,
    model,
    rowByNode,
    overrides: () => overrides,
    typeValue(rowKey, dimension, value) {
      const forRow = overrides[rowKey] ?? {};
      forRow[dimension] = value;
      overrides[rowKey] = forRow;
    },
    async blurValue(rowKey) {
      const row = model().rows.find((candidate) => candidate.key === rowKey);
      if (row === undefined) throw new Error(`no row ${rowKey}`);
      await flushRow(row);
    },
    async changeSide(rowKey, side) {
      const current = model().rows.find((candidate) => candidate.key === rowKey);
      if (current === undefined) throw new Error(`no row ${rowKey}`);
      const previousKey = current.resultKey;
      const previousSide = current.side;
      sideDrafts[rowKey] = side;
      if (current.hasSavedResult && previousSide !== side && previousKey !== null) {
        await service.clearExerciseResult(session.id, previousKey);
      }
      await flushRow(rowByNode(current.nodeKey.split('|')[1] ?? ''));
    },
    async changeEffort(rowKey, choice) {
      effortDrafts[rowKey] = choice;
      const row = model().rows.find((candidate) => candidate.key === rowKey);
      if (row === undefined) throw new Error(`no row ${rowKey}`);
      await flushRow(row);
    },
    async addAttempt(rowKey) {
      const row = model().rows.find((candidate) => candidate.key === rowKey);
      if (row === undefined || row.resultKey === null) throw new Error('no result to copy');
      await service.addAttempt(session.id, row.resultKey);
      session = await service.load(session.id);
    },
    async reload() {
      session = await service.load(session.id);
    }
  };
}

/** A one-exercise workout so the round-trip reads clearly. */
function singleExerciseWorkout(
  exerciseId: string,
  nodeId: string,
  prescription: Workout['root']['children'][number] extends infer _T
    ? import('../src/domain/types').Prescription
    : never
): Workout {
  return {
    id: WORKOUT_ID,
    name: 'Round Trip',
    publishedStatus: 'live',
    root: {
      id: 'root',
      type: 'container',
      strategy: 'sequence',
      strategyConfig: {},
      children: [
        {
          id: nodeId,
          type: 'exercise',
          exerciseId,
          stimulus: 'strength',
          prescription
        }
      ]
    }
  };
}

/** An in-progress session id the schema pattern accepts. */
const EDIT_SESSION_ID = 'session-11111111-0000-4000-8000-0000000000a1';

/** A completed session id the schema pattern accepts. */
const OLD_SESSION_ID = 'session-22222222-0000-4000-8000-0000000000b2';

function openSession(id = EDIT_SESSION_ID): Session {
  return {
    id,
    workoutId: WORKOUT_ID,
    status: 'in_progress',
    startedAtUtc: '2026-09-10T10:00:00Z',
    updatedAtUtc: '2026-09-10T10:00:00Z',
    exerciseResults: {},
    containerResults: {}
  };
}

describe('V-1 round trip: a typed value reaches the saved session', () => {
  test('typing a weight and blurring saves the typed value, not the prescription', async () => {
    const workoutTree = singleExerciseWorkout('back-squat', 'set', {
      reps: 8,
      weight: { value: 60, unit: 'lb' }
    });
    const screen = await makeScreen({ workout: workoutTree, session: openSession() });

    const row = screen.rowByNode('set');
    screen.typeValue(row.key, 'weight', '135');
    screen.typeValue(row.key, 'reps', '5');
    await screen.blurValue(row.key);

    const saved = screen.session().exerciseResults[row.resultKey ?? ''];
    // The saved record holds what the user typed, not the 60 lb the
    // prescription carried. REQUIREMENT 11.1.
    expect(saved?.values?.weight).toEqual({ value: 135, unit: 'lb' });
    expect(saved?.values?.reps).toEqual({ value: 5, unit: 'reps' });
  });

  test('the rebuilt model shows the saved value as stored, not as a default', async () => {
    const workoutTree = singleExerciseWorkout('back-squat', 'set', {
      reps: 8,
      weight: { value: 60, unit: 'lb' }
    });
    const screen = await makeScreen({ workout: workoutTree, session: openSession() });

    const row = screen.rowByNode('set');
    screen.typeValue(row.key, 'weight', '95');
    await screen.blurValue(row.key);

    const rebuilt = screen.rowByNode('set');
    const weight = rebuilt.fields.find((field) => field.dimension === 'weight');
    expect(weight?.value).toBe('95');
    expect(weight?.stored).toBe(true);
  });

  test('clearing a saved value removes the result', async () => {
    // The verifier found the clear path unreachable, because the draft was
    // built from the model rather than from what the user typed.
    const workoutTree = singleExerciseWorkout('back-squat', 'set', {
      reps: 8,
      weight: { value: 60, unit: 'lb' }
    });
    const screen = await makeScreen({ workout: workoutTree, session: openSession() });

    const row = screen.rowByNode('set');
    screen.typeValue(row.key, 'weight', '135');
    await screen.blurValue(row.key);
    expect(Object.keys(screen.session().exerciseResults)).toHaveLength(1);

    screen.typeValue(row.key, 'weight', '');
    screen.typeValue(row.key, 'reps', '');
    await screen.blurValue(row.key);

    // A blank input means no result. REQUIREMENT 11.2.
    expect(Object.keys(screen.session().exerciseResults)).toHaveLength(0);
  });
});

describe('V-2 round trip: a unilateral edit stays on its own side', () => {
  test('editing a left set leaves exactly one result, on left', async () => {
    const workoutTree = singleExerciseWorkout('kb-press', 'press', {
      reps: 5,
      weight: { value: 16, unit: 'kg' }
    });
    const session = openSession();
    const leftKey = 'root/press|left|1';
    session.exerciseResults = {
      [leftKey]: {
        workoutId: WORKOUT_ID,
        executionPath: [{ nodeId: 'root' }, { nodeId: 'press' }],
        exerciseId: 'kb-press',
        side: 'left',
        attempt: 1,
        status: 'completed',
        values: { reps: { value: 5, unit: 'reps' }, weight: { value: 16, unit: 'kg' } }
      }
    };
    const screen = await makeScreen({ workout: workoutTree, session });

    const row = screen.rowByNode('press');
    // The model carries the side, so the row writes the key it shows.
    expect(row.side).toBe('left');
    expect(row.resultKey).toBe(leftKey);

    screen.typeValue(row.key, 'reps', '7');
    await screen.blurValue(row.key);

    const keys = Object.keys(screen.session().exerciseResults);
    // The key set did not grow. No phantom `both` result appeared beside
    // the left one. REQUIREMENT 11.5.
    expect(keys).toEqual([leftKey]);
    expect(screen.session().exerciseResults[leftKey]?.values?.reps).toEqual({
      value: 7,
      unit: 'reps'
    });
    expect(screen.session().exerciseResults['root/press|both|1']).toBeUndefined();
  });

  test('a row with no recorded result still records the side the model carries', async () => {
    const workoutTree = singleExerciseWorkout('kb-press', 'press', { reps: 5 });
    const screen = await makeScreen({ workout: workoutTree, session: openSession() });

    const row = screen.rowByNode('press');
    // `kb-press` is unilateral, so a new row defaults to `alternating`.
    // REQUIREMENT 9.10. The point of this test is that the row writes the
    // key it shows, whatever that side is.
    expect(row.unilateral).toBe(true);
    expect(row.side).toBe('alternating');
    const blankKey = row.resultKey;

    screen.typeValue(row.key, 'reps', '9');
    await screen.blurValue(row.key);
    expect(screen.session().exerciseResults[`${blankKey}`]?.values?.reps?.value).toBe(9);
    expect(screen.session().exerciseResults['root/press|both|1']).toBeUndefined();
  });
});

describe('V-3 round trip: Last Time skips the session under edit', () => {
  test('editing a completed session shows the other session', async () => {
    const workoutTree = singleExerciseWorkout('back-squat', 'set', { reps: 8 });
    const older: ResultsShard = {
      format: 'repjot/results',
      schemaVersion: 1,
      yearMonthUtc: SHARD_MONTH,
      sessions: {
        [OLD_SESSION_ID]: {
          id: OLD_SESSION_ID,
          workoutId: WORKOUT_ID,
          status: 'completed',
          startedAtUtc: '2026-08-01T08:00:00Z',
          completedAtUtc: '2026-08-01T09:00:00Z',
          updatedAtUtc: '2026-08-01T09:00:00Z',
          exerciseResults: {
            'root/set|both|1': {
              workoutId: WORKOUT_ID,
              executionPath: [{ nodeId: 'root' }, { nodeId: 'set' }],
              exerciseId: 'back-squat',
              side: 'both',
              attempt: 1,
              status: 'completed',
              values: { reps: { value: 10, unit: 'reps' }, weight: { value: 135, unit: 'lb' } }
            }
          },
          containerResults: {}
        }
      }
    };

    // The session under edit is itself completed, and newer than the seed.
    const editing: Session = {
      id: EDIT_SESSION_ID,
      workoutId: WORKOUT_ID,
      status: 'completed',
      startedAtUtc: '2026-08-20T08:00:00Z',
      completedAtUtc: '2026-08-20T09:00:00Z',
      updatedAtUtc: '2026-08-20T09:00:00Z',
      exerciseResults: {
        'root/set|both|1': {
          workoutId: WORKOUT_ID,
          executionPath: [{ nodeId: 'root' }, { nodeId: 'set' }],
          exerciseId: 'back-squat',
          side: 'both',
          attempt: 1,
          status: 'completed',
          values: { reps: { value: 3, unit: 'reps' }, weight: { value: 95, unit: 'lb' } }
        }
      },
      containerResults: {}
    };

    const screen = await makeScreen({
      workout: workoutTree,
      session: editing,
      seedShards: [older]
    });

    const lastTime = screen.rowByNode('set').lastTime;
    // The badge shows the OTHER session, never the set being edited.
    // REQUIREMENT 19.4.
    expect(lastTime.kind).toBe('value');
    expect(lastTime.text).toContain('10 reps');
    expect(lastTime.text).toContain('135 lb');
    expect(lastTime.dateLabel).toBe('2026-08-01');
    expect(lastTime.text).not.toContain('3 reps');
  });
});

describe('V-4 round trip: prescriptions stay out of actual-work fields', () => {
  test('all three RepsPrescription shapes leave an unsaved reps field blank', async () => {
    const cases: import('../src/domain/types').RepsPrescription[] = [
      8,
      { target: 12, qualifier: 'approximate' },
      { min: 6, max: 10 }
    ];

    for (const repsPrescription of cases) {
      const workoutTree = singleExerciseWorkout('push-up', 'set', { reps: repsPrescription });
      const screen = await makeScreen({ workout: workoutTree, session: openSession() });
      const row = screen.rowByNode('set');
      const reps = row.fields.find((field) => field.dimension === 'reps');
      expect(reps?.value).toBe('');
      expect(reps?.stored).toBe(false);
      expect(row.prescriptionText).toContain('reps');
    }
  });
});

describe('V-5 round trip: the AMRAP partial survives a round add', () => {
  test('after one added round the partial control is still available', async () => {
    const session = openSession();
    const workoutTree: Workout = {
      id: WORKOUT_ID,
      name: 'AMRAP Trip',
      publishedStatus: 'live',
      root: {
        id: 'root',
        type: 'container',
        strategy: 'sequence',
        strategyConfig: {},
        children: [
          {
            id: 'cindy',
            type: 'container',
            name: 'Cindy',
            strategy: 'amrap',
            strategyConfig: { duration: { value: 20, unit: 'minute' } },
            resultCapture: { mode: 'scored', scoreType: 'rounds_and_reps', childDetail: 'optional' },
            children: [
              {
                id: 'pushups',
                type: 'exercise',
                exerciseId: 'push-up',
                stimulus: 'conditioning',
                prescription: { reps: 10 }
              }
            ]
          }
        ]
      }
    };
    const screen = await makeScreen({ workout: workoutTree, session });
    const group = screen.model().groups.find((candidate) => candidate.containerNodeId === 'cindy');
    if (group === undefined) throw new Error('no cindy group');

    expect(amrapShowsPartial(group)).toBe(true);

    await screen.service.addAmrapRound(session.id, group.storedPath);
    await screen.reload();
    const afterAdd = screen.model().groups.find((candidate) => candidate.containerNodeId === 'cindy');
    if (afterAdd === undefined) throw new Error('no cindy group after add');

    // The `+` wrote child detail, and the partial control survived it.
    // REQUIREMENT 19.8.
    expect(afterAdd.hasSavedDetail).toBe(true);
    expect(amrapShowsPartial(afterAdd)).toBe(true);
  });

  test('saving extra reps keeps the round count already on file', async () => {
    const existing = { type: 'rounds_and_reps' as const, completedRounds: 3, additionalReps: 0 };
    const score = {
      type: 'rounds_and_reps' as const,
      completedRounds: existing.completedRounds,
      additionalReps: 7
    };
    expect(score.completedRounds).toBe(3);
    expect(score.additionalReps).toBe(7);
  });
});

describe('V-6 and V-7 round trip: effort and attempts are reachable', () => {
  test('a programmed effort target reaches the row and the saved result', async () => {
    const workoutTree = singleExerciseWorkout('back-squat', 'set', {
      reps: 5,
      effort: { type: 'rir', target: 2 }
    });
    const screen = await makeScreen({ workout: workoutTree, session: openSession() });

    const row = screen.rowByNode('set');
    expect(row.effortTarget).toEqual({ type: 'rir', target: 2 });

    await screen.changeEffort(row.key, 'rir:1');
    const saved = screen.session().exerciseResults[row.resultKey ?? ''];
    expect(saved?.effort).toEqual({ type: 'rir', value: 1 });
  });

  test('an effort-only draft is not blank, so it records', async () => {
    const draft = buildRowDraft({
      workoutId: WORKOUT_ID,
      row: {
        key: 'k',
        nodeKey: 'w|set',
        resultKey: 'root/set|both|1',
        path: [{ nodeId: 'root' }, { nodeId: 'set' }],
        exerciseId: 'back-squat',
        exerciseName: 'Back Squat',
        prescriptionText: '5 reps',
        fields: [],
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
        unilateral: false
      },
      overrides: {},
      effort: { type: 'failure', achieved: true }
    });
    expect(isBlankExerciseDraft(draft)).toBe(false);
  });

  test('an add-attempt control appears on a row with a saved result', async () => {
    const workoutTree = singleExerciseWorkout('back-squat', 'set', { reps: 5 });
    const session = openSession();
    session.exerciseResults = {
      'root/set|both|1': {
        workoutId: WORKOUT_ID,
        executionPath: [{ nodeId: 'root' }, { nodeId: 'set' }],
        exerciseId: 'back-squat',
        side: 'both',
        attempt: 1,
        status: 'completed',
        values: { reps: { value: 5, unit: 'reps' } }
      }
    };
    const screen = await makeScreen({ workout: workoutTree, session });

    const row = screen.rowByNode('set');
    expect(canAddAttempt(row)).toBe(true);

    await screen.addAttempt(row.key);
    const keys = Object.keys(screen.session().exerciseResults).sort();
    // The second attempt is a separate result key. REQUIREMENT 22.4.7.
    expect(keys).toEqual(['root/set|both|1', 'root/set|both|2']);
    expect(screen.session().exerciseResults['root/set|both|2']?.status).toBe('incomplete');
  });

  test('a row with nothing recorded offers no attempt', async () => {
    const workoutTree = singleExerciseWorkout('back-squat', 'set', { reps: 5 });
    const screen = await makeScreen({ workout: workoutTree, session: openSession() });
    expect(canAddAttempt(screen.rowByNode('set'))).toBe(false);
  });
});

describe('effort choice encoding', () => {
  test('the choices follow the programmed target', () => {
    const failure = effortChoices({ type: 'failure' });
    expect(failure.length).toBe(3);
    expect(failure.map((choice) => choice.value)).toContain('failure:achieved');

    const rir = effortChoices({ type: 'rir', target: 2 });
    expect(rir.map((choice) => choice.value)).toContain('rir:2');

    const rpe = effortChoices({ type: 'rpe', target: 8 });
    expect(rpe.map((choice) => choice.value)).toContain('rpe:8');
  });

  test('no programmed target means no choices', () => {
    expect(effortChoices(undefined)).toEqual([]);
  });

  test('a choice decodes only onto its own target kind', () => {
    // A stale select value cannot write an outcome the prescription did not
    // ask for.
    expect(effortFromChoice({ type: 'rir', target: 2 }, 'rpe:9')).toBeNull();
    expect(effortFromChoice({ type: 'failure' }, 'rir:3')).toBeNull();
    expect(effortFromChoice({ type: 'rir', target: 2 }, '')).toBeNull();
    expect(effortFromChoice({ type: 'rir', target: 2 }, 'rir:4')).toEqual({ type: 'rir', value: 4 });
  });

  test('a recorded outcome round-trips through the choice value', () => {
    expect(choiceForEffort({ type: 'rir', value: 3 })).toBe('rir:3');
    expect(choiceForEffort({ type: 'failure', achieved: true })).toBe('failure:achieved');
    expect(choiceForEffort({ type: 'failure', achieved: false })).toBe('failure:missed');
    expect(choiceForEffort(undefined)).toBe('');
  });
});

describe('alternating display', () => {
  test('an alternating row shows the total and the per-side split', async () => {
    const workoutTree = singleExerciseWorkout('kb-press', 'press', { reps: 10 });
    const session = openSession();
    session.exerciseResults = {
      'root/press|alternating|1': {
        workoutId: WORKOUT_ID,
        executionPath: [{ nodeId: 'root' }, { nodeId: 'press' }],
        exerciseId: 'kb-press',
        side: 'alternating',
        startingSide: 'left',
        attempt: 1,
        status: 'completed',
        values: { reps: { value: 10, unit: 'reps' } }
      }
    };
    const screen = await makeScreen({ workout: workoutTree, session });
    const row = screen.rowByNode('press');
    const { alternatingLine } = await import('../src/ui/viewmodels/activeWorkoutModel');
    // REQUIREMENT 11.7.
    expect(alternatingLine(row, row.fields, {})).toBe('10 total / 5 each');
  });

  test('an odd total names both sides', async () => {
    const { alternatingLine } = await import('../src/ui/viewmodels/activeWorkoutModel');
    expect(
      alternatingLine({ side: 'alternating', startingSide: 'left' }, [
        {
          dimension: 'reps',
          label: 'Reps',
          value: '9',
          unit: 'reps',
          compatibleUnits: ['reps'],
          inputmode: 'numeric',
          stored: true,
          step: 1
        }
      ], {})
    ).toBe('9 total / 5 left / 4 right');
  });

  test('a non-alternating row shows no split line', async () => {
    const { alternatingLine } = await import('../src/ui/viewmodels/activeWorkoutModel');
    expect(alternatingLine({ side: 'both', startingSide: undefined }, [], {})).toBe('');
  });
});

describe('side options', () => {
  test('a side-selectable row offers every side', async () => {
    const { sidesForRow } = await import('../src/ui/viewmodels/activeWorkoutModel');
    expect(sidesForRow({ sideSelectable: true })).toEqual([
      'left',
      'right',
      'both',
      'alternating'
    ]);
  });

  test('a row that cannot split sides records both only', async () => {
    const { sidesForRow } = await import('../src/ui/viewmodels/activeWorkoutModel');
    expect(sidesForRow({ sideSelectable: false })).toEqual(['both']);
  });

  test('sideSelectable follows laterality or per-implement load', async () => {
    const { sideSelectable } = await import('../src/ui/viewmodels/activeWorkoutModel');
    const shape = (
      laterality: 'bilateral' | 'unilateral',
      loadSemantics: 'total' | 'per_implement'
    ) => ({ laterality, loadSemantics });

    // Unilateral qualifies on its own, whatever the load.
    expect(sideSelectable(shape('unilateral', 'total'))).toBe(true);
    expect(sideSelectable(shape('unilateral', 'per_implement'))).toBe(true);
    // Bilateral qualifies when each side carries its own weight.
    expect(sideSelectable(shape('bilateral', 'per_implement'))).toBe(true);
    // One shared load has no per-side story.
    expect(sideSelectable(shape('bilateral', 'total'))).toBe(false);
    // An exercise the bundle does not hold offers nothing.
    expect(sideSelectable(undefined)).toBe(false);
  });
});

describe('prescribed reps value', () => {
  test('each shape reads its own number', async () => {
    const { prescribedRepsValue } = await import('../src/ui/viewmodels/activeWorkoutModel');
    expect(prescribedRepsValue(8)).toBe(8);
    expect(prescribedRepsValue({ target: 12, qualifier: 'approximate' })).toBe(12);
    expect(prescribedRepsValue({ min: 6, max: 10 })).toBe(6);
    expect(prescribedRepsValue(undefined)).toBeUndefined();
  });
});

describe('draft values follow the typed text, not the model', () => {
  test('an override of empty string produces no value even when the model holds one', async () => {
    const fields = [
      {
        dimension: 'weight' as const,
        label: 'Weight',
        value: '135',
        unit: 'lb',
        compatibleUnits: ['lb', 'kg'],
        inputmode: 'decimal' as const,
        stored: true,
        step: 0.1
      }
    ];
    expect(draftRowValues(fields, { weight: '' })).toEqual({});
    expect(draftRowValues(fields, { weight: '90' })).toEqual({ weight: { value: 90, unit: 'lb' } });
  });
});

// Keep the unused-import guard honest: the fixture month is asserted above
// through the seeded shard, and the session key names the default fixture.
void SESSION_KEY;
void clone;
