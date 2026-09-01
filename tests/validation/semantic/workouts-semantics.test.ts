/**
 * Focused static semantic tests for the workouts directory (P4-T01). Covers sem-owned rows WK-01, WK-02,
 * EX-10 static half, WK-10 (prescription dimensions and units), WK-15 (iteration duplicates, finite-container
 * bounds, no repeated ancestor), and WK-06 (deterministic rounds_and_reps eligibility including nested repeats).
 * Uses the independent context fixtures in `tests/fixtures/static-semantic/`; where a mutation stays schema-valid
 * the schema validator runs as a prerequisite so ownership stays separated. Authority: docs/contracts/static-data-contracts.md;
 * specs/rep-jot-json-schema-spec.md §3 and §8.
 */
import { describe, expect, test } from "bun:test";

import { createProductionValidator } from "../../../src/validation/schema-validator";
import { validateStaticDocuments } from "../../../src/validation/semantic/index";
import type { StaticSemanticResult } from "../../../src/validation/semantic/types";

import exercisesContext from "../../fixtures/static-semantic/exercises.context.json";
import workoutsContext from "../../fixtures/static-semantic/workouts.context.json";

const schemaValidator = createProductionValidator();

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}
/** Validate the context exercises document against one (possibly mutated) workouts document. */
function check(workoutsDoc: Record<string, unknown>): StaticSemanticResult {
  return validateStaticDocuments(exercisesContext, workoutsDoc);
}
function codes(result: StaticSemanticResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}
function at(result: StaticSemanticResult, path: string): string[] {
  return result.diagnostics.filter((d) => d.path === path).map((d) => d.code);
}
function findNode(root: Record<string, unknown>, nodeId: string): Record<string, unknown> | null {
  if (root["id"] === nodeId) return root;
  const children = root["children"];
  if (!Array.isArray(children)) return null;
  for (const child of children) {
    const found = findNode(asRecord(child), nodeId);
    if (found !== null) return found;
  }
  return null;
}
function firstWorkoutRoot(doc: Record<string, unknown>): Record<string, unknown> {
  return asRecord(asRecord(asRecord(doc["workouts"])[0])["root"]);
}
function exerciseNode(id: string, exerciseId: string, prescription: Record<string, unknown>): Record<string, unknown> {
  return { id, type: "exercise", exerciseId, stimulus: "conditioning", prescription };
}
function containerNode(id: string, strategy: string, strategyConfig: Record<string, unknown>, children: Record<string, unknown>[]): Record<string, unknown> {
  return { id, type: "container", strategy, strategyConfig, children };
}
function pushChild(container: Record<string, unknown>, child: Record<string, unknown>): void {
  (container["children"] as Record<string, unknown>[]).push(child);
}

describe("workouts context fixture (positive)", () => {
  test("the independent context fixture passes the schema prerequisite", () => {
    const result = schemaValidator.validate("workouts", 1, workoutsContext);
    expect(result.valid).toBe(true);
    expect(result.code).toBe("valid");
  });

  test("the context fixture passes static semantic validation", () => {
    const result = check(asRecord(workoutsContext));
    expect(result.valid).toBe(true);
    expect(codes(result)).toEqual([]);
  });

  test("repeated node IDs across workouts validate (WK-02 positive edge)", () => {
    // Node ID "set-1" exists in both "full-spectrum" and "second-workout".
    const doc = asRecord(workoutsContext);
    expect(findNode(firstWorkoutRoot(doc), "set-1")).not.toBeNull();
    const secondRoot = asRecord(asRecord(doc["workouts"])[1])["root"] as Record<string, unknown>;
    expect(findNode(secondRoot, "set-1")).not.toBeNull();
    expect(check(doc).valid).toBe(true);
  });

  test("a retained workout may reference a deprecated exercise (EX-10 static half)", () => {
    // cindy-push-ups references deprecated "push-up"; no prior-production baseline is inferred here.
    const result = check(asRecord(workoutsContext));
    expect(codes(result).indexOf("exercise-reference-missing")).toBe(-1);
    expect(result.valid).toBe(true);
  });
});

