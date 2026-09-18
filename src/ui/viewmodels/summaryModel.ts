// The Workout Summary view model.
// Phase 18. REQUIREMENTS 6.23, 10.13, 10.18, 20.3.
//
// The summary shows everything one session recorded. It reads the session's own
// stored results and nothing else, so a workout the current bundle renamed,
// re-parented, or removed cannot hide what the user actually logged.
// REQUIREMENTS 6.23 is the whole reason this model exists.
//
// Three rules shape the file.
//
// 1. Only saved work renders. A draft lives in the Active Workout screen's
//    local state and never reaches a session document, so a draft value cannot
//    appear here. The model reads `exerciseResults` and `containerResults`
//    and takes no draft input at all.
// 2. The tree orders the rows but never supplies a value. When the tree can
//    place a result the row sorts by tree rank; when it cannot, the row sorts
//    by the encoded `executionPath` string. Both paths keep the stored values.
// 3. One unresolved result never drops the list. Each unresolved result keeps
//    its row and adds one entry to `unresolved`, which the screen turns into
//    one `DataError` card. REQUIREMENTS 6.10.

import type { ReasonCode, ResultStatus, SetType, Side, Stimulus } from '../../domain/enums';
import type {
  ContainerResult,
  ExerciseResult,
  ResultValues,
  Quantity,
  Score,
  Session,
  Workout,
  WorkoutNode
} from '../../domain/types';
import type { LoadedStaticData } from '../../documents/static-loader';
import type { UnresolvedResult } from '../../validation/issues';
import type { DataErrorProps } from '../components/data-error-types';
import {
  encodePath,
  resolvePath,
  type PathSegment,
  type ResolvedPath
} from '../../domain/execution-path';
import { unitLabel, formatAlternatingReps } from '../../units/format';
import { formatEditable } from '../../units/conversion';
import { formatHistoryDate } from './historyModel';
import { workoutSectionLabel } from './overviewModel';

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

/** Result status text. The three values are the whole vocabulary. */
const RESULT_STATUS_LABELS: ReadonlyMap<ResultStatus | string, string> = new Map([
  ['completed', 'Completed'],
  ['incomplete', 'Incomplete'],
  ['skipped', 'Skipped']
]);

/** Session status text. */
const SESSION_STATUS_LABELS: ReadonlyMap<string, string> = new Map([
  ['in_progress', 'In progress'],
  ['completed', 'Completed'],
  ['abandoned', 'Abandoned']
]);

/**
 * The visible name of one recorded score kind.
 *
 * `nonstandard` reads **Detailed**, because the recorded detail did not follow
 * the container's own score progression. REQUIREMENTS 10.18.
 */
const SCORE_LABELS: ReadonlyMap<string, string> = new Map([
  ['cycles', 'Cycles'],
  ['rounds_and_reps', 'Rounds and reps'],
  ['intervals', 'Intervals'],
  ['nonstandard', 'Detailed']
]);

/** Reason codes, in the order the vocabulary lists them. */
const REASON_LABELS: ReadonlyMap<string, string> = new Map([
  ['user_skipped', 'Skipped'],
  ['not_completed', 'Not completed'],
  ['equipment_unavailable', 'Equipment unavailable'],
  ['physical_limitation', 'Physical limitation'],
  ['time_constraint', 'Time constraint'],
  ['unsuccessful_attempt', 'Unsuccessful attempt'],
  ['other', 'Other']
]);

/** Why one summary row could not be placed against the current bundle. */
export type SummaryUnresolvedReason =
  | 'unknown_workout'
  | 'unknown_exercise'
  | 'broken_path'
  | 'path_exercise_mismatch';

/** One recorded exercise result, shaped for the summary. */
export interface SummaryExerciseRow {
  /** The `exerciseResults` map key. Unique inside one session. */
  key: string;
  /** The exercise name, or the stored `exerciseId` when the bundle lacks it. */
  label: string;
  /** The `exerciseId` read off the result. Never derived from the tree. */
  exerciseId: string;
  /** The `executionPath` encoded as it appears inside the map key. */
  encodedPath: string;
  /** The path read off the result. Empty when the result carries none. */
  path: PathSegment[];
  attempt: number;
  side?: Side;
  status: ResultStatus;
  statusLabel: string;
  /** The recorded values as one line, for example `5 reps · 225 lb`. */
  valuesLabel: string;
  /** The alternating split, for example `9 total / 5 left / 4 right`. */
  alternatingLabel?: string;
  reasonCode?: ReasonCode;
  reasonLabel?: string;
  /** True when the current bundle cannot place this result. */
  unresolved: boolean;
  /** Why the row is unresolved. Absent on a resolved row. */
  unresolvedReason?: SummaryUnresolvedReason;
  /** The Exercise History address for the row's exercise. */
  href?: string;
  /** The stored result, re-serialized for **View Raw JSON**. */
  rawJson: string;
  /** Presentation metadata from the current tree when the row resolves. */
  setType?: SetType;
  stimulus?: Stimulus;
}

