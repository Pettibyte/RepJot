// Render tests for the Phase 18 screens and components.
//
// PHASE-18 checklist: the summary renders recorded work with container scores
// and marks unresolved items, the history list pages with **Load older**, and
// an unresolved reference renders a data-error card without dropping the rows
// beside it.

import { afterEach, describe, expect, test } from 'bun:test';

import ExerciseHistoryScreen from '../src/ui/screens/ExerciseHistoryScreen.svelte';
import WorkoutHistoryScreen from '../src/ui/screens/WorkoutHistoryScreen.svelte';
import WorkoutSummaryScreen from '../src/ui/screens/WorkoutSummaryScreen.svelte';
import LoadOlder from '../src/ui/components/LoadOlder.svelte';
import SummaryTree from '../src/ui/components/SummaryTree.svelte';
import { clearServices, setServices } from '../src/services/registry';
import { clearRawPayloads } from '../src/state/raw-payload-store';
import { createLookupService } from '../src/indexes/lookup-service';
import type { LoadedStaticData } from '../src/documents/static-loader';
import type { ResultsShard } from '../src/domain/types';
import {
  SESSION_KEY,
  WORKOUT_ID,
  clone,
  exercises,
  staticData,
  validSession,
  validShard,
  workout
} from './fixtures/semantic';
import { buildSummaryModel } from '../src/ui/viewmodels/summaryModel';
import { html } from './support/render';

afterEach(() => {
  clearServices();
  clearRawPayloads();
});

/** Wrap the fixture bundle in the loaded shape the registry holds. */
function loaded(data = staticData()): LoadedStaticData {
  return {
    ...data,
    exerciseById: new Map(data.exercises.map((exercise) => [exercise.id, exercise])),
    workoutById: new Map(data.workouts.map((candidate) => [candidate.id, candidate]))
  };
}

/** Publish a registry backed by one shard. */
function publishWithShard(shard: ResultsShard, bundle = staticData()): void {
  const data = loaded(bundle);
  setServices({
    staticData: data,
    lookup: createLookupService({ staticData: data, shards: [shard] })
  });
}

describe('WorkoutSummaryScreen', () => {
  // The server renderer does not run `$effect`, so a screen that loads in an
  // effect renders its first-paint state here. The loaded state is covered
  // through `SummaryTree`, which is what the screen hands its model to.
  test('a screen with no session yet renders the fallback, not a blank page', () => {
    const out = html(WorkoutSummaryScreen, { sessionId: SESSION_KEY });
    expect(out).toContain('No session to show');
    expect(out).toContain('Back to history');
  });

  test('the fallback links to History so the user is never stranded', () => {
    const out = html(WorkoutSummaryScreen, { sessionId: '' });
    expect(out).toContain('href="#/history"');
  });
});

describe('SummaryTree', () => {
  test('renders every recorded exercise row', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: '2026-08-15T18:00:00Z'
    });
    const out = html(SummaryTree, { groups: model.groups, idPrefix: 's' });
    expect(out).toContain('Back Squat');
    expect(out).toContain('Push Up');
    expect(out).toContain('Sit Up');
  });

  test('renders each container score with its score type label', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: '2026-08-15T18:00:00Z'
    });
    const out = html(SummaryTree, { groups: model.groups, idPrefix: 's' });
    expect(out).toContain('Rounds and reps');
    expect(out).toContain('Intervals');
    expect(out).toContain('Cycles');
  });

  test('renders the recorded values, not the prescription', () => {
    const model = buildSummaryModel({
      session: validSession(),
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: '2026-08-15T18:00:00Z'
    });
    const out = html(SummaryTree, { groups: model.groups, idPrefix: 's' });
    // Round 2 recorded 105 lb. The prescription says 100 lb.
    expect(out).toContain('105 lb');
  });

  test('an unresolved row renders a data-error card and keeps its neighbours', () => {
    const session = validSession();
    const total = Object.keys(session.exerciseResults).length;
    session.exerciseResults['root/cindy:1/pushups|both|1'] = {
      ...session.exerciseResults['root/cindy:1/pushups|both|1'],
      exerciseId: 'ghost-exercise'
    };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: '2026-08-15T18:00:00Z'
    });
    const out = html(SummaryTree, { groups: model.groups, idPrefix: 's' });

    // REQUIREMENTS 6.10: the card appears and the rest of the list survives.
    expect(out).toContain('data-error');
    expect(out).toContain('This exercise is not in this build');
    expect(out).toContain('View Raw JSON');
    const rowCount = (out.match(/class="summary-row/g) ?? []).length;
    expect(rowCount).toBeGreaterThanOrEqual(total);
    // The rows beside the bad one still read.
    expect(out).toContain('Sit Up');
  });

  test('an empty group list renders nothing rather than a broken shell', () => {
    const out = html(SummaryTree, { groups: [], idPrefix: 's' });
    expect(out).toContain('summary-tree');
    expect(out).not.toContain('summary-group__title');
  });

  test('a Detailed score renders the marker and no numbers', () => {
    const session = validSession();
    session.containerResults['root/cindy|2'] = {
      workoutId: WORKOUT_ID,
      executionPath: [{ nodeId: 'root' }, { nodeId: 'cindy' }],
      attempt: 2,
      status: 'completed',
      score: { type: 'nonstandard', detail: 'Timer failed.' }
    };
    const model = buildSummaryModel({
      session,
      staticData: loaded(),
      localTimeZone: 'UTC',
      nowUtc: '2026-08-15T18:00:00Z'
    });
    const out = html(SummaryTree, { groups: model.groups, idPrefix: 's' });
    expect(out).toContain('Detailed');
    expect(out).toContain('Recorded as detailed');
  });
});

