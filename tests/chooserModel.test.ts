// Tests for the chooser view model.
// PHASE-16 checklist: active before recent, recent capped at five and excludes
// in-progress, the time-label rule, and `hasMore`.

import { describe, expect, test } from 'bun:test';

import type { SessionStatus } from '../src/domain/enums';
import type { SessionSummary } from '../src/indexes/types';
import type { Workout } from '../src/domain/types';
import {
  buildChooserModel,
  formatTimeLabel,
  RECENT_PAGE_SIZE,
  resolveLocalTimeZone
} from '../src/ui/viewmodels/chooserModel';

/** Fixed now: 2026-09-15 12:00 UTC. */
const NOW = '2026-09-15T12:00:00Z';
const TZ = 'UTC';

function summary(
  id: string,
  status: SessionStatus,
  startedAtUtc: string,
  updatedAtUtc: string,
  workoutId = 'w-1',
  workoutName = 'Demo Workout'
): SessionSummary {
  return {
    id,
    workoutId,
    workoutName,
    status,
    startedAtUtc,
    updatedAtUtc,
    shardName: `results-${startedAtUtc.slice(0, 7)}.json`
  };
}

function makeWorkout(
  id: string,
  name: string,
  publishedStatus: Workout['publishedStatus'] = 'live'
): Workout {
  return {
    id,
    name,
    publishedStatus,
    root: {
      id: `${id}-root`,
      type: 'container',
      strategy: 'sequence',
      strategyConfig: {},
      children: []
    }
  };
}

