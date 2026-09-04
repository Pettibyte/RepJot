/** Focused Phase 6 score and omission fixtures for RS-12, RS-13, TR-02, and TR-12. */
import { describe, expect, test } from "bun:test";

import { createProductionValidator } from "../../../src/validation/schema-validator";
import { deriveScoreFromDetail, validateResultScores } from "../../../src/validation/semantic/result-score";
import { validateResultsShard } from "../../../src/validation/semantic";
import type { ResultSemanticResult } from "../../../src/validation/semantic/result-types";
import workouts from "../../fixtures/result-semantic/workouts.context.json";
import contextShard from "../../fixtures/result-semantic/shard.context.json";
import acceptanceNestedScored from "../../fixtures/contract-acceptance/results.nested-scored.json";
import acceptanceUntouched from "../../fixtures/contract-acceptance/results.untouched-before-deprecation.json";
import acceptanceLaterAddition from "../../fixtures/contract-acceptance/results.later-addition.json";
import acceptanceScenarioWorkouts from "../../fixtures/contract-acceptance/workouts.scenario.json";
import acceptanceDeprecated from "../../fixtures/contract-acceptance/results.deprecated-at-start.json";
import exercises from "../../fixtures/result-semantic/exercises.context.json";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}
function diagnostics(result: ResultSemanticResult): Array<[string, string]> {
  return result.diagnostics.map((item) => [item.code, item.path]);
}

function exerciseNode(id: string, reps: number): Record<string, unknown> {
  return {
    id,
    type: "exercise",
    exerciseId: id,
    stimulus: "conditioning",
    prescription: { reps }
  };
}

function scoredWorkout(
  id: string,
  strategy: string,
  strategyConfig: Record<string, unknown>,
  scoreType: string,
  children: readonly Record<string, unknown>[],
  childDetail = "optional"
): Record<string, unknown> {
  return {
    format: "repjot/workouts",
    schemaVersion: 1,
    workouts: [{
      id,
      name: id,
      root: {
        id: "root",
        type: "container",
        strategy: "sequence",
        strategyConfig: {},
        children: [{
          id: "scored",
          type: "container",
          strategy,
          strategyConfig,
          resultCapture: { mode: "scored", scoreType, childDetail },
          children
        }]
      }
    }]
  };
}

function persistedSessionDocument(workoutId: string, results: readonly Record<string, unknown>[]): Record<string, unknown> {
  return {
    format: "repjot/results",
    schemaVersion: 1,
    yearMonthUtc: "2026-09",
    sessionTombstones: [],
    sessions: [{
      id: "session-550e8400-e29b-41d4-a716-446655440000",
      workoutId,
      status: "completed",
      startedAtUtc: "2026-09-01T10:00:00Z",
      endedAtUtc: "2026-09-01T10:30:00Z",
      updatedAtUtc: "2026-09-01T10:30:00Z",
      results
    }]
  };
}

function persistedExerciseResult(
  workoutId: string,
  path: readonly Record<string, unknown>[],
  id: string,
  reps: number,
  status: string
): Record<string, unknown> {
  return { type: "exercise", workoutId, executionPath: path, exerciseId: id, status, values: { reps } };
}

const schema = createProductionValidator();

describe("pure score helpers", () => {
  test("derive rounds and reps while keeping structural and score completeness distinct", () => {
    const groups = [
      [
        { executionPath: [{ nodeId: "a" }], status: "completed", values: { reps: 10 } },
        { executionPath: [{ nodeId: "b" }], status: "completed", values: { reps: 20 } }
      ],
      [
        { executionPath: [{ nodeId: "a" }], status: "incomplete", values: { reps: 5 } },
        { executionPath: [{ nodeId: "b" }], status: "incomplete", values: { reps: 2 } }
      ]
    ];
    const result = deriveScoreFromDetail("rounds_and_reps", groups, ["a", "b"], null);
    expect(result.score).toEqual({ type: "rounds_and_reps", completedRounds: 1, additionalReps: 7 });
    expect(result.completeness).toEqual({ hasDetail: true, structuralComplete: true, scoreComplete: false });
  });

  test("missing leaves do not become an inferred score", () => {
    const result = deriveScoreFromDetail(
      "rounds_and_reps",
      [[{ executionPath: [{ nodeId: "a" }], status: "completed", values: { reps: 10 } }]],
      ["a", "b"],
      null
    );
    expect(result.score).toBe(null);
    expect(result.completeness.structuralComplete).toBe(false);
    expect(result.completeness.scoreComplete).toBe(false);
  });
});