/** One recorded container score, shaped for the summary. */
export interface SummaryContainerRow {
  /** The `containerResults` map key. Unique inside one session. */
  key: string;
  /** The container name, or the node ID when the tree lacks the container. */
  label: string;
  encodedPath: string;
  path: PathSegment[];
  attempt: number;
  status: ResultStatus;
  statusLabel: string;
  /** The score kind, for example `rounds_and_reps`. */
  scoreType: string;
  /** The score kind label, for example `Rounds and reps`. */
  scoreLabel: string;
  /** The score as one line, for example `4 + 6` or `8 of 10`. */
  scoreText: string;
  /** True when the score is `nonstandard`. REQUIREMENTS 10.18. */
  detailed: boolean;
  reasonCode?: ReasonCode;
  reasonLabel?: string;
  unresolved: boolean;
  unresolvedReason?: SummaryUnresolvedReason;
  /** The stored result, re-serialized for **View Raw JSON**. */
  rawJson: string;
}

/**
 * One group of recorded work.
 *
 * A group is one container occurrence. It carries the scores recorded on that
 * container and the exercise results recorded directly under it. Results the
 * tree cannot place land in the ungrouped bucket, which still renders.
 */
export interface SummaryGroup {
  /** Stable group key. The container's own encoded path, or `ungrouped`. */
  key: string;
  /** The group heading, for example `Squat Sets` or `Squat Sets · Round 2`. */
  title: string;
  /** The scores recorded on this container, one per recorded attempt. */
  containers: SummaryContainerRow[];
  /** The exercise rows recorded directly under this container. */
  rows: SummaryExerciseRow[];
  /** Tree rank of the group's container, or `Infinity` when unresolved. */
  sortRank: number;
  /**
   * Round number of the group's container occurrence, or 0 when unnumbered.
   *
   * `sortRank` ignores iterations, because the tree ranks a node, not a round
   * of it. Every round of one container therefore shares one `sortRank`, and
   * without this second key the tie-break falls to the encoded path string,
   * which reads `Round 1, Round 10, Round 2`. REQUIREMENTS 3.17, 3.19, 3.20.
   */
  sortIteration: number;
}

/** One round inside a recorded set table. */
export interface SummarySetRound {
  key: string;
  /** The round divider, for example `Round 2`. Empty when nothing needs telling apart. */
  label: string;
  rows: Array<SummaryExerciseRow & { setNumber: number }>;
}

/** One set column in a recorded circuit matrix. */
export interface SummarySetColumn {
  key: string;
  label: string;
  setNumber: number;
}

/** One exercise line across the recorded set columns. */
export interface SummarySetMatrixRow {
  /** The programmed exercise node identity, not a result key. */
  key: string;
  label: string;
  href?: string;
  /** Cells aligned to `SummarySetMatrix.columns` by index. */
  cells: Array<{ key: string; rows: Array<SummaryExerciseRow & { setNumber: number }> }>;
}

/** The exercise-by-set grid a recorded circuit renders as. */
export interface SummarySetMatrix {
  columns: SummarySetColumn[];
  rows: SummarySetMatrixRow[];
}

/**
 * Repeated recorded sets shown under one heading.
 *
 * A single-exercise block reads as that exercise's set list. A circuit
 * block reads as a matrix: one exercise per row, one set per column, so
 * the exercise name is stated once per row.
 */
export interface SummarySetTable {
  key: string;
  title: string;
  sectionTitle: string;
  label: string;
  /** True when each round holds more than one exercise. */
  multiExercise: boolean;
  /** The table body. The rounds are the source of truth for the rows. */
  rounds: SummarySetRound[];
  /** Every row in draw order. Derived from `rounds`; never set apart from it. */
  rows: Array<SummaryExerciseRow & { setNumber: number }>;
  /** The exercise-by-set grid. Present only when `multiExercise` is true. */
  matrix?: SummarySetMatrix;
}

