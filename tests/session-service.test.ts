// The session service: every session mutation, over the real Phase 10
// coordinator, a memory store, and a fake Drive. Phase 14.
// REQUIREMENTS 11.1, 11.2, 11.9-11.22, 10.13-10.18.

import { describe, expect, test, beforeEach } from 'bun:test';
import { resetDiagnosticLog } from '../src/diagnostics/diagnostic-log';
import { AppError } from '../src/domain/errors';
import { exerciseResultKey, containerResultKey } from '../src/domain/execution-path';
import type { ResultsShard, Session, Workout, WorkoutNode } from '../src/domain/types';
import { createMemoryLocalStore } from '../src/storage/memory-local-store';
import type { LocalStore } from '../src/storage/local-store';
import { createCoordinator, type Coordinator } from '../src/sync/sync-coordinator';
import { createPreferenceService, type PreferenceService } from '../src/preferences/preference-service';
import { createLookupService, type LookupService } from '../src/indexes/lookup-service';
import {
  createSessionService,
  type SessionService
} from '../src/sessions/session-service';
import { resolveTree } from '../src/sessions/tree-resolver';
import { FakeDrive } from './fakes/fake-drive';
import { frozenTimers, loadedStaticData, SHARD_NAME } from './fixtures/sync';
import { SESSION_KEY, WORKOUT_ID, exercises, nestedWorkout, validShard, workout } from './fixtures/semantic';

/** The shard logical name for the current UTC month, where `start` writes. */
const CURRENT_SHARD = `results-${new Date().toISOString().slice(0, 7)}.json`;

interface Setup {
  store: LocalStore;
  drive: FakeDrive;
  coordinator: Coordinator;
  preferences: PreferenceService;
  lookup: LookupService;
  service: SessionService;
}

/**
 * Build a service over a fresh memory store and a fake Drive.
 *
 * `seedShards` land in Drive, in the lookup index, and in the coordinator's
 * working document, so a test reads the same warm state a running app would.
 */
async function makeSetup(seedShards: ResultsShard[] = [validShard()]): Promise<Setup> {
  const store = createMemoryLocalStore();
  const drive = new FakeDrive();
  for (const shard of seedShards) {
    drive.addFile(`results-${shard.yearMonthUtc}.json`, JSON.stringify(shard));
  }
  const staticData = loadedStaticData(exercises());
  const coordinator = createCoordinator({
    store,
    drive,
    staticData,
    accountKey: 'acct-sessions',
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
  const preferences = createPreferenceService({ coordinator, staticData });
  const lookup = createLookupService({ staticData, shards: seedShards });
  const service = createSessionService({ coordinator, staticData, preferences, lookup });
  for (const shard of seedShards) {
    await coordinator.ensureLoaded(`results-${shard.yearMonthUtc}.json`);
  }
  return { store, drive, coordinator, preferences, lookup, service };
}

/** A session document with no recorded results at all. */
function emptySession(status: Session['status'] = 'in_progress', id: string = SESSION_KEY): Session {
  return {
    id,
    workoutId: WORKOUT_ID,
    status,
    startedAtUtc: '2026-08-01T10:00:00Z',
    updatedAtUtc: '2026-08-01T10:00:00Z',
    exerciseResults: {},
    containerResults: {}
  };
}

/** A shard holding one session in the 2026-08 month. */
function shardWith(session: Session): ResultsShard {
  return {
    format: 'repjot/results',
    schemaVersion: 1,
    yearMonthUtc: '2026-08',
    sessions: { [SESSION_KEY]: session }
  };
}

/** A setup whose session holds no results, so the test controls every value. */
function makeEmptySetup(status: Session['status'] = 'in_progress'): Promise<Setup> {
  return makeSetup([shardWith(emptySession(status))]);
}

/**
 * A setup built over a caller-supplied workout.
 *
 * `makeSetup` carries the demo workout. A test that needs the nested repeated
 * container shape builds its bundle here.
 */
async function makeSetupWithWorkout(
  session: Session,
  candidate: Workout
): Promise<Setup> {
  const shard = shardWith(session);
  const store = createMemoryLocalStore();
  const drive = new FakeDrive();
  drive.addFile(`results-${shard.yearMonthUtc}.json`, JSON.stringify(shard));
  const staticData = loadedStaticData(exercises(), [candidate]);
  const coordinator = createCoordinator({
    store,
    drive,
    staticData,
    accountKey: 'acct-sessions',
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
  const preferences = createPreferenceService({ coordinator, staticData });
  const lookup = createLookupService({ staticData, shards: [shard] });
  const service = createSessionService({ coordinator, staticData, preferences, lookup });
  return { store, drive, coordinator, preferences, lookup, service };
}

/**
 * A setup that puts the shards on Drive but never loads them.
 *
 * The service must still resolve the shard and delete from it. A mutation that
 * reads a shard the coordinator never loaded sees the family's empty document.
 */
async function makeSetupUnloaded(seedShards: ResultsShard[]): Promise<Setup> {
  const store = createMemoryLocalStore();
  const drive = new FakeDrive();
  for (const shard of seedShards) {
    drive.addFile(`results-${shard.yearMonthUtc}.json`, JSON.stringify(shard));
  }
  const staticData = loadedStaticData(exercises());
  const coordinator = createCoordinator({
    store,
    drive,
    staticData,
    accountKey: 'acct-sessions',
    pagehideTarget: null,
    timers: frozenTimers().timers
  });
  const preferences = createPreferenceService({ coordinator, staticData });
  const lookup = createLookupService({ staticData, shards: seedShards });
  const service = createSessionService({ coordinator, staticData, preferences, lookup });
  return { store, drive, coordinator, preferences, lookup, service };
}

/** The session held in the coordinator's working document. */
function workingSession(coordinator: Coordinator): Session {
  return (coordinator.peek(SHARD_NAME) as ResultsShard).sessions[SESSION_KEY];
}

/** The whole shard held in the coordinator's working document. */
function workingShard(coordinator: Coordinator): ResultsShard {
  return coordinator.peek(SHARD_NAME) as ResultsShard;
}

/** The bytes Drive holds for one shard. */
function shardOnDrive(drive: FakeDrive, name: string): ResultsShard | undefined {
  const text = drive.textOf(name);
  if (text === undefined) return undefined;
  return JSON.parse(text) as ResultsShard;
}

/** Count calls through the coordinator's local edit boundary. */
function countLocalEdits(coordinator: Coordinator): () => number {
  const original = coordinator.edit.bind(coordinator);
  let count = 0;
  coordinator.edit = async (...args: Parameters<Coordinator['edit']>) => {
    count += 1;
    return original(...args);
  };
  return (): number => count;
}

/** True when some scored container above `path` forbids child detail. */
function underNoChildDetail(w: Workout, path: { nodeId: string; iteration?: number }[]): boolean {
  for (let depth = 1; depth < path.length; depth += 1) {
    let current: WorkoutNode = w.root;
    let ok = true;
    for (let index = 1; index < depth; index += 1) {
      if (current.type !== 'container') {
        ok = false;
        break;
      }
      const child = current.children.find((c: WorkoutNode): boolean => c.id === path[index]?.nodeId);
      if (child === undefined) {
        ok = false;
        break;
      }
      current = child;
    }
    if (!ok) continue;
    if (current.type === 'container' && current.resultCapture?.childDetail === 'none') return true;
  }
  return false;
}

/** Read the `AppError` kind a rejection carried, or `null` when it resolved. */
async function kindOfRejection(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error instanceof AppError ? error.kind : 'non-app-error';
  }
}

beforeEach(() => {
  resetDiagnosticLog();
});

describe('start', () => {
  test('returns a session- prefixed ID and writes the UTC start-month shard', async () => {
    const { service, coordinator, drive } = await makeSetup([]);
    const session = await service.start(WORKOUT_ID);

    expect(session.id.startsWith('session-')).toBe(true);
    expect(session.status).toBe('in_progress');
    expect(session.workoutId).toBe(WORKOUT_ID);
    expect(session.completedAtUtc).toBeUndefined();

    // Let the upload settle, then read the bytes Drive holds.
    await coordinator.syncAll();
    const stored = shardOnDrive(drive, CURRENT_SHARD);
    expect(stored?.sessions[session.id]?.startedAtUtc).toBe(session.startedAtUtc);
  });

  test('a workout that is not in the bundle starts nothing', async () => {
    const { service, drive } = await makeSetup([]);
    const kind = await kindOfRejection(() => service.start('no-such-workout'));
    expect(kind).toBe('invalid_document');
    expect(shardOnDrive(drive, CURRENT_SHARD)).toBeUndefined();
  });
});

describe('saveExerciseResult', () => {
  test('a blank draft creates no result', async () => {
    const { service, coordinator } = await makeSetup();
    const before = JSON.stringify(workingShard(coordinator));

    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: [{ nodeId: 'root' }, { nodeId: 'cindy' }, { nodeId: 'pushups' }],
      status: 'completed'
    });

    expect(JSON.stringify(workingShard(coordinator))).toBe(before);
  });

  test('a zero-rep draft creates a completed result', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const path = [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 1 }, { nodeId: 'pushups' }];

    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: path,
      status: 'completed',
      values: { reps: { value: 0, unit: 'reps' } }
    });

    const stored = workingSession(coordinator).exerciseResults[exerciseResultKey(path, 'both', 1)];
    expect(stored?.status).toBe('completed');
    expect(stored?.values?.reps?.value).toBe(0);
  });

  test('a value entered in a display unit is stored with that unit', async () => {
    const { service, coordinator, preferences } = await makeEmptySetup();
    await preferences.setUnit('back-squat', 'weight', 'kg');

    const path = [
      { nodeId: 'root' },
      { nodeId: 'squat-sets', iteration: 1 },
      { nodeId: 'back-squat-set' }
    ];
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'back-squat',
      executionPath: path,
      status: 'completed',
      values: { reps: { value: 5, unit: 'reps' }, weight: { value: 120, unit: 'kg' } }
    });

    const stored = workingSession(coordinator).exerciseResults[exerciseResultKey(path, 'both', 1)];
    expect(stored.values?.weight).toEqual({ value: 120, unit: 'kg' });
  });

  test('a mutation that fails semantic validation writes nothing', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const before = JSON.stringify(workingShard(coordinator));

    // A result that names a workout the session does not belong to.
    const kind = await kindOfRejection(() =>
      service.saveExerciseResult(SESSION_KEY, {
        workoutId: 'other-workout',
        exerciseId: 'push-up',
        executionPath: [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 1 }, { nodeId: 'pushups' }],
        status: 'completed',
        values: { reps: { value: 5, unit: 'reps' } }
      })
    );

    expect(kind).toBe('semantic_reference');
    expect(JSON.stringify(workingShard(coordinator))).toBe(before);
  });
});