describe("execution and schedule score derivation", () => {
  test("accepts a matching detailed rounds_and_reps score", () => {
    const workout = scoredWorkout("amrap", "amrap", { duration: { value: 5, unit: "minute" } }, "rounds_and_reps", [
      exerciseNode("first", 5),
      exerciseNode("second", 10)
    ]);
    const results = [
      { type: "container", workoutId: "amrap", executionPath: [{ nodeId: "root" }, { nodeId: "scored" }], status: "completed", score: { type: "rounds_and_reps", completedRounds: 1, additionalReps: 0 } },
      persistedExerciseResult("amrap", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "first" }], "first", 5, "completed"),
      persistedExerciseResult("amrap", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "second" }], "second", 10, "completed")
    ];
    const document = persistedSessionDocument("amrap", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(validateResultScores(document, workout).valid).toBe(true);
  });

  test("counts each child occurrence in a multi-child EMOM", () => {
    const workout = scoredWorkout("emom", "emom", { cycles: 2, interval: { value: 1, unit: "minute" } }, "intervals", [
      exerciseNode("first", 5),
      exerciseNode("second", 5)
    ]);
    const results = [
      { type: "container", workoutId: "emom", executionPath: [{ nodeId: "root" }, { nodeId: "scored" }], status: "completed", score: { type: "intervals", completedIntervals: 2, totalIntervals: 4 } },
      persistedExerciseResult("emom", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "first" }], "first", 5, "completed"),
      persistedExerciseResult("emom", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "second" }], "second", 5, "completed")
    ];
    const document = persistedSessionDocument("emom", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(validateResultScores(document, workout).valid).toBe(true);
  });

  test("accepts one observed interval in a multi-child EMOM", () => {
    const workout = scoredWorkout("one-interval", "emom", { cycles: 2, interval: { value: 1, unit: "minute" } }, "intervals", [
      exerciseNode("first", 5),
      exerciseNode("second", 5)
    ]);
    const results = [
      { type: "container", workoutId: "one-interval", executionPath: [{ nodeId: "root" }, { nodeId: "scored" }], status: "completed", score: { type: "intervals", completedIntervals: 1, totalIntervals: 4 } },
      persistedExerciseResult("one-interval", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "first" }], "first", 5, "completed")
    ];
    const document = persistedSessionDocument("one-interval", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(validateResultScores(document, workout).valid).toBe(true);
  });

  test("rejects a later EMOM child when the first child is absent", () => {
    const workout = scoredWorkout("skipped-first", "emom", { cycles: 2, interval: { value: 1, unit: "minute" } }, "intervals", [
      exerciseNode("first", 5),
      exerciseNode("second", 5)
    ]);
    const results = [
      { type: "container", workoutId: "skipped-first", executionPath: [{ nodeId: "root" }, { nodeId: "scored" }], status: "completed", score: { type: "intervals", completedIntervals: 1, totalIntervals: 4 } },
      persistedExerciseResult("skipped-first", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "second" }], "second", 5, "completed")
    ];
    const document = persistedSessionDocument("skipped-first", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultScores(document, workout))).toEqual([
      ["container-detail-incomplete", "/sessions/0/results/0/executionPath"]
    ]);
  });

  test("rejects a partial EMOM cycle followed by a later cycle", () => {
    const workout = scoredWorkout("partial-emom", "emom", { cycles: 2, interval: { value: 1, unit: "minute" } }, "intervals", [
      exerciseNode("first", 5),
      exerciseNode("second", 5)
    ]);
    const results = [
      { type: "container", workoutId: "partial-emom", executionPath: [{ nodeId: "root" }, { nodeId: "scored" }], status: "completed", score: { type: "intervals", completedIntervals: 3, totalIntervals: 4 } },
      persistedExerciseResult("partial-emom", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "first" }], "first", 5, "completed"),
      persistedExerciseResult("partial-emom", [{ nodeId: "root" }, { nodeId: "scored", iteration: 2 }, { nodeId: "first" }], "first", 5, "completed"),
      persistedExerciseResult("partial-emom", [{ nodeId: "root" }, { nodeId: "scored", iteration: 2 }, { nodeId: "second" }], "second", 5, "completed")
    ];
    const document = persistedSessionDocument("partial-emom", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultScores(document, workout))).toEqual([
      ["container-detail-incomplete", "/sessions/0/results/0/executionPath"]
    ]);
  });

  test("enforces aggregate-only bounds from the next variable-prescription round", () => {
    const first = exerciseNode("first", 5);
    const second = exerciseNode("second", 10);
    first.prescription = { reps: 5, iterations: [{ iteration: 2, reps: 20 }] };
    second.prescription = { reps: 10, iterations: [{ iteration: 2, reps: 10 }] };
    const workout = scoredWorkout("variable-aggregate", "amrap", { duration: { value: 5, unit: "minute" } }, "rounds_and_reps", [first, second]);
    const invalid = [{
      type: "container",
      workoutId: "variable-aggregate",
      executionPath: [{ nodeId: "root" }, { nodeId: "scored" }],
      status: "completed",
      score: { type: "rounds_and_reps", completedRounds: 1, additionalReps: 30 }
    }];
    const invalidDocument = persistedSessionDocument("variable-aggregate", invalid);
    expect(schema.validate("results", 1, invalidDocument).valid).toBe(true);
    expect(diagnostics(validateResultScores(invalidDocument, workout))).toEqual([
      ["container-score-bounds-invalid", "/sessions/0/results/0/score"]
    ]);

    const valid = [{
      type: "container",
      workoutId: "variable-aggregate",
      executionPath: [{ nodeId: "root" }, { nodeId: "scored" }],
      status: "completed",
      score: { type: "rounds_and_reps", completedRounds: 1, additionalReps: 29 }
    }];
    const validDocument = persistedSessionDocument("variable-aggregate", valid);
    expect(schema.validate("results", 1, validDocument).valid).toBe(true);
    expect(validateResultScores(validDocument, workout).valid).toBe(true);
  });

  test("sums the completed prefix and partial value in a partial round", () => {
    const workout = scoredWorkout("partial-prefix", "amrap", { duration: { value: 5, unit: "minute" } }, "rounds_and_reps", [
      exerciseNode("first", 5),
      exerciseNode("second", 10)
    ]);
    const results = [
      { type: "container", workoutId: "partial-prefix", executionPath: [{ nodeId: "root" }, { nodeId: "scored" }], status: "completed", score: { type: "rounds_and_reps", completedRounds: 0, additionalReps: 7 } },
      persistedExerciseResult("partial-prefix", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "first" }], "first", 5, "completed"),
      persistedExerciseResult("partial-prefix", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "second" }], "second", 2, "incomplete")
    ];
    const document = persistedSessionDocument("partial-prefix", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(validateResultScores(document, workout).valid).toBe(true);
  });

  test("uses the effective prescription total for the partial iteration", () => {
    const first = exerciseNode("first", 5);
    const second = exerciseNode("second", 10);
    first.prescription = { reps: 5, iterations: [{ iteration: 2, reps: 20 }] };
    second.prescription = { reps: 10, iterations: [{ iteration: 2, reps: 10 }] };
    const workout = scoredWorkout("variable-rounds", "amrap", { duration: { value: 5, unit: "minute" } }, "rounds_and_reps", [first, second]);
    const results = [
      { type: "container", workoutId: "variable-rounds", executionPath: [{ nodeId: "root" }, { nodeId: "scored" }], status: "completed", score: { type: "rounds_and_reps", completedRounds: 1, additionalReps: 29 } },
      persistedExerciseResult("variable-rounds", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "first" }], "first", 5, "completed"),
      persistedExerciseResult("variable-rounds", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "second" }], "second", 10, "completed"),
      persistedExerciseResult("variable-rounds", [{ nodeId: "root" }, { nodeId: "scored", iteration: 2 }, { nodeId: "first" }], "first", 20, "completed"),
      persistedExerciseResult("variable-rounds", [{ nodeId: "root" }, { nodeId: "scored", iteration: 2 }, { nodeId: "second" }], "second", 9, "incomplete")
    ];
    const document = persistedSessionDocument("variable-rounds", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(validateResultScores(document, workout).valid).toBe(true);
  });

  test("handles a deeply nested valid scored tree without recursive overflow", () => {
    const depth = 10000;
    const ids: string[] = [];
    let child = exerciseNode("deep-leaf", 5);
    for (let i = 0; i < depth; i += 1) {
      const id = "deep-" + String(i);
      ids.push(id);
      child = { id, type: "container", strategy: "sequence", strategyConfig: {}, children: [child] };
    }
    const workout = scoredWorkout("deep-tree", "amrap", { duration: { value: 5, unit: "minute" } }, "rounds_and_reps", [child]);
    const path: Record<string, unknown>[] = [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }];
    for (let i = ids.length - 1; i >= 0; i -= 1) {
      path.push({ nodeId: ids[i] });
    }
    path.push({ nodeId: "deep-leaf" });
    const results = [
      { type: "container", workoutId: "deep-tree", executionPath: [{ nodeId: "root" }, { nodeId: "scored" }], status: "completed", score: { type: "rounds_and_reps", completedRounds: 1, additionalReps: 0 } },
      persistedExerciseResult("deep-tree", path, "deep-leaf", 5, "completed")
    ];
    const document = persistedSessionDocument("deep-tree", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(validateResultScores(document, workout).valid).toBe(true);
  });

  test("does not eagerly materialize a huge finite repeated count", () => {
    const workout = scoredWorkout("huge-count", "amrap", { duration: { value: 5, unit: "minute" } }, "rounds_and_reps", [{
      id: "huge-rounds",
      type: "container",
      strategy: "rounds",
      strategyConfig: { rounds: 1000000000 },
      children: [exerciseNode("only", 5)]
    }]);
    const results = [
      { type: "container", workoutId: "huge-count", executionPath: [{ nodeId: "root" }, { nodeId: "scored" }], status: "completed", score: { type: "rounds_and_reps", completedRounds: 0, additionalReps: 5 } },
      persistedExerciseResult("huge-count", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "huge-rounds", iteration: 1 }, { nodeId: "only" }], "only", 5, "completed")
    ];
    const document = persistedSessionDocument("huge-count", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultScores(document, workout))).toEqual([
      ["container-detail-incomplete", "/sessions/0/results/0/executionPath"]
    ]);
  });

  test("does not collapse repeated nested execution occurrences", () => {
    const inner = {
      id: "inner",
      type: "container",
      strategy: "rounds",
      strategyConfig: { rounds: 2 },
      children: [exerciseNode("only", 5)]
    };
    const workout = scoredWorkout("nested", "amrap", { duration: { value: 5, unit: "minute" } }, "rounds_and_reps", [inner]);
    const results = [
      { type: "container", workoutId: "nested", executionPath: [{ nodeId: "root" }, { nodeId: "scored" }], status: "completed", score: { type: "rounds_and_reps", completedRounds: 1, additionalReps: 0 } },
      persistedExerciseResult("nested", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "inner", iteration: 2 }, { nodeId: "only" }], "only", 5, "completed")
    ];
    const document = persistedSessionDocument("nested", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultScores(document, workout))).toEqual([
      ["container-detail-incomplete", "/sessions/0/results/0/executionPath"]
    ]);
  });

  test("uses prescriptions and rejects wrong repetitions or unnormalized extras", () => {
    const workout = scoredWorkout("prescribed", "amrap", { duration: { value: 5, unit: "minute" } }, "rounds_and_reps", [
      exerciseNode("first", 5),
      exerciseNode("second", 10)
    ]);
    const wrongDetail = [
      { type: "container", workoutId: "prescribed", executionPath: [{ nodeId: "root" }, { nodeId: "scored" }], status: "completed", score: { type: "rounds_and_reps", completedRounds: 0, additionalReps: 4 } },
      persistedExerciseResult("prescribed", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "first" }], "first", 4, "completed"),
      persistedExerciseResult("prescribed", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "second" }], "second", 10, "completed")
    ];
    const wrongDocument = persistedSessionDocument("prescribed", wrongDetail);
    expect(schema.validate("results", 1, wrongDocument).valid).toBe(true);
    expect(diagnostics(validateResultScores(wrongDocument, workout))).toEqual([
      ["container-score-mismatch", "/sessions/0/results/0/score"]
    ]);

    const unnormalized = [{ type: "container", workoutId: "prescribed", executionPath: [{ nodeId: "root" }, { nodeId: "scored" }], status: "completed", score: { type: "rounds_and_reps", completedRounds: 1, additionalReps: 15 } }];
    const unnormalizedDocument = persistedSessionDocument("prescribed", unnormalized);
    expect(schema.validate("results", 1, unnormalizedDocument).valid).toBe(true);
    expect(diagnostics(validateResultScores(unnormalizedDocument, workout))).toEqual([
      ["container-score-bounds-invalid", "/sessions/0/results/0/score"]
    ]);
  });

  test("rejects a lone later iteration as the first round", () => {
    const workout = scoredWorkout("later", "amrap", { duration: { value: 5, unit: "minute" } }, "rounds_and_reps", [exerciseNode("only", 5)]);
    const results = [
      { type: "container", workoutId: "later", executionPath: [{ nodeId: "root" }, { nodeId: "scored" }], status: "completed", score: { type: "rounds_and_reps", completedRounds: 1, additionalReps: 0 } },
      persistedExerciseResult("later", [{ nodeId: "root" }, { nodeId: "scored", iteration: 2 }, { nodeId: "only" }], "only", 5, "completed")
    ];
    const document = persistedSessionDocument("later", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultScores(document, workout))).toEqual([
      ["container-score-mismatch", "/sessions/0/results/0/score"]
    ]);
  });

  test("rejects nonstandard when configured progression derives normally", () => {
    const workout = scoredWorkout("normal", "amrap", { duration: { value: 5, unit: "minute" } }, "rounds_and_reps", [exerciseNode("only", 5)]);
    const results = [
      { type: "container", workoutId: "normal", executionPath: [{ nodeId: "root" }, { nodeId: "scored" }], status: "completed", score: { type: "nonstandard" } },
      persistedExerciseResult("normal", [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "only" }], "only", 5, "completed")
    ];
    const document = persistedSessionDocument("normal", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultScores(document, workout))).toEqual([
      ["container-score-mismatch", "/sessions/0/results/0/score"]
    ]);
  });
});