/**
 * Turn round-grouped recorded rows into the exercise-by-set grid.
 *
 * Exercise order comes from the first round. A line is one programmed
 * exercise node, keyed by that node's id: the result key carries the side
 * and the attempt too, so keying a line by it would split one exercise
 * across several lines. A cell then holds every row that exercise recorded
 * in that round, which is more than one row when attempts or sides exist.
 */
function buildSummaryMatrix(rounds: SummarySetRound[]): SummarySetMatrix {
  const columns: SummarySetColumn[] = rounds.map((round, index) => ({
    key: round.key,
    label: `Set ${round.rows[0]?.setNumber ?? index + 1}`,
    setNumber: round.rows[0]?.setNumber ?? index + 1
  }));

  /** The programmed exercise node id for one recorded row. */
  const lineKey = (row: SummaryExerciseRow): string => {
    const leaf = row.path[row.path.length - 1];
    return leaf === undefined ? row.exerciseId : leaf.nodeId;
  };

  const order: string[] = [];
  const meta = new Map<string, { label: string; href?: string }>();
  for (const row of rounds[0]?.rows ?? []) {
    const key = lineKey(row);
    if (!order.includes(key)) order.push(key);
    if (!meta.has(key)) meta.set(key, { label: row.label, href: row.href });
  }

  const rows: SummarySetMatrixRow[] = order.map((key) => {
    const info = meta.get(key) ?? { label: key };
    return {
      key,
      label: info.label,
      href: info.href,
      cells: rounds.map((round) => ({
        key: `${key}@${round.key}`,
        rows: round.rows.filter((row) => lineKey(row) === key)
      }))
    };
  });

  return { columns, rows };
}

export type SummaryDisplayBlock =
  | { kind: 'group'; group: SummaryGroup; sectionTitle?: string }
  | { kind: 'set-table'; table: SummarySetTable };

/** Everything the Workout Summary draws. */
export interface SummaryModel {
  /** The workout name, or the stored `workoutId` when the bundle lacks it. */
  title: string;
  /** `In progress`, `Completed`, or `Abandoned`. */
  statusLabel: string;
  /** The start date label. Empty when the stamp is unusable. */
  startedLabel: string;
  /** The completion date label. Empty when the session never completed. */
  completedLabel: string;
  /** Recorded work, grouped and ordered. */
  groups: SummaryGroup[];
  /** Semantic presentation with repeated exercise sets collapsed. */
  blocks: SummaryDisplayBlock[];
  /**
   * The results the current bundle cannot resolve.
   *
   * One entry per unresolved result, in the order the rows carry them. The
   * screen renders one `DataError` card per entry beside the row, so the list
   * never loses a result. REQUIREMENTS 6.8, 6.10.
   */
  unresolved: UnresolvedResult[];
  /** The session note, when the session carries one. */
  notes?: string;
  /** True when the session recorded nothing at all. */
  isEmpty: boolean;
  /** True when the session's workout is absent from the current bundle. */
  workoutUnresolved: boolean;
  /** The stored session, re-serialized for **View Raw JSON**. */
  rawJson: string;
}

/** What `buildSummaryModel` reads. */
export interface SummaryModelInput {
  session: Session;
  staticData: LoadedStaticData;
  localTimeZone: string;
  /** Now, as a UTC ISO string. Defaults to the wall clock. */
  nowUtc?: string;
}

/** Tree rank for an unplaceable row. Sorts behind every finite rank. */
const UNPLACED_RANK = Number.POSITIVE_INFINITY;

/** The bucket for results the tree cannot place under any container. */
const UNGROUPED_KEY = 'ungrouped';

/** Encode a result path without throwing on a broken or empty path. */
function safeEncodePath(segments: PathSegment[] | undefined): string {
  if (!Array.isArray(segments) || segments.length === 0) return '';
  try {
    return encodePath(segments);
  } catch {
    return '';
  }
}

/** Drop the iteration from every segment, leaving the bare node path. */
function nodePathOf(segments: PathSegment[]): string {
  return segments.map((segment) => segment.nodeId).join('/');
}

/**
 * The rank tables for one session's workout.
 *
 * A recorded path and a tree path are not always the same shape. The tree
 * expands a rounds container into `root/squat-sets:1`, `:2`, `:3`, but an
 * AMRAP container resolves to one occurrence while the user may have recorded
 * three rounds of it. A single preorder index cannot place both, because the
 * extra rounds have no tree position to borrow.
 *
 * So the sort key is a pair: the bare node path rank first, then the
 * iteration. Rounds of one container stay together and read in round order,
 * and a container's own score, which carries no iteration on its own segment,
 * sorts ahead of its rounds. A path the tree cannot place gets
 * `UNPLACED_RANK`, which sorts behind every finite rank, where the encoded
 * path string takes over. REQUIREMENTS 3.20, 6.23.
 */
