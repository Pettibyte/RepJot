// Phase 18: the Workout History and Exercise History view models.
//
// The tests hold the display rules: the date label changes form with distance
// from today, the year appears only outside the current year, and no model
// adds a volume total. REQUIREMENTS 20.1, 20.2, 20.4, 20.5.

import { describe, expect, test } from 'bun:test';
import type { ExerciseOccurrence, SessionSummary } from '../src/indexes/types';
import {
  HISTORY_PAGE_SIZE,
  buildExerciseHistoryModel,
  buildWorkoutHistoryModel,
  formatHistoryDate,
  formatResultValues,
  sessionStatusLabel
} from '../src/ui/viewmodels/historyModel';

/** A fixed "now" so no test depends on the wall clock. */
const NOW = '2026-08-15T18:00:00Z';

function summary(overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 'session-a',
    workoutId: 'demo',
    workoutName: 'Demo Workout',
    status: 'completed',
    startedAtUtc: '2026-08-15T14:30:00Z',
    completedAtUtc: '2026-08-15T15:05:00Z',
    updatedAtUtc: '2026-08-15T15:05:00Z',
    ...overrides
  } as SessionSummary;
}

function occurrence(overrides: Partial<ExerciseOccurrence> = {}): ExerciseOccurrence {
  return {
    sessionId: 'session-a',
    exerciseId: 'back-squat',
    resultKey: 'root/squat-sets:1/back-squat-set|both|1',
    encodedPath: 'root/squat-sets:1/back-squat-set',
    attempt: 1,
    status: 'completed',
    values: { reps: { value: 5, unit: 'reps' }, weight: { value: 225, unit: 'lb' } },
    completedAtUtc: '2026-08-15T14:40:00Z',
    ...overrides
  } as ExerciseOccurrence;
}

describe('formatHistoryDate', () => {
  test('today reads with the clock time', () => {
    expect(formatHistoryDate('2026-08-15T06:30:00Z', NOW, 'UTC')).toBe('Today 06:30');
    expect(formatHistoryDate('2026-08-15T23:59:00Z', NOW, 'UTC')).toBe('Today 23:59');
  });

  test('inside the current year the year is dropped', () => {
    expect(formatHistoryDate('2026-03-14T09:00:00Z', NOW, 'UTC')).toBe('Mar 14');
    expect(formatHistoryDate('2026-12-01T09:00:00Z', NOW, 'UTC')).toBe('Dec 1');
  });

  test('outside the current year the full date prints', () => {
    expect(formatHistoryDate('2025-03-14T09:00:00Z', NOW, 'UTC')).toBe('2025-03-14');
    expect(formatHistoryDate('2027-01-05T09:00:00Z', NOW, 'UTC')).toBe('2027-01-05');
  });

  test('the day boundary follows the local zone, not the UTC text', () => {
    // NOW is 2026-08-15T18:00Z, which is already 2026-08-16 in Tokyo. A stamp
    // that reads as today in UTC reads as yesterday in Tokyo, so the two zones
    // must not agree. The label follows the zone the caller named.
    expect(formatHistoryDate('2026-08-15T20:00:00Z', NOW, 'UTC')).toBe('Today 20:00');
    expect(formatHistoryDate('2026-08-15T20:00:00Z', NOW, 'Asia/Tokyo')).toBe('Today 05:00');
    // A stamp two hours before NOW is today in both zones.
    expect(formatHistoryDate('2026-08-15T16:00:00Z', NOW, 'UTC')).toBe('Today 16:00');
  });

  test('an empty or missing stamp reads as no date', () => {
    expect(formatHistoryDate('', NOW, 'UTC')).toBe('');
    expect(formatHistoryDate(undefined, NOW, 'UTC')).toBe('');
  });

  test('an unparseable stamp reads as no date rather than Invalid Date', () => {
    const label = formatHistoryDate('not-a-timestamp', NOW, 'UTC');
    expect(label).toBe('');
  });
});

describe('sessionStatusLabel', () => {
  test('covers the three session statuses', () => {
    expect(sessionStatusLabel('in_progress')).toBe('In progress');
    expect(sessionStatusLabel('completed')).toBe('Completed');
    expect(sessionStatusLabel('abandoned')).toBe('Abandoned');
  });

  test('passes an unknown status through unchanged', () => {
    expect(sessionStatusLabel('something_new')).toBe('something_new');
  });
});

describe('formatResultValues', () => {
  test('prints dimensions in a fixed order', () => {
    const label = formatResultValues({
      duration: { value: 300, unit: 'second' },
      reps: { value: 5, unit: 'reps' },
      weight: { value: 225, unit: 'lb' }
    });
    expect(label).toBe('5 reps · 225 lb · 300 s');
  });

  test('a whole number drops the trailing decimal zero', () => {
    expect(formatResultValues({ weight: { value: 225, unit: 'lb' } })).toBe('225 lb');
  });

  test('a fractional value keeps its decimal', () => {
    expect(formatResultValues({ weight: { value: 225.5, unit: 'lb' } })).toBe('225.5 lb');
  });

  test('skips absent dimensions', () => {
    expect(formatResultValues({ reps: { value: 12, unit: 'reps' } })).toBe('12 reps');
  });

  test('an empty or missing value set prints nothing', () => {
    expect(formatResultValues({})).toBe('');
    expect(formatResultValues(undefined)).toBe('');
  });
});