describe('moveExerciseResult and saveExerciseResults', () => {
  test('moveExerciseResult removes the previous key and saves the replacement once', async () => {
    const { service, coordinator, drive } = await makeEmptySetup();
    const path = [
      { nodeId: 'root' },
      { nodeId: 'cindy', iteration: 1 },
      { nodeId: 'pushups' }
    ];
    const previousKey = exerciseResultKey(path, 'both', 1);
    const nextKey = exerciseResultKey(path, 'both', 2);

    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: path,
      status: 'completed',
      values: { reps: { value: 5, unit: 'reps' } }
    });
    await coordinator.flush();

    drive.calls.length = 0;
    const editCount = countLocalEdits(coordinator);
    await service.moveExerciseResult(SESSION_KEY, previousKey, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: path,
      attempt: 2,
      status: 'completed',
      values: { reps: { value: 8, unit: 'reps' } }
    });
    await coordinator.flush();

    const results = workingSession(coordinator).exerciseResults;
    expect(results[previousKey]).toBeUndefined();
    expect(results[nextKey]?.attempt).toBe(2);
    expect(results[nextKey]?.values?.reps?.value).toBe(8);
    expect(editCount()).toBe(1);
    expect(drive.calls.filter((call: string): boolean => call.startsWith('updateFile'))).toHaveLength(1);
  });

  test('moveExerciseResult refuses a stale source key', async () => {
    const { service } = await makeEmptySetup();
    const path = [
      { nodeId: 'root' },
      { nodeId: 'cindy', iteration: 1 },
      { nodeId: 'pushups' }
    ];

    const kind = await kindOfRejection(() => service.moveExerciseResult(
      SESSION_KEY,
      exerciseResultKey(path, 'both', 1),
      {
        workoutId: WORKOUT_ID,
        exerciseId: 'push-up',
        executionPath: path,
        side: 'left',
        status: 'completed',
        values: { reps: { value: 5, unit: 'reps' } }
      }
    ));

    expect(kind).toBe('invalid_document');
  });

  test('moveExerciseResult does not overwrite an occupied target key', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const path = [
      { nodeId: 'root' },
      { nodeId: 'cindy', iteration: 1 },
      { nodeId: 'pushups' }
    ];
    for (const side of ['left', 'right'] as const) {
      await service.saveExerciseResult(SESSION_KEY, {
        workoutId: WORKOUT_ID,
        exerciseId: 'push-up',
        executionPath: path,
        side,
        status: 'completed',
        values: { reps: { value: side === 'left' ? 5 : 8, unit: 'reps' } }
      });
    }

    const kind = await kindOfRejection(() => service.moveExerciseResult(
      SESSION_KEY,
      exerciseResultKey(path, 'left', 1),
      {
        workoutId: WORKOUT_ID,
        exerciseId: 'push-up',
        executionPath: path,
        side: 'right',
        status: 'completed',
        values: { reps: { value: 10, unit: 'reps' } }
      }
    ));

    expect(kind).toBe('invalid_document');
    const results = workingSession(coordinator).exerciseResults;
    expect(results[exerciseResultKey(path, 'left', 1)]?.values?.reps?.value).toBe(5);
    expect(results[exerciseResultKey(path, 'right', 1)]?.values?.reps?.value).toBe(8);
  });

  test('saveExerciseResults stores all drafts in one local edit and upload', async () => {
    const { service, coordinator, drive } = await makeEmptySetup();
    const pushPath = [
      { nodeId: 'root' },
      { nodeId: 'cindy', iteration: 1 },
      { nodeId: 'pushups' }
    ];
    const sitPath = [
      { nodeId: 'root' },
      { nodeId: 'cindy', iteration: 1 },
      { nodeId: 'situps' }
    ];
    drive.calls.length = 0;
    const editCount = countLocalEdits(coordinator);

    await service.saveExerciseResults(SESSION_KEY, [
      {
        workoutId: WORKOUT_ID,
        exerciseId: 'push-up',
        executionPath: pushPath,
        status: 'completed',
        values: { reps: { value: 10, unit: 'reps' } }
      },
      {
        workoutId: WORKOUT_ID,
        exerciseId: 'sit-up',
        executionPath: sitPath,
        status: 'completed',
        values: { reps: { value: 15, unit: 'reps' } }
      }
    ]);
    await coordinator.flush();

    const results = workingSession(coordinator).exerciseResults;
    expect(results[exerciseResultKey(pushPath, 'both', 1)]?.values?.reps?.value).toBe(10);
    expect(results[exerciseResultKey(sitPath, 'both', 1)]?.values?.reps?.value).toBe(15);
    expect(editCount()).toBe(1);
    expect(drive.calls.filter((call: string): boolean => call.startsWith('updateFile'))).toHaveLength(1);
  });
});

