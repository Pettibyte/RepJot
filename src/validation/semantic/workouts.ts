/**
 * Semantic validation of static `workouts.json` against an indexed exercises directory (P4-T01).
 * Authority: docs/contracts/static-data-contracts.md rows WK-01, WK-02, WK-06, WK-09 supporting,
 * WK-10, WK-14 supporting, WK-15; specs/rep-jot-json-schema-spec.md §3 and §8 invariants 2, 7, 8,
 * 25, 27; Requirements Sections 6.1-6.5, 10.2-10.5, 10.12. Sem-owned: workout/node ID uniqueness
 * (WK-01, WK-02); exercise reference resolution, deprecated included (EX-10 static half);
 * prescription dimension and unit support, including plain `reps` (WK-10); iteration uniqueness,
 * finite-container bounds, repeated-ancestor presence (WK-15); deterministic rounds_and_reps leaf
 * sequences — EMOM cycles are finite and ordered, AMRAP is not (WK-06). Inheritance resolution is Phase 48.
 * Pure: no input mutation, no clock or randomness, no browser/Svelte/Drive/IndexedDB import; the
 * walk is iterative so unbounded nesting cannot overflow it. Entries lacking schema-required
 * structure are skipped rather than re-diagnosed; a non-workouts document yields one root diagnostic.
 */

import type { ExerciseIndexEntry } from "./exercises";
import { finalizeDiagnostics, joinPointer, makeDiagnostic } from "./types";
import type { StaticSemanticDiagnostic, StaticSemanticResult } from "./types";

/** Quantity fields shared by top-level prescriptions and iteration overrides. */
const QUANTITY_FIELDS: readonly string[] = ["weight", "addedWeight", "assistedWeight", "distance", "duration", "calories"];

/** Strategies with a configured finite traversal count, keyed by their config field. */
const FINITE_REPEATED_STRATEGIES: ReadonlyMap<string, string> = new Map<string, string>([
  ["rounds", "rounds"],
  ["complex", "cycles"],
  ["emom", "cycles"]
]);

/** Walk context carried down one tree edge. */
interface TreeContext {
  readonly finiteBound: number | null; // nearest finite repeated ancestor's count, or none
  readonly repeatedAncestor: boolean; // below any repeated container (finite or AMRAP)
  readonly insideRoundsAndReps: boolean; // below an AMRAP whose capture is `rounds_and_reps`
}

