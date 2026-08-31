/**
 * Focused tests for the Draft 2020-12 schema registry (P3-T01).
 *
 * Covers: production registration of the exact repository `$id`s, once-per-registry compilation,
 * the shared once-compiled production registry (ADR-005), duplicate IDs, invalid schemas,
 * unsupported drafts, unexpected IDs, unresolved references, failed-registry isolation (no
 * poisoning of later or default compilations), and deterministic repeated construction. No clocks, randomness, network, or DOM access; inputs are never mutated.
 */
import { describe, expect, test } from "bun:test";

import {
  createProductionAjv,
  createSchemaRegistry,
  getProductionRegistry,
  SCHEMA_DRAFT_2020_12,
  SUPPORTED_SCHEMA_IDENTITIES
} from "../../src/validation/schema-registry";

import exercisesV1 from "../../schemas/exercises/v1.schema.json";
import preferencesV1 from "../../schemas/preferences/v1.schema.json";
import resultsV1 from "../../schemas/results/v1.schema.json";
import workoutsV1 from "../../schemas/workouts/v1.schema.json";

const EXERCISES_ID = "https://repjot.com/schemas/exercises/v1.schema.json";
const WORKOUTS_ID = "https://repjot.com/schemas/workouts/v1.schema.json";
const PREFERENCES_ID = "https://repjot.com/schemas/preferences/v1.schema.json";
const RESULTS_ID = "https://repjot.com/schemas/results/v1.schema.json";

function minimalPreferences(): Record<string, unknown> {
  return {
    format: "repjot/preferences",
    schemaVersion: 1,
    revision: 0,
    updatedAtUtc: "2026-09-01T06:30:00Z",
    exerciseUnits: {}
  };
}

describe("production registry", () => {
  test("registers the exact repository $ids and compiles each supported schema once", () => {
    const registry = createSchemaRegistry();
    expect(registry.problems).toEqual([]);
    for (const identity of SUPPORTED_SCHEMA_IDENTITIES) {
      expect(identity.id).toBe(
        "https://repjot.com/schemas/" + identity.family + "/v1.schema.json"
      );
      expect(registry.has(identity.family, identity.version)).toBe(true);
      const validator = registry.getValidator(identity.family, identity.version);
      expect(validator).not.toBeNull();
      // The same compiled function is returned on every call: compiled once.
      expect(registry.getValidator(identity.family, identity.version)).toBe(validator);
    }
  });

  test("the results external reference to workouts resolves through the registry", () => {
    const registry = createSchemaRegistry();
    const session = {
      id: "session-6f1e2d3c-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
      workoutId: "workout-1",
      status: "in_progress",
      startedAtUtc: "2026-09-01T06:30:00Z",
      updatedAtUtc: "2026-09-01T06:30:00Z",
      executionPlan: {
        id: "root-1",
        type: "container",
        strategy: "sequence",
        strategyConfig: {},
        children: []
      },
      results: []
    };
    const document = {
      format: "repjot/results",
      schemaVersion: 1,
      yearMonthUtc: "2026-09",
      sessions: [session],
      sessionTombstones: []
    };
    const validator = registry.getValidator("results", 1);
    expect(validator(document)).toBe(true);

    // A structurally wrong executionPlan fails through the referenced workouts definition.
    const broken = JSON.parse(JSON.stringify(document));
    delete broken.sessions[0].executionPlan.strategyConfig;
    expect(validator(broken)).toBe(false);
    const paths = (validator.errors as Array<{ instancePath: string }>).map(
      (error) => error.instancePath
    );
    expect(paths).toContain("/sessions/0/executionPlan");
  });

  test("compilation is deterministic across separately built default registries", () => {
    const first = createSchemaRegistry();
    const second = createSchemaRegistry();
    expect(first.problems).toEqual(second.problems);
    const document = minimalPreferences();
    expect(first.getValidator("preferences", 1)(document)).toBe(true);
    expect(second.getValidator("preferences", 1)(document)).toBe(true);
  });

  test("the production Ajv asserts date-time as an assertion, not an annotation", () => {
    const ajv = createProductionAjv();
    const validate = ajv.compile({ type: "string", format: "date-time" });
    expect(validate("2026-09-01T06:30:00Z")).toBe(true);
    expect(validate("2024-02-29T00:00:00Z")).toBe(true);
    // RFC 3339 section 5.6 allows second 60 for leap seconds.
    expect(validate("2016-12-31T23:59:60Z")).toBe(true);
    expect(validate("2026-09-01T06:30:60.5Z")).toBe(true);
    expect(validate("2026-08-31T23:59:60-07:00")).toBe(true);
    // The format layer accepts RFC 3339 lowercase z; FF-12 rejects it via the schema `Z$` pattern.
    expect(validate("2026-09-01T06:30:00z")).toBe(true);
    expect(validate("2026-02-30T00:00:00Z")).toBe(false);
    expect(validate("2026-04-31T12:00:00Z")).toBe(false);
    expect(validate("2026-02-30T23:59:60Z")).toBe(false);
    expect(validate("2026-09-01 06:30:00Z")).toBe(false);
    expect(validate("2026-08-31T23:30:00-07:00")).toBe(true);
    expect(validate(42 as unknown as string)).toBe(false);
  });

  test("the numeric offset requires the full RFC 3339 time-numoffset +/-(HH):(MM) pair", () => {
    const ajv = createProductionAjv();
    const validate = ajv.compile({ type: "string", format: "date-time" });
    // Valid full offsets (positive and negative) stay accepted.
    expect(validate("2026-08-31T23:59:60+07:00")).toBe(true);
    expect(validate("2026-08-31T23:59:60-07:00")).toBe(true);
    // Colonless offset is not time-numoffset and is rejected.
    expect(validate("2026-08-31T23:59:60-0700")).toBe(false);
    expect(validate("2026-08-31T23:59:60+0700")).toBe(false);
    // A bare hour without a minute pair is rejected.
    expect(validate("2026-08-31T23:59:60-07")).toBe(false);
    expect(validate("2026-08-31T23:59:60+07")).toBe(false);
    // Out-of-range offset components are rejected.
    expect(validate("2026-08-31T23:59:60+24:00")).toBe(false);
    expect(validate("2026-08-31T23:59:60-07:60")).toBe(false);
  });
});

