// Execution path encoding, the composite result keys, and path resolution.
// Requirement 22.4.6 (encoding), Requirement 22.4.7 (always write the defaults),
// Requirement 22.4.9 (one key builder per result kind).
//
// `resolvePath` lives here too, not only in the semantic validator. The
// Workout Summary must answer the same question the validator answers — does
// this recorded path walk the current tree — and a second resolver would let
// the two layers disagree. One resolver, one answer. REQUIREMENTS 6.8, 6.23.

import { AppError } from './errors';
import { assertIdSafe } from './ids';
import type { ContainerNode, Workout, WorkoutNode } from './types';
import type { Laterality, Side } from './enums';

/** One step of an execution path: a node ID and, for a repeated container, its iteration. */
export interface PathSegment {
  nodeId: string;
  /** One-based. Present only for a repeated container. */
  iteration?: number;
}

/** Separator between the parts of a composite key. Requirement 22.4.6. */
export const FIELD_SEPARATOR = '|';

/** Separator between path segments inside a key. Requirement 22.4.6. */
const PATH_SEPARATOR = '/';

/** Separator between a repeated container's node ID and its iteration. Requirement 22.4.6. */
const ITERATION_SEPARATOR = ':';

/** Default `side` written into every exercise result key. Requirement 22.4.7. */
const DEFAULT_SIDE: Side = 'both';

/** Default `attempt` written into every result key. Requirement 22.4.7. */
const DEFAULT_ATTEMPT = 1;

const VALID_SIDES: Side[] = ['left', 'right', 'both', 'alternating'];

function assertAttempt(attempt: number, what: string): void {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new AppError('invalid_document', { what }, `${what} must be an integer of 1 or more.`);
  }
}

/**
 * Encode path segments into the string used inside a composite key.
 * Segments join with `/`. A repeated-container segment carries `:<iteration>`,
 * one-based. Example: `root/squat-sets:3/back-squat-set`. Requirement 22.4.6.
 */
export function encodePath(segments: PathSegment[]): string {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new AppError('invalid_document', { field: 'executionPath' }, 'An execution path needs at least one segment.');
  }

  return segments
    .map((segment, index) => {
      assertIdSafe(segment.nodeId, `execution path segment ${index + 1} node ID`);

      if (segment.iteration === undefined) {
        return segment.nodeId;
      }
      if (!Number.isInteger(segment.iteration) || segment.iteration < 1) {
        throw new AppError(
          'invalid_document',
          { nodeId: segment.nodeId },
          'A path iteration must be an integer of 1 or more.'
        );
      }
      return `${segment.nodeId}${ITERATION_SEPARATOR}${segment.iteration}`;
    })
    .join(PATH_SEPARATOR);
}

/**
 * Decode an encoded execution path back into its segments.
 * The inverse of `encodePath`. Requirement 22.4.6.
 */
export function decodePath(encoded: string): PathSegment[] {
  if (typeof encoded !== 'string' || encoded.length === 0) {
    throw new AppError('invalid_document', { field: 'executionPath' }, 'An encoded execution path must not be empty.');
  }

  return encoded.split(PATH_SEPARATOR).map((part, index) => {
    const separatorIndex = part.indexOf(ITERATION_SEPARATOR);
    if (separatorIndex === -1) {
      assertIdSafe(part, `execution path segment ${index + 1} node ID`);
      return { nodeId: part };
    }

    const nodeId = part.slice(0, separatorIndex);
    const iterationText = part.slice(separatorIndex + 1);
    assertIdSafe(nodeId, `execution path segment ${index + 1} node ID`);

    if (!/^[0-9]+$/.test(iterationText)) {
      throw new AppError(
        'invalid_document',
        { nodeId },
        `A path iteration must be a positive integer in segment ${index + 1}.`
      );
    }

    const iteration = Number(iterationText);
    if (iteration < 1) {
      throw new AppError(
        'invalid_document',
        { nodeId },
        `A path iteration must be 1 or more in segment ${index + 1}.`
      );
    }

    return { nodeId, iteration };
  });
}

