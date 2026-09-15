// Phase 18 fix proofs.
//
// Each test here reproduces one defect the verifier confirmed against the real
// model and screen code, then asserts the fixed behaviour. The green suite
// that shipped with the phase proved none of them, because its fixtures held
// fewer than ten rounds and fewer than ten attempts, so a lexicographic
// tie-break never differed from a numeric one.
//
// REQUIREMENTS 3.17, 3.19, 3.20, 6.8, 6.10, 6.23, 11.7, 20.1, 20.3, 20.4.

import { describe, expect, test } from 'bun:test';

import ExerciseHistoryScreen from '../src/ui/screens/ExerciseHistoryScreen.svelte';
import SummaryTree from '../src/ui/components/SummaryTree.svelte';
import {
  monthOfUtc,
  previousMonth,
  shardNameForMonth
} from '../src/ui/screens/historyShards';
import {
  appendPage,
  emptyPager,
  hasOlder,
  loadOlder,
  type PagerPage,
  type PagerState
} from '../src/ui/screens/historyPager';
import {
  buildExerciseHistoryModel,
  buildWorkoutHistoryModel,
  formatOccurrenceAlternating,
  type HistoryRow
} from '../src/ui/viewmodels/historyModel';
import { buildSummaryModel } from '../src/ui/viewmodels/summaryModel';
import { createLookupService } from '../src/indexes/lookup-service';
import { validateSession } from '../src/validation/semantic-validator';
import type { LoadedStaticData } from '../src/documents/static-loader';
import type {
  ExerciseResult,
  ResultsShard,
  Session
} from '../src/domain/types';
import {
  SESSION_KEY,
  WORKOUT_ID,
  clone,
  staticData,
  validSession,
  validShard
} from './fixtures/semantic';
import { html } from './support/render';

/** Wrap the fixture bundle in the shape the registry and the model read. */
function loaded(data = staticData()): LoadedStaticData {
  return {
    ...data,
    exerciseById: new Map(data.exercises.map((exercise) => [exercise.id, exercise])),
    workoutById: new Map(data.workouts.map((candidate) => [candidate.id, candidate]))
  };
}

/** A fixed "now" so no label depends on the wall clock. */
const NOW = '2026-08-15T18:00:00Z';

/** Every exercise row across every group, flattened. */
function allRows(model: ReturnType<typeof buildSummaryModel>) {
  return model.groups.flatMap((group) => group.rows);
}

/** Every container score row across every group, flattened. */
function allScores(model: ReturnType<typeof buildSummaryModel>) {
  return model.groups.flatMap((group) => group.containers);
}

describe('Fix 1: previousMonth walks one calendar month back', () => {
  test('a mid-year month steps to the month before it', () => {
    expect(previousMonth('2026-03')).toBe('2026-02');
    expect(previousMonth('2026-08')).toBe('2026-07');
  });

  test('January wraps to December of the year before', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
  });

  test('twelve steps walk a whole year and land back on the start', () => {
    let month = '2026-08';
    for (let step = 0; step < 12; step += 1) {
      month = previousMonth(month);
    }
    expect(month).toBe('2025-08');
  });

  test('no month ever returns itself', () => {
    for (let oneBased = 1; oneBased <= 12; oneBased += 1) {
      const label = `2026-${String(oneBased).padStart(2, '0')}`;
      expect(previousMonth(label)).not.toBe(label);
    }
  });

  test('a label that is not YYYY-MM comes back unchanged', () => {
    expect(previousMonth('not-a-month')).toBe('not-a-month');
    expect(previousMonth('')).toBe('');
  });

  test('the shard name follows the month, not the label arithmetic', () => {
    expect(shardNameForMonth('2026-02')).toBe('results-2026-02.json');
    expect(shardNameForMonth(previousMonth('2026-01'))).toBe('results-2025-12.json');
  });

  test('monthOfUtc reads the month off a stored stamp', () => {
    expect(monthOfUtc('2026-08-15T14:30:00Z')).toBe('2026-08');
    expect(monthOfUtc('nope')).toBe('');
    expect(monthOfUtc(undefined)).toBe('');
  });
});