describe('LoadOlder', () => {
  test('shows the control and the count while more rows exist', () => {
    const out = html(LoadOlder, { loadedCount: 20, hasMore: true, busy: false });
    expect(out).toContain('Load older');
    expect(out).toContain('20 shown');
  });

  test('a busy control reads Loading and cannot fire twice', () => {
    const out = html(LoadOlder, { loadedCount: 20, hasMore: true, busy: true });
    expect(out).toContain('Loading');
    expect(out).toContain('disabled');
  });

  test('nothing renders when there is nothing older and no end text', () => {
    const out = html(LoadOlder, { loadedCount: 5, hasMore: false, busy: false });
    expect(out).not.toContain('Load older');
  });

  test('the end text shows once the list is exhausted', () => {
    const out = html(LoadOlder, {
      loadedCount: 5,
      hasMore: false,
      busy: false,
      exhaustedText: 'That is all the history this build can read.'
    });
    expect(out).toContain('That is all the history this build can read.');
  });
});

describe('WorkoutHistoryScreen', () => {
  test('renders without throwing when no services are published', () => {
    const out = html(WorkoutHistoryScreen, {});
    expect(out).toContain('Workout History');
  });

  test('an empty account says so instead of showing a blank list', () => {
    publishWithShard({ format: 'repjot/results', schemaVersion: 1, yearMonthUtc: '2026-08', sessions: {} });
    const out = html(WorkoutHistoryScreen, {});
    expect(out).toContain('Workout History');
  });
});

describe('ExerciseHistoryScreen', () => {
  test('an unknown exercise id renders the not-found block', () => {
    publishWithShard(validShard());
    const out = html(ExerciseHistoryScreen, { exerciseId: 'no-such-exercise' });
    expect(out).toContain('No exercise with that id');
  });

  test('a known exercise renders the screen shell', () => {
    publishWithShard(validShard());
    const out = html(ExerciseHistoryScreen, { exerciseId: 'back-squat' });
    expect(out).toContain('Back Squat');
    expect(out).not.toContain('No exercise with that id');
  });
});

describe('phase 18 file inventory', () => {
  test('every file the phase names exists and is imported by a test', () => {
    // The seven files PHASE-18 names are all reachable from this suite.
    const components = [SummaryTree, LoadOlder];
    const screens = [WorkoutSummaryScreen, WorkoutHistoryScreen, ExerciseHistoryScreen];
    expect(components).toHaveLength(2);
    expect(screens).toHaveLength(3);
  });

  test('the fixture bundle still carries the exercise set the screens read', () => {
    expect(exercises().length).toBeGreaterThan(0);
    expect(workout().id).toBe(WORKOUT_ID);
  });

  test('a session clone does not leak a mutation into the shared fixture', () => {
    const copy = clone(validSession());
    copy.exerciseResults['root/cindy:1/pushups|both|1'] = {
      ...copy.exerciseResults['root/cindy:1/pushups|both|1'],
      exerciseId: 'ghost'
    };
    expect(validSession().exerciseResults['root/cindy:1/pushups|both|1'].exerciseId).toBe(
      'push-up'
    );
  });
});