describe("RS-12 and RS-13: aggregate and detail validation", () => {
  test("rejects a score on a container without result capture", () => {
    const workout = {
      format: "repjot/workouts",
      schemaVersion: 1,
      workouts: [{
        id: "unscored-container",
        name: "unscored-container",
        root: {
          id: "root",
          type: "container",
          strategy: "sequence",
          strategyConfig: {},
          children: [{
            id: "unscored",
            type: "container",
            strategy: "sequence",
            strategyConfig: {},
            children: [exerciseNode("only", 5)]
          }]
        }
      }]
    };
    const results = [{
      type: "container",
      workoutId: "unscored-container",
      executionPath: [{ nodeId: "root" }, { nodeId: "unscored" }],
      status: "completed",
      score: { type: "cycles", completedCycles: 1 }
    }];
    const document = persistedSessionDocument("unscored-container", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultScores(document, workout))).toEqual([
      ["container-score-type-mismatch", "/sessions/0/results/0/score/type"]
    ]);
  });

  test("the integrated public path rejects a score on an unscored container", () => {
    const document = clone(asRecord(acceptanceNestedScored));
    const session = asRecord((document["sessions"] as unknown[])[0]);
    (session["results"] as Record<string, unknown>[]).push({
      type: "container",
      workoutId: "nested-scored",
      executionPath: [{ nodeId: "root" }],
      status: "completed",
      score: { type: "intervals", completedIntervals: 1, totalIntervals: 1 }
    });
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultsShard(document, acceptanceScenarioWorkouts, exercises, "results-2026-08.json"))).toEqual([
      ["container-score-type-mismatch", "/sessions/0/results/3/score/type"]
    ]);
  });

  test("rejects child detail below childDetail none without a container result", () => {
    const workout = scoredWorkout("none-without-container", "complex", { cycles: 1 }, "cycles", [exerciseNode("only", 5)], "none");
    const results = [persistedExerciseResult(
      "none-without-container",
      [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "only" }],
      "only",
      5,
      "completed"
    )];
    const document = persistedSessionDocument("none-without-container", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultScores(document, workout))).toEqual([
      ["container-detail-forbidden", "/sessions/0/results/0/executionPath"]
    ]);
  });

  test("checks nested scored ancestors without duplicate detail cascades", () => {
    const inner = {
      id: "inner",
      type: "container",
      strategy: "complex",
      strategyConfig: { cycles: 1 },
      resultCapture: { mode: "scored", scoreType: "cycles", childDetail: "none" },
      children: [exerciseNode("nested-only", 5)]
    };
    const workout = scoredWorkout("nested-none", "complex", { cycles: 1 }, "cycles", [inner], "none");
    const results = [persistedExerciseResult(
      "nested-none",
      [{ nodeId: "root" }, { nodeId: "scored", iteration: 1 }, { nodeId: "inner", iteration: 1 }, { nodeId: "nested-only" }],
      "nested-only",
      5,
      "completed"
    )];
    const document = persistedSessionDocument("nested-none", results);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultScores(document, workout))).toEqual([
      ["container-detail-forbidden", "/sessions/0/results/0/executionPath"]
    ]);
  });

  test("aggregate-only nested scores remain authoritative", () => {
    expect(schema.validate("results", 1, acceptanceNestedScored).valid).toBe(true);
    const result = validateResultScores(acceptanceNestedScored, acceptanceScenarioWorkouts);
    expect(result.valid).toBe(true);
    expect(diagnostics(result)).toEqual([]);
  });

  test("complete detail recomputes every nested scored ancestor", () => {
    const document = clone(asRecord(acceptanceNestedScored));
    const session = asRecord((document["sessions"] as unknown[])[0]);
    const results = session["results"] as Record<string, unknown>[];
    results.push(
      {
        type: "exercise",
        workoutId: "nested-scored",
        executionPath: [{ nodeId: "root" }, { nodeId: "blocks", iteration: 1 }, { nodeId: "mini-amrap", iteration: 1 }, { nodeId: "nested-pull-up" }],
        exerciseId: "pull-up",
        status: "completed",
        values: { reps: 5 }
      },
      {
        type: "exercise",
        workoutId: "nested-scored",
        executionPath: [{ nodeId: "root" }, { nodeId: "blocks", iteration: 1 }, { nodeId: "mini-amrap", iteration: 1 }, { nodeId: "nested-air-squat" }],
        exerciseId: "air-squat",
        status: "completed",
        values: { reps: 10 }
      }
    );
    expect(schema.validate("results", 1, document).valid).toBe(true);
    const result = validateResultScores(document, acceptanceScenarioWorkouts);
    expect(diagnostics(result)).toEqual([
      ["container-score-mismatch", "/sessions/0/results/0/score"],
      ["container-score-mismatch", "/sessions/0/results/1/score"]
    ]);
  });

  test("partial detail is a structural diagnostic, not a score-completeness diagnostic", () => {
    const document = clone(asRecord(acceptanceNestedScored));
    const session = asRecord((document["sessions"] as unknown[])[0]);
    (session["results"] as Record<string, unknown>[]).push({
      type: "exercise",
      workoutId: "nested-scored",
      executionPath: [{ nodeId: "root" }, { nodeId: "blocks", iteration: 1 }, { nodeId: "mini-amrap", iteration: 1 }, { nodeId: "nested-pull-up" }],
      exerciseId: "pull-up",
      status: "completed",
      values: { reps: 5 }
    });
    expect(schema.validate("results", 1, document).valid).toBe(true);
    const result = validateResultScores(document, acceptanceScenarioWorkouts);
    expect(diagnostics(result)).toEqual([
      ["container-detail-incomplete", "/sessions/0/results/0/executionPath"],
      ["container-detail-incomplete", "/sessions/0/results/1/executionPath"]
    ]);
  });

  test("finite interval totals and completed intervals stay within the workout contract", () => {
    const document = clone(asRecord(acceptanceNestedScored));
    const session = asRecord((document["sessions"] as unknown[])[0]);
    const outer = asRecord((session["results"] as unknown[])[0]);
    outer["score"] = { type: "intervals", completedIntervals: 3, totalIntervals: 4 };
    expect(schema.validate("results", 1, document).valid).toBe(true);
    const result = validateResultScores(document, acceptanceScenarioWorkouts);
    expect(diagnostics(result)).toEqual([["container-score-bounds-invalid", "/sessions/0/results/0/score"]]);
  });

  test("duplicate container paths are deterministic and non-mutating", () => {
    const document = clone(asRecord(acceptanceNestedScored));
    const session = asRecord((document["sessions"] as unknown[])[0]);
    (session["results"] as unknown[]).push(clone((session["results"] as unknown[])[0]));
    expect(schema.validate("results", 1, document).valid).toBe(true);
    const before = JSON.stringify(document);
    const result = validateResultScores(document, acceptanceScenarioWorkouts);
    expect(diagnostics(result)).toContainEqual(["container-result-duplicate", "/sessions/0/results/3/executionPath"]);
    expect(JSON.stringify(document)).toBe(before);
  });
});