interface StackItem {
  readonly node: unknown;
  readonly path: string;
  readonly context: TreeContext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Positive integer configured count of a repeated container, or null when absent or invalid. */
function finiteCount(node: Record<string, unknown>, strategy: string): number | null {
  const configKey = FINITE_REPEATED_STRATEGIES.get(strategy);
  if (configKey === undefined) {
    return null;
  }
  const config = node["strategyConfig"];
  if (!isRecord(config)) {
    return null;
  }
  const count = config[configKey];
  return typeof count === "number" && Number.isInteger(count) && count >= 1 ? count : null;
}

function captureScoreType(node: Record<string, unknown>): string | null {
  const capture = node["resultCapture"];
  if (!isRecord(capture) || typeof capture["scoreType"] !== "string") {
    return null;
  }
  return capture["scoreType"];
}

/** Check the quantity fields of one prescription object (top level or one iteration entry). */
function checkQuantityFields(
  record: Record<string, unknown>,
  basePath: string,
  exercise: ExerciseIndexEntry | null,
  diagnostics: StaticSemanticDiagnostic[]
): void {
  if (exercise === null) {
    return; // missing-reference or unavailable directory already reported upstream
  }
  for (const field of QUANTITY_FIELDS) {
    const value = record[field];
    if (value === undefined) {
      continue;
    }
    const fieldPath = joinPointer(basePath, field);
    if (!exercise.dimensions.has(field)) {
      diagnostics.push(makeDiagnostic("prescription-dimension-unsupported", fieldPath));
      continue;
    }
    if (!isRecord(value) || typeof value["unit"] !== "string") {
      continue; // malformed quantity shape is schema-owned
    }
    const units = exercise.dimensions.get(field);
    const allowed = units === undefined ? [] : units;
    if (allowed.indexOf(value["unit"]) === -1) {
      diagnostics.push(makeDiagnostic("prescription-unit-incompatible", fieldPath));
    }
  }
  // WK-10: plain `reps` is a controlled measurement dimension even though it has no unit object.
  if (record["reps"] !== undefined && !exercise.dimensions.has("reps")) {
    diagnostics.push(makeDiagnostic("prescription-dimension-unsupported", joinPointer(basePath, "reps")));
  }
}

/** WK-06: a leaf defines static reps when the exercise supports reps and its top-level prescription does. */
function leafDefinesStaticReps(exercise: ExerciseIndexEntry, prescription: unknown): boolean {
  return exercise.dimensions.has("reps") && isRecord(prescription) && prescription["reps"] !== undefined;
}

/** Check one prescription: quantity support plus iteration uniqueness and bounds (WK-10, WK-15). */
function checkPrescription(
  prescription: unknown,
  basePath: string,
  exercise: ExerciseIndexEntry | null,
  finiteBound: number | null,
  repeatedAncestor: boolean,
  diagnostics: StaticSemanticDiagnostic[]
): void {
  if (!isRecord(prescription)) {
    return; // missing or malformed prescription is schema-owned
  }
  checkQuantityFields(prescription, basePath, exercise, diagnostics);

  const iterations = prescription["iterations"];
  if (!Array.isArray(iterations)) {
    return;
  }
  const seenIterationNumbers = new Map<number, number>();
  for (let j = 0; j < iterations.length; j += 1) {
    const item = iterations[j];
    if (!isRecord(item)) {
      continue; // malformed entry is schema-owned
    }
    const itemPath = joinPointer(basePath, "iterations", j);
    checkQuantityFields(item, itemPath, exercise, diagnostics);

    const iteration = item["iteration"];
    if (typeof iteration !== "number" || !Number.isFinite(iteration)) {
      continue; // malformed number is schema-owned
    }
    const iterationPath = joinPointer(itemPath, "iteration");
    if (!repeatedAncestor) {
      diagnostics.push(makeDiagnostic("iteration-without-repeated-container", iterationPath));
    }
    if (seenIterationNumbers.has(iteration)) {
      diagnostics.push(makeDiagnostic("iteration-number-duplicate", iterationPath));
    } else {
      seenIterationNumbers.set(iteration, j);
    }
    if (finiteBound !== null && iteration > finiteBound) {
      diagnostics.push(makeDiagnostic("iteration-number-out-of-bounds", iterationPath));
    }
  }
}

/** Validate one workouts document against one indexed exercises directory (pure); `exercisesAvailable`
 * false disables reference and rounds_and_reps leaf checks rather than guessing at references. */
export function validateWorkoutsSemantics(
  workoutsDocument: unknown,
  exercises: ReadonlyMap<string, ExerciseIndexEntry>,
  exercisesAvailable: boolean
): StaticSemanticResult {
  const diagnostics: StaticSemanticDiagnostic[] = [];

  if (!isRecord(workoutsDocument) || !Array.isArray(workoutsDocument["workouts"])) {
    return { valid: false, diagnostics: finalizeDiagnostics([makeDiagnostic("workouts-document-unstructured", "")]) };
  }

  const workouts = workoutsDocument["workouts"];
  const seenWorkoutIds = new Set<string>();

  for (let w = 0; w < workouts.length; w += 1) {
    const workout = workouts[w];
    if (!isRecord(workout)) {
      continue; // unstructured entry is schema-owned
    }
    const basePath = joinPointer("/workouts", w);

    if (typeof workout["id"] === "string" && workout["id"].length > 0) {
      const id = workout["id"];
      if (seenWorkoutIds.has(id)) {
        diagnostics.push(makeDiagnostic("workout-id-duplicate", joinPointer(basePath, "id")));
      }
      seenWorkoutIds.add(id);
    }

    const root = workout["root"];
    if (!isRecord(root)) {
      continue; // missing or malformed root is schema-owned
    }
    // Node IDs are unique within this workout only (WK-02); the Set is per-workout on purpose.
    const seenNodeIds = new Set<string>();
    const stack: StackItem[] = [
      { node: root, path: joinPointer(basePath, "root"), context: { finiteBound: null, repeatedAncestor: false, insideRoundsAndReps: false } }
    ];

    while (stack.length > 0) {
      const item = stack.pop();
      if (item === undefined) {
        break;
      }
      const node = item.node;
      if (!isRecord(node)) {
        continue;
      }

      if (typeof node["id"] === "string" && node["id"].length > 0) {
        const nodeId = node["id"];
        if (seenNodeIds.has(nodeId)) {
          diagnostics.push(makeDiagnostic("node-id-duplicate", joinPointer(item.path, "id")));
        }
        seenNodeIds.add(nodeId);
      }

      if (node["type"] === "container") {
        const strategy = typeof node["strategy"] === "string" ? node["strategy"] : null;
        const context = item.context;

        // WK-06: AMRAP's cycle count depends on elapsed time, so its leaves never form a deterministic sequence.
        if (context.insideRoundsAndReps && strategy === "amrap") {
          diagnostics.push(makeDiagnostic("rounds-and-reps-nested-container-non-deterministic", item.path));
        }

        let finiteBound = context.finiteBound;
        let repeatedAncestor = context.repeatedAncestor;
        let insideRoundsAndReps = context.insideRoundsAndReps;
        if (strategy === "amrap") {
          finiteBound = null; // AMRAP has no configured count, so it bounds nothing below it
          repeatedAncestor = true;
          if (captureScoreType(node) === "rounds_and_reps") {
            insideRoundsAndReps = true;
          }
        } else if (strategy !== null && FINITE_REPEATED_STRATEGIES.has(strategy)) {
          // EMOM stays deterministic under rounds_and_reps: cycles is configured and children run in fixed order.
          const count = finiteCount(node, strategy);
          finiteBound = count; // a present repeated container replaces any outer bound
          repeatedAncestor = true;
        }

        const childContext: TreeContext = { finiteBound, repeatedAncestor, insideRoundsAndReps };
        const children = node["children"];
        if (Array.isArray(children)) {
          for (let j = children.length - 1; j >= 0; j -= 1) {
            stack.push({ node: children[j], path: joinPointer(item.path, "children", j), context: childContext });
          }
        }
      } else if (node["type"] === "exercise") {
        const exerciseId = typeof node["exerciseId"] === "string" ? node["exerciseId"] : null;
        let exercise: ExerciseIndexEntry | null = null;
        if (exercisesAvailable && exerciseId !== null && exerciseId.length > 0) {
          const found = exercises.get(exerciseId);
          if (found === undefined) {
            diagnostics.push(makeDiagnostic("exercise-reference-missing", joinPointer(item.path, "exerciseId")));
          } else {
            exercise = found; // deprecated exercises stay resolvable (EX-10 static half)
            if (item.context.insideRoundsAndReps && !leafDefinesStaticReps(found, node["prescription"])) {
              diagnostics.push(makeDiagnostic("rounds-and-reps-leaf-not-repetition-based", item.path));
            }
          }
        }
        checkPrescription(
          node["prescription"],
          joinPointer(item.path, "prescription"),
          exercise,
          item.context.finiteBound,
          item.context.repeatedAncestor,
          diagnostics
        );
      }
    }
  }

  const finalized = finalizeDiagnostics(diagnostics);
  return { valid: finalized.length === 0, diagnostics: finalized };
}
