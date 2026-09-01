/** Focused static semantic tests for the exercises directory (P4-T01). Covers sem-owned rows EX-04, EX-08 (duplicate dimensions), and EX-11
 * with independent contextual fixtures from `tests/fixtures/static-semantic/` (not production curation output); where a case is schema-valid
 * but semantically invalid the schema validator runs as a prerequisite. Authority: docs/contracts/static-data-contracts.md,
 * specs/rep-jot-json-schema-spec.md §2 and §8. */
import { describe, expect, test } from "bun:test";

import { createProductionValidator } from "../../../src/validation/schema-validator";
import { buildExercisesModel, validateExercisesSemantics } from "../../../src/validation/semantic/exercises";
import type { StaticSemanticResult } from "../../../src/validation/semantic/types";

import exercisesContext from "../../fixtures/static-semantic/exercises.context.json";

const schemaValidator = createProductionValidator();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function codes(result: StaticSemanticResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}

function at(result: StaticSemanticResult, path: string): string[] {
  return result.diagnostics.filter((diagnostic) => diagnostic.path === path).map((d) => d.code);
}

/** Set the `compatibleUnits` of one exercise's measurement entry by dimension. */
function setUnits(doc: Record<string, unknown>, exerciseIndex: number, dimension: string, units: string[]): void {
  const exercises = asRecord(doc["exercises"]);
  const exercise = asRecord(exercises[exerciseIndex]);
  const measurements = asRecord(exercise["measurements"]);
  for (const measurement of measurements) {
    if (asRecord(measurement)["dimension"] === dimension) {
      asRecord(measurement)["compatibleUnits"] = units;
    }
  }
}

describe("exercises context fixture (positive)", () => {
  test("the independent context fixture passes the schema prerequisite", () => {
    const result = schemaValidator.validate("exercises", 1, exercisesContext);
    expect(result.valid).toBe(true);
    expect(result.code).toBe("valid");
  });

  test("the context fixture passes static semantic validation", () => {
    const result = validateExercisesSemantics(exercisesContext);
    expect(result.valid).toBe(true);
    expect(codes(result)).toEqual([]);
  });

  test("an empty equipmentIds list is valid and resolves nothing", () => {
    // push-up (index 3) and air-squat (index 4) declare no equipment.
    const result = validateExercisesSemantics(exercisesContext);
    expect(at(result, "/exercises/3/equipmentIds/0")).toEqual([]);
    expect(codes(result).indexOf("equipment-reference-missing")).toBe(-1);
  });

  test("metric-first and single-unit lists validate across the directory", () => {
    // weight ["kg","lb"], distance ["m","km","ft","mi"], duration ["second","minute"], reps ["rep"].
    const result = validateExercisesSemantics(exercisesContext);
    expect(codes(result).indexOf("compatible-unit-order-violation")).toBe(-1);
  });
});

describe("current-document identity uniqueness", () => {
  test("a repeated exercise ID fails with a stable code and pointer", () => {
    const doc = clone(asRecord(exercisesContext));
    asRecord(asRecord(doc["exercises"])[1])["id"] = "back-squat";
    const result = validateExercisesSemantics(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/exercises/1/id")).toContain("exercise-id-duplicate");
  });

  test("a repeated equipment ID fails with a stable code and pointer", () => {
    const doc = clone(asRecord(exercisesContext));
    asRecord(asRecord(doc["equipment"])[1])["id"] = "barbell";
    const result = validateExercisesSemantics(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/equipment/1/id")).toContain("equipment-id-duplicate");
  });
});

describe("EX-04 equipment reference resolution", () => {
  test("an unknown equipmentId fails at its array slot", () => {
    const doc = clone(asRecord(exercisesContext));
    const backSquat = asRecord(asRecord(doc["exercises"])[0]);
    (backSquat["equipmentIds"] as string[]).push("ghost-rack");
    const result = validateExercisesSemantics(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/exercises/0/equipmentIds/1")).toContain("equipment-reference-missing");
  });

  test("every declared equipmentId in the context fixture resolves", () => {
    const model = buildExercisesModel(exercisesContext);
    expect(model.available).toBe(true);
    expect(codes({ valid: true, diagnostics: model.diagnostics }).indexOf("equipment-reference-missing")).toBe(-1);
  });
});

describe("EX-08 duplicate dimensions (semantic half)", () => {
  test("two distinct entries for one dimension fail while the schema passes", () => {
    const doc = clone(asRecord(exercisesContext));
    const backSquat = asRecord(asRecord(doc["exercises"])[0]);
    (backSquat["measurements"] as Record<string, unknown>[]).push({
      dimension: "weight",
      compatibleUnits: ["lb"]
    });
    // The two weight entries are different JSON objects, so schema uniqueItems passes.
    expect(schemaValidator.validate("exercises", 1, doc).valid).toBe(true);
    const result = validateExercisesSemantics(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/exercises/0/measurements/2")).toContain("measurement-dimension-duplicate");
  });
});

describe("EX-11 metric-before-imperial unit ordering", () => {
  test("imperial before metric on weight fails at the units pointer", () => {
    const doc = clone(asRecord(exercisesContext));
    setUnits(doc, 0, "weight", ["lb", "kg"]);
    expect(schemaValidator.validate("exercises", 1, doc).valid).toBe(true);
    const result = validateExercisesSemantics(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/exercises/0/measurements/1/compatibleUnits")).toContain("compatible-unit-order-violation");
  });

  test("interleaved metric and imperial distance units fail", () => {
    const doc = clone(asRecord(exercisesContext));
    setUnits(doc, 6, "distance", ["m", "ft", "km"]);
    expect(schemaValidator.validate("exercises", 1, doc).valid).toBe(true);
    const result = validateExercisesSemantics(doc);
    expect(result.valid).toBe(false);
    expect(codes(result)).toContain("compatible-unit-order-violation");
  });

  test("all-metric and single-unit lists never violate ordering", () => {
    const doc = clone(asRecord(exercisesContext));
    setUnits(doc, 6, "distance", ["km", "m"]);
    expect(validateExercisesSemantics(doc).valid).toBe(true);
    const doc2 = clone(asRecord(exercisesContext));
    setUnits(doc2, 1, "weight", ["lb"]);
    expect(validateExercisesSemantics(doc2).valid).toBe(true);
  });

  test("ordering is checked per exercise independently across the directory", () => {
    // The context fixture interleaves metric/imperial lists across exercises and still validates.
    const result = validateExercisesSemantics(exercisesContext);
    expect(result.valid).toBe(true);
  });
});
