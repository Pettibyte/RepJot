/**
 * Focused tests for the schema validator diagnostics (P3-T01).
 *
 * Covers: valid Z timestamps, offset and lowercase-z rejection, impossible calendar dates,
 * unknown family/version codes, registry failure pass-through, production validator sharing of
 * the once-compiled registry (ADR-005), input immutability, deterministic repeated validation,
 * and diagnostic safety (no raw document values in results). Authority:
 * docs/contracts/families-and-files.md FF-12 and FF-17.
 */
import { describe, expect, test } from "bun:test";

import {
  createSchemaRegistry,
  getProductionRegistry,
  SUPPORTED_SCHEMA_IDENTITIES
} from "../../src/validation/schema-registry";
import {
  createProductionValidator,
  createSchemaValidator
} from "../../src/validation/schema-validator";
import type { ValidationResult } from "../../src/validation/schema-validator";

import workoutsV1 from "../../schemas/workouts/v1.schema.json";

const validator = createProductionValidator();

/** One completed session in UTC month 2026-09; `startedAtUtc` is the test's variable. */
function resultsDocument(startedAtUtc: string): Record<string, unknown> {
  return {
    format: "repjot/results",
    schemaVersion: 1,
    yearMonthUtc: "2026-09",
    sessions: [
      {
        id: "session-6f1e2d3c-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
        workoutId: "workout-1",
        status: "completed",
        startedAtUtc,
        endedAtUtc: "2026-09-01T07:00:00Z",
        updatedAtUtc: "2026-09-01T07:00:00Z",
        results: []
      }
    ],
    sessionTombstones: []
  };
}

function errorAt(result: ValidationResult, instancePath: string): Array<{ keyword: string }> {
  return result.errors.filter((error) => error.instancePath === instancePath);
}

describe("UTC timestamp assertions (FF-12)", () => {
  test("a valid Z timestamp is accepted", () => {
    const result = validator.validate("results", 1, resultsDocument("2026-09-01T06:30:00Z"));
    expect(result.valid).toBe(true);
    expect(result.code).toBe("valid");
    expect(result.errors).toEqual([]);
  });

  test("a leap day in a leap year is accepted", () => {
    const result = validator.validate("results", 1, resultsDocument("2024-02-29T06:30:00Z"));
    expect(result.valid).toBe(true);
  });

  test("a numeric offset is rejected at the timestamp path with the pattern keyword", () => {
    const result = validator.validate("results", 1, resultsDocument("2026-08-31T23:30:00-07:00"));
    expect(result.valid).toBe(false);
    const errors = errorAt(result, "/sessions/0/startedAtUtc");
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.map((error) => error.keyword)).toContain("pattern");
  });

  test("a lowercase z is rejected at the timestamp path with the pattern keyword", () => {
    const result = validator.validate("results", 1, resultsDocument("2026-09-01T06:30:00z"));
    expect(result.valid).toBe(false);
    const errors = errorAt(result, "/sessions/0/startedAtUtc");
    expect(errors.map((error) => error.keyword)).toContain("pattern");
  });

  test("a space separator is rejected with the format keyword even though it ends in Z", () => {
    const result = validator.validate("results", 1, resultsDocument("2026-09-01 06:30:00Z"));
    expect(result.valid).toBe(false);
    const errors = errorAt(result, "/sessions/0/startedAtUtc");
    expect(errors.map((error) => error.keyword)).toContain("format");
  });

  test("impossible calendar dates are rejected with the format keyword", () => {
    for (const value of ["2026-02-30T00:00:00Z", "2026-04-31T12:00:00Z", "2026-02-29T00:00:00Z"]) {
      const result = validator.validate("results", 1, resultsDocument(value));
      expect(result.valid).toBe(false);
      const errors = errorAt(result, "/sessions/0/startedAtUtc");
      expect(errors.map((error) => error.keyword)).toContain("format");
    }
  });

  test("every *Utc field is asserted: tombstone timestamps too", () => {
    const document = resultsDocument("2026-09-01T06:30:00Z");
    document["sessionTombstones"] = [
      {
        sessionId: "session-6f1e2d3c-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
        deletedAtUtc: "not-a-timestamp"
      }
    ];
    const result = validator.validate("results", 1, document);
    expect(result.valid).toBe(false);
    expect(errorAt(result, "/sessionTombstones/0/deletedAtUtc").length).toBeGreaterThan(0);
  });
});

describe("selector handling", () => {
  test("an unknown family reports unknown-family with no errors", () => {
    for (const familyName of ["repjot/results", "bogus", "", 42 as unknown as string]) {
      const result = validator.validate(familyName, 1, {});
      expect(result.valid).toBe(false);
      expect(result.code).toBe("unknown-family");
      expect(result.errors).toEqual([]);
    }
  });

  test("an unknown or non-integer version reports unknown-version", () => {
    for (const version of [2, 0, -1, 1.5, "1", null, undefined]) {
      const result = validator.validate("results", version, resultsDocument("2026-09-01T06:30:00Z"));
      expect(result.valid).toBe(false);
      expect(result.code).toBe("unknown-version");
      expect(result.errors).toEqual([]);
    }
  });

  test("a registry-level failure passes through its stable problem code", () => {
    const brokenRegistry = createSchemaRegistry({
      schemas: [{ $schema: "https://json-schema.org/draft/2020-12/schema", $id: "https://repjot.com/schemas/results/v1.schema.json", type: "not-a-type" }]
    });
    const brokenValidator = createSchemaValidator(brokenRegistry);
    const result = brokenValidator.validate("results", 1, resultsDocument("2026-09-01T06:30:00Z"));
    expect(result.valid).toBe(false);
    expect(result.code).toBe("invalid-schema");
    expect(result.errors).toEqual([]);

    // The production validator is unaffected by the broken custom registry.
    const fresh = createProductionValidator();
    expect(fresh.validate("results", 1, resultsDocument("2026-09-01T06:30:00Z")).valid).toBe(true);
  });
});

