// Query API over the in-memory read model. Phase 12.
// REQUIREMENTS 3.7, 3.19, 17.3, 17.4, 19.3, 19.4, 19.5, 20.1, 20.4.
// specs/storage-and-lookup.md "In-memory read model" and "Loading policy".
//
// Every method answers from a map or a pre-sorted list. No method scans a
// document, and no method sorts on call. A screen that needs a list gets one
// bounded, already-sorted answer in one call.
//
// The service owns one `MutableIndex` and rebuilds only the capped views when
// `extendHistory` merges a shard. It never persists anything. ADR-013.

import type { Exercise, ResultsShard, Workout } from '../domain/types';
import type { Muscle } from '../domain/enums';
import { nodeKey } from '../domain/execution-path';
import type { LoadedStaticData } from '../documents/static-loader';
import type { UnresolvedResult } from '../validation/issues';
import {
  buildIndex,
  DEFAULT_RECENT_LIMIT,
  mergeShards,
  RECENT_SESSION_CAP,
  sortUnresolved,
  type MutableIndex
} from './index-builder';
import type {
  ContainerOccurrence,
  DataIndex,
  ExerciseOccurrence,
  Page,
  PageResult,
  SessionSummary,
  WorkoutNodeLookup
} from './types';

/** How many recent sessions the Choose Workout screen shows. REQUIREMENTS 17.3. */
const DEFAULT_RECENT_SESSIONS = 5;

/** Clamp a caller-supplied page to something safe to slice with. */
function normalizePage(page: Page): { offset: number; limit: number } {
  const offset = Number.isInteger(page.offset) && page.offset >= 0 ? page.offset : 0;
  // A limit below 1 is clamped to 1, not 0. A zero-limit page reports
  // `hasMore: true` over a non-empty list, so a caller that loops on `hasMore`
  // while advancing by `limit` never advances and spins forever.
  const limit = Number.isInteger(page.limit) && page.limit >= 1 ? page.limit : 1;
  return { offset, limit };
}

/** Slice one sorted list into a page and report what lies past the end. */
function pageOf<T>(list: readonly T[], page: Page): PageResult<T> {
  const { offset, limit } = normalizePage(page);
  const items = list.slice(offset, offset + limit);
  return {
    items,
    offset,
    limit,
    total: list.length,
    hasMore: offset + items.length < list.length
  };
}

/** The query surface every screen reads through. */
export interface LookupService {
  getWorkout(id: string): Workout | undefined;
  getExercise(id: string): Exercise | undefined;
  getNode(workoutId: string, nodeId: string): WorkoutNodeLookup | undefined;
  /** `in_progress` sessions, `updatedAtUtc` newest first. REQUIREMENTS 17.4. */
  listActiveSessions(): SessionSummary[];
  /** Completed and abandoned only, newest first, at most five by default. */
  listRecentSessions(limit?: number): SessionSummary[];
  /** All statuses for one workout, `startedAtUtc` newest first. REQUIREMENTS 20.1. */
  getWorkoutHistory(workoutId: string, page: Page): PageResult<SessionSummary>;
  /**
   * Every session across every workout, `startedAtUtc` newest first.
   *
   * The Workout History tab has no workout id, so it cannot use
   * `getWorkoutHistory`. This answers the same paging contract over the
   * whole session set. REQUIREMENTS 20.1. Phase 18.
   */
  listAllSessions(page: Page): PageResult<SessionSummary>;
  /** One exercise's results, newest first. REQUIREMENTS 20.4. */
  getExerciseHistory(exerciseId: string, page: Page): PageResult<ExerciseOccurrence>;
  /** Latest completed occurrence, or `null` when the exercise has none. */
  getLastTime(exerciseId: string): ExerciseOccurrence | null;
  /** Unresolved references, sorted by kind and encoded path. REQUIREMENTS 6.10. */
  getUnresolved(): UnresolvedResult[];
  /** Container scores recorded for one session. */
  getContainerOccurrences(sessionId: string): ContainerOccurrence[];
  /** Exercise IDs that list a muscle as primary or secondary. */
  getExerciseIdsByMuscleGroup(muscle: Muscle): string[];
  /** Merge older shards into the live index without a full rebuild. */
  extendHistory(newShards: ResultsShard[]): void;
  /** Merge unresolved entries into the live index. */
  extendUnresolved(entries: readonly UnresolvedResult[]): void;
  /** The underlying index, for a caller that needs a map directly. */
  readonly index: DataIndex;
}