interface RankTables {
  /** The preorder rank of one path's bare node, ignoring its iteration. */
  rankOf(path: PathSegment[]): number;
  /** The iteration of one path's last segment. A score sorts as 0. */
  iterationOf(path: PathSegment[]): number;
}

function buildRankTables(workout: Workout | undefined): RankTables {
  const nodeRank = new Map<string, number>();
  if (workout === undefined) {
    return { rankOf: () => UNPLACED_RANK, iterationOf: () => 0 };
  }

  let rank = 0;
  const walk = (node: WorkoutNode, parentPath: PathSegment[]): void => {
    const path: PathSegment[] = [...parentPath, { nodeId: node.id }];
    nodeRank.set(nodePathOf(path), rank);
    rank += 1;
    if (node.type === 'container') {
      for (const child of node.children) walk(child, path);
    }
  };
  walk(workout.root, []);

  return {
    rankOf: (segments: PathSegment[]): number => {
      const found = nodeRank.get(nodePathOf(segments));
      return found === undefined ? UNPLACED_RANK : found;
    },
    iterationOf: (segments: PathSegment[]): number => {
      const last = segments.length > 0 ? segments[segments.length - 1] : undefined;
      // A container result carries no iteration on its own segment, so it
      // reads as 0 and lands ahead of the rounds it scores.
      return last === undefined || last.iteration === undefined ? 0 : last.iteration;
    }
  };
}

/** Anything the shared summary row comparator can order. */
interface ComparableRow {
  path: PathSegment[];
  encodedPath: string;
  attempt: number;
  key: string;
}

/**
 * The one row order for the summary.
 *
 * Tree rank first, because the workout tree is the prescriptive order.
 * Iteration next, so rounds read `1, 2, 10` and not `1, 10, 2`. The encoded
 * path string next, which is the fallback REQUIREMENTS 6.23 asks for when the
 * tree cannot place the row. The numeric `attempt` after that, so two rows
 * for one exercise at one path read `1, 2, 10` instead of the lexicographic
 * `1, 10, 2` the key string gives. The key last, as the only tie-breaker
 * left.
 *
 * Every field is read off the row, so the order never depends on the order
 * the results were inserted. REQUIREMENTS 3.17, 3.19, 3.20, 20.3, 22.4.5.
 */
function compareRows(ranks: RankTables, a: ComparableRow, b: ComparableRow): number {
  const rankA = ranks.rankOf(a.path);
  const rankB = ranks.rankOf(b.path);
  if (rankA !== rankB) return rankA < rankB ? -1 : 1;

  const iterationA = ranks.iterationOf(a.path);
  const iterationB = ranks.iterationOf(b.path);
  if (iterationA !== iterationB) return iterationA < iterationB ? -1 : 1;

  if (a.encodedPath !== b.encodedPath) return a.encodedPath < b.encodedPath ? -1 : 1;

  if (a.attempt !== b.attempt) return a.attempt < b.attempt ? -1 : 1;

  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
}

/**
 * Resolve one recorded path against the current workout tree.
 *
 * The whole chain is walked, not the leaf alone. A leaf-only lookup calls a
 * result fine when the leaf still exists somewhere else in the tree and an
 * ancestor was removed or re-parented, so a broken path reads as resolved.
 * REQUIREMENTS 6.8 third bullet, 6.10.
 *
 * `resolvePath` is the validator's own resolver, shared rather than copied so
 * the summary and `validateSession` agree on `broken_path` by construction.
 */
function resolveRecordedPath(
  workout: Workout | undefined,
  path: PathSegment[]
): ResolvedPath | null {
  if (workout === undefined) return null;
  return resolvePath(workout, path);
}

/** The node one recorded path lands on, or null when it does not resolve. */
function resolvedNode(
  workout: Workout | undefined,
  path: PathSegment[]
): WorkoutNode | null {
  const resolved = resolveRecordedPath(workout, path);
  return resolved !== null && resolved.ok ? resolved.node : null;
}

/** The name of one node. An exercise node has none, so it reads as empty. */
function nodeName(node: WorkoutNode | null): string {
  if (node === null || node.type !== 'container') return '';
  return node.name ?? '';
}