describe("production validator sharing (ADR-005)", () => {
  test("repeated production acquisitions share one registry and its compiled validators", () => {
    const first = createProductionValidator();
    const second = createProductionValidator();

    // Every default acquisition reuses the single shared production registry.
    expect(first.registry).toBe(second.registry);
    expect(first.registry).toBe(getProductionRegistry());

    // The compiled validator functions are identical across acquisitions: each schema compiles once.
    for (const identity of SUPPORTED_SCHEMA_IDENTITIES) {
      const compiled = first.registry.getValidator(identity.family, identity.version);
      expect(compiled).not.toBeNull();
      expect(second.registry.getValidator(identity.family, identity.version)).toBe(compiled);
    }

    // Both acquisitions validate identically through the shared compiled validators.
    const document = resultsDocument("2026-09-01T06:30:00Z");
    expect(first.validate("results", 1, document).valid).toBe(true);
    expect(second.validate("results", 1, document)).toEqual(first.validate("results", 1, document));
  });

  test("a failed custom registry stays isolated from the shared production registry", () => {
    const shared = getProductionRegistry();
    const compiled = SUPPORTED_SCHEMA_IDENTITIES.map(
      (identity) => shared.getValidator(identity.family, identity.version)
    );

    // A broken custom registry fails closed inside its own Ajv instance.
    const broken = createSchemaRegistry({ schemas: [workoutsV1 as unknown, workoutsV1 as unknown] });
    expect(broken.problems.length).toBeGreaterThan(0);
    const brokenValidator = createSchemaValidator(broken);
    expect(brokenValidator.registry).toBe(broken);

    // The shared production registry is still the same instance, still clean, with the exact same
    // compiled validator functions; a fresh acquisition sees no change.
    expect(getProductionRegistry()).toBe(shared);
    expect(shared.problems).toEqual([]);
    for (let i = 0; i < SUPPORTED_SCHEMA_IDENTITIES.length; i += 1) {
      const identity = SUPPORTED_SCHEMA_IDENTITIES[i];
      expect(shared.getValidator(identity.family, identity.version)).toBe(compiled[i]);
    }
    const freshProduction = createProductionValidator();
    expect(freshProduction.registry).toBe(shared);
    expect(freshProduction.validate("results", 1, resultsDocument("2026-09-01T06:30:00Z")).valid).toBe(true);
  });
});

describe("diagnostic stability and safety", () => {
  test("repeated validation of the same input returns identical results", () => {
    const document = resultsDocument("2026-08-31T23:30:00-07:00");
    const first = validator.validate("results", 1, document);
    const second = validator.validate("results", 1, document);
    expect(second).toEqual(first);
    // Interleaving a valid call does not change the invalid outcome.
    validator.validate("results", 1, resultsDocument("2026-09-01T06:30:00Z"));
    expect(validator.validate("results", 1, document)).toEqual(first);
  });

  test("the input document is never mutated by validation", () => {
    const document = resultsDocument("2026-08-31T23:30:00-07:00");
    document["sessions"][0]["notes"] = "keep me";
    const snapshot = JSON.stringify(document);
    validator.validate("results", 1, document);
    validator.validate("results", 1, resultsDocument("2026-09-01T06:30:00Z"));
    expect(JSON.stringify(document)).toBe(snapshot);

    const frozen = JSON.parse(JSON.stringify(resultsDocument("2026-09-01T06:30:00Z")));
    deepFreeze(frozen);
    const result = validator.validate("results", 1, frozen);
    expect(result.valid).toBe(true);
  });

  test("diagnostics carry only safe fields and never expose raw document values", () => {
    const document = resultsDocument("2026-09-01T06:30:00Z");
    (document["sessions"][0] as Record<string, unknown>)["status"] = "SECRET-STATUS-VALUE";
    (document["sessions"][0] as Record<string, unknown>)["notes"] = "SECRET-NOTES-VALUE";
    (document["sessions"][0] as Record<string, unknown>)["unexpectedKey"] = { deep: "SECRET-DEEP" };
    const result = validator.validate("results", 1, document);
    expect(result.valid).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized.indexOf("SECRET")).toBe(-1);

    // The extra property is identified structurally by name, not by value.
    const extras = result.errors.filter((error) => error.keyword === "additionalProperties");
    expect(extras.length).toBe(1);
    expect(extras[0].instancePath).toBe("/sessions/0");
    expect(extras[0]["property"]).toBe("unexpectedKey");
  });

  test("required failures name the missing property and keep fixed messages", () => {
    const document = resultsDocument("2026-09-01T06:30:00Z");
    delete (document["sessions"][0] as Record<string, unknown>)["updatedAtUtc"];
    const result = validator.validate("results", 1, document);
    expect(result.valid).toBe(false);
    const required = result.errors.filter(
      (error) => error.keyword === "required" && error.instancePath === "/sessions/0"
    );
    expect(required.length).toBe(1);
    expect(required[0]["property"]).toBe("updatedAtUtc");
    expect(required[0].message).toBe("must have all required properties");
  });

  test("root-level type failures report the empty instance path", () => {
    const result = validator.validate("results", 1, "just a string");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].instancePath).toBe("");
    expect(result.errors[0].keyword).toBe("type");
  });
});

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null) {
    return;
  }
  Object.freeze(value);
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
}
