// Cross-field and cross-document checks JSON Schema cannot express.
// specs/rep-jot-json-schema-spec.md section 8, REQUIREMENTS 6.7-6.22, 10.4-10.18.
//
// Two outcomes, and the split is the whole design:
//
//   Fatal issue    The document breaks a rule the current contract states.
//                The caller rejects the document.
//   Unresolved   The document is fine. The static bundle changed underneath it.
//                The caller keeps every recorded value and shows one error card.
//                REQUIREMENTS 6.10, 6.11.
//
// This module reads. It never rewrites, substitutes, or repairs. A migration that
// wants to fix a reference still has to do it in the open, in a migration step.
//
// Several checks here repeat what the shipped v1 JSON Schemas already enforce.
// That redundancy is deliberate: `validateSession` also runs against values the
// editor built in memory, which never passed a schema, so this module stands on
// its own.

import type {
  ContainerNode,
  Exercise,
  ExerciseResult,
  Prescription,
  ResultsShard,
  Session,
  StaticData,
  Workout,
  WorkoutNode
} from '../domain/types';
import type { ResultStatus } from '../domain/enums';
import type { PathSegment } from '../domain/execution-path';
import { containerResultKey, encodePath, exerciseResultKey, sameSegment } from '../domain/execution-path';
import { isIntegerLikeKey } from '../domain/ids';
import { parseUtc, yearMonthUtc } from '../domain/time';
import {
  ISSUE_CODES,
  issue,
  type UnresolvedPreferenceReason,
  type UnresolvedReason,
  type UnresolvedResult,
  type ValidationIssue
} from './issues';

/** Fatal issues plus the nonfatal unresolved references found in one pass. */
export interface SemanticReport {
  /** Fatal. The caller rejects the document. */
  issues: ValidationIssue[];
  /** Nonfatal. The caller keeps the values and marks each card unresolved. */
  unresolved: UnresolvedResult[];
}

function createReport(): SemanticReport {
  return { issues: [], unresolved: [] };
}

function merge(target: SemanticReport, source: SemanticReport): void {
  target.issues.push(...source.issues);
  target.unresolved.push(...source.unresolved);
}

// ---------------------------------------------------------------------------
// Dimensions and units
// ---------------------------------------------------------------------------

/** Units each dimension accepts, independent of any exercise. Spec item 7. */
const DIMENSION_UNITS: Record<string, readonly string[]> = {
  reps: ['reps'],
  weight: ['lb', 'kg'],
  addedWeight: ['lb', 'kg'],
  assistedWeight: ['lb', 'kg'],
  distance: ['m', 'km', 'ft', 'mi'],
  duration: ['second', 'minute'],
  calories: ['kcal']
};

/** The quantity keys a `resultValues` or `Prescription` object may carry. */
const QUANTITY_KEYS = Object.keys(DIMENSION_UNITS);

