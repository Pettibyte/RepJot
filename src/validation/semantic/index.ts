/** Public entry point for the semantic validator.
 *
 * Static pass (P4-T01): validates `exercises.json` and `workouts.json` against the sem-owned rows of
 * docs/contracts/static-data-contracts.md; the schema gate is a separate prerequisite callers run first.
 * EX-12: `validateStaticDocuments` still accepts exactly the two static documents and reads no preferences.
 *
 * Result lifecycle pass (P5-T01): validates one `results-YYYY-MM.json` shard against the retained static
 * directories (docs/contracts/user-data-contracts.md rows RS-01, RS-03..RS-11, RS-15, RS-17..RS-19 and
 * docs/contracts/temporal-and-omission-contracts.md rows TR-04, TR-05, TR-08, TR-12). Paths and direct IDs
 * resolve in the frozen plan of an `in_progress` session and in the retained workout tree of a terminal one.
 * It stays a separate entry point: the static pass never reads a shard, and this pass reads no preferences.
 * Phase 5 lifecycle checks and the Phase 6 score module are both pure result semantic stages. The score module
 * uses only stored scores, detail, and recorded `reasonCode: "deprecated"` skips; it never proves omission from
 * a missing result. */

import { buildExercisesModel } from "./exercises";
import type { ExercisesSemanticModel } from "./exercises";
import { finalizeDiagnostics } from "./types";
import type { StaticSemanticResult } from "./types";
import { validateWorkoutsSemantics } from "./workouts";

export { buildExercisesModel, validateExercisesSemantics } from "./exercises";
export type { ExerciseIndexEntry, ExercisesSemanticModel } from "./exercises";
export { validateWorkoutsSemantics } from "./workouts";
export { STATIC_SEMANTIC_MESSAGES } from "./types";
export type { StaticSemanticCode, StaticSemanticDiagnostic, StaticSemanticResult } from "./types";

// Result lifecycle pass (P5-T01).
export { validateResultsShard } from "./results";
export { validateShardCorrection } from "./result-correction";
export { buildWorkoutIndex } from "./workout-index";
export type { NodeKind, RepeatedState, WorkoutIndexEntry, WorkoutsSemanticIndex } from "./workout-index";
export { RESULT_SEMANTIC_MESSAGES, makeResultDiagnostic, REASON_CODES, RESULT_SIDES, REPEATED_STRATEGIES } from "./result-types";
export type { ResultSemanticCode, ResultSemanticDiagnostic, ResultSemanticResult } from "./result-types";
export {
  validateResultScores,
  validateScoresAndDeprecatedOmissions,
  deriveScoreFromDetail,
  deriveRoundsAndRepsScore,
  deriveCyclesScore,
  deriveIntervalsScore,
  scoresEqual
} from "./result-score";
export type {
  CyclesScore,
  IntervalsScore,
  NonstandardScore,
  RoundsAndRepsScore,
  Score,
  ScoreDerivation,
  ScoreDetailCompleteness,
  ScoreType
} from "./result-score";

/** Validate both static documents together; pure, deterministic, never mutates its inputs. */
export function validateStaticDocuments(
  exercisesDocument: unknown,
  workoutsDocument: unknown
): StaticSemanticResult {
  const model: ExercisesSemanticModel = buildExercisesModel(exercisesDocument);
  const workoutResult = validateWorkoutsSemantics(workoutsDocument, model.exercises, model.available);
  const diagnostics = finalizeDiagnostics([...model.diagnostics, ...workoutResult.diagnostics]);
  return { valid: diagnostics.length === 0, diagnostics };
}