/** The bare node ID of a path's last segment. */
function leafNodeId(path: PathSegment[]): string {
  const last = path.length > 0 ? path[path.length - 1] : undefined;
  return last === undefined ? '' : last.nodeId;
}

/** The round text for a path segment that carries an iteration. */
function roundSuffix(segment: PathSegment | undefined): string {
  if (segment === undefined || segment.iteration === undefined) return '';
  return ` · Round ${segment.iteration}`;
}

/**
 * One quantity on a read-only line.
 *
 * `formatEditable` keeps one decimal because an editable field must show the
 * digit the user types into. A recorded value is not being edited here, so a
 * whole number drops its trailing `.0`: `225 lb`, not `225.0 lb`.
 */
function formatReadQuantity(q: Quantity): string {
  const text = formatEditable(q);
  const trimmed = text.endsWith('.0') ? text.slice(0, -2) : text;
  return `${trimmed} ${unitLabel(q.unit)}`;
}

/** One recorded value set as one line of text, in a fixed dimension order. */
function formatValues(values: ResultValues | undefined): string {
  if (values === undefined) return '';
  const parts: string[] = [];
  for (const key of RESULT_VALUE_ORDER) {
    const quantity = values[key];
    if (quantity === undefined) continue;
    parts.push(formatReadQuantity(quantity));
  }
  return parts.join(' · ');
}

/**
 * The score as one line of text.
 *
 * Each kind prints the numbers it carries. `nonstandard` prints nothing,
 * because there are no numbers: the **Detailed** marker is the whole report.
 */
function formatScore(score: Score): string {
  switch (score.type) {
    case 'cycles':
      return `${score.completedCycles}`;
    case 'rounds_and_reps':
      return `${score.completedRounds} + ${score.additionalReps}`;
    case 'intervals':
      return `${score.completedIntervals} of ${score.totalIntervals}`;
    case 'nonstandard':
    default:
      return '';
  }
}

/** The label for one reason code. Mirrors the `$defs.reasonCode` vocabulary. */
export function reasonLabel(code: ReasonCode | string): string {
  return REASON_LABELS.get(code) ?? code;
}

/** The Exercise History address for one exercise. */
function exerciseHistoryHref(exerciseId: string): string {
  return `#/exercises/${encodeURIComponent(exerciseId)}/history`;
}

/**
 * The data-error card text for one unresolved summary row.
 *
 * The card names the reason and the path the app could not place, so the user
 * can tell a removed exercise from a moved one. It carries the stored result
 * as raw JSON, which is the record the app actually read. REQUIREMENTS 6.8,
 * 6.9, 6.10.
 */
export function summaryRowErrorProps(
  row: SummaryExerciseRow | SummaryContainerRow
): DataErrorProps {
  const reason = row.unresolvedReason ?? 'broken_path';
  const titles: Record<SummaryUnresolvedReason, string> = {
    unknown_workout: 'This workout is not in this build',
    unknown_exercise: 'This exercise is not in this build',
    broken_path: 'This recorded path does not match the workout',
    path_exercise_mismatch: 'This recorded path points at a different exercise'
  };
  const detail =
    `Recorded path: ${row.encodedPath === '' ? '(none)' : row.encodedPath}. ` +
    `REP JOT still shows the values you saved.`;
  return {
    title: titles[reason],
    family: 'session-result',
    detail,
    rawJson: row.rawJson
  };
}

