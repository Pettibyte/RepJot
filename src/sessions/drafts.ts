// The editable input shapes for one session mutation. Phase 14.
// REQUIREMENTS 11.1, 11.2, 11.3, 11.8, 10.16.
//
// A draft is what the screen holds while the user types. It is not a stored
// record. The session service turns a draft into an `ExerciseResult` or a
// `ContainerResult` at save time, and it drops a draft that carries nothing.
//
// Three rules shape this file.
//
// 1. A draft carries no timestamp. `startedAtUtc` and `endedAtUtc` belong to
//    the saved record, and the service owns them. A draft that carried one
//    would let the screen write a workout time. REQUIREMENTS 11.20, 11.21.
// 2. A draft carries its unit beside every value. `values` holds `Quantity`
//    objects, so a number never needs an assumed unit. REQUIREMENT 11.8.
// 3. Blank is a defined state, not an empty object. `isBlankExerciseDraft`
//    answers the one question the save path asks: does this draft record
//    anything? A blank draft writes nothing. A zero-rep draft does.
//    REQUIREMENT 11.2.

import type { Side, StartingSide, ResultStatus, ReasonCode } from '../domain/enums';
import type { PathSegment } from '../domain/execution-path';
import type {
  ContainerResult,
  EffortOutcome,
  ExerciseResult,
  ResultValues,
  Score
} from '../domain/types';

/**
 * One editable exercise result.
 *
 * `status` defaults to `'completed'` at the screen, so the blank check reads
 * the payload rather than the status. A skipped or incomplete draft must carry
 * a `reasonCode`, which the semantic validator enforces on the saved record.
 */
export interface ExerciseResultDraft {
  workoutId: string;
  exerciseId: string;
  executionPath: PathSegment[];
  side?: Side;
  attempt?: number;
  startingSide?: StartingSide;
  status: ResultStatus;
  values?: ResultValues;
  effort?: EffortOutcome;
  reasonCode?: ReasonCode;
  notes?: string;
}

/** One editable container result. */
export interface ContainerResultDraft {
  workoutId: string;
  executionPath: PathSegment[];
  attempt?: number;
  status: ResultStatus;
  score?: Score;
  reasonCode?: ReasonCode;
  notes?: string;
}

/** True when `values` holds no dimension at all. */
export function hasNoValues(values: ResultValues | undefined): boolean {
  if (values === undefined || values === null) return true;
  for (const quantity of Object.values(values)) {
    if (quantity !== undefined && quantity !== null) return false;
  }
  return true;
}

/**
 * True when the draft carries nothing to record.
 *
 * Only a *completed* draft can be blank. A skipped or incomplete draft is a
 * record even with no measured value, because its status and reason code are
 * the answer the user gave. A blank completed draft means the field was never
 * filled in. REQUIREMENT 11.2.
 */
export function isBlankExerciseDraft(draft: ExerciseResultDraft): boolean {
  if (draft.status !== 'completed') return false;
  return hasNoValues(draft.values) && draft.effort === undefined;
}

/**
 * True when the container draft carries nothing to record.
 *
 * A skipped or incomplete container is not blank even without a score,
 * because its status and reason code are the record. Only a completed
 * container with no score is blank. REQUIREMENT 11.2.
 */
export function isBlankContainerDraft(draft: ContainerResultDraft): boolean {
  return draft.status === 'completed' && draft.score === undefined;
}

/** Turn a draft into the stored `ExerciseResult`. */
export function toExerciseResult(draft: ExerciseResultDraft): ExerciseResult {
  const result: ExerciseResult = {
    workoutId: draft.workoutId,
    executionPath: draft.executionPath,
    exerciseId: draft.exerciseId,
    status: draft.status
  };
  if (draft.side !== undefined) result.side = draft.side;
  if (draft.attempt !== undefined) result.attempt = draft.attempt;
  if (draft.startingSide !== undefined) result.startingSide = draft.startingSide;
  if (!hasNoValues(draft.values)) result.values = draft.values;
  if (draft.effort !== undefined) result.effort = draft.effort;
  if (draft.reasonCode !== undefined) result.reasonCode = draft.reasonCode;
  if (draft.notes !== undefined) result.notes = draft.notes;
  return result;
}

/** Turn a draft into the stored `ContainerResult`. */
export function toContainerResult(draft: ContainerResultDraft): ContainerResult {
  const result: ContainerResult = {
    workoutId: draft.workoutId,
    executionPath: draft.executionPath,
    status: draft.status
  };
  if (draft.attempt !== undefined) result.attempt = draft.attempt;
  if (draft.score !== undefined) result.score = draft.score;
  if (draft.reasonCode !== undefined) result.reasonCode = draft.reasonCode;
  if (draft.notes !== undefined) result.notes = draft.notes;
  return result;
}
