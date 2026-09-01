/**
 * Index one exercises document and collect its semantically owned diagnostics (P4-T01). Authority:
 * docs/contracts/static-data-contracts.md rows EX-04, EX-08 (supporting sem), EX-10, EX-11, EX-12;
 * specs/rep-jot-json-schema-spec.md §1, §2, §8 invariants 1 and 25. Pure: the `unknown` input is never mutated; no clock or randomness;
 * no browser, Svelte, or infrastructure import. Only local `Map`/`Set` indexes over the current document are built; prior-production
 * identity facts (EX-01, EX-10 "new workout" classification) are owned by compatibility, so a deprecated exercise stays resolvable
 * here. Entries lacking schema-required structure are skipped; a non-exercises document yields one root-level diagnostic and disables references.
 */

import { hasUnitOrderViolation } from "./unit-table";
import { finalizeDiagnostics, joinPointer, makeDiagnostic } from "./types";
import type { StaticSemanticDiagnostic, StaticSemanticResult } from "./types";

/** Per-exercise facts the workout semantic pass needs (WK-10, WK-06, EX-10). */
export interface ExerciseIndexEntry {
  readonly id: string;
  /** Deprecated entries stay resolvable for retained references (EX-10). */
  readonly deprecated: boolean;
  readonly dimensions: ReadonlyMap<string, readonly string[]>;
}

/** The indexed model of one exercises document plus its own diagnostics. */
export interface ExercisesSemanticModel {
  readonly available: boolean;
  readonly exercises: ReadonlyMap<string, ExerciseIndexEntry>;
  readonly diagnostics: readonly StaticSemanticDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Extract the string units of one measurement support entry; non-strings are dropped. */
function stringUnits(entry: Record<string, unknown>): string[] {
  const raw = entry["compatibleUnits"];
  if (!Array.isArray(raw)) {
    return [];
  }
  const units: string[] = [];
  for (const value of raw) {
    if (typeof value === "string") {
      units.push(value);
    }
  }
  return units;
}

/** Index one exercises document and collect its semantically owned diagnostics (pure). */
export function buildExercisesModel(document: unknown): ExercisesSemanticModel {
  const diagnostics: StaticSemanticDiagnostic[] = [];
  const exercises = new Map<string, ExerciseIndexEntry>();

  if (!isRecord(document) || !Array.isArray(document["equipment"]) || !Array.isArray(document["exercises"])) {
    return { available: false, exercises, diagnostics: finalizeDiagnostics([makeDiagnostic("exercises-document-unstructured", "")]) };
  }

  // Equipment index (EX-04): current-document IDs; duplicates are a semantic identity violation.
  const equipmentIds = new Set<string>();
  const equipment = document["equipment"];
  for (let i = 0; i < equipment.length; i += 1) {
    const entry = equipment[i];
    if (!isRecord(entry) || typeof entry["id"] !== "string" || entry["id"].length === 0) {
      continue; // unstructured entries are schema-owned
    }
    const id = entry["id"];
    if (equipmentIds.has(id)) {
      diagnostics.push(makeDiagnostic("equipment-id-duplicate", joinPointer("/equipment", i, "id")));
    }
    equipmentIds.add(id);
  }

  const exerciseList = document["exercises"];
  for (let i = 0; i < exerciseList.length; i += 1) {
    const entry = exerciseList[i];
    if (!isRecord(entry)) {
      continue; // unstructured entries are schema-owned
    }
    const basePath = joinPointer("/exercises", i);

    // Current-document identity uniqueness (EX-01 supporting sem; invariants 23, 24 static half).
    let indexEntry: ExerciseIndexEntry | null = null;
    const dimensions = new Map<string, readonly string[]>();
    if (typeof entry["id"] === "string" && entry["id"].length > 0) {
      const id = entry["id"];
      if (exercises.has(id)) {
        diagnostics.push(makeDiagnostic("exercise-id-duplicate", joinPointer(basePath, "id")));
      } else {
        indexEntry = { id, deprecated: entry["deprecated"] === true, dimensions };
        exercises.set(id, indexEntry);
      }
    }

    // EX-04 (sem-owned): every equipmentId resolves to retained equipment in this document.
    const refs = entry["equipmentIds"];
    if (Array.isArray(refs)) {
      for (let j = 0; j < refs.length; j += 1) {
        const ref = refs[j];
        if (typeof ref === "string" && !equipmentIds.has(ref)) {
          diagnostics.push(makeDiagnostic("equipment-reference-missing", joinPointer(basePath, "equipmentIds", j)));
        }
      }
    }

    // Measurements: one entry per dimension (EX-08) and metric-before-imperial order (EX-11).
    const measurements = entry["measurements"];
    if (Array.isArray(measurements)) {
      const seenDimensions = new Set<string>();
      for (let j = 0; j < measurements.length; j += 1) {
        const measurement = measurements[j];
        if (!isRecord(measurement) || typeof measurement["dimension"] !== "string") {
          continue; // unstructured or unknown-dimension entries are schema-owned
        }
        const dimension = measurement["dimension"];
        const units = stringUnits(measurement);
        const measurementPath = joinPointer(basePath, "measurements", j);
        if (seenDimensions.has(dimension)) {
          diagnostics.push(makeDiagnostic("measurement-dimension-duplicate", measurementPath));
        } else {
          seenDimensions.add(dimension);
          if (indexEntry !== null && !indexEntry.dimensions.has(dimension)) {
            dimensions.set(dimension, units);
          }
        }
        if (hasUnitOrderViolation(dimension, units)) {
          diagnostics.push(makeDiagnostic("compatible-unit-order-violation", joinPointer(measurementPath, "compatibleUnits")));
        }
      }
    }
  }

  return { available: true, exercises, diagnostics: finalizeDiagnostics(diagnostics) };
}

/** Validate one exercises document on its own (no workout context needed). */
export function validateExercisesSemantics(document: unknown): StaticSemanticResult {
  const model = buildExercisesModel(document);
  return { valid: model.diagnostics.length === 0, diagnostics: model.diagnostics };
}