describe('clearExerciseResult', () => {
  test('removes the key and leaves the rest of the session alone', async () => {
    const { service, coordinator } = await makeSetup();
    const key = exerciseResultKey(
      [{ nodeId: 'root' }, { nodeId: 'warmup' }, { nodeId: 'warmup-squat' }],
      'both',
      1
    );
    expect(workingSession(coordinator).exerciseResults[key]).toBeDefined();

    await service.clearExerciseResult(SESSION_KEY, key);
    expect(workingSession(coordinator).exerciseResults[key]).toBeUndefined();
    expect(Object.keys(workingSession(coordinator).exerciseResults).length).toBeGreaterThan(0);
  });

  test('clearing an absent key writes nothing', async () => {
    const { service, coordinator } = await makeSetup();
    const before = JSON.stringify(workingShard(coordinator));
    await service.clearExerciseResult(SESSION_KEY, 'nope|both|1');
    expect(JSON.stringify(workingShard(coordinator))).toBe(before);
  });
});

describe('addAttempt', () => {
  test('opens the next attempt and returns its key', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const path = [
      { nodeId: 'root' },
      { nodeId: 'squat-sets', iteration: 1 },
      { nodeId: 'back-squat-set' }
    ];
    const fromKey = exerciseResultKey(path, 'both', 1);
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'back-squat',
      executionPath: path,
      status: 'completed',
      values: { reps: { value: 5, unit: 'reps' }, weight: { value: 100, unit: 'lb' } }
    });

    const newKey = await service.addAttempt(SESSION_KEY, fromKey);
    expect(newKey).toBe(exerciseResultKey(path, 'both', 2));

    const opened = workingSession(coordinator).exerciseResults[newKey];
    expect(opened?.attempt).toBe(2);
    expect(opened?.status).toBe('incomplete');
    expect(opened?.reasonCode).toBe('not_completed');
  });

  test('adding from an earlier attempt uses the maximum and preserves every existing attempt', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const path = [
      { nodeId: 'root' },
      { nodeId: 'squat-sets', iteration: 1 },
      { nodeId: 'back-squat-set' }
    ];

    for (const attempt of [1, 2, 3]) {
      await service.saveExerciseResult(SESSION_KEY, {
        workoutId: WORKOUT_ID,
        exerciseId: 'back-squat',
        executionPath: path,
        side: 'left',
        attempt,
        status: 'completed',
        values: {
          reps: { value: attempt + 4, unit: 'reps' },
          weight: { value: 100, unit: 'lb' }
        }
      });
    }

    // A higher attempt for another side must not affect the left-side maximum.
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'back-squat',
      executionPath: path,
      side: 'right',
      attempt: 9,
      status: 'completed',
      values: {
        reps: { value: 5, unit: 'reps' },
        weight: { value: 100, unit: 'lb' }
      }
    });

    const secondKey = exerciseResultKey(path, 'left', 2);
    const rightKey = exerciseResultKey(path, 'right', 9);
    const newKey = await service.addAttempt(
      SESSION_KEY,
      exerciseResultKey(path, 'left', 1)
    );

    expect(newKey).toBe(exerciseResultKey(path, 'left', 4));
    const results = workingSession(coordinator).exerciseResults;
    expect(results[secondKey]?.values?.reps?.value).toBe(6);
    expect(results[rightKey]?.values?.reps?.value).toBe(5);
    expect(results[newKey]?.attempt).toBe(4);
    expect(Object.keys(results)).toHaveLength(5);
  });

  test('an attempt on an unknown result is refused', async () => {
    const { service } = await makeEmptySetup();
    const kind = await kindOfRejection(() => service.addAttempt(SESSION_KEY, 'nope|both|1'));
    expect(kind).toBe('invalid_document');
  });
});