describe('buildWorkoutHistoryModel', () => {
  test('maps each session to a row that links to its summary', () => {
    const rows = buildWorkoutHistoryModel([summary()], 'UTC', NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].workoutName).toBe('Demo Workout');
    expect(rows[0].statusLabel).toBe('Completed');
    expect(rows[0].href).toBe('#/sessions/session-a/summary');
    expect(rows[0].startedAtUtc).toBe('2026-08-15T14:30:00Z');
  });

  test('keeps the order it is given', () => {
    const rows = buildWorkoutHistoryModel(
      [summary({ id: 'newest' }), summary({ id: 'older' })],
      'UTC',
      NOW
    );
    expect(rows.map((row) => row.sessionId)).toEqual(['newest', 'older']);
  });

  test('adds no volume total to any row', () => {
    const rows = buildWorkoutHistoryModel([summary()], 'UTC', NOW);
    const text = JSON.stringify(rows);
    // REQUIREMENTS 20.2: no aggregate workout-volume metric.
    expect(text).not.toContain('total');
    expect(text).not.toContain('volume');
    expect(rows[0].detailLabel).toBeUndefined();
  });

  test('an empty list produces no rows', () => {
    expect(buildWorkoutHistoryModel([], 'UTC', NOW)).toEqual([]);
  });

  test('an in-progress session reads In progress', () => {
    const rows = buildWorkoutHistoryModel(
      [summary({ status: 'in_progress' as SessionSummary['status'] })],
      'UTC',
      NOW
    );
    expect(rows[0].statusLabel).toBe('In progress');
  });

  test('an abandoned session reads Abandoned', () => {
    const rows = buildWorkoutHistoryModel(
      [summary({ status: 'abandoned' as SessionSummary['status'] })],
      'UTC',
      NOW
    );
    expect(rows[0].statusLabel).toBe('Abandoned');
  });

  test('a session from another year carries the year in its label', () => {
    const rows = buildWorkoutHistoryModel(
      [summary({ startedAtUtc: '2024-11-02T10:00:00Z' })],
      'UTC',
      NOW
    );
    expect(rows[0].dateLabel).toBe('2024-11-02');
  });
});

describe('buildExerciseHistoryModel', () => {
  test('maps each occurrence to a row that links back to its session', () => {
    const rows = buildExerciseHistoryModel([occurrence()], 'UTC', NOW, 'Back Squat');
    expect(rows).toHaveLength(1);
    expect(rows[0].href).toBe('#/sessions/session-a/summary');
    expect(rows[0].workoutName).toBe('Back Squat');
  });

  test('the row carries the recorded work as its detail', () => {
    const rows = buildExerciseHistoryModel([occurrence()], 'UTC', NOW, 'Back Squat');
    expect(rows[0].detailLabel).toContain('5 reps');
    expect(rows[0].detailLabel).toContain('225 lb');
  });

  test('an occurrence with no values has an empty detail', () => {
    const rows = buildExerciseHistoryModel(
      [occurrence({ values: undefined })],
      'UTC',
      NOW,
      'Back Squat'
    );
    expect(rows[0].detailLabel).toBe('');
  });

  test('falls back to the exercise id when no name is given', () => {
    const rows = buildExerciseHistoryModel([occurrence()], 'UTC', NOW);
    expect(rows[0].workoutName).toBe('back-squat');
  });

  test('keeps the order it is given', () => {
    const rows = buildExerciseHistoryModel(
      [
        occurrence({ sessionId: 'newer' }),
        occurrence({ sessionId: 'older' })
      ],
      'UTC',
      NOW,
      'Back Squat'
    );
    expect(rows.map((row) => row.sessionId)).toEqual(['newer', 'older']);
  });

  test('dates the row from the completion stamp', () => {
    const rows = buildExerciseHistoryModel(
      [occurrence({ completedAtUtc: '2025-05-05T08:00:00Z' })],
      'UTC',
      NOW,
      'Back Squat'
    );
    expect(rows[0].dateLabel).toBe('2025-05-05');
  });

  test('an empty list produces no rows', () => {
    expect(buildExerciseHistoryModel([], 'UTC', NOW, 'Back Squat')).toEqual([]);
  });

  test('adds no aggregate across rows', () => {
    const rows = buildExerciseHistoryModel(
      [occurrence(), occurrence({ sessionId: 'b' })],
      'UTC',
      NOW,
      'Back Squat'
    );
    // Each row reports only its own work. No row sums the two.
    expect(rows[0].detailLabel).toBe(rows[1].detailLabel);
    expect(rows).toHaveLength(2);
  });
});

describe('HISTORY_PAGE_SIZE', () => {
  test('is a positive page size that fits a Kindle screen fold', () => {
    expect(HISTORY_PAGE_SIZE).toBeGreaterThan(0);
    expect(HISTORY_PAGE_SIZE).toBeLessThanOrEqual(50);
  });
});
