// The Workout History and Exercise History view models.
// Phase 18. REQUIREMENTS 20.1, 20.2, 20.4, 20.5.
//
// Both models turn a page of already-sorted index rows into the flat list the
// screen draws. They hold the display rules and nothing else: no fetch, no
// store, no Svelte. A test calls them with plain arrays.
//
// Two rules shape this file.
//
// 1. The model never computes a volume total. REQUIREMENTS 20.2 forbids an
//    aggregate workout-volume metric, so no row, header, or footer here adds
//    one up. A row carries its own recorded work and stops there.
// 2. The date label carries the year only when the event is not in the
//    current year. REQUIREMENTS 20.5. The label is built from the local
//    calendar, never from the UTC text, because the user reads local dates.

import type { SessionStatus } from '../../domain/enums';
import type { Quantity } from '../../domain/types';
import type { ExerciseOccurrence, SessionSummary } from '../../indexes/types';
import { formatRoute } from '../../routing/routes';
import { nowUtc as wallClockUtc } from '../../domain/time';
import { formatAlternatingReps, unitLabel } from '../../units/format';
import { formatEditable } from '../../units/conversion';
import type { ResultValues } from '../../domain/types';

/** Sessions per page before the user asks for more. */
export const HISTORY_PAGE_SIZE = 20;

/**
 * The result dimensions, in the order a row prints them.
 *
 * A fixed list, not `Object.entries`, so the print order never follows the key
 * order of the stored object. REQUIREMENTS 3.17.
 */
const RESULT_VALUE_ORDER: readonly (keyof ResultValues)[] = [
  'reps',
  'weight',
  'addedWeight',
  'assistedWeight',
  'distance',
  'duration',
  'calories'
];

/** Status text per session status. The three values are the whole vocabulary. */
const STATUS_LABELS: ReadonlyMap<string, string> = new Map([
  ['in_progress', 'In progress'],
  ['completed', 'Completed'],
  ['abandoned', 'Abandoned']
]);

/** Month short names, indexed by the zero-based month number `Date` returns. */
const MONTH_SHORT_NAMES: readonly string[] = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec'
];

/** One row of a history list. */
export interface HistoryRow {
  /** The session the row came from. */
  sessionId: string;
  /** The workout name, or the exercise name on an Exercise History row. */
  workoutName: string;
  /** `In progress`, `Completed`, or `Abandoned`. */
  statusLabel: string;
  /** `Today 06:30`, `Mar 14`, or `2025-03-14`. See `formatHistoryDate`. */
  dateLabel: string;
  /**
   * The session start as the stored UTC string.
   *
   * The History screen needs it to work out which result shard to ask for
   * next. The label alone cannot answer that, because the label drops the year.
   */
  startedAtUtc: string;
  /** The address the row links to. */
  href: string;
  /**
   * The recorded work, for example `5 reps · 225 lb`.
   *
   * Present on an Exercise History row. A Workout History row leaves it off,
   * because one session holds many results and picking one to show would
   * read as a summary of the session.
   */
  detailLabel?: string;
  /**
   * The alternating per-side split, for example `9 total / 5 left / 4 right`.
   *
   * Present on an Exercise History row whose set was recorded `alternating`
   * and whose stored total splits. REQUIREMENTS 11.7 asks for the total and
   * the per-side values, and the flattened occurrence carries the starting
   * side the split needs.
   */
  alternatingLabel?: string;
  /**
   * True when the row's own summary cannot be resolved further.
   *
   * The row stays in the list. REQUIREMENTS 6.10.
   */
  unresolved?: boolean;
  /** The session summary route for the session this row belongs to. */
  sessionHref?: string;
}

/** The local calendar day as `YYYY-MM-DD`, or `null` when the stamp is unusable. */
function localDay(utc: string, timeZone: string): string | null {
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
    const year = pick('year');
    const month = pick('month');
    const day = pick('day');
    if (year === '' || month === '' || day === '') return null;
    return `${year}-${month}-${day}`;
  } catch {
    return utc.slice(0, 10);
  }
}

/** The local wall-clock time as `HH:MM` on a 24-hour clock. */
function localClock(utc: string, timeZone: string): string | null {
  const date = new Date(utc);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(date);
    const pick = (type: string): string => parts.find((part) => part.type === type)?.value ?? '';
    const hour = pick('hour');
    const minute = pick('minute');
    if (hour === '' || minute === '') return null;
    return `${hour}:${minute}`;
  } catch {
    return utc.slice(11, 16);
  }
}

/** The local four-digit year, or `null` when the stamp is unusable. */
function localYear(utc: string, timeZone: string): string | null {
  const day = localDay(utc, timeZone);
  return day === null ? null : day.slice(0, 4);
}

/** The local day of month, no leading zero. */
function localDayOfMonth(utc: string, timeZone: string): string | null {
  const day = localDay(utc, timeZone);
  if (day === null) return null;
  const parsed = Number(day.slice(8, 10));
  return Number.isNaN(parsed) ? null : `${parsed}`;
}

/** The local short month name. */
function localMonthName(utc: string, timeZone: string): string | null {
  const day = localDay(utc, timeZone);
  if (day === null) return null;
  const index = Number(day.slice(5, 7)) - 1;
  return MONTH_SHORT_NAMES[index] ?? null;
}