describe('Fix 2 and Fix 10: the pager keeps the two ends apart and drops nothing', () => {
  /** A row the pager can walk backwards from. */
  interface Row {
    id: string;
    startedAtUtc: string;
  }

  /** A growable index behind a page reader. */
  function makeIndex(initial: Row[]) {
    const rows = [...initial];
    return {
      rows,
      read(offset: number, limit: number): PagerPage<Row> {
        const items = rows.slice(offset, offset + limit);
        return { items, total: rows.length, hasMore: offset + items.length < rows.length };
      },
      add(month: string, count: number) {
        for (let i = 0; i < count; i += 1) {
          rows.push({
            id: `${month}-${String(rows.length)}`,
            startedAtUtc: `${month}-01T00:00:00Z`
          });
        }
      }
    };
  }

  const rowsFor = (month: string, count: number): Row[] =>
    Array.from({ length: count }, (_, i) => ({
      id: `${month}-${i}`,
      startedAtUtc: `${month}-01T00:00:00Z`
    }));

  test('one page of history still leaves the older control live', () => {
    const index = makeIndex(rowsFor('2026-08', 3));
    const state = appendPage(emptyPager<Row>(), index.read, 20);
    // The index is spent, but the shard walk has not been asked yet.
    expect(state.indexExhausted).toBeTrue();
    expect(state.noOlderShards).toBeFalse();
    expect(hasOlder(state)).toBeTrue();
  });

  test('an empty index still leaves the older control live', () => {
    const index = makeIndex([]);
    const state = appendPage(emptyPager<Row>(), index.read, 20);
    expect(state.rows).toHaveLength(0);
    expect(hasOlder(state)).toBeTrue();
  });

  test('a 45-row index walks to the end and shows all 45 rows', async () => {
    const index = makeIndex([
      ...rowsFor('2026-08', 20),
      ...rowsFor('2026-07', 20),
      ...rowsFor('2026-06', 5)
    ]);
    // Nothing older than 2026-06 exists on the account.
    const noMoreShards = async (): Promise<boolean> => false;

    let state: PagerState<Row> = appendPage(emptyPager<Row>(), index.read, 20);
    expect(state.rows).toHaveLength(20);

    state = await loadOlder(state, index.read, noMoreShards, 20);
    expect(state.rows).toHaveLength(40);

    // The last page is partial. It must still land on screen.
    state = await loadOlder(state, index.read, noMoreShards, 20);
    expect(state.rows).toHaveLength(45);
    expect(state.rows[44].startedAtUtc).toBe('2026-06-01T00:00:00Z');

    // Now the walk has confirmed the end.
    state = await loadOlder(state, index.read, noMoreShards, 20);
    expect(state.rows).toHaveLength(45);
    expect(state.noOlderShards).toBeTrue();
    expect(hasOlder(state)).toBeFalse();
  });

  test('a shard that lands extends the list instead of ending the walk', async () => {
    const index = makeIndex(rowsFor('2026-08', 20));
    let state: PagerState<Row> = appendPage(emptyPager<Row>(), index.read, 20);
    expect(state.rows).toHaveLength(20);

    const lands = async (month: string): Promise<boolean> => {
      index.add(month, 7);
      return true;
    };

    state = await loadOlder(state, index.read, lands, 20);
    expect(state.rows).toHaveLength(27);
    expect(state.noOlderShards).toBeFalse();
  });

  test('a walk that finds nothing older hides the control', async () => {
    const index = makeIndex(rowsFor('2026-08', 5));
    const state = await loadOlder(
      appendPage(emptyPager<Row>(), index.read, 20),
      index.read,
      async () => false,
      20
    );
    expect(state.rows).toHaveLength(5);
    expect(state.noOlderShards).toBeTrue();
  });

  test('a row with no usable month ends the walk rather than wandering', async () => {
    const index = makeIndex([{ id: 'broken', startedAtUtc: 'not-a-stamp' }]);
    const state = await loadOlder(
      appendPage(emptyPager<Row>(), index.read, 20),
      index.read,
      async () => true,
      20
    );
    expect(state.noOlderShards).toBeTrue();
  });

  test('a confirmed end is final and reads no further', async () => {
    const index = makeIndex(rowsFor('2026-08', 5));
    const ended: PagerState<Row> = {
      rows: rowsFor('2026-08', 5),
      offset: 5,
      indexExhausted: true,
      noOlderShards: true
    };
    let asked = false;
    const state = await loadOlder(
      ended,
      (offset, limit) => {
        asked = true;
        return index.read(offset, limit);
      },
      async () => true,
      20
    );
    expect(asked).toBeFalse();
    expect(state).toBe(ended);
  });

  test('appending new rows clears a stale "nothing older" answer', () => {
    const index = makeIndex(rowsFor('2026-08', 2));
    const withMore = (offset: number, limit: number): PagerPage<Row> => {
      index.add('2026-07', 0);
      return index.read(offset, limit);
    };
    let state: PagerState<Row> = {
      rows: rowsFor('2026-08', 2),
      offset: 2,
      indexExhausted: true,
      noOlderShards: true
    };
    index.add('2026-07', 3);
    state = appendPage(state, withMore, 20);
    expect(state.rows).toHaveLength(5);
    expect(state.noOlderShards).toBeFalse();
  });
});

