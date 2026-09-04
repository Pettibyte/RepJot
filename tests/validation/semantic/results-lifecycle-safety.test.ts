/**
 * Safety, determinism, purity, and phase-boundary tests for result lifecycle validation (P5-T01).
 *
 * These cases prove the properties the binding rules require of a domain module rather than a single
 * contract row: inputs are never mutated; equal inputs yield identical sorted diagnostics carrying only
 * the fixed safe message for their code; hostile input fails closed without throwing; the module imports
 * no Svelte, DOM, OAuth, Drive, or IndexedDB code and ships no ES2020-only syntax; a persisted instant is
 * counted from validated components rather than handed to a date parser; deep trees cannot
 * overflow the iterative walk; and the phase boundary holds — score/omission behavior is isolated in its
 * Phase 6 module and no preferences input exists in the result semantic passes.
 *
 * Authority: docs/implementation/README.md §3 and §4, docs/implementation/GATES.md §2 ("Make sure that
 * domain and validation modules import no Svelte, DOM, OAuth, Drive, or IndexedDB code"),
 * docs/contracts/temporal-and-omission-contracts.md row TR-12, AGENTS.md.
 */
import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";

import { validateResultsShard } from "../../../src/validation/semantic/results";
import { validateShardCorrection } from "../../../src/validation/semantic/result-correction";
import { RESULT_SEMANTIC_MESSAGES } from "../../../src/validation/semantic/result-types";
import type { ResultSemanticResult } from "../../../src/validation/semantic/result-types";
import { validateStaticDocuments } from "../../../src/validation/semantic/index";

import exercises from "../../fixtures/result-semantic/exercises.context.json";
import workouts from "../../fixtures/result-semantic/workouts.context.json";
import contextShard from "../../fixtures/result-semantic/shard.context.json";
import correctionBase from "../../fixtures/result-semantic/shard.correction-base.json";
import correctionCandidate from "../../fixtures/result-semantic/shard.correction-candidate.json";
import preferences from "../../fixtures/contract-acceptance/preferences.min.json";
import staticExercises from "../../fixtures/static-semantic/exercises.context.json";
import staticWorkouts from "../../fixtures/static-semantic/workouts.context.json";

const MODULE_NAMES: readonly string[] = [
  "results.ts",
  "result-types.ts",
  "result-session.ts",
  "result-correction.ts",
  "result-score.ts",
  "workout-index.ts"
];