describe('deleteAttempt', () => {
  /** The one exercise path these tests record against. */
  const PATH = [
    { nodeId: 'root' },
    { nodeId: 'squat-sets', iteration: 1 },
    { nodeId: 'back-squat-set' }
  ];

  /** Record one completed attempt with a distinct rep count. */
  async function putAttempt(
    service: SessionService,
    attempt: number,
    reps: number,
    side = 'both'
  ): Promise<void> {
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'back-squat',
      executionPath: PATH,
      side,
      attempt,
      status: 'completed',
      values: { reps: { value: reps, unit: 'reps' } }
    } as ExerciseResultDraft);
  }

  /** The side's attempts as `attempt:reps`, ascending. */
  function attemptList(coordinator: Coordinator, side = 'both'): string[] {
    return Object.entries(workingSession(coordinator).exerciseResults)
      .filter(
        ([key, result]) =>
          key.includes('squat-sets:1/back-squat-set') &&
          (result.side ?? 'both') === side
      )
      .map(([, result]) => `${result.attempt ?? 1}:${result.values?.reps?.value ?? 0}`)
      .sort((a, b) => Number(a.split(':')[0]) - Number(b.split(':')[0]));
  }

  test('deleting a middle attempt renumbers the run contiguous', async () => {
    const { service, coordinator } = await makeEmptySetup();
    await putAttempt(service, 1, 5);
    await putAttempt(service, 2, 7);
    await putAttempt(service, 3, 9);
    expect(attemptList(coordinator)).toEqual(['1:5', '2:7', '3:9']);

    await service.deleteAttempt(SESSION_KEY, exerciseResultKey(PATH, 'both', 2));

    // The gap closes: 5, 7, 9 becomes 5, 9. A stored `1, 3` would read as
    // an attempt that went missing.
    expect(attemptList(coordinator)).toEqual(['1:5', '2:9']);
    expect(
      Object.keys(workingSession(coordinator).exerciseResults).filter((key) =>
        key.includes('squat-sets:1/back-squat-set')
      ).sort()
    ).toEqual([
      exerciseResultKey(PATH, 'both', 1),
      exerciseResultKey(PATH, 'both', 2)
    ]);
  });

  test('deleting the newest attempt leaves the others alone', async () => {
    const { service, coordinator } = await makeEmptySetup();
    await putAttempt(service, 1, 5);
    await putAttempt(service, 2, 7);
    await putAttempt(service, 3, 9);

    await service.deleteAttempt(SESSION_KEY, exerciseResultKey(PATH, 'both', 3));

    expect(attemptList(coordinator)).toEqual(['1:5', '2:7']);
  });

  test('deleting the first attempt pulls the whole run down', async () => {
    const { service, coordinator } = await makeEmptySetup();
    await putAttempt(service, 1, 5);
    await putAttempt(service, 2, 7);
    await putAttempt(service, 3, 9);

    await service.deleteAttempt(SESSION_KEY, exerciseResultKey(PATH, 'both', 1));

    expect(attemptList(coordinator)).toEqual(['1:7', '2:9']);
  });

  test('the renumber is scoped to the deleted attempt side', async () => {
    const { service, coordinator } = await makeEmptySetup();
    await putAttempt(service, 1, 5, 'left');
    await putAttempt(service, 2, 7, 'left');
    await putAttempt(service, 1, 11, 'right');
    await putAttempt(service, 2, 13, 'right');

    await service.deleteAttempt(SESSION_KEY, exerciseResultKey(PATH, 'left', 1));

    expect(attemptList(coordinator, 'left')).toEqual(['1:7']);
    expect(attemptList(coordinator, 'right')).toEqual(['1:11', '2:13']);
  });

  test('deleting the only attempt leaves no result', async () => {
    const { service, coordinator } = await makeEmptySetup();
    await putAttempt(service, 1, 5);

    await service.deleteAttempt(SESSION_KEY, exerciseResultKey(PATH, 'both', 1));

    expect(attemptList(coordinator)).toEqual([]);
  });

  test('a renumbered result key still matches its own value', async () => {
    const { service, coordinator } = await makeEmptySetup();
    for (const [attempt, reps] of [[1, 5], [2, 7], [3, 9], [4, 11]] as const) {
      await putAttempt(service, attempt, reps);
    }

    await service.deleteAttempt(SESSION_KEY, exerciseResultKey(PATH, 'both', 3));

    // The validator rejects a key that disagrees with its value, so a
    // renumber that moved the number but not the key would fail the write.
    // Reaching here with the expected list proves both agree.
    expect(attemptList(coordinator)).toEqual(['1:5', '2:7', '3:11']);
    for (const [key, result] of Object.entries(
      workingSession(coordinator).exerciseResults
    )) {
      if (!key.includes('squat-sets:1/back-squat-set')) continue;
      expect(key).toBe(
        exerciseResultKey(
          result.executionPath,
          result.side ?? 'both',
          result.attempt ?? 1
        )
      );
    }
  });

  test('deleting an unknown attempt is refused', async () => {
    const { service } = await makeEmptySetup();
    const kind = await kindOfRejection(() =>
      service.deleteAttempt(SESSION_KEY, 'nope|both|1')
    );
    expect(kind).toBe('invalid_document');
  });
});

describe('addAmrapRound', () => {
  test('adds one cycle and recomputes the container score', async () => {
    const { service, coordinator } = await makeEmptySetup();
    // A container result is keyed by the container's own path, with no
    // iteration. Its children carry the round on the container segment.
    const containerPath = [{ nodeId: 'root' }, { nodeId: 'cindy' }];
    const key = containerResultKey(containerPath);

    await service.addAmrapRound(SESSION_KEY, containerPath);

    const session = workingSession(coordinator);
    expect(session.containerResults[key]?.score).toEqual({
      type: 'rounds_and_reps',
      completedRounds: 1,
      additionalReps: 0
    });
    // The added round wrote one completed child per direct child of the AMRAP.
    expect(
      session.exerciseResults[
        exerciseResultKey(
          [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 1 }, { nodeId: 'pushups' }],
          'both',
          1
        )
      ]?.values?.reps?.value
    ).toBe(10);
    expect(
      session.exerciseResults[
        exerciseResultKey(
          [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 1 }, { nodeId: 'situps' }],
          'both',
          1
        )
      ]?.values?.reps?.value
    ).toBe(15);
  });

  test('a second call adds the next round, not a repeat of the first', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const containerPath = [{ nodeId: 'root' }, { nodeId: 'cindy' }];
    const key = containerResultKey(containerPath);

    await service.addAmrapRound(SESSION_KEY, containerPath);
    await service.addAmrapRound(SESSION_KEY, containerPath);

    expect(workingSession(coordinator).containerResults[key]?.score).toEqual({
      type: 'rounds_and_reps',
      completedRounds: 2,
      additionalReps: 0
    });
  });

  test('a container with no child detail refuses an added round', async () => {
    const { service } = await makeSetup();
    const kind = await kindOfRejection(() =>
      service.addAmrapRound(SESSION_KEY, [{ nodeId: 'root' }, { nodeId: 'complex-block' }])
    );
    expect(kind).toBe('invalid_document');
  });
});

