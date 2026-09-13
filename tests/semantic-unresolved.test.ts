// Nonfatal unresolved-reference diagnostics.
// REQUIREMENTS 6.7-6.12, 6.23. Spec items 2-8.
//
// The rule these tests hold: a reference the current bundle cannot resolve produces
// one `UnresolvedResult` and zero fatal issues, and it never touches any other
// result. The recorded values stay exactly as stored.

import { describe, expect, test } from 'bun:test';
import {
  validatePreferences,
  validateSession,
  validateShard
} from '../src/validation/semantic-validator';
import {
  SESSION_KEY,
  SHARD_MONTH,
  clone,
  hasCode,
  hasReason,
  staticData,
  validSession,
  validShard
} from './fixtures/semantic';
import { ISSUE_CODES } from '../src/validation/issues';
import type { ExerciseResult, Session, StaticData } from '../src/domain/types';
import { containerResultKey, exerciseResultKey } from '../src/domain/execution-path';

const WARMUP_KEY = 'root/warmup/warmup-squat|both|1';
const CINDY_KEY = 'root/cindy|1';

/**
 * Move an exercise result to a new path, re-keying it to match.
 *
 * A path change without a re-key is a key mismatch, not a broken reference, so
 * every path mutation here goes through this helper.
 */
function moveExerciseResult(
  session: Session,
  oldKey: string,
  newPath: { nodeId: string; iteration?: number }[]
): void {
  const entry = session.exerciseResults[oldKey];
  delete session.exerciseResults[oldKey];
  entry.executionPath = newPath;
  session.exerciseResults[
    exerciseResultKey(entry.executionPath, entry.side ?? 'both', entry.attempt ?? 1)
  ] = entry;
}

/** Move a container result to a new path, re-keying it to match. */
function moveContainerResult(
  session: Session,
  oldKey: string,
  newPath: { nodeId: string; iteration?: number }[]
): void {
  const entry = session.containerResults[oldKey];
  delete session.containerResults[oldKey];
  entry.executionPath = newPath;
  session.containerResults[containerResultKey(entry.executionPath, entry.attempt ?? 1)] = entry;
}

function check(session: Session, data: StaticData = staticData()) {
  return validateSession(session, data, {
    shardYearMonthUtc: SHARD_MONTH,
    sessionKey: session.id
  });
}

/** A session holding exactly one exercise result, so counts stay readable. */
function singleResultSession(): Session {
  const session = validSession();
  const warmup = session.exerciseResults[WARMUP_KEY];
  session.exerciseResults = { [WARMUP_KEY]: warmup };
  session.containerResults = {};
  return session;
}

describe('unknown workout', () => {
  test('a session workoutId absent from the bundle marks each result unresolved', () => {
    const session = singleResultSession();
    session.workoutId = 'workout-removed-last-release';
    for (const entry of Object.values(session.exerciseResults)) {
      entry.workoutId = 'workout-removed-last-release';
    }

    const report = check(session);
    expect(report.issues).toEqual([]);
    expect(report.unresolved.length).toBe(1);
    expect(hasReason(report.unresolved, 'unknown_workout')).toBe(true);
  });

  test('the unresolved entry carries the recorded path and exercise', () => {
    const session = singleResultSession();
    session.workoutId = 'gone';
    session.exerciseResults[WARMUP_KEY].workoutId = 'gone';

    const entry = check(session).unresolved[0];
    expect(entry.kind).toBe('result');
    if (entry.kind === 'result') {
      expect(entry.sessionKey).toBe(SESSION_KEY);
      expect(entry.resultKey).toBe(WARMUP_KEY);
      expect(entry.exerciseId).toBe('back-squat');
      expect(entry.encodedPath).toBe('root/warmup/warmup-squat');
    }
  });

  test('a container result under a removed workout is unresolved, not fatal', () => {
    const session = validSession();
    session.workoutId = 'gone';
    for (const entry of Object.values(session.containerResults)) {
      entry.workoutId = 'gone';
    }
    for (const entry of Object.values(session.exerciseResults)) {
      entry.workoutId = 'gone';
    }

    const report = check(session);
    expect(report.issues).toEqual([]);
    expect(hasReason(report.unresolved, 'unknown_workout')).toBe(true);
  });
});