describe("WK-01 / WK-02 identity uniqueness", () => {
  test("a duplicate node ID within one workout fails at the second occurrence", () => {
    const doc = clone(asRecord(workoutsContext));
    const root = firstWorkoutRoot(doc);
    const cindy = asRecord(root["children"])[1];
    (cindy["children"] as Record<string, unknown>[])[2]["id"] = "cindy-pull-ups";
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/1/children/2/id")).toContain("node-id-duplicate");
  });

  test("a duplicate workout ID fails at its id pointer", () => {
    const doc = clone(asRecord(workoutsContext));
    asRecord(asRecord(doc["workouts"])[1])["id"] = "full-spectrum";
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/1/id")).toContain("workout-id-duplicate");
  });
});

describe("exercise reference resolution", () => {
  test("an unknown exerciseId fails at its property pointer without cascading", () => {
    const doc = clone(asRecord(workoutsContext));
    const cindy = asRecord(firstWorkoutRoot(doc)["children"])[1];
    (cindy["children"] as Record<string, unknown>[])[0]["exerciseId"] = "ghost-exercise";
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/1/children/0/exerciseId")).toContain("exercise-reference-missing");
    // The unresolved reference suppresses prescription checks for that node only.
    expect(codes(result).indexOf("prescription-dimension-unsupported")).toBe(-1);
  });
});