/** Module specifiers of one source file; every one must stay inside the semantic module. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /from\s+"([^"]+)"/g;
  let match = pattern.exec(source);
  while (match !== null) {
    specifiers.push(match[1]);
    match = pattern.exec(source);
  }
  return specifiers;
}

function readModule(name: string): string {
  const url = new URL("../../../src/validation/semantic/" + name, import.meta.url);
  return readFileSync(url, "utf8");
}

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
function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function assertSafeDiagnostics(result: ResultSemanticResult): void {
  for (const diagnostic of result.diagnostics) {
    expect(typeof diagnostic.code).toBe("string");
    expect(typeof diagnostic.path).toBe("string");
    expect(diagnostic.message).toBe(RESULT_SEMANTIC_MESSAGES[diagnostic.code]);
    // Fixed messages never carry document data: no identifier, note, or measurement from the input.
    expect(diagnostic.message.indexOf("session-")).toBe(-1);
    expect(diagnostic.message.indexOf("squat")).toBe(-1);
  }
}

function assertSorted(result: ResultSemanticResult): void {
  const diagnostics = result.diagnostics;
  for (let i = 1; i < diagnostics.length; i += 1) {
    const prev = diagnostics[i - 1];
    const cur = diagnostics[i];
    const order = prev.code === cur.code ? prev.path <= cur.path : prev.code < cur.code;
    expect(order).toBe(true);
  }
}

describe("input immutability", () => {
  test("deep-frozen shard and static documents validate without mutation", () => {
    const shard = deepFreeze(clone(contextShard));
    const workoutDocument = deepFreeze(clone(workouts));
    const exerciseDocument = deepFreeze(clone(exercises));
    const before = JSON.stringify(shard) + JSON.stringify(workoutDocument) + JSON.stringify(exerciseDocument);
    const result = validateResultsShard(shard, workoutDocument, exerciseDocument, "results-2026-09.json");
    expect(result.valid).toBe(true);
    expect(JSON.stringify(shard) + JSON.stringify(workoutDocument) + JSON.stringify(exerciseDocument)).toBe(before);
  });

  test("deep-frozen correction inputs are never mutated", () => {
    const base = deepFreeze(clone(correctionBase));
    const candidate = deepFreeze(clone(correctionCandidate));
    const before = JSON.stringify(base) + JSON.stringify(candidate);
    expect(validateShardCorrection(base, candidate).valid).toBe(true);
    expect(JSON.stringify(base) + JSON.stringify(candidate)).toBe(before);
  });
});

describe("determinism and safe output", () => {
  test("repeated validation of equal inputs returns identical sorted diagnostics", () => {
    const document = clone(contextShard);
    asRecord(asRecord(document)["sessions"])[0]["startedAtUtc"] = "2026-07-04T10:00:00Z";
    const a = validateResultsShard(document, workouts, exercises, "results-2026-09.json");
    const b = validateResultsShard(document, workouts, exercises, "results-2026-09.json");
    expect(a.valid).toBe(false);
    expect(a).toEqual(b);
    assertSorted(a);
    assertSafeDiagnostics(a);
  });

  test("repeated correction validation returns identical diagnostics", () => {
    const candidate = clone(correctionCandidate);
    asRecord(asRecord(candidate)["sessions"])[0]["startedAtUtc"] = "2026-08-19T14:00:00Z";
    const a = validateShardCorrection(correctionBase, candidate);
    const b = validateShardCorrection(correctionBase, candidate);
    expect(a).toEqual(b);
    assertSorted(a);
    assertSafeDiagnostics(a);
  });
});

describe("hostile input fails closed", () => {
  const hostile: Array<[string, unknown]> = [
    ["null document", null],
    ["string document", "not a document"],
    ["array document", [1, 2, 3]],
    ["empty object", {}],
    ["preferences document", { format: "repjot/preferences", schemaVersion: 1 }],
    ["non-array collections", { yearMonthUtc: "2026-09", sessions: "none", sessionTombstones: [] }],
    ["missing tombstones", { yearMonthUtc: "2026-09", sessions: [] }]
  ];

  for (const [label, input] of hostile) {
    test(label + " is rejected as unstructured without throwing", () => {
      const result = validateResultsShard(input, workouts, exercises, "results-2026-09.json");
      expect(result.valid).toBe(false);
      expect(result.diagnostics.length).toBe(1);
      expect(result.diagnostics[0].code).toBe("results-document-unstructured");
      expect(result.diagnostics[0].path).toBe("");
      assertSafeDiagnostics(result);
    });
  }

  test("hostile static directories disable references instead of throwing", () => {
    const result = validateResultsShard(contextShard, [1, 2], "nope", "results-2026-09.json");
    expect(result.valid).toBe(true);
  });

  test("garbage session and result entries do not throw", () => {
    const document = clone(contextShard);
    const sessions = asRecord(document)["sessions"] as unknown[];
    sessions.push(null, "text", 7, {}, { id: 5, results: "nope" });
    const result = validateResultsShard(document, workouts, exercises, "results-2026-09.json");
    expect(typeof result.valid).toBe("boolean");
    assertSafeDiagnostics(result);
    assertSorted(result);
  });
});

describe("module purity (binding rules and GATES §2)", () => {
  for (const name of MODULE_NAMES) {
    test(name + " imports only inside the semantic module", () => {
      const source = readModule(name);
      for (const specifier of importSpecifiers(source)) {
        expect(specifier.indexOf("./") === 0).toBe(true);
      }
    });

    test(name + " ships no optional chaining or nullish coalescing", () => {
      const source = readModule(name);
      expect(/\?\./.test(source)).toBe(false);
      expect(/\?\?/.test(source)).toBe(false);
    });

    test(name + " reads no browser, storage, or transport surface", () => {
      const source = readModule(name);
      expect(/from\s+"(svelte|node:|@sveltejs|ajv)/.test(source)).toBe(false);
      expect(/globalThis|localStorage|indexedDB|IDBDatabase|fetch\(|XMLHttpRequest|navigator|window\./.test(source)).toBe(
        false
      );
    });
  }

  test("the correction pass counts its instants instead of handing them to a date parser", () => {
    // The lenient half of a date parser is the defect this guard keeps out: it reads `2026-02-30T00:00:00Z`
    // and `2026-08-20T24:00:00Z` as instants in March and in the next day, so a save could prove a
    // `updatedAtUtc` advancement from a timestamp the schema layer rejects (spec §8 invariant 26, FF-12). The
    // module validates the canonical text and counts the instant from its own validated components, so it has
    // no date-parser call to make.
    expect(/Date\.parse|Date\.UTC|Date\.now|new Date\(/.test(readModule("result-correction.ts"))).toBe(false);
  });
});

describe("Phase 5 boundary and Phase 6 ownership", () => {
  test("score and omission diagnostics are owned by the Phase 6 score module", () => {
    const source = readModule("result-score.ts");
    expect(/container-score/.test(source)).toBe(true);
    expect(/deprecated-omission/.test(source)).toBe(true);
    expect(importSpecifiers(readModule("result-correction.ts")).indexOf("./result-score")).toBe(-1);
  });

  test("the result pass reads no preferences document", () => {
    // A preferences document supplied by mistake is not a static directory: resolution is disabled and
    // no preference rule (PF rows, Phase 38 and Phase 76) is consulted.
    const result = validateResultsShard(contextShard, workouts, preferences, "results-2026-09.json");
    expect(result.valid).toBe(true);
  });

  test("the static pass still takes exactly the two static documents (EX-12 unchanged)", () => {
    expect(validateStaticDocuments.length).toBe(2);
    expect(validateStaticDocuments(staticExercises, staticWorkouts).valid).toBe(true);
  });
});

describe("deep structures are walked iteratively", () => {
  test("a 2000-deep retained tree resolves a 2002-segment execution path", () => {
    // Iterative walking is required: the browser targets have a small stack (AGENTS.md, Kindle support).
    const deepWorkouts = clone(asRecord(workouts));
    const list = deepWorkouts["workouts"] as Record<string, unknown>[];
    // A fourth workout keeps the other sessions' own trees resolvable.
    list.push({
      id: "deep-workout",
      name: "Deep Workout",
      root: { id: "root", type: "container", strategy: "sequence", strategyConfig: {}, children: [] }
    });
    let inner: Record<string, unknown> = {
      id: "deep-leaf",
      type: "exercise",
      exerciseId: "air-squat",
      stimulus: "conditioning",
      prescription: { reps: 10 }
    };
    for (let depth = 0; depth < 2000; depth += 1) {
      inner = {
        id: "deep-" + depth,
        type: "container",
        strategy: "sequence",
        strategyConfig: {},
        children: [inner]
      };
    }
    const deepRoot = asRecord(list[list.length - 1]["root"]);
    deepRoot["children"] = [inner];

    const path: Record<string, unknown>[] = [{ nodeId: "root" }];
    for (let depth = 1999; depth >= 0; depth -= 1) {
      path.push({ nodeId: "deep-" + depth });
    }
    path.push({ nodeId: "deep-leaf" });

    const shard = clone(asRecord(contextShard));
    const sessions = shard["sessions"] as Record<string, unknown>[];
    const session = sessions[0];
    session["workoutId"] = "deep-workout";
    session["results"] = [
      {
        type: "exercise",
        workoutId: "deep-workout",
        executionPath: path,
        exerciseId: "air-squat",
        status: "completed",
        values: { reps: 10 }
      }
    ];

    const result = validateResultsShard(shard, deepWorkouts, exercises, "results-2026-09.json");
    expect(result.valid).toBe(true);
  });

  test("a 2000-deep frozen plan is walked without a stack limit", () => {
    // The frozen-plan identity walk is a second traversal of the same tree shape, so it walks iteratively too.
    const deepWorkouts = clone(asRecord(workouts));
    const list = deepWorkouts["workouts"] as Record<string, unknown>[];
    const deepRoot: Record<string, unknown> = {
      id: "root",
      type: "container",
      strategy: "sequence",
      strategyConfig: {},
      children: []
    };
    list.push({ id: "deep-workout", name: "Deep Workout", root: deepRoot });
    let inner: Record<string, unknown> = {
      id: "deep-leaf",
      type: "exercise",
      exerciseId: "air-squat",
      stimulus: "conditioning",
      prescription: { reps: 10 }
    };
    for (let depth = 0; depth < 2000; depth += 1) {
      inner = {
        id: "deep-" + depth,
        type: "container",
        strategy: "sequence",
        strategyConfig: {},
        children: [inner]
      };
    }
    (deepRoot["children"] as unknown[]).push(inner);

    const shard = clone(asRecord(contextShard));
    const session = asRecord((shard["sessions"] as Record<string, unknown>[])[0]);
    session["status"] = "in_progress";
    delete session["endedAtUtc"];
    session["workoutId"] = "deep-workout";
    session["results"] = [];
    // The plan is the workout root's copy, which is the state a real session start writes, so the identity
    // walk descends every level of it.
    session["executionPlan"] = clone(deepRoot);
    expect(validateResultsShard(shard, deepWorkouts, exercises, "results-2026-09.json").valid).toBe(true);

    // One fabricated level is one finding: the resolved chain below it adds no second finding.
    const plan = clone(deepRoot);
    session["executionPlan"] = plan;
    let node = plan;
    for (let depth = 0; depth < 1000; depth += 1) {
      node = asRecord((node["children"] as Record<string, unknown>[])[0]);
    }
    node["id"] = "copied-deep-node";
    const result = validateResultsShard(shard, deepWorkouts, exercises, "results-2026-09.json");
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0].code).toBe("session-plan-node-unresolved");
  });

  test("a deeply nested strategy configuration is never walked, so it throws nothing and reports nothing", () => {
    // No comparison reads `strategyConfig` (TR-04: a valid later correction of those retained values leaves an
    // active plan valid, and WK-04 gives each shape to the schema), so this pass performs no walk over those
    // bytes at all. Deep nesting on both sides therefore yields neither a stack overflow nor a finding, whatever
    // the two configurations hold, while the strategy name of the same node keeps its own finding.
    function deepConfig(depth: number, rounds: number): Record<string, unknown> {
      let value: Record<string, unknown> = { rounds: rounds };
      for (let i = 0; i < depth; i += 1) {
        value = { child: value };
      }
      return value;
    }
    const deepWorkouts = clone(asRecord(workouts));
    const list = deepWorkouts["workouts"] as Record<string, unknown>[];
    const deepRoot: Record<string, unknown> = {
      id: "root",
      type: "container",
      strategy: "sequence",
      strategyConfig: deepConfig(2000, 1),
      children: []
    };
    list.push({ id: "deep-workout", name: "Deep Workout", root: deepRoot });
    // A 2000-deep node chain under that root, so the plan walk descends every level of the tree, beside the
    // 2000-deep configuration on the root itself, which a configuration walk would have to descend as deeply.
    let inner: Record<string, unknown> = {
      id: "deep-leaf",
      type: "exercise",
      exerciseId: "air-squat",
      stimulus: "conditioning",
      prescription: { reps: 10 }
    };
    for (let depth = 0; depth < 2000; depth += 1) {
      inner = {
        id: "deep-" + depth,
        type: "container",
        strategy: "sequence",
        strategyConfig: {},
        children: [inner]
      };
    }
    (deepRoot["children"] as unknown[]).push(inner);

    const shard = clone(asRecord(contextShard));
    const session = asRecord((shard["sessions"] as Record<string, unknown>[])[0]);
    session["status"] = "in_progress";
    delete session["endedAtUtc"];
    session["workoutId"] = "deep-workout";
    session["results"] = [];

    // The plan carries the same configuration the retained root carries, at all 2001 levels.
    session["executionPlan"] = clone(deepRoot);
    expect(validateResultsShard(shard, deepWorkouts, exercises, "results-2026-09.json").valid).toBe(true);

    // One leaf differs at the bottom of the nesting, and the whole configuration differs from the retained one:
    // the pass reads no value here, so it reports nothing and walks nothing (TR-04).
    const plan = clone(deepRoot);
    session["executionPlan"] = plan;
    plan["strategyConfig"] = deepConfig(2000, 2);
    expect(validateResultsShard(shard, deepWorkouts, exercises, "results-2026-09.json").valid).toBe(true);

    // The strategy name of the same plan is still compared at the same depth, which is the fact the shape list
    // preserves: one changed name, at one of 2001 levels, is one finding.
    let node = plan;
    for (let depth = 0; depth < 1000; depth += 1) {
      node = asRecord((node["children"] as Record<string, unknown>[])[0]);
    }
    node["strategy"] = "amrap";
    const result = validateResultsShard(shard, deepWorkouts, exercises, "results-2026-09.json");
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0].code).toBe("session-plan-strategy-mismatch");
  });

  test("a session with 5000 distinct results validates without a stack limit", () => {
    const shard = clone(asRecord(contextShard));
    const sessions = shard["sessions"] as Record<string, unknown>[];
    const results: Record<string, unknown>[] = [];
    for (let i = 0; i < 5000; i += 1) {
      results.push({
        type: "exercise",
        workoutId: "squat-day",
        executionPath: [{ nodeId: "root" }, { nodeId: "squat-sets", iteration: 1 }, { nodeId: "set-1" }],
        exerciseId: "back-squat",
        attempt: i + 1,
        status: "completed",
        values: { reps: 5, weight: { value: 100, unit: "kg" } }
      });
    }
    sessions[0]["results"] = results;
    expect(validateResultsShard(shard, workouts, exercises, "results-2026-09.json").valid).toBe(true);
  });

  test("an untouched sibling read through a 2000-deep session needs no stack and mutates nothing", () => {
    // The sibling half of Req 11.21 reads a whole session before it calls that session unchanged, so the
    // same-value read is the walk this rule rests on and it walks iteratively like every other walk here
    // (AGENTS.md, Kindle support). Both sides are frozen and the deep session is identical on both, so the one
    // finding is the moved last-correction time and no write to either input is possible.
    const base = clone(asRecord(correctionBase));
    let inner: Record<string, unknown> = {
      id: "deep-leaf",
      type: "exercise",
      exerciseId: "air-squat",
      stimulus: "conditioning",
      prescription: { reps: 10 }
    };
    for (let depth = 0; depth < 2000; depth += 1) {
      inner = {
        id: "deep-" + depth,
        type: "container",
        strategy: "sequence",
        strategyConfig: {},
        children: [inner]
      };
    }
    // The in-progress sibling keeps a plan of the shape a real session start writes, only 2001 levels deep.
    const sessions = base["sessions"] as Record<string, unknown>[];
    sessions[1]["executionPlan"] = {
      id: "root",
      type: "container",
      strategy: "sequence",
      strategyConfig: {},
      children: [inner]
    };
    const candidate = clone(base);
    // One write anywhere in the pair: the untouched sibling's last-correction time, one second after its own.
    asRecord((candidate["sessions"] as Record<string, unknown>[])[1])["updatedAtUtc"] = "2026-08-21T05:05:01Z";
    const frozenBase = deepFreeze(base);
    const frozenCandidate = deepFreeze(candidate);
    const result = validateShardCorrection(frozenBase, frozenCandidate);
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0].code).toBe("session-updated-at-changed-without-correction");
    expect(result.diagnostics[0].path).toBe("/sessions/1/updatedAtUtc");
  });
});
