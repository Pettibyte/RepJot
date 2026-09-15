// Builds the in-memory read model from validated documents. Phase 12.
// REQUIREMENTS 3.7, 3.16, 3.17, 3.19, 3.20, 6.10, 6.23, 17.3, 17.4.
// specs/storage-and-lookup.md "In-memory read model", ARCHITECTURE ADR-013.
//
// Three rules shape this file.
//
// 1. Explicit sorts only. Every list passes through a comparator that names a
//    `*Utc` field or a tree rank. Nothing here reads `Object.keys`, and nothing
//    relies on the order a `Map` or a `Record` iterates in. REQUIREMENTS 3.17.
// 2. Timestamps compare as numbers, never as text. A whole-second stamp and a
//    fractional one are equal instants but unequal strings, and `'.'` sorts below
//    `'Z'`, so a text compare puts the later instant first. `timeValue` parses
//    once and every comparator uses the number.
// 3. Recorded work indexes from the result's own fields. The tree orders a result
//    but never supplies its `exerciseId` or its values. REQUIREMENTS 6.23.

import type { Muscle } from '../domain/enums';
import { encodePath, nodeKey, type PathSegment } from '../domain/execution-path';
import type {
  ContainerResult,
  ExerciseResult,
  ResultsShard,
  Session,
  Workout,
  WorkoutNode
} from '../domain/types';
import { shardName } from '../domain/time';
import type { LoadedStaticData } from '../documents/static-loader';
import type { UnresolvedResult } from '../validation/issues';
import {
  type ContainerOccurrence,
  type DataIndex,
  type ExerciseOccurrence,
  type SessionSummary,
  type WorkoutNodeLookup
} from './types';

/** Recent-list cap when the caller passes none. */
export const DEFAULT_RECENT_LIMIT = 50;

/** The Choose Workout screen shows at most five recent sessions. REQUIREMENTS 17.3. */
export const RECENT_SESSION_CAP = 5;

