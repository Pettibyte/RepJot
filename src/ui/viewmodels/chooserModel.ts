// The chooser view model.
// REQUIREMENTS section 16, PHASE-16.
//
// The model turns loaded session summaries and the bundled workout list into the
// rows the chooser draws. It holds the display rules and nothing else: no fetch,
// no store, no Svelte. A test calls it with plain arrays.
//
// Three lists, in the order the screen shows them:
//   1. In progress  every session the user has not finished, newest touched first
//   2. Workouts     selected-status workouts in the bundle, paginated
//   3. Recent       finished sessions, capped, with "load older" beyond the cap
//
// The workout list is the path for a user with no history. Without it a new
// account reaches a chooser with nothing to tap.

import type { PublishedStatus, Workout } from '../../domain/types';
import type { SessionSummary } from '../../indexes/types';
import { formatRoute } from '../../routing/routes';

/** Sessions shown in the Recent list before the user asks for more. */
export const RECENT_PAGE_SIZE = 5;

/** Workouts shown before the user asks for more. */
export const WORKOUT_PAGE_SIZE = 10;

/** The chooser starts with the normal published workouts only. */
export const DEFAULT_VISIBLE_WORKOUT_STATUSES: ReadonlySet<PublishedStatus> = new Set(['live']);

/** Status text per session status. The three values are the whole vocabulary. */
const STATUS_LABELS: Record<string, string> = {
  in_progress: 'In progress',
  completed: 'Completed',
  abandoned: 'Abandoned'
};

/** One session row. */
export interface SessionListItemModel {
  sessionId: string;
  /** The workout name carried by the summary. */
  workoutName: string;
  /** 'In progress', 'Completed', or 'Abandoned'. */
  statusLabel: string;
  /** 'Today 06:30' for a session started today, '2026-08-31' for an earlier day. */
  timeLabel: string;
  href: string;
  /**
   * True when the summary names a workout the bundle does not hold.
   *
   * The row stays in the list and the screen draws it as a data error, so one
   * stale reference cannot hide the rows beside it. REQUIREMENTS 15.6.
   */
  unresolvedWorkout: boolean;
  /**
   * The stored session object, re-serialized for the raw viewer.
   * Absent when the shard is not loaded.
   */
  rawJson?: string;
}

/** One workout row. */
export interface WorkoutListItemModel {
  workoutId: string;
  name: string;
  notes?: string;
  href: string;
  /** 'Last: 2026-08-09', or absent when no loaded session covers this workout. */
  lastPerformedLabel?: string;
}

/** Everything the chooser draws. */
export interface ChooserModel {
  /** In-progress sessions, `updatedAtUtc` newest first. */
  active: SessionListItemModel[];
  /** Terminal sessions, capped at the page size, newest first. */
  recent: SessionListItemModel[];
  /** True when terminal sessions exist beyond the Recent page. */
  hasMore: boolean;
  /** The current page of the bundled workout list. */
  workouts: WorkoutListItemModel[];
  /** True when workouts exist beyond the current page. */
  workoutsHasMore: boolean;
}

/** Input to `buildChooserModel`. */
export interface ChooserModelInput {
  /** In-progress sessions. The model filters by status, so a mixed list is fine. */
  active: SessionSummary[];
  /** Terminal sessions, newest first. The model applies the cap. */
  recent: SessionSummary[];
  /** Now, as a UTC ISO string. */
  nowUtc: string;
  /** IANA time zone name, for example 'America/New_York'. */
  localTimeZone: string;
  /** Workout IDs the bundle holds. Omit to treat every reference as resolvable. */
  knownWorkoutIds?: Set<string>;
  /** Every workout in the bundle, in bundle order. */
  workouts?: Workout[];
  /** Statuses selected in the chooser's in-memory visibility filter. */
  visibleStatuses?: ReadonlySet<PublishedStatus>;
  /** First workout of the page. Default 0. */
  workoutOffset?: number;
  /** Workouts per page. Default `WORKOUT_PAGE_SIZE`. */
  workoutLimit?: number;
  /** Most recent terminal session per workout ID, for the 'Last:' label. */
  lastPerformedUtcByWorkoutId?: Map<string, string>;
  /** Sessions per Recent page. Default `RECENT_PAGE_SIZE`. */
  recentLimit?: number;
  /**
   * The raw text for one session, for the **View Raw JSON** action.
   *
   * The model stays pure: it reaches no store. The caller supplies the text,
   * and an empty result leaves `rawJson` off the row. REQUIREMENTS 6.9.
   */
  rawJsonFor?: (summary: SessionSummary) => string;
}

/**
 * The local calendar day as `YYYY-MM-DD`.
 *
 * `formatToParts` is used instead of a locale-formatted string because the
 * field order varies by locale and the day must compare equal across the two
 * dates being tested. A time zone the runtime does not know falls back to the
 * UTC day, which keeps the label wrong by hours rather than throwing.
 */
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

/**
 * The time label for one timestamp.
 *
 * Today shows the clock time, because the user cares about when in the day.
 * Any other day shows the date, because the clock time of a session from last
 * week carries no meaning the user acts on. A prior year carries the year
 * inside the date, so nothing here drops it.
 */
