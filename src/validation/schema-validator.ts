/**
 * Schema-level validator for one known REP JOT family and version (P3-T01).
 *
 * Authority: docs/contracts/families-and-files.md (FF-12, FF-17), specs/rep-jot-json-schema-spec.md
 * §1 (UTC timestamps), docs/ARCHITECTURE.md module table (`src/validation/schema-validator.ts`).
 *
 * The validator wraps a `SchemaRegistry` and returns stable diagnostics that carry only
 * deterministic safe fields: the instance path, the failing keyword, an optional structural
 * property name, and a fixed message per keyword. Raw document values never appear in a result.
 * Envelope recognition (FF-10) is owned by the document pipeline; this module only reports
 * unknown-family and unknown-version selectors as distinct codes. The input is `unknown` and is
 * never mutated. Repeated validation of the same input returns identical results.
 */
import type { DocumentFamily } from "../domain/families";

import {
  getProductionRegistry,
  schemaIdentityId
} from "./schema-registry";
import type {
  ProblemCode,
  RawSchemaError,
  SchemaProblem,
  SchemaRegistry
} from "./schema-registry";

/** The four family names accepted by `validate`. Anything else is an unknown family. */
export const VALIDATOR_FAMILY_NAMES: readonly string[] = [
  "exercises",
  "workouts",
  "preferences",
  "results"
];

/** One stable validation error at one location, with only deterministic safe fields. */
export interface SchemaValidationError {
  /** JSON pointer into the document; empty string at the root. */
  readonly instancePath: string;
  /** The failing JSON Schema keyword. */
  readonly keyword: string;
  /** Structural property name for `required` and `additionalProperties` failures, when present. */
  readonly property?: string;
  /** Fixed safe text per keyword; never contains document data. */
  readonly message: string;
}

/** The outcome code of one validation call. Registry failure codes pass through unchanged. */
export type ValidationCode = "valid" | "invalid" | "unknown-family" | "unknown-version" | ProblemCode;

/** The stable result of one schema validation. */
export interface ValidationResult {
  readonly valid: boolean;
  readonly code: ValidationCode;
  /** Empty unless `code` is `"invalid"`; sorted and deduplicated for determinism. */
  readonly errors: readonly SchemaValidationError[];
}

/** Validate documents against the supported schemas of one registry. */
export interface SchemaValidator {
  /** The registry this validator validates against (read-only; never mutated by validation). */
  readonly registry: SchemaRegistry;
  validate(familyName: string, version: unknown, document: unknown): ValidationResult;
}

const KEYWORD_MESSAGES: Record<string, string> = {
  required: "must have all required properties",
  additionalProperties: "must not have additional properties",
  type: "has a different JSON type than the schema allows",
  format: "does not match the asserted format",
  pattern: "does not match the required pattern",
  const: "is not the required constant",
  enum: "is not one of the allowed values",
  oneOf: "does not match exactly one allowed shape",
  anyOf: "does not match any allowed shape",
  allOf: "does not match every required shape",
  not: "must not match the forbidden shape",
  if: "does not satisfy a conditional rule",
  minLength: "is shorter than the minimum length",
  minItems: "has fewer items than required",
  minProperties: "has fewer properties than required",
  maximum: "is above the maximum",
  exclusiveMaximum: "is at or above the exclusive maximum",
  minimum: "is below the minimum",
  exclusiveMinimum: "is at or below the exclusive minimum",
  propertyNames: "has a property name the schema forbids",
  uniqueItems: "contains duplicate items"
};

function messageForKeyword(keyword: string): string {
  const message = KEYWORD_MESSAGES[keyword];
  return message !== undefined ? message : "violates a schema rule";
}

/** Extract the structural property name when the keyword carries one; never a data value. */
function propertyForError(error: RawSchemaError): string | null {
  const params = error.params;
  if (error.keyword === "required") {
    const missing = params["missingProperty"];
    return typeof missing === "string" ? missing : null;
  }
  if (error.keyword === "additionalProperties") {
    const additional = params["additionalProperty"];
    return typeof additional === "string" ? additional : null;
  }
  return null;
}

/** Normalize raw validator errors into stable safe fields, sorted and deduplicated. */
function normalizeErrors(rawErrors: ReadonlyArray<RawSchemaError> | null): SchemaValidationError[] {
  const seen = new Set<string>();
  const normalized: SchemaValidationError[] = [];
  if (rawErrors === null) {
    return normalized;
  }
  for (const raw of rawErrors) {
    const property = propertyForError(raw);
    const key = raw.instancePath + "\u0000" + raw.keyword + "\u0000" + (property !== null ? property : "");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const base = {
      instancePath: raw.instancePath,
      keyword: raw.keyword,
      message: messageForKeyword(raw.keyword)
    };
    const entry: SchemaValidationError =
      property !== null
        ? { instancePath: base.instancePath, keyword: base.keyword, message: base.message, property }
        : { instancePath: base.instancePath, keyword: base.keyword, message: base.message };
    normalized.push(entry);
  }
  normalized.sort((a, b) => {
    const pathCompare = a.instancePath < b.instancePath ? -1 : a.instancePath > b.instancePath ? 1 : 0;
    if (pathCompare !== 0) {
      return pathCompare;
    }
    const keywordCompare = a.keyword < b.keyword ? -1 : a.keyword > b.keyword ? 1 : 0;
    if (keywordCompare !== 0) {
      return keywordCompare;
    }
    const aProperty = a["property"] !== undefined ? a["property"] : "";
    const bProperty = b["property"] !== undefined ? b["property"] : "";
    return aProperty < bProperty ? -1 : aProperty > bProperty ? 1 : 0;
  });
  return normalized;
}

function firstProblemFor(problems: readonly SchemaProblem[], id: string): SchemaProblem | null {
  for (const problem of problems) {
    if (problem.id === id) {
      return problem;
    }
  }
  return null;
}

/**
 * Build a schema validator over one registry. Omit the argument to use the single shared
 * production registry (ADR-005), built lazily exactly once per process from the four repository
 * schemas (FF-17). The registry is shared by reference: callers that need isolation create
 * separate registries and pass them in.
 */
export function createSchemaValidator(registry?: SchemaRegistry): SchemaValidator {
  const activeRegistry = registry !== undefined ? registry : getProductionRegistry();

  return {
    registry: activeRegistry,
    validate(familyName: string, version: unknown, document: unknown): ValidationResult {
      if (VALIDATOR_FAMILY_NAMES.indexOf(familyName) === -1) {
        return { valid: false, code: "unknown-family", errors: [] };
      }
      const family = familyName as DocumentFamily;
      if (typeof version !== "number" || !Number.isInteger(version)) {
        return { valid: false, code: "unknown-version", errors: [] };
      }
      const id = schemaIdentityId(family, version);
      if (id === null) {
        return { valid: false, code: "unknown-version", errors: [] };
      }
      const compiled = activeRegistry.getValidator(family, version);
      if (compiled === null) {
        // The pair is supported but failed to register or compile in this registry.
        const problem = firstProblemFor(activeRegistry.problems, id);
        return {
          valid: false,
          code: problem !== null ? problem.code : "invalid-schema",
          errors: []
        };
      }
      const passed = compiled(document);
      if (passed) {
        return { valid: true, code: "valid", errors: [] };
      }
      return { valid: false, code: "invalid", errors: normalizeErrors(compiled.errors) };
    }
  };
}

/** The production validator over the shared once-compiled repository schemas (ADR-005). */
export function createProductionValidator(): SchemaValidator {
  return createSchemaValidator();
}