describe("TR-02 and TR-12: persisted omission evidence", () => {
  test("a recorded omission reports every nested scored ancestor with an aggregate", () => {
    const document = clone(asRecord(contextShard));
    const session = asRecord((document["sessions"] as unknown[])[1]);
    const plan = asRecord(session["executionPlan"]);
    const blocks = asRecord((plan["children"] as unknown[])[0]);
    const mini = asRecord((blocks["children"] as unknown[])[0]);
    mini["children"] = (mini["children"] as unknown[]).filter((child) => asRecord(child)["id"] !== "row-1");
    session["results"] = [
      {
        type: "container",
        workoutId: "nested-workout",
        executionPath: [{ nodeId: "root" }, { nodeId: "blocks" }],
        status: "completed",
        score: { type: "intervals", completedIntervals: 1, totalIntervals: 2 }
      },
      {
        type: "container",
        workoutId: "nested-workout",
        executionPath: [{ nodeId: "root" }, { nodeId: "blocks", iteration: 1 }, { nodeId: "mini", }],
        status: "completed",
        score: { type: "rounds_and_reps", completedRounds: 1, additionalReps: 0 }
      },
      {
        type: "exercise",
        workoutId: "nested-workout",
        executionPath: [{ nodeId: "root" }, { nodeId: "blocks", iteration: 1 }, { nodeId: "mini", iteration: 1 }, { nodeId: "row-1" }],
        exerciseId: "row-meter",
        status: "skipped",
        reasonCode: "deprecated"
      },
      {
        type: "exercise",
        workoutId: "nested-workout",
        executionPath: [{ nodeId: "root" }, { nodeId: "blocks", iteration: 1 }, { nodeId: "mini", iteration: 1 }, { nodeId: "squat-1" }],
        exerciseId: "air-squat",
        status: "completed",
        values: { reps: 10 }
      }
    ];
    expect(schema.validate("results", 1, document).valid).toBe(true);
    const result = validateResultScores(document, workouts);
    expect(diagnostics(result)).toEqual([
      ["deprecated-omission-aggregate-forbidden", "/sessions/1/results/0/score"],
      ["deprecated-omission-aggregate-forbidden", "/sessions/1/results/1/score"]
    ]);
  });

  test("an emptied active container with required detail accepts its deprecated container skip", () => {
    const document = clone(asRecord(contextShard));
    const session = asRecord((document["sessions"] as unknown[])[1]);
    const plan = asRecord(session["executionPlan"]);
    const blocks = asRecord((plan["children"] as unknown[])[0]);
    const mini = asRecord((blocks["children"] as unknown[])[0]);
    mini["children"] = [];
    asRecord(mini["resultCapture"])["childDetail"] = "required";
    session["results"] = [{
      type: "container",
      workoutId: "nested-workout",
      executionPath: [{ nodeId: "root" }, { nodeId: "blocks", iteration: 1 }],
      status: "skipped",
      reasonCode: "deprecated"
    }, {
      type: "container",
      workoutId: "nested-workout",
      executionPath: [{ nodeId: "root" }, { nodeId: "blocks", iteration: 1 }, { nodeId: "mini", iteration: 1 }],
      status: "skipped",
      reasonCode: "deprecated"
    }];
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultScores(document, workouts))).toEqual([]);
    expect(diagnostics(validateResultsShard(document, workouts, exercises, "results-2026-09.json"))).toEqual([]);
  });

  test("a non-empty or non-skipped required-detail container is not exempt", () => {
    const document = clone(asRecord(contextShard));
    const session = asRecord((document["sessions"] as unknown[])[1]);
    const plan = asRecord(session["executionPlan"]);
    const blocks = asRecord((plan["children"] as unknown[])[0]);
    const mini = asRecord((blocks["children"] as unknown[])[0]);
    asRecord(mini["resultCapture"])["childDetail"] = "required";
    session["results"] = [{
      type: "container",
      workoutId: "nested-workout",
      executionPath: [{ nodeId: "root" }, { nodeId: "blocks", iteration: 1 }, { nodeId: "mini", iteration: 1 }],
      status: "incomplete",
      reasonCode: "deprecated"
    }];
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultScores(document, workouts))).toEqual([
      ["container-detail-required", "/sessions/1/results/0/executionPath"]
    ]);
  });

  test("terminal current-tree emptiness does not prove a deprecated omission", () => {
    const document = clone(asRecord(acceptanceNestedScored));
    const workoutDocument = clone(asRecord(acceptanceScenarioWorkouts));
    const workout = asRecord((workoutDocument["workouts"] as unknown[])[2]);
    const blocks = asRecord((asRecord(workout["root"])["children"] as unknown[])[0]);
    const mini = asRecord((blocks["children"] as unknown[])[0]);
    mini["children"] = [];
    asRecord(mini["resultCapture"])["childDetail"] = "required";
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultScores(document, workoutDocument))).toEqual([
      ["container-detail-required", "/sessions/0/results/1/executionPath"],
      ["container-detail-required", "/sessions/0/results/2/executionPath"]
    ]);
  });

  test("terminal accepted evidence preserves the nonstandard result, while missing evidence is not inferred", () => {
    expect(schema.validate("results", 1, acceptanceDeprecated).valid).toBe(true);
    expect(schema.validate("results", 1, acceptanceUntouched).valid).toBe(true);
    expect(schema.validate("results", 1, acceptanceLaterAddition).valid).toBe(true);
    expect(validateResultScores(acceptanceDeprecated, acceptanceScenarioWorkouts).valid).toBe(true);
    expect(validateResultScores(acceptanceUntouched, acceptanceScenarioWorkouts).valid).toBe(true);
    expect(validateResultScores(acceptanceLaterAddition, acceptanceScenarioWorkouts).valid).toBe(true);
  });
});

