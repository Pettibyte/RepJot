/** Public entry point for static document semantic validation (P4-T01). Validates `exercises.json` and `workouts.json`
 * against the sem-owned rows of docs/contracts/static-data-contracts.md; the schema gate is a separate prerequisite callers
 * run first. EX-12: the API accepts exactly the two static documents. */

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
