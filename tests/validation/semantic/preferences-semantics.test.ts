/** Focused cross-file semantic tests for preferences against the retained exercises directory (P10-D001).
 * Covers PF-02 (invariant 9): every `exerciseUnits[exerciseId][dimension]` mapping must resolve to a
 * retained exercise, a dimension listed in that exercise's `measurements`, and a unit in that
 * dimension's `compatibleUnits`. Uses the canonical contract-acceptance pair plus the independent
 * static-semantic context fixture (whose `deadlift-lite` supports only `kg`). Authority:
 * docs/contracts/user-data-contracts.md PF-02, specs/rep-jot-json-schema-spec.md §4 and §8 invariant 9. */
import { describe, expect, test } from "bun:test";

import { validatePreferencesSemantics } from "../../../src/validation/semantic/preferences";
import type { PreferenceSemanticResult } from "../../../src/validation/semantic/preferences";

import preferencesMin from "../../fixtures/contract-acceptance/preferences.min.json";
import exercisesMin from "../../fixtures/contract-acceptance/exercises.min.json";
import exercisesContext from "../../fixtures/static-semantic/exercises.context.json";

/** Build one schema-shaped preferences document around a chosen `exerciseUnits` object. */
function makePref(exerciseUnits: Record<string, unknown>): Record<string, unknown> {
  return {
    format: "repjot/preferences",
    schemaVersion: 1,
    revision: 0,
    updatedAtUtc: "2026-08-15T15:25:00Z",
    exerciseUnits
  };
}

function codes(result: PreferenceSemanticResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function at(result: PreferenceSemanticResult, path: string): string[] {
  return result.diagnostics.filter((diagnostic) => diagnostic.path === path).map((d) => d.code);
}

function pairs(result: PreferenceSemanticResult): Array<string> {
  return result.diagnostics.map((diagnostic) => diagnostic.code + " @ " + diagnostic.path).sort();
}

/** Recursively freeze one parsed document so any mutation by the validator throws. */
function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

describe("PF-02 positive cases (invariant 9)", () => {
  test("the contract acceptance pair validates", () => {
    const result = validatePreferencesSemantics(preferencesMin, exercisesMin);
    expect(result.valid).toBe(true);
    expect(codes(result)).toEqual([]);
  });

  test("absence of a mapping is a valid state (PF-03)", () => {
    // preferences.min.json maps back-squat and pull-up only; air-squat keeps its first-compatibleUnits default.
    expect(at(validatePreferencesSemantics(preferencesMin, exercisesMin), "/exerciseUnits/air-squat")).toEqual([]);
    const empty = makePref({});
    expect(validatePreferencesSemantics(empty, exercisesMin).valid).toBe(true);
  });

  test("a deprecated exercise stays resolvable (invariant 24)", () => {
    const result = validatePreferencesSemantics(makePref({ "push-up": { reps: "rep" } }), exercisesMin);
    expect(result.valid).toBe(true);
    expect(codes(result)).toEqual([]);
  });

  test("every supported unit of the context directory validates", () => {
    const exercises = exercisesContext["exercises"] as Array<Record<string, unknown>>;
    for (const exercise of exercises) {
      const id = String(exercise["id"]);
      const measurements = exercise["measurements"] as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(measurements)) {
        continue;
      }
      for (const measurement of measurements) {
        const dimension = String(measurement["dimension"]);
        const units = measurement["compatibleUnits"];
        if (!Array.isArray(units)) {
          continue;
        }
        for (const unit of units) {
          if (typeof unit !== "string") {
            continue;
          }
          const result = validatePreferencesSemantics(makePref({ [id]: { [dimension]: unit } }), exercisesContext);
          expect(result.valid).toBe(true);
        }
      }
    }
  });
});