describe('Fix 3: a republished index reaches the screen', () => {
  interface Row {
    id: string;
    startedAtUtc: string;
  }

  test('a partial index at mount grows when the warm-up republishes', () => {
    let loaded: Row[] = [];
    const read = (offset: number, limit: number): PagerPage<Row> => {
      const items = loaded.slice(offset, offset + limit);
      return { items, total: loaded.length, hasMore: offset + items.length < loaded.length };
    };

    // Mount against an empty index.
    let state = appendPage(emptyPager<Row>(), read, 20);
    expect(state.rows).toHaveLength(0);

    // The warm fold lands. The same read path now sees the sessions.
    loaded = [
      { id: 'a', startedAtUtc: '2026-08-10T10:00:00Z' },
      { id: 'b', startedAtUtc: '2026-08-09T10:00:00Z' }
    ];
    state = appendPage(state, read, 20);
    expect(state.rows.map((row) => row.id)).toEqual(['a', 'b']);

    // A second republish with nothing new appends nothing and duplicates nothing.
    state = appendPage(state, read, 20);
    expect(state.rows.map((row) => row.id)).toEqual(['a', 'b']);
  });

  test('a republish appends only the new rows past what is already shown', () => {
    let loaded: Row[] = [
      { id: 'a', startedAtUtc: '2026-08-10T10:00:00Z' },
      { id: 'b', startedAtUtc: '2026-08-09T10:00:00Z' }
    ];
    const read = (offset: number, limit: number): PagerPage<Row> => {
      const items = loaded.slice(offset, offset + limit);
      return { items, total: loaded.length, hasMore: offset + items.length < loaded.length };
    };

    let state = appendPage(emptyPager<Row>(), read, 1);
    expect(state.rows.map((row) => row.id)).toEqual(['a']);

    loaded = [
      ...loaded,
      { id: 'c', startedAtUtc: '2026-08-08T10:00:00Z' }
    ];
    state = appendPage(state, read, 1);
    expect(state.rows.map((row) => row.id)).toEqual(['a', 'b']);
    state = appendPage(state, read, 1);
    expect(state.rows.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  test('the real lookup service drives the same read path the screen uses', () => {
    // Empty at mount, exactly the case a bookmarked `#/history` meets.
    const emptyShard: ResultsShard = {
      format: 'repjot/results',
      schemaVersion: 1,
      yearMonthUtc: '2026-08',
      sessions: {}
    };
    const lookup = createLookupService({ staticData: loaded(), shards: [emptyShard] });

    const read = (offset: number, limit: number): PagerPage<HistoryRow> => {
      const page = lookup.listAllSessions({ offset, limit });
      return {
        items: buildWorkoutHistoryModel(page.items, 'UTC', NOW),
        total: page.total,
        hasMore: page.hasMore
      };
    };

    let state = appendPage(emptyPager<HistoryRow>(), read, 20);
    expect(state.rows).toHaveLength(0);
    // The control stays live, because the walk has not been asked yet.
    expect(hasOlder(state)).toBeTrue();

    // The warm fold lands an older month and republishes the registry.
    const warmed: ResultsShard = {
      format: 'repjot/results',
      schemaVersion: 1,
      yearMonthUtc: '2026-07',
      sessions: { [SESSION_KEY]: validSession() }
    };
    lookup.extendHistory([warmed]);

    state = appendPage(state, read, 20);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].workoutName).toBe('Demo Workout');
  });
});

describe('Fix 4: a broken ancestor reads broken in both layers', () => {
  test('the summary model and validateSession agree on broken_path', () => {
    const session = validSession();
    const key = 'root/ghost:1/back-squat-set|both|1';
    // The leaf `back-squat-set` exists elsewhere in the tree. Only the
    // ancestor is gone.
    session.exerciseResults[key] = {
      workoutId: WORKOUT_ID,
      executionPath: [
        { nodeId: 'root' },
        { nodeId: 'ghost:1' },
        { nodeId: 'back-squat-set' }
      ],
      exerciseId: 'back-squat',
      side: 'both',
      attempt: 1,
      status: 'completed',
      values: { reps: { value: 5, unit: 'reps' } }
    };

    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const row = allRows(model).find((candidate) => candidate.key === key);
    expect(row?.unresolved).toBeTrue();
    expect(row?.unresolvedReason).toBe('broken_path');

    const report = validateSession(clone(session), staticData(), {
      shardYearMonthUtc: '2026-08'
    });
    const entry = report.unresolved.find((candidate) => candidate.resultKey === key);
    expect(entry?.reason).toBe('broken_path');
  });

  test('a path that does not start at the workout root is broken', () => {
    const session = validSession();
    const key = 'elsewhere/warmup-squat|both|1';
    session.exerciseResults[key] = {
      workoutId: WORKOUT_ID,
      executionPath: [{ nodeId: 'elsewhere' }, { nodeId: 'warmup-squat' }],
      exerciseId: 'back-squat',
      side: 'both',
      attempt: 1,
      status: 'completed',
      values: { reps: { value: 5, unit: 'reps' } }
    };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    expect(allRows(model).find((row) => row.key === key)?.unresolvedReason).toBe('broken_path');
  });

  test('a round past the container count is broken, in both layers', () => {
    const session = validSession();
    const key = 'root/squat-sets:9/back-squat-set|both|1';
    session.exerciseResults[key] = {
      workoutId: WORKOUT_ID,
      executionPath: [
        { nodeId: 'root' },
        { nodeId: 'squat-sets', iteration: 9 },
        { nodeId: 'back-squat-set' }
      ],
      exerciseId: 'back-squat',
      side: 'both',
      attempt: 1,
      status: 'completed',
      values: { reps: { value: 5, unit: 'reps' } }
    };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    expect(allRows(model).find((row) => row.key === key)?.unresolvedReason).toBe('broken_path');

    const report = validateSession(clone(session), staticData(), {
      shardYearMonthUtc: '2026-08'
    });
    expect(report.unresolved.some((entry) => entry.resultKey === key)).toBeTrue();
  });

  test('a container score with a missing ancestor is broken too', () => {
    const session = validSession();
    const key = 'root/ghost/block|1';
    session.containerResults[key] = {
      workoutId: WORKOUT_ID,
      executionPath: [{ nodeId: 'root' }, { nodeId: 'ghost' }, { nodeId: 'block' }],
      attempt: 1,
      status: 'completed',
      score: { type: 'cycles', completedCycles: 3 }
    };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const row = allScores(model).find((candidate) => candidate.key === key);
    expect(row?.unresolved).toBeTrue();
    expect(row?.unresolvedReason).toBe('broken_path');
  });
});

describe('Fix 5: twelve rounds read in round order', () => {
  /** Add one Cindy round of two push-ups. */
  function addRound(session: Session, round: number): void {
    const path = [
      { nodeId: 'root' },
      { nodeId: 'cindy', iteration: round },
      { nodeId: 'pushups' }
    ];
    const key = `root/cindy:${round}|both|1`;
    session.exerciseResults[key] = {
      workoutId: WORKOUT_ID,
      executionPath: path,
      exerciseId: 'push-up',
      side: 'both',
      attempt: 1,
      status: 'completed',
      values: { reps: { value: 2, unit: 'reps' } }
    };
  }

  test('group titles read 1..12, not 1, 10, 11, 12, 2', () => {
    const session = validSession();
    for (let round = 1; round <= 12; round += 1) {
      addRound(session, round);
    }
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const cindyRounds = model.groups
      .filter((group) => group.title.startsWith('Cindy · Round'))
      .map((group) => Number(group.title.replace('Cindy · Round ', '')));
    expect(cindyRounds).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  test('insertion order cannot change the round order', () => {
    const forward = validSession();
    for (let round = 1; round <= 12; round += 1) {
      addRound(forward, round);
    }
    const reverse = validSession();
    for (let round = 12; round >= 1; round -= 1) {
      addRound(reverse, round);
    }
    const build = (session: Session) =>
      buildSummaryModel({
        session,
        staticData: loaded(),
        localTimeZone: 'UTC',
        nowUtc: NOW
      }).groups.map((group) => group.title);
    expect(build(reverse)).toEqual(build(forward));
  });
});

describe('Fix 6: container scores do not follow insertion order', () => {
  /** Two attempts on one container, inserted in the given order. */
  function withContainers(order: number[]): Session {
    const session = validSession();
    session.containerResults = {};
    for (const attempt of order) {
      session.containerResults[`root/cindy|${attempt}`] = {
        workoutId: WORKOUT_ID,
        executionPath: [{ nodeId: 'root' }, { nodeId: 'cindy' }],
        attempt,
        status: 'completed',
        score: { type: 'rounds_and_reps', completedRounds: attempt, additionalReps: 0 }
      };
    }
    return session;
  }

  const scores = (session: Session) =>
    buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    })
      .groups.filter((group) => group.key === 'root/cindy')
      .flatMap((group) => group.containers.map((row) => row.attempt));

  test('forward and reverse insertion produce the same order', () => {
    expect(scores(withContainers([1, 2, 10]))).toEqual([1, 2, 10]);
    expect(scores(withContainers([10, 2, 1]))).toEqual([1, 2, 10]);
  });

  test('ten attempts read numerically, not lexicographically', () => {
    const attempts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const shuffled = [10, 7, 1, 4, 9, 2, 8, 3, 6, 5];
    expect(scores(withContainers(shuffled))).toEqual(attempts);
  });
});

describe('Fix 7: attempts read 1, 2, 10', () => {
  test('three attempts on one exercise sort numerically', () => {
    const session = validSession();
    for (const attempt of [1, 10, 2]) {
      session.exerciseResults[`root/warmup/warmup-squat|both|${attempt}`] = {
        workoutId: WORKOUT_ID,
        executionPath: [{ nodeId: 'root' }, { nodeId: 'warmup' }, { nodeId: 'warmup-squat' }],
        exerciseId: 'back-squat',
        side: 'both',
        attempt,
        status: 'completed',
        values: { reps: { value: attempt, unit: 'reps' } }
      };
    }
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const attempts = allRows(model)
      .filter((row) => row.encodedPath === 'root/warmup/warmup-squat')
      .map((row) => row.attempt);
    expect(attempts).toEqual([1, 2, 10]);
  });
});

describe('Fix 8: an unknown workout still shows its values', () => {
  test('every stored value reaches the DOM beside the error card', () => {
    const session = validSession();
    session.workoutId = 'removed-workout';
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });

    // The model computes every value even though nothing resolves.
    const rows = allRows(model);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.unresolved)).toBeTrue();
    expect(rows.every((row) => row.valuesLabel !== '')).toBeTrue();

    const out = html(SummaryTree, { groups: model.groups, idPrefix: 's' });
    expect(out).toContain('data-error');
    expect(out).toContain('This workout is not in this build');
    // The values are not hidden behind the banner.
    expect(out).toContain('60 lb');
    expect(out).toContain('105 lb');
    expect(out).toContain('250 m');
    for (const row of rows) {
      expect(out).toContain(row.valuesLabel);
    }
  });

  test('an unresolved container score shows its score beside the card', () => {
    const session = validSession();
    session.workoutId = 'removed-workout';
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: NOW
    });
    const out = html(SummaryTree, { groups: model.groups, idPrefix: 's' });
    expect(out).toContain('data-error');
    // The stored scores read beside the card, not behind it.
    expect(out).toContain('2 + 10');
    expect(out).toContain('4 of 8');
    expect(out).toContain('summary-row__score-value');
  });
});

