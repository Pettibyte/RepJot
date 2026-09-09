/**
 * Tests for the sequential family migration registries (P14-T01).
 *
 * Authority for every expectation below, written by hand from the sources rather than read back from the
 * modules under test:
 * - specs/schema-versioning.md §Migration chains ("Maintain one current-version constant, schema set, and
 *   migration registry for each family", "A migration registered for version 2 accepts only version 2 and
 *   produces version 3", "Do not create a matrix of direct conversions to the current version", and the
 *   eight "Every migration must" bullets), §Read and migration policy, §Result migrations and references,
 *   §Versioned schemas, §Version handling (the five-row table), §Tests ("Source objects remain
 *   unchanged."), §Failure and recovery.
 * - docs/contracts/families-and-files.md FF-07 (with its negative case "One family's version selecting
 *   another family's migration"), FF-08, FF-09 (negative case `0, -1, 1.5, "1" rejected with distinct
 *   errors`), FF-10 (positive case "Current version validates without migration"), FF-15, FF-16, FF-18,
 *   FF-19, FF-20.
 * - docs/ARCHITECTURE.md §7 row `src/migrations/migration-registry.ts`, §8 ("Provenance includes source
 *   family, source schema version, current schema version, validation version, and migration path"), §12
 *   row "Ordered migration" and its purity line.
 * - docs/implementation/phase-14.md task P14-T01: steps "Detect gaps, duplicate steps, wrong outputs,
 *   unsupported-old inputs, and future inputs", edge cases "A current v1 input uses zero transitions.
 *   Version 0 is malformed, not legacy. Do not add a no-op `v0 -> v1` migration", tests or fixtures "Use
 *   synthetic test-only registries to exercise multi-step sequencing and registry failures", acceptance
 *   "Production registries contain no invented migration. Synthetic chains prove strict N-to-N+1 behavior".
 * - docs/implementation/GATES.md §3 rows "Ordered migration | Unit | Zero-step current, synthetic
 *   multi-step, gap, wrong next version" and "Immutability | Unit | Frozen object, byte snapshot, repeated
 *   load", plus its checks on purity, import direction, and invented migrations.
 *
 * Production ships zero migration steps, so every multi-version case below runs on a registry this file
 * constructs and names synthetic: `syntheticRegistry` and `syntheticStep`. No case pretends to be a
 * released document, no case claims a historical production version exists, and no case needs a Drive read,
 * a prior-release byte, a Kindle result, or an approved historical schema
 * (docs/implementation/GATES.md §External and manual gates). Every synthetic registry still goes through
 * the one production builder, so no passing case can be produced by a test-only implementation.
 *
 * The static rows at the end scan the migration modules' own text, because "no second validator, no
 * invented step, no `v0` constant, no forbidden import, nothing newer than ES2019" is not observable from a
 * call. Each of them sits next to the call that shows the matching behaviour, so a scan supplements
 * evidence the parent also reads in the diff and is never the only evidence for a behaviour.
 */
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import { CURRENT_VERSION, SUPPORT_FLOOR_VERSION } from "../src/domain/families";
import type { DocumentFamily } from "../src/domain/families";
import { acceptedVersionRange, createFamilyMigrationRegistry } from "../src/migrations/migration-registry";
import type {
  FamilyMigrationRegistry,
  FamilyMigrationResult,
  FamilyMigrationStep,
  FamilyMigrationStepInput,
  FamilyMigrationStepResult,
  FamilyRegistryBuild
} from "../src/migrations/migration-registry";
import { EXERCISES_MIGRATION_REGISTRY_BUILD, EXERCISES_MIGRATION_STEPS } from "../src/migrations/families/exercises";
import { WORKOUTS_MIGRATION_REGISTRY_BUILD, WORKOUTS_MIGRATION_STEPS } from "../src/migrations/families/workouts";
import {
  PREFERENCES_MIGRATION_REGISTRY_BUILD,
  PREFERENCES_MIGRATION_STEPS
} from "../src/migrations/families/preferences";
import { RESULTS_MIGRATION_REGISTRY_BUILD, RESULTS_MIGRATION_STEPS } from "../src/migrations/families/results";
// Test-only cross-checks. src/migrations/** imports neither module, which group 9 proves by scanning its
// own text; this file runs under Bun, where the schema registry's `node:` imports are legal.
import { SUPPORTED_SCHEMA_IDENTITIES } from "../src/validation/schema-registry";
import type { MigrationPath, MigrationStepId } from "../src/documents/pipeline-types";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** The four families, in the order the accepted constants list them. */
const FAMILIES: readonly DocumentFamily[] = ["exercises", "workouts", "preferences", "results"];

/** The fields a default synthetic producer copies forward. */
const COPY_KEYS: readonly string[] = ["format", "yearMonthUtc", "sessions", "sessionTombstones"];

/** One plain-object view of any value, for reading fields the types call `unknown`. */
function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  return value as Record<string, unknown>;
}

/** Deep-freeze any value, so a write by the code under test becomes a visible throw. */
function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null) {
    return value;
  }
  Object.freeze(value);
  const keys = Object.getOwnPropertyNames(value);
  for (let index = 0; index < keys.length; index += 1) {
    const child: unknown = (value as Record<string, unknown>)[keys[index]];
    if (typeof child === "object" && child !== null && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}

/** One frozen, nested, results-shaped probe document. Only field names, never a released document. */
function probeDocument(schemaVersion: unknown): Record<string, unknown> {
  return deepFreeze({
    format: "repjot/results",
    schemaVersion: schemaVersion,
    yearMonthUtc: "2026-09",
    sessions: [
      {
        id: "session-probe",
        workoutId: "workout-probe",
        startedAtUtc: "2026-09-01T06:30:00Z",
        results: [{ exerciseId: "exercise-probe", executionPath: [1, 4], load: { value: 82.5, unit: "kg" } }]
      }
    ],
    sessionTombstones: []
  });
}

/** A document whose declared version lives only on the prototype chain. */
function inheritedVersionDocument(schemaVersion: number): unknown {
  return Object.create({ schemaVersion: schemaVersion });
}

/** What one synthetic step recorded about one invocation. */
interface StepCall {
  readonly stepId: string;
  readonly schemaVersion: number;
  readonly inputDocument: unknown;
  readonly producedDocument: unknown;
  readonly context: unknown;
  readonly contextWasOwn: boolean;
}

/** The `trail` field a default synthetic producer carries forward. */
function trailOf(document: unknown): unknown[] {
  const raw = asRecord(document)["trail"];
  return Array.isArray(raw) ? raw.slice() : [];
}

/** The default synthetic step body: a new object, the next version, an appended trail entry. */
function defaultProduce(
  input: FamilyMigrationStepInput,
  stepId: string,
  toVersion: number
): FamilyMigrationStepResult {
  const source = asRecord(input.document);
  const produced: Record<string, unknown> = {};
  for (let index = 0; index < COPY_KEYS.length; index += 1) {
    const key = COPY_KEYS[index];
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      produced[key] = source[key];
    }
  }
  produced["schemaVersion"] = toVersion;
  produced["trail"] = trailOf(input.document).concat([stepId]);
  return { status: "migrated", document: produced };
}

/**
 * One synthetic migration step. `to` defaults to the sequential value; a case that needs a step declaring
 * another pair passes one, and the builder is what refuses it. Every invocation is recorded, so "the step
 * was never invoked for another version" is an observed fact rather than an absence of evidence.
 */
function syntheticStep(options: {
  readonly id: string;
  readonly from: number;
  readonly to?: number;
  readonly calls: StepCall[];
  readonly produce?: (input: FamilyMigrationStepInput, toVersion: number) => FamilyMigrationStepResult;
}): FamilyMigrationStep {
  const toVersion = options.to === undefined ? options.from + 1 : options.to;
  return {
    id: options.id,
    fromSchemaVersion: options.from,
    toSchemaVersion: toVersion,
    migrate: (input: FamilyMigrationStepInput): FamilyMigrationStepResult => {
      const result =
        options.produce === undefined ? defaultProduce(input, options.id, toVersion) : options.produce(input, toVersion);
      // Read defensively: a row that returns something other than a step result must reach the registry
      // unchanged, so the recorder cannot be the thing that raises.
      const produced = typeof result === "object" && result !== null ? asRecord(result)["document"] : null;
      options.calls.push({
        stepId: options.id,
        schemaVersion: input.schemaVersion,
        inputDocument: input.document,
        producedDocument: produced,
        context: input.context,
        contextWasOwn: Object.prototype.hasOwnProperty.call(input, "context")
      });
      return result;
    }
  };
}

/** A chain of default synthetic steps from `[id, version]` pairs. */
function syntheticSteps(calls: StepCall[], chain: readonly (readonly [string, number])[]): FamilyMigrationStep[] {
  const steps: FamilyMigrationStep[] = [];
  for (let index = 0; index < chain.length; index += 1) {
    steps.push(syntheticStep({ id: chain[index][0], from: chain[index][1], calls: calls }));
  }
  return steps;
}

/**
 * One synthetic registry, built by the one production builder. The bounds are arguments here because the
 * accepted constants cannot express a family whose current version sits above its floor, which is what
 * every multi-step case needs (docs/implementation/phase-14.md "Use synthetic test-only registries to
 * exercise multi-step sequencing and registry failures").
 */
function syntheticRegistry(input: {
  readonly family: DocumentFamily;
  readonly floor: number;
  readonly current: number;
  readonly steps: readonly FamilyMigrationStep[];
}): FamilyMigrationRegistry {
  const built = createFamilyMigrationRegistry({
    family: input.family,
    range: { supportFloorSchemaVersion: input.floor, currentSchemaVersion: input.current },
    steps: input.steps
  });
  if (built.status !== "created") {
    throw new Error("synthetic registry was refused: " + built.failure.reason);
  }
  return built.registry;
}

/** Unwrap one production registry build, or fail with its reason. */
function createdRegistry(build: FamilyRegistryBuild): FamilyMigrationRegistry {
  if (build.status !== "created") {
    throw new Error("production registry build was refused: " + build.failure.reason);
  }
  return build.registry;
}

/** One migration call, with an explicit context every case supplies. */
function migrate(registry: FamilyMigrationRegistry, document: unknown, context: unknown): FamilyMigrationResult {
  return registry.migrate({ document: document, context: context });
}

/** The failure reason of a rejected result, or the word `migrated` for a success. */
function outcomeLabel(result: FamilyMigrationResult): string {
  return result.status === "failed" ? result.failure.reason : "migrated";
}

/** The four production builds, one per family, in the accepted family order. */
const PRODUCTION_BUILDS: readonly (readonly [DocumentFamily, FamilyRegistryBuild])[] = [
  ["exercises", EXERCISES_MIGRATION_REGISTRY_BUILD],
  ["workouts", WORKOUTS_MIGRATION_REGISTRY_BUILD],
  ["preferences", PREFERENCES_MIGRATION_REGISTRY_BUILD],
  ["results", RESULTS_MIGRATION_REGISTRY_BUILD]
];

// ---------------------------------------------------------------------------
// Group 1: one registry per family, with only that family's own facts (R-01)
// ---------------------------------------------------------------------------