describe("shared production registry (ADR-005)", () => {
  test("getProductionRegistry returns one lazily built instance with every schema compiled once", () => {
    const first = getProductionRegistry();
    expect(getProductionRegistry()).toBe(first);
    expect(getProductionRegistry()).toBe(first);
    expect(first.problems).toEqual([]);
    for (const identity of SUPPORTED_SCHEMA_IDENTITIES) {
      const compiled = first.getValidator(identity.family, identity.version);
      expect(compiled).not.toBeNull();
      // The same compiled function is returned on every call: compiled once.
      expect(first.getValidator(identity.family, identity.version)).toBe(compiled);
    }
  });

  test("a failed custom registry cannot poison the shared production registry", () => {
    const shared = getProductionRegistry();
    const compiled = SUPPORTED_SCHEMA_IDENTITIES.map(
      (identity) => shared.getValidator(identity.family, identity.version)
    );

    // A broken custom registry fails closed inside its own Ajv instance.
    const broken = createSchemaRegistry({ schemas: [workoutsV1 as unknown, workoutsV1 as unknown] });
    expect(broken.problems).toEqual([
      { code: "duplicate-schema-id", id: WORKOUTS_ID, detail: "two or more registered schemas declare the same $id" }
    ]);

    // The shared registry is still the same instance, still clean, with the exact same compiled
    // validator functions.
    expect(getProductionRegistry()).toBe(shared);
    expect(shared.problems).toEqual([]);
    for (let i = 0; i < SUPPORTED_SCHEMA_IDENTITIES.length; i += 1) {
      const identity = SUPPORTED_SCHEMA_IDENTITIES[i];
      expect(shared.getValidator(identity.family, identity.version)).toBe(compiled[i]);
    }
  });

  test("isolated fresh default registries remain available and distinct from the shared one", () => {
    const shared = getProductionRegistry();
    const fresh = createSchemaRegistry();
    expect(fresh).not.toBe(shared);
    expect(fresh.problems).toEqual([]);
    // Separate Ajv instances compile separate validator functions.
    expect(fresh.getValidator("workouts", 1)).not.toBe(shared.getValidator("workouts", 1));
  });
});