/** Build one exercise row from the stored result. */
function buildExerciseRow(
  resultKey: string,
  result: ExerciseResult,
  workout: Workout | undefined,
  staticData: LoadedStaticData
): SummaryExerciseRow {
  const path = Array.isArray(result.executionPath) ? result.executionPath : [];
  const encodedPath = safeEncodePath(path);
  const exercise = staticData.exerciseById.get(result.exerciseId);

  let unresolvedReason: SummaryUnresolvedReason | undefined;
  let matchedNode: WorkoutNode | null = null;
  if (workout === undefined) {
    unresolvedReason = 'unknown_workout';
  } else if (exercise === undefined) {
    unresolvedReason = 'unknown_exercise';
  } else if (path.length === 0) {
    unresolvedReason = 'broken_path';
  } else {
    const resolved = resolveRecordedPath(workout, path);
    const node = resolved !== null && resolved.ok ? resolved.node : null;
    matchedNode = node;
    if (node === null) {
      unresolvedReason = 'broken_path';
    } else if (node.type === 'exercise' && node.exerciseId !== result.exerciseId) {
      unresolvedReason = 'path_exercise_mismatch';
    }
  }

  const row: SummaryExerciseRow = {
    key: resultKey,
    label: exercise?.name ?? result.exerciseId,
    exerciseId: result.exerciseId,
    encodedPath,
    path,
    attempt: typeof result.attempt === 'number' ? result.attempt : 1,
    status: result.status,
    statusLabel: RESULT_STATUS_LABELS.get(result.status) ?? result.status,
    valuesLabel: formatValues(result.values),
    unresolved: false,
    rawJson: JSON.stringify(result, null, 2)
  };
  if (matchedNode?.type === 'exercise') {
    if (matchedNode.setType !== undefined) row.setType = matchedNode.setType;
    if (matchedNode.stimulus !== undefined) row.stimulus = matchedNode.stimulus;
  }
  if (result.side !== undefined) row.side = result.side;
  if (result.reasonCode !== undefined) {
    row.reasonCode = result.reasonCode;
    row.reasonLabel = reasonLabel(result.reasonCode);
  }
  // The alternating split needs the starting side, which only the full result
  // carries. REQUIREMENTS 11.6, 11.7.
  if (result.side === 'alternating' && result.values?.reps !== undefined) {
    const split = formatAlternatingReps(result.values.reps, result.startingSide);
    if (split !== '') row.alternatingLabel = split;
  }
  if (unresolvedReason === undefined) {
    row.unresolved = false;
    row.href = exerciseHistoryHref(result.exerciseId);
  } else {
    row.unresolved = true;
    row.unresolvedReason = unresolvedReason;
  }
  return row;
}

/** Build one container row from the stored result. */
function buildContainerRow(
  resultKey: string,
  result: ContainerResult,
  workout: Workout | undefined
): SummaryContainerRow {
  const path = Array.isArray(result.executionPath) ? result.executionPath : [];
  const encodedPath = safeEncodePath(path);
  const baseNodeId = leafNodeId(path);
  const node = resolvedNode(workout, path);

  const score = result.score;
  const scoreType = score?.type ?? '';
  const row: SummaryContainerRow = {
    key: resultKey,
    label:
      nodeName(node) === '' ? (baseNodeId === '' ? 'Container' : baseNodeId) : nodeName(node),
    encodedPath,
    path,
    attempt: typeof result.attempt === 'number' ? result.attempt : 1,
    status: result.status,
    statusLabel: RESULT_STATUS_LABELS.get(result.status) ?? result.status,
    scoreType,
    scoreLabel: SCORE_LABELS.get(scoreType) ?? scoreType,
    scoreText: score === undefined ? '' : formatScore(score),
    detailed: score?.type === 'nonstandard',
    unresolved: false,
    rawJson: JSON.stringify(result, null, 2)
  };
  if (result.reasonCode !== undefined) {
    row.reasonCode = result.reasonCode;
    row.reasonLabel = reasonLabel(result.reasonCode);
  }
  // A container score is unresolved only when the workout or the container is
  // gone. A `nonstandard` score is not a fault; it is a recorded fact that
  // reads **Detailed**. REQUIREMENTS 10.18.
  if (workout === undefined) {
    row.unresolved = true;
    row.unresolvedReason = 'unknown_workout';
  } else if (path.length === 0 || node === null) {
    row.unresolved = true;
    row.unresolvedReason = 'broken_path';
  } else {
    row.unresolved = false;
  }
  return row;
}

function repeatedSetScope(group: SummaryGroup): string | null {
  if (group.containers.length > 0 || group.rows.length === 0) return null;
  if (group.rows.some((row) => row.unresolved)) return null;

  let scope: string | null = null;
  for (const row of group.rows) {
    const parent = row.path.slice(0, -1).map((segment) => ({ ...segment }));
    const repeated = parent[parent.length - 1];
    if (repeated?.iteration === undefined) return null;
    delete repeated.iteration;
    const encoded = safeEncodePath(parent);
    if (scope !== null && scope !== encoded) return null;
    scope = encoded;
  }
  return scope;
}

function firstExerciseBelow(node: WorkoutNode | null): Extract<WorkoutNode, { type: 'exercise' }> | null {
  if (node === null) return null;
  if (node.type === 'exercise') return node;
  for (const child of node.children) {
    const found = firstExerciseBelow(child);
    if (found !== null) return found;
  }
  return null;
}