describe('expandAggregate', () => {
  test('returns inferred drafts and writes nothing', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const containerPath = [{ nodeId: 'root' }, { nodeId: 'emom-block' }];

    await service.setContainerScore(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      executionPath: containerPath,
      status: 'completed',
      score: { type: 'intervals', completedIntervals: 2, totalIntervals: 8 }
    });

    const before = JSON.stringify(workingShard(coordinator));
    const drafts = await service.expandAggregate(SESSION_KEY, containerResultKey(containerPath));

    expect(drafts.length).toBe(2);
    for (const entry of drafts) {
      // The `Inferred` marker reaches the caller on the wrapper.
      // REQUIREMENTS 10.15, 10.16.
      expect(entry.inferred).toBe(true);
      const draft = entry.draft;
      expect(draft.workoutId).toBe(WORKOUT_ID);
      expect(draft.exerciseId.length).toBeGreaterThan(0);
      expect(draft.executionPath.length).toBeGreaterThan(0);
      // Each draft carries its unit beside the value. REQUIREMENT 11.8.
      for (const quantity of Object.values(draft.values ?? {})) {
        expect(typeof quantity?.unit).toBe('string');
      }
    }
    // Expansion is read-only.
    expect(JSON.stringify(workingShard(coordinator))).toBe(before);
  });

  test('a nonstandard score expands to nothing', async () => {
    const { service } = await makeEmptySetup();
    const containerPath = [{ nodeId: 'root' }, { nodeId: 'cindy' }];
    await service.setContainerScore(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      executionPath: containerPath,
      status: 'completed',
      score: { type: 'nonstandard' }
    });
    const drafts = await service.expandAggregate(SESSION_KEY, containerResultKey(containerPath));
    expect(drafts).toEqual([]);
  });
});

describe('saved child detail is authoritative', () => {
  test('a later child edit recomputes the container score', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const containerPath = [{ nodeId: 'root' }, { nodeId: 'cindy' }];
    const key = containerResultKey(containerPath);
    const round1 = [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 1 }];

    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: [...round1, { nodeId: 'pushups' }],
      status: 'completed',
      values: { reps: { value: 10, unit: 'reps' } }
    });
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'sit-up',
      executionPath: [...round1, { nodeId: 'situps' }],
      status: 'completed',
      values: { reps: { value: 15, unit: 'reps' } }
    });

    expect(workingSession(coordinator).containerResults[key]?.score).toEqual({
      type: 'rounds_and_reps',
      completedRounds: 1,
      additionalReps: 0
    });

    // Cut one child below the container. The score follows the detail.
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: [...round1, { nodeId: 'pushups' }],
      status: 'completed',
      values: { reps: { value: 4, unit: 'reps' } }
    });

    expect(workingSession(coordinator).containerResults[key]?.score).toEqual({
      type: 'rounds_and_reps',
      completedRounds: 0,
      additionalReps: 19
    });
  });

  test('detail that breaks progression sets nonstandard', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const containerPath = [{ nodeId: 'root' }, { nodeId: 'cindy' }];
    const key = containerResultKey(containerPath);

    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: [
        { nodeId: 'root' },
        { nodeId: 'cindy', iteration: 1 },
        { nodeId: 'pushups' }
      ],
      status: 'completed',
      values: { reps: { value: 10, unit: 'reps' } }
    });
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'sit-up',
      executionPath: [
        { nodeId: 'root' },
        { nodeId: 'cindy', iteration: 1 },
        { nodeId: 'situps' }
      ],
      status: 'completed',
      values: { reps: { value: 15, unit: 'reps' } }
    });
    // Round 2 is skipped, and round 3 holds a full round.
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: [
        { nodeId: 'root' },
        { nodeId: 'cindy', iteration: 3 },
        { nodeId: 'pushups' }
      ],
      status: 'completed',
      values: { reps: { value: 10, unit: 'reps' } }
    });
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'sit-up',
      executionPath: [
        { nodeId: 'root' },
        { nodeId: 'cindy', iteration: 3 },
        { nodeId: 'situps' }
      ],
      status: 'completed',
      values: { reps: { value: 15, unit: 'reps' } }
    });

    expect(workingSession(coordinator).containerResults[key]?.score).toEqual({
      type: 'nonstandard'
    });
  });

  test('a typed score is replaced by the derived score once detail exists', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const containerPath = [{ nodeId: 'root' }, { nodeId: 'cindy' }];
    const key = containerResultKey(containerPath);

    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: [
        { nodeId: 'root' },
        { nodeId: 'cindy', iteration: 1 },
        { nodeId: 'pushups' }
      ],
      status: 'completed',
      values: { reps: { value: 10, unit: 'reps' } }
    });
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'sit-up',
      executionPath: [
        { nodeId: 'root' },
        { nodeId: 'cindy', iteration: 1 },
        { nodeId: 'situps' }
      ],
      status: 'completed',
      values: { reps: { value: 15, unit: 'reps' } }
    });

    // The user types a score the detail does not support. The detail wins.
    await service.setContainerScore(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      executionPath: containerPath,
      status: 'completed',
      score: { type: 'rounds_and_reps', completedRounds: 9, additionalReps: 99 }
    });

    expect(workingSession(coordinator).containerResults[key]?.score).toEqual({
      type: 'rounds_and_reps',
      completedRounds: 1,
      additionalReps: 0
    });
  });

  test('a container with no child detail offers no expansion', async () => {
    const { service } = await makeEmptySetup();
    const containerPath = [{ nodeId: 'root' }, { nodeId: 'complex-block' }];

    await service.setContainerScore(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      executionPath: containerPath,
      status: 'completed',
      score: { type: 'cycles', completedCycles: 2 }
    });

    // `complex-block` records with `childDetail: 'none'`, so expanding it would
    // only produce results the validator refuses.
    const drafts = await service.expandAggregate(SESSION_KEY, containerResultKey(containerPath));
    expect(drafts).toEqual([]);
  });

  test('a blank container score writes nothing', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const before = JSON.stringify(workingShard(coordinator));
    await service.setContainerScore(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      executionPath: [{ nodeId: 'root' }, { nodeId: 'cindy' }],
      status: 'completed'
    });
    expect(JSON.stringify(workingShard(coordinator))).toBe(before);
  });
});

