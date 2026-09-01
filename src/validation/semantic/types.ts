/**
 * Static semantic diagnostic types (P4-T01). Authority: docs/contracts/static-data-contracts.md sem-owned rows;
 * specs/rep-jot-json-schema-spec.md §8 invariants 7, 8, 25, 27; Requirements Sections 6, 9, 10. Diagnostics carry only
 * deterministic safe fields: a stable code, a JSON Pointer path, and one fixed message per code; raw document values never
 * appear in a result and schema-owned rules are not re-reported — this module adds cross-entry and cross-file `sem` rules.
 */

/** Every stable diagnostic code emitted by static semantic validation. */
export type StaticSemanticCode =
  // exercises.json
  | "exercises-document-unstructured"
  | "exercise-id-duplicate"
  | "equipment-id-duplicate"
  | "equipment-reference-missing"
  | "measurement-dimension-duplicate"
  | "compatible-unit-order-violation"
  // workouts.json
  | "workouts-document-unstructured"
  | "workout-id-duplicate"
  | "node-id-duplicate"
  | "exercise-reference-missing"
  | "prescription-dimension-unsupported"
  | "prescription-unit-incompatible"
  | "iteration-number-duplicate"
  | "iteration-number-out-of-bounds"
  | "iteration-without-repeated-container"
  | "rounds-and-reps-leaf-not-repetition-based"
  | "rounds-and-reps-nested-container-non-deterministic";

/** One stable validation diagnostic at one JSON Pointer location. */
export interface StaticSemanticDiagnostic {
  /** Stable rule code; never contains document data. */
  readonly code: StaticSemanticCode;
  /** JSON Pointer (RFC 6901) into the owning document; empty string at a document root. */
  readonly path: string;
  /** Fixed safe text for the code; never contains document data. */
  readonly message: string;
}

/** The stable result of one static semantic validation over both static documents. */
export interface StaticSemanticResult {
  readonly valid: boolean;
  /** Sorted and deduplicated for determinism; empty exactly when `valid` is true. */
  readonly diagnostics: readonly StaticSemanticDiagnostic[];
}

/** One fixed message per code so results never carry raw health or content values. */
export const STATIC_SEMANTIC_MESSAGES: Readonly<Record<StaticSemanticCode, string>> = {
  "exercises-document-unstructured": "the exercises document is not a structured exercises directory",
  "exercise-id-duplicate": "an exercise ID appears more than once in the directory",
  "equipment-id-duplicate": "an equipment ID appears more than once in the directory",
  "equipment-reference-missing": "an equipment reference does not resolve to retained equipment",
  "measurement-dimension-duplicate": "a measurement dimension is listed more than once for one exercise",
  "compatible-unit-order-violation": "metric units must be listed before imperial units",
  "workouts-document-unstructured": "the workouts document is not a structured workouts directory",
  "workout-id-duplicate": "a workout ID appears more than once in the directory",
  "node-id-duplicate": "a node ID appears more than once within one workout",
  "exercise-reference-missing": "an exercise reference does not resolve to a retained exercise",
  "prescription-dimension-unsupported": "a prescription uses a dimension the referenced exercise does not support",
  "prescription-unit-incompatible": "a prescription unit is not compatible with the dimension for the referenced exercise",
  "iteration-number-duplicate": "an iteration number appears more than once in one prescription",
  "iteration-number-out-of-bounds": "an iteration override exceeds the nearest repeated container's configured count",
  "iteration-without-repeated-container": "an iteration override has no repeated container to apply to",
  "rounds-and-reps-leaf-not-repetition-based": "a rounds_and_reps container contains a leaf whose static prescription does not define repetitions",
  "rounds-and-reps-nested-container-non-deterministic": "a rounds_and_reps container contains a nested non-deterministic container"
};

/** Escape one JSON Pointer segment per RFC 6901. */
export function pointerSegment(segment: string): string {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Join an existing pointer with child segments; the root pointer is the empty string. */
export function joinPointer(base: string, ...segments: Array<string | number>): string {
  let result = base;
  for (let i = 0; i < segments.length; i += 1) {
    result = result + "/" + pointerSegment(String(segments[i]));
  }
  return result;
}

/** Build one diagnostic from a code and pointer using the fixed message table. */
export function makeDiagnostic(code: StaticSemanticCode, path: string): StaticSemanticDiagnostic {
  return { code, path, message: STATIC_SEMANTIC_MESSAGES[code] };
}

/** Deduplicate by (code, path) and sort for deterministic output. */
export function finalizeDiagnostics(raw: readonly StaticSemanticDiagnostic[]): StaticSemanticDiagnostic[] {
  const seen = new Set<string>();
  const unique: StaticSemanticDiagnostic[] = [];
  for (const diagnostic of raw) {
    const key = diagnostic.code + "\u0000" + diagnostic.path;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(diagnostic);
  }
  unique.sort((a, b) => {
    const codeCompare = a.code === b.code ? 0 : a.code < b.code ? -1 : 1;
    return codeCompare !== 0 ? codeCompare : a.path === b.path ? 0 : a.path < b.path ? -1 : 1;
  });
  return unique;
}
