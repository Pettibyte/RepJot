/**
 * Safety, determinism, and ownership tests for static semantic validation (P4-T01). Proves: inputs are never mutated; repeated calls on equal
 * inputs return identical sorted diagnostics; unstructured or hostile input fails closed without throwing and with only stable codes; every
 * message is the fixed safe text for its code; EX-12 holds structurally; deep nesting cannot overflow the stack. Authority:
 * docs/implementation/GATES.md Section 2; docs/contracts/static-data-contracts.md EX-12.
 */
import { describe, expect, test } from "bun:test";

import { STATIC_SEMANTIC_MESSAGES, validateStaticDocuments } from "../../../src/validation/semantic/index";
import type { StaticSemanticResult } from "../../../src/validation/semantic/types";

import exercisesContext from "../../fixtures/static-semantic/exercises.context.json";
import workoutsContext from "../../fixtures/static-semantic/workouts.context.json";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const child = (value as Record<string, unknown>)[key];
      if (typeof child === "object" && child !== null) {
        deepFreeze(child);
      }
    }
    Object.freeze(value);
  }
  return value;
}

function assertSafeDiagnostics(result: StaticSemanticResult): void {
  for (const diagnostic of result.diagnostics) {
    expect(typeof diagnostic.code).toBe("string");
    expect(typeof diagnostic.path).toBe("string");
    const expected = STATIC_SEMANTIC_MESSAGES[diagnostic.code];
    expect(diagnostic.message).toBe(expected);
    // Fixed messages contain no document data; assert they stay in the safe table.
    expect(Object.values(STATIC_SEMANTIC_MESSAGES).indexOf(diagnostic.message)).not.toBe(-1);
  }
}

function assertSorted(result: StaticSemanticResult): void {
  const diagnostics = result.diagnostics;
  for (let i = 1; i < diagnostics.length; i += 1) {
    const prev = diagnostics[i - 1];
    const cur = diagnostics[i];
    const order = prev.code === cur.code ? prev.path <= cur.path : prev.code < cur.code;
    expect(order).toBe(true);
  }
}

describe("input immutability", () => {
  test("deep-frozen context documents validate without mutation or throw", () => {
    const exercises = deepFreeze(clone(exercisesContext));
    const workouts = deepFreeze(clone(workoutsContext));
    const beforeExercises = JSON.stringify(exercises);
    const beforeWorkouts = JSON.stringify(workouts);
    const result = validateStaticDocuments(exercises, workouts);
    expect(result.valid).toBe(true);
    expect(JSON.stringify(exercises)).toBe(beforeExercises);
    expect(JSON.stringify(workouts)).toBe(beforeWorkouts);
  });
});

describe("determinism", () => {
  test("repeated validation of equal inputs returns identical results", () => {
    const a = validateStaticDocuments(exercisesContext, workoutsContext);
    const b = validateStaticDocuments(exercisesContext, workoutsContext);
    expect(a).toEqual(b);
    assertSorted(a);
  });

  test("invalid input produces identical sorted diagnostics across calls", () => {
    const doc = clone(workoutsContext) as Record<string, unknown>;
    // Force two violations: duplicate node ID and a missing exercise reference.
    const root = (doc["workouts"] as Record<string, unknown>[])[0]["root"] as Record<string, unknown>;
    const children = root["children"] as Record<string, unknown>[];
    children[1]["id"] = "squat-block"; // duplicates the rounds container id in this workout
    (children[2]["children"] as Record<string, unknown>)[0]["exerciseId"] = "ghost-exercise";
    const a = validateStaticDocuments(exercisesContext, doc);
    const b = validateStaticDocuments(exercisesContext, doc);
    expect(a.valid).toBe(false);
    expect(a).toEqual(b);
    assertSorted(a);
    assertSafeDiagnostics(a);
  });
});

describe("unstructured and hostile input fails closed", () => {
  const hostileInputs: Array<[string, unknown]> = [
    ["null document", null],
    ["string document", "not a document"],
    ["array document", [1, 2, 3]],
    ["empty object", {}],
    ["wrong family shape", { format: "repjot/exercises", schemaVersion: 1 }],
    ["non-array collections", { equipment: "nope", exercises: [] }]
  ];

  for (const [label, input] of hostileInputs) {
    test(label + " as exercises document does not throw and reports unstructured", () => {
      const result = validateStaticDocuments(input, workoutsContext);
      expect(result.valid).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      const codes = result.diagnostics.map((d) => d.code);
      expect(codes.indexOf("exercises-document-unstructured")).not.toBe(-1);
      // With the exercises directory unavailable, reference checks are disabled, not guessed.
      assertSafeDiagnostics(result);
    });

    test(label + " as workouts document does not throw and reports unstructured", () => {
      const result = validateStaticDocuments(exercisesContext, input);
      expect(result.valid).toBe(false);
      const codes = result.diagnostics.map((d) => d.code);
      expect(codes.indexOf("workouts-document-unstructured")).not.toBe(-1);
      assertSafeDiagnostics(result);
    });
  }

  test("both documents unstructured yields exactly the two root diagnostics", () => {
    const result = validateStaticDocuments(null, null);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.length).toBe(2);
    expect(result.diagnostics.map((d) => d.path)).toEqual(["", ""]);
  });

  test("garbage node values inside a structured tree do not throw", () => {
    const doc = clone(workoutsContext) as Record<string, unknown>;
    const root = (doc["workouts"] as Record<string, unknown>[])[0]["root"] as Record<string, unknown>;
    root["children"] = [null, 7, "text", { id: "x" }, { type: "exercise" }];
    const result = validateStaticDocuments(exercisesContext, doc);
    expect(typeof result.valid).toBe("boolean");
    assertSafeDiagnostics(result);
  });
});

describe("EX-12: static validation reads no preferences", () => {
  test("the API accepts exactly the two static documents", () => {
    expect(validateStaticDocuments.length).toBe(2);
  });

  test("equal static documents validate identically regardless of any external state", () => {
    const a = validateStaticDocuments(exercisesContext, workoutsContext);
    const b = validateStaticDocuments(clone(exercisesContext), clone(workoutsContext));
    expect(a).toEqual(b);
  });
});

describe("deep nesting safety", () => {
  test("a deeply nested sequence tree under a valid AMRAP does not overflow the stack", () => {
    const doc = clone(workoutsContext) as Record<string, unknown>;
    const root = (doc["workouts"] as Record<string, unknown>[])[0]["root"] as Record<string, unknown>;
    const cindy = (root["children"] as Record<string, unknown>[])
      .filter((child) => child["id"] === "cindy")[0];
    // Replace cindy's leaves with 5000 nested sequence containers ending in one rep leaf.
    let inner: Record<string, unknown> = {
      id: "leaf",
      type: "exercise",
      exerciseId: "pull-up",
      stimulus: "conditioning",
      prescription: { reps: 5 }
    };
    for (let depth = 0; depth < 5000; depth += 1) {
      inner = {
        id: "depth-" + depth,
        type: "container",
        strategy: "sequence",
        strategyConfig: {},
        children: [inner]
      };
    }
    cindy["children"] = [inner];
    const result = validateStaticDocuments(exercisesContext, doc);
    expect(result.valid).toBe(true);
  });
});