function buildDisplayBlocks(
  groups: SummaryGroup[],
  workout: Workout | undefined
): SummaryDisplayBlock[] {
  const byScope = new Map<string, SummaryGroup[]>();
  for (const group of groups) {
    const scope = repeatedSetScope(group);
    if (scope === null) continue;
    const bucket = byScope.get(scope);
    if (bucket === undefined) byScope.set(scope, [group]);
    else bucket.push(group);
  }

  const emitted = new Set<string>();
  const blocks: SummaryDisplayBlock[] = [];
  for (const group of groups) {
    const scope = repeatedSetScope(group);
    const occurrences = scope === null ? undefined : byScope.get(scope);
    if (scope !== null && occurrences !== undefined) {
      if (emitted.has(scope)) continue;
      emitted.add(scope);
      // One round per recorded occurrence of the container. A round that
      // holds several exercises is a circuit, so its rows keep the round
      // divider and each row names its own exercise.
      const rounds: SummarySetRound[] = occurrences.map((occurrence, index) => ({
        key: `${scope}#round-${index + 1}`,
        label: `Round ${index + 1}`,
        rows: occurrence.rows.map((row) => {
          const parent = row.path[row.path.length - 2];
          return { ...row, setNumber: parent?.iteration ?? 1 };
        })
      }));
      const tableRows = rounds.flatMap((round) => round.rows);
      if (tableRows.length === 0) continue;

      const shapes = new Set(
        rounds.map((round) =>
          round.rows
            .map((row) => row.path[row.path.length - 1]?.nodeId ?? '')
            .join(',')
        )
      );
      if (shapes.size !== 1) continue;

      const first = tableRows[0];
      const multiExercise = (rounds[0]?.rows.length ?? 0) > 1;
      // A divider only earns its place inside a circuit that has rounds to
      // tell apart. A single-exercise table already orders its rows with
      // `Set N`, and one round has nothing to separate.
      if (!multiExercise || rounds.length === 1) {
        rounds.forEach((round) => (round.label = ''));
      }

      blocks.push({
        kind: 'set-table',
        table: {
          key: scope,
          title: multiExercise
            ? occurrences[0]?.title.replace(/ · Round \d+$/, '') ?? first.label
            : first.label,
          sectionTitle: workoutSectionLabel(first.setType, first.stimulus),
          label: first.setType === 'warmup' ? 'Warmup sets' : 'Working sets',
          multiExercise,
          rounds,
          rows: tableRows,
          ...(multiExercise ? { matrix: buildSummaryMatrix(rounds) } : {})
        }
      });
      continue;
    }

    const first = group.rows[0];
    const groupPath = group.containers[0]?.path ?? first?.path.slice(0, -1) ?? [];
    const programmedExercise = firstExerciseBelow(resolvedNode(workout, groupPath));
    const sectionTitle = first !== undefined && !first.unresolved
      ? workoutSectionLabel(first.setType, first.stimulus)
      : programmedExercise === null
        ? undefined
        : workoutSectionLabel(programmedExercise.setType, programmedExercise.stimulus);
    blocks.push({
      kind: 'group',
      group,
      sectionTitle:
        sectionTitle !== undefined && sectionTitle.toLowerCase() !== group.title.toLowerCase()
          ? sectionTitle
          : undefined
    });
  }
  return blocks;
}

/**
 * Build the summary model.
 *
 * Every value comes off the session's own stored results. The current workout
 * is read only to order the rows and to name a container, so a session whose
 * workout no longer exists still renders all of its recorded work.
 * REQUIREMENTS 6.23, 20.3.
 */