describe('complete and abandon', () => {
  test('complete sets status and completedAtUtc', async () => {
    const { service, coordinator } = await makeEmptySetup();
    await service.complete(SESSION_KEY);
    const session = workingSession(coordinator);
    expect(session.status).toBe('completed');
    expect(typeof session.completedAtUtc).toBe('string');
  });

  test('abandon sets status and completedAtUtc', async () => {
    const { service, coordinator } = await makeEmptySetup();
    await service.abandon(SESSION_KEY, 'time_constraint');
    const session = workingSession(coordinator);
    expect(session.status).toBe('abandoned');
    expect(typeof session.completedAtUtc).toBe('string');
  });

  test('a newly saved workout is immediately available to History', async () => {
    const { service, lookup } = await makeSetup([]);
    const session = await service.start(WORKOUT_ID);

    expect(lookup.listAllSessions({ offset: 0, limit: 10 }).items.map((item) => item.id)).toEqual([
      session.id
    ]);
    expect(lookup.listActiveSessions().map((item) => item.id)).toEqual([session.id]);

    await service.complete(session.id);

    const history = lookup.listAllSessions({ offset: 0, limit: 10 });
    expect(history.items.map((item) => item.id)).toEqual([session.id]);
    expect(history.items[0]?.status).toBe('completed');
    expect(lookup.listActiveSessions()).toEqual([]);
    expect(lookup.listRecentSessions().map((item) => item.id)).toEqual([session.id]);
  });
});

describe('remove', () => {
  test('deletes the key and writes no tombstone field', async () => {
    const { service, coordinator } = await makeSetup();
    await service.remove(SESSION_KEY);

    const raw = JSON.stringify(workingShard(coordinator));
    expect(raw.includes('tombstone')).toBe(false);
    expect(raw.includes(SESSION_KEY)).toBe(false);
  });
});

describe('historical edit of a terminal session', () => {
  test('preserves status, startedAtUtc, and completedAtUtc and changes updatedAtUtc', async () => {
    const terminal = emptySession('completed');
    terminal.completedAtUtc = '2026-08-01T11:00:00Z';
    const startedAt = terminal.startedAtUtc;

    const { service, coordinator } = await makeSetup([shardWith(terminal)]);
    const path = [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 1 }, { nodeId: 'pushups' }];

    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: path,
      status: 'completed',
      values: { reps: { value: 11, unit: 'reps' } }
    });

    const after = workingSession(coordinator);
    expect(after.status).toBe('completed');
    expect(after.startedAtUtc).toBe(startedAt);
    expect(after.completedAtUtc).toBe('2026-08-01T11:00:00Z');
    expect(after.updatedAtUtc).not.toBe(terminal.updatedAtUtc);
  });
});

describe('reportMissingWork', () => {
  test('lists the prescribed work the session has not recorded', async () => {
    const { service } = await makeEmptySetup();
    const report = await service.reportMissingWork(SESSION_KEY);

    expect(report.hasMissingWork).toBe(true);
    expect(report.items.length).toBeGreaterThan(0);
    for (const item of report.items) {
      expect(['no_result', 'incomplete', 'skipped']).toContain(item.reason);
      expect(item.nodeKey.startsWith(`${WORKOUT_ID}|`)).toBe(true);
    }
  });

  test('a missing unilateral set reports the alternating default row key', async () => {
    // Regression: the report hardcoded `both`, so a new unilateral row -
    // which the model puts on `alternating` - never matched a reported key,
    // and its "needs attention" badge stayed hidden. Requirement 9.10.
    const solo: Workout = {
      id: WORKOUT_ID,
      name: 'Solo Unilateral',
      publishedStatus: 'live',
      root: {
        id: 'root',
        type: 'container',
        strategy: 'sequence',
        strategyConfig: {},
        children: [
          {
            id: 'press-set',
            type: 'exercise',
            exerciseId: 'kb-press',
            stimulus: 'strength',
            prescription: { reps: 8, weight: { value: 12, unit: 'kg' } }
          }
        ]
      }
    };
    const { service } = await makeSetupWithWorkout(emptySession(), solo);
    const report = await service.reportMissingWork(SESSION_KEY);

    expect(report.hasMissingWork).toBe(true);
    expect(report.items).toHaveLength(1);
    expect(report.items[0].reason).toBe('no_result');
    expect(report.items[0].rowKey).toBe(`${WORKOUT_ID}|root/press-set|alternating|1`);
  });

  test('a missing bilateral set still reports the both default row key', async () => {
    const solo: Workout = {
      id: WORKOUT_ID,
      name: 'Solo Bilateral',
      publishedStatus: 'live',
      root: {
        id: 'root',
        type: 'container',
        strategy: 'sequence',
        strategyConfig: {},
        children: [
          {
            id: 'squat-set',
            type: 'exercise',
            exerciseId: 'back-squat',
            stimulus: 'strength',
            prescription: { reps: 5, weight: { value: 100, unit: 'lb' } }
          }
        ]
      }
    };
    const { service } = await makeSetupWithWorkout(emptySession(), solo);
    const report = await service.reportMissingWork(SESSION_KEY);

    expect(report.items).toHaveLength(1);
    expect(report.items[0].rowKey).toBe(`${WORKOUT_ID}|root/squat-set|both|1`);
  });

  test('a session with every recordable exercise completed reports nothing missing', async () => {
    const full = emptySession();
    for (const node of resolveTree(workout())) {
      if (node.node.type !== 'exercise') continue;
      // A container that records its score with no child detail forbids a child
      // result, so those occurrences are never missing work.
      if (underNoChildDetail(workout(), node.path)) continue;
      full.exerciseResults[exerciseResultKey(node.path, 'both', 1)] = {
        workoutId: WORKOUT_ID,
        executionPath: node.path,
        exerciseId: node.node.exerciseId,
        side: 'both',
        attempt: 1,
        status: 'completed',
        values: { reps: { value: 10, unit: 'reps' } }
      };
    }

    const { service } = await makeSetup([shardWith(full)]);
    const report = await service.reportMissingWork(SESSION_KEY);
    expect(report.hasMissingWork).toBe(false);
    expect(report.items).toEqual([]);
  });

  test('an incomplete result is reported as missing work', async () => {
    const { service } = await makeEmptySetup();
    const path = [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 1 }, { nodeId: 'pushups' }];
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: path,
      status: 'incomplete',
      reasonCode: 'not_completed'
    });

    const report = await service.reportMissingWork(SESSION_KEY);
    expect(report.items.some((item) => item.reason === 'incomplete')).toBe(true);
  });
});

