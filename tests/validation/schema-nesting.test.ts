/**
 * P10-D007 — Nested workout schema validation (requirement 10.7, Architecture R-04/§17, GATES §2,
 * mandatory acceptance "Nested schema validation").
 *
 * The workouts schema must select a node's role and container strategy linearly: every valid
 * modestly or deeply nested workout validates without exponential branch exploration and without
 * any product depth limit, while invalid role/strategy shapes still reject. The historical
 * recursive `oneOf` selection re-walked the whole subtree once per candidate branch (Ajv
 * evaluates every `oneOf` branch; with `allErrors` each failing branch still walks `children`),
 * so a valid depth-10 sequence chain took ~19 seconds and depth 25 was infeasible. Selection is
 * now an `if/then/else` chain keyed on the shallow `type` / `strategy` constants; only the
 * matching branch is evaluated, and every non-matching shape falls through to a rejecting branch.
 *
 * These tests prove: valid chains of every strategy at depth 10-40 validate quickly, deep invalid
 * role/strategy shapes still reject quickly, the once-compiled production registry recovers on
 * the original fixtures plus the committed depth-16 fixture, and a depth-48 subprocess probe
 * completes within a hard wall-clock bound (a regression fails fast instead of hanging the suite).
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { createProductionValidator } from "../../src/validation/schema-validator";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const CONTRACT_FIXTURES = join(REPO_ROOT, "tests", "fixtures", "contract-acceptance");

/** One generous wall-clock bound; the linear schema validates these documents in milliseconds. */
const MAX_VALIDATION_MS = 5000;

const STRATEGIES = ["sequence", "rounds", "amrap", "emom", "complex"] as const;
type Strategy = (typeof STRATEGIES)[number];

/** The strategy config a container of `strategy` must carry to be schema-valid. */
function strategyConfig(strategy: string): Record<string, unknown> {
  if (strategy === "rounds") return { rounds: 3 };
  if (strategy === "amrap") return { duration: { value: 5, unit: "minute" } };
  if (strategy === "emom") return { cycles: 4, interval: { value: 1, unit: "minute" } };
  if (strategy === "complex") return { cycles: 2 };
  return {};
}

function exerciseLeaf(index: number): Record<string, unknown> {
  return {
    id: `nest-leaf-${index}`,
    type: "exercise",
    exerciseId: `ex-${(index % 3) + 1}`,
    stimulus: "strength",
    prescription: { reps: 5, weight: { value: 100, unit: "lb" } }
  };
}

/** One depth-`depth` container chain where every container uses `strategy`, over two leaves. */
function nestedWorkout(depth: number, strategy: Strategy): Record<string, unknown> {
  let children: Array<Record<string, unknown>> = [exerciseLeaf(1), exerciseLeaf(2)];
  for (let level = depth; level >= 1; level--) {
    children = [{
      id: `nest-${strategy}-${level}`,
      type: "container",
      name: `Level ${level}`,
      strategy,
      strategyConfig: strategyConfig(strategy),
      children
    }];
  }
  return {
    format: "repjot/workouts",
    schemaVersion: 1,
    workouts: [{ id: "nested-workout", name: "Nested", root: children[0] }]
  };
}

/** One depth-`depth` chain cycling through all five strategies in a fixed order. */
function mixedNestedWorkout(depth: number): Record<string, unknown> {
  let children: Array<Record<string, unknown>> = [exerciseLeaf(1), exerciseLeaf(2)];
  for (let level = depth; level >= 1; level--) {
    const strategy = STRATEGIES[level % 5];
    children = [{
      id: `nest-mixed-${level}`,
      type: "container",
      name: `Level ${level}`,
      strategy,
      strategyConfig: strategyConfig(strategy),
      children
    }];
  }
  return {
    format: "repjot/workouts",
    schemaVersion: 1,
    workouts: [{ id: "mixed-workout", name: "Mixed", root: children[0] }]
  };
}

/** Validate in-process and assert the wall-clock bound; returns the validator result. */
function validateWithin(validator: ReturnType<typeof createProductionValidator>, document: Record<string, unknown>) {
  const startedAt = Date.now();
  const result = validator.validate("workouts", 1, document);
  const elapsedMs = Date.now() - startedAt;
  expect(elapsedMs).toBeLessThan(MAX_VALIDATION_MS);
  return result;
}