describe("family registries: one per family, with that family's own version facts", () => {
  test("the four families have exactly four builds, and no fifth family exists", () => {
    const fromBuilds: string[] = [];
    for (let index = 0; index < PRODUCTION_BUILDS.length; index += 1) {
      fromBuilds.push(PRODUCTION_BUILDS[index][0]);
    }
    expect(fromBuilds.slice().sort()).toEqual(FAMILIES.slice().sort());
    expect(fromBuilds.length).toBe(Object.keys(CURRENT_VERSION).length);
    expect(fromBuilds.length).toBe(Object.keys(SUPPORT_FLOOR_VERSION).length);
  });

  test("every build succeeded and every registry names its own family", () => {
    for (let index = 0; index < PRODUCTION_BUILDS.length; index += 1) {
      const family = PRODUCTION_BUILDS[index][0];
      const build = PRODUCTION_BUILDS[index][1];
      expect(build.status + " for " + family).toBe("created for " + family);
      if (build.status === "created") {
        expect(build.registry.family).toBe(family);
      }
    }
  });

  test("each registry carries exactly that family's accepted current version and support floor", () => {
    for (let index = 0; index < PRODUCTION_BUILDS.length; index += 1) {
      const family = PRODUCTION_BUILDS[index][0];
      const registry = createdRegistry(PRODUCTION_BUILDS[index][1]);
      expect(family + " current").toBe(family + " current");
      expect(registry.currentSchemaVersion).toBe(CURRENT_VERSION[family]);
      expect(registry.supportFloorSchemaVersion).toBe(SUPPORT_FLOOR_VERSION[family]);
      expect(registry.supportFloorSchemaVersion <= registry.currentSchemaVersion).toBe(true);
    }
  });

  test("acceptedVersionRange reads the accepted constants and hands back a frozen pair", () => {
    for (let index = 0; index < FAMILIES.length; index += 1) {
      const family = FAMILIES[index];
      const range = acceptedVersionRange(family);
      expect(range.currentSchemaVersion).toBe(CURRENT_VERSION[family]);
      expect(range.supportFloorSchemaVersion).toBe(SUPPORT_FLOOR_VERSION[family]);
      expect(Object.isFrozen(range)).toBe(true);
    }
    // The premise of every zero-step case below, stated as an assertion rather than as a comment.
    expect(Object.keys(CURRENT_VERSION).length).toBe(4);
    expect(CURRENT_VERSION.exercises).toBe(1);
    expect(CURRENT_VERSION.workouts).toBe(1);
    expect(CURRENT_VERSION.preferences).toBe(1);
    expect(CURRENT_VERSION.results).toBe(1);
    expect(SUPPORT_FLOOR_VERSION.exercises).toBe(1);
    expect(SUPPORT_FLOOR_VERSION.workouts).toBe(1);
    expect(SUPPORT_FLOOR_VERSION.preferences).toBe(1);
    expect(SUPPORT_FLOOR_VERSION.results).toBe(1);
  });

  test("no application-wide version and no shared step list exists on any registry", () => {
    const registries: FamilyMigrationRegistry[] = [];
    for (let index = 0; index < PRODUCTION_BUILDS.length; index += 1) {
      registries.push(createdRegistry(PRODUCTION_BUILDS[index][1]));
    }
    for (let first = 0; first < registries.length; first += 1) {
      for (let second = first + 1; second < registries.length; second += 1) {
        expect(registries[first].steps === registries[second].steps).toBe(false);
        expect(registries[first] === registries[second]).toBe(false);
      }
    }
    // The registry surface is the contract's five data fields and one function, so no application-wide
    // version, no validator handle, no context, and no clock has a place to hide.
    expect(Object.keys(registries[0]).sort().join(","))
      .toBe("currentSchemaVersion,family,migrate,steps,supportFloorSchemaVersion,supportedSchemaVersions");
  });

  test("a document of one family never reaches another family's chain", () => {
    const exerciseCalls: StepCall[] = [];
    const workoutCalls: StepCall[] = [];
    const exerciseRegistry = syntheticRegistry({
      family: "exercises",
      floor: 1,
      current: 2,
      steps: syntheticSteps(exerciseCalls, [["synthetic-exercises-v1-to-v2", 1]])
    });
    const workoutRegistry = syntheticRegistry({
      family: "workouts",
      floor: 1,
      current: 2,
      steps: syntheticSteps(workoutCalls, [["synthetic-workouts-v1-to-v2", 1]])
    });

    expect(outcomeLabel(migrate(exerciseRegistry, { format: "repjot/exercises", schemaVersion: 1 }, null))).toBe("migrated");
    expect(exerciseCalls.length).toBe(1);
    expect(workoutCalls.length).toBe(0);

    expect(outcomeLabel(migrate(workoutRegistry, { format: "repjot/workouts", schemaVersion: 1 }, null))).toBe("migrated");
    expect(exerciseCalls.length).toBe(1);
    expect(workoutCalls.length).toBe(1);
    expect(workoutCalls[0].stepId).toBe("synthetic-workouts-v1-to-v2");
    expect(exerciseCalls[0].stepId).toBe("synthetic-exercises-v1-to-v2");
  });
});

// ---------------------------------------------------------------------------
// Group 2: production ships zero migration steps (R-15, R-14)
// ---------------------------------------------------------------------------

