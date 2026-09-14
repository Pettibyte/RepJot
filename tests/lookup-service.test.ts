// Phase 12 lookup service tests.

import { describe, expect, test } from 'bun:test';
import { createLookupService } from '../src/indexes/lookup-service';
import type { ExerciseResult, ResultsShard, Session } from '../src/domain/types';
import { exerciseResultKey } from '../src/domain/execution-path';
import { loadedStaticData } from './fixtures/sync';

/** One result under `root/squat-sets/<round>/back-squat-set`. */
function squatResult(round: number, reps: number): [string, ExerciseResult] {
  const path = [
    { nodeId: 'root' },
    { nodeId: 'squat-sets', iteration: round },
    { nodeId: 'back-squat-set' }
  ];
  const result: ExerciseResult = {
    workoutId: 'demo',
    executionPath: path,
    exerciseId: 'back-squat',
    side: 'both',
    attempt: 1,
    status: 'completed',
    values: { reps: { value: reps, unit: 'reps' } }
  };
  return [exerciseResultKey(path, 'both', 1), result];
}

/** One session with one back-squat result. */
function session(
  id: string,
  status: Session['status'],
  startedAtUtc: string,
  updatedAtUtc: string,
  reps = 5
): Session {
  const [key, result] = squatResult(1, reps);
  const value: Session = {
    id,
    workoutId: 'demo',
    status,
    startedAtUtc,
    updatedAtUtc,
    exerciseResults: { [key]: result },
    containerResults: {}
  };
  if (status !== 'in_progress') value.completedAtUtc = updatedAtUtc;
  return value;
}

function shard(yearMonthUtc: string, sessions: Session[]): ResultsShard {
  const map: Record<string, Session> = {};
  for (const value of sessions) map[value.id] = value;
  return { format: 'repjot/results', schemaVersion: 1, yearMonthUtc, sessions: map };
}

describe('lookupService: getLastTime', () => {
  test('returns the newest completed occurrence and ignores a newer in_progress one', () => {
    const lookup = createLookupService({
      staticData: loadedStaticData(),
      shards: [
        shard('2026-08', [session('session-old', 'completed', '2026-08-01T08:00:00Z', '2026-08-01T09:00:00Z', 95)]),
        shard('2026-09', [session('session-live', 'in_progress', '2026-09-01T08:00:00Z', '2026-09-01T08:30:00Z', 105)])
      ]
    });

    const last = lookup.getLastTime('back-squat');

    expect(last).not.toBeNull();
    expect(last?.sessionId).toBe('session-old');
    expect(last?.values?.reps?.value).toBe(95);
  });

  test('returns null for an exercise with no completed result', () => {
    const lookup = createLookupService({
      staticData: loadedStaticData(),
      shards: [shard('2026-09', [session('session-live', 'in_progress', '2026-09-01T08:00:00Z', '2026-09-01T08:30:00Z')])]
    });

    expect(lookup.getLastTime('back-squat')).toBeNull();
    expect(lookup.getLastTime('never-done-exercise')).toBeNull();
  });

  test('skips a skipped result and returns the older completed one', () => {
    const skippedSession = session('session-skip', 'completed', '2026-09-02T08:00:00Z', '2026-09-02T09:00:00Z');
    const [key, result] = squatResult(1, 0);
    skippedSession.exerciseResults = {
      [key]: { ...result, status: 'skipped', reasonCode: 'equipment_unavailable', values: undefined }
    };

    const lookup = createLookupService({
      staticData: loadedStaticData(),
      shards: [
        shard('2026-08', [session('session-done', 'completed', '2026-08-01T08:00:00Z', '2026-08-01T09:00:00Z', 80)]),
        shard('2026-09', [skippedSession])
      ]
    });

    expect(lookup.getLastTime('back-squat')?.sessionId).toBe('session-done');
  });

  test('an abandoned session still supplies Last Time', () => {
    const lookup = createLookupService({
      staticData: loadedStaticData(),
      shards: [
        shard('2026-08', [session('session-aband', 'abandoned', '2026-08-01T08:00:00Z', '2026-08-01T08:20:00Z', 60)])
      ]
    });

    expect(lookup.getLastTime('back-squat')?.sessionId).toBe('session-aband');
  });
});