export function buildSummaryModel(input: SummaryModelInput): SummaryModel {
  const { session, staticData, localTimeZone } = input;
  const nowValue = input.nowUtc ?? new Date().toISOString();
  const workout = staticData.workoutById.get(session.workoutId);
  const ranks = buildRankTables(workout);

  const groups = new Map<string, SummaryGroup>();
  const unresolved: UnresolvedResult[] = [];

  const ensureGroup = (key: string, title: string, segments: PathSegment[]): SummaryGroup => {
    const existing = groups.get(key);
    if (existing !== undefined) return existing;
    const created: SummaryGroup = {
      key,
      title,
      containers: [],
      rows: [],
      sortRank: ranks.rankOf(segments),
      sortIteration: ranks.iterationOf(segments)
    };
    groups.set(key, created);
    return created;
  };

  const recordUnresolved = (
    reason: SummaryUnresolvedReason,
    resultKey: string,
    encodedPath: string,
    exerciseId?: string
  ): void => {
    const entry: UnresolvedResult = {
      kind: 'result',
      reason,
      sessionKey: session.id,
      resultKey,
      workoutId: session.workoutId,
      encodedPath
    };
    if (exerciseId !== undefined) entry.exerciseId = exerciseId;
    unresolved.push(entry);
  };

  // Exercise results first, so a group's rows are in place before its scores.
  for (const [resultKey, result] of Object.entries(session.exerciseResults ?? {})) {
    const row = buildExerciseRow(resultKey, result, workout, staticData);
    // The group is the container occurrence the exercise sits under.
    const parentSegments = row.path.slice(0, Math.max(0, row.path.length - 1));
    const parentKey = parentSegments.length === 0 ? UNGROUPED_KEY : safeEncodePath(parentSegments);
    const parentTitle =
      parentKey === UNGROUPED_KEY
        ? 'Recorded work'
        : titleForGroup(parentSegments, workout);
    ensureGroup(parentKey, parentTitle, parentSegments).rows.push(row);
    if (row.unresolved && row.unresolvedReason !== undefined) {
      recordUnresolved(row.unresolvedReason, row.key, row.encodedPath, row.exerciseId);
    }
  }

  // A container result is keyed by the container's own path, so its group is
  // the container itself.
  for (const [resultKey, result] of Object.entries(session.containerResults ?? {})) {
    const row = buildContainerRow(resultKey, result, workout);
    const groupKey = row.path.length === 0 ? UNGROUPED_KEY : row.encodedPath;
    const groupTitle =
      groupKey === UNGROUPED_KEY ? 'Recorded work' : titleForGroup(row.path, workout);
    ensureGroup(groupKey, groupTitle, row.path).containers.push(row);
    if (row.unresolved && row.unresolvedReason !== undefined) {
      recordUnresolved(row.unresolvedReason, row.key, row.encodedPath);
    }
  }

  // Groups read in tree order, then by round number, then by key. The round
  // number is the step that keeps `Round 2` ahead of `Round 10`; the tree
  // rank alone cannot do it, because the tree ranks the container and every
  // round shares it. REQUIREMENTS 3.17, 3.19, 3.20.
  const orderedGroups = [...groups.values()].sort((a, b) => {
    if (a.sortRank !== b.sortRank) return a.sortRank < b.sortRank ? -1 : 1;
    if (a.sortIteration !== b.sortIteration) {
      return a.sortIteration < b.sortIteration ? -1 : 1;
    }
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  // Exercise rows and container scores inside a group read through the same
  // comparator, so the two lists cannot drift apart on the rules that matter:
  // tree rank, then round, then the encoded path string the unresolved case
  // falls back to, then the numeric attempt, then the key. Sorting only the
  // exercise rows left the container scores in insertion order, which does
  // not survive a multi-device merge. REQUIREMENTS 3.17, 3.19, 3.20, 22.4.5.
  for (const group of orderedGroups) {
    group.rows.sort((a, b) => compareRows(ranks, a, b));
    group.containers.sort((a, b) => compareRows(ranks, a, b));
  }

  const model: SummaryModel = {
    title: workout?.name ?? session.workoutId,
    statusLabel: SESSION_STATUS_LABELS.get(session.status) ?? session.status,
    startedLabel: formatHistoryDate(session.startedAtUtc, nowValue, localTimeZone),
    completedLabel: formatHistoryDate(session.completedAtUtc, nowValue, localTimeZone),
    groups: orderedGroups,
    blocks: buildDisplayBlocks(orderedGroups, workout),
    unresolved,
    isEmpty: orderedGroups.length === 0,
    workoutUnresolved: workout === undefined,
    rawJson: JSON.stringify(session, null, 2)
  };
  if (session.notes !== undefined) model.notes = session.notes;
  return model;
}

/**
 * The heading for one group.
 *
 * The container's own name, plus `Round N` when the occurrence carries an
 * iteration, so the rounds of a repeated container read apart instead of
 * repeating one heading.
 */
function titleForGroup(segments: PathSegment[], workout: Workout | undefined): string {
  const last = segments.length > 0 ? segments[segments.length - 1] : undefined;
  const nodeId = last === undefined ? '' : last.nodeId;
  const node = resolvedNode(workout, segments);
  const name = nodeName(node) === '' ? nodeId : nodeName(node);
  if (name === '') return 'Recorded work';
  return `${name}${roundSuffix(last)}`;
}
