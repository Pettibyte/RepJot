/**
 * Cross-file semantic validation of one preferences document against the retained exercises directory
 * (P10-D001). Authority: docs/contracts/user-data-contracts.md PF-02 (schema primary, sem supporting) and
 * its invariant ownership summary ("Invariants 1-6, 7-9 are reference/compatibility rules owned by the
 * semantic validator"); specs/rep-jot-json-schema-spec.md §4 and §8 invariant 9 ("A preferred unit is
 * compatible with its exercise and dimension"); docs/contracts/static-data-contracts.md EX-12 (the static
 * pass never reads preferences — this is the only entry point in this module family that pairs a user
 * document with a static directory); docs/contracts/families-and-files.md FF-19 (exercises load and validate
 * before preferences, so the retained directory is the reference context).
 *
 * The schema gate owns the per-dimension controlled unit enum (each `exerciseUnits[exerciseId][dimension]`
 * must be one of that dimension's controlled units: `rep`; `lb`/`kg`; `m`/`km`/`ft`/`mi`; `second`/`minute`;
 * `kcal`). This pass adds the cross-file half the schema cannot see: the exercise ID resolves to a retained
 * exercise, the dimension is listed in that exercise's `measurements`, and the preferred unit is one of that
 * dimension's `compatibleUnits`. PF-02's negative cases — `{"weight":"mi"}`, a mapping for a dimension the
 * exercise lacks, an unknown exercise ID — each produce a stable diagnostic here, so an incompatible
 * preference mapping never passes validation before acceptance.
 *
 * Like every other pass in this module: pure (the `unknown` inputs are never mutated; no clock, locale, or
 * randomness), diagnostics carry only deterministic safe fields (stable code, one JSON Pointer, one fixed
 * message per code — raw document values never appear), and repeated calls on equal inputs return identical
 * sorted diagnostics. An unreadable exercises directory disables resolution rather than producing invented
 * references, and its own diagnostics are not re-reported (callers run the static pass first, per FF-19).
 * Absence of a mapping is a valid state (PF-03) and never produces a diagnostic.
 */

import { buildExercisesModel } from "./exercises";
import type { ExerciseIndexEntry } from "./exercises";
import { finalizeDiagnostics, joinPointer } from "./types";

/** Every stable diagnostic code emitted by preferences semantic validation. */
export type PreferenceSemanticCode =
  | "preferences-document-unstructured"
  | "preference-exercise-unknown"
  | "preference-dimension-unsupported"
  | "preference-unit-incompatible";

/** One stable validation diagnostic at one JSON Pointer location. */
export interface PreferenceSemanticDiagnostic {
  /** Stable rule code; never contains document data. */
  readonly code: PreferenceSemanticCode;
  /** JSON Pointer (RFC 6901) into the preferences document; empty string at a document root. */
  readonly path: string;
  /** Fixed safe text for the code; never contains document data. */
  readonly message: string;
}

/** The stable result of one preferences semantic pass over one document and one exercises directory. */
export interface PreferenceSemanticResult {
  readonly valid: boolean;
  /** Sorted and deduplicated for determinism; empty exactly when `valid` is true. */
  readonly diagnostics: readonly PreferenceSemanticDiagnostic[];
}

/** One fixed message per code so results never carry raw content values. */
export const PREFERENCE_SEMANTIC_MESSAGES: Readonly<Record<PreferenceSemanticCode, string>> = {
  "preferences-document-unstructured": "the preferences document is not a structured preferences document",
  "preference-exercise-unknown": "a preferred unit mapping does not resolve to a retained exercise",
  "preference-dimension-unsupported": "a preferred unit names a dimension the referenced exercise does not support",
  "preference-unit-incompatible": "a preferred unit is not compatible with the referenced exercise and dimension"
};

function makeDiagnostic(code: PreferenceSemanticCode, path: string): PreferenceSemanticDiagnostic {
  return { code, path, message: PREFERENCE_SEMANTIC_MESSAGES[code] };
}

function finalize(raw: readonly PreferenceSemanticDiagnostic[]): PreferenceSemanticResult {
  const finalized = finalizeDiagnostics(raw);
  return { valid: finalized.length === 0, diagnostics: finalized };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** PF-02 (invariant 9) for one resolved mapping: every dimension resolves and every unit is supported. */
function checkMapping(
  exerciseId: string,
  mapping: Record<string, unknown>,
  exercise: ExerciseIndexEntry,
  diagnostics: PreferenceSemanticDiagnostic[]
): void {
  const basePath = joinPointer("/exerciseUnits", exerciseId);
  for (const dimension of Object.keys(mapping)) {
    const valuePointer = joinPointer(basePath, dimension);
    const allowed = exercise.dimensions.get(dimension);
    if (allowed === undefined) {
      diagnostics.push(makeDiagnostic("preference-dimension-unsupported", valuePointer));
      continue; // a dimension the exercise lacks cannot carry a compatible unit either
    }
    const unit = mapping[dimension];
    if (!isNonEmptyString(unit)) {
      continue; // a non-string or empty unit is schema-owned (the per-dimension controlled enum)
    }
    if (allowed.indexOf(unit) === -1) {
      diagnostics.push(makeDiagnostic("preference-unit-incompatible", valuePointer));
    }
  }
}

/**
 * Validate one preferences document against the retained exercises directory (pure).
 *
 * Every `exerciseUnits[exerciseId][dimension]` mapping must resolve: the exercise ID to a retained
 * exercise (deprecated entries stay resolvable, invariant 24), the dimension to one of that exercise's
 * `measurements`, and the unit to one of that dimension's `compatibleUnits`. An absent mapping is valid
 * (PF-03) and never reported. When the exercises document is unreadable, resolution is disabled rather
 * than guessed — the static pass owns that directory's own diagnostics (FF-19 loading order).
 */
export function validatePreferencesSemantics(
  preferencesDocument: unknown,
  exercisesDocument: unknown
): PreferenceSemanticResult {
  const diagnostics: PreferenceSemanticDiagnostic[] = [];

  if (!isRecord(preferencesDocument) || !isRecord(preferencesDocument["exerciseUnits"])) {
    return finalize([makeDiagnostic("preferences-document-unstructured", "")]);
  }

  const model = buildExercisesModel(exercisesDocument);
  if (!model.available) {
    // An unreadable directory disables resolution rather than producing invented references.
    return finalize([]);
  }

  const exerciseUnits = preferencesDocument["exerciseUnits"];
  for (const exerciseId of Object.keys(exerciseUnits)) {
    const mapping = exerciseUnits[exerciseId];
    if (!isRecord(mapping)) {
      continue; // a non-object mapping is schema-owned
    }
    const exercise = model.exercises.get(exerciseId);
    if (exercise === undefined) {
      diagnostics.push(makeDiagnostic("preference-exercise-unknown", joinPointer("/exerciseUnits", exerciseId)));
      continue; // with no retained entry, nothing further can be proven about this mapping
    }
    checkMapping(exerciseId, mapping, exercise, diagnostics);
  }

  return finalize(diagnostics);
}