/**
 * Build a lookup service over the static bundle.
 *
 * `shards` and `unresolved` seed the read model at construction. A caller that
 * has no result data yet passes neither and calls `extendHistory` once the
 * coordinator loads the shards. Both paths land in the same index, so a screen
 * cannot tell which route the data took.
 */
export function createLookupService(input: {
  staticData: LoadedStaticData;
  shards?: ResultsShard[];
  unresolved?: readonly UnresolvedResult[];
  recentLimit?: number;
}): LookupService {
  const recentLimit = input.recentLimit ?? DEFAULT_RECENT_LIMIT;

  // `buildIndex` returns the mutable model, so `extendHistory` merges into the
  // same objects instead of rebuilding from scratch.
  const index: MutableIndex = buildIndex({
    staticData: input.staticData,
    shards: input.shards ?? [],
    unresolved: input.unresolved ?? [],
    recentLimit
  });

  // `getLastTime` walks the exercise's newest-first list and skips anything that
  // belongs to a session still in progress. Requirement 19.4 keeps the active
  // workout out of Last Time, so the badge never shows the set being recorded.
  function getLastTime(exerciseId: string): ExerciseOccurrence | null {
    const list = index.occurrencesByExerciseId.get(exerciseId);
    if (list === undefined) return null;

    for (const occurrence of list) {
      if (occurrence.status !== 'completed') continue;
      const summary = index.sessionsById.get(occurrence.sessionId);
      if (summary === undefined) continue;
      if (summary.status === 'in_progress') continue;
      return occurrence;
    }
    return null;
  }

  return {
    getWorkout: (id: string) => index.workoutById.get(id),
    getExercise: (id: string) => index.exerciseById.get(id),
    getNode: (workoutId: string, nodeId: string) =>
      index.nodeByWorkoutAndId.get(nodeKey(workoutId, nodeId)),

    listActiveSessions: () => [...index.activeSessionsByUpdatedAtUtc],

    listRecentSessions: (limit?: number) => {
      // REQUIREMENTS 17.3 caps the Recent list at five. A larger requested limit
      // does not lift the cap; the full list stays available through
      // `getWorkoutHistory`.
      const size = Math.min(limit ?? DEFAULT_RECENT_SESSIONS, RECENT_SESSION_CAP);
      if (size <= 0) return [];
      return index.terminalSessions.slice(0, size);
    },

    getWorkoutHistory: (workoutId: string, page: Page) =>
      pageOf(index.sessionsByWorkoutId.get(workoutId) ?? [], page),

    listAllSessions: (page: Page) => pageOf(index.allSessionsByStartedAtUtc, page),

    getExerciseHistory: (exerciseId: string, page: Page) =>
      pageOf(index.occurrencesByExerciseId.get(exerciseId) ?? [], page),

    getLastTime,

    getUnresolved: () => [...index.unresolvedResults],

    getContainerOccurrences: (sessionId: string) => [
      ...(index.containerOccurrencesBySessionId.get(sessionId) ?? [])
    ],

    getExerciseIdsByMuscleGroup: (muscle: Muscle) => [
      ...(index.exerciseIdsByMuscleGroup.get(muscle) ?? [])
    ],

    extendHistory: (newShards: ResultsShard[]) => {
      mergeShards(index, newShards);
    },

    extendUnresolved: (entries: readonly UnresolvedResult[]) => {
      index.unresolvedResults = sortUnresolved([...index.unresolvedResults, ...entries]);
    },

    get index() {
      return index;
    }
  };
}