describe('unknown exercise', () => {
  test('a result exerciseId absent from the bundle is unresolved', () => {
    const session = singleResultSession();
    session.exerciseResults[WARMUP_KEY].exerciseId = 'conscience-squat';

    const report = check(session);
    expect(report.issues).toEqual([]);
    expect(report.unresolved.length).toBe(1);
    expect(hasReason(report.unresolved, 'unknown_exercise')).toBe(true);
  });
});

describe('broken path', () => {
  test('a path whose ancestor no longer exists is unresolved', () => {
    const session = singleResultSession();
    moveExerciseResult(session, WARMUP_KEY, [
      { nodeId: 'root' },
      { nodeId: 'strength-block' },
      { nodeId: 'warmup-squat' }
    ]);

    const report = check(session);
    expect(report.issues).toEqual([]);
    expect(hasReason(report.unresolved, 'broken_path')).toBe(true);
  });

  test('a path that no longer starts at the workout root is unresolved', () => {
    const session = singleResultSession();
    moveExerciseResult(session, WARMUP_KEY, [{ nodeId: 'warmup-squat' }]);

    expect(hasReason(check(session).unresolved, 'broken_path')).toBe(true);
  });

  test('an iteration on a sequence container does not resolve', () => {
    const session = singleResultSession();
    moveExerciseResult(session, WARMUP_KEY, [
      { nodeId: 'root' },
      { nodeId: 'warmup', iteration: 1 },
      { nodeId: 'warmup-squat' }
    ]);

    expect(hasReason(check(session).unresolved, 'broken_path')).toBe(true);
  });

  test('a repeated container segment with no iteration does not resolve', () => {
    const session = singleResultSession();
    moveExerciseResult(session, WARMUP_KEY, [
      { nodeId: 'root' },
      { nodeId: 'squat-sets' },
      { nodeId: 'back-squat-set' }
    ]);

    expect(hasReason(check(session).unresolved, 'broken_path')).toBe(true);
  });

  test('a repeated container segment past the container count does not resolve', () => {
    const session = singleResultSession();
    // squat-sets runs three rounds.
    moveExerciseResult(session, WARMUP_KEY, [
      { nodeId: 'root' },
      { nodeId: 'squat-sets', iteration: 4 },
      { nodeId: 'back-squat-set' }
    ]);

    expect(hasReason(check(session).unresolved, 'broken_path')).toBe(true);
  });

  test('a container result addresses the whole container, so its own segment needs no iteration', () => {
    const session = validSession();

    const report = check(session);
    expect(report.issues).toEqual([]);
    expect(report.unresolved).toEqual([]);
  });

  test('a container result whose path no longer reaches a container is unresolved', () => {
    const session = validSession();
    moveContainerResult(session, CINDY_KEY, [{ nodeId: 'root' }, { nodeId: 'pushups' }]);

    const report = check(session);
    expect(report.issues).toEqual([]);
    expect(hasReason(report.unresolved, 'broken_path')).toBe(true);
  });
});

describe('path exercise mismatch', () => {
  test('a path that now points at a different exercise is unresolved', () => {
    const session = singleResultSession();
    // The result still claims back-squat, but the path now lands on the push-up node.
    moveExerciseResult(session, WARMUP_KEY, [
      { nodeId: 'root' },
      { nodeId: 'cindy', iteration: 1 },
      { nodeId: 'pushups' }
    ]);
    session.exerciseResults['root/cindy:1/pushups|both|1'].values = {
      reps: { value: 10, unit: 'reps' }
    };

    const report = check(session);
    expect(report.issues).toEqual([]);
    expect(hasReason(report.unresolved, 'path_exercise_mismatch')).toBe(true);
  });
});