export function formatTimeLabel(utc: string, nowUtc: string, timeZone: string): string {
  const day = localDay(utc, timeZone);
  if (day === null) return '';
  if (day === localDay(nowUtc, timeZone)) {
    const clock = localClock(utc, timeZone);
    return clock === null ? `Today ${utc.slice(11, 16)}` : `Today ${clock}`;
  }
  return day;
}

/**
 * The device time zone as an IANA name, for example 'America/New_York'.
 *
 * `Intl` resolves it on Kindle Silk 80, which the capabilities report confirms.
 * A runtime that returns nothing falls back to UTC, so labels stay readable and
 * wrong by hours rather than broken.
 */
export function resolveLocalTimeZone(): string {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone !== '' ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The date-only label for the 'Last:' line under a workout. */
function formatLastPerformedLabel(utc: string, timeZone: string): string {
  const day = localDay(utc, timeZone);
  return day === null ? '' : `Last: ${day}`;
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function toSessionItem(
  summary: SessionSummary,
  nowUtc: string,
  timeZone: string,
  knownWorkoutIds: Set<string> | undefined,
  rawJsonFor: ((session: SessionSummary) => string) | undefined
): SessionListItemModel {
  // An in-progress session resumes; a finished session opens its summary.
  const route =
    summary.status === 'in_progress'
      ? { name: 'session-active' as const, sessionId: summary.id }
      : { name: 'session-summary' as const, sessionId: summary.id };
  const item: SessionListItemModel = {
    sessionId: summary.id,
    workoutName: summary.workoutName,
    statusLabel: statusLabel(summary.status),
    // REQUIREMENTS 17.5: an in-progress entry shows its start time. The label
    // uses `startedAtUtc` for every row, because that is the timestamp each
    // list sorts by. `updatedAtUtc` stays the active-list sort key, which
    // 17.4 requires.
    timeLabel: formatTimeLabel(summary.startedAtUtc, nowUtc, timeZone),
    href: formatRoute(route),
    unresolvedWorkout: knownWorkoutIds ? !knownWorkoutIds.has(summary.workoutId) : false
  };
  const raw = rawJsonFor?.(summary) ?? '';
  if (raw !== '') item.rawJson = raw;
  return item;
}

/** Newest first by a string key. A missing key sorts last. */
function byNewest(key: (item: SessionSummary) => string): (a: SessionSummary, b: SessionSummary) => number {
  return (a, b) => {
    const left = key(a) ?? '';
    const right = key(b) ?? '';
    if (left === right) return 0;
    return left < right ? 1 : -1;
  };
}

/**
 * Build the chooser model.
 *
 * The active list is re-filtered and re-sorted here even though the lookup
 * returns it ordered. The model owns the ordering the screen shows, so a caller
 * that hands over a mixed list still produces a correct model.
 */
export function buildChooserModel(input: ChooserModelInput): ChooserModel {
  const { nowUtc, localTimeZone } = input;
  const recentLimit = input.recentLimit ?? RECENT_PAGE_SIZE;

  const active = input.active
    .filter((summary) => summary.status === 'in_progress')
    .sort(byNewest((summary) => summary.updatedAtUtc))
    .map((summary) =>
      toSessionItem(summary, nowUtc, localTimeZone, input.knownWorkoutIds, input.rawJsonFor)
    );

  const terminal = input.recent
    .filter((summary) => summary.status !== 'in_progress')
    .sort(byNewest((summary) => summary.startedAtUtc));

  const recent = terminal
    .slice(0, recentLimit)
    .map((summary) =>
      toSessionItem(summary, nowUtc, localTimeZone, input.knownWorkoutIds, input.rawJsonFor)
    );

  // Filter before pagination so an excluded workout cannot consume a row or
  // cause a misleading Show more workouts control.
  const visibleStatuses = input.visibleStatuses ?? DEFAULT_VISIBLE_WORKOUT_STATUSES;
  const all = (input.workouts ?? []).filter((workout) => visibleStatuses.has(workout.publishedStatus));
  const offset = Math.max(0, input.workoutOffset ?? 0);
  const limit = Math.max(0, input.workoutLimit ?? WORKOUT_PAGE_SIZE);
  const workouts = all.slice(offset, offset + limit).map((workout) => {
    const lastUtc = input.lastPerformedUtcByWorkoutId?.get(workout.id);
    const item: WorkoutListItemModel = {
      workoutId: workout.id,
      name: workout.name,
      href: formatRoute({ name: 'workout-overview', workoutId: workout.id })
    };
    if (workout.notes !== undefined) item.notes = workout.notes;
    if (lastUtc !== undefined) {
      const label = formatLastPerformedLabel(lastUtc, localTimeZone);
      if (label !== '') item.lastPerformedLabel = label;
    }
    return item;
  });

  return {
    active,
    recent,
    hasMore: terminal.length > recentLimit,
    workouts,
    workoutsHasMore: offset + limit < all.length
  };
}