describe('Fix 9: Exercise History shows the alternating split', () => {
  /** One alternating occurrence, flattened the way the index flattens it. */
  function alternatingOccurrence(startingSide: 'left' | 'right', reps: number) {
    const session = validSession();
    const path = [{ nodeId: 'root' }, { nodeId: 'cindy' }, { nodeId: 'pushups' }];
    const key = `root/cindy/pushups|alternating|1`;
    const result: ExerciseResult = {
      workoutId: WORKOUT_ID,
      executionPath: path,
      exerciseId: 'push-up',
      side: 'alternating',
      startingSide,
      attempt: 1,
      status: 'completed',
      values: { reps: { value: reps, unit: 'reps' } }
    };
    session.exerciseResults = { [key]: result };
    const shard: ResultsShard = {
      format: 'repjot/results',
      schemaVersion: 1,
      yearMonthUtc: '2026-08',
      sessions: { [SESSION_KEY]: session }
    };
    const lookup = createLookupService({ staticData: loaded(), shards: [shard] });
    return lookup.getExerciseHistory('push-up', { offset: 0, limit: 10 });
  }

  test('the flattened occurrence carries the starting side', () => {
    const page = alternatingOccurrence('left', 9);
    const occurrence = page.items.find((item) => item.side === 'alternating');
    expect(occurrence?.startingSide).toBe('left');
  });

  test('an odd total names both sides', () => {
    const page = alternatingOccurrence('left', 9);
    const occurrence = page.items.find((item) => item.side === 'alternating');
    expect(occurrence).toBeDefined();
    expect(formatOccurrenceAlternating(occurrence!)).toBe('9 total / 5 left / 4 right');
  });

  test('an even total reads each', () => {
    const page = alternatingOccurrence('right', 10);
    const occurrence = page.items.find((item) => item.side === 'alternating');
    expect(formatOccurrenceAlternating(occurrence!)).toBe('10 total / 5 each');
  });

  test('a both set of the same total gets no split', () => {
    const session = validSession();
    const key = 'root/cindy/pushups|both|1';
    session.exerciseResults = {
      [key]: {
        workoutId: WORKOUT_ID,
        executionPath: [{ nodeId: 'root' }, { nodeId: 'cindy' }, { nodeId: 'pushups' }],
        exerciseId: 'push-up',
        side: 'both',
        attempt: 1,
        status: 'completed',
        values: { reps: { value: 9, unit: 'reps' } }
      }
    };
    const shard: ResultsShard = {
      format: 'repjot/results',
      schemaVersion: 1,
      yearMonthUtc: '2026-08',
      sessions: { [SESSION_KEY]: session }
    };
    const lookup = createLookupService({ staticData: loaded(), shards: [shard] });
    const occurrence = lookup
      .getExerciseHistory('push-up', { offset: 0, limit: 10 })
      .items.find((item) => item.resultKey === key);
    expect(occurrence).toBeDefined();
    expect(formatOccurrenceAlternating(occurrence!)).toBe('');
  });

  test('the Exercise History row renders the split', () => {
    const page = alternatingOccurrence('left', 9);
    const rows = buildExerciseHistoryModel(page.items, 'UTC', NOW, 'Push Up');
    const withSplit = rows.find((row) => row.alternatingLabel === '9 total / 5 left / 4 right');
    expect(withSplit).toBeDefined();
  });
});
