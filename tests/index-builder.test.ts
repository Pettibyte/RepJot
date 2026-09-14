// Phase 12 index builder tests.
//
// The fixtures build small shards by hand so each test names exactly the shape it
// checks. `loadedStaticData()` comes from the Phase 10 sync fixture, which wraps
// the Phase 04 semantic fixture workout: `demo` with `root > squat-sets (rounds
// 3) > back-squat-set`.

import { describe, expect, test } from 'bun:test';
import { buildIndex } from '../src/indexes/index-builder';
import type { ExerciseOccurrence, SessionSummary } from '../src/indexes/types';
import type { ExerciseResult, ResultsShard, Session } from '../src/domain/types';
import { exerciseResultKey } from '../src/domain/execution-path';
import { loadedStaticData } from './fixtures/sync';

/** One exercise result under `root/squat-sets/<round>/back-squat-set`. */
function squatResult(
  round: number,
  reps: number,
  overrides: Partial<ExerciseResult> = {}
): [string, ExerciseResult] {
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
    values: { reps: { value: reps, unit: 'reps' } },
    ...overrides
  };
  return [exerciseResultKey(path, 'both', 1), result];
}

/** One session with one squat result and no container results. */
function session(
  id: string,
  status: Session['status'],
  startedAtUtc: string,
  updatedAtUtc: string
): Session {
  const [key, result] = squatResult(1, 5);
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

/** One shard holding the given sessions, in the order given. */
function shard(yearMonthUtc: string, sessions: Session[]): ResultsShard {
  const map: Record<string, Session> = {};
  for (const value of sessions) map[value.id] = value;
  return { format: 'repjot/results', schemaVersion: 1, yearMonthUtc, sessions: map };
}

/** Three sessions across three shards: one active, one completed, one abandoned. */
function threeShards(): ResultsShard[] {
  return [
    shard('2026-06', [
      session('session-aaa', 'completed', '2026-06-10T08:00:00Z', '2026-06-10T09:00:00Z')
    ]),
    shard('2026-07', [
      session('session-bbb', 'in_progress', '2026-07-02T07:00:00Z', '2026-07-02T07:30:00Z')
    ]),
    shard('2026-08', [
      session('session-ccc', 'abandoned', '2026-08-01T06:00:00Z', '2026-08-01T06:15:00Z')
    ])
  ];
}

describe('buildIndex: active session ordering', () => {
  test('activeSessionsByUpdatedAtUtc sorts newest first across three shards', () => {
    const shards = [
      ...threeShards(),
      shard('2026-09', [
        session('session-ddd', 'in_progress', '2026-09-01T05:00:00Z', '2026-09-01T05:45:00Z')
      ]),
      // An older shard can hold a session updated later than a newer shard's, so
      // the shard month cannot order the active list.
      shard('2026-05', [
        session('session-eee', 'in_progress', '2026-05-01T05:00:00Z', '2026-09-05T05:00:00Z')
      ])
    ];

    const index = buildIndex({ staticData: loadedStaticData(), shards, unresolved: [] });

    expect(index.activeSessionsByUpdatedAtUtc.map((s) => s.id)).toEqual([
      'session-eee',
      'session-ddd',
      'session-bbb'
    ]);
  });

  test('activeSessionsByUpdatedAtUtc holds no terminal session', () => {
    const index = buildIndex({ staticData: loadedStaticData(), shards: threeShards(), unresolved: [] });
    expect(index.activeSessionsByUpdatedAtUtc.some((s) => s.status !== 'in_progress')).toBe(false);
  });
});

describe('buildIndex: recent sessions', () => {
  test('recentSessions returns at most five and excludes in_progress', () => {
    const sessions: Session[] = [];
    for (let i = 1; i <= 9; i += 1) {
      const day = String(i).padStart(2, '0');
      const status: Session['status'] = i % 3 === 0 ? 'abandoned' : 'completed';
      sessions.push(
        session(`session-r${i}`, status, `2026-08-${day}T08:00:00Z`, `2026-08-${day}T09:00:00Z`)
      );
    }
    // The newest session of all is active, so it must not enter Recent.
    sessions.push(session('session-live', 'in_progress', '2026-08-20T08:00:00Z', '2026-08-28T09:00:00Z'));

    const index = buildIndex({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', sessions)],
      unresolved: []
    });

    expect(index.recentSessions.length).toBe(5);
    expect(index.recentSessions.some((s: SessionSummary) => s.status === 'in_progress')).toBe(false);
    expect(index.recentSessions.map((s) => s.startedAtUtc)).toEqual([
      '2026-08-09T08:00:00Z',
      '2026-08-08T08:00:00Z',
      '2026-08-07T08:00:00Z',
      '2026-08-06T08:00:00Z',
      '2026-08-05T08:00:00Z'
    ]);
  });
});

describe('buildIndex: node lookup', () => {
  test('nodeByWorkoutAndId keeps the same node ID in two workouts as two entries', () => {
    const base = loadedStaticData();
    const second = structuredClone(base.workouts[0]!);
    second.id = 'demo-two';
    const staticData = loadedStaticData(base.exercises, [base.workouts[0]!, second]);

    const index = buildIndex({ staticData, shards: [], unresolved: [] });

    const one = index.nodeByWorkoutAndId.get('demo|back-squat-set');
    const two = index.nodeByWorkoutAndId.get('demo-two|back-squat-set');

    expect(one).toBeDefined();
    expect(two).toBeDefined();
    expect(one).not.toBe(two);
    expect(one?.workoutId).toBe('demo');
    expect(two?.workoutId).toBe('demo-two');
    expect(one?.nodeId).toBe('back-squat-set');
    expect(two?.nodeId).toBe('back-squat-set');
  });

  test('node lookup carries the path from the root and the level', () => {
    const index = buildIndex({ staticData: loadedStaticData(), shards: [], unresolved: [] });
    const node = index.nodeByWorkoutAndId.get('demo|back-squat-set');

    expect(node?.level).toBe(3);
    expect(node?.path.map((s) => s.nodeId)).toEqual(['root', 'squat-sets', 'back-squat-set']);
  });
});

describe('buildIndex: muscle groups', () => {
  test('exerciseIdsByMuscleGroup includes secondary muscles', () => {
    const index = buildIndex({ staticData: loadedStaticData(), shards: [], unresolved: [] });

    // `back-squat` lists quadriceps primary and glutes secondary.
    expect(index.exerciseIdsByMuscleGroup.get('quadriceps')?.has('back-squat')).toBe(true);
    expect(index.exerciseIdsByMuscleGroup.get('glutes')?.has('back-squat')).toBe(true);
  });
});

describe('buildIndex: key order independence', () => {
  test('an integer-like key in a fixture does not affect the sorted output', () => {
    const sessions = [
      session('session-aaa', 'completed', '2026-06-10T08:00:00Z', '2026-06-10T09:00:00Z'),
      session('session-bbb', 'in_progress', '2026-07-02T07:00:00Z', '2026-07-02T07:30:00Z'),
      session('session-ccc', 'completed', '2026-08-01T06:00:00Z', '2026-08-01T06:15:00Z'),
      // A session stored under an all-digit map key. JavaScript iterates `"2"`
      // ahead of every string key, so insertion order would lead with it.
      session('2', 'completed', '2026-07-20T06:00:00Z', '2026-07-20T06:15:00Z')
    ];

    // Same four sessions, two different insertion orders. A correct index sorts on
    // the explicit field, so both builds produce the same lists.
    const forward = buildIndex({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', sessions)],
      unresolved: []
    });
    const backward = buildIndex({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', [...sessions].reverse())],
      unresolved: []
    });

    const expectedTerminal = ['session-ccc', '2', 'session-aaa'];
    expect(forward.terminalSessions.map((s) => s.id)).toEqual(expectedTerminal);
    expect(backward.terminalSessions.map((s) => s.id)).toEqual(expectedTerminal);
    expect(backward.activeSessionsByUpdatedAtUtc.map((s) => s.id)).toEqual(
      forward.activeSessionsByUpdatedAtUtc.map((s) => s.id)
    );
  });

  test('occurrence order follows the tree, not Record iteration order', () => {
    const value = session(
      'session-ord',
      'completed',
      '2026-08-01T08:00:00Z',
      '2026-08-01T09:00:00Z'
    );
    // Insert the rounds out of tree order: 3, 1, 2.
    value.exerciseResults = {};
    for (const [key, result] of [squatResult(3, 3), squatResult(1, 1), squatResult(2, 2)]) {
      value.exerciseResults[key] = result;
    }

    const index = buildIndex({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', [value])],
      unresolved: []
    });

    const occurrences = index.occurrencesByExerciseId.get('back-squat') ?? [];
    expect(occurrences.length).toBe(3);
    // One session start, so the tree rank orders them: round 1, 2, 3.
    expect(occurrences.map((o: ExerciseOccurrence) => o.encodedPath)).toEqual([
      'root/squat-sets:1/back-squat-set',
      'root/squat-sets:2/back-squat-set',
      'root/squat-sets:3/back-squat-set'
    ]);
  });

  // Regression: the old comparator subtracted two `Infinity` ranks for an
  // unresolved pair, got `NaN`, and never reached the encoded-path fallback.
  // Every unresolved row landed at index 0, which is reverse `Record` order and
  // breaks REQUIREMENTS 3.17 and 6.23.
  test('two or more unresolved occurrences sort by the encoded path', () => {
    const value = session(
      'session-unres',
      'completed',
      '2026-08-01T08:00:00Z',
      '2026-08-01T09:00:00Z'
    );
    // Three results whose terminal nodes are absent from the current tree.
    value.exerciseResults = {};
    for (const nodeId of ['root-zzz', 'root-aaa', 'root-mmm']) {
      const path = [{ nodeId: 'root' }, { nodeId }];
      const result: ExerciseResult = {
        workoutId: 'demo',
        executionPath: path,
        exerciseId: 'back-squat',
        side: 'both',
        attempt: 1,
        status: 'completed',
        values: { reps: { value: 5, unit: 'reps' } }
      };
      value.exerciseResults[exerciseResultKey(path, 'both', 1)] = result;
    }

    const index = buildIndex({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', [value])],
      unresolved: []
    });

    const paths = (index.occurrencesByExerciseId.get('back-squat') ?? []).map(
      (o) => o.encodedPath
    );
    expect(paths).toEqual(['root/root-aaa', 'root/root-mmm', 'root/root-zzz']);
  });

  test('unresolved occurrences sort by path whatever the insertion order', () => {
    const build = (nodeIds: string[]): string[] => {
      const value = session(
        'session-unres2',
        'completed',
        '2026-08-01T08:00:00Z',
        '2026-08-01T09:00:00Z'
      );
      value.exerciseResults = {};
      for (const nodeId of nodeIds) {
        const path = [{ nodeId: 'root' }, { nodeId }];
        value.exerciseResults[exerciseResultKey(path, 'both', 1)] = {
          workoutId: 'demo',
          executionPath: path,
          exerciseId: 'back-squat',
          side: 'both',
          attempt: 1,
          status: 'completed',
          values: { reps: { value: 5, unit: 'reps' } }
        };
      }
      const index = buildIndex({
        staticData: loadedStaticData(),
        shards: [shard('2026-08', [value])],
        unresolved: []
      });
      return (index.occurrencesByExerciseId.get('back-squat') ?? []).map((o) => o.encodedPath);
    };

    const forward = build(['root-aaa', 'root-mmm', 'root-zzz']);
    const backward = build(['root-zzz', 'root-mmm', 'root-aaa']);
    expect(backward).toEqual(forward);
    expect(forward).toEqual(['root/root-aaa', 'root/root-mmm', 'root/root-zzz']);
  });

  test('resolved occurrences sort ahead of unresolved ones', () => {
    const value = session(
      'session-mixed',
      'completed',
      '2026-08-01T08:00:00Z',
      '2026-08-01T09:00:00Z'
    );
    value.exerciseResults = {};
    const [resolvedKey, resolved] = squatResult(1, 5);
    value.exerciseResults[resolvedKey] = resolved;
    const ghostPath = [{ nodeId: 'root' }, { nodeId: 'aaa-ghost' }];
    value.exerciseResults[exerciseResultKey(ghostPath, 'both', 1)] = {
      workoutId: 'demo',
      executionPath: ghostPath,
      exerciseId: 'back-squat',
      side: 'both',
      attempt: 1,
      status: 'completed',
      values: { reps: { value: 1, unit: 'reps' } }
    };

    const index = buildIndex({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', [value])],
      unresolved: []
    });

    expect((index.occurrencesByExerciseId.get('back-squat') ?? []).map((o) => o.encodedPath)).toEqual([
      'root/squat-sets:1/back-squat-set',
      'root/aaa-ghost'
    ]);
  });

  // Regression: the old rank keyed on the node ID alone, so every iteration of a
  // container shared one rank and the tie-break fell to the lexicographic path
  // string, which put round 10 ahead of round 2. REQUIREMENTS 3.20.
  test('round 10 sorts after round 2, not before it', () => {
    const value = session(
      'session-rounds',
      'completed',
      '2026-08-01T08:00:00Z',
      '2026-08-01T09:00:00Z'
    );
    value.exerciseResults = {};
    const rounds = [1, 10, 2, 11, 3, 20, 9];
    for (const round of rounds) {
      const [key, result] = squatResult(round, round);
      value.exerciseResults[key] = result;
    }

    const index = buildIndex({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', [value])],
      unresolved: []
    });

    const paths = (index.occurrencesByExerciseId.get('back-squat') ?? []).map((o) => o.encodedPath);
    expect(paths).toEqual([
      'root/squat-sets:1/back-squat-set',
      'root/squat-sets:2/back-squat-set',
      'root/squat-sets:3/back-squat-set',
      'root/squat-sets:9/back-squat-set',
      'root/squat-sets:10/back-squat-set',
      'root/squat-sets:11/back-squat-set',
      'root/squat-sets:20/back-squat-set'
    ]);
  });

  // Regression: two unparsable timestamps both keyed `-Infinity`, the
  // subtraction produced `NaN`, and the documented `id` tie-break never ran.
  test('sessions with unparsable timestamps still tie-break on id', () => {
    const a = session('session-a', 'completed', 'not-a-date', 'still-not-a-date');
    const b = session('session-b', 'completed', 'not-a-date', 'still-not-a-date');

    const forward = buildIndex({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', [a, b])],
      unresolved: []
    });
    const backward = buildIndex({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', [b, a])],
      unresolved: []
    });

    const expected = ['session-a', 'session-b'];
    expect(forward.terminalSessions.map((s) => s.id)).toEqual(expected);
    expect(backward.terminalSessions.map((s) => s.id)).toEqual(expected);
  });

  test('container rows sort by tree order too', () => {
    const value = session(
      'session-cont',
      'completed',
      '2026-08-01T08:00:00Z',
      '2026-08-01T09:00:00Z'
    );
    const containerRow = (nodeId: string) => ({
      workoutId: 'demo',
      executionPath: [{ nodeId: 'root' }, { nodeId }],
      attempt: 1,
      status: 'completed' as const,
      score: { type: 'cycles' as const, completedCycles: 1 }
    });
    // `cindy` sits after `squat-sets` in the tree, so it sorts second whatever
    // the insertion order, even though its name sorts first.
    value.containerResults = {
      'root/cindy|1': containerRow('cindy'),
      'root/warmup|1': containerRow('warmup'),
      'root/ghost|1': containerRow('ghost')
    };

    const index = buildIndex({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', [value])],
      unresolved: []
    });

    expect((index.containerOccurrencesBySessionId.get('session-cont') ?? []).map((c) => c.containerNodeId)).toEqual([
      'warmup',
      'cindy',
      'ghost'
    ]);
  });
});

describe('buildIndex: unresolved and caps', () => {
  test('unresolved entries copy through without being sorted away', () => {
    const entries = [
      {
        kind: 'result' as const,
        reason: 'unknown_exercise' as const,
        sessionKey: 'session-aaa',
        resultKey: 'root/x|both|1',
        workoutId: 'demo',
        exerciseId: 'gone',
        encodedPath: 'root/x'
      },
      {
        kind: 'preference' as const,
        reason: 'unit_incompatible' as const,
        exerciseId: 'back-squat',
        dimension: 'weight',
        unit: 'st'
      }
    ];

    const index = buildIndex({
      staticData: loadedStaticData(),
      shards: threeShards(),
      unresolved: entries
    });

    expect(index.unresolvedResults.length).toBe(2);
  });

  test('per-exercise recent list caps at recentLimit', () => {
    const sessions: Session[] = [];
    for (let i = 1; i <= 12; i += 1) {
      const day = String(i).padStart(2, '0');
      sessions.push(
        session(`session-cap${i}`, 'completed', `2026-08-${day}T08:00:00Z`, `2026-08-${day}T09:00:00Z`)
      );
    }

    const index = buildIndex({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', sessions)],
      unresolved: [],
      recentLimit: 4
    });

    const capped = index.recentByExerciseId.get('back-squat') ?? [];
    expect(capped.length).toBe(4);
    expect(capped[0]?.sessionId).toBe('session-cap12');
    // The full history list keeps all twelve.
    expect(index.occurrencesByExerciseId.get('back-squat')?.length).toBe(12);
  });

  test('every session summary carries its shard name', () => {
    const index = buildIndex({ staticData: loadedStaticData(), shards: threeShards(), unresolved: [] });
    expect(index.sessionsById.get('session-aaa')?.shardName).toBe('results-2026-06.json');
    expect(index.sessionsById.get('session-ccc')?.shardName).toBe('results-2026-08.json');
  });

  test('a session summary names the workout, or the raw id when the workout is gone', () => {
    const index = buildIndex({ staticData: loadedStaticData(), shards: threeShards(), unresolved: [] });
    expect(index.sessionsById.get('session-aaa')?.workoutName).toBe('Demo Workout');

    const orphan = session('session-orphan', 'completed', '2026-08-05T08:00:00Z', '2026-08-05T09:00:00Z');
    orphan.workoutId = 'removed-workout';
    const withOrphan = buildIndex({
      staticData: loadedStaticData(),
      shards: [shard('2026-08', [orphan])],
      unresolved: []
    });
    expect(withOrphan.sessionsById.get('session-orphan')?.workoutName).toBe('removed-workout');
  });
});