/** Sort key for a timestamp. Unparsable or absent sorts below every real instant. */
function timeValue(value: string | undefined): number {
  if (typeof value !== 'string') return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/**
 * Compare two numbers without subtracting.
 *
 * Subtraction is the trap this file avoids. `Infinity - Infinity` and
 * `-Infinity - -Infinity` are both `NaN`, and `NaN !== 0` is `true`, so a
 * subtracting comparator returns `NaN` for exactly the tied pair it was supposed
 * to break, and the caller never reaches the next tie-break. `insertSorted` then
 * tests `NaN <= 0`, gets `false`, and inserts at index 0, which makes the list
 * order depend on insertion order. REQUIREMENTS 3.17 and 3.19.
 */
function compareNumbers(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Newest first by one timestamp field, then by `id` so ties stay deterministic. */
function newestSessionFirst(a: SessionSummary, b: SessionSummary): number {
  const byStart = compareNumbers(timeValue(b.startedAtUtc), timeValue(a.startedAtUtc));
  if (byStart !== 0) return byStart;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Newest first by `updatedAtUtc`, then by `id`. REQUIREMENTS 17.4. */
function newestUpdatedFirst(a: SessionSummary, b: SessionSummary): number {
  const byUpdate = compareNumbers(timeValue(b.updatedAtUtc), timeValue(a.updatedAtUtc));
  if (byUpdate !== 0) return byUpdate;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Newest first by the owning session's `startedAtUtc`.
 *
 * The session start, not the result's own timestamp, orders an occurrence, so
 * every row of one workout moves together through history. Phase 12 ordering
 * rule 4.
 */
function occurrenceComparator(
  sessionStarts: Map<string, string>
): (a: ExerciseOccurrence, b: ExerciseOccurrence) => number {
  return (a, b) => {
    const byStart = compareNumbers(
      timeValue(sessionStarts.get(b.sessionId)),
      timeValue(sessionStarts.get(a.sessionId))
    );
    if (byStart !== 0) return byStart;
    return compareOccurrenceWithinSession(a, b);
  };
}

/**
 * Order two occurrences inside one session: tree order first, encoded path second.
 *
 * A node the current tree resolves sorts ahead of one it does not, and two
 * unresolvable nodes fall back to the encoded `executionPath` string.
 * REQUIREMENTS 3.20 and 6.23.
 */
function compareOccurrenceWithinSession(a: ExerciseOccurrence, b: ExerciseOccurrence): number {
  const byPath = comparePathKeys(pathKeyOf(a), pathKeyOf(b));
  if (byPath !== 0) return byPath;
  if (a.encodedPath !== b.encodedPath) return a.encodedPath < b.encodedPath ? -1 : 1;
  return a.resultKey < b.resultKey ? -1 : a.resultKey > b.resultKey ? 1 : 0;
}

/** Tree path key of an occurrence, or the unresolved key when the tree cannot place it. */
function pathKeyOf(occurrence: ExerciseOccurrence): readonly number[] {
  return occurrencePathKey.get(occurrence) ?? UNRESOLVED_PATH_KEY;
}

/**
 * Compare two tree path keys segment by segment.
 *
 * A key holds the preorder rank of each path segment followed by that segment's
 * iteration, so the compare follows the workout tree and orders round 2 ahead of
 * round 10. A key that is a prefix of the other sorts first, which places an
 * ancestor ahead of its own descendants and matches preorder.
 */
function comparePathKeys(a: readonly number[], b: readonly number[]): number {
  const shared = Math.min(a.length, b.length);
  for (let i = 0; i < shared; i += 1) {
    const bySegment = compareNumbers(a[i] as number, b[i] as number);
    if (bySegment !== 0) return bySegment;
  }
  return compareNumbers(a.length, b.length);
}

/**
 * Side table of tree path keys, keyed by occurrence object identity.
 *
 * The public `ExerciseOccurrence` shape comes from the spec and carries no rank
 * field, so the builder keeps the key beside the objects it created instead of
 * widening that shape. `mergeSession` fills the same table for shards added
 * through `extendHistory`, which keeps one comparator valid across both paths.
 */
const occurrencePathKey = new WeakMap<ExerciseOccurrence, readonly number[]>();

/**
 * Rank for a row the tree cannot place, and the key that carries it.
 *
 * `UNRESOLVED_RANK` sorts behind every finite rank. Two unresolved rows tie here
 * and fall through to the encoded-path compare, which is the fallback
 * REQUIREMENTS 6.23 asks for.
 */
const UNRESOLVED_RANK = Number.POSITIVE_INFINITY;
const UNRESOLVED_PATH_KEY: readonly number[] = Object.freeze([UNRESOLVED_RANK]);

/**
 * Walk one workout tree in preorder and index every node.
 *
 * The preorder rank is the prescriptive order of the workout: a node sorts before
 * its own children, and a child sorts before its next sibling. Phase 12 ordering
 * rule 5 uses the rank only as a tie-break inside one session, because the
 * session start dominates across sessions.
 */
function indexWorkoutNodes(
  workout: Workout,
  into: Map<string, WorkoutNodeLookup>
): void {
  let rank = 0;

  const walk = (node: WorkoutNode, parentPath: PathSegment[], level: number): void => {
    const path: PathSegment[] = [...parentPath, { nodeId: node.id }];
    into.set(nodeKey(workout.id, node.id), {
      workoutId: workout.id,
      nodeId: node.id,
      node,
      path,
      level,
      treeRank: rank
    });
    rank += 1;
    if (node.type === 'container') {
      for (const child of node.children) walk(child, path, level + 1);
    }
  };

  walk(workout.root, [], 1);
}

/**
 * Encode a result path, or return `''` when the path cannot encode.
 *
 * A malformed path is already an unresolved reference upstream. The index keeps
 * the row with an empty path rather than throwing, because one bad entry must not
 * break the build. REQUIREMENTS 6.10.
 */
function safeEncodePath(segments: PathSegment[] | undefined): string {
  if (!Array.isArray(segments) || segments.length === 0) return '';
  try {
    return encodePath(segments);
  } catch {
    return '';
  }
}

/**
 * Build the tree path key for one result, or `null` when the tree cannot place it.
 *
 * The key carries the preorder rank of every segment plus that segment's
 * iteration, so the compare follows the tree rather than the encoded string.
 * Round 2 of a container sorts ahead of round 10 because the iteration compares
 * as a number. A path with any missing ancestor, including the leaf, is
 * unresolved and returns `null`, which matches the broken-path rule in
 * REQUIREMENTS 6.8.
 */
function buildPathKey(
  nodes: Map<string, WorkoutNodeLookup>,
  workoutId: string,
  segments: PathSegment[] | undefined
): number[] | null {
  if (!Array.isArray(segments) || segments.length === 0) return null;

  const key: number[] = [];
  for (const segment of segments) {
    if (segment === undefined || typeof segment.nodeId !== 'string') return null;
    const lookup = nodes.get(nodeKey(workoutId, segment.nodeId));
    if (lookup === undefined) return null;
    key.push(lookup.treeRank, segment.iteration ?? 0);
  }
  return key;
}

/** Tree path key of one result, or the unresolved key when the tree cannot place it. */
function pathKeyFor(
  nodes: Map<string, WorkoutNodeLookup>,
  workoutId: string,
  segments: PathSegment[] | undefined
): readonly number[] {
  return buildPathKey(nodes, workoutId, segments) ?? UNRESOLVED_PATH_KEY;
}

/** When a recorded row finished: its own end, then the session end, then the start. */
function completedAt(resultEnd: string | undefined, session: Session): string {
  if (typeof resultEnd === 'string' && resultEnd.length > 0) return resultEnd;
  if (typeof session.completedAtUtc === 'string' && session.completedAtUtc.length > 0) {
    return session.completedAtUtc;
  }
  return session.startedAtUtc;
}

/**
 * Flatten one exercise result into an occurrence.
 *
 * Every field comes off the result itself. The tree supplies only the rank.
 * REQUIREMENTS 6.6 and 6.23.
 */
function toOccurrence(session: Session, key: string, result: ExerciseResult): ExerciseOccurrence {
  const occurrence: ExerciseOccurrence = {
    sessionId: session.id,
    exerciseId: result.exerciseId,
    resultKey: key,
    encodedPath: safeEncodePath(result.executionPath),
    attempt: typeof result.attempt === 'number' ? result.attempt : 1,
    status: result.status,
    completedAtUtc: completedAt(result.endedAtUtc, session)
  };
  if (result.side !== undefined) occurrence.side = result.side;
  // The alternating split cannot be rebuilt from the total, so the starting
  // side travels with the row. REQUIREMENTS 11.7.
  if (result.startingSide !== undefined) occurrence.startingSide = result.startingSide;
  if (result.values !== undefined) occurrence.values = result.values;
  return occurrence;
}

/** Flatten one container result. */
function toContainerOccurrence(
  session: Session,
  key: string,
  result: ContainerResult
): ContainerOccurrence {
  const segments = Array.isArray(result.executionPath) ? result.executionPath : [];
  const last = segments[segments.length - 1];
  const occurrence: ContainerOccurrence = {
    sessionId: session.id,
    containerNodeId: last === undefined ? '' : last.nodeId,
    resultKey: key,
    encodedPath: safeEncodePath(result.executionPath),
    attempt: typeof result.attempt === 'number' ? result.attempt : 1,
    status: result.status,
    completedAtUtc: completedAt(result.endedAtUtc, session)
  };
  if (result.score !== undefined) occurrence.score = result.score;
  return occurrence;
}

/** Add one id to one set in a map of sets, creating the set on first use. */
function addToSet<K>(map: Map<K, Set<string>>, key: K, value: string): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, new Set([value]));
  else existing.add(value);
}

/**
 * The mutable parts of an index, held by the lookup service between rebuilds.
 *
 * `buildIndex` returns this shape rather than a bare `DataIndex` so
 * `extendHistory` can merge a new shard into the same objects instead of
 * rebuilding from scratch. The capped views recompute from the full lists on each
 * merge, so the cap never drops a newer row that arrived later.
 */
export interface MutableIndex extends DataIndex {
  /** `sessionId` to `startedAtUtc`, the ordering key for occurrences. */
  sessionStarts: Map<string, string>;
  /** The cap applied to the `recent*` views. */
  recentLimit: number;
}

/**
 * Merge one session's exercise results into the full occurrence lists.
 *
 * A session already indexed under the same `id` is removed first, so a reload of
 * a changed shard replaces the row instead of duplicating it.
 */
function mergeSession(
  index: MutableIndex,
  session: Session,
  nodes: Map<string, WorkoutNodeLookup>,
  workoutName: string
): void {
  const summary: SessionSummary = {
    id: session.id,
    workoutId: session.workoutId,
    workoutName,
    status: session.status,
    startedAtUtc: session.startedAtUtc,
    updatedAtUtc: session.updatedAtUtc,
    shardName: shardNameFor(session.startedAtUtc)
  };

  dropSessionFrom(index, session.id);
  const bySessionStart = occurrenceComparator(index.sessionStarts);

  index.sessionsById.set(summary.id, summary);
  index.sessionStarts.set(summary.id, summary.startedAtUtc);
  insertSorted(
    bucketFor(index.sessionsByWorkoutId, summary.workoutId),
    summary,
    newestSessionFirst
  );
  // Every status lands here. The Workout History tab pages this list, so an
  // in-progress session must sit beside a completed one. REQUIREMENTS 20.1.
  insertSorted(index.allSessionsByStartedAtUtc, summary, newestSessionFirst);
  if (summary.status === 'in_progress') {
    insertSorted(index.activeSessionsByUpdatedAtUtc, summary, newestUpdatedFirst);
  } else {
    insertSorted(index.terminalSessions, summary, newestSessionFirst);
  }

  for (const [key, result] of Object.entries(session.exerciseResults ?? {})) {
    const occurrence = toOccurrence(session, key, result);
    occurrencePathKey.set(
      occurrence,
      pathKeyFor(nodes, session.workoutId, result.executionPath)
    );
    insertSorted(
      bucketFor(index.occurrencesByExerciseId, occurrence.exerciseId),
      occurrence,
      bySessionStart
    );
  }

  for (const [key, result] of Object.entries(session.containerResults ?? {})) {
    const occurrence = toContainerOccurrence(session, key, result);
    containerPathKey.set(occurrence, pathKeyFor(nodes, session.workoutId, result.executionPath));
    insertSorted(
      bucketFor(index.containerOccurrencesBySessionId, session.id),
      occurrence,
      compareContainerWithinSession
    );
  }
}

/**
 * Side table of tree path keys for container rows, same reason as
 * `occurrencePathKey`: the public shape carries no rank field.
 */
const containerPathKey = new WeakMap<ContainerOccurrence, readonly number[]>();

/** Container rows inside one session: tree order, then encoded path. */
function compareContainerWithinSession(a: ContainerOccurrence, b: ContainerOccurrence): number {
  const byPath = comparePathKeys(
    containerPathKey.get(a) ?? UNRESOLVED_PATH_KEY,
    containerPathKey.get(b) ?? UNRESOLVED_PATH_KEY
  );
  if (byPath !== 0) return byPath;
  if (a.encodedPath !== b.encodedPath) return a.encodedPath < b.encodedPath ? -1 : 1;
  return a.resultKey < b.resultKey ? -1 : a.resultKey > b.resultKey ? 1 : 0;
}

/** Get one bucket, creating it when the key first appears. */
function bucketFor<T>(map: Map<string, T[]>, key: string): T[] {
  let bucket = map.get(key);
  if (bucket === undefined) {
    bucket = [];
    map.set(key, bucket);
  }
  return bucket;
}

/**
 * Insert into a list that is already sorted, keeping it sorted.
 *
 * A binary search keeps an `extendHistory` merge at `O(log n + k)` for the shift
 * instead of a full re-sort, which matters on a Kindle where a re-sort of a long
 * history list costs a visible pause.
 */
function insertSorted<T>(list: T[], item: T, comparator: (a: T, b: T) => number): void {
  let low = 0;
  let high = list.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (comparator(list[mid] as T, item) <= 0) low = mid + 1;
    else high = mid;
  }
  list.splice(low, 0, item);
}

/** Remove every trace of one session. Used before a re-index of the same `id`. */
function dropSessionFrom(index: MutableIndex, sessionId: string): void {
  const existing = index.sessionsById.get(sessionId);
  if (existing === undefined) return;

  const workoutBucket = index.sessionsByWorkoutId.get(existing.workoutId);
  if (workoutBucket !== undefined) {
    const kept = workoutBucket.filter((summary) => summary.id !== sessionId);
    if (kept.length === 0) index.sessionsByWorkoutId.delete(existing.workoutId);
    else index.sessionsByWorkoutId.set(existing.workoutId, kept);
  }

  index.terminalSessions = index.terminalSessions.filter((s) => s.id !== sessionId);
  index.allSessionsByStartedAtUtc = index.allSessionsByStartedAtUtc.filter(
    (s) => s.id !== sessionId
  );
  index.activeSessionsByUpdatedAtUtc = index.activeSessionsByUpdatedAtUtc.filter(
    (s) => s.id !== sessionId
  );
  index.sessionsById.delete(sessionId);
  index.sessionStarts.delete(sessionId);
  index.containerOccurrencesBySessionId.delete(sessionId);

  for (const [exerciseId, list] of index.occurrencesByExerciseId) {
    const kept = list.filter((occurrence) => occurrence.sessionId !== sessionId);
    if (kept.length === 0) index.occurrencesByExerciseId.delete(exerciseId);
    else index.occurrencesByExerciseId.set(exerciseId, kept);
  }
}

/**
 * Rebuild the capped `recent*` views from the full lists.
 *
 * The cap is a slice, not a filter, so a newer row that arrives later through
 * `extendHistory` pushes an older one out instead of being rejected for a full
 * list. Kindle memory budget, specs "Loading policy".
 */
function refreshCappedViews(index: MutableIndex): void {
  const limit = index.recentLimit;
  const bySessionStart = occurrenceComparator(index.sessionStarts);

  index.recentByExerciseId = new Map();
  for (const [exerciseId, list] of index.occurrencesByExerciseId) {
    if (list.length === 0) continue;
    index.recentByExerciseId.set(exerciseId, list.slice(0, limit));
  }

  index.recentByMuscleGroup = new Map();
  for (const [muscle, exerciseIds] of index.exerciseIdsByMuscleGroup) {
    const merged: ExerciseOccurrence[] = [];
    for (const exerciseId of exerciseIds) {
      const list = index.occurrencesByExerciseId.get(exerciseId);
      if (list === undefined) continue;
      // Push one at a time. `push(...list)` on a long list can overflow the call
      // stack, and a 24-month history is long.
      for (const occurrence of list) merged.push(occurrence);
    }
    if (merged.length === 0) continue;
    merged.sort(bySessionStart);
    index.recentByMuscleGroup.set(muscle, merged.slice(0, limit));
  }

  index.recentSessions = index.terminalSessions.slice(0, RECENT_SESSION_CAP);
}

/** The shard file name a session belongs to. Requirement 3.3. */
function shardNameFor(startedAtUtc: string): string {
  try {
    return shardName(startedAtUtc);
  } catch {
    // A session with an unusable start stamp is a fatal document fault upstream.
    // The index keeps the row under a neutral name rather than failing the whole
    // build, because one bad entry must not break every screen. REQUIREMENTS 6.10.
    return 'results-unknown.json';
  }
}

/** Empty index over the static bundle, with no result data. */
function createStaticIndex(staticData: LoadedStaticData, recentLimit: number): MutableIndex {
  const nodeByWorkoutAndId = new Map<string, WorkoutNodeLookup>();
  for (const workout of staticData.workouts) indexWorkoutNodes(workout, nodeByWorkoutAndId);

  const exerciseIdsByMuscleGroup = new Map<Muscle, Set<string>>();
  for (const exercise of staticData.exercises) {
    for (const muscle of exercise.primaryMuscles) addToSet(exerciseIdsByMuscleGroup, muscle, exercise.id);
    for (const muscle of exercise.secondaryMuscles) addToSet(exerciseIdsByMuscleGroup, muscle, exercise.id);
  }

  return {
    exerciseById: new Map(staticData.exerciseById),
    workoutById: new Map(staticData.workoutById),
    nodeByWorkoutAndId,
    exerciseIdsByMuscleGroup,
    recentByExerciseId: new Map(),
    recentByMuscleGroup: new Map(),
    recentSessions: [],
    activeSessionsByUpdatedAtUtc: [],
    unresolvedResults: [],
    sessionsById: new Map(),
    terminalSessions: [],
    allSessionsByStartedAtUtc: [],
    sessionsByWorkoutId: new Map(),
    occurrencesByExerciseId: new Map(),
    containerOccurrencesBySessionId: new Map(),
    sessionStarts: new Map(),
    recentLimit
  };
}

/**
 * Merge one shard into an existing index.
 *
 * Does not refresh the capped views. A caller that merges several shards uses
 * `mergeShards` instead, so the cap rebuild happens once per batch rather than
 * once per shard.
 */
export function mergeShard(index: MutableIndex, shard: ResultsShard): void {
  for (const session of Object.values(shard.sessions ?? {})) {
    const workout = index.workoutById.get(session.workoutId);
    mergeSession(index, session, index.nodeByWorkoutAndId, workout?.name ?? session.workoutId);
  }
}

/**
 * Merge several shards, newest month first, then refresh the capped views once.
 *
 * The builder sorts the shard names itself instead of trusting the caller, so the
 * capped recent lists fill with the newest rows whatever order the caller used.
 */
export function mergeShards(index: MutableIndex, shards: readonly ResultsShard[]): void {
  const ordered = [...shards].sort((a, b) => {
    if (a.yearMonthUtc !== b.yearMonthUtc) return a.yearMonthUtc < b.yearMonthUtc ? 1 : -1;
    return 0;
  });
  for (const shard of ordered) mergeShard(index, shard);
  refreshCappedViews(index);
}

/**
 * Build the read model from the static bundle plus the loaded shards.
 *
 * Shards merge newest month first. See `mergeShards`.
 */
export function buildIndex(input: {
  staticData: LoadedStaticData;
  shards: readonly ResultsShard[];
  unresolved: readonly UnresolvedResult[];
  recentLimit?: number;
}): MutableIndex {
  const recentLimit = input.recentLimit ?? DEFAULT_RECENT_LIMIT;
  const index = createStaticIndex(input.staticData, recentLimit);

  mergeShards(index, input.shards);
  index.unresolvedResults = sortUnresolved(input.unresolved);
  return index;
}

/**
 * Deterministic order for unresolved entries: kind, then the encoded path.
 *
 * The list keeps every entry. Sorting never drops one, so a page that shows three
 * unresolved references still shows three after a rebuild. REQUIREMENTS 6.10.
 */
export function sortUnresolved(entries: readonly UnresolvedResult[]): UnresolvedResult[] {
  return [...entries].sort((a, b) => {
    const byKind = a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
    if (byKind !== 0) return byKind;
    const pathA = a.kind === 'result' ? a.encodedPath : `${a.exerciseId}|${a.dimension}`;
    const pathB = b.kind === 'result' ? b.encodedPath : `${b.exerciseId}|${b.dimension}`;
    if (pathA !== pathB) return pathA < pathB ? -1 : 1;
    return 0;
  });
}