/** Units the exercise declares for one dimension, or `undefined` if none. */
function unitsForDimension(exercise: Exercise, dimension: string): readonly string[] | undefined {
  for (const support of exercise.measurements) {
    if (support.dimension === dimension) return support.compatibleUnits;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Shared small checks
// ---------------------------------------------------------------------------

const BANNED_ID_CHARACTERS = ['/', '|', ':'];

/** Report a fatal issue when `value` cannot serve as an ID or a plain map key. */
function checkIdCharacters(
  report: SemanticReport,
  value: string,
  path: string,
  label: string
): void {
  for (const character of BANNED_ID_CHARACTERS) {
    if (value.includes(character)) {
      report.issues.push(
        issue(ISSUE_CODES.BANNED_ID_CHARACTER, path, `A ${label} must not contain "${character}".`)
      );
    }
  }
}

/** Report a fatal issue when a map key is all digits. REQUIREMENTS 3.17, 3.18. */
function checkKeyNotIntegerLike(report: SemanticReport, key: string, path: string, label: string): void {
  if (isIntegerLikeKey(key)) {
    report.issues.push(
      issue(
        ISSUE_CODES.INTEGER_LIKE_KEY,
        path,
        `A ${label} key must not be all digits, because JavaScript reorders such a key.`
      )
    );
  }
}

/**
 * Report a fatal issue when a multi-writer collection is an array.
 *
 * Every collection two devices can change is a keyed map, so a merge matches one
 * entry to one key. An array merges by position and loses entries. The shipped
 * schemas ask for a record; this check catches the same fault in values the
 * editor built in memory. Spec item 23.
 */
function checkKeyedMap(report: SemanticReport, value: unknown, path: string, label: string): void {
  if (Array.isArray(value)) {
    report.issues.push(
      issue(ISSUE_CODES.KEYED_MAP_REQUIRED, path, `${label} must be a keyed map, not an array.`)
    );
  }
}

/**
 * Report a fatal issue when `status` and `reasonCode` disagree.
 *
 * A result the user did not complete names why with a controlled reason code.
 * A completed result carries none. A skipped result carries no measured value and
 * no score, because nothing was attempted. Free text belongs in notes, never in a
 * reason. REQUIREMENTS 11.4.
 *
 * @param payload The field a skipped result must not hold: `values` or `score`.
 */
function checkStatusReason(
  report: SemanticReport,
  path: string,
  status: ResultStatus,
  reasonCode: string | undefined,
  payload: unknown,
  payloadLabel: string
): void {
  if (status === 'completed') {
    if (reasonCode !== undefined) {
      report.issues.push(
        issue(
          ISSUE_CODES.REASON_CODE_FORBIDDEN,
          `${path}.reasonCode`,
          'A completed result must not record a reason code.'
        )
      );
    }
    return;
  }

  if (reasonCode === undefined) {
    report.issues.push(
      issue(
        ISSUE_CODES.REASON_CODE_MISSING,
        `${path}.reasonCode`,
        `A ${status} result must record a reason code.`
      )
    );
  }

  if (status === 'skipped' && payload !== undefined) {
    report.issues.push(
      issue(
        ISSUE_CODES.SKIPPED_RESULT_HAS_PAYLOAD,
        `${path}.${payloadLabel}`,
        `A skipped result must not record ${payloadLabel}.`
      )
    );
  }
}

/**
 * Report a fatal issue when a persisted `*Utc` value is not RFC 3339 UTC.
 *
 * An absent optional field is legal and reports nothing. Spec item 25.
 */
function checkUtc(
  report: SemanticReport,
  value: string | undefined,
  path: string,
  label: string
): void {
  if (value === undefined) return;
  if (typeof value !== 'string' || !value.endsWith('Z')) {
    report.issues.push(
      issue(
        ISSUE_CODES.TIMESTAMP_NOT_UTC,
        path,
        `The ${label} timestamp must end in "Z".`
      )
    );
    return;
  }
  try {
    parseUtc(value);
  } catch {
    report.issues.push(
      issue(
        ISSUE_CODES.TIMESTAMP_NOT_UTC,
        path,
        `The ${label} timestamp is not an RFC 3339 UTC date-time ending in "Z".`
      )
    );
  }
}

/**
 * Compare a stored composite key with the key recomputed from its own value.
 *
 * The key builders throw on input the schema already rejects. A throw means the
 * value cannot produce the key it was stored under, so it reports a mismatch
 * rather than escaping. Spec items 14, 15. REQUIREMENTS 22.4.9.
 */
function checkCompositeKey(
  report: SemanticReport,
  storedKey: string,
  build: () => string,
  path: string,
  label: string
): void {
  let expected: string;
  try {
    expected = build();
  } catch {
    expected = '';
  }
  if (storedKey !== expected) {
    report.issues.push(
      issue(ISSUE_CODES.KEY_MISMATCH, path, `The ${label} key does not match the value it maps to.`)
    );
  }
}

/** Encode a path for an unresolved entry without throwing on a broken path. */
function safeEncodedPath(segments: PathSegment[] | undefined): string {
  if (!Array.isArray(segments) || segments.length === 0) return '';
  try {
    return encodePath(segments);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Workout tree index and path resolution
// ---------------------------------------------------------------------------

/** A path resolved against one workout tree. */
type ResolvedPath =
  | { ok: true; node: WorkoutNode }
  | { ok: false; reason: 'broken_path'; depth: number };

function isRepeatedContainer(node: WorkoutNode): node is ContainerNode {
  return node.type === 'container' && node.strategy !== 'sequence';
}

/**
 * Walk one execution path from the workout root.
 *
 * A segment may carry an `iteration` only on a repeated container: `rounds`,
 * `amrap`, `emom`, or `complex`. A `sequence` runs once, so an iteration on it
 * does not resolve.
 *
 * Every repeated container segment below the last one must carry an `iteration`.
 * The value is one-based and cannot exceed the container's configured count, so a
 * round 999 of a three-round container does not resolve. An AMRAP has no ceiling.
 * The last segment is exempt: a container result addresses the whole container,
 * not one of its iterations. Spec items 12, 13. REQUIREMENTS 10.8.
 */
function resolvePath(workout: Workout, segments: PathSegment[] | undefined): ResolvedPath {
  if (!Array.isArray(segments) || segments.length === 0) {
    return { ok: false, reason: 'broken_path', depth: 0 };
  }
  if (segments[0].nodeId !== workout.root.id) {
    return { ok: false, reason: 'broken_path', depth: 0 };
  }

  let current: WorkoutNode = workout.root;
  for (let depth = 1; depth < segments.length; depth += 1) {
    const segment = segments[depth];
    if (current.type !== 'container') {
      return { ok: false, reason: 'broken_path', depth };
    }
    const next: WorkoutNode | undefined = current.children.find(
      (child) => child.id === segment.nodeId
    );
    if (next === undefined) {
      return { ok: false, reason: 'broken_path', depth };
    }
    if (segment.iteration !== undefined && !isRepeatedContainer(next)) {
      return { ok: false, reason: 'broken_path', depth };
    }
    if (depth < segments.length - 1 && isRepeatedContainer(next)) {
      const max = iterationCount(next);
      const iteration = segment.iteration;
      if (
        iteration === undefined ||
        !Number.isInteger(iteration) ||
        iteration < 1 ||
        iteration > max
      ) {
        return { ok: false, reason: 'broken_path', depth };
      }
    }
    current = next;
  }

  return { ok: true, node: current };
}

/** How many times a repeated container runs. An AMRAP has no fixed ceiling. */
function iterationCount(container: ContainerNode): number {
  switch (container.strategy) {
    case 'rounds':
      return container.strategyConfig.rounds;
    case 'emom':
    case 'complex':
      return container.strategyConfig.cycles;
    case 'amrap':
      return Infinity;
    default:
      return 1;
  }
}

/** Every exercise node reachable at or below `node`, in tree order. */
function exerciseLeaves(node: WorkoutNode): ExerciseNodeLike[] {
  const leaves: ExerciseNodeLike[] = [];
  const walk = (current: WorkoutNode): void => {
    if (current.type === 'exercise') {
      leaves.push(current);
      return;
    }
    for (const child of current.children) walk(child);
  };
  walk(node);
  return leaves;
}

/** The exercise-node shape this module needs, narrowed from `WorkoutNode`. */
type ExerciseNodeLike = Extract<WorkoutNode, { type: 'exercise' }>;

/**
 * Report duplicate node IDs inside one workout.
 *
 * Node IDs are scoped to one workout, so the same ID in two workouts is legal.
 * A duplicate does not end the descent: a second duplicate can sit inside the
 * first one's subtree, and the check claims the whole workout. A node object is
 * visited once, so a graph that points back at itself stops instead of looping.
 * REQUIREMENTS 6.20.
 */
function checkDuplicateNodeIds(workout: Workout, report: SemanticReport): void {
  const seen = new Set<string>();
  const visited = new Set<WorkoutNode>();
  const walk = (node: WorkoutNode): void => {
    if (seen.has(node.id)) {
      report.issues.push(
        issue(
          ISSUE_CODES.DUPLICATE_NODE_ID,
          `workout ${workout.id} node ${node.id}`,
          'Two nodes in one workout share a node ID.'
        )
      );
    }
    seen.add(node.id);
    if (visited.has(node)) return;
    visited.add(node);
    if (node.type === 'container') {
      for (const child of node.children) walk(child);
    }
  };
  walk(workout.root);
}

// ---------------------------------------------------------------------------
// Static data
// ---------------------------------------------------------------------------

/**
 * The static identity checks the build must run.
 *
 * REQUIREMENTS 6.19 through 6.22. The schema pass covers 6.19 and already ran.
 * This adds 6.20 and 6.21 and nothing else. Cross-release checks are outside the
 * contract: any release may rename, re-parent, or remove static data.
 */
export function validateStaticData(exercises: Exercise[], workouts: Workout[]): ValidationIssue[] {
  const report = createReport();
  const exerciseIds = new Set(exercises.map((exercise) => exercise.id));

  // Spec item 21: no static ID or non-null equipment value may carry a composite
  // key separator. REQUIREMENTS 22.4.6.
  for (const exercise of exercises) {
    checkIdCharacters(report, exercise.id, `exercise ${exercise.id}`, 'exercise ID');
    if (exercise.equipment !== null) {
      checkIdCharacters(
        report,
        exercise.equipment,
        `exercise ${exercise.id}.equipment`,
        'equipment value'
      );
    }
  }

  for (const workout of workouts) {
    checkIdCharacters(report, workout.id, `workout ${workout.id}`, 'workout ID');
    checkDuplicateNodeIds(workout, report);

    const walk = (node: WorkoutNode): void => {
      checkIdCharacters(report, node.id, `workout ${workout.id} node ${node.id}`, 'node ID');
      if (node.type === 'exercise') {
        if (!exerciseIds.has(node.exerciseId)) {
          report.issues.push(
            issue(
              ISSUE_CODES.UNKNOWN_EXERCISE,
              `workout ${workout.id} node ${node.id}`,
              'A workout node references an exercise the bundle does not hold.'
            )
          );
        }
        return;
      }
      for (const child of node.children) walk(child);
    };
    walk(workout.root);
  }

  return report.issues;
}

/**
 * Prescription rules that need the exercise directory.
 *
 * Spec items 19 and 20. REQUIREMENTS 10.4, 10.5. Kept out of
 * `validateStaticData` on purpose: REQUIREMENTS 6.22 pins that function to the
 * three identity checks. A build gate MAY call this second; the runtime does not.
 */
export function validateWorkoutSemantics(
  workouts: Workout[],
  exercises: Exercise[]
): ValidationIssue[] {
  const report = createReport();
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));

  const checkQuantities = (
    holder: object,
    exercise: Exercise | undefined,
    holderPath: string
  ): void => {
    if (exercise === undefined) return;
    const record = holder as Record<string, unknown>;
    for (const key of QUANTITY_KEYS) {
      if (record[key] === undefined) continue;
      if (unitsForDimension(exercise, key) === undefined) {
        report.issues.push(
          issue(
            ISSUE_CODES.PRESCRIPTION_DIMENSION_UNDECLARED,
            `${holderPath}.${key}`,
            'A prescription uses a dimension the referenced exercise does not declare.'
          )
        );
      }
    }
  };

  const checkIterations = (
    prescription: Prescription,
    exercise: Exercise | undefined,
    maxIteration: number,
    prescriptionPath: string
  ): void => {
    const overrides = prescription.iterations;
    if (overrides === undefined) return;

    const seen = new Set<number>();
    overrides.forEach((override, position) => {
      const overridePath = `${prescriptionPath}.iterations[${String(position)}]`;

      if (!Number.isInteger(override.iteration) || override.iteration < 1) {
        report.issues.push(
          issue(
            ISSUE_CODES.ITERATION_OUT_OF_RANGE,
            overridePath,
            'An iteration number must be a one-based integer.'
          )
        );
      } else if (override.iteration > maxIteration) {
        report.issues.push(
          issue(
            ISSUE_CODES.ITERATION_OUT_OF_RANGE,
            overridePath,
            'An iteration number exceeds the nearest repeated container.'
          )
        );
      }

      if (seen.has(override.iteration)) {
        report.issues.push(
          issue(
            ISSUE_CODES.ITERATION_DUPLICATE,
            overridePath,
            'One prescription repeats an iteration number.'
          )
        );
      }
      seen.add(override.iteration);

      checkQuantities(override, exercise, overridePath);
    });
  };

  const walkNode = (
    workout: Workout,
    node: WorkoutNode,
    nearestRepeated: ContainerNode | undefined
  ): void => {
    const nodePath = `workout ${workout.id} node ${node.id}`;

    if (node.type === 'exercise') {
      const exercise = exerciseById.get(node.exerciseId);
      const maxIteration = nearestRepeated === undefined ? 0 : iterationCount(nearestRepeated);
      const prescriptionPath = `${nodePath}.prescription`;
      checkQuantities(node.prescription, exercise, prescriptionPath);
      checkIterations(node.prescription, exercise, maxIteration, prescriptionPath);
      if (nearestRepeated === undefined && node.prescription.iterations !== undefined) {
        report.issues.push(
          issue(
            ISSUE_CODES.ITERATION_OUT_OF_RANGE,
            `${prescriptionPath}.iterations`,
            'An iteration override needs a repeated container above it.'
          )
        );
      }
      return;
    }

    const repeated = isRepeatedContainer(node) ? node : nearestRepeated;
    for (const child of node.children) walkNode(workout, child, repeated);
  };

  for (const workout of workouts) walkNode(workout, workout.root, undefined);

  return report.issues;
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/**
 * Check every preferred unit against the current exercise.
 *
 * A bad mapping is nonfatal. One stale mapping must not reject the whole
 * document; the unit pill shows the card instead. REQUIREMENTS 12.4, spec item 9.
 */
export function validatePreferences(
  prefs: { exerciseUnits: Record<string, Record<string, string>> },
  exercises: Exercise[]
): SemanticReport {
  const report = createReport();
  const exerciseById = new Map(exercises.map((exercise) => [exercise.id, exercise]));

  checkKeyedMap(report, prefs.exerciseUnits, 'exerciseUnits', 'The exerciseUnits map');

  for (const [exerciseId, dimensions] of Object.entries(prefs.exerciseUnits)) {
    const exercisePath = `exerciseUnits.${exerciseId}`;
    checkKeyNotIntegerLike(report, exerciseId, 'exerciseUnits', 'preference');
    checkIdCharacters(report, exerciseId, exercisePath, 'exercise ID');

    const exercise = exerciseById.get(exerciseId);
    if (exercise === undefined) {
      report.unresolved.push({
        kind: 'preference',
        reason: 'unknown_exercise',
        exerciseId,
        dimension: '',
        unit: ''
      });
      continue;
    }

    for (const [dimension, unit] of Object.entries(dimensions)) {
      const dimensionPath = `${exercisePath}.${dimension}`;
      checkKeyNotIntegerLike(report, dimension, `${exercisePath} dimension`, 'dimension');
      checkIdCharacters(report, dimension, dimensionPath, 'dimension');

      const compatible = unitsForDimension(exercise, dimension);
      let reason: UnresolvedPreferenceReason | undefined;
      if (compatible === undefined) {
        reason = 'measurements_changed';
      } else if (!compatible.includes(unit)) {
        reason = 'unit_incompatible';
      }

      if (reason !== undefined) {
        report.unresolved.push({ kind: 'preference', reason, exerciseId, dimension, unit });
      }
    }
  }

  return report;
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/**
 * One exercise result: identity checks first, then reference resolution.
 *
 * An unresolved result stops only the tree-dependent checks for that result. Its
 * siblings keep validating, so one bad card never breaks the list.
 * REQUIREMENTS 6.10.
 *
 * Returns `true` when the result resolved against the current bundle, and
 * `false` when it was marked unresolved. The caller uses that to skip the
 * tree-dependent checks, so a nonfatal reference never also reports a fatal one.
 */
function checkExerciseResult(
  report: SemanticReport,
  sessionKey: string,
  resultKey: string,
  result: ExerciseResult,
  sessionWorkoutId: string,
  workout: Workout | undefined,
  exerciseById: Map<string, Exercise>
): boolean {
  const path = `sessions.${sessionKey}.exerciseResults.${resultKey}`;
  const encodedPath = safeEncodedPath(result.executionPath);

  const markUnresolved = (reason: UnresolvedReason): void => {
    report.unresolved.push({
      kind: 'result',
      reason,
      sessionKey,
      resultKey,
      workoutId: result.workoutId ?? sessionWorkoutId,
      exerciseId: result.exerciseId,
      encodedPath
    });
  };

  // Identity checks. These need no static data.
  checkCompositeKey(
    report,
    resultKey,
    () => exerciseResultKey(result.executionPath, result.side ?? 'both', result.attempt ?? 1),
    path,
    'exercise result'
  );

  if (result.workoutId !== sessionWorkoutId) {
    report.issues.push(
      issue(
        ISSUE_CODES.WORKOUT_ID_MISMATCH,
        path,
        'A result workoutId differs from its containing session.'
      )
    );
  }

  if (result.side === 'alternating') {
    if (result.startingSide === undefined) {
      report.issues.push(
        issue(
          ISSUE_CODES.STARTING_SIDE,
          path,
          'An alternating result must record the side it starts on.'
        )
      );
    }
  } else if (result.startingSide !== undefined) {
    report.issues.push(
      issue(
        ISSUE_CODES.STARTING_SIDE,
        path,
        'Only an alternating result may record a starting side.'
      )
    );
  }

  checkStatusReason(report, path, result.status, result.reasonCode, result.values, 'values');

  checkUtc(report, result.startedAtUtc, `${path}.startedAtUtc`, 'result start');
  checkUtc(report, result.endedAtUtc, `${path}.endedAtUtc`, 'result end');

  // Dimension and unit checks against the global vocabulary. Spec item 7.
  if (result.values !== undefined) {
    for (const [dimension, quantity] of Object.entries(result.values)) {
      const accepted = DIMENSION_UNITS[dimension];
      if (accepted === undefined) {
        report.issues.push(
          issue(
            ISSUE_CODES.UNIT_UNSUPPORTED,
            `${path}.values.${dimension}`,
            'A result quantity uses a dimension the contract does not define.'
          )
        );
        continue;
      }
      if (!accepted.includes(quantity.unit)) {
        report.issues.push(
          issue(
            ISSUE_CODES.UNIT_UNSUPPORTED,
            `${path}.values.${dimension}.unit`,
            'A result quantity unit is not compatible with its dimension.'
          )
        );
      }
    }
  }

  // Reference resolution. The order fixes the reason when several cases apply.
  if (workout === undefined) {
    markUnresolved('unknown_workout');
    return false;
  }

  const exercise = exerciseById.get(result.exerciseId);
  if (exercise === undefined) {
    markUnresolved('unknown_exercise');
    return false;
  }

  const resolved = resolvePath(workout, result.executionPath);
  if (resolved.ok === false || resolved.node.type !== 'exercise') {
    markUnresolved('broken_path');
    return false;
  }
  if (resolved.node.exerciseId !== result.exerciseId) {
    markUnresolved('path_exercise_mismatch');
    return false;
  }

  // The current exercise may no longer cover a stored dimension. Spec item 8.
  if (result.values !== undefined) {
    for (const [dimension, quantity] of Object.entries(result.values)) {
      if (DIMENSION_UNITS[dimension] === undefined) continue;
      const compatible = unitsForDimension(exercise, dimension);
      if (compatible === undefined) {
        markUnresolved('measurements_changed');
        return false;
      }
      if (!compatible.includes(quantity.unit)) {
        markUnresolved('unit_incompatible');
        return false;
      }
    }
  }

  return true;
}

/**
 * Child detail obeys the container `childDetail` rule. Spec item 11.
 *
 * The nearest scored container above the result governs. `childDetail: "none"`
 * makes that container's score authoritative and forbids child results beneath it.
 */
function checkChildDetailAllowed(
  report: SemanticReport,
  sessionKey: string,
  resultKey: string,
  workout: Workout,
  segments: PathSegment[]
): void {
  for (let depth = segments.length - 2; depth >= 0; depth -= 1) {
    const resolved = resolvePath(workout, segments.slice(0, depth + 1));
    if (resolved.ok === false || resolved.node.type !== 'container') continue;

    const capture = resolved.node.resultCapture;
    if (capture === undefined) continue;

    if (capture.childDetail === 'none') {
      report.issues.push(
        issue(
          ISSUE_CODES.CHILD_DETAIL_FORBIDDEN,
          `sessions.${sessionKey}.exerciseResults.${resultKey}`,
          `Container ${resolved.node.id} records its score with no child detail.`
        )
      );
    }
    return;
  }
}

/** One saved child exercise result, tagged with the container iteration it falls in. */
interface ChildEntry {
  iteration: number;
  childPosition: number;
  result: ExerciseResult;
}

/**
 * Collect the exercise results stored beneath `containerPath`.
 *
 * The segment match is the shared `sameSegment` helper from the execution-path
 * module, so this selection rule and the session service's `childrenBelow` rule
 * cannot drift apart. See that helper for the iteration normalization rule.
 *
 * A child path repeats the container segment with its own `iteration`, so the
 * container's iteration sits at `containerPath.length - 1` on the child path, and
 * the container's direct child sits one step later.
 *
 * Every segment above the container must match in node ID **and** iteration. A
 * match on node ID alone pulls a child of another outer round into this
 * container's derivation: `root/outer:2/inner:1/...` would otherwise read as a
 * child of `root/outer:1/inner`. Spec items 12, 13. REQUIREMENTS 10.8, 10.12,
 * 10.13.
 */
function collectChildResults(
  exerciseResults: Record<string, ExerciseResult>,
  containerPath: PathSegment[],
  container: ContainerNode
): ChildEntry[] {
  const entries: ChildEntry[] = [];
  const ownIndex = containerPath.length - 1;
  const ownSegment = containerPath[ownIndex];

  for (const result of Object.values(exerciseResults)) {
    const path = result.executionPath;
    if (!Array.isArray(path) || path.length <= containerPath.length) continue;
    if (path[ownIndex]?.nodeId !== ownSegment.nodeId) continue;

    let matches = true;
    for (let index = 0; index < ownIndex; index += 1) {
      if (!sameSegment(path[index], containerPath[index])) {
        matches = false;
        break;
      }
    }
    if (!matches) continue;

    // A child of a repeated container names its round on the container segment.
    // A child that omits it is already unresolved, so skip it rather than guess.
    const own = path[ownIndex];
    if (isRepeatedContainer(container) && own.iteration === undefined) continue;
    const iteration = own.iteration ?? 1;
    if (!Number.isInteger(iteration) || iteration < 1) continue;

    const childId = path[containerPath.length]?.nodeId;
    const childPosition = container.children.findIndex((child) => child.id === childId);
    if (childPosition === -1) continue;

    entries.push({ iteration, childPosition, result });
  }

  return entries;
}

/**
 * Reps one exercise node prescribes for one iteration.
 *
 * An `iterations` override wins over the top-level value. A range prescribes its
 * floor, an approximate target prescribes the target.
 */
function prescribedReps(node: ExerciseNodeLike, iteration: number): number | undefined {
  const override = node.prescription.iterations?.find((entry) => entry.iteration === iteration);
  const reps = override?.reps ?? node.prescription.reps;
  if (reps === undefined) return undefined;
  if (typeof reps === 'number') return reps;
  if ('min' in reps) return reps.min;
  if ('target' in reps) return reps.target;
  return undefined;
}

/**
 * Derive the standard aggregate from saved child detail and compare it.
 *
 * Rules, fixed here because no upstream document states them:
 *
 * `cycles`
 *   Iteration i counts when at least one completed child result sits at i.
 *   Iterations present must run 1..N with no gap.
 *
 * `intervals`
 *   `totalIntervals` must equal cycles x direct children. One slot is
 *   (iteration, direct-child position) in cycle-major order. A slot counts once
 *   when a completed child result fills it, and filled slots must form a prefix.
 *   When the cycle count is not finite, as in an AMRAP, the total is not
 *   derivable, so that comparison is skipped and the rest still holds.
 *
 * `rounds_and_reps`
 *   A round is full when every leaf under the container holds a completed result
 *   whose reps meet that leaf's prescribed reps. Full rounds run 1..N with no
 *   gap. The next iteration may hold a partial round, whose recorded reps sum to
 *   `additionalReps`. Nothing may appear past that partial round. When a leaf
 *   prescribes no reps the round is not deterministic, so the derivation is
 *   skipped rather than guessed.
 *
 * REQUIREMENTS 10.12, 10.13, 10.18. Spec items 12, 24.
 */
function deriveAndCompare(
  report: SemanticReport,
  path: string,
  container: ContainerNode,
  containerPathLength: number,
  score: Record<string, unknown>,
  children: ChildEntry[]
): void {
  const mismatch = (detail: string): void => {
    report.issues.push(
      issue(
        ISSUE_CODES.SCORE_DERIVATION_MISMATCH,
        path,
        `Saved child detail does not derive the stored score: ${detail}.`
      )
    );
  };

  const presentIterations = new Set<number>();
  const completedIterations = new Set<number>();
  for (const entry of children) {
    presentIterations.add(entry.iteration);
    if (entry.result.status === 'completed') completedIterations.add(entry.iteration);
  }

  const prefixLength = (set: Set<number>): number => {
    let count = 0;
    while (set.has(count + 1)) count += 1;
    return count;
  };

  if (score.type === 'cycles') {
    if (prefixLength(presentIterations) !== presentIterations.size) {
      mismatch('child iterations have a gap');
      return;
    }
    const derived = prefixLength(completedIterations);
    if (derived !== score.completedCycles) {
      mismatch('the derived cycle count differs from the stored count');
    }
    return;
  }

  if (score.type === 'intervals') {
    const cycles = iterationCount(container);
    const childCount = container.children.length;
    // An AMRAP has no fixed cycle count, so `totalIntervals` cannot be derived.
    // Skip that one comparison and still check what the child detail decides.
    if (Number.isFinite(cycles) && score.totalIntervals !== cycles * childCount) {
      mismatch('totalIntervals does not equal the cycle count times the child count');
      return;
    }

    const filled = new Set<number>();
    for (const entry of children) {
      if (entry.result.status !== 'completed') continue;
      filled.add((entry.iteration - 1) * childCount + entry.childPosition);
    }
    const prefix = prefixLengthZero(filled);
    if (filled.size !== prefix) {
      mismatch('completed intervals have a gap');
      return;
    }
    if (prefix !== score.completedIntervals) {
      mismatch('the derived completed-interval count differs from the stored count');
    }
    if (typeof score.totalIntervals === 'number' && prefix > score.totalIntervals) {
      mismatch('more intervals are complete than the stored total');
    }
    return;
  }

  if (score.type === 'rounds_and_reps') {
    const leaves = exerciseLeaves(container);
    if (leaves.length === 0) return;

    /** Completed reps for each leaf at one iteration, in leaf order. */
    const repsAt = (iteration: number): number[] | undefined => {
      const out: number[] = [];
      for (const leaf of leaves) {
        const match = children.find(
          (entry) =>
            entry.iteration === iteration &&
            entry.result.status === 'completed' &&
            coversLeaf(leaf.id, entry.result.executionPath, containerPathLength)
        );
        if (match === undefined) return undefined;
        const reps = match.result.values?.reps?.value;
        if (reps === undefined) return undefined;
        out.push(reps);
      }
      return out;
    };

    /** Prescribed reps for each leaf at one iteration, or undefined if any is absent. */
    const prescribedAt = (iteration: number): number[] | undefined => {
      const out: number[] = [];
      for (const leaf of leaves) {
        const prescribed = prescribedReps(leaf, iteration);
        if (prescribed === undefined) return undefined;
        out.push(prescribed);
      }
      return out;
    };

    const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

    let rounds = 0;
    let partialReps = 0;
    let hasPartial = false;

    for (;;) {
      const iteration = rounds + 1;
      const prescribed = prescribedAt(iteration);
      if (prescribed === undefined) return;

      const actual = repsAt(iteration);
      if (actual === undefined) break;

      // A round is full only when every leaf meets its own prescription. One
      // leaf's surplus cannot cover another leaf's shortfall. REQUIREMENTS 10.17,
      // 10.18.
      if (!actual.every((reps, index) => reps >= prescribed[index])) {
        partialReps = sum(actual);
        hasPartial = true;
        break;
      }
      rounds += 1;
    }

    const partialIteration = rounds + 1;
    const past = [...presentIterations].filter((i) => i > partialIteration);
    if (past.length > 0) {
      mismatch('child detail continues past the partial round');
      return;
    }

    const additional = hasPartial ? partialReps : 0;
    if (rounds !== score.completedRounds || additional !== score.additionalReps) {
      mismatch('the derived rounds and additional reps differ from the stored values');
    }
  }
}

/** Prefix length of a zero-based set. */
function prefixLengthZero(set: Set<number>): number {
  let count = 0;
  while (set.has(count)) count += 1;
  return count;
}

/**
 * True when the child result path passes through `leafId` below the container.
 *
 * The search starts one step past the container segment, so a node above the
 * container never matches by name.
 */
function coversLeaf(leafId: string, path: PathSegment[], containerPathLength: number): boolean {
  for (let index = containerPathLength; index < path.length; index += 1) {
    if (path[index].nodeId === leafId) return true;
  }
  return false;
}

/**
 * Validate one session against the current static bundle.
 *
 * @param opts.shardYearMonthUtc The shard's `yearMonthUtc`. Check 14 ties the
 *        session start month to it.
 * @param opts.sessionKey The `sessions` map key. Pass it to get the key check;
 *        omit it when the caller holds only the session value.
 */
export function validateSession(
  session: Session,
  staticData: StaticData,
  opts: { shardYearMonthUtc: string; sessionKey?: string }
): SemanticReport {
  const report = createReport();
  const sessionKey = opts.sessionKey ?? session.id;
  const path = `sessions.${sessionKey}`;

  if (opts.sessionKey !== undefined && opts.sessionKey !== session.id) {
    report.issues.push(
      issue(
        ISSUE_CODES.SESSION_KEY_MISMATCH,
        path,
        'A sessions map key differs from the session id it maps to.'
      )
    );
  }
  if (!session.id.startsWith('session-')) {
    report.issues.push(
      issue(
        ISSUE_CODES.SESSION_ID_PREFIX,
        `${path}.id`,
        'A session id must carry the "session-" prefix.'
      )
    );
  }

  const terminal = session.status === 'completed' || session.status === 'abandoned';
  if (session.status === 'in_progress' && session.completedAtUtc !== undefined) {
    report.issues.push(
      issue(
        ISSUE_CODES.SESSION_STATUS_TIMESTAMP,
        `${path}.completedAtUtc`,
        'An in_progress session must not record a completion time.'
      )
    );
  }
  if (terminal && session.completedAtUtc === undefined) {
    report.issues.push(
      issue(
        ISSUE_CODES.SESSION_STATUS_TIMESTAMP,
        `${path}.completedAtUtc`,
        'A terminal session must record a completion time.'
      )
    );
  }

  const raw = session as unknown as Record<string, unknown>;
  checkKeyedMap(report, session.exerciseResults, `${path}.exerciseResults`, 'A session exerciseResults map');
  checkKeyedMap(report, session.containerResults, `${path}.containerResults`, 'A session containerResults map');
  if ('executionPlan' in raw) {
    report.issues.push(
      issue(
        ISSUE_CODES.FORBIDDEN_FIELD,
        `${path}.executionPlan`,
        'A session must not store an execution plan. The tree resolves from the current bundle.'
      )
    );
  }

  checkUtc(report, session.startedAtUtc, `${path}.startedAtUtc`, 'session start');
  checkUtc(report, session.completedAtUtc, `${path}.completedAtUtc`, 'session completion');
  checkUtc(report, session.updatedAtUtc, `${path}.updatedAtUtc`, 'session update');

  try {
    if (yearMonthUtc(session.startedAtUtc) !== opts.shardYearMonthUtc) {
      report.issues.push(
        issue(
          ISSUE_CODES.SHARD_MONTH_MISMATCH,
          `${path}.startedAtUtc`,
          'A session start month differs from its shard month.'
        )
      );
    }
  } catch {
    // The timestamp check above already reported it.
  }

  const workout = staticData.workouts.find((candidate) => candidate.id === session.workoutId);
  const exerciseById = new Map(staticData.exercises.map((exercise) => [exercise.id, exercise]));
  const seenContainerKeys = new Set<string>();

  for (const [resultKey, result] of Object.entries(session.exerciseResults)) {
    checkKeyNotIntegerLike(report, resultKey, `${path}.exerciseResults`, 'exercise result');
    const resolved = checkExerciseResult(
      report,
      sessionKey,
      resultKey,
      result,
      session.workoutId,
      workout,
      exerciseById
    );
    // Skip the child-detail rule for an unresolved result. Its reference is the
    // finding; a second fatal on the same card would be noise. REQUIREMENTS 6.10.
    if (resolved && workout !== undefined) {
      checkChildDetailAllowed(report, sessionKey, resultKey, workout, result.executionPath);
    }
  }

  for (const [resultKey, result] of Object.entries(session.containerResults)) {
    checkKeyNotIntegerLike(report, resultKey, `${path}.containerResults`, 'container result');
    checkContainerResult(
      report,
      sessionKey,
      resultKey,
      result,
      session.workoutId,
      workout,
      exerciseById,
      session.exerciseResults,
      seenContainerKeys
    );
  }

  return report;
}

/**
 * Container result checks: identity, score type, and score derivation.
 *
 * Spec items 10, 12, 13, 24. Derivation runs only when a standard score meets
 * saved child detail. With no child detail the score is authoritative, which is
 * aggregate-only entry under REQUIREMENTS 10.13.
 */
function checkContainerResult(
  report: SemanticReport,
  sessionKey: string,
  resultKey: string,
  result: Session['containerResults'][string],
  sessionWorkoutId: string,
  workout: Workout | undefined,
  exerciseById: Map<string, Exercise>,
  exerciseResults: Record<string, ExerciseResult>,
  seenContainerKeys: Set<string>
): void {
  const path = `sessions.${sessionKey}.containerResults.${resultKey}`;
  const encodedPath = safeEncodedPath(result.executionPath);

  const markUnresolved = (reason: UnresolvedReason): void => {
    report.unresolved.push({
      kind: 'result',
      reason,
      sessionKey,
      resultKey,
      workoutId: result.workoutId ?? sessionWorkoutId,
      encodedPath
    });
  };

  checkCompositeKey(
    report,
    resultKey,
    () => containerResultKey(result.executionPath, result.attempt ?? 1),
    path,
    'container result'
  );

  if (result.workoutId !== sessionWorkoutId) {
    report.issues.push(
      issue(
        ISSUE_CODES.WORKOUT_ID_MISMATCH,
        path,
        'A container result workoutId differs from its containing session.'
      )
    );
  }

  checkUtc(report, result.startedAtUtc, `${path}.startedAtUtc`, 'container start');
  checkUtc(report, result.endedAtUtc, `${path}.endedAtUtc`, 'container end');

  checkStatusReason(report, path, result.status, result.reasonCode, result.score, 'score');

  // Spec item 13: one container result per execution path and attempt. Compare
  // the recomputed key, so a mismatched key cannot hide a second claimant.
  let canonical: string | undefined;
  try {
    canonical = containerResultKey(result.executionPath, result.attempt ?? 1);
  } catch {
    canonical = undefined;
  }
  if (canonical !== undefined) {
    if (seenContainerKeys.has(canonical)) {
      report.issues.push(
        issue(
          ISSUE_CODES.DUPLICATE_CONTAINER_RESULT,
          path,
          'Two container results claim one execution path and attempt.'
        )
      );
    }
    seenContainerKeys.add(canonical);
  }

  if (workout === undefined) {
    markUnresolved('unknown_workout');
    return;
  }

  const resolved = resolvePath(workout, result.executionPath);
  if (resolved.ok === false || resolved.node.type !== 'container') {
    markUnresolved('broken_path');
    return;
  }
  const container = resolved.node;
  const capture = container.resultCapture;
  if (capture === undefined) {
    report.issues.push(
      issue(
        ISSUE_CODES.SCORE_TYPE_MISMATCH,
        path,
        `Container ${container.id} is not scored, so it cannot carry a container result.`
      )
    );
    return;
  }

  if (result.score !== undefined && result.score.type !== 'nonstandard') {
    if (result.score.type !== capture.scoreType) {
      report.issues.push(
        issue(
          ISSUE_CODES.SCORE_TYPE_MISMATCH,
          path,
          `A ${result.score.type} score does not match the container ${capture.scoreType} score type.`
        )
      );
    }
  }

  // Spec item 24: rounds_and_reps needs a deterministic repetition-based tree.
  if (capture.scoreType === 'rounds_and_reps') {
    for (const leaf of exerciseLeaves(container)) {
      const leafExercise = exerciseById.get(leaf.exerciseId);
      if (leafExercise === undefined) continue;
      if (unitsForDimension(leafExercise, 'reps') === undefined) {
        report.issues.push(
          issue(
            ISSUE_CODES.ROUNDS_AND_REPS_NOT_REPETITIVE,
            `${path} container ${container.id}`,
            'A rounds_and_reps container holds a leaf exercise that records no repetitions.'
          )
        );
      }
    }
  }

  if (result.score === undefined || result.score.type === 'nonstandard') return;

  const children = collectChildResults(exerciseResults, result.executionPath, container);
  if (children.length === 0) return;

  deriveAndCompare(
    report,
    path,
    container,
    result.executionPath.length,
    result.score as unknown as Record<string, unknown>,
    children
  );
}

/**
 * Validate one monthly shard.
 *
 * @param opts.fileName The Drive file name, when the caller has it. Check 14 also
 *        ties the file name to `yearMonthUtc`.
 */
export function validateShard(
  shard: ResultsShard,
  staticData: StaticData,
  opts: { fileName?: string } = {}
): SemanticReport {
  const report = createReport();

  checkKeyedMap(report, shard.sessions, 'sessions', 'A shard sessions map');

  if (opts.fileName !== undefined) {
    const expected = `results-${shard.yearMonthUtc}.json`;
    if (opts.fileName !== expected) {
      report.issues.push(
        issue(
          ISSUE_CODES.SHARD_MONTH_MISMATCH,
          'fileName',
          `A shard file name does not match its yearMonthUtc. Expected "${expected}".`
        )
      );
    }
  }

  for (const [sessionKey, session] of Object.entries(shard.sessions)) {
    checkKeyNotIntegerLike(report, sessionKey, 'sessions', 'session');
    merge(
      report,
      validateSession(session, staticData, {
        shardYearMonthUtc: shard.yearMonthUtc,
        sessionKey
      })
    );
  }

  return report;
}