/**
 * True when two path segments name one node in one iteration.
 *
 * A segment with no `iteration` reads as iteration 1, because a step that does
 * not repeat still sits in the first pass of its container. The session service
 * and the semantic validator select the children under one container occurrence
 * with this one rule, so the two cannot drift apart. A match on node ID alone
 * pulls a child of another outer round into this container's derivation.
 * REQUIREMENTS 10.8, 10.12, 10.13.
 */
export function sameSegment(
  one: PathSegment | undefined,
  other: PathSegment | undefined
): boolean {
  if (one === undefined || other === undefined) return false;
  return one.nodeId === other.nodeId && (one.iteration ?? 1) === (other.iteration ?? 1);
}

/**
 * The side a new, unsaved exercise row records. Requirement 9.10.
 *
 * A unilateral exercise defaults to `alternating`, so the typed repetition
 * count is the total across both sides. A bilateral exercise defaults to
 * `both`. An exercise the bundle does not resolve also defaults to `both`,
 * because the app must not guess a side it cannot confirm.
 *
 * Every caller that names the side of a row with no saved result goes through
 * this function. The missing-work report and the row model must agree, or a
 * missing unilateral set reports a key no row owns and its badge never shows.
 */
export function defaultSideForLaterality(laterality: Laterality | undefined): Side {
  return laterality === 'unilateral' ? 'alternating' : DEFAULT_SIDE;
}

/**
 * Build the `exerciseResults` map key: `<path>|<side>|<attempt>`.
 *
 * Always writes both `side` and `attempt`, even at their defaults, so a key never
 * changes shape later. Requirement 22.4.7 and Requirement 22.4.9.
 */
export function exerciseResultKey(
  path: PathSegment[],
  side: Side = DEFAULT_SIDE,
  attempt: number = DEFAULT_ATTEMPT
): string {
  if (!VALID_SIDES.includes(side)) {
    throw new AppError('invalid_document', { side }, 'An exercise result side is not valid.');
  }
  assertAttempt(attempt, 'An exercise result attempt');

  return [encodePath(path), side, String(attempt)].join(FIELD_SEPARATOR);
}

/**
 * Build the `containerResults` map key: `<path>|<attempt>`.
 *
 * Always writes `attempt`, even at its default. Requirement 22.4.7 and
 * Requirement 22.4.9.
 */
export function containerResultKey(path: PathSegment[], attempt: number = DEFAULT_ATTEMPT): string {
  assertAttempt(attempt, 'A container result attempt');

  return [encodePath(path), String(attempt)].join(FIELD_SEPARATOR);
}

/**
 * Build the per-workout node lookup key: `<workoutId>|<nodeId>`.
 * Node IDs are unique only inside one workout, so the workout ID must lead the key.
 * Requirement 6.20 and Requirement 22.4.6.
 */
export function nodeKey(workoutId: string, nodeId: string): string {
  assertIdSafe(workoutId, 'workout ID');
  assertIdSafe(nodeId, 'node ID');

  return [workoutId, nodeId].join(FIELD_SEPARATOR);
}

/**
 * A path resolved against one workout tree.
 *
 * `depth` is the index of the segment that failed to resolve, so a caller can
 * report where the break sits.
 */
export type ResolvedPath =
  | { ok: true; node: WorkoutNode }
  | { ok: false; reason: 'broken_path'; depth: number };

/** Strategies that repeat their children. A sequence runs once. */
export function isRepeatedContainer(node: WorkoutNode): node is ContainerNode {
  return node.type === 'container' && node.strategy !== 'sequence';
}

/** How many times a repeated container runs. An AMRAP has no fixed ceiling. */
export function iterationCount(container: ContainerNode): number {
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
 *
 * The whole chain is walked. A resolver that only looked for the leaf node would
 * call a result fine when the leaf still existed somewhere else in the tree and an
 * ancestor was gone, which hides a broken path behind a value that reads as
 * resolved. REQUIREMENTS 6.8 third bullet, 6.10.
 */
export function resolvePath(
  workout: Workout,
  segments: PathSegment[] | undefined
): ResolvedPath {
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
