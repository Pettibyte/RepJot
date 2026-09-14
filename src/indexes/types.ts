// The in-memory read model. Phase 12.
// REQUIREMENTS 3.7, 3.16, 3.19, 3.20. ARCHITECTURE ADR-013.
// specs/storage-and-lookup.md "In-memory read model".
//
// Nothing in this file persists. A screen builds one of these at startup from the
// validated static bundle plus the loaded result shards, and throws it away on
// sign-out. ADR-013 forbids writing a derived index to any store, because a
// persisted index can drift from the documents it came from.
//
// Every list here is sorted on an explicit `*Utc` field. No list order comes from
// `Object.keys`, `Map` insertion order, or a `Record` iteration. REQUIREMENTS
// 3.17 and 3.19.

import type { Muscle, ResultStatus, SessionStatus, Side } from '../domain/enums';
import type { PathSegment } from '../domain/execution-path';
import type {
  Exercise,
  ResultValues,
  Score,
  Workout,
  WorkoutNode
} from '../domain/types';
import type { UnresolvedResult } from '../validation/issues';

/**
 * One session, reduced to what a list row needs.
 *
 * The summary carries its own `shardName` so a resume can open the right monthly
 * file without a second lookup. REQUIREMENTS 17.6.
 */
export interface SessionSummary {
  /** The session `id`, which equals its `sessions` map key. */
  id: string;
  workoutId: string;
  /** Resolved from the current bundle. Falls back to the raw `workoutId` when the
   *  workout no longer exists, so a renamed or removed workout still lists. */
  workoutName: string;
  status: SessionStatus;
  startedAtUtc: string;
  updatedAtUtc: string;
  /** The monthly shard that holds this session, for example `results-2026-08.json`. */
  shardName: string;
}

/**
 * One exercise result, flattened out of its session.
 *
 * The occurrence keeps the result's own `exerciseId`, `encodedPath`, `side`,
 * `attempt`, and `values`. A recorded row therefore renders without the workout
 * tree. REQUIREMENTS 6.23.
 */
export interface ExerciseOccurrence {
  sessionId: string;
  /** Read from the result, never derived from the tree. REQUIREMENTS 6.6. */
  exerciseId: string;
  /** The composite `exerciseResults` map key this result was stored under. */
  resultKey: string;
  /** The `executionPath` encoded as it appears inside `resultKey`. */
  encodedPath: string;
  side?: Side;
  attempt: number;
  status: ResultStatus;
  values?: ResultValues;
  /**
   * When the recorded work finished.
   *
   * The result's `endedAtUtc` when it carries one, otherwise the session's
   * `completedAtUtc`, otherwise the session's `startedAtUtc`. The field never
   * orders a list; ordering uses the session `startedAtUtc`.
   */
  completedAtUtc: string;
}

/**
 * One container result, flattened out of its session.
 *
 * Container results sit in their own map because a summary view shows container
 * scores beside the exercise rows, and because a container has no `exerciseId` to
 * index against. The declared spec `DataIndex` sketch omits this field; Phase 12
 * adds it so Phase 18 reads container scores from the index instead of rescanning
 * every session.
 */
export interface ContainerOccurrence {
  sessionId: string;
  /** The container node ID, the last segment of `encodedPath`. */
  containerNodeId: string;
  /** The composite `containerResults` map key. */
  resultKey: string;
  encodedPath: string;
  attempt: number;
  status: ResultStatus;
  score?: Score;
  completedAtUtc: string;
}

/**
 * One workout-tree node, addressed by workout and node ID.
 *
 * A node ID is unique only inside one workout, so the pair forms the key.
 * REQUIREMENTS 6.20 and 22.4.6.
 */
export interface WorkoutNodeLookup {
  workoutId: string;
  nodeId: string;
  node: WorkoutNode;
  /** The node's path from the workout root, inclusive of the node itself. */
  path: PathSegment[];
  /** 1 for the root, 2 for its children, and so on. */
  level: number;
  /**
   * Preorder rank of the node inside its workout, 0 first.
   *
   * The rank is the prescriptive order the workout tree defines. The index uses it
   * to order results that share one session timestamp. REQUIREMENTS 3.20.
   */
  treeRank: number;
}

/** A request for one slice of a list. Offset is zero-based. */
export interface Page {
  offset: number;
  limit: number;
}

/** One slice of a list, plus the total the caller paged over. */
export interface PageResult<T> {
  items: T[];
  offset: number;
  limit: number;
  total: number;
  /** True when items exist past the end of this page. */
  hasMore: boolean;
}

/**
 * The whole read model.
 *
 * The first nine fields match the `DataIndex` shape in
 * `specs/storage-and-lookup.md`. The four that follow carry the full, unbounded
 * lists that paging and the Last Time rule need. The `recent*` fields are capped
 * views for the normal screens; `getExerciseHistory` and `getWorkoutHistory`
 * page over the full lists so `Load older` reaches past the cap.
 */
export interface DataIndex {
  exerciseById: Map<string, Exercise>;
  workoutById: Map<string, Workout>;
  /** Key: `nodeKey(workoutId, nodeId)`, that is `'<workoutId>|<nodeId>'`. */
  nodeByWorkoutAndId: Map<string, WorkoutNodeLookup>;
  /** Primary and secondary muscles both add the exercise. */
  exerciseIdsByMuscleGroup: Map<Muscle, Set<string>>;
  /** Capped at `recentLimit`, newest first by session `startedAtUtc`. */
  recentByExerciseId: Map<string, ExerciseOccurrence[]>;
  /** Capped at `recentLimit`, newest first by session `startedAtUtc`. */
  recentByMuscleGroup: Map<Muscle, ExerciseOccurrence[]>;
  /** Completed and abandoned only, newest first, at most five. REQUIREMENTS 17.3. */
  recentSessions: SessionSummary[];
  /** `in_progress` only, newest first by `updatedAtUtc`. REQUIREMENTS 17.4. */
  activeSessionsByUpdatedAtUtc: SessionSummary[];
  /** Copied through untouched. One bad entry breaks nothing. REQUIREMENTS 6.10. */
  unresolvedResults: UnresolvedResult[];

  /** Every indexed session by `id`. */
  sessionsById: Map<string, SessionSummary>;
  /** All statuses, newest first by `startedAtUtc`. */
  terminalSessions: SessionSummary[];
  /** All statuses for one workout, newest first by `startedAtUtc`. */
  sessionsByWorkoutId: Map<string, SessionSummary[]>;
  /** Full history for one exercise, newest first. */
  occurrencesByExerciseId: Map<string, ExerciseOccurrence[]>;
  /** Full container scores for one session. */
  containerOccurrencesBySessionId: Map<string, ContainerOccurrence[]>;
}
