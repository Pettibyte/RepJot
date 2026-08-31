/**
 * Draft 2020-12 schema registry for the four REP JOT document families (P3-T01).
 *
 * Authority: docs/contracts/families-and-files.md (FF-15..FF-17), specs/schema-versioning.md
 * (§Versioned schemas), specs/rep-jot-json-schema-spec.md §1 (UTC timestamps), and ADR-005 in
 * docs/ARCHITECTURE.md (one small Draft 2020-12 validator dependency, compiled once).
 *
 * The registry registers the exact repository `$id`s, compiles each supported schema exactly once
 * per registry instance, and keeps every registered schema visible to the others so the results
 * schema's external reference to the workouts `containerNode` resolves (FF-17). Formats are
 * assertions, not annotations: `date-time` is asserted with a strict RFC 3339 grammar plus real
 * calendar dates (FF-12). Every construction failure becomes a stable problem record that carries
 * only deterministic safe fields; raw schema documents and library error text never leak out.
 *
 * Each `createSchemaRegistry` call builds its own Ajv instance, so a failed custom registry can
 * never poison a later or default compilation (FF-15: one schema per supported family version).
 * The production default is the exception to repeated construction: `getProductionRegistry` keeps
 * one lazily built module-scoped registry that every default validator acquisition and the
 * `validate:schemas` command reuse, so the repository schemas compile once at startup (ADR-005).
 * The registry uses no clock, locale, randomness, network, or DOM access.
 */
import Ajv2020 from "ajv/dist/2020";
import type { Ajv } from "ajv";

import type { DocumentFamily } from "../domain/families";

import exercisesV1 from "../../schemas/exercises/v1.schema.json";
import workoutsV1 from "../../schemas/workouts/v1.schema.json";
import preferencesV1 from "../../schemas/preferences/v1.schema.json";
import resultsV1 from "../../schemas/results/v1.schema.json";

/** The single schema draft supported by the registry (FF-17). */
export const SCHEMA_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

/** One supported family/version pair and its exact repository `$id` (FF-15..FF-17). */
export interface SchemaIdentity {
  readonly family: DocumentFamily;
  readonly version: number;
  readonly id: string;
}

/** The complete supported identity table. New versions are added beside historical entries. */
export const SUPPORTED_SCHEMA_IDENTITIES: readonly SchemaIdentity[] = [
  {
    family: "exercises",
    version: 1,
    id: "https://repjot.com/schemas/exercises/v1.schema.json"
  },
  {
    family: "workouts",
    version: 1,
    id: "https://repjot.com/schemas/workouts/v1.schema.json"
  },
  {
    family: "preferences",
    version: 1,
    id: "https://repjot.com/schemas/preferences/v1.schema.json"
  },
  {
    family: "results",
    version: 1,
    id: "https://repjot.com/schemas/results/v1.schema.json"
  }
];

const ID_TO_IDENTITY = new Map<string, SchemaIdentity>();
for (const identity of SUPPORTED_SCHEMA_IDENTITIES) {
  ID_TO_IDENTITY.set(identity.id, identity);
}

/** The exact registered `$id` for a family/version pair, or null when the pair is unsupported. */
export function schemaIdentityId(family: DocumentFamily, version: number): string | null {
  for (const identity of SUPPORTED_SCHEMA_IDENTITIES) {
    if (identity.family === family && identity.version === version) {
      return identity.id;
    }
  }
  return null;
}

/** Stable construction-failure kinds. Each has one fixed safe detail text in `SchemaProblem`. */
export type ProblemCode =
  | "invalid-schema"
  | "unexpected-schema-id"
  | "duplicate-schema-id"
  | "unsupported-draft"
  | "unresolved-reference";

/**
 * A stable registry diagnostic. Only deterministic safe fields: the code, the structural `$id`
 * (or empty string when none exists), and a fixed detail text. No schema content, document data,
 * or library error text is carried (FF-17).
 */
export interface SchemaProblem {
  readonly code: ProblemCode;
  readonly id: string;
  readonly detail: string;
}

const PROBLEM_DETAILS: Record<ProblemCode, string> = {
  "invalid-schema": "the schema document does not compile under Draft 2020-12 strict mode",
  "unexpected-schema-id": "the schema $id is not a supported REP JOT schema id",
  "duplicate-schema-id": "two or more registered schemas declare the same $id",
  "unsupported-draft": "the schema does not declare Draft 2020-12",
  "unresolved-reference": "a $ref in the schema does not resolve to a registered schema"
};