describe("family registries: production ships zero migration steps", () => {
  test("every production chain is empty and frozen", () => {
    expect(EXERCISES_MIGRATION_STEPS.length).toBe(0);
    expect(WORKOUTS_MIGRATION_STEPS.length).toBe(0);
    expect(PREFERENCES_MIGRATION_STEPS.length).toBe(0);
    expect(RESULTS_MIGRATION_STEPS.length).toBe(0);
    expect(Object.isFrozen(EXERCISES_MIGRATION_STEPS)).toBe(true);
    for (let index = 0; index < PRODUCTION_BUILDS.length; index += 1) {
      const registry = createdRegistry(PRODUCTION_BUILDS[index][1]);
      expect(registry.steps.length).toBe(0);
      expect(Object.isFrozen(registry.steps)).toBe(true);
    }
  });

  test("a registered step list is copied, so a later write to the caller's array changes no registry", () => {
    const calls: StepCall[] = [];
    const steps = syntheticSteps(calls, [["synthetic-v1-to-v2", 1]]);
    const registry = syntheticRegistry({ family: "results", floor: 1, current: 2, steps: steps });
    steps.push(syntheticStep({ id: "synthetic-v2-to-v3", from: 2, calls: calls }));
    expect(registry.steps.length).toBe(1);
    expect(outcomeLabel(migrate(registry, probeDocument(1), null))).toBe("migrated");
    expect(calls.length).toBe(1);
  });

  test("each production family supports exactly v1", () => {
    for (let index = 0; index < PRODUCTION_BUILDS.length; index += 1) {
      const family = PRODUCTION_BUILDS[index][0];
      const registry = createdRegistry(PRODUCTION_BUILDS[index][1]);
      expect(family + " supported set").toBe(family + " supported set");
      expect(Array.prototype.slice.call(registry.supportedSchemaVersions)).toEqual([1]);
    }
  });

  test("the supported schema-version set equals the accepted schema identities entry for entry", () => {
    let counted = 0;
    for (let index = 0; index < PRODUCTION_BUILDS.length; index += 1) {
      const family = PRODUCTION_BUILDS[index][0];
      const registry = createdRegistry(PRODUCTION_BUILDS[index][1]);
      const acceptedVersions: number[] = [];
      for (let entry = 0; entry < SUPPORTED_SCHEMA_IDENTITIES.length; entry += 1) {
        if (SUPPORTED_SCHEMA_IDENTITIES[entry].family === family) {
          acceptedVersions.push(SUPPORTED_SCHEMA_IDENTITIES[entry].version);
          counted += 1;
        }
      }
      expect(family + " matches the accepted schema identities").toBe(family + " matches the accepted schema identities");
      expect(Array.prototype.slice.call(registry.supportedSchemaVersions).sort()).toEqual(acceptedVersions.sort());
    }
    expect(SUPPORTED_SCHEMA_IDENTITIES.length).toBe(4);
    expect(counted).toBe(SUPPORTED_SCHEMA_IDENTITIES.length);
  });

  test("a synthetic multi-version registry derives its supported set from its bounds", () => {
    const registry = syntheticRegistry({ family: "results", floor: 2, current: 5, steps: [] });
    expect(Array.prototype.slice.call(registry.supportedSchemaVersions)).toEqual([2, 3, 4, 5]);
    expect(Object.isFrozen(registry.supportedSchemaVersions)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 3: a current-version document uses zero transitions (R-03)
// ---------------------------------------------------------------------------

describe("migration: a current-version document uses zero transitions", () => {
  test("every production family migrates its v1 document with an empty applied list", () => {
    for (let index = 0; index < PRODUCTION_BUILDS.length; index += 1) {
      const family = PRODUCTION_BUILDS[index][0];
      const registry = createdRegistry(PRODUCTION_BUILDS[index][1]);
      const document = { format: "repjot/" + family, schemaVersion: 1, yearMonthUtc: "2026-09" };
      const result = migrate(registry, document, null);
      expect(family + " status").toBe(family + " status");
      expect(result.status).toBe("migrated");
      if (result.status === "migrated") {
        expect(Array.prototype.slice.call(result.appliedStepIds)).toEqual([]);
        expect(Object.isFrozen(result.appliedStepIds)).toBe(true);
        expect(result.declaredSchemaVersion).toBe(1);
        expect(result.currentSchemaVersion).toBe(1);
        // "Current documents pass without transformation": no copy, no freeze, no new object.
        expect(result.document === document).toBe(true);
      }
    }
  });

  test("a zero-step migration neither copies nor freezes the caller's document", () => {
    const registry = createdRegistry(EXERCISES_MIGRATION_REGISTRY_BUILD);
    const document = { format: "repjot/exercises", schemaVersion: 1, nested: { kept: 1 } };
    const snapshot = JSON.stringify(document);
    expect(Object.isFrozen(document)).toBe(false);
    const result = migrate(registry, document, null);
    expect(JSON.stringify(document)).toBe(snapshot);
    expect(Object.isFrozen(document)).toBe(false);
    if (result.status === "migrated") {
      expect(result.document === document).toBe(true);
    }
  });

  test("a current-version document uses zero steps in a chain that does have steps", () => {
    const calls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "results",
      floor: 1,
      current: 3,
      steps: syntheticSteps(calls, [["synthetic-v1-to-v2", 1], ["synthetic-v2-to-v3", 2]])
    });
    const document = probeDocument(3);
    const result = migrate(registry, document, { exercises: "present but unused" });
    expect(outcomeLabel(result)).toBe("migrated");
    expect(calls.length).toBe(0);
    if (result.status === "migrated") {
      expect(Array.prototype.slice.call(result.appliedStepIds)).toEqual([]);
      expect(result.declaredSchemaVersion).toBe(3);
      expect(result.document === document).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Group 4: a malformed version is malformed, never legacy and never future (R-04)
// ---------------------------------------------------------------------------

describe("migration: a malformed version is malformed, never legacy and never future", () => {
  // [label, document, expected reason]. FF-09 names `0`, `-1`, `1.5`, `"1"`; the rest are the adjacent
  // states that must not be merged into them, including the inherited property the accepted envelope
  // reader also treats as missing.
  const MALFORMED: readonly (readonly [string, unknown, string])[] = [
    ["no version field at all", { format: "repjot/results" }, "missing-version"],
    ["version only on the prototype", inheritedVersionDocument(1), "missing-version"],
    ["root is null", null, "missing-version"],
    ["root is an array", [{ schemaVersion: 1 }], "missing-version"],
    ["root is a string", "repjot/results", "missing-version"],
    ["root is undefined", undefined, "missing-version"],
    ["version is undefined", { schemaVersion: undefined }, "non-number-version"],
    ["version is the string one", { schemaVersion: "1" }, "non-number-version"],
    ["version is null", { schemaVersion: null }, "non-number-version"],
    ["version is true", { schemaVersion: true }, "non-number-version"],
    ["version is an object", { schemaVersion: { value: 1 } }, "non-number-version"],
    ["version is one and a half", { schemaVersion: 1.5 }, "non-integer-version"],
    ["version is not-a-number", { schemaVersion: NaN }, "non-integer-version"],
    ["version is infinite", { schemaVersion: Infinity }, "non-integer-version"],
    ["version is negative and fractional", { schemaVersion: -2.5 }, "non-integer-version"],
    ["version is zero", { schemaVersion: 0 }, "non-positive-version"],
    ["version is negative one", { schemaVersion: -1 }, "non-positive-version"],
    ["version is negative zero", { schemaVersion: -0 }, "non-positive-version"]
  ];

  test("each malformed input yields its own reason on every production registry", () => {
    const seen: Record<string, string> = {};
    for (let row = 0; row < MALFORMED.length; row += 1) {
      const label = MALFORMED[row][0];
      const expected = MALFORMED[row][2];
      for (let index = 0; index < PRODUCTION_BUILDS.length; index += 1) {
        const registry = createdRegistry(PRODUCTION_BUILDS[index][1]);
        const result = migrate(registry, MALFORMED[row][1], null);
        expect(label + " yields " + expected).toBe(label + " yields " + expected);
        expect(outcomeLabel(result)).toBe(expected);
        // A malformed-version failure hands back no document to mistake for a migrated one.
        expect(Object.prototype.hasOwnProperty.call(result, "document")).toBe(false);
      }
      seen[expected] = "seen";
    }
    expect(Object.keys(seen).sort().join(","))
      .toBe("missing-version,non-integer-version,non-number-version,non-positive-version");
  });

  test("version zero is malformed rather than unsupported-old, and runs no step", () => {
    const calls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "results",
      floor: 1,
      current: 4,
      steps: syntheticSteps(calls, [["synthetic-v1-to-v2", 1], ["synthetic-v2-to-v3", 2], ["synthetic-v3-to-v4", 3]])
    });
    expect(outcomeLabel(migrate(registry, { schemaVersion: 0 }, null))).toBe("non-positive-version");
    expect(outcomeLabel(migrate(registry, { schemaVersion: -3 }, null))).toBe("non-positive-version");
    expect(outcomeLabel(migrate(registry, { schemaVersion: 1.5 }, null))).toBe("non-integer-version");
    expect(outcomeLabel(migrate(registry, {}, null))).toBe("missing-version");
    expect(outcomeLabel(migrate(registry, { schemaVersion: "1" }, null))).toBe("non-number-version");
    expect(calls.length).toBe(0);
  });

  test("the four malformed reasons stay distinct from unsupported-old and future", () => {
    const registry = createdRegistry(RESULTS_MIGRATION_REGISTRY_BUILD);
    const inputs: readonly unknown[] = [
      {},
      { schemaVersion: "1" },
      { schemaVersion: 1.5 },
      { schemaVersion: 0 },
      { schemaVersion: 9 }
    ];
    const reasons: string[] = [];
    for (let index = 0; index < inputs.length; index += 1) {
      reasons.push(outcomeLabel(migrate(registry, inputs[index], null)));
    }
    expect(reasons).toEqual([
      "missing-version",
      "non-number-version",
      "non-integer-version",
      "non-positive-version",
      "future-version"
    ]);
    expect(reasons.indexOf("unsupported-old-version")).toBe(-1);
  });

  test("no malformed arm carries a document, a step identity, or a migrated value", () => {
    const registry = createdRegistry(PREFERENCES_MIGRATION_REGISTRY_BUILD);
    const result = migrate(registry, { schemaVersion: 0 }, null);
    expect(Object.keys(result).sort().join(",")).toBe("failure,status");
    if (result.status === "failed") {
      expect(Object.keys(result.failure).sort().join(",")).toBe("reason");
    }
  });
});

// ---------------------------------------------------------------------------
// Group 5: unsupported-old reports the floor, future reports the current version (R-05, R-06)
// ---------------------------------------------------------------------------

describe("migration: unsupported-old reports the floor and future reports the current version", () => {
  // A synthetic floor above v1 is the only way to reach this arm today: every accepted floor is 1, so no
  // positive version can sit below it. The floor here is above the chain's lowest registered step, which
  // is exactly the shape docs/implementation/phase-14.md asks a synthetic registry to exercise.
  function flooredRegistry(calls: StepCall[]): FamilyMigrationRegistry {
    return syntheticRegistry({
      family: "results",
      floor: 2,
      current: 4,
      steps: syntheticSteps(calls, [["synthetic-v2-to-v3", 2], ["synthetic-v3-to-v4", 3]])
    });
  }

  test("a version below the floor reports the floor, runs no step, and returns no document", () => {
    const calls: StepCall[] = [];
    const result = migrate(flooredRegistry(calls), probeDocument(1), null);
    expect(outcomeLabel(result)).toBe("unsupported-old-version");
    expect(calls.length).toBe(0);
    if (result.status === "failed" && result.failure.reason === "unsupported-old-version") {
      expect(result.failure.schemaVersion).toBe(1);
      expect(result.failure.supportFloorSchemaVersion).toBe(2);
    }
    expect(Object.prototype.hasOwnProperty.call(result, "document")).toBe(false);
  });

  test("the support floor itself is supported and migrates the rest of the way", () => {
    const calls: StepCall[] = [];
    const result = migrate(flooredRegistry(calls), probeDocument(2), null);
    expect(outcomeLabel(result)).toBe("migrated");
    expect(calls.length).toBe(2);
    if (result.status === "migrated") {
      expect(Array.prototype.slice.call(result.appliedStepIds))
        .toEqual(["synthetic-v2-to-v3", "synthetic-v3-to-v4"]);
      expect(result.declaredSchemaVersion).toBe(2);
      expect(result.currentSchemaVersion).toBe(4);
    }
  });

  test("a version above the current version reports both versions and runs no step", () => {
    const calls: StepCall[] = [];
    const result = migrate(flooredRegistry(calls), probeDocument(5), null);
    expect(outcomeLabel(result)).toBe("future-version");
    if (result.status === "failed" && result.failure.reason === "future-version") {
      expect(result.failure.schemaVersion).toBe(5);
      expect(result.failure.currentSchemaVersion).toBe(4);
    }
    expect(calls.length).toBe(0);
    expect(Object.prototype.hasOwnProperty.call(result, "document")).toBe(false);
  });

  test("every production family reports a v2 document as future against its own current version", () => {
    for (let index = 0; index < PRODUCTION_BUILDS.length; index += 1) {
      const family = PRODUCTION_BUILDS[index][0];
      const registry = createdRegistry(PRODUCTION_BUILDS[index][1]);
      const result = migrate(registry, { format: "repjot/" + family, schemaVersion: 2 }, null);
      expect(family + " is future at v2").toBe(family + " is future at v2");
      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.failure.reason).toBe("future-version");
        if (result.failure.reason === "future-version") {
          expect(result.failure.currentSchemaVersion).toBe(CURRENT_VERSION[family]);
        }
      }
    }
  });

  test("a version above the current version is future even when it is also above the floor", () => {
    const registry = syntheticRegistry({ family: "preferences", floor: 3, current: 3, steps: [] });
    expect(outcomeLabel(migrate(registry, { schemaVersion: 4 }, null))).toBe("future-version");
    expect(outcomeLabel(migrate(registry, { schemaVersion: 3 }, null))).toBe("migrated");
    expect(outcomeLabel(migrate(registry, { schemaVersion: 2 }, null))).toBe("unsupported-old-version");
  });
});

// ---------------------------------------------------------------------------
// Group 6: strict N -> N+1 at registration and at every application (R-02, R-07, R-08)
// ---------------------------------------------------------------------------

describe("migration: strict N to N+1 at every application", () => {
  test("a synthetic three-step chain applies its steps in version order", () => {
    const calls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "results",
      floor: 1,
      current: 4,
      steps: syntheticSteps(calls, [["synthetic-v1-to-v2", 1], ["synthetic-v2-to-v3", 2], ["synthetic-v3-to-v4", 3]])
    });
    const result = migrate(registry, probeDocument(1), null);
    expect(outcomeLabel(result)).toBe("migrated");
    if (result.status === "migrated") {
      expect(Array.prototype.slice.call(result.appliedStepIds))
        .toEqual(["synthetic-v1-to-v2", "synthetic-v2-to-v3", "synthetic-v3-to-v4"]);
      expect(result.declaredSchemaVersion).toBe(1);
      expect(result.currentSchemaVersion).toBe(4);
      // The trail proves the order the values travelled, independently of the reported identifiers.
      expect(trailOf(result.document)).toEqual(["synthetic-v1-to-v2", "synthetic-v2-to-v3", "synthetic-v3-to-v4"]);
      expect(asRecord(result.document)["schemaVersion"]).toBe(4);
    }
  });

  test("each step is invoked once, for its own declared version, on the previous step's output", () => {
    const calls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "results",
      floor: 1,
      current: 3,
      steps: syntheticSteps(calls, [["synthetic-v1-to-v2", 1], ["synthetic-v2-to-v3", 2]])
    });
    const document = probeDocument(1);
    migrate(registry, document, null);
    expect(calls.length).toBe(2);
    expect(calls[0].stepId).toBe("synthetic-v1-to-v2");
    expect(calls[0].schemaVersion).toBe(1);
    expect(calls[0].inputDocument === document).toBe(true);
    expect(calls[1].stepId).toBe("synthetic-v2-to-v3");
    expect(calls[1].schemaVersion).toBe(2);
    expect(calls[1].inputDocument === calls[0].producedDocument).toBe(true);
  });

  test("steps are selected by declared version, not by their order in the list", () => {
    const calls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "workouts",
      floor: 1,
      current: 3,
      steps: syntheticSteps(calls, [["synthetic-v2-to-v3", 2], ["synthetic-v1-to-v2", 1]])
    });
    const result = migrate(registry, { format: "repjot/workouts", schemaVersion: 1 }, null);
    expect(outcomeLabel(result)).toBe("migrated");
    if (result.status === "migrated") {
      expect(trailOf(result.document)).toEqual(["synthetic-v1-to-v2", "synthetic-v2-to-v3"]);
    }
    expect(calls.length).toBe(2);
    expect(calls[0].schemaVersion).toBe(1);
    expect(calls[1].schemaVersion).toBe(2);
  });

  test("a step is never invoked for a version other than the one it declares", () => {
    const calls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "results",
      floor: 2,
      current: 4,
      steps: syntheticSteps(calls, [["synthetic-v3-to-v4", 3]])
    });
    // A v2 document needs a v2 step. The one v3 step in this chain must stay untouched.
    expect(outcomeLabel(migrate(registry, probeDocument(2), null))).toBe("chain-gap");
    expect(calls.length).toBe(0);
    // A v3 document uses that step, and only that step, with version 3 in its input.
    expect(outcomeLabel(migrate(registry, probeDocument(3), null))).toBe("migrated");
    expect(calls.length).toBe(1);
    expect(calls[0].schemaVersion).toBe(3);
  });

  test("a missing intermediate step is named exactly, and nothing skips over it", () => {
    const calls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "results",
      floor: 1,
      current: 4,
      steps: syntheticSteps(calls, [["synthetic-v1-to-v2", 1], ["synthetic-v3-to-v4", 3]])
    });
    const result = migrate(registry, probeDocument(1), null);
    expect(outcomeLabel(result)).toBe("chain-gap");
    if (result.status === "failed" && result.failure.reason === "chain-gap") {
      expect(result.failure.family).toBe("results");
      expect(result.failure.schemaVersion).toBe(2);
      expect(result.failure.supportFloorSchemaVersion).toBe(1);
      expect(result.failure.currentSchemaVersion).toBe(4);
    }
    // No direct v1-to-v4 conversion, and no later step ran on top of the gap.
    expect(calls.length).toBe(1);
    expect(calls[0].stepId).toBe("synthetic-v1-to-v2");
    expect(Object.prototype.hasOwnProperty.call(result, "document")).toBe(false);
  });

  test("a chain whose first needed step is missing names the declared version", () => {
    const calls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "preferences",
      floor: 1,
      current: 3,
      steps: syntheticSteps(calls, [["synthetic-v2-to-v3", 2]])
    });
    const result = migrate(registry, { format: "repjot/preferences", schemaVersion: 1 }, null);
    expect(outcomeLabel(result)).toBe("chain-gap");
    if (result.status === "failed" && result.failure.reason === "chain-gap") {
      expect(result.failure.schemaVersion).toBe(1);
    }
    expect(calls.length).toBe(0);
  });

  test("a gap is a fact about the document's path, not a refusal of the whole registry", () => {
    const calls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "results",
      floor: 1,
      current: 4,
      steps: syntheticSteps(calls, [["synthetic-v2-to-v3", 2], ["synthetic-v3-to-v4", 3]])
    });
    // The same registry serves a v2 document and refuses a v1 document, because only the second one needs
    // the missing v1 step. A matrix of direct conversions would silently accept the v1 document instead.
    expect(outcomeLabel(migrate(registry, probeDocument(2), null))).toBe("migrated");
    const refused = migrate(registry, probeDocument(1), null);
    expect(outcomeLabel(refused)).toBe("chain-gap");
    if (refused.status === "failed" && refused.failure.reason === "chain-gap") {
      expect(refused.failure.schemaVersion).toBe(1);
    }
  });
});