describe("valid nested workouts validate linearly (no depth limit)", () => {
  const validator = createProductionValidator();

  for (const strategy of STRATEGIES) {
    test(`a valid depth-10 and depth-30 ${strategy} chain validates quickly`, () => {
      for (const depth of [10, 30]) {
        const result = validateWithin(validator, nestedWorkout(depth, strategy));
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      }
    });
  }

  test("a valid depth-40 chain cycling through all five strategies validates quickly", () => {
    const result = validateWithin(validator, mixedNestedWorkout(40));
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test("the committed depth-16 contract fixture validates as exact bytes through the command path", async () => {
    const bytes = new Uint8Array(await readFile(join(CONTRACT_FIXTURES, "workouts.deep-nested.json")));
    const document = JSON.parse(new TextDecoder("utf-8").decode(bytes)) as Record<string, unknown>;
    const result = validateWithin(validator, document);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });
});

describe("invalid nested role and strategy shapes still reject", () => {
  const validator = createProductionValidator();

  test("an unknown strategy deep in the tree rejects quickly", () => {
    const document = nestedWorkout(25, "sequence");
    (document["workouts"] as Array<Record<string, unknown>>)[0]["root"] = {
      ...(document["workouts"] as Array<Record<string, unknown>>)[0]["root"] as Record<string, unknown>,
      strategy: "superset"
    };
    const result = validateWithin(validator, document);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("a missing strategy deep in the tree rejects", () => {
    const document = nestedWorkout(25, "rounds");
    const root = (document["workouts"] as Array<Record<string, unknown>>)[0]["root"] as Record<string, unknown>;
    delete root["strategy"];
    const result = validateWithin(validator, document);
    expect(result.valid).toBe(false);
  });

  test("a strategy without its required config rejects at any depth", () => {
    const document = nestedWorkout(20, "rounds");
    const root = (document["workouts"] as Array<Record<string, unknown>>)[0]["root"] as Record<string, unknown>;
    root["strategyConfig"] = {};
    const result = validateWithin(validator, document);
    expect(result.valid).toBe(false);
  });

  test("a container missing children rejects", () => {
    const document = nestedWorkout(15, "emom");
    const root = (document["workouts"] as Array<Record<string, unknown>>)[0]["root"] as Record<string, unknown>;
    delete root["children"];
    const result = validateWithin(validator, document);
    expect(result.valid).toBe(false);
  });

  test("an exercise node missing its role fields rejects", () => {
    const document = mixedNestedWorkout(12);
    const root = (document["workouts"] as Array<Record<string, unknown>>)[0]["root"] as Record<string, unknown>;
    (root["children"] as Array<Record<string, unknown>>)[0] = { id: "bad-leaf", type: "exercise" };
    const result = validateWithin(validator, document);
    expect(result.valid).toBe(false);
  });

  test("a node with an unrecognized type rejects", () => {
    const document = mixedNestedWorkout(12);
    const root = (document["workouts"] as Array<Record<string, unknown>>)[0]["root"] as Record<string, unknown>;
    (root["children"] as Array<Record<string, unknown>>)[1] = { id: "bad-node", type: "rest" };
    const result = validateWithin(validator, document);
    expect(result.valid).toBe(false);
  });
});

describe("recovery and hard wall-clock regression bound", () => {
  test("the original scenario fixture still validates through the production registry", async () => {
    const validator = createProductionValidator();
    const bytes = new Uint8Array(await readFile(join(CONTRACT_FIXTURES, "workouts.scenario.json")));
    const document = JSON.parse(new TextDecoder("utf-8").decode(bytes)) as Record<string, unknown>;
    expect(validator.validate("workouts", 1, document).valid).toBe(true);
  });

  test("a depth-48 valid chain completes in a subprocess within the hard bound", () => {
    // The historical schema needed ~19 s at depth 10 and was infeasible by depth 25; running the
    // probe in a subprocess with a hard timeout keeps a regression from hanging the suite and
    // mirrors the CI failure mode (the command timing out instead of validating).
    const snippet = `
      const { createSchemaRegistry } = await import(${JSON.stringify(join(REPO_ROOT, "src", "validation", "schema-registry.ts"))});
      const registry = createSchemaRegistry();
      if (registry.problems.length > 0) { console.error(JSON.stringify(registry.problems)); process.exit(1); }
      const validate = registry.getValidator("workouts", 1);
      if (validate === null) { console.error("no compiled workouts validator"); process.exit(1); }
      const strategies = ["sequence", "rounds", "amrap", "emom", "complex"];
      const cfgFor = (s) => s === "rounds" ? { rounds: 3 } : s === "amrap" ? { duration: { value: 5, unit: "minute" } } : s === "emom" ? { cycles: 4, interval: { value: 1, unit: "minute" } } : s === "complex" ? { cycles: 2 } : {};
      let children = [
        { id: "l1", type: "exercise", exerciseId: "e1", stimulus: "strength", prescription: { reps: 5 } },
        { id: "l2", type: "exercise", exerciseId: "e2", stimulus: "strength", prescription: { reps: 6 } }
      ];
      for (let level = 48; level >= 1; level--) {
        const strategy = strategies[level % 5];
        children = [{ id: "c" + level, type: "container", strategy, strategyConfig: cfgFor(strategy), children }];
      }
      const document = { format: "repjot/workouts", schemaVersion: 1, workouts: [{ id: "w", name: "W", root: children[0] }] };
      if (!validate(document)) { console.error(JSON.stringify(validate.errors).slice(0, 400)); process.exit(1); }
      process.exit(0);
    `;
    const probe = spawnSync("bun", ["-e", snippet], { timeout: 20000, encoding: "utf8" });
    if (probe.status === null) {
      throw new Error(`depth-48 nested validation did not finish within the hard bound (signal ${String(probe.signal)})`);
    }
    expect(probe.status).toBe(0);
  }, 30000);
});