describe("PF-02 negative cases (invariant 9)", () => {
  test("an unknown exercise ID fails at its mapping", () => {
    const result = validatePreferencesSemantics(makePref({ "ghost-exercise": { weight: "lb" } }), exercisesMin);
    expect(result.valid).toBe(false);
    expect(at(result, "/exerciseUnits/ghost-exercise")).toContain("preference-exercise-unknown");
  });

  test("a case variant of a retained ID is not a resolution", () => {
    const result = validatePreferencesSemantics(makePref({ "Back-Squat": { weight: "lb" } }), exercisesMin);
    expect(result.valid).toBe(false);
    expect(at(result, "/exerciseUnits/Back-Squat")).toContain("preference-exercise-unknown");
  });

  test("a dimension the exercise lacks fails", () => {
    const result = validatePreferencesSemantics(
      makePref({ "back-squat": { calories: "kcal" }, "pull-up": { weight: "lb" } }),
      exercisesMin
    );
    expect(result.valid).toBe(false);
    expect(at(result, "/exerciseUnits/back-squat/calories")).toContain("preference-dimension-unsupported");
    expect(at(result, "/exerciseUnits/pull-up/weight")).toContain("preference-dimension-unsupported");
  });

  test("a unit absent from the exercise's supported list fails", () => {
    // deadlift-lite supports weight with ["kg"] only; "lb" is a controlled weight unit but not this one's.
    const result = validatePreferencesSemantics(makePref({ "deadlift-lite": { weight: "lb" } }), exercisesContext);
    expect(result.valid).toBe(false);
    expect(at(result, "/exerciseUnits/deadlift-lite/weight")).toContain("preference-unit-incompatible");
  });

  test("a unit outside the controlled table for the dimension fails", () => {
    // "mi" is not a controlled weight unit at all; the schema rejects it too, and this pass must as well.
    const result = validatePreferencesSemantics(makePref({ "back-squat": { weight: "mi" } }), exercisesMin);
    expect(result.valid).toBe(false);
    expect(at(result, "/exerciseUnits/back-squat/weight")).toContain("preference-unit-incompatible");
  });

  test("every incompatible mapping reports its own stable pointer", () => {
    const result = validatePreferencesSemantics(
      makePref({
        "ghost-exercise": { weight: "lb" },
        "Back-Squat": { reps: "rep" },
        "back-squat": { calories: "kcal", weight: "mi" }
      }),
      exercisesMin
    );
    expect(result.valid).toBe(false);
    expect(pairs(result)).toEqual([
      "preference-dimension-unsupported @ /exerciseUnits/back-squat/calories",
      "preference-exercise-unknown @ /exerciseUnits/Back-Squat",
      "preference-exercise-unknown @ /exerciseUnits/ghost-exercise",
      "preference-unit-incompatible @ /exerciseUnits/back-squat/weight"
    ]);
  });
});

describe("structural and context behavior", () => {
  const UNSTRUCTURED_DOCUMENTS: readonly unknown[] = [null, [], {}, { exerciseUnits: [] }, 42];
  for (const document of UNSTRUCTURED_DOCUMENTS) {
    test("an unstructured preferences document fails closed: " + JSON.stringify(document), () => {
      const result = validatePreferencesSemantics(document, exercisesMin);
      expect(result.valid).toBe(false);
      expect(at(result, "")).toEqual(["preferences-document-unstructured"]);
    });
  }

  test("a non-object mapping or unit is schema-owned and skipped", () => {
    // The schema gate owns mapping shape (object with a controlled unit per dimension); the semantic pass
    // reports only the cross-file facts it can prove, so malformed shapes are not re-reported here.
    expect(validatePreferencesSemantics(makePref({ "back-squat": "lb" }), exercisesMin).valid).toBe(true);
    expect(validatePreferencesSemantics(makePref({ "back-squat": { weight: null } }), exercisesMin).valid).toBe(true);
  });

  test("an unreadable exercises directory disables resolution without inventing references", () => {
    for (const broken of [{}, [1, 2], "nope"]) {
      const result = validatePreferencesSemantics(preferencesMin, broken);
      expect(result.valid).toBe(true);
      expect(codes(result)).toEqual([]);
    }
  });

  test("repeated calls are deterministic and inputs are never mutated", () => {
    const frozenPrefs = deepFreeze(JSON.parse(JSON.stringify(preferencesMin)));
    const frozenExercises = deepFreeze(JSON.parse(JSON.stringify(exercisesMin)));
    const first = validatePreferencesSemantics(frozenPrefs, frozenExercises);
    const second = validatePreferencesSemantics(frozenPrefs, frozenExercises);
    expect(second).toEqual(first);
    expect(first.valid).toBe(true);
  });
});