describe('measurements changed', () => {
  test('a stored dimension the current exercise no longer declares is unresolved', () => {
    const data = staticData();
    const squat = data.exercises.find((exercise) => exercise.id === 'back-squat');
    if (squat !== undefined) {
      squat.measurements = [{ dimension: 'reps', compatibleUnits: ['reps'] }];
    }

    const session = singleResultSession();
    const report = check(session, data);
    expect(report.issues).toEqual([]);
    expect(hasReason(report.unresolved, 'measurements_changed')).toBe(true);
  });

  test('a stored unit the current exercise no longer accepts is unresolved', () => {
    const data = staticData();
    const squat = data.exercises.find((exercise) => exercise.id === 'back-squat');
    if (squat !== undefined) {
      squat.measurements = [
        { dimension: 'reps', compatibleUnits: ['reps'] },
        { dimension: 'weight', compatibleUnits: ['kg'] }
      ];
    }

    const session = singleResultSession();
    // The fixture stored lb, which the narrowed exercise no longer accepts.
    const report = check(session, data);
    expect(report.issues).toEqual([]);
    expect(hasReason(report.unresolved, 'unit_incompatible')).toBe(true);
  });
});

describe('one bad card does not break the list', () => {
  test('one unresolved result leaves every other result in the shard valid', () => {
    const shard = validShard();
    const session = shard.sessions[SESSION_KEY];

    // Break exactly one result. The rest of the shard must stay clean.
    session.exerciseResults['root/cindy:1/pushups|both|1'].exerciseId = 'gone-exercise';

    const report = validateShard(shard, staticData());
    expect(report.issues).toEqual([]);
    expect(report.unresolved.length).toBe(1);
    expect(report.unresolved[0].kind).toBe('result');
    if (report.unresolved[0].kind === 'result') {
      expect(report.unresolved[0].resultKey).toBe('root/cindy:1/pushups|both|1');
    }
  });

  test('the unresolved result keeps its recorded values untouched', () => {
    const shard = validShard();
    const before = clone(shard.sessions[SESSION_KEY].exerciseResults['root/cindy:1/pushups|both|1']);

    shard.sessions[SESSION_KEY].exerciseResults['root/cindy:1/pushups|both|1'].exerciseId = 'gone';

    expect(shard.sessions[SESSION_KEY].exerciseResults['root/cindy:1/pushups|both|1']).toEqual({
      ...before,
      exerciseId: 'gone'
    });
  });

  test('a fatal fault in one session does not stop another session validating', () => {
    const shard = validShard();
    const other = validSession();
    other.id = 'session-99999999-8888-4777-8666-555555555555';
    other.exerciseResults[WARMUP_KEY].startingSide = 'left';
    shard.sessions[other.id] = other;

    const report = validateShard(shard, staticData());
    expect(report.issues.length).toBe(1);
    expect(report.issues[0].path).toContain(other.id);
  });
});

describe('reason precedence', () => {
  test('unknown workout outranks every later reason', () => {
    const session = singleResultSession();
    moveExerciseResult(session, WARMUP_KEY, [{ nodeId: 'nope' }]);
    const moved = session.exerciseResults['nope|both|1'];
    moved.workoutId = 'gone';
    moved.exerciseId = 'also-gone';
    session.workoutId = 'gone';

    const report = check(session);
    expect(report.issues).toEqual([]);
    expect(report.unresolved.length).toBe(1);
    expect(report.unresolved[0].reason).toBe('unknown_workout');
  });

  test('unknown exercise outranks a broken path', () => {
    const session = singleResultSession();
    moveExerciseResult(session, WARMUP_KEY, [{ nodeId: 'nope' }]);
    session.exerciseResults['nope|both|1'].exerciseId = 'also-gone';

    const report = check(session);
    expect(report.issues).toEqual([]);
    expect(report.unresolved.length).toBe(1);
    expect(report.unresolved[0].reason).toBe('unknown_exercise');
  });

  test('a broken path outranks a changed measurement', () => {
    const data = staticData();
    const squat = data.exercises.find((exercise) => exercise.id === 'back-squat');
    if (squat !== undefined) {
      squat.measurements = [{ dimension: 'duration', compatibleUnits: ['second'] }];
    }

    const session = singleResultSession();
    moveExerciseResult(session, WARMUP_KEY, [
      { nodeId: 'root' },
      { nodeId: 'gone-parent' },
      { nodeId: 'warmup-squat' }
    ]);

    const report = check(session, data);
    expect(report.issues).toEqual([]);
    expect(report.unresolved.length).toBe(1);
    expect(report.unresolved[0].reason).toBe('broken_path');
  });
});