/**
 * The history date label for one timestamp.
 *
 * Three forms, and the rule for each is what the user acts on:
 *
 *   `Today 06:30`   the local day is today, so the clock time matters.
 *   `Mar 14`        the local year is this year, so the year carries nothing.
 *   `2025-03-14`   any other year names itself. REQUIREMENTS 20.5.
 *
 * An unusable stamp returns the empty string, so the row renders with no date
 * rather than `Invalid Date`. REQUIREMENTS 6.10.
 */
export function formatHistoryDate(
  utc: string | undefined,
  nowUtcValue: string,
  timeZone: string
): string {
  if (typeof utc !== 'string' || utc.length === 0) return '';
  const day = localDay(utc, timeZone);
  if (day === null) return '';

  if (day === localDay(nowUtcValue, timeZone)) {
    const clock = localClock(utc, timeZone);
    return clock === null ? `Today ${utc.slice(11, 16)}` : `Today ${clock}`;
  }

  const nowYear = localYear(nowUtcValue, timeZone);
  if (nowYear !== null && day.slice(0, 4) === nowYear) {
    const month = localMonthName(utc, timeZone);
    const dayOfMonth = localDayOfMonth(utc, timeZone);
    if (month !== null && dayOfMonth !== null) return `${month} ${dayOfMonth}`;
  }

  return day;
}

/** The status label for one session status. */
export function sessionStatusLabel(status: SessionStatus | string): string {
  return STATUS_LABELS.get(status) ?? status;
}

/**
 * Build the Workout History rows.
 *
 * The input arrives newest first from the index and the model keeps that order,
 * so a page boundary cannot reorder rows and leave a gap. The model adds no
 * total of its own. REQUIREMENTS 20.2.
 */
export function buildWorkoutHistoryModel(
  sessions: readonly SessionSummary[],
  localTimeZone: string,
  nowValue: string = wallClockUtc()
): HistoryRow[] {
  return sessions.map((summary) => ({
    sessionId: summary.id,
    workoutName: summary.workoutName,
    statusLabel: sessionStatusLabel(summary.status),
    dateLabel: formatHistoryDate(summary.startedAtUtc, nowValue, localTimeZone),
    startedAtUtc: summary.startedAtUtc,
    href: formatRoute({ name: 'session-summary', sessionId: summary.id })
  }));
}

/**
 * Build the Exercise History rows.
 *
 * Each row links back to its session summary, so the user can read the whole
 * workout around the one result. The row shows the exercise name, not the
 * workout name, because the screen is already scoped to one exercise.
 * REQUIREMENTS 20.4.
 */
export function buildExerciseHistoryModel(
  occurrences: readonly ExerciseOccurrence[],
  localTimeZone: string,
  nowValue: string = wallClockUtc(),
  exerciseName = ''
): HistoryRow[] {
  return occurrences.map((occurrence) => ({
    sessionId: occurrence.sessionId,
    workoutName: exerciseName === '' ? occurrence.exerciseId : exerciseName,
    statusLabel: sessionStatusLabel(occurrence.status),
    dateLabel: formatHistoryDate(occurrence.completedAtUtc, nowValue, localTimeZone),
    startedAtUtc: occurrence.completedAtUtc,
    href: formatRoute({ name: 'session-summary', sessionId: occurrence.sessionId }),
    detailLabel: formatOccurrenceValues(occurrence),
    alternatingLabel: formatOccurrenceAlternating(occurrence),
    sessionHref: formatRoute({ name: 'session-summary', sessionId: occurrence.sessionId })
  }));
}

/**
 * One quantity on a read-only line.
 *
 * `formatEditable` keeps one decimal because an editable field must show the
 * digit the user types into. A history row is not being edited, so a whole
 * number drops its trailing `.0`: `225 lb`, not `225.0 lb`.
 */
function formatReadQuantity(q: Quantity): string {
  const text = formatEditable(q);
  const trimmed = text.endsWith('.0') ? text.slice(0, -2) : text;
  return `${trimmed} ${unitLabel(q.unit)}`;
}

/**
 * The recorded work of one occurrence, as one line of text.
 *
 * The values print in the unit they were stored in. A history row is a record
 * of what was saved, so it does not re-convert through the current unit
 * preference the way an editable field does.
 *
 * An alternating set prints its total here and its per-side split beside it,
 * through `formatOccurrenceAlternating`. REQUIREMENTS 11.7, 20.4.
 */
export function formatOccurrenceValues(occurrence: ExerciseOccurrence): string {
  return formatResultValues(occurrence.values);
}

/**
 * The alternating per-side split of one occurrence, or `''`.
 *
 * Only an `alternating` set gets a split. A `both` set of the same total is a
 * different record and must not read like one, so the side gate is the whole
 * point: the flattened occurrence carries `startingSide`, and a row that
 * ignores it cannot tell the two apart. The Workout Summary reads the same
 * helper. REQUIREMENTS 11.6, 11.7.
 */
export function formatOccurrenceAlternating(occurrence: ExerciseOccurrence): string {
  if (occurrence.side !== 'alternating') return '';
  return formatAlternatingReps(occurrence.values?.reps, occurrence.startingSide);
}

/**
 * One recorded value set as one line of text, in a fixed dimension order.
 *
 * A fixed list, not `Object.entries`, so the print order never follows the key
 * order of the stored object. REQUIREMENTS 3.17.
 */
export function formatResultValues(values: ResultValues | undefined): string {
  if (values === undefined) return '';
  const parts: string[] = [];
  for (const key of RESULT_VALUE_ORDER) {
    const quantity = values[key];
    if (quantity === undefined) continue;
    parts.push(formatReadQuantity(quantity));
  }
  return parts.join(' · ');
}