describe('lookupService: paging', () => {
  /** Twelve completed sessions, one per day, newest 2026-08-12. */
  function twelveSessions(): Session[] {
    const list: Session[] = [];
    for (let i = 1; i <= 12; i += 1) {
      const day = String(i).padStart(2, '0');
      list.push(
        session(`session-p${String(i).padStart(2, '0')}`, 'completed', `2026-08-${day}T08:00:00Z`, `2026-08-${day}T09:00:00Z`, i)
      );
    }
    return list;
  }

  test('getExerciseHistory pages newest first with no gap and no duplicate', () => {
    const lookup = createLookupService({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', twelveSessions())]
    });

    const seen: string[] = [];
    let offset = 0;
    let guard = 0;
    for (;;) {
      const page = lookup.getExerciseHistory('back-squat', { offset, limit: 5 });
      seen.push(...page.items.map((item) => item.sessionId));
      if (!page.hasMore) break;
      offset += 5;
      guard += 1;
      if (guard > 20) throw new Error('paging did not terminate');
    }

    expect(seen.length).toBe(12);
    expect(new Set(seen).size).toBe(12);
    expect(seen[0]).toBe('session-p12');
    expect(seen[11]).toBe('session-p01');
  });

  test('getWorkoutHistory pages newest first and reports the total', () => {
    const lookup = createLookupService({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', twelveSessions())]
    });

    const page = lookup.getWorkoutHistory('demo', { offset: 0, limit: 5 });
    expect(page.items.length).toBe(5);
    expect(page.total).toBe(12);
    expect(page.hasMore).toBe(true);

    const tail = lookup.getWorkoutHistory('demo', { offset: 10, limit: 5 });
    expect(tail.items.map((s) => s.id)).toEqual(['session-p02', 'session-p01']);
    expect(tail.hasMore).toBe(false);
  });

  test('an empty page past the end returns no items and no overflow', () => {
    const lookup = createLookupService({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', twelveSessions())]
    });

    const page = lookup.getExerciseHistory('back-squat', { offset: 99, limit: 5 });
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  test('an unknown workout or exercise pages as empty', () => {
    const lookup = createLookupService({ staticData: loadedStaticData(), shards: [] });
    expect(lookup.getWorkoutHistory('nope', { offset: 0, limit: 5 }).total).toBe(0);
    expect(lookup.getExerciseHistory('nope', { offset: 0, limit: 5 }).items).toEqual([]);
  });
});

describe('lookupService: extendHistory', () => {
  test('adds older entries and keeps the ordering invariant', () => {
    const lookup = createLookupService({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', [session('session-aug', 'completed', '2026-08-15T08:00:00Z', '2026-08-15T09:00:00Z', 90)])]
    });

    expect(lookup.getExerciseHistory('back-squat', { offset: 0, limit: 10 }).total).toBe(1);

    lookup.extendHistory([
      shard('2026-06', [session('session-jun', 'completed', '2026-06-15T08:00:00Z', '2026-06-15T09:00:00Z', 70)]),
      shard('2026-07', [session('session-jul', 'completed', '2026-07-15T08:00:00Z', '2026-07-15T09:00:00Z', 80)])
    ]);

    const page = lookup.getExerciseHistory('back-squat', { offset: 0, limit: 10 });
    expect(page.total).toBe(3);
    expect(page.items.map((o) => o.sessionId)).toEqual([
      'session-aug',
      'session-jul',
      'session-jun'
    ]);
  });

  test('extendHistory keeps recent lists capped and newest-first', () => {
    const lookup = createLookupService({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', [session('session-aug', 'completed', '2026-08-15T08:00:00Z', '2026-08-15T09:00:00Z')])],
      recentLimit: 2
    });

    const older: Session[] = [];
    for (let i = 1; i <= 5; i += 1) {
      const day = String(i).padStart(2, '0');
      older.push(session(`session-old${i}`, 'completed', `2026-05-${day}T08:00:00Z`, `2026-05-${day}T09:00:00Z`, i));
    }
    lookup.extendHistory([shard('2026-05', older)]);

    const capped = lookup.index.recentByExerciseId.get('back-squat') ?? [];
    expect(capped.length).toBe(2);
    expect(capped.map((o) => o.sessionId)).toEqual(['session-aug', 'session-old5']);
    // The full list still holds everything, so `Load older` reaches past the cap.
    expect(lookup.getExerciseHistory('back-squat', { offset: 0, limit: 50 }).total).toBe(6);
  });

  test('extendHistory does not duplicate a shard merged twice', () => {
    const one = shard('2026-07', [session('session-x', 'completed', '2026-07-01T08:00:00Z', '2026-07-01T09:00:00Z')]);
    const lookup = createLookupService({ staticData: loadedStaticData(), shards: [one] });

    lookup.extendHistory([one]);

    expect(lookup.getExerciseHistory('back-squat', { offset: 0, limit: 10 }).total).toBe(1);
  });

  test('extendHistory moves a session out of the active list when it completes', () => {
    const live = session('session-live', 'in_progress', '2026-09-01T08:00:00Z', '2026-09-01T08:30:00Z');
    const lookup = createLookupService({ staticData: loadedStaticData(), shards: [shard('2026-09', [live])] });
    expect(lookup.listActiveSessions().map((s) => s.id)).toEqual(['session-live']);

    const finished = { ...live, status: 'completed' as const, completedAtUtc: '2026-09-01T09:00:00Z', updatedAtUtc: '2026-09-01T09:00:00Z' };
    lookup.extendHistory([shard('2026-09', [finished])]);

    expect(lookup.listActiveSessions()).toEqual([]);
    expect(lookup.listRecentSessions().map((s) => s.id)).toEqual(['session-live']);
  });
});

describe('lookupService: session lists', () => {
  const shards = [
    shard('2026-08', [
      session('session-c1', 'completed', '2026-08-01T08:00:00Z', '2026-08-01T09:00:00Z'),
      session('session-a1', 'abandoned', '2026-08-03T08:00:00Z', '2026-08-03T08:10:00Z')
    ]),
    shard('2026-09', [
      session('session-i1', 'in_progress', '2026-09-01T08:00:00Z', '2026-09-01T08:30:00Z'),
      session('session-i2', 'in_progress', '2026-09-02T08:00:00Z', '2026-09-05T08:00:00Z')
    ])
  ];

  test('listActiveSessions returns in_progress only, updatedAtUtc newest first', () => {
    const lookup = createLookupService({ staticData: loadedStaticData(), shards });
    expect(lookup.listActiveSessions().map((s) => s.id)).toEqual(['session-i2', 'session-i1']);
  });

  test('listRecentSessions caps at five and excludes in_progress', () => {
    const many: Session[] = [];
    for (let i = 1; i <= 8; i += 1) {
      const day = String(i).padStart(2, '0');
      many.push(session(`session-m${i}`, 'completed', `2026-08-${day}T08:00:00Z`, `2026-08-${day}T09:00:00Z`));
    }
    many.push(session('session-live', 'in_progress', '2026-08-20T08:00:00Z', '2026-08-28T09:00:00Z'));

    const lookup = createLookupService({ staticData: loadedStaticData(), shards: [shard('2026-08', many)] });
    const recent = lookup.listRecentSessions();

    expect(recent.length).toBe(5);
    expect(recent.some((s) => s.status === 'in_progress')).toBe(false);
    expect(recent[0]?.id).toBe('session-m8');
  });

  test('listRecentSessions honours a smaller limit', () => {
    const lookup = createLookupService({ staticData: loadedStaticData(), shards });
    expect(lookup.listRecentSessions(1).map((s) => s.id)).toEqual(['session-a1']);
    expect(lookup.listRecentSessions(0)).toEqual([]);
  });
});

describe('lookupService: static lookups and unresolved', () => {
  test('getWorkout, getExercise, and getNode read the static maps', () => {
    const lookup = createLookupService({ staticData: loadedStaticData(), shards: [] });

    expect(lookup.getWorkout('demo')?.name).toBe('Demo Workout');
    expect(lookup.getExercise('back-squat')?.name).toBe('Back Squat');
    expect(lookup.getNode('demo', 'back-squat-set')?.level).toBe(3);
    expect(lookup.getNode('demo', 'missing')).toBeUndefined();
  });

  test('unresolved entries appear from getUnresolved and sort by encoded path', () => {
    const lookup = createLookupService({
      staticData: loadedStaticData(),
      shards: [],
      unresolved: [
        {
          kind: 'result',
          reason: 'broken_path',
          sessionKey: 'session-z',
          resultKey: 'root/z|both|1',
          workoutId: 'demo',
          exerciseId: 'back-squat',
          encodedPath: 'root/z'
        },
        {
          kind: 'result',
          reason: 'unknown_exercise',
          sessionKey: 'session-a',
          resultKey: 'root/a|both|1',
          workoutId: 'demo',
          exerciseId: 'gone',
          encodedPath: 'root/a'
        },
        {
          kind: 'preference',
          reason: 'unit_incompatible',
          exerciseId: 'back-squat',
          dimension: 'weight',
          unit: 'st'
        }
      ]
    });

    const unresolved = lookup.getUnresolved();
    expect(unresolved.length).toBe(3);
    // `preference` sorts before `result`, and results sort by encoded path.
    expect(unresolved.map((u) => u.kind)).toEqual(['preference', 'result', 'result']);
    expect(unresolved[1]?.kind === 'result' && unresolved[1].encodedPath).toBe('root/a');
    expect(unresolved[2]?.kind === 'result' && unresolved[2].encodedPath).toBe('root/z');
  });

  test('extendUnresolved appends and keeps the order', () => {
    const lookup = createLookupService({
      staticData: loadedStaticData(),
      shards: [],
      unresolved: [
        {
          kind: 'result',
          reason: 'broken_path',
          sessionKey: 'session-m',
          resultKey: 'root/m|both|1',
          workoutId: 'demo',
          exerciseId: 'back-squat',
          encodedPath: 'root/m'
        }
      ]
    });

    lookup.extendUnresolved([
      {
        kind: 'result',
        reason: 'unknown_workout',
        sessionKey: 'session-b',
        resultKey: 'root/b|both|1',
        workoutId: 'gone',
        exerciseId: 'back-squat',
        encodedPath: 'root/b'
      }
    ]);

    expect(lookup.getUnresolved().map((u) => (u.kind === 'result' ? u.encodedPath : u.kind))).toEqual([
      'root/b',
      'root/m'
    ]);
  });
});

describe('lookupService: container occurrences', () => {
  test('container results index separately from exercise results', () => {
    const value = session('session-c', 'completed', '2026-08-01T08:00:00Z', '2026-08-01T09:00:00Z');
    value.containerResults = {
      'root/cindy|1': {
        workoutId: 'demo',
        executionPath: [{ nodeId: 'root' }, { nodeId: 'cindy' }],
        attempt: 1,
        status: 'completed',
        score: { type: 'rounds_and_reps', completedRounds: 7, additionalReps: 3 }
      }
    };

    const lookup = createLookupService({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', [value])]
    });

    const rows = lookup.getContainerOccurrences('session-c');
    expect(rows.length).toBe(1);
    expect(rows[0]?.containerNodeId).toBe('cindy');
    expect(rows[0]?.score?.type).toBe('rounds_and_reps');
    // The exercise row is untouched by the container row.
    expect(lookup.getExerciseHistory('back-squat', { offset: 0, limit: 5 }).total).toBe(1);
  });
});