describe("WK-10 prescription semantics", () => {
  test("a dimension the exercise does not list fails at the field pointer", () => {
    const doc = clone(asRecord(workoutsContext));
    const kbComplex = asRecord(firstWorkoutRoot(doc)["children"])[3];
    (kbComplex["children"] as Record<string, unknown>[])[1]["prescription"] = { weight: { value: 5, unit: "kg" } };
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/3/children/1/prescription/weight")).toContain("prescription-dimension-unsupported");
  });

  test("a unit outside the exercise's compatibleUnits fails at the field pointer", () => {
    const doc = clone(asRecord(workoutsContext));
    const set1 = findNode(firstWorkoutRoot(doc), "set-1");
    expect(set1).not.toBeNull();
    asRecord(set1)["exerciseId"] = "deadlift-lite"; // weight lists ["kg"] only
    (asRecord(asRecord(set1)["prescription"])["weight"] as Record<string, unknown>)["unit"] = "lb";
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/0/children/0/prescription/weight")).toContain(
      "prescription-unit-incompatible"
    );
  });

  test("iteration entries are checked with the same dimension and unit rules", () => {
    const doc = clone(asRecord(workoutsContext));
    const set1 = findNode(firstWorkoutRoot(doc), "set-1");
    expect(set1).not.toBeNull();
    asRecord(set1)["exerciseId"] = "deadlift-lite";
    const iterations = asRecord(asRecord(set1)["prescription"])["iterations"] as Record<string, unknown>[];
    (asRecord(iterations[0])["weight"] as Record<string, unknown>)["unit"] = "lb";
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/0/children/0/prescription/iterations/0/weight")).toContain(
      "prescription-unit-incompatible"
    );
  });

  test("a plain top-level reps field on a non-repetition exercise fails at its pointer", () => {
    const doc = clone(asRecord(workoutsContext));
    const emomBlock = asRecord(firstWorkoutRoot(doc)["children"])[2]; // plank supports duration only
    (asRecord(emomBlock["children"])[0])["prescription"] = { duration: { value: 30, unit: "second" }, reps: 5 };
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/2/children/0/prescription/reps")).toContain(
      "prescription-dimension-unsupported"
    );
  });

  test("a plain reps field in an iteration override on a non-repetition exercise fails at its pointer", () => {
    const doc = clone(asRecord(workoutsContext));
    const emomBlock = asRecord(firstWorkoutRoot(doc)["children"])[2];
    pushChild(
      emomBlock,
      exerciseNode("emom-plank", "plank", { duration: { value: 30, unit: "second" }, iterations: [{ iteration: 2, reps: 3 }] })
    );
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/2/children/1/prescription/iterations/0/reps")).toContain(
      "prescription-dimension-unsupported"
    );
  });

  test("a plain reps field on a repetition exercise stays clean; effort is not a dimension", () => {
    const doc = clone(asRecord(workoutsContext));
    pushChild(firstWorkoutRoot(doc), exerciseNode("pos-air-squats", "air-squat", { reps: 12, effort: { type: "rir", target: 2 } }));
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(codes(result).indexOf("prescription-dimension-unsupported")).toBe(-1);
    expect(at(result, "/workouts/0/root/children/4/prescription/reps")).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("WK-15 iteration rules", () => {
  const set1Iterations = (doc: Record<string, unknown>): Record<string, unknown>[] => {
    const set1 = findNode(firstWorkoutRoot(doc), "set-1");
    expect(set1).not.toBeNull();
    return asRecord(asRecord(set1)["prescription"])["iterations"] as Record<string, unknown>[];
  };

  test("a duplicate iteration number fails at the second entry's pointer", () => {
    const doc = clone(asRecord(workoutsContext));
    set1Iterations(doc).push({ iteration: 2, reps: 1 });
    // Two different objects with the same number: schema uniqueItems passes.
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/0/children/0/prescription/iterations/2/iteration")).toContain("iteration-number-duplicate");
  });

  test("an override above the finite container's count fails (Req 10.5)", () => {
    const doc = clone(asRecord(workoutsContext));
    set1Iterations(doc).push({ iteration: 4, reps: 1 }); // squat-block is rounds(3)
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/0/children/0/prescription/iterations/2/iteration")).toContain("iteration-number-out-of-bounds");
  });

  test("an AMRAP has no configured count, so overrides are unbounded there", () => {
    const doc = clone(asRecord(workoutsContext));
    const cindy = asRecord(firstWorkoutRoot(doc)["children"])[1];
    pushChild(cindy, exerciseNode("cindy-rows", "pull-up", { reps: 5, iterations: [{ iteration: 99, reps: 2 }] }));
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(codes(result).indexOf("iteration-number-out-of-bounds")).toBe(-1);
    // AMRAP is repeated but unbounded: no missing-ancestor diagnostic either.
    expect(codes(result).indexOf("iteration-without-repeated-container")).toBe(-1);
    expect(result.valid).toBe(true);
  });

  test("an iteration under a plain sequence with no repeated ancestor fails at each pointer", () => {
    const doc = clone(asRecord(workoutsContext));
    pushChild(firstWorkoutRoot(doc), exerciseNode("free-squats", "air-squat", {
      reps: 3,
      iterations: [{ iteration: 1, reps: 2 }, { iteration: 2, reps: 1 }]
    }));
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/4/prescription/iterations/0/iteration")).toContain(
      "iteration-without-repeated-container"
    );
    expect(at(result, "/workouts/0/root/children/4/prescription/iterations/1/iteration")).toContain(
      "iteration-without-repeated-container"
    );
  });
});

describe("WK-06 deterministic rounds_and_reps eligibility", () => {
  test("an AMRAP over repetition-based leaves validates (cindy)", () => {
    const result = check(asRecord(workoutsContext));
    expect(codes(result).indexOf("rounds-and-reps-leaf-not-repetition-based")).toBe(-1);
    expect(result.valid).toBe(true);
  });

  test("a duration-only leaf inside the AMRAP fails at the leaf pointer", () => {
    const doc = clone(asRecord(workoutsContext));
    const cindy = asRecord(firstWorkoutRoot(doc)["children"])[1];
    pushChild(cindy, exerciseNode("cindy-plank", "plank", { duration: { value: 30, unit: "second" } }));
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/1/children/3")).toContain("rounds-and-reps-leaf-not-repetition-based");
  });

  test("a reps-capable leaf whose static prescription has no reps fails at the leaf pointer", () => {
    const doc = clone(asRecord(workoutsContext));
    const cindy = asRecord(firstWorkoutRoot(doc)["children"])[1];
    (asRecord(cindy["children"])[0])["prescription"] = { addedWeight: { value: 5, unit: "kg" } };
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/1/children/0")).toContain("rounds-and-reps-leaf-not-repetition-based");
  });

  test("the same leaf with static reps in its prescription stays eligible", () => {
    const doc = clone(asRecord(workoutsContext));
    const cindy = asRecord(firstWorkoutRoot(doc)["children"])[1];
    (asRecord(cindy["children"])[0])["prescription"] = { reps: 10, addedWeight: { value: 5, unit: "kg" } };
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    expect(check(doc).valid).toBe(true);
  });

  test("a nested EMOM over repetition-based leaves stays eligible (finite cycles, fixed order)", () => {
    const doc = clone(asRecord(workoutsContext));
    const cindy = asRecord(firstWorkoutRoot(doc)["children"])[1];
    pushChild(cindy, containerNode("cindy-emom", "emom", { cycles: 2, interval: { value: 1, unit: "minute" } }, [
      exerciseNode("cindy-emom-leaf", "pull-up", { reps: 5 })
    ]));
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(result.valid).toBe(true);
  });

  test("a nested EMOM with a duration-only leaf fails via the existing leaf rule", () => {
    const doc = clone(asRecord(workoutsContext));
    const cindy = asRecord(firstWorkoutRoot(doc)["children"])[1];
    pushChild(cindy, containerNode("cindy-emom", "emom", { cycles: 2, interval: { value: 1, unit: "minute" } }, [
      exerciseNode("cindy-emom-plank", "plank", { duration: { value: 30, unit: "second" } })
    ]));
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/1/children/3/children/0")).toContain("rounds-and-reps-leaf-not-repetition-based");
  });

  test("an iteration override above an EMOM's cycles fails (finite bound preserved)", () => {
    const doc = clone(asRecord(workoutsContext));
    const emomBlock = asRecord(firstWorkoutRoot(doc)["children"])[2]; // cycles: 4
    pushChild(emomBlock, exerciseNode("emom-rows", "pull-up", { reps: 5, iterations: [{ iteration: 5, reps: 2 }] }));
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/2/children/1/prescription/iterations/0/iteration")).toContain("iteration-number-out-of-bounds");
  });

  test("a nested AMRAP inside the AMRAP is non-deterministic even without capture", () => {
    const doc = clone(asRecord(workoutsContext));
    const cindy = asRecord(firstWorkoutRoot(doc)["children"])[1];
    pushChild(cindy, containerNode("cindy-inner-amrap", "amrap", { duration: { value: 5, unit: "minute" } }, [
      exerciseNode("inner-leaf", "air-squat", { reps: 5 })
    ]));
    const result = check(doc);
    expect(result.valid).toBe(false);
    expect(at(result, "/workouts/0/root/children/1/children/3")).toContain("rounds-and-reps-nested-container-non-deterministic");
  });

  test("a nested fixed-rounds container over repetition-based leaves stays eligible", () => {
    const doc = clone(asRecord(workoutsContext));
    const cindy = asRecord(firstWorkoutRoot(doc)["children"])[1];
    pushChild(cindy, containerNode("cindy-rounds", "rounds", { rounds: 2 }, [
      exerciseNode("cr-pull-ups", "pull-up", { reps: 5 }),
      exerciseNode("cr-air-squats", "air-squat", { reps: 10 })
    ]));
    expect(schemaValidator.validate("workouts", 1, doc).valid).toBe(true);
    const result = check(doc);
    expect(result.valid).toBe(true);
  });

  test("an unresolvable leaf inside the AMRAP reports only the missing reference", () => {
    const doc = clone(asRecord(workoutsContext));
    const cindy = asRecord(firstWorkoutRoot(doc)["children"])[1];
    pushChild(cindy, exerciseNode("cindy-ghost", "ghost-exercise", { reps: 5 }));
    const result = check(doc);
    expect(codes(result)).toContain("exercise-reference-missing");
    expect(codes(result).indexOf("rounds-and-reps-leaf-not-repetition-based")).toBe(-1);
  });
});