describe('buildChooserModel: session lists', () => {
  test('active holds every in-progress session, updatedAt newest first', () => {
    const model = buildChooserModel({
      active: [
        summary('old', 'in_progress', '2026-09-14T08:00:00Z', '2026-09-14T09:00:00Z'),
        summary('newest', 'in_progress', '2026-09-15T06:00:00Z', '2026-09-15T11:30:00Z'),
        summary('middle', 'in_progress', '2026-09-13T06:00:00Z', '2026-09-15T05:00:00Z')
      ],
      recent: [],
      nowUtc: NOW,
      localTimeZone: TZ
    });

    expect(model.active.map((item) => item.sessionId)).toEqual(['newest', 'middle', 'old']);
  });

  test('active drops anything that is not in progress', () => {
    const model = buildChooserModel({
      active: [
        summary('a', 'in_progress', '2026-09-15T06:00:00Z', '2026-09-15T07:00:00Z'),
        summary('b', 'completed', '2026-09-15T06:00:00Z', '2026-09-15T08:00:00Z'),
        summary('c', 'abandoned', '2026-09-15T06:00:00Z', '2026-09-15T08:00:00Z')
      ],
      recent: [],
      nowUtc: NOW,
      localTimeZone: TZ
    });

    expect(model.active.map((item) => item.sessionId)).toEqual(['a']);
  });

  test('recent holds terminal sessions only, never an in-progress one', () => {
    const model = buildChooserModel({
      active: [summary('live', 'in_progress', '2026-09-15T06:00:00Z', '2026-09-15T07:00:00Z')],
      recent: [
        summary('done', 'completed', '2026-09-14T06:00:00Z', '2026-09-14T07:00:00Z'),
        summary('left', 'abandoned', '2026-09-13T06:00:00Z', '2026-09-13T07:00:00Z')
      ],
      nowUtc: NOW,
      localTimeZone: TZ
    });

    expect(model.recent.map((item) => item.sessionId)).toEqual(['done', 'left']);
    expect(model.recent.some((item) => item.sessionId === 'live')).toBe(false);
  });

  test('recent caps at five and reports hasMore', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      summary(`s${i}`, 'completed', `2026-09-${String(1 + i).padStart(2, '0')}T06:00:00Z`, NOW)
    );

    const model = buildChooserModel({
      active: [],
      recent: many,
      nowUtc: NOW,
      localTimeZone: TZ
    });

    expect(RECENT_PAGE_SIZE).toBe(5);
    expect(model.recent.length).toBe(5);
    expect(model.hasMore).toBe(true);
  });

  test('hasMore is false when the terminal list fits the cap', () => {
    const few = Array.from({ length: 5 }, (_, i) =>
      summary(`s${i}`, 'completed', `2026-09-${String(1 + i).padStart(2, '0')}T06:00:00Z`, NOW)
    );

    const model = buildChooserModel({
      active: [],
      recent: few,
      nowUtc: NOW,
      localTimeZone: TZ
    });

    expect(model.recent.length).toBe(5);
    expect(model.hasMore).toBe(false);
  });

  test('a larger recentLimit reveals older sessions', () => {
    const many = Array.from({ length: 8 }, (_, i) =>
      summary(`s${i}`, 'completed', `2026-09-${String(1 + i).padStart(2, '0')}T06:00:00Z`, NOW)
    );

    const model = buildChooserModel({
      active: [],
      recent: many,
      nowUtc: NOW,
      localTimeZone: TZ,
      recentLimit: 8
    });

    expect(model.recent.length).toBe(8);
    expect(model.hasMore).toBe(false);
  });

  test('each row links an in-progress session to resume and a terminal one to summary', () => {
    const model = buildChooserModel({
      active: [summary('live', 'in_progress', '2026-09-15T06:00:00Z', '2026-09-15T07:00:00Z')],
      recent: [summary('done', 'completed', '2026-09-14T06:00:00Z', '2026-09-14T07:00:00Z')],
      nowUtc: NOW,
      localTimeZone: TZ
    });

    expect(model.active[0].href).toBe('#/sessions/live/active');
    expect(model.recent[0].href).toBe('#/sessions/done/summary');
  });

  test('status labels read as the three product words', () => {
    const model = buildChooserModel({
      active: [summary('a', 'in_progress', '2026-09-15T06:00:00Z', '2026-09-15T07:00:00Z')],
      recent: [
        summary('b', 'completed', '2026-09-14T06:00:00Z', '2026-09-14T07:00:00Z'),
        summary('c', 'abandoned', '2026-09-13T06:00:00Z', '2026-09-13T07:00:00Z')
      ],
      nowUtc: NOW,
      localTimeZone: TZ
    });

    expect(model.active[0].statusLabel).toBe('In progress');
    expect(model.recent[0].statusLabel).toBe('Completed');
    expect(model.recent[1].statusLabel).toBe('Abandoned');
  });

  test('a session whose workout is not in the bundle is marked, not dropped', () => {
    const model = buildChooserModel({
      active: [],
      recent: [
        summary('gone', 'completed', '2026-09-14T06:00:00Z', NOW, 'missing-w', 'Old Workout'),
        summary('kept', 'completed', '2026-09-13T06:00:00Z', NOW, 'w-1', 'Demo Workout')
      ],
      nowUtc: NOW,
      localTimeZone: TZ,
      knownWorkoutIds: new Set(['w-1'])
    });

    expect(model.recent.length).toBe(2);
    expect(model.recent[0].unresolvedWorkout).toBe(true);
    expect(model.recent[1].unresolvedWorkout).toBe(false);
  });

  // REQUIREMENTS 17.5. A session started before midnight and touched after
  // midnight must not read "Today".
  test('an in-progress session started yesterday shows the date, not Today', () => {
    const model = buildChooserModel({
      active: [
        summary('overnight', 'in_progress', '2026-09-14T22:10:00Z', '2026-09-15T06:00:00Z')
      ],
      recent: [],
      nowUtc: NOW,
      localTimeZone: TZ
    });

    expect(model.active[0].timeLabel).toBe('2026-09-14');
  });

  // The Recent list sorts by `startedAtUtc`, so its labels must read newest
  // first by the same key. A label from `updatedAtUtc` breaks the column.
  test('the Recent column reads newest first by its own labels', () => {
    const model = buildChooserModel({
      active: [],
      recent: [
        summary('a', 'completed', '2026-08-03T06:00:00Z', '2026-08-03T07:00:00Z'),
        summary('b', 'completed', '2026-08-01T06:00:00Z', '2026-08-05T09:00:00Z'),
        summary('c', 'completed', '2026-07-30T06:00:00Z', '2026-07-30T07:00:00Z')
      ],
      nowUtc: NOW,
      localTimeZone: TZ
    });

    const labels = model.recent.map((item) => item.timeLabel);
    expect(labels).toEqual(['2026-08-03', '2026-08-01', '2026-07-30']);
  });

  // REQUIREMENTS 6.9. The raw text reaches the row only when the caller can
  // supply it. An empty result leaves the field off, so the row keeps the
  // shard text absent and the component falls back to the row facts.
  test('a rawJson resolver puts the text on the row', () => {
    const model = buildChooserModel({
      active: [],
      recent: [summary('s1', 'completed', '2026-09-14T06:00:00Z', NOW)],
      nowUtc: NOW,
      localTimeZone: TZ,
      rawJsonFor: (session: SessionSummary): string => `{\"id\":\"${session.id}\"}`
    });

    expect(model.recent[0].rawJson).toBe('{"id":"s1"}');
  });

  test('an empty resolver leaves rawJson absent on the row', () => {
    const model = buildChooserModel({
      active: [],
      recent: [summary('s1', 'completed', '2026-09-14T06:00:00Z', NOW)],
      nowUtc: NOW,
      localTimeZone: TZ,
      rawJsonFor: (): string => ''
    });

    expect(model.recent[0].rawJson).toBeUndefined();
  });

  test('with no resolver at all no row carries raw text', () => {
    const model = buildChooserModel({
      active: [summary('live', 'in_progress', '2026-09-15T06:00:00Z', NOW)],
      recent: [summary('done', 'completed', '2026-09-14T06:00:00Z', NOW)],
      nowUtc: NOW,
      localTimeZone: TZ
    });

    expect(model.active[0].rawJson).toBeUndefined();
    expect(model.recent[0].rawJson).toBeUndefined();
  });
});