describe("registry construction: strict N to N+1 and one step per input version", () => {
  function refusalOf(steps: FamilyMigrationStep[], floor: number, current: number): string {
    const built = createFamilyMigrationRegistry({
      family: "results",
      range: { supportFloorSchemaVersion: floor, currentSchemaVersion: current },
      steps: steps
    });
    return built.status === "rejected" ? built.failure.reason : "created";
  }

  test("a step whose two versions are not N and N+1 is refused at registration", () => {
    const calls: StepCall[] = [];
    // [label, from, to] for FF-18's negative case "A migration accepting v1 but returning v3".
    const rows: readonly (readonly [string, number, number])[] = [
      ["skips a version", 1, 3],
      ["stays at the same version", 1, 1],
      ["goes backwards", 2, 1],
      ["starts above its output", 1, 0]
    ];
    for (let index = 0; index < rows.length; index += 1) {
      const step = syntheticStep({ id: "synthetic-bad-" + index, from: rows[index][1], to: rows[index][2], calls: calls });
      const reason = refusalOf([step], 1, 4);
      expect(rows[index][0] + " is refused").toBe(rows[index][0] + " is refused");
      expect(reason).toBe("step-version-not-sequential");
    }
    expect(calls.length).toBe(0);
  });

  test("a refused non-sequential step names itself and both of its versions", () => {
    const calls: StepCall[] = [];
    const built = createFamilyMigrationRegistry({
      family: "results",
      range: { supportFloorSchemaVersion: 1, currentSchemaVersion: 4 },
      steps: [syntheticStep({ id: "synthetic-skipping", from: 1, to: 3, calls: calls })]
    });
    expect(built.status).toBe("rejected");
    if (built.status === "rejected" && built.failure.reason === "step-version-not-sequential") {
      expect(built.failure.stepId).toBe("synthetic-skipping");
      expect(built.failure.fromSchemaVersion).toBe(1);
      expect(built.failure.toSchemaVersion).toBe(3);
    }
  });

  // [label, from, to] for the step boundaries that are not schema versions at all. Every pair here
  // satisfies `to === from + 1`, so sequentiality alone cannot refuse it, and no document can ever declare
  // either boundary: FF-09 "`schemaVersion` is a positive integer ... `0`, `-1`, `1.5`, `\"1\"` rejected",
  // and docs/implementation/phase-14.md "Version 0 is malformed, not legacy. Do not add a no-op `v0 -> v1`
  // migration", which docs/implementation/GATES.md §3 makes a parent check ("Confirm that no real `v0` or
  // speculative legacy migration was invented").
  const NON_VERSION_BOUNDARIES: readonly (readonly [string, number, number])[] = [
    ["the forbidden zero to one step", 0, 1],
    ["a negative step into zero", -1, 0],
    ["a negative step entirely below zero", -3, -2],
    ["a minus-zero input", -0, 1],
    ["two fractional boundaries", 1.5, 2.5],
    ["a fractional pair below one", 0.5, 1.5],
    ["a whole input and a fractional output", 2, 3.5],
    ["a whole output and a fractional input", 2.5, 3],
    ["an unbounded pair", Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    ["a not-a-number pair", Number.NaN, Number.NaN]
  ];

  test("a step boundary that is not a positive whole version is refused, so no v0 step can be registered", () => {
    const calls: StepCall[] = [];
    for (let index = 0; index < NON_VERSION_BOUNDARIES.length; index += 1) {
      const label = NON_VERSION_BOUNDARIES[index][0];
      const built = createFamilyMigrationRegistry({
        family: "results",
        range: { supportFloorSchemaVersion: 1, currentSchemaVersion: 4 },
        steps: [syntheticStep({
          id: "synthetic-bad-boundary-" + String(index),
          from: NON_VERSION_BOUNDARIES[index][1],
          to: NON_VERSION_BOUNDARIES[index][2],
          calls: calls
        })]
      });
      expect(label + " is refused").toBe(label + " is refused");
      expect(built.status).toBe("rejected");
      if (built.status === "rejected") {
        // One frozen outcome of the arm that already carries the step and both boundaries, chosen over a new
        // reason because a boundary that is not a version fails the same one-version contract FF-18 states.
        expect(label + " reason " + built.failure.reason).toBe(label + " reason step-version-not-sequential");
        if (built.failure.reason === "step-version-not-sequential") {
          // Both boundaries come back verbatim, so the refusal of `0 -> 1` names the `0` it refuses.
          expect(String(built.failure.fromSchemaVersion)).toBe(String(NON_VERSION_BOUNDARIES[index][1]));
          expect(String(built.failure.toSchemaVersion)).toBe(String(NON_VERSION_BOUNDARIES[index][2]));
          expect(built.failure.stepId).toBe("synthetic-bad-boundary-" + String(index));
        }
        expect(Object.prototype.hasOwnProperty.call(built, "registry")).toBe(false);
        expect(Object.isFrozen(built.failure)).toBe(true);
      }
    }
    // No registry exists for any of them, so no document can ever reach one of those steps.
    expect(calls.length).toBe(0);
  });

  test("a valid control: positive whole boundaries still register, including one and a chain above its floor", () => {
    const calls: StepCall[] = [];
    const built = createFamilyMigrationRegistry({
      family: "results",
      range: { supportFloorSchemaVersion: 1, currentSchemaVersion: 4 },
      steps: syntheticSteps(calls, [["synthetic-v1-to-v2", 1], ["synthetic-v2-to-v3", 2], ["synthetic-v3-to-v4", 3]])
    });
    expect(built.status).toBe("created");
    if (built.status === "created") {
      const result = migrate(built.registry, probeDocument(1), null);
      expect(outcomeLabel(result)).toBe("migrated");
      expect(Array.prototype.slice.call(result.status === "migrated" ? result.appliedStepIds : []))
        .toEqual(["synthetic-v1-to-v2", "synthetic-v2-to-v3", "synthetic-v3-to-v4"]);
    }
    expect(calls.length).toBe(3);
    // The lowest legal boundary stays 1, and a positive chain that begins above the floor is still a
    // registry: the boundary that has no step is a fact about the document that reaches it, which this
    // repair does not change.
    const above: StepCall[] = [];
    expect(refusalOf(syntheticSteps(above, [["synthetic-v2-to-v3", 2]]), 1, 3)).toBe("created");
    expect(above.length).toBe(0);
  });

  test("two steps for one input version are refused, naming both, and neither runs", () => {
    const calls: StepCall[] = [];
    const built = createFamilyMigrationRegistry({
      family: "results",
      range: { supportFloorSchemaVersion: 1, currentSchemaVersion: 3 },
      steps: [
        syntheticStep({ id: "synthetic-first-v1", from: 1, calls: calls }),
        syntheticStep({ id: "synthetic-second-v1", from: 1, calls: calls }),
        syntheticStep({ id: "synthetic-v2-to-v3", from: 2, calls: calls })
      ]
    });
    expect(built.status).toBe("rejected");
    if (built.status === "rejected" && built.failure.reason === "duplicate-step-version") {
      expect(built.failure.schemaVersion).toBe(1);
      expect(built.failure.firstStepId).toBe("synthetic-first-v1");
      expect(built.failure.duplicateStepId).toBe("synthetic-second-v1");
    }
    // The registry does not exist, so no document can run one of them and not the other.
    expect(calls.length).toBe(0);
    expect(refusalOf([
      syntheticStep({ id: "synthetic-a", from: 1, calls: calls }),
      syntheticStep({ id: "synthetic-b", from: 2, calls: calls }),
      syntheticStep({ id: "synthetic-c", from: 2, calls: calls })
    ], 1, 3)).toBe("duplicate-step-version");
  });

  test("an empty or non-object step entry is refused by position", () => {
    const calls: StepCall[] = [];
    const good = syntheticStep({ id: "synthetic-v1-to-v2", from: 1, calls: calls });
    expect(refusalOf([syntheticStep({ id: "", from: 1, calls: calls }), good], 1, 3)).toBe("invalid-step");
    expect(refusalOf([good, syntheticStep({ id: "   ", from: 2, calls: calls })], 1, 3)).toBe("invalid-step");
    const broken: FamilyMigrationStep[] = [good];
    // A non-object entry is refused rather than dereferenced, so construction cannot raise.
    broken.splice(0, 0, null as unknown as FamilyMigrationStep);
    expect(refusalOf(broken, 1, 3)).toBe("invalid-step");
  });

  test("a family whose bounds are not whole versions or are inverted is refused", () => {
    const calls: StepCall[] = [];
    const steps = syntheticSteps(calls, [["synthetic-v1-to-v2", 1]]);
    expect(refusalOf(steps, 0, 2)).toBe("invalid-version-range");
    expect(refusalOf(steps, 1, 0)).toBe("invalid-version-range");
    expect(refusalOf(steps, 2, 1)).toBe("invalid-version-range");
    expect(refusalOf(steps, 1.5, 3)).toBe("invalid-version-range");
    expect(refusalOf(steps, 1, 2.5)).toBe("invalid-version-range");
    expect(calls.length).toBe(0);
  });

  test("an empty chain is a valid registry for a family at its floor", () => {
    const built = createFamilyMigrationRegistry({
      family: "results",
      range: { supportFloorSchemaVersion: 1, currentSchemaVersion: 1 },
      steps: []
    });
    expect(built.status).toBe("created");
    if (built.status === "created") {
      expect(built.registry.steps.length).toBe(0);
      expect(outcomeLabel(migrate(built.registry, { schemaVersion: 1 }, null))).toBe("migrated");
    }
  });

  test("a refused build returns no registry and raises nothing", () => {
    const calls: StepCall[] = [];
    let raised = "none";
    let built = null as unknown as ReturnType<typeof createFamilyMigrationRegistry>;
    try {
      built = createFamilyMigrationRegistry({
        family: "results",
        range: { supportFloorSchemaVersion: 1, currentSchemaVersion: 2 },
        steps: [syntheticStep({ id: "synthetic-bad", from: 1, to: 9, calls: calls })]
      });
    } catch (error) {
      raised = error instanceof Error ? error.name : "unknown";
    }
    expect(raised).toBe("none");
    expect(built.status).toBe("rejected");
    if (built.status === "rejected") {
      expect(Object.prototype.hasOwnProperty.call(built, "registry")).toBe(false);
      expect(Object.isFrozen(built.failure)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Group 7: a wrong step output stops the chain (R-09)
// ---------------------------------------------------------------------------

describe("migration: a wrong step output fails and stops the chain", () => {
  /**
   * One registry whose first step behaves as the case says and whose second step must never be reached.
   * The chain runs v1 to v3, so a first-step failure has a later step to prove it stopped at.
   */
  function failingFirstStepRegistry(
    firstCalls: StepCall[],
    secondCalls: StepCall[],
    produce: (input: FamilyMigrationStepInput, toVersion: number) => FamilyMigrationStepResult
  ): FamilyMigrationRegistry {
    return syntheticRegistry({
      family: "results",
      floor: 1,
      current: 3,
      steps: [
        syntheticStep({ id: "synthetic-first", from: 1, calls: firstCalls, produce: produce }),
        syntheticStep({ id: "synthetic-second", from: 2, calls: secondCalls })
      ]
    });
  }

  // [label, produce, expected reason]. Every row is one way a step can break FF-18's "Return exactly the
  // next version" or "Produce a new object" or "fail with a precise diagnostic".
  const WRONG_OUTPUTS: readonly (readonly [string, (input: FamilyMigrationStepInput, toVersion: number) => FamilyMigrationStepResult, string])[] = [
    ["returns the version after next", () => ({ status: "migrated", document: { schemaVersion: 3 } }), "step-output-wrong-version"],
    ["returns the version it was given", () => ({ status: "migrated", document: { schemaVersion: 1 } }), "step-output-wrong-version"],
    ["returns no version", () => ({ status: "migrated", document: { format: "repjot/results" } }), "step-output-wrong-version"],
    ["returns a version that is not a number", () => ({ status: "migrated", document: { schemaVersion: "2" } }), "step-output-wrong-version"],
    ["returns a fractional version", () => ({ status: "migrated", document: { schemaVersion: 2.5 } }), "step-output-wrong-version"],
    ["returns the input object itself", (input) => ({ status: "migrated", document: input.document }), "step-output-unchanged"],
    ["returns a string", () => ({ status: "migrated", document: "migrated" }), "step-result-invalid"],
    ["returns a number", () => ({ status: "migrated", document: 2 }), "step-result-invalid"],
    ["returns null", () => ({ status: "migrated", document: null }), "step-result-invalid"],
    ["returns an array", () => ({ status: "migrated", document: [{ schemaVersion: 2 }] }), "step-result-invalid"],
    ["returns no document field", () => ({ status: "migrated" } as unknown as FamilyMigrationStepResult), "step-result-invalid"],
    ["returns an unknown status", () => ({ status: "converted", document: { schemaVersion: 2 } } as unknown as FamilyMigrationStepResult), "step-result-invalid"],
    ["returns a bare object", () => ({ schemaVersion: 2 } as unknown as FamilyMigrationStepResult), "step-result-invalid"],
    ["returns a string instead of a result", () => "migrated" as unknown as FamilyMigrationStepResult, "step-result-invalid"],
    ["returns null instead of a result", () => null as unknown as FamilyMigrationStepResult, "step-result-invalid"],
    ["reports failure without a detail", () => ({ status: "failed" } as unknown as FamilyMigrationStepResult), "step-result-invalid"],
    ["reports a failure with a detail", () => ({ status: "failed", detail: "synthetic-detail" }), "step-reported-failure"]
  ];

  test("each wrong output yields its own reason, stops the chain, and returns no document", () => {
    for (let row = 0; row < WRONG_OUTPUTS.length; row += 1) {
      const label = WRONG_OUTPUTS[row][0];
      const expected = WRONG_OUTPUTS[row][2];
      const firstCalls: StepCall[] = [];
      const secondCalls: StepCall[] = [];
      const registry = failingFirstStepRegistry(firstCalls, secondCalls, WRONG_OUTPUTS[row][1]);
      const document = probeDocument(1);
      const snapshot = JSON.stringify(document);
      const result = migrate(registry, document, null);
      expect(label + " yields " + expected).toBe(label + " yields " + expected);
      expect(outcomeLabel(result)).toBe(expected);
      expect(firstCalls.length).toBe(1);
      expect(secondCalls.length).toBe(0);
      expect(JSON.stringify(document)).toBe(snapshot);
      expect(Object.prototype.hasOwnProperty.call(result, "document")).toBe(false);
      if (result.status === "failed") {
        // Every step arm names the step and both versions, which is the migration context §12 requires.
        const failure = result.failure as Record<string, unknown>;
        expect(failure.stepId).toBe("synthetic-first");
        expect(failure.fromSchemaVersion).toBe(1);
        expect(failure.toSchemaVersion).toBe(2);
      }
    }
  });

  test("a wrong version reports what it expected and what it actually received", () => {
    const firstCalls: StepCall[] = [];
    const registry = failingFirstStepRegistry(firstCalls, [], () => ({ status: "migrated", document: { schemaVersion: 3 } }));
    const result = migrate(registry, probeDocument(1), null);
    if (result.status === "failed" && result.failure.reason === "step-output-wrong-version") {
      expect(result.failure.stepId).toBe("synthetic-first");
      expect(result.failure.expectedSchemaVersion).toBe(2);
      expect(result.failure.actualSchemaVersion).toBe(3);
    } else {
      expect("no wrong-version failure").toBe("wrong-version failure");
    }
  });

  test("a produced version that is unusable reports null rather than a invented number", () => {
    const registry = failingFirstStepRegistry([], [], () => ({ status: "migrated", document: { schemaVersion: "two" } }));
    const result = migrate(registry, probeDocument(1), null);
    if (result.status === "failed" && result.failure.reason === "step-output-wrong-version") {
      expect(result.failure.expectedSchemaVersion).toBe(2);
      expect(result.failure.actualSchemaVersion).toBe(null);
    } else {
      expect("no wrong-version failure").toBe("wrong-version failure");
    }
  });

  test("a step that reports a failure keeps its own detail and invents nothing", () => {
    const registry = failingFirstStepRegistry(
      [],
      [],
      () => ({
        status: "failed",
        detail: "synthetic: shard results-2026-09, session session-probe, workout workout-probe, node 4 has no exercise reference"
      })
    );
    const result = migrate(registry, probeDocument(1), null);
    if (result.status === "failed" && result.failure.reason === "step-reported-failure") {
      // specs/schema-versioning.md: the migration identifies the shard, session, workout, and node, then
      // fails. The registry carries that detail and adds no identity of its own.
      expect(result.failure.detail.indexOf("results-2026-09") !== -1).toBe(true);
      expect(result.failure.detail.indexOf("session-probe") !== -1).toBe(true);
      expect(result.failure.detail.indexOf("workout-probe") !== -1).toBe(true);
      expect(result.failure.detail.indexOf("node 4") !== -1).toBe(true);
      expect(Object.keys(result.failure).sort().join(","))
        .toBe("detail,fromSchemaVersion,reason,stepId,toSchemaVersion");
    } else {
      expect("no reported failure").toBe("step-reported-failure");
    }
    expect(Object.prototype.hasOwnProperty.call(result, "document")).toBe(false);
  });

  test("a step that raises is reported, never rethrown, and stops the chain", () => {
    const secondCalls: StepCall[] = [];
    const registry = failingFirstStepRegistry([], secondCalls, () => {
      throw new Error("synthetic step defect");
    });
    const document = probeDocument(1);
    const snapshot = JSON.stringify(document);
    let raised = "none";
    let result: FamilyMigrationResult | null = null;
    try {
      result = migrate(registry, document, null);
    } catch (error) {
      raised = error instanceof Error ? error.name : "unknown";
    }
    expect(raised).toBe("none");
    expect(result === null ? "null" : outcomeLabel(result)).toBe("step-threw");
    if (result !== null && result.status === "failed" && result.failure.reason === "step-threw") {
      expect(result.failure.stepId).toBe("synthetic-first");
      expect(result.failure.fromSchemaVersion).toBe(1);
      expect(result.failure.toSchemaVersion).toBe(2);
    }
    expect(secondCalls.length).toBe(0);
    expect(JSON.stringify(document)).toBe(snapshot);
  });

  /**
   * One step that returns whatever the case says, counted but never interrogated. Built here rather than
   * with `syntheticStep` on purpose: that helper reads the returned `document` in order to record it, which
   * would move the read out of the registry and into the step, so a raising accessor would be caught by the
   * boundary that already contains the call and prove nothing about the reads after it.
   */
  function unreadableResultStep(options: {
    readonly id: string;
    readonly from: number;
    readonly to: number;
    readonly calls: string[];
    readonly result: () => FamilyMigrationStepResult;
  }): FamilyMigrationStep {
    return {
      id: options.id,
      fromSchemaVersion: options.from,
      toSchemaVersion: options.to,
      migrate: (): FamilyMigrationStepResult => {
        options.calls.push(options.id);
        return options.result();
      }
    };
  }

  /** One object that carries `fields` and raises when the code under test reads `raiseOn`. */
  function objectWithRaisingRead(fields: Record<string, unknown>, raiseOn: string): Record<string, unknown> {
    const value: Record<string, unknown> = {};
    const keys = Object.keys(fields);
    for (let index = 0; index < keys.length; index += 1) {
      value[keys[index]] = fields[keys[index]];
    }
    Object.defineProperty(value, raiseOn, {
      enumerable: true,
      get: (): never => {
        throw new Error("synthetic raising read of " + raiseOn);
      }
    });
    return value;
  }

  // [label, result] — one row per value the registry reads out of what a step returned: the two discriminant
  // fields, the payload of each arm, and the version the produced document carries itself.
  const RAISING_READS: readonly (readonly [string, () => FamilyMigrationStepResult])[] = [
    ["the status of a result", () => objectWithRaisingRead({}, "status") as unknown as FamilyMigrationStepResult],
    ["the detail of a failed result", () => objectWithRaisingRead({ status: "failed" }, "detail") as unknown as FamilyMigrationStepResult],
    ["the document of a migrated result", () => objectWithRaisingRead({ status: "migrated" }, "document") as unknown as FamilyMigrationStepResult],
    [
      "the version of the produced document",
      () => ({ status: "migrated", document: objectWithRaisingRead({ format: "repjot/results" }, "schemaVersion") })
    ]
  ];

  test("every read of what a step returned is inside the boundary that contains the step", () => {
    for (let row = 0; row < RAISING_READS.length; row += 1) {
      const label = RAISING_READS[row][0];
      const firstCalls: string[] = [];
      const secondCalls: StepCall[] = [];
      const registry = syntheticRegistry({
        family: "results",
        floor: 1,
        current: 3,
        steps: [
          unreadableResultStep({ id: "synthetic-unreadable", from: 1, to: 2, calls: firstCalls, result: RAISING_READS[row][1] }),
          syntheticStep({ id: "synthetic-second", from: 2, calls: secondCalls })
        ]
      });
      const document = probeDocument(1);
      const snapshot = JSON.stringify(document);
      let raised = "none";
      let result: FamilyMigrationResult | null = null;
      try {
        result = migrate(registry, document, null);
      } catch (error) {
        raised = error instanceof Error ? error.name : "unknown";
      }
      // A value the registry cannot read is a value from which nothing can be derived, so it is reported the
      // way a step that raises is reported: never re-raised, and never with the raised value's own text.
      expect(label + " raised " + raised).toBe(label + " raised none");
      expect(result === null ? "null result" : outcomeLabel(result)).toBe("step-threw");
      if (result !== null && result.status === "failed" && result.failure.reason === "step-threw") {
        expect(result.failure.stepId).toBe("synthetic-unreadable");
        expect(result.failure.fromSchemaVersion).toBe(1);
        expect(result.failure.toSchemaVersion).toBe(2);
        expect(Object.keys(result.failure).sort().join(",")).toBe("fromSchemaVersion,reason,stepId,toSchemaVersion");
      }
      expect(firstCalls.length).toBe(1);
      // The chain stopped at the unreadable result, so the step after it never ran.
      expect(secondCalls.length).toBe(0);
      expect(Object.prototype.hasOwnProperty.call(result, "document")).toBe(false);
      expect(JSON.stringify(document)).toBe(snapshot);
      expect(JSON.stringify(result).indexOf("synthetic raising read") === -1).toBe(true);
    }
  });

  test("a valid control: a result whose fields are accessors that answer is still adopted", () => {
    const firstCalls: string[] = [];
    const secondCalls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "results",
      floor: 1,
      current: 3,
      steps: [
        unreadableResultStep({
          id: "synthetic-accessor-result",
          from: 1,
          to: 2,
          calls: firstCalls,
          result: (): FamilyMigrationStepResult => {
            const value: Record<string, unknown> = {};
            Object.defineProperty(value, "status", { enumerable: true, get: () => "migrated" });
            Object.defineProperty(value, "document", {
              enumerable: true,
              get: () => ({ schemaVersion: 2, trail: ["synthetic-accessor-result"] })
            });
            return value as unknown as FamilyMigrationStepResult;
          }
        }),
        syntheticStep({ id: "synthetic-second", from: 2, calls: secondCalls })
      ]
    });
    const document = probeDocument(1);
    const snapshot = JSON.stringify(document);
    const result = migrate(registry, document, null);
    expect(outcomeLabel(result)).toBe("migrated");
    expect(firstCalls.length).toBe(1);
    expect(secondCalls.length).toBe(1);
    if (result.status === "migrated") {
      expect(Array.prototype.slice.call(result.appliedStepIds)).toEqual(["synthetic-accessor-result", "synthetic-second"]);
      expect(trailOf(result.document)).toEqual(["synthetic-accessor-result", "synthetic-second"]);
      expect(asRecord(result.document)["schemaVersion"]).toBe(3);
    }
    expect(JSON.stringify(document)).toBe(snapshot);
  });

  test("a later step failing keeps the earlier step applied but returns no partial value", () => {
    const firstCalls: StepCall[] = [];
    const secondCalls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "results",
      floor: 1,
      current: 3,
      steps: [
        syntheticStep({ id: "synthetic-first", from: 1, calls: firstCalls }),
        syntheticStep({
          id: "synthetic-second",
          from: 2,
          calls: secondCalls,
          produce: () => ({ status: "migrated", document: { schemaVersion: 99 } })
        })
      ]
    });
    const result = migrate(registry, probeDocument(1), null);
    expect(outcomeLabel(result)).toBe("step-output-wrong-version");
    expect(firstCalls.length).toBe(1);
    expect(secondCalls.length).toBe(1);
    expect(Object.prototype.hasOwnProperty.call(result, "document")).toBe(false);
    if (result.status === "failed" && result.failure.reason === "step-output-wrong-version") {
      expect(result.failure.stepId).toBe("synthetic-second");
      expect(result.failure.expectedSchemaVersion).toBe(3);
      expect(result.failure.actualSchemaVersion).toBe(99);
    }
  });
});

// ---------------------------------------------------------------------------
// Group 8: purity, immutability, determinism, and the caller's context (R-10, R-11, R-12)
// ---------------------------------------------------------------------------

describe("migration: every outcome leaves the caller's document untouched", () => {
  /** One outcome arm, reached through a registry this file built and a frozen document. */
  interface ArmRow {
    readonly label: string;
    readonly registry: FamilyMigrationRegistry;
    readonly document: unknown;
    readonly expected: string;
  }

  function threeStepRegistry(): FamilyMigrationRegistry {
    return syntheticRegistry({
      family: "results",
      floor: 1,
      current: 4,
      steps: syntheticSteps([] as StepCall[], [["synthetic-v1-to-v2", 1], ["synthetic-v2-to-v3", 2], ["synthetic-v3-to-v4", 3]])
    });
  }

  function brokenStepRegistry(produce: (input: FamilyMigrationStepInput, toVersion: number) => FamilyMigrationStepResult): FamilyMigrationRegistry {
    return syntheticRegistry({
      family: "results",
      floor: 1,
      current: 2,
      steps: [syntheticStep({ id: "synthetic-broken", from: 1, calls: [] as StepCall[], produce: produce })]
    });
  }

  const EXERCISES = createdRegistry(EXERCISES_MIGRATION_REGISTRY_BUILD);
  const RESULTS = createdRegistry(RESULTS_MIGRATION_REGISTRY_BUILD);

  const ARMS: readonly ArmRow[] = [
    { label: "missing version", registry: RESULTS, document: { format: "repjot/results" }, expected: "missing-version" },
    { label: "non-number version", registry: RESULTS, document: { schemaVersion: "1" }, expected: "non-number-version" },
    { label: "non-integer version", registry: RESULTS, document: { schemaVersion: 1.5 }, expected: "non-integer-version" },
    { label: "non-positive version", registry: RESULTS, document: { schemaVersion: 0 }, expected: "non-positive-version" },
    { label: "future version", registry: RESULTS, document: probeDocument(2), expected: "future-version" },
    { label: "zero-step current", registry: EXERCISES, document: { format: "repjot/exercises", schemaVersion: 1 }, expected: "migrated" },
    { label: "unsupported old", registry: syntheticRegistry({ family: "results", floor: 2, current: 3, steps: syntheticSteps([], [["synthetic-v2-to-v3", 2]]) }), document: probeDocument(1), expected: "unsupported-old-version" },
    { label: "chain gap", registry: syntheticRegistry({ family: "results", floor: 1, current: 4, steps: syntheticSteps([], [["synthetic-v1-to-v2", 1]]) }), document: probeDocument(1), expected: "chain-gap" },
    { label: "multi-step success", registry: threeStepRegistry(), document: probeDocument(1), expected: "migrated" },
    { label: "step reported failure", registry: brokenStepRegistry(() => ({ status: "failed", detail: "synthetic-detail" })), document: probeDocument(1), expected: "step-reported-failure" },
    { label: "step result invalid", registry: brokenStepRegistry(() => ({ status: "migrated", document: "not-an-object" })), document: probeDocument(1), expected: "step-result-invalid" },
    { label: "step output unchanged", registry: brokenStepRegistry((input) => ({ status: "migrated", document: input.document })), document: probeDocument(1), expected: "step-output-unchanged" },
    { label: "step output wrong version", registry: brokenStepRegistry(() => ({ status: "migrated", document: { schemaVersion: 7 } })), document: probeDocument(1), expected: "step-output-wrong-version" },
    { label: "step threw", registry: brokenStepRegistry(() => { throw new Error("synthetic defect"); }), document: probeDocument(1), expected: "step-threw" }
  ];

  test("every arm leaves a deeply frozen document byte-identical and stays deep-freezable", () => {
    for (let row = 0; row < ARMS.length; row += 1) {
      const document = ARMS[row].document;
      deepFreeze(document);
      const snapshot = JSON.stringify(document);
      expect(snapshot).toBe(snapshot);
      let raised = "none";
      let result: FamilyMigrationResult | null = null;
      try {
        result = migrate(ARMS[row].registry, document, { exercises: {}, workouts: {} });
      } catch (error) {
        raised = error instanceof Error ? error.name : "unknown";
      }
      expect(ARMS[row].label + " raises nothing").toBe(ARMS[row].label + " raises nothing");
      expect(raised).toBe("none");
      expect(result === null ? "null" : outcomeLabel(result)).toBe(ARMS[row].expected);
      // Byte snapshot, and the freeze the caller asked for is still in place on every nested value.
      expect(JSON.stringify(document)).toBe(snapshot);
      expect(Object.isFrozen(document)).toBe(true);
      const nested = asRecord(document)["sessions"];
      if (Array.isArray(nested) && typeof nested[0] === "object") {
        expect(Object.isFrozen(nested[0])).toBe(true);
      }
    }
  });

  test("every arm repeats identically for the same input and context", () => {
    const context = { exercises: { "exercise-probe": true }, workouts: {} };
    for (let row = 0; row < ARMS.length; row += 1) {
      const first = migrate(ARMS[row].registry, ARMS[row].document, context);
      const second = migrate(ARMS[row].registry, ARMS[row].document, context);
      expect(ARMS[row].label + " is deterministic").toBe(ARMS[row].label + " is deterministic");
      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
      expect(second).toEqual(first);
    }
  });

  test("two equal but distinct documents produce deep-equal results", () => {
    const registry = threeStepRegistry();
    const first = migrate(registry, probeDocument(1), null);
    const second = migrate(registry, probeDocument(1), null);
    expect(outcomeLabel(first)).toBe("migrated");
    expect(outcomeLabel(second)).toBe("migrated");
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    if (first.status === "migrated" && second.status === "migrated") {
      expect(first.appliedStepIds).toEqual(second.appliedStepIds);
      expect(first.document === second.document).toBe(false);
    }
  });

  test("every result, failure, and applied-step list is frozen", () => {
    for (let row = 0; row < ARMS.length; row += 1) {
      const result = migrate(ARMS[row].registry, ARMS[row].document, null);
      expect(Object.isFrozen(result)).toBe(true);
      if (result.status === "failed") {
        expect(Object.isFrozen(result.failure)).toBe(true);
      } else {
        expect(Object.isFrozen(result.appliedStepIds)).toBe(true);
      }
    }
  });

  test("no arm mutates the context it was handed", () => {
    const context: Record<string, unknown> = { exercises: { "exercise-probe": { id: "exercise-probe" } }, workouts: {} };
    deepFreeze(context);
    const snapshot = JSON.stringify(context);
    for (let row = 0; row < ARMS.length; row += 1) {
      migrate(ARMS[row].registry, ARMS[row].document, context);
    }
    expect(JSON.stringify(context)).toBe(snapshot);
  });
});

describe("migration context: handed to each step unchanged, and never built here", () => {
  test("the same context object reaches every step, in application order", () => {
    const calls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "results",
      floor: 1,
      current: 4,
      steps: syntheticSteps(calls, [["synthetic-v1-to-v2", 1], ["synthetic-v2-to-v3", 2], ["synthetic-v3-to-v4", 3]])
    });
    const context = { workouts: { "workout-probe": true }, preferences: {} };
    const result = migrate(registry, probeDocument(1), context);
    expect(outcomeLabel(result)).toBe("migrated");
    expect(calls.length).toBe(3);
    for (let index = 0; index < calls.length; index += 1) {
      expect(calls[index].context === context).toBe(true);
      expect(calls[index].contextWasOwn).toBe(true);
    }
  });

  test("an absent context value is handed through as absent, never substituted", () => {
    const calls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "results",
      floor: 1,
      current: 2,
      steps: syntheticSteps(calls, [["synthetic-v1-to-v2", 1]])
    });
    // The caller owns the context. An `undefined` value arrives as `undefined`, which is how a step learns
    // that a reference family was not loaded, rather than receiving an empty object it might accept.
    expect(outcomeLabel(migrate(registry, probeDocument(1), undefined))).toBe("migrated");
    expect(calls.length).toBe(1);
    expect(calls[0].context === undefined).toBe(true);
    expect(calls[0].contextWasOwn).toBe(true);
  });

  test("a step that needs a reference and does not receive one fails instead of inventing one", () => {
    const calls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "results",
      floor: 1,
      current: 2,
      steps: [
        syntheticStep({
          id: "synthetic-needs-workouts",
          from: 1,
          calls: calls,
          produce: (input) => {
            const workouts = asRecord(input.context)["workouts"];
            if (workouts === undefined) {
              return { status: "failed", detail: "synthetic: no workouts context for shard results-2026-09" };
            }
            return defaultProduce(input, "synthetic-needs-workouts", 2);
          }
        })
      ]
    });
    const without = migrate(registry, probeDocument(1), {});
    expect(outcomeLabel(without)).toBe("step-reported-failure");
    expect(Object.prototype.hasOwnProperty.call(without, "document")).toBe(false);
    const withContext = migrate(registry, probeDocument(1), { workouts: { "workout-probe": true } });
    expect(outcomeLabel(withContext)).toBe("migrated");
    expect(calls.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Group 9: applied step identifiers are the Phase 16 seam, and nothing else (R-13)
// ---------------------------------------------------------------------------

describe("migration result: the applied step identifiers are exactly what provenance needs", () => {
  test("the applied list names every step once, in application order, as strings", () => {
    const calls: StepCall[] = [];
    const registry = syntheticRegistry({
      family: "results",
      floor: 1,
      current: 3,
      steps: syntheticSteps(calls, [["synthetic-v1-to-v2", 1], ["synthetic-v2-to-v3", 2]])
    });
    const result = migrate(registry, probeDocument(1), null);
    expect(result.status).toBe("migrated");
    if (result.status !== "migrated") {
      return;
    }
    const ids: readonly MigrationStepId[] = result.appliedStepIds;
    expect(ids.length).toBe(2);
    expect(typeof ids[0]).toBe("string");
    expect(typeof ids[1]).toBe("string");
    expect(ids.join(",")).toBe("synthetic-v1-to-v2,synthetic-v2-to-v3");
    const registered: string[] = [];
    for (let index = 0; index < registry.steps.length; index += 1) {
      registered.push(registry.steps[index].id);
    }
    expect(ids).toEqual(registered);
  });

  test("the applied list plus the two versions fill an accepted MigrationPath", () => {
    const registry = syntheticRegistry({
      family: "results",
      floor: 1,
      current: 3,
      steps: syntheticSteps([] as StepCall[], [["synthetic-v1-to-v2", 1], ["synthetic-v2-to-v3", 2]])
    });
    const result = migrate(registry, probeDocument(1), null);
    expect(result.status).toBe("migrated");
    if (result.status !== "migrated") {
      return;
    }
    // The accepted Phase 11 record is filled from this result alone: no provenance, digest, normalizer, or
    // validation-version value is invented here for Phase 16 to receive.
    const path: MigrationPath = {
      declaredSchemaVersion: result.declaredSchemaVersion,
      currentSchemaVersion: result.currentSchemaVersion,
      steps: result.appliedStepIds
    };
    expect(path).toEqual({
      declaredSchemaVersion: 1,
      currentSchemaVersion: 3,
      steps: ["synthetic-v1-to-v2", "synthetic-v2-to-v3"]
    });
  });

  test("a success carries the five contract fields and no provenance, digest, or model value", () => {
    const registry = createdRegistry(EXERCISES_MIGRATION_REGISTRY_BUILD);
    const result = migrate(registry, { format: "repjot/exercises", schemaVersion: 1 }, null);
    expect(Object.keys(result).sort().join(","))
      .toBe("appliedStepIds,currentSchemaVersion,declaredSchemaVersion,document,status");
  });
});

// ---------------------------------------------------------------------------
// Group 10: module shape, imports, purity, invented migrations, ES2019 (R-10, R-14, R-15, R-16, R-17)
// ---------------------------------------------------------------------------

const MIGRATIONS_ROOT = "../src/migrations/";

function readSource(relativePath: string): string {
  return readFileSync(new URL(MIGRATIONS_ROOT + relativePath, import.meta.url), "utf8");
}

/** Every TypeScript file under src/migrations, subdirectory included, in name order. */
function migrationSourceFiles(): string[] {
  const found: string[] = [];
  const top = readdirSync(new URL(MIGRATIONS_ROOT, import.meta.url)).sort();
  for (let index = 0; index < top.length; index += 1) {
    const name = top[index];
    if (name === "families") {
      const nested = readdirSync(new URL(MIGRATIONS_ROOT + "families/", import.meta.url)).sort();
      for (let inner = 0; inner < nested.length; inner += 1) {
        if (nested[inner].slice(-3) === ".ts") {
          found.push("families/" + nested[inner]);
        }
      }
      continue;
    }
    if (name.slice(-3) === ".ts") {
      found.push(name);
    }
  }
  return found;
}

function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripLineComments(source: string): string {
  return source.replace(/\/\/[^\n]*/g, "");
}

function stripStrings(source: string): string {
  return source.replace(/"(?:[^"\\]|\\.)*"/g, '""');
}

/** Comments gone: what a capability scan should see. */
function uncommented(source: string): string {
  return stripLineComments(stripBlockComments(source));
}

/** Comments gone and string literals emptied: what a literal or keyword scan should see. */
function codeOnly(source: string): string {
  return stripStrings(uncommented(source));
}

function matchesOf(code: string, pattern: RegExp): string[] {
  const found: string[] = [];
  const global = new RegExp(pattern.source, pattern.flags.indexOf("g") === -1 ? pattern.flags + "g" : pattern.flags);
  let hit = global.exec(code);
  while (hit !== null) {
    found.push(hit[0]);
    hit = global.exec(code);
  }
  return found;
}

/** Import specifiers, read from the code so no comment can add or hide one. */
function importSpecifiers(source: string): string[] {
  return matchesOf(uncommented(source), /from\s+"[^"]*"/).map((hit) => hit.replace(/^from\s+"*/, "").replace(/"$/, ""));
}

/**
 * One scanned token as a pattern. A word boundary is added only when the token starts like an identifier,
 * because a boundary before an escaped dollar or dot token can never match, so a real hit
 * would pass unseen.
 */
function tokenPattern(token: string): RegExp {
  const first = token.charAt(0);
  return new RegExp(/^[A-Za-z0-9_]/.test(first) ? "\\b" + token : token);
}

/** The module and token of one scan row, as it appears in a failure message. */
function describeRow(token: string, found: boolean): string {
  return token + ": " + String(found);
}

/** Capability identifiers that must not appear in any code of src/migrations/**. */
const FORBIDDEN_CAPABILITIES: readonly string[] = [
  "Date", "Intl", "Intl\\.", "Math\\.random", "randomUUID", "crypto", "fetch", "XMLHttpRequest", "localStorage",
  "sessionStorage", "indexedDB", "IDBKeyRange", "navigator", "window", "screen", "WebSocket", "EventSource",
  "setTimeout", "setInterval", "performance", "console", "process", "require", "module\\.exports", "eval",
  "TextDecoder", "TextEncoder", "readFileSync", "writeFileSync", "readdirSync", "node:", "svelte", "Svelte",
  "writable", "Ajv", "ajv", "Drive", "drive", "btoa", "atob", "postMessage", "Blob", "Worker"
];

/** Syntax and library members newer than ES2019, scanned on raw source, comments included. */
const FORBIDDEN_ES2020_TOKENS: readonly string[] = [
  "?.", "??", "??=", "||=", "&&=", "replaceAll", "matchAll", "Object.hasOwn", "globalThis", "structuredClone",
  "BigInt", "WeakRef", ".at(", "toSorted", "toReversed", "findLast", "allSettled", "import.meta", "Object.entries"
];

/** A second validator, a schema document, or a schema identity must not exist in src/migrations/**. */
const FORBIDDEN_VALIDATOR_TOKENS: readonly string[] = [
  "\\$id", "schemas/", "\\.schema\\.json", "SUPPORTED_SCHEMA_IDENTITIES", "createSchemaRegistry",
  "getProductionRegistry", "createSchemaValidator", "SchemaRegistry", "SchemaProblem", "validate", "assert\\(",
  "recognizeEnvelope", "recognizeLogicalName", "JSON\\.parse", "JSON\\.stringify"
];

/** A provenance, normalizer, digest, pipeline-error, or stage value must not be built in src/migrations/**. */
const FORBIDDEN_LATER_PHASE_TOKENS: readonly string[] = [
  "MigrationPath", "DocumentProvenance", "provenance", "SourceDigest", "sourceDigest", "digest", "normali",
  "PipelineError", "makePipelineError", "PipelineStage", "PipelineResult", "PIPELINE_STAGES", "stage",
  "fetch", "static-loader", "StaticLoader", "yearMonthUtc", "shardName"
];

describe("migration modules: shape, imports, purity, and ES2019 output", () => {
  const FILES = migrationSourceFiles();

  test("src/migrations holds one registry module and four family modules, and nothing else", () => {
    expect(FILES).toEqual([
      "families/exercises.ts",
      "families/preferences.ts",
      "families/results.ts",
      "families/workouts.ts",
      "migration-registry.ts"
    ]);
  });

  test("the registry imports the accepted family constants only, and each family file imports the registry only", () => {
    for (let index = 0; index < FILES.length; index += 1) {
      const file = FILES[index];
      const specifiers = importSpecifiers(readSource(file));
      const expected = file === "migration-registry.ts" ? "../domain/families" : "../migration-registry";
      expect(file + " imports something").toBe(file + " imports something");
      expect(specifiers.length).toBe(2);
      for (let each = 0; each < specifiers.length; each += 1) {
        expect(specifiers[each]).toBe(expected);
      }
    }
  });

  test("no migration module imports a document, validation, node, schema, browser, or infrastructure module", () => {
    for (let index = 0; index < FILES.length; index += 1) {
      const specifiers = importSpecifiers(readSource(FILES[index]));
      for (let each = 0; each < specifiers.length; each += 1) {
        const specifier = specifiers[each];
        expect(describeRow("node", specifier.indexOf("node:") !== -1)).toBe(describeRow("node", false));
        expect(describeRow("documents", specifier.indexOf("documents") !== -1)).toBe(describeRow("documents", false));
        expect(describeRow("validation", specifier.indexOf("validation") !== -1)).toBe(describeRow("validation", false));
        expect(describeRow("schemas", specifier.indexOf("schemas") !== -1)).toBe(describeRow("schemas", false));
        expect(describeRow("svelte", specifier.toLowerCase().indexOf("svelte") !== -1)).toBe(describeRow("svelte", false));
        expect(describeRow("absolute", specifier.charAt(0) === "/")).toBe(describeRow("absolute", false));
      }
      const code = codeOnly(readSource(FILES[index]));
      expect(describeRow("require(", matchesOf(code, /\brequire\s*\(/).length > 0)).toBe(describeRow("require(", false));
      expect(describeRow("dynamic import(", matchesOf(code, /\bimport\s*\(/).length > 0)).toBe(describeRow("dynamic import(", false));
      expect(describeRow("export *", matchesOf(code, /export\s+\*/).length > 0)).toBe(describeRow("export *", false));
    }
  });

  test("nothing imports src/migrations yet, so no shipped bundle changes", () => {
    const consumers = [
      "../src/main.ts",
      "../src/documents/document-pipeline.ts",
      "../src/documents/envelope.ts",
      "../src/documents/pipeline-types.ts",
      "../src/documents/safe-json-parser.ts",
      "../src/domain/families.ts"
    ];
    for (let index = 0; index < consumers.length; index += 1) {
      const source = readFileSync(new URL(consumers[index], import.meta.url), "utf8");
      const hits = matchesOf(uncommented(source), /from\s+"[^"]*migrations[^"]*"/);
      expect(consumers[index] + " imports migrations: " + String(hits.length === 0)).toBe(
        consumers[index] + " imports migrations: true"
      );
    }
  });

  test("no clock, locale, random, DOM, storage, Drive, IndexedDB, Svelte, or node module appears in any module", () => {
    for (let index = 0; index < FILES.length; index += 1) {
      const code = uncommented(readSource(FILES[index]));
      for (let row = 0; row < FORBIDDEN_CAPABILITIES.length; row += 1) {
        const pattern = tokenPattern(FORBIDDEN_CAPABILITIES[row]);
        expect(FILES[index] + " " + describeRow(FORBIDDEN_CAPABILITIES[row], pattern.test(code)))
          .toBe(FILES[index] + " " + describeRow(FORBIDDEN_CAPABILITIES[row], false));
      }
      expect(FILES[index] + " document. member access: " + String(code.indexOf("document.") !== -1))
        .toBe(FILES[index] + " document. member access: false");
    }
  });

  test("no second validator, schema, shape inference, or envelope reader exists in any module", () => {
    for (let index = 0; index < FILES.length; index += 1) {
      const code = codeOnly(readSource(FILES[index]));
      for (let row = 0; row < FORBIDDEN_VALIDATOR_TOKENS.length; row += 1) {
        const pattern = tokenPattern(FORBIDDEN_VALIDATOR_TOKENS[row]);
        expect(FILES[index] + " " + describeRow(FORBIDDEN_VALIDATOR_TOKENS[row], pattern.test(code)))
          .toBe(FILES[index] + " " + describeRow(FORBIDDEN_VALIDATOR_TOKENS[row], false));
      }
    }
  });

  test("no later-phase value is constructed here: no provenance, digest, normalizer, stage, or pipeline error", () => {
    for (let index = 0; index < FILES.length; index += 1) {
      const code = codeOnly(readSource(FILES[index]));
      for (let row = 0; row < FORBIDDEN_LATER_PHASE_TOKENS.length; row += 1) {
        const pattern = tokenPattern(FORBIDDEN_LATER_PHASE_TOKENS[row]);
        expect(FILES[index] + " " + describeRow(FORBIDDEN_LATER_PHASE_TOKENS[row], pattern.test(code)))
          .toBe(FILES[index] + " " + describeRow(FORBIDDEN_LATER_PHASE_TOKENS[row], false));
      }
    }
  });

  test("no module raises: the keyword throw appears in no code of src/migrations", () => {
    for (let index = 0; index < FILES.length; index += 1) {
      const code = codeOnly(readSource(FILES[index]));
      expect(FILES[index] + " throw: " + String(matchesOf(code, /\bthrow\b/).length)).toBe(FILES[index] + " throw: 0");
    }
  });

  test("no module uses syntax newer than ES2019", () => {
    for (let index = 0; index < FILES.length; index += 1) {
      const source = readSource(FILES[index]);
      for (let row = 0; row < FORBIDDEN_ES2020_TOKENS.length; row += 1) {
        expect(FILES[index] + " " + describeRow(FORBIDDEN_ES2020_TOKENS[row], source.indexOf(FORBIDDEN_ES2020_TOKENS[row]) !== -1))
          .toBe(FILES[index] + " " + describeRow(FORBIDDEN_ES2020_TOKENS[row], false));
      }
    }
  });

  test("a family module declares no step, no version, and no numeric literal of its own", () => {
    const familyFiles = ["families/exercises.ts", "families/workouts.ts", "families/preferences.ts", "families/results.ts"];
    for (let index = 0; index < familyFiles.length; index += 1) {
      const code = codeOnly(readSource(familyFiles[index]));
      // No step shape, so no executable migration step; and no version literal of any kind, so no `v0`
      // constant and no re-declared current or floor value.
      const literals = matchesOf(code, /(?<![\w.])\d+(?:\.\d+)?(?![\w])/);
      expect(familyFiles[index] + " numeric literals: " + literals.join("|")).toBe(familyFiles[index] + " numeric literals: ");
      for (let row = 0; row < FORBIDDEN_STEP_TOKENS.length; row += 1) {
        expect(familyFiles[index] + " " + describeRow(FORBIDDEN_STEP_TOKENS[row], code.indexOf(FORBIDDEN_STEP_TOKENS[row]) !== -1))
          .toBe(familyFiles[index] + " " + describeRow(FORBIDDEN_STEP_TOKENS[row], false));
      }
    }
  });

  test("the registry module's only numeric literals are zero and one", () => {
    const literals = matchesOf(codeOnly(readSource("migration-registry.ts")), /(?<![\w.])\d+(?:\.\d+)?(?![\w])/);
    expect(literals.length > 0).toBe(true);
    for (let index = 0; index < literals.length; index += 1) {
      expect(literals[index] + " is zero or one").toBe(literals[index] + " is zero or one");
      expect(literals[index] === "0" || literals[index] === "1").toBe(true);
    }
  });
});

/** The step-shape and version tokens that would mean a family file declares a migration of its own. */
const FORBIDDEN_STEP_TOKENS: readonly string[] = [
  "fromSchemaVersion", "toSchemaVersion", "migrate", "migrated", "FamilyMigrationStepInput", "v0", "schemaVersion"
];

// ---------------------------------------------------------------------------
// Compile-time probes. Never called: `bun run check` runs their evidence, because an expect-error
// directive is itself an error when the line under it compiles.
// ---------------------------------------------------------------------------

function migrationRegistryTypeProbes(): void {
  const registry = createdRegistry(RESULTS_MIGRATION_REGISTRY_BUILD);
  const result = registry.migrate({ document: { schemaVersion: 1 }, context: null });

  // A request is a document and a caller's context: no third channel for a Drive value, a shape hint, or a
  // context the registry might be tempted to build.
  // @ts-expect-error a request with no context does not compile
  const requestWithoutContext = registry.migrate({ document: {} });

  // The two result arms stay separate, so a caller cannot read a document out of a rejection.
  // @ts-expect-error a rejected result has no document field
  const documentOfARejection = result.status === "failed" ? result.document : null;
  // @ts-expect-error a migrated result has no failure field
  const failureOfAMigration = result.status === "migrated" ? result.failure : null;

  // The applied step list is read-only, so Phase 16 cannot reorder what was applied.
  if (result.status === "migrated") {
    // @ts-expect-error the applied step identifier list cannot be written to
    result.appliedStepIds.push("synthetic-appended");
  }

  // A step must declare the one version it accepts and the one it produces.
  // @ts-expect-error a step with no produced version does not compile
  const stepWithoutOutputVersion: FamilyMigrationStep = {
    id: "synthetic-incomplete",
    fromSchemaVersion: 1,
    migrate: () => ({ status: "migrated", document: {} })
  };

  // The applied identifiers are the accepted `MigrationStepId` type, and the three fields together fill the
  // accepted `MigrationPath`, which is the whole Phase 16 seam.
  if (result.status === "migrated") {
    const identifiers: readonly MigrationStepId[] = result.appliedStepIds;
    const path: MigrationPath = {
      declaredSchemaVersion: result.declaredSchemaVersion,
      currentSchemaVersion: result.currentSchemaVersion,
      steps: identifiers
    };
    void path;
  }
  void requestWithoutContext;
  void documentOfARejection;
  void failureOfAMigration;
  void stepWithoutOutputVersion;
}