describe("P6 lifecycle and malformed-input gates", () => {
  test("an active session never uses the retained tree when its frozen plan is unreadable", () => {
    const workout = scoredWorkout("active-plan-gate", "complex", { cycles: 1 }, "cycles", [exerciseNode("only", 5)], "required");
    const document = persistedSessionDocument("active-plan-gate", [{
      type: "container",
      workoutId: "active-plan-gate",
      executionPath: [{ nodeId: "root" }, { nodeId: "scored" }],
      status: "incomplete"
    }]);
    const session = asRecord((document["sessions"] as unknown[])[0]);
    session["status"] = "in_progress";
    for (const plan of [undefined, null]) {
      if (plan === undefined) {
        delete session["executionPlan"];
      } else {
        session["executionPlan"] = plan;
      }
      expect(schema.validate("results", 1, document).valid).toBe(false);
      expect(diagnostics(validateResultScores(document, workout))).toEqual([]);
    }
  });

  test("a malformed score does not produce Phase 6 score or detail cascades", () => {
    const workout = scoredWorkout("malformed-score", "complex", { cycles: 1 }, "cycles", [exerciseNode("only", 5)]);
    const document = persistedSessionDocument("malformed-score", [{
      type: "container",
      workoutId: "malformed-score",
      executionPath: [{ nodeId: "root" }, { nodeId: "scored" }],
      status: "completed",
      score: { type: "cycles", completedCycles: "not-a-count" }
    }]);
    expect(schema.validate("results", 1, document).valid).toBe(false);
    expect(diagnostics(validateResultScores(document, workout))).toEqual([]);
  });

  test("a missing schema-required score is gated and recovers when restored", () => {
    const document = clone(asRecord(acceptanceNestedScored));
    const session = asRecord((document["sessions"] as unknown[])[0]);
    const firstResult = asRecord((session["results"] as unknown[])[0]);
    const originalScore = clone(firstResult["score"]);
    delete firstResult["score"];

    expect(schema.validate("results", 1, document).valid).toBe(false);
    expect(diagnostics(validateResultScores(document, acceptanceScenarioWorkouts))).toEqual([]);

    firstResult["score"] = originalScore;
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(validateResultScores(document, acceptanceScenarioWorkouts).valid).toBe(true);
  });

  test("partial nonstandard detail reports incomplete, not absent detail", () => {
    const workout = scoredWorkout("partial-nonstandard", "complex", { cycles: 1 }, "cycles", [
      exerciseNode("first", 5),
      exerciseNode("second", 5)
    ], "required");
    const document = persistedSessionDocument("partial-nonstandard", [{
      type: "container",
      workoutId: "partial-nonstandard",
      executionPath: [{ nodeId: "root" }, { nodeId: "scored" }],
      status: "completed",
      score: { type: "nonstandard" }
    }, persistedExerciseResult("partial-nonstandard", [
      { nodeId: "root" },
      { nodeId: "scored", iteration: 1 },
      { nodeId: "first" }
    ], "first", 5, "completed")]);
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultScores(document, workout))).toEqual([
      ["container-detail-incomplete", "/sessions/0/results/0/executionPath"]
    ]);
  });

  test("a malformed score recovers to normal semantic checks when its shape is repaired", () => {
    const workout = scoredWorkout("score-recovery", "complex", { cycles: 1 }, "cycles", [
      exerciseNode("first", 5),
      exerciseNode("second", 5)
    ]);
    const document = persistedSessionDocument("score-recovery", [{
      type: "container",
      workoutId: "score-recovery",
      executionPath: [{ nodeId: "root" }, { nodeId: "scored" }],
      status: "completed",
      score: { type: "cycles", completedCycles: "not-a-count" }
    }, persistedExerciseResult("score-recovery", [
      { nodeId: "root" },
      { nodeId: "scored", iteration: 1 },
      { nodeId: "first" }
    ], "first", 5, "completed")]);
    expect(schema.validate("results", 1, document).valid).toBe(false);
    expect(validateResultScores(document, workout).valid).toBe(true);
    (asRecord((document["sessions"] as unknown[])[0])["results"] as Record<string, unknown>[])[0]["score"] = {
      type: "cycles",
      completedCycles: 1
    };
    expect(schema.validate("results", 1, document).valid).toBe(true);
    expect(diagnostics(validateResultScores(document, workout))).toEqual([
      ["container-detail-incomplete", "/sessions/0/results/0/executionPath"]
    ]);
  });

  test("direct unstructured shard input fails closed", () => {
    expect(diagnostics(validateResultScores(null, workouts))).toEqual([
      ["results-document-unstructured", ""]
    ]);
  });
});