describe('unknown session', () => {
  test('a session no shard can account for is refused', async () => {
    const { service } = await makeSetup([]);
    const kind = await kindOfRejection(() =>
      service.saveExerciseResult('session-ffff0000-0000-4000-8000-000000000009', {
        workoutId: WORKOUT_ID,
        exerciseId: 'push-up',
        executionPath: [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 1 }, { nodeId: 'pushups' }],
        status: 'completed',
        values: { reps: { value: 5, unit: 'reps' } }
      })
    );
    expect(kind).toBe('invalid_document');
  });
});

describe('queue methods', () => {
  test('a queued save lands on flush', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const path = [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 1 }, { nodeId: 'pushups' }];

    service.queueSaveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: path,
      status: 'completed',
      values: { reps: { value: 7, unit: 'reps' } }
    });
    await service.queueFlush();

    const stored = workingSession(coordinator).exerciseResults[exerciseResultKey(path, 'both', 1)];
    expect(stored?.values?.reps?.value).toBe(7);
  });

  test('a queued blank save does nothing', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const before = JSON.stringify(workingShard(coordinator));

    service.queueSaveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 1 }, { nodeId: 'pushups' }],
      status: 'completed'
    });
    await service.queueFlush();

    expect(JSON.stringify(workingShard(coordinator))).toBe(before);
  });

  test('a queued container score lands on flush', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const containerPath = [{ nodeId: 'root' }, { nodeId: 'cindy' }];

    service.queueSetContainerScore(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      executionPath: containerPath,
      status: 'completed',
      score: { type: 'rounds_and_reps', completedRounds: 4, additionalReps: 3 }
    });
    await service.queueFlush();

    expect(workingSession(coordinator).containerResults[containerResultKey(containerPath)]?.score)
      .toEqual({ type: 'rounds_and_reps', completedRounds: 4, additionalReps: 3 });
  });
});

describe('addAmrapRound keeps recorded actuals in earlier rounds', () => {
  test('a round added after a recorded round leaves that round untouched', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const containerPath = [{ nodeId: 'root' }, { nodeId: 'cindy' }];
    const round1 = [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 1 }];

    // The user recorded actuals that differ from the 10/15 prescription.
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: [...round1, { nodeId: 'pushups' }],
      status: 'completed',
      values: { reps: { value: 7, unit: 'reps' } }
    });
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'sit-up',
      executionPath: [...round1, { nodeId: 'situps' }],
      status: 'completed',
      values: { reps: { value: 12, unit: 'reps' } }
    });

    await service.addAmrapRound(SESSION_KEY, containerPath);

    const session = workingSession(coordinator);
    // Round 1 keeps what the user recorded, not the prescription. REQUIREMENT 11.1.
    expect(
      session.exerciseResults[
        exerciseResultKey([...round1, { nodeId: 'pushups' }], 'both', 1)
      ]?.values?.reps?.value
    ).toBe(7);
    expect(
      session.exerciseResults[
        exerciseResultKey([...round1, { nodeId: 'situps' }], 'both', 1)
      ]?.values?.reps?.value
    ).toBe(12);
    // Round 2 is the one round the call added.
    const round2 = [{ nodeId: 'root' }, { nodeId: 'cindy', iteration: 2 }];
    expect(
      session.exerciseResults[
        exerciseResultKey([...round2, { nodeId: 'pushups' }], 'both', 1)
      ]?.values?.reps?.value
    ).toBe(10);
    expect(
      session.exerciseResults[
        exerciseResultKey([...round2, { nodeId: 'situps' }], 'both', 1)
      ]?.values?.reps?.value
    ).toBe(15);
  });

  test('an added interval round leaves the recorded interval untouched', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const containerPath = [{ nodeId: 'root' }, { nodeId: 'emom-block' }];
    const interval1 = [{ nodeId: 'root' }, { nodeId: 'emom-block', iteration: 1 }];

    // 300 m recorded against a 250 m prescription.
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'row',
      executionPath: [...interval1, { nodeId: 'emom-row' }],
      status: 'completed',
      values: { distance: { value: 300, unit: 'm' } }
    });

    await service.addAmrapRound(SESSION_KEY, containerPath);

    const session = workingSession(coordinator);
    expect(
      session.exerciseResults[
        exerciseResultKey([...interval1, { nodeId: 'emom-row' }], 'both', 1)
      ]?.values?.distance?.value
    ).toBe(300);
    const interval2 = [{ nodeId: 'root' }, { nodeId: 'emom-block', iteration: 2 }];
    expect(
      session.exerciseResults[
        exerciseResultKey([...interval2, { nodeId: 'emom-row' }], 'both', 1)
      ]?.values?.distance?.value
    ).toBe(250);
  });
});