describe('buildChooserModel: workout list', () => {
  const workouts = Array.from({ length: 14 }, (_, i) => makeWorkout(`w${i}`, `Workout ${i}`));

  test('the first page holds ten workouts and reports more', () => {
    const model = buildChooserModel({
      active: [],
      recent: [],
      nowUtc: NOW,
      localTimeZone: TZ,
      workouts
    });

    expect(model.workouts.length).toBe(10);
    expect(model.workouts[0].workoutId).toBe('w0');
    expect(model.workoutsHasMore).toBe(true);
  });

  test('the second page holds the rest and reports no more', () => {
    const model = buildChooserModel({
      active: [],
      recent: [],
      nowUtc: NOW,
      localTimeZone: TZ,
      workouts,
      workoutOffset: 10
    });

    expect(model.workouts.map((item) => item.workoutId)).toEqual(['w10', 'w11', 'w12', 'w13']);
    expect(model.workoutsHasMore).toBe(false);
  });

  test('a workout with no history carries no last-performed label', () => {
    const model = buildChooserModel({
      active: [],
      recent: [],
      nowUtc: NOW,
      localTimeZone: TZ,
      workouts: [makeWorkout('w1', 'One')]
    });

    expect(model.workouts[0].lastPerformedLabel).toBeUndefined();
  });

  test('a workout with history carries a date-only last-performed label', () => {
    const model = buildChooserModel({
      active: [],
      recent: [],
      nowUtc: NOW,
      localTimeZone: TZ,
      workouts: [makeWorkout('w1', 'One')],
      lastPerformedUtcByWorkoutId: new Map([['w1', '2026-08-09T06:30:00Z']])
    });

    expect(model.workouts[0].lastPerformedLabel).toBe('Last: 2026-08-09');
  });

  test('a workout links to its overview', () => {
    const model = buildChooserModel({
      active: [],
      recent: [],
      nowUtc: NOW,
      localTimeZone: TZ,
      workouts: [makeWorkout('w1', 'One')]
    });

    expect(model.workouts[0].href).toBe('#/workouts/w1');
  });

  test('hides deprecated workouts before pagination', () => {
    const model = buildChooserModel({
      active: [],
      recent: [],
      nowUtc: NOW,
      localTimeZone: TZ,
      workoutLimit: 1,
      workouts: [
        makeWorkout('deprecated', 'Old workout', 'deprecated'),
        makeWorkout('live', 'Current workout')
      ]
    });

    expect(model.workouts.map((item) => item.workoutId)).toEqual(['live']);
    expect(model.workoutsHasMore).toBe(false);
  });
});

describe('formatTimeLabel', () => {
  test('today shows the clock time', () => {
    expect(formatTimeLabel('2026-09-15T06:30:00Z', NOW, 'UTC')).toBe('Today 06:30');
  });

  test('an earlier day shows the date', () => {
    expect(formatTimeLabel('2026-09-14T23:30:00Z', NOW, 'UTC')).toBe('2026-09-14');
  });

  test('a prior year keeps the year inside the date', () => {
    expect(formatTimeLabel('2025-08-31T06:30:00Z', NOW, 'UTC')).toBe('2025-08-31');
  });

  test('the label follows the time zone, not the UTC day', () => {
    // 2026-09-15T02:00Z is 21:00 on the 14th in New York, so it is not today.
    expect(formatTimeLabel('2026-09-15T02:00:00Z', NOW, 'America/New_York')).toBe('2026-09-14');
    // 2026-09-15T14:00Z is 10:00 on the 15th in New York, so it is today.
    expect(formatTimeLabel('2026-09-15T14:00:00Z', NOW, 'America/New_York')).toBe('Today 10:00');
  });

  test('an unparseable timestamp yields an empty label', () => {
    expect(formatTimeLabel('not-a-date', NOW, 'UTC')).toBe('');
  });
});

describe('resolveLocalTimeZone', () => {
  test('returns a non-empty IANA-style name', () => {
    const zone = resolveLocalTimeZone();
    expect(typeof zone).toBe('string');
    expect(zone.length).toBeGreaterThan(0);
  });
});