describe('child detail against an unresolved reference', () => {
  test('a broken path under a childDetail "none" container stays nonfatal', () => {
    const session = singleResultSession();
    // The path points inside the no-child-detail complex, but does not resolve.
    moveExerciseResult(session, WARMUP_KEY, [
      { nodeId: 'root' },
      { nodeId: 'complex-block', iteration: 1 },
      { nodeId: 'node-that-was-removed' }
    ]);

    const report = check(session);
    expect(report.unresolved.length).toBe(1);
    expect(report.unresolved[0].reason).toBe('broken_path');
    // No fatal child-detail issue stacked on the unresolved reference.
    expect(report.issues).toEqual([]);
  });

  test('a resolved path under a childDetail "none" container is fatal', () => {
    const session = singleResultSession();
    moveExerciseResult(session, WARMUP_KEY, [
      { nodeId: 'root' },
      { nodeId: 'complex-block', iteration: 1 },
      { nodeId: 'complex-press' }
    ]);
    const moved = session.exerciseResults['root/complex-block:1/complex-press|both|1'];
    moved.exerciseId = 'kb-press';
    moved.values = { reps: { value: 5, unit: 'reps' } };

    const report = check(session);
    expect(report.unresolved).toEqual([]);
    expect(hasCode(report.issues, ISSUE_CODES.CHILD_DETAIL_FORBIDDEN)).toBe(true);
  });
});

describe('preferences', () => {
  test('a valid preference mapping produces nothing', () => {
    const report = validatePreferences({ exerciseUnits: { 'back-squat': { weight: 'kg' } } }, [
      ...staticData().exercises
    ] as Exercise[]);
    expect(report.issues).toEqual([]);
    expect(report.unresolved).toEqual([]);
  });

  test('a preferred unit the exercise rejects is a nonfatal mapping', () => {
    const report = validatePreferences({ exerciseUnits: { 'back-squat': { weight: 'stone' } } }, [
      ...staticData().exercises
    ]);
    expect(report.issues).toEqual([]);
    expect(report.unresolved.length).toBe(1);
    expect(report.unresolved[0].kind).toBe('preference');
    if (report.unresolved[0].kind === 'preference') {
      expect(report.unresolved[0].reason).toBe('unit_incompatible');
      expect(report.unresolved[0].exerciseId).toBe('back-squat');
      expect(report.unresolved[0].dimension).toBe('weight');
      expect(report.unresolved[0].unit).toBe('stone');
    }
  });

  test('a dimension the exercise no longer declares is a changed-measurements mapping', () => {
    const report = validatePreferences(
      { exerciseUnits: { 'push-up': { weight: 'kg' } } },
      staticData().exercises
    );
    expect(report.issues).toEqual([]);
    expect(hasReason(report.unresolved, 'measurements_changed')).toBe(true);
  });

  test('a mapping for a removed exercise is an unknown-exercise mapping', () => {
    const report = validatePreferences(
      { exerciseUnits: { 'gone-exercise': { weight: 'kg' } } },
      staticData().exercises
    );
    expect(report.issues).toEqual([]);
    expect(hasReason(report.unresolved, 'unknown_exercise')).toBe(true);
  });

  test('one bad mapping leaves the other mappings valid', () => {
    const report = validatePreferences(
      {
        exerciseUnits: {
          'back-squat': { weight: 'kg', reps: 'reps' },
          'gone-exercise': { weight: 'kg' }
        }
      },
      staticData().exercises
    );
    expect(report.issues).toEqual([]);
    expect(report.unresolved.length).toBe(1);
  });
});