describe("custom registries", () => {
  test("duplicate $id fails closed and leaves a later default registry clean", () => {
    const broken = createSchemaRegistry({ schemas: [workoutsV1 as unknown, workoutsV1 as unknown] });
    expect(broken.problems).toEqual([
      {
        code: "duplicate-schema-id",
        id: WORKOUTS_ID,
        detail: "two or more registered schemas declare the same $id"
      }
    ]);
    expect(broken.has("workouts", 1)).toBe(false);
    expect(broken.getValidator("workouts", 1)).toBeNull();

    // The failed custom registry must not poison a later default compilation.
    const fresh = createSchemaRegistry();
    expect(fresh.problems).toEqual([]);
    expect(fresh.has("workouts", 1)).toBe(true);
    expect(fresh.getValidator("workouts", 1)({ format: "repjot/workouts", schemaVersion: 1, workouts: [] })).toBe(true);
  });

  test("duplicate detection is deterministic across identically built registries", () => {
    const first = createSchemaRegistry({ schemas: [workoutsV1 as unknown, workoutsV1 as unknown] });
    const second = createSchemaRegistry({ schemas: [workoutsV1 as unknown, workoutsV1 as unknown] });
    expect(second.problems).toEqual(first.problems);
  });

  test("an unresolved external reference reports unresolved-reference", () => {
    const document = {
      $schema: SCHEMA_DRAFT_2020_12,
      $id: WORKOUTS_ID,
      type: "object",
      properties: { missing: { $ref: "https://repjot.com/schemas/absent/v1.schema.json" } }
    };
    const registry = createSchemaRegistry({ schemas: [document] });
    expect(registry.problems).toEqual([
      {
        code: "unresolved-reference",
        id: WORKOUTS_ID,
        detail: "a $ref in the schema does not resolve to a registered schema"
      }
    ]);
    expect(registry.getValidator("workouts", 1)).toBeNull();
  });

  test("results without the workouts schema reports an unresolved reference", () => {
    const registry = createSchemaRegistry({ schemas: [resultsV1 as unknown] });
    expect(registry.problems).toEqual([
      { code: "unresolved-reference", id: RESULTS_ID, detail: "a $ref in the schema does not resolve to a registered schema" }
    ]);
    expect(registry.has("results", 1)).toBe(false);
  });

  test("an invalid schema reports invalid-schema without blocking sibling schemas", () => {
    const invalid = { $schema: SCHEMA_DRAFT_2020_12, $id: EXERCISES_ID, type: "not-a-type" };
    const registry = createSchemaRegistry({ schemas: [invalid, preferencesV1 as unknown] });
    expect(registry.problems).toEqual([
      { code: "invalid-schema", id: EXERCISES_ID, detail: "the schema document does not compile under Draft 2020-12 strict mode" }
    ]);
    expect(registry.has("exercises", 1)).toBe(false);
    // The sibling schema still compiles and validates in the same registry.
    expect(registry.has("preferences", 1)).toBe(true);
    expect(registry.getValidator("preferences", 1)(minimalPreferences())).toBe(true);
  });

  test("an unknown keyword fails under strict mode as invalid-schema", () => {
    const invalid = {
      $schema: SCHEMA_DRAFT_2020_12,
      $id: EXERCISES_ID,
      type: "object",
      inventedKeyword: true
    };
    const registry = createSchemaRegistry({ schemas: [invalid] });
    expect(registry.problems.map((problem) => problem.code)).toEqual(["invalid-schema"]);
  });

  test("a non-2020-12 draft is rejected as unsupported-draft", () => {
    const document = {
      ...workoutsV1,
      $schema: "https://json-schema.org/draft/2020-09/schema"
    } as unknown;
    const registry = createSchemaRegistry({ schemas: [document] });
    expect(registry.problems).toEqual([
      { code: "unsupported-draft", id: WORKOUTS_ID, detail: "the schema does not declare Draft 2020-12" }
    ]);
    expect(registry.has("workouts", 1)).toBe(false);
  });

  test("an unsupported $id is rejected as unexpected-schema-id", () => {
    const foreign = {
      ...exercisesV1,
      $id: "https://example.org/schemas/exercises/v1.schema.json"
    } as unknown;
    const registry = createSchemaRegistry({ schemas: [foreign] });
    expect(registry.problems).toEqual([
      { code: "unexpected-schema-id", id: "https://example.org/schemas/exercises/v1.schema.json", detail: "the schema $id is not a supported REP JOT schema id" }
    ]);
    expect(registry.has("exercises", 1)).toBe(false);
  });

  test("a document without a string $id is rejected and stays deterministic", () => {
    const first = createSchemaRegistry({ schemas: [{ type: "object" }] });
    const second = createSchemaRegistry({ schemas: [{ type: "object" }] });
    expect(first.problems).toEqual([
      { code: "unexpected-schema-id", id: "", detail: "the schema $id is not a supported REP JOT schema id" }
    ]);
    expect(second.problems).toEqual(first.problems);
  });

  test("a custom Ajv factory seam is used without weakening a separate default registry", () => {
    let factoryCalls = 0;
    const registry = createSchemaRegistry({
      schemas: [preferencesV1 as unknown],
      createAjv: () => {
        factoryCalls += 1;
        return createProductionAjv();
      }
    });
    expect(factoryCalls).toBe(1);
    expect(registry.problems).toEqual([]);
    expect(registry.has("preferences", 1)).toBe(true);

    const fresh = createSchemaRegistry();
    expect(fresh.problems).toEqual([]);
    expect(fresh.getValidator("workouts", 1)({ format: "repjot/workouts", schemaVersion: 1, workouts: [] })).toBe(true);
  });
});