describe('nested repeated containers', () => {
  const OUTER = (round: number) => [{ nodeId: 'root' }, { nodeId: 'outer-ring', iteration: round }];

  test('a child under a second outer round records without a validation failure', async () => {
    const { service, coordinator } = await makeSetupWithWorkout(emptySession(), nestedWorkout());
    await coordinator.ensureLoaded(SHARD_NAME);

    const inner1 = [...OUTER(1), { nodeId: 'inner-amrap', iteration: 1 }];
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: [...inner1, { nodeId: 'ring-pushups' }],
      status: 'completed',
      values: { reps: { value: 10, unit: 'reps' } }
    });
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'sit-up',
      executionPath: [...inner1, { nodeId: 'ring-situps' }],
      status: 'completed',
      values: { reps: { value: 15, unit: 'reps' } }
    });

    // The same inner round under outer round 2. Before the fix the service pulled
    // outer round 1's children into this derivation and the write was refused.
    const inner2 = [...OUTER(2), { nodeId: 'inner-amrap', iteration: 1 }];
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: [...inner2, { nodeId: 'ring-pushups' }],
      status: 'completed',
      values: { reps: { value: 4, unit: 'reps' } }
    });

    const session = workingSession(coordinator);
    expect(
      session.exerciseResults[
        exerciseResultKey([...inner2, { nodeId: 'ring-pushups' }], 'both', 1)
      ]?.values?.reps?.value
    ).toBe(4);
  });

  test('an added inner round under an outer round starts at that round, not a sibling', async () => {
    const { service, coordinator } = await makeSetupWithWorkout(emptySession(), nestedWorkout());
    await coordinator.ensureLoaded(SHARD_NAME);

    // Three inner rounds recorded under outer round 1.
    for (let inner = 1; inner <= 3; inner += 1) {
      await service.saveExerciseResult(SESSION_KEY, {
        workoutId: WORKOUT_ID,
        exerciseId: 'push-up',
        executionPath: [
          ...OUTER(1),
          { nodeId: 'inner-amrap', iteration: inner },
          { nodeId: 'ring-pushups' }
        ],
        status: 'completed',
        values: { reps: { value: 10, unit: 'reps' } }
      });
    }

    await service.addAmrapRound(SESSION_KEY, [...OUTER(2), { nodeId: 'inner-amrap' }]);

    const session = workingSession(coordinator);
    const outer2 = Object.keys(session.exerciseResults)
      .filter((key) => key.startsWith('root/outer-ring:2/inner-amrap:'))
      .sort();
    // Outer round 2 had no inner round, so the added round is inner round 1, and
    // it carries both direct children of the inner AMRAP. Before the fix the
    // call read the highest inner round from outer round 1 and created inner
    // round 4 instead.
    expect(outer2).toEqual([
      'root/outer-ring:2/inner-amrap:1/ring-pushups|both|1',
      'root/outer-ring:2/inner-amrap:1/ring-situps|both|1'
    ]);
  });
});

describe('terminal fields stay put across complete and abandon', () => {
  test('complete on a completed session preserves completedAtUtc and writes nothing', async () => {
    const done = emptySession('completed');
    done.completedAtUtc = '2026-08-01T11:00:00Z';
    const before = JSON.stringify(done);

    const { service, coordinator } = await makeSetup([shardWith(done)]);
    await service.complete(SESSION_KEY);

    const after = workingSession(coordinator);
    expect(after.completedAtUtc).toBe('2026-08-01T11:00:00Z');
    expect(JSON.stringify(after)).toBe(before);
  });

  test('setTerminalStatus reclassifies an abandoned session without moving workout timestamps', async () => {
    const left = emptySession('abandoned');
    left.startedAtUtc = '2026-08-01T10:00:00Z';
    left.completedAtUtc = '2026-08-01T11:00:00Z';
    const { service, coordinator } = await makeSetup([shardWith(left)]);

    await service.setTerminalStatus(SESSION_KEY, 'completed');

    const after = workingSession(coordinator);
    expect(after.status).toBe('completed');
    expect(after.startedAtUtc).toBe('2026-08-01T10:00:00Z');
    expect(after.completedAtUtc).toBe('2026-08-01T11:00:00Z');
  });

  test('setTerminalStatus reclassifies a completed session without moving workout timestamps', async () => {
    const done = emptySession('completed');
    done.startedAtUtc = '2026-08-01T10:00:00Z';
    done.completedAtUtc = '2026-08-01T11:00:00Z';
    const { service, coordinator } = await makeSetup([shardWith(done)]);

    await service.setTerminalStatus(SESSION_KEY, 'abandoned');

    const after = workingSession(coordinator);
    expect(after.status).toBe('abandoned');
    expect(after.startedAtUtc).toBe('2026-08-01T10:00:00Z');
    expect(after.completedAtUtc).toBe('2026-08-01T11:00:00Z');
  });

  test('setTerminalStatus refuses an in-progress session', async () => {
    const { service, coordinator } = await makeEmptySetup();

    const kind = await kindOfRejection(() => service.setTerminalStatus(SESSION_KEY, 'completed'));

    expect(kind).toBe('invalid_document');
    expect(workingSession(coordinator).status).toBe('in_progress');
    expect(workingSession(coordinator).completedAtUtc).toBeUndefined();
  });

  test('the first complete fixes completedAtUtc and a second complete cannot move it', async () => {
    const { service, coordinator } = await makeEmptySetup();
    await service.complete(SESSION_KEY);
    const first = workingSession(coordinator).completedAtUtc;
    expect(typeof first).toBe('string');

    await service.complete(SESSION_KEY);
    expect(workingSession(coordinator).completedAtUtc).toBe(first);
  });
});

describe('remove against a shard that was never loaded', () => {
  test('the delete lands on Drive without a prior load', async () => {
    const other = 'session-ffff0000-0000-4000-8000-0000000000aa';
    const shard: ResultsShard = {
      format: 'repjot/results',
      schemaVersion: 1,
      yearMonthUtc: '2026-08',
      sessions: { [SESSION_KEY]: emptySession(), [other]: emptySession('in_progress', other) }
    };
    const { service, drive, coordinator } = await makeSetupUnloaded([shard]);

    await service.remove(SESSION_KEY);
    await coordinator.syncAll();

    const stored = shardOnDrive(drive, SHARD_NAME);
    expect(stored?.sessions[SESSION_KEY]).toBeUndefined();
    expect(stored?.sessions[other]).toBeDefined();
  });

  test('a remove of a session the shard does not hold is refused', async () => {
    const { service } = await makeSetupUnloaded([]);
    const kind = await kindOfRejection(() => service.remove(SESSION_KEY));
    expect(kind).toBe('invalid_document');
  });
});

describe('clearing the last child keeps the container result', () => {
  test('a container result survives the clear of its only child', async () => {
    const { service, coordinator } = await makeEmptySetup();
    const containerPath = [{ nodeId: 'root' }, { nodeId: 'cindy' }];
    const key = containerResultKey(containerPath);
    const childPath = [...containerPath, { nodeId: 'pushups' }];

    await service.setContainerScore(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      executionPath: containerPath,
      status: 'completed',
      score: { type: 'rounds_and_reps', completedRounds: 5, additionalReps: 0 }
    });
    await service.saveExerciseResult(SESSION_KEY, {
      workoutId: WORKOUT_ID,
      exerciseId: 'push-up',
      executionPath: childPath,
      status: 'completed',
      values: { reps: { value: 10, unit: 'reps' } }
    });
    await service.clearExerciseResult(SESSION_KEY, exerciseResultKey(childPath, 'both', 1));

    // The aggregate stays. The service cannot tell a derived result from a
    // hand-typed one, so it deletes neither. REQUIREMENT 10.13.
    expect(workingSession(coordinator).containerResults[key]).toBeDefined();
    expect(workingSession(coordinator).containerResults[key]?.status).toBe('completed');
  });
});