/** The safe raw error shape produced by a compiled validator. */
export interface RawSchemaError {
  readonly instancePath: string;
  readonly keyword: string;
  readonly params: Record<string, unknown>;
}

/** A once-compiled Draft 2020-12 validator for one supported identity. */
export interface CompiledSchema {
  (data: unknown): boolean;
  readonly errors: ReadonlyArray<RawSchemaError> | null;
}

/**
 * Registry options. Both fields are injection seams for tests and later pipeline stages:
 * `schemas` replaces the four repository documents, `createAjv` replaces the validator factory.
 * Omitting both keeps the production registry exactly as built from `schemas/`.
 */
export interface SchemaRegistryOptions {
  readonly schemas?: readonly unknown[];
  readonly createAjv?: () => Ajv;
}

/** The four repository v1 schema documents, in dependency-safe order (FF-02 positive case). */
const DEFAULT_SCHEMA_DOCUMENTS: readonly unknown[] = [
  exercisesV1 as unknown,
  workoutsV1 as unknown,
  preferencesV1 as unknown,
  resultsV1 as unknown
];

// Strict asserted `date-time` (FF-12): RFC 3339 section 5.6 grammar with T/t and Z/z separators,
// optional fractional seconds, and a numeric offset that must be the full `+/-HH:MM` pair per
// RFC 3339 `time-numoffset` (a colonless `-0700` or bare `-07` is rejected); seconds 00..60 per the
// RFC's leap-second allowance; plus real calendar-date validation that the grammar alone cannot express
// (`2026-02-30T00:00:00Z` is rejected). Uppercase-Z enforcement stays at the schema layer through
// the `Z$` pattern (FF-12), so the format itself accepts RFC 3339 lowercase z and offsets. A space
// separator is not RFC 3339 and is rejected, so `2026-09-01 06:30:00Z` fails the format even
// though it ends in uppercase Z.
const DATE_TIME_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])[Tt](?:[01]\d|2[0-3]):[0-5]\d:(?:[0-5]\d|60)(?:\.\d+)?(?:[Zz]|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

function daysInMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return lengths[month - 1];
}

function isStrictDateTime(value: string): boolean {
  if (!DATE_TIME_PATTERN.test(value)) {
    return false;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return day <= daysInMonth(year, month);
}

/** The asserted `date-time` format definition registered with every production Ajv instance. */
const STRICT_DATE_TIME = { type: "string" as const, validate: isStrictDateTime };

/**
 * Build the production Ajv instance: Draft 2020-12, strict mode, all errors collected, formats
 * asserted (not annotated), and the strict `date-time` assertion registered (FF-12, ADR-005).
 */
export function createProductionAjv(): Ajv {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: true });
  ajv.addFormat("date-time", STRICT_DATE_TIME);
  return ajv;
}

function readSchemaId(document: unknown): string | null {
  if (typeof document !== "object" || document === null) {
    return null;
  }
  const id = (document as Record<string, unknown>)["$id"];
  return typeof id === "string" ? id : null;
}

function readDraft(document: unknown): string | null {
  if (typeof document !== "object" || document === null) {
    return null;
  }
  const draft = (document as Record<string, unknown>)["$schema"];
  return typeof draft === "string" ? draft : null;
}

function classifyCompileFailure(id: string, error: unknown): SchemaProblem {
  const message = error instanceof Error ? error.message : "";
  if (message.indexOf("can't resolve reference") !== -1) {
    return { code: "unresolved-reference", id, detail: PROBLEM_DETAILS["unresolved-reference"] };
  }
  return { code: "invalid-schema", id, detail: PROBLEM_DETAILS["invalid-schema"] };
}

/** A registry of once-compiled supported schemas plus stable construction diagnostics. */
export interface SchemaRegistry {
  /** Empty when every supported schema registered and compiled; otherwise one record per failure. */
  readonly problems: readonly SchemaProblem[];
  /** True when the family/version pair has a compiled schema in this registry. */
  has(family: DocumentFamily, version: number): boolean;
  /** The once-compiled validator for a supported pair, or null (unsupported pair or compile problem). */
  getValidator(family: DocumentFamily, version: number): CompiledSchema | null;
}

