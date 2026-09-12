// Execution path encoding and the composite result keys.
// Requirement 22.4.6 (encoding), Requirement 22.4.7 (always write the defaults),
// Requirement 22.4.9 (one key builder per result kind).

import { AppError } from './errors';
import { assertIdSafe } from './ids';
import type { Side } from './enums';

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