/** One lazily built module-scoped production registry, shared by every default acquisition. */
let productionRegistryInstance: SchemaRegistry | null = null;

/**
 * The single production registry for this process. Built exactly once, lazily on first use, from
 * the four repository schemas (ADR-005: validators compiled once at startup). Every default
 * `createSchemaValidator`/`createProductionValidator` acquisition and the `validate:schemas`
 * command reuse this same instance, so the repository schemas never compile twice. The instance
 * is read-only after construction; custom registries built with `createSchemaRegistry({...})`
 * own separate Ajv instances and can never poison or observe it.
 */
export function getProductionRegistry(): SchemaRegistry {
  if (productionRegistryInstance === null) {
    productionRegistryInstance = createSchemaRegistry();
  }
  return productionRegistryInstance;
}

/**
 * Build one schema registry. Registration order is the input array order, which keeps every
 * diagnostic deterministic for the same input. The production default registers exactly the four
 * repository v1 schemas under their exact `$id`s (FF-17). Production code should reuse
 * `getProductionRegistry` instead of calling this repeatedly; call it directly only when an
 * isolated registry is required (injected test fixtures, custom schema sets).
 */
export function createSchemaRegistry(options?: SchemaRegistryOptions): SchemaRegistry {
  const documents =
    options !== undefined && options.schemas !== undefined ? options.schemas : DEFAULT_SCHEMA_DOCUMENTS;
  const createAjv =
    options !== undefined && options.createAjv !== undefined ? options.createAjv : createProductionAjv;

  const problems: SchemaProblem[] = [];
  const claimedIds = new Set<string>();
  // Insertion-ordered: $id -> accepted schema document. Deterministic iteration.
  const accepted = new Map<string, unknown>();

  for (const document of documents) {
    if (typeof document !== "object" || document === null) {
      problems.push({ code: "invalid-schema", id: "", detail: PROBLEM_DETAILS["invalid-schema"] });
      continue;
    }
    const id = readSchemaId(document);
    if (id === null) {
      problems.push({ code: "unexpected-schema-id", id: "", detail: PROBLEM_DETAILS["unexpected-schema-id"] });
      continue;
    }
    if (!ID_TO_IDENTITY.has(id)) {
      problems.push({ code: "unexpected-schema-id", id, detail: PROBLEM_DETAILS["unexpected-schema-id"] });
      continue;
    }
    if (claimedIds.has(id)) {
      problems.push({ code: "duplicate-schema-id", id, detail: PROBLEM_DETAILS["duplicate-schema-id"] });
      // Fail closed: the identity is ambiguous and never compiles in this registry.
      accepted.delete(id);
      continue;
    }
    claimedIds.add(id);
    if (readDraft(document) !== SCHEMA_DRAFT_2020_12) {
      problems.push({ code: "unsupported-draft", id, detail: PROBLEM_DETAILS["unsupported-draft"] });
      continue;
    }
    accepted.set(id, document);
  }

  const ajv = createAjv();
  const failedIds = new Set<string>();

  for (const [id, document] of accepted) {
    try {
      ajv.addSchema(document as object, id);
    } catch (error) {
      problems.push(classifyCompileFailure(id, error));
      failedIds.add(id);
    }
  }

  // Compile each accepted schema exactly once. Every registered schema is visible to the others,
  // so the results external reference to workouts resolves (FF-17).
  const compiled = new Map<string, CompiledSchema>();
  for (const [id] of accepted) {
    if (failedIds.has(id)) {
      continue;
    }
    try {
      const validate = ajv.getSchema(id);
      if (validate === undefined || validate === null) {
        problems.push({ code: "invalid-schema", id, detail: PROBLEM_DETAILS["invalid-schema"] });
        failedIds.add(id);
        continue;
      }
      compiled.set(id, validate as unknown as CompiledSchema);
    } catch (error) {
      problems.push(classifyCompileFailure(id, error));
      failedIds.add(id);
    }
  }

  return {
    problems,
    has: (family: DocumentFamily, version: number): boolean => {
      const id = schemaIdentityId(family, version);
      return id !== null && compiled.has(id);
    },
    getValidator: (family: DocumentFamily, version: number): CompiledSchema | null => {
      const id = schemaIdentityId(family, version);
      if (id === null) {
        return null;
      }
      const validator = compiled.get(id);
      return validator !== undefined ? validator : null;
    }
  };
}
