/**
 * Table tests for the document pipeline types and the user-facing error shape (P11-T01), and for the
 * parse stage that reads exact bytes (P12-T01).
 *
 * Authority for every expectation below, written by hand from the sources rather than read back from
 * the modules under test:
 * - docs/ARCHITECTURE.md Section 16: the thirteen-member `AppErrorKind` union, the `AppError` field
 *   names, and the category rows a pipeline failure may name.
 * - docs/ARCHITECTURE.md Section 12: the six load-pipeline stages, in table order.
 * - docs/implementation/phase-11.md Steps and Edge cases: "Define distinct parse, envelope,
 *   unsupported-old, future, schema, migration, and semantic errors", "Keep missing version separate
 *   from malformed version", "Keep family mismatch separate from unknown family", and the acceptance
 *   line "Callers can branch on error kind without parsing messages".
 * - docs/contracts/families-and-files.md FF-09, FF-10, FF-14, FF-18, FF-20 and
 *   specs/schema-versioning.md "Version handling".
 * - Phase 12 (P12-T01) adds the parse-stage rows at the end of this file, from docs/implementation/
 *   phase-12.md, FF-14, and docs/decisions/document-parsing-byte-order-mark.md (D-02, Option BOM-2).
 *
 * Every input is a fixed literal or a deterministic generated document: no clock, no random value, no
 * locale formatting, no network, and no fixture file. The one clock read in this file measures elapsed
 * milliseconds for the P12-T01 stress measurements and never chooses an input. No test decides an
 * outcome by reading message text. Message text appears only in the fixedness and retention checks that
 * prove a fixed message never picks up document content or caller-supplied text, which is the opposite
 * question from branching.
 *
 * The P12-T01 static rows (no project limit, no recursion, no extra import, no ES2019-later token) scan
 * the parse module's own text, because "no such constant or mechanism exists" is not observable from a
 * call. Each of them sits next to the call that shows the matching behavior, so the scan supplements
 * evidence the parent also reads in the diff; it is never the only evidence for a behavior.
 */
import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";

import { APP_ERROR_KINDS } from "../src/errors/app-error";
import type { AppError, AppErrorKind } from "../src/errors/app-error";
import * as safeJsonParserModule from "../src/documents/safe-json-parser";
import { parseDocumentBytes } from "../src/documents/safe-json-parser";
import type { SafeJsonParseInput, SafeJsonParseResult } from "../src/documents/safe-json-parser";
import {
  makePipelineError,
  PIPELINE_ERROR_DESCRIPTORS,
  PIPELINE_ERROR_KINDS,
  PIPELINE_STAGES,
  PIPELINE_USER_CATEGORIES
} from "../src/documents/pipeline-types";
import type {
  DocumentProvenance,
  EmptyPipelineSafeContext,
  ParseFailureReason,
  PipelineError,
  PipelineErrorFor,
  PipelineErrorKind,
  PipelineRequest,
  PipelineResult,
  PipelineSafeContextByKind,
  PipelineStage,
  PipelineUserCategory
} from "../src/documents/pipeline-types";

// ---------------------------------------------------------------------------
// Fixed inputs
// ---------------------------------------------------------------------------

/** One canonical logical filename (FF-06) used by every case; never a Drive file ID. */
const LOGICAL_NAME = "results-2026-09.json";

/** Values that must never appear anywhere inside a constructed error. */
const SENTINELS = [
  "note-text-4f3a-never-in-an-error",
  "measurement-value-82-5-never-in-an-error",
  "ya29-token-never-in-an-error",
  "session-6f1e2d3c-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
  "raw-document-root-never-in-an-error",
  "user-name-never-in-an-error"
] as const;

/** One document that holds every forbidden class of value, used only as a retention probe. */
function sentinelDocument(): Record<string, unknown> {
  return {
    format: "repjot/results",
    schemaVersion: 1,
    yearMonthUtc: "2026-09",
    marker: "raw-document-root-never-in-an-error",
    sessions: [
      {
        id: "session-6f1e2d3c-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
        note: "note-text-4f3a-never-in-an-error",
        bestSet: { weight: { value: 82.5, unit: "kg" }, marker: "measurement-value-82-5-never-in-an-error" }
      }
    ],
    accessToken: "ya29-token-never-in-an-error",
    displayName: "user-name-never-in-an-error"
  };
}

/** The Section 16 user-facing kinds, copied from docs/ARCHITECTURE.md Section 16 by hand. */
const SECTION_16_KINDS: AppErrorKind[] = [
  "authentication",
  "authorization",
  "network",
  "drive_rate_limit",
  "drive_quota",
  "duplicate_drive_file",
  "unsupported_schema",
  "invalid_document",
  "migration",
  "semantic_reference",
  "sync_conflict",
  "storage",
  "ambiguous_upload"
];

/** The six load stages of the Section 12 stage table, in table order. The table's seventh row,
 * prior-production compatibility, is a build gate and must not appear. */
const SECTION_12_LOAD_STAGES: PipelineStage[] = [
  "parse",
  "envelope",
  "declared-schema",
  "migration",
  "post-migration-schema",
  "semantic"
];

/** The Section 16 categories a pipeline failure may name, and no others. */
const PIPELINE_CATEGORY_SET: readonly PipelineUserCategory[] = [
  "unsupported_schema",
  "invalid_document",
  "migration",
  "semantic_reference"
];

/** The own property names of every constructed pipeline error. */
const PIPELINE_ERROR_FIELD_NAMES = [
  "kind",
  "logicalName",
  "retryable",
  "safeContext",
  "safeMessage",
  "stage",
  "userCategory"
];

/** The complete vocabulary a safe context may hold, written here independently of the modules. */
const CLOSED_CONTEXT_NAMES: readonly string[] = [
  "exercises",
  "workouts",
  "preferences",
  "results",
  "invalid-utf8",
  "malformed-json",
  "byte-order-mark"
];

// ---------------------------------------------------------------------------
// The case table: one row per defined pipeline error kind
// ---------------------------------------------------------------------------

/**
 * Expected stage, Section 16 category, and caller branch per kind, assigned by hand from Section 12
 * and the Section 16 recovery and naming columns: "Unsupported schema | Name file and supported
 * version range", "Invalid document | Name file and safe JSON path details", "Migration | Name family
 * and version transition", "Semantic reference | Name logical file and failed reference without health
 * values".
 */
interface KindCase {
  readonly kind: PipelineErrorKind;
  readonly expectedStage: PipelineStage;
  readonly expectedUserCategory: PipelineUserCategory;
  readonly expectedBranch: string;
  readonly expectedBranchDetail: string;
  readonly expectedContextKeys: readonly string[];
  readonly contextJson: string;
  readonly build: (logicalName: string) => PipelineError;
}

const EMPTY_CONTEXT_KEYS: readonly string[] = [];
const PATHS_KEYS: readonly string[] = ["paths"];

/**
 * One row of the case table. Written as a generic helper so that each call site keeps the correlation
 * between a literal kind and that kind's own context shape, which is the contract under test:
 * `makePipelineError` is called where both types are still known, and the row keeps only the built
 * error and the hand-written expectation.
 */
function kindCase<K extends PipelineErrorKind>(input: {
  readonly kind: K;
  readonly expectedStage: PipelineStage;
  readonly expectedUserCategory: PipelineUserCategory;
  readonly expectedBranch: string;
  readonly expectedBranchDetail: string;
  readonly expectedContextKeys: readonly string[];
  readonly context: PipelineSafeContextByKind[K];
}): KindCase {
  return {
    kind: input.kind,
    expectedStage: input.expectedStage,
    expectedUserCategory: input.expectedUserCategory,
    expectedBranch: input.expectedBranch,
    expectedBranchDetail: input.expectedBranchDetail,
    expectedContextKeys: input.expectedContextKeys,
    contextJson: JSON.stringify(input.context),
    // The assertion carries one step TypeScript cannot take for a deferred kind: a concrete
    // `PipelineErrorFor<K>` is one member of the `PipelineError` union, which every call site below
    // proves for its own literal kind.
    build: (logicalName: string): PipelineError =>
      makePipelineError({
        kind: input.kind,
        logicalName: logicalName,
        safeContext: input.context
      }) as PipelineError
  };
}

const KIND_CASES: readonly KindCase[] = [
  kindCase({
    kind: "parse-failed",
    expectedStage: "parse",
    expectedUserCategory: "invalid_document",
    expectedBranch: "report-invalid-document",
    expectedBranchDetail: "invalid-utf8",
    expectedContextKeys: ["reason"],
    context: { reason: "invalid-utf8" }
  }),
  kindCase({
    kind: "envelope-not-object",
    expectedStage: "envelope",
    expectedUserCategory: "invalid_document",
    expectedBranch: "report-invalid-document",
    expectedBranchDetail: "root",
    expectedContextKeys: EMPTY_CONTEXT_KEYS,
    context: {}
  }),
  kindCase({
    kind: "envelope-missing-format",
    expectedStage: "envelope",
    expectedUserCategory: "invalid_document",
    expectedBranch: "report-invalid-document",
    expectedBranchDetail: "format",
    expectedContextKeys: EMPTY_CONTEXT_KEYS,
    context: {}
  }),
  kindCase({
    kind: "envelope-unknown-format",
    expectedStage: "envelope",
    expectedUserCategory: "invalid_document",
    expectedBranch: "report-invalid-document",
    expectedBranchDetail: "format",
    expectedContextKeys: EMPTY_CONTEXT_KEYS,
    context: {}
  }),
  kindCase({
    kind: "envelope-wrong-family",
    expectedStage: "envelope",
    expectedUserCategory: "invalid_document",
    expectedBranch: "report-invalid-document",
    expectedBranchDetail: "preferences!=results",
    expectedContextKeys: ["family", "expectedFamily"],
    context: { family: "preferences", expectedFamily: "results" }
  }),
  kindCase({
    kind: "envelope-missing-version",
    expectedStage: "envelope",
    expectedUserCategory: "invalid_document",
    expectedBranch: "report-invalid-document",
    expectedBranchDetail: "schemaVersion",
    expectedContextKeys: EMPTY_CONTEXT_KEYS,
    context: {}
  }),
  kindCase({
    kind: "envelope-non-number-version",
    expectedStage: "envelope",
    expectedUserCategory: "invalid_document",
    expectedBranch: "report-invalid-document",
    expectedBranchDetail: "schemaVersion",
    expectedContextKeys: EMPTY_CONTEXT_KEYS,
    context: {}
  }),
  kindCase({
    kind: "envelope-non-integer-version",
    expectedStage: "envelope",
    expectedUserCategory: "invalid_document",
    expectedBranch: "report-invalid-document",
    expectedBranchDetail: "schemaVersion",
    expectedContextKeys: EMPTY_CONTEXT_KEYS,
    context: {}
  }),
  kindCase({
    kind: "envelope-non-positive-version",
    expectedStage: "envelope",
    expectedUserCategory: "invalid_document",
    expectedBranch: "report-invalid-document",
    expectedBranchDetail: "schemaVersion",
    expectedContextKeys: EMPTY_CONTEXT_KEYS,
    context: {}
  }),
  kindCase({
    kind: "envelope-unsupported-old-version",
    expectedStage: "envelope",
    expectedUserCategory: "unsupported_schema",
    expectedBranch: "report-support-floor",
    expectedBranchDetail: "floor=2",
    expectedContextKeys: ["schemaVersion", "supportFloor"],
    context: { schemaVersion: 1, supportFloor: 2 }
  }),
  kindCase({
    kind: "envelope-future-version",
    expectedStage: "envelope",
    expectedUserCategory: "unsupported_schema",
    expectedBranch: "report-newer-code-required",
    expectedBranchDetail: "current=3",
    expectedContextKeys: ["schemaVersion", "currentSchemaVersion"],
    context: { schemaVersion: 4, currentSchemaVersion: 3 }
  }),
  kindCase({
    kind: "declared-schema-invalid",
    expectedStage: "declared-schema",
    expectedUserCategory: "invalid_document",
    expectedBranch: "report-invalid-document",
    expectedBranchDetail: "/sessions/0/startedAtUtc",
    expectedContextKeys: PATHS_KEYS,
    context: { paths: ["/sessions/0/startedAtUtc"] }
  }),
  kindCase({
    kind: "migration-failed",
    expectedStage: "migration",
    expectedUserCategory: "migration",
    expectedBranch: "report-version-transition",
    expectedBranchDetail: "results:2->3",
    expectedContextKeys: ["family", "fromSchemaVersion", "toSchemaVersion"],
    context: { family: "results", fromSchemaVersion: 2, toSchemaVersion: 3 }
  }),
  kindCase({
    kind: "post-migration-schema-invalid",
    expectedStage: "post-migration-schema",
    expectedUserCategory: "invalid_document",
    expectedBranch: "report-invalid-document",
    expectedBranchDetail: "/sessions",
    expectedContextKeys: PATHS_KEYS,
    context: { paths: ["/sessions"] }
  }),
  kindCase({
    kind: "semantic-invalid",
    expectedStage: "semantic",
    expectedUserCategory: "semantic_reference",
    expectedBranch: "report-failed-reference",
    expectedBranchDetail: "/sessions/0/workoutId",
    expectedContextKeys: PATHS_KEYS,
    context: { paths: ["/sessions/0/workoutId"] }
  })
];

/** Every kind appears once in the table, so no kind can be covered by accident or omission. */
const TABLE_KINDS: readonly PipelineErrorKind[] = KIND_CASES.map((oneCase) => oneCase.kind);

function caseFor(kind: PipelineErrorKind): KindCase {
  for (const oneCase of KIND_CASES) {
    if (oneCase.kind === kind) {
      return oneCase;
    }
  }
  throw new Error("no case row for kind " + kind);
}

/** The seven error groups of the Phase 11 step list, mapped onto the kinds that carry them. */
const PHASE_11_GROUPS: Readonly<Record<string, readonly PipelineErrorKind[]>> = {
  parse: ["parse-failed"],
  envelope: [
    "envelope-not-object",
    "envelope-missing-format",
    "envelope-unknown-format",
    "envelope-wrong-family",
    "envelope-missing-version",
    "envelope-non-number-version",
    "envelope-non-integer-version",
    "envelope-non-positive-version"
  ],
  "unsupported-old": ["envelope-unsupported-old-version"],
  future: ["envelope-future-version"],
  schema: ["declared-schema-invalid", "post-migration-schema-invalid"],
  migration: ["migration-failed"],
  semantic: ["semantic-invalid"]
};

/** The six envelope conditions of FF-10, mapped onto the kinds that carry them. "Missing" and "absent
 * (inherited)" share one kind because src/domain/families.ts, accepted in Phases 1-10, rejects a
 * prototype-chain `format` or `schemaVersion` as missing and never infers either value from shape. */
const FF10_ENVELOPE_CONDITIONS: Readonly<Record<string, readonly PipelineErrorKind[]>> = {
  "missing-format": ["envelope-missing-format"],
  "absent-inherited-version": ["envelope-missing-version"],
  "wrong-family": ["envelope-wrong-family"],
  "non-integer-version": [
    "envelope-non-number-version",
    "envelope-non-integer-version",
    "envelope-non-positive-version"
  ],
  "unsupported-old-version": ["envelope-unsupported-old-version"],
  "future-version": ["envelope-future-version"]
};

/**
 * One caller's branch over the kind discriminant, carrying the naming duty of the Section 16 category
 * that Section 12 assigns to the stage. The switch is the whole decision: no case reads `safeMessage`,
 * and each case reads only the context fields its own kind declares, which is what makes the
 * correlated context shape a compile-time requirement of this function.
 */
function branchFor(error: PipelineError): { readonly branch: string; readonly detail: string } {
  switch (error.kind) {
    case "parse-failed":
      return { branch: "report-invalid-document", detail: error.safeContext.reason };
    case "envelope-not-object":
      return { branch: "report-invalid-document", detail: "root" };
    case "envelope-missing-format":
      return { branch: "report-invalid-document", detail: "format" };
    case "envelope-unknown-format":
      return { branch: "report-invalid-document", detail: "format" };
    case "envelope-wrong-family":
      return {
        branch: "report-invalid-document",
        detail: error.safeContext.family + "!=" + error.safeContext.expectedFamily
      };
    case "envelope-missing-version":
      return { branch: "report-invalid-document", detail: "schemaVersion" };
    case "envelope-non-number-version":
      return { branch: "report-invalid-document", detail: "schemaVersion" };
    case "envelope-non-integer-version":
      return { branch: "report-invalid-document", detail: "schemaVersion" };
    case "envelope-non-positive-version":
      return { branch: "report-invalid-document", detail: "schemaVersion" };
    case "envelope-unsupported-old-version":
      return { branch: "report-support-floor", detail: "floor=" + error.safeContext.supportFloor };
    case "envelope-future-version":
      return {
        branch: "report-newer-code-required",
        detail: "current=" + error.safeContext.currentSchemaVersion
      };
    case "declared-schema-invalid":
      return { branch: "report-invalid-document", detail: error.safeContext.paths.join(",") };
    case "migration-failed":
      return {
        branch: "report-version-transition",
        detail:
          error.safeContext.family +
          ":" +
          error.safeContext.fromSchemaVersion +
          "->" +
          error.safeContext.toSchemaVersion
      };
    case "post-migration-schema-invalid":
      return { branch: "report-invalid-document", detail: error.safeContext.paths.join(",") };
    case "semantic-invalid":
      return { branch: "report-failed-reference", detail: error.safeContext.paths.join(",") };
    default:
      return { branch: "no-branch", detail: "unreachable" };
  }
}

/** Compile-time probes only; never called. `bun run check` runs their evidence, because an
 * expect-error directive is itself an error when the line below it compiles. Together they prove
 * that no field can carry document content and no caller can invent a code. */
function typeBoundaryProbes(): void {
  const noteAsContext: EmptyPipelineSafeContext = {
    // @ts-expect-error a context with no declared field accepts no note text
    note: SENTINELS[0]
  };
  const versionOfTheWrongShape: PipelineSafeContextByKind["migration-failed"] = {
    // @ts-expect-error a migration context names a closed family, not arbitrary text
    family: "meals",
    fromSchemaVersion: 1,
    toSchemaVersion: 2
  };
  // @ts-expect-error Section 16 fixes the user-facing kind set
  const inventedAppKind: AppErrorKind = "unsupported_stage";
  // @ts-expect-error the six load stages are fixed by Section 12
  const inventedStage: PipelineStage = "prior-production-compatibility";
  const callerSuppliedMessage: PipelineErrorFor<"parse-failed"> = {
    ...PIPELINE_ERROR_DESCRIPTORS["parse-failed"],
    kind: "parse-failed",
    logicalName: LOGICAL_NAME,
    // @ts-expect-error safeMessage is fixed per code and cannot be replaced by a caller
    safeMessage: SENTINELS[0]
  };
  const appErrorWithContent: AppError = {
    kind: "invalid_document",
    operation: "load-results-shard",
    retryable: false,
    safeMessage: "the document does not match its declared schema",
    // @ts-expect-error AppError has no field for document content
    documentText: SENTINELS[0]
  };
  const unknownExpectedFamily: PipelineRequest = {
    // @ts-expect-error the caller declares one of the four known families it checks against
    expectedFamily: "meals",
    logicalName: LOGICAL_NAME,
    source: { kind: "static-bundle" },
    bytes: new Uint8Array([])
  };
  expect(typeof noteAsContext).toBe("object");
  expect(versionOfTheWrongShape.toSchemaVersion).toBe(2);
  expect(String(inventedAppKind)).toBe("unsupported_stage");
  expect(String(inventedStage)).toBe("prior-production-compatibility");
  expect(callerSuppliedMessage.kind).toBe("parse-failed");
  expect(appErrorWithContent.kind).toBe("invalid_document");
  expect(unknownExpectedFamily.logicalName).toBe(LOGICAL_NAME);
}

// ---------------------------------------------------------------------------
// (a) Every defined kind is a stable, enumerable value
// ---------------------------------------------------------------------------

describe("user-facing kinds are the thirteen Section 16 members", () => {
  test("the enumerable list is exactly the Section 16 union, in order and without duplicates", () => {
    expect(APP_ERROR_KINDS.length).toBe(13);
    expect([...APP_ERROR_KINDS]).toEqual(SECTION_16_KINDS);
    expect(new Set<string>(APP_ERROR_KINDS).size).toBe(13);
    for (const kind of APP_ERROR_KINDS) {
      expect(typeof kind).toBe("string");
      expect(kind.length > 0).toBe(true);
    }
  });

  test("no pipeline stage name became a new user-facing kind", () => {
    const appKindNames: readonly string[] = APP_ERROR_KINDS;
    const stageDerivedNames = [
      "parse",
      "envelope",
      "declared_schema",
      "post_migration_schema",
      "unsupported_old_version",
      "future_version",
      "invalid_json",
      "envelope_missing_version"
    ];
    for (const name of stageDerivedNames) {
      expect(appKindNames.indexOf(name)).toBe(-1);
    }
  });

  test("an AppError carries exactly the Section 16 fields", () => {
    const error: AppError = {
      kind: "unsupported_schema",
      operation: "load-results-shard",
      logicalName: LOGICAL_NAME,
      retryable: false,
      safeMessage: "the document schemaVersion requires a newer version of REP JOT"
    };
    expect(Object.keys(error).sort()).toEqual([
      "kind",
      "logicalName",
      "operation",
      "retryable",
      "safeMessage"
    ]);
    const withOptional: AppError = {
      kind: "invalid_document",
      operation: "load-results-shard",
      retryable: false,
      safeMessage: "the document does not match its declared schema",
      causeCode: "declared-schema-invalid",
      correlationId: "corr-1"
    };
    expect(Object.keys(withOptional).sort()).toEqual([
      "causeCode",
      "correlationId",
      "kind",
      "operation",
      "retryable",
      "safeMessage"
    ]);
  });
});

describe("pipeline stages are the six Section 12 load stages", () => {
  test("the enumerable stage set is the Section 12 load rows in order", () => {
    expect([...PIPELINE_STAGES]).toEqual(SECTION_12_LOAD_STAGES);
  });

  test("prior-production compatibility stays a build gate and is not a load stage", () => {
    const stageNames: readonly string[] = PIPELINE_STAGES;
    expect(stageNames.indexOf("prior-production-compatibility")).toBe(-1);
    expect(stageNames.indexOf("compatibility")).toBe(-1);
    expect(stageNames.indexOf("normalize")).toBe(-1);
  });
});

describe("pipeline error kinds are stable, enumerable, and distinct", () => {
  test("every kind is enumerable once and the case table covers every kind", () => {
    expect(PIPELINE_ERROR_KINDS.length).toBe(15);
    expect(new Set<string>(PIPELINE_ERROR_KINDS).size).toBe(15);
    expect([...TABLE_KINDS].sort()).toEqual([...PIPELINE_ERROR_KINDS].sort());
    for (const kind of PIPELINE_ERROR_KINDS) {
      expect(typeof kind).toBe("string");
      expect(kind.length > 0).toBe(true);
      // Every kind has a descriptor row, so a lookup can never fall through to a default.
      expect(PIPELINE_ERROR_DESCRIPTORS[kind] === undefined).toBe(false);
    }
  });

  test("the seven Phase 11 error groups are each carried, and every kind is in one group", () => {
    const covered: string[] = [];
    for (const groupName of Object.keys(PHASE_11_GROUPS)) {
      const members = PHASE_11_GROUPS[groupName];
      expect(members.length > 0).toBe(true);
      for (const member of members) {
        expect(PIPELINE_ERROR_KINDS.indexOf(member) !== -1).toBe(true);
        covered.push(member);
      }
    }
    expect(covered.length).toBe(PIPELINE_ERROR_KINDS.length);
    expect(new Set<string>(covered).size).toBe(PIPELINE_ERROR_KINDS.length);
  });

  test("FF-10 names six envelope conditions and each has its own kind", () => {
    const conditions = Object.keys(FF10_ENVELOPE_CONDITIONS);
    expect(conditions.length).toBe(6);
    const used: string[] = [];
    for (const condition of conditions) {
      const members = FF10_ENVELOPE_CONDITIONS[condition];
      expect(members.length > 0).toBe(true);
      for (const member of members) {
        used.push(member);
      }
    }
    expect(new Set<string>(used).size).toBe(used.length);
  });

  test("missing version stays separate from every malformed version", () => {
    const versionKinds: readonly PipelineErrorKind[] = [
      "envelope-missing-version",
      "envelope-non-number-version",
      "envelope-non-integer-version",
      "envelope-non-positive-version"
    ];
    const kinds = versionKinds.map((kind) => caseFor(kind).build(LOGICAL_NAME).kind);
    expect(new Set<string>(kinds).size).toBe(4);
    expect(kinds[0]).toBe("envelope-missing-version");
  });

  test("family mismatch stays separate from unknown family", () => {
    const mismatch = caseFor("envelope-wrong-family").build(LOGICAL_NAME);
    const unknown = caseFor("envelope-unknown-format").build(LOGICAL_NAME);
    expect(mismatch.kind).toBe("envelope-wrong-family");
    expect(unknown.kind).toBe("envelope-unknown-format");
    expect(mismatch.kind === unknown.kind).toBe(false);
    expect(mismatch.stage).toBe(unknown.stage);
  });
});

// ---------------------------------------------------------------------------
// (b) Each kind carries its declared safe context and one user-facing category
// ---------------------------------------------------------------------------

describe("each pipeline kind carries its declared safe context", () => {
  test("the context shape and field set match the kind's declaration", () => {
    for (const oneCase of KIND_CASES) {
      const error = oneCase.build(LOGICAL_NAME);
      expect(error.kind).toBe(oneCase.kind);
      expect(Object.keys(error).sort()).toEqual(PIPELINE_ERROR_FIELD_NAMES);
      expect(Object.keys(error.safeContext).sort()).toEqual(
        [...oneCase.expectedContextKeys].sort()
      );
      expect(JSON.stringify(error.safeContext)).toBe(oneCase.contextJson);
      expect(Object.isFrozen(error)).toBe(true);
    }
  });

  test("every kind names exactly one Section 12 stage", () => {
    for (const oneCase of KIND_CASES) {
      const error = oneCase.build(LOGICAL_NAME);
      expect(error.stage).toBe(oneCase.expectedStage);
      expect(SECTION_12_LOAD_STAGES.indexOf(error.stage) !== -1).toBe(true);
      expect(oneCase.build("preferences.json").stage).toBe(error.stage);
    }
  });

  test("every kind maps to exactly one Section 16 category, from the four named rows", () => {
    const observed: string[] = [];
    for (const oneCase of KIND_CASES) {
      const error = oneCase.build(LOGICAL_NAME);
      expect(error.userCategory).toBe(oneCase.expectedUserCategory);
      expect(PIPELINE_CATEGORY_SET.indexOf(error.userCategory) !== -1).toBe(true);
      expect(PIPELINE_USER_CATEGORIES.indexOf(error.userCategory) !== -1).toBe(true);
      expect(oneCase.build("preferences.json").userCategory).toBe(error.userCategory);
      observed.push(error.userCategory);
    }
    expect(new Set<string>(observed).size).toBe(4);
  });

  test("every pipeline category is itself one Section 16 user-facing kind", () => {
    const appKindNames: readonly string[] = APP_ERROR_KINDS;
    for (const category of PIPELINE_USER_CATEGORIES) {
      // The compile-time link: a PipelineUserCategory is accepted where an AppErrorKind is required.
      const asAppKind: AppErrorKind = category;
      expect(appKindNames.indexOf(asAppKind) !== -1).toBe(true);
      expect(SECTION_16_KINDS.indexOf(category) !== -1).toBe(true);
    }
  });

  test("no pipeline kind is retryable, per the Section 16 recovery columns", () => {
    for (const oneCase of KIND_CASES) {
      expect(oneCase.build(LOGICAL_NAME).retryable).toBe(false);
    }
  });

  test("the safe message is one fixed string per kind, never a value", () => {
    for (const oneCase of KIND_CASES) {
      const first = oneCase.build(LOGICAL_NAME);
      const second = oneCase.build(LOGICAL_NAME);
      expect(typeof first.safeMessage).toBe("string");
      expect(first.safeMessage.length > 0).toBe(true);
      expect(first.safeMessage).toBe(second.safeMessage);
      // A different logical file never changes the fixed text of one code.
      expect(oneCase.build("preferences.json").safeMessage).toBe(first.safeMessage);
    }
  });

  test("every context value is a closed name, an integer, or a JSON Pointer", () => {
    for (const oneCase of KIND_CASES) {
      const error = oneCase.build(LOGICAL_NAME);
      for (const value of Object.values(error.safeContext)) {
        if (typeof value === "number") {
          expect(Number.isInteger(value)).toBe(true);
        } else if (typeof value === "string") {
          const isPointer = value.charAt(0) === "/";
          expect(CLOSED_CONTEXT_NAMES.indexOf(value) !== -1 || isPointer).toBe(true);
        } else if (Array.isArray(value)) {
          for (const item of value) {
            expect(typeof item).toBe("string");
            expect(String(item).charAt(0) === "/").toBe(true);
          }
        } else {
          expect("unexpected context value type").toBe("no context value may be an object");
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// (c) A caller branches on the kind discriminant
// ---------------------------------------------------------------------------

describe("a caller branches on the kind discriminant", () => {
  test("every kind selects its branch with no message read", () => {
    for (const oneCase of KIND_CASES) {
      const decision = branchFor(oneCase.build(LOGICAL_NAME));
      expect(decision.branch).toBe(oneCase.expectedBranch);
      expect(decision.branch === "no-branch").toBe(false);
      expect(decision.detail).toBe(oneCase.expectedBranchDetail);
    }
  });

  test("the branch depends on the kind only, not on the logical file", () => {
    const oneCase = caseFor("parse-failed");
    expect(branchFor(oneCase.build("exercises.json")).branch).toBe(
      branchFor(oneCase.build(LOGICAL_NAME)).branch
    );
  });

  test("a rejected result is routed through the error discriminant", () => {
    const rejected: PipelineResult<unknown> = {
      status: "rejected",
      error: caseFor("envelope-future-version").build(LOGICAL_NAME)
    };
    expect(rejected.status).toBe("rejected");
    if (rejected.status === "rejected") {
      expect(branchFor(rejected.error).branch).toBe("report-newer-code-required");
      expect(rejected.error.stage).toBe("envelope");
      expect(rejected.error.userCategory).toBe("unsupported_schema");
    }
  });
});

// ---------------------------------------------------------------------------
// (d) A constructed error retains no raw document text, secret, or health value, and is detached from
//     the safe-context references the caller kept
// ---------------------------------------------------------------------------

/** One construction plus the references the caller still holds after it. */
interface CallerContextProbe {
  readonly error: PipelineError;
  /** The context record the caller still holds. */
  readonly contextAlias: Record<string, unknown>;
  /** Every array the caller still holds, that is, each `paths` array. */
  readonly arrayAliases: readonly (readonly unknown[])[];
}

interface CallerContextCase {
  readonly kind: PipelineErrorKind;
  readonly expectedContextKeys: readonly string[];
  readonly run: () => CallerContextProbe;
}

/** One caller-supplied field name, never a declared one, used only in mutation attempts. */
const CALLER_INJECTION_FIELD = "callerInjectedDocumentField";

/**
 * One row of the caller-held-input table below: the same fifteen kinds, with the positions a caller
 * controls filled from SENTINELS. Those positions are `logicalName` and the fields of the kind's own
 * declared safe context. A closed-enumeration field or an integer field keeps a valid value, because this
 * phase declares no runtime check of logical-name text, pointer text, or integer values — the P11-J1-01
 * disposition assigns that discipline to the producer and to the declared shape, and `makePipelineError`
 * is not the component that decides it. What every row does test is this module's own exported claim: a
 * completed error is detached from the references the caller passed and is deeply immutable. Each row
 * builds one fresh context per call, so the object and the arrays one row mutates are never the object
 * another row reads.
 */
function callerContextCase<K extends PipelineErrorKind>(input: {
  readonly kind: K;
  readonly expectedContextKeys: readonly string[];
  readonly context: () => PipelineSafeContextByKind[K];
}): CallerContextCase {
  return {
    kind: input.kind,
    expectedContextKeys: input.expectedContextKeys,
    run: (): CallerContextProbe => {
      const context = input.context();
      const contextAlias: Record<string, unknown> = context;
      const arrayAliases: (readonly unknown[])[] = [];
      for (const value of Object.values(contextAlias)) {
        if (Array.isArray(value)) {
          arrayAliases.push(value);
        }
      }
      // The caller's logical-name position holds a sentinel in every row: the field is a plain string
      // here, and canonical-name recognition belongs to Phase 13 (P11-J1-01 disposition, rejected item
      // 1), so no row asserts that this factory rejects it.
      const error: PipelineError = makePipelineError({
        kind: input.kind,
        logicalName: SENTINELS[4],
        safeContext: context
      }) as PipelineError;
      return { error, contextAlias, arrayAliases };
    }
  };
}

/** One row per defined kind, in the same order as `KIND_CASES`. */
const CALLER_CONTEXT_CASES: readonly CallerContextCase[] = [
  callerContextCase({
    kind: "parse-failed",
    expectedContextKeys: ["reason"],
    context: () => ({ reason: "byte-order-mark" })
  }),
  callerContextCase({
    kind: "envelope-not-object",
    expectedContextKeys: EMPTY_CONTEXT_KEYS,
    context: () => ({})
  }),
  callerContextCase({
    kind: "envelope-missing-format",
    expectedContextKeys: EMPTY_CONTEXT_KEYS,
    context: () => ({})
  }),
  callerContextCase({
    kind: "envelope-unknown-format",
    expectedContextKeys: EMPTY_CONTEXT_KEYS,
    context: () => ({})
  }),
  callerContextCase({
    kind: "envelope-wrong-family",
    expectedContextKeys: ["family", "expectedFamily"],
    context: () => ({ family: "preferences", expectedFamily: "results" })
  }),
  callerContextCase({
    kind: "envelope-missing-version",
    expectedContextKeys: EMPTY_CONTEXT_KEYS,
    context: () => ({})
  }),
  callerContextCase({
    kind: "envelope-non-number-version",
    expectedContextKeys: EMPTY_CONTEXT_KEYS,
    context: () => ({})
  }),
  callerContextCase({
    kind: "envelope-non-integer-version",
    expectedContextKeys: EMPTY_CONTEXT_KEYS,
    context: () => ({})
  }),
  callerContextCase({
    kind: "envelope-non-positive-version",
    expectedContextKeys: EMPTY_CONTEXT_KEYS,
    context: () => ({})
  }),
  callerContextCase({
    kind: "envelope-unsupported-old-version",
    expectedContextKeys: ["schemaVersion", "supportFloor"],
    context: () => ({ schemaVersion: 1, supportFloor: 2 })
  }),
  callerContextCase({
    kind: "envelope-future-version",
    expectedContextKeys: ["schemaVersion", "currentSchemaVersion"],
    context: () => ({ schemaVersion: 4, currentSchemaVersion: 3 })
  }),
  callerContextCase({
    kind: "declared-schema-invalid",
    expectedContextKeys: PATHS_KEYS,
    context: () => ({ paths: [SENTINELS[0], SENTINELS[3]] })
  }),
  callerContextCase({
    kind: "migration-failed",
    expectedContextKeys: ["family", "fromSchemaVersion", "toSchemaVersion"],
    context: () => ({ family: "results", fromSchemaVersion: 2, toSchemaVersion: 3 })
  }),
  callerContextCase({
    kind: "post-migration-schema-invalid",
    expectedContextKeys: PATHS_KEYS,
    context: () => ({ paths: [SENTINELS[2], SENTINELS[5]] })
  }),
  callerContextCase({
    kind: "semantic-invalid",
    expectedContextKeys: PATHS_KEYS,
    context: () => ({ paths: [SENTINELS[1], SENTINELS[3], SENTINELS[5]] })
  })
];

/**
 * One attempted write to a value the module claims is frozen. A strict-mode runtime throws and a
 * non-strict runtime ignores it; either way the assertions below are about the value that survives.
 */
function attemptCallerWrite(write: () => void): void {
  try {
    write();
  } catch {
    // A refused write is the required outcome, so it is not an error here.
  }
}

describe("a built error is detached from the caller's safe-context references", () => {
  test("the built error is a detached deep copy of the declared context, per kind", () => {
    for (const oneCase of CALLER_CONTEXT_CASES) {
      const probe = oneCase.run();
      const error = probe.error;
      // Detached: the error holds its own record, and no array inside it is a reference the caller holds.
      expect(error.safeContext).not.toBe(probe.contextAlias);
      for (const value of Object.values(error.safeContext)) {
        for (const alias of probe.arrayAliases) {
          expect(value === alias).toBe(false);
        }
      }
      // A copy, not a filter: the declared fields and their values are the caller's own, in order.
      expect(JSON.stringify(error.safeContext)).toBe(JSON.stringify(probe.contextAlias));
      expect(Object.keys(error.safeContext).sort()).toEqual([...oneCase.expectedContextKeys].sort());
      // Deeply immutable: the error, its context, and every object the context reaches are frozen.
      expect(Object.isFrozen(error)).toBe(true);
      expect(Object.isFrozen(error.safeContext)).toBe(true);
      for (const value of Object.values(error)) {
        if (typeof value === "object" && value !== null) {
          expect(Object.isFrozen(value)).toBe(true);
        }
      }
      for (const value of Object.values(error.safeContext)) {
        if (Array.isArray(value)) {
          expect(Object.isFrozen(value)).toBe(true);
        } else {
          expect(typeof value === "object").toBe(false);
        }
      }
    }
  });

  test("a caller-held alias of the context object or of a paths array cannot change the built error, per kind", () => {
    for (const oneCase of CALLER_CONTEXT_CASES) {
      const probe = oneCase.run();
      const before = JSON.stringify(probe.error);
      expect(probe.error.logicalName).toBe(SENTINELS[4]);
      // The caller kept the record it passed and every array inside it, and tries to widen all of them.
      attemptCallerWrite(() => {
        probe.contextAlias[CALLER_INJECTION_FIELD] = SENTINELS[4];
      });
      for (const alias of probe.arrayAliases) {
        const items: unknown[] = alias as unknown[];
        attemptCallerWrite(() => {
          items.push(SENTINELS[3]);
          items[0] = SENTINELS[2];
        });
      }
      attemptCallerWrite(() => {
        (probe.error.safeContext as unknown as Record<string, unknown>)[CALLER_INJECTION_FIELD] =
          SENTINELS[0];
      });
      attemptCallerWrite(() => {
        (probe.error as unknown as Record<string, unknown>)[CALLER_INJECTION_FIELD] = SENTINELS[0];
      });
      expect(JSON.stringify(probe.error)).toBe(before);
      expect(Object.keys(probe.error).sort()).toEqual(PIPELINE_ERROR_FIELD_NAMES);
      expect(Object.keys(probe.error.safeContext).sort()).toEqual([...oneCase.expectedContextKeys].sort());
      expect(JSON.stringify(probe.error).indexOf(CALLER_INJECTION_FIELD)).toBe(-1);
    }
  });

  test("the fields one kind fixes never carry a caller-supplied sentinel, per kind", () => {
    for (const oneCase of CALLER_CONTEXT_CASES) {
      const error = oneCase.run().error;
      // The same kind built from the safe case table is the reference: the five fields fixed per code
      // cannot bend to what the caller supplied.
      const fixedPerCode = caseFor(oneCase.kind).build(LOGICAL_NAME);
      expect(error.kind).toBe(fixedPerCode.kind);
      expect(error.stage).toBe(fixedPerCode.stage);
      expect(error.userCategory).toBe(fixedPerCode.userCategory);
      expect(error.retryable).toBe(fixedPerCode.retryable);
      expect(error.safeMessage).toBe(fixedPerCode.safeMessage);
      expect(error.retryable).toBe(false);
      for (const field of [error.kind, error.stage, error.userCategory, error.safeMessage]) {
        for (const sentinel of SENTINELS) {
          expect(field.indexOf(sentinel)).toBe(-1);
        }
      }
      // The caller's sentinel sits in the one position it filled and nowhere else on the record.
      expect(error.logicalName).toBe(SENTINELS[4]);
      expect(Object.keys(error).sort()).toEqual(PIPELINE_ERROR_FIELD_NAMES);
    }
  });
});

describe("errors retain no document text, secret, or health value", () => {
  test("no constructed error contains any sentinel value", () => {
    const document = sentinelDocument();
    // The probe document really does carry every forbidden class of value.
    expect(JSON.stringify(document).length > 0).toBe(true);
    for (const oneCase of KIND_CASES) {
      const error = oneCase.build(LOGICAL_NAME);
      const serialized = JSON.stringify(error);
      for (const sentinel of SENTINELS) {
        expect(serialized.indexOf(sentinel)).toBe(-1);
      }
      // The error has no field for the document, its bytes, or any value read from it.
      expect(Object.keys(error).sort()).toEqual(PIPELINE_ERROR_FIELD_NAMES);
      expect(error.logicalName).toBe(LOGICAL_NAME);
    }
  });

  test("a kind with no declared context cannot hold a field", () => {
    for (const oneCase of KIND_CASES) {
      if (oneCase.expectedContextKeys.length !== 0) {
        continue;
      }
      expect(Object.keys(oneCase.build(LOGICAL_NAME).safeContext).length).toBe(0);
    }
  });

  test("the compile-time probes are present for bun run check", () => {
    // The probes themselves are never called: `bun run check` executes their evidence, because each
    // expect-error directive becomes an error if the line below it ever compiles.
    expect(typeof typeBoundaryProbes).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// Valid control: a successful load keeps source bytes and model apart
// ---------------------------------------------------------------------------

describe("valid control: a current-version load", () => {
  /** One static-bundle source, its exact bytes, and one disposable model. */
  const sourceBytes = new Uint8Array([123, 125]);

  function provenance(overrides?: Partial<DocumentProvenance>): DocumentProvenance {
    return {
      source: { kind: "static-bundle" },
      logicalName: "exercises.json",
      sourceFamily: "exercises",
      sourceBytes: sourceBytes,
      sourceDigest: {
        algorithm: "sha256",
        value: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"
      },
      migrationPath: { declaredSchemaVersion: 1, currentSchemaVersion: 1, steps: [] },
      validationVersion: "schemas/exercises/v1",
      ...overrides
    };
  }

  function loadedResult(): PipelineResult<Record<string, unknown>> {
    return {
      status: "loaded",
      stage: "semantic",
      provenance: provenance(),
      model: { format: "repjot/exercises", schemaVersion: 1, exercises: [], equipment: [] }
    };
  }

  test("the load names the last Section 12 stage and carries one provenance record", () => {
    const result = loadedResult();
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      return;
    }
    expect(SECTION_12_LOAD_STAGES.indexOf(result.stage) !== -1).toBe(true);
    expect(result.stage).toBe("semantic");
    expect(result.provenance.logicalName).toBe("exercises.json");
    expect(result.provenance.sourceFamily).toBe("exercises");
    expect(result.provenance.source).toEqual({ kind: "static-bundle" });
    expect(result.provenance.validationVersion.length > 0).toBe(true);
    expect(result.provenance.sourceDigest.algorithm).toBe("sha256");
  });

  test("the model stays separate from the retained exact bytes", () => {
    const result = loadedResult();
    if (result.status !== "loaded") {
      expect("loaded").toBe("unreachable");
      return;
    }
    expect(result.provenance.sourceBytes).toBe(sourceBytes);
    expect(result.provenance.sourceBytes).not.toBe(result.model);
    expect(result.provenance.sourceBytes.length).toBe(2);
    expect(Object.keys(result).sort()).toEqual(["model", "provenance", "stage", "status"]);
  });

  test("a current-version document records an ordered empty migration path", () => {
    const result = loadedResult();
    if (result.status !== "loaded") {
      expect("loaded").toBe("unreachable");
      return;
    }
    expect(result.provenance.migrationPath.steps).toEqual([]);
    expect(result.provenance.migrationPath.declaredSchemaVersion).toBe(
      result.provenance.migrationPath.currentSchemaVersion
    );
  });

  test("an older declared version records the applied steps in order", () => {
    const driveProvenance = provenance({
      source: { kind: "drive-app-data-folder", driveFileId: "drive-file-id-1" },
      logicalName: LOGICAL_NAME,
      sourceFamily: "results",
      // Type shape only: Phase 14 owns the registries that produce real step identifiers.
      migrationPath: {
        declaredSchemaVersion: 1,
        currentSchemaVersion: 3,
        steps: ["step-1-to-2", "step-2-to-3"]
      },
      validationVersion: "schemas/results/v3"
    });
    expect(driveProvenance.migrationPath.steps).toEqual(["step-1-to-2", "step-2-to-3"]);
    expect(driveProvenance.migrationPath.declaredSchemaVersion).toBe(1);
    expect(driveProvenance.migrationPath.currentSchemaVersion).toBe(3);
    expect(driveProvenance.logicalName).toBe(LOGICAL_NAME);
    expect(driveProvenance.source).toEqual({ kind: "drive-app-data-folder", driveFileId: "drive-file-id-1" });
  });

  test("the caller declares the expected family and the canonical name", () => {
    const request: PipelineRequest = {
      expectedFamily: "results",
      logicalName: LOGICAL_NAME,
      source: { kind: "drive-app-data-folder", driveFileId: "drive-file-id-1" },
      bytes: sourceBytes
    };
    expect(request.expectedFamily).toBe("results");
    expect(request.logicalName).toBe(LOGICAL_NAME);
    expect(request.bytes).toBe(sourceBytes);
  });
});

// ===========================================================================
// P12-T01 — the parse stage: exact bytes, strict UTF-8, one parse, no project
// limit. Authority: docs/implementation/phase-12.md, docs/contracts/
// families-and-files.md FF-14, docs/decisions/document-parsing-byte-order-mark.md
// (D-02, approved Option BOM-2), docs/ARCHITECTURE.md Sections 12, 14, 15, 7,
// docs/implementation/GATES.md Section 3.
// ===========================================================================

// ---------------------------------------------------------------------------
// Deterministic inputs
// ---------------------------------------------------------------------------

/** The UTF-8 encoding of U+FEFF, the byte-order mark that D-02 admits at offset 0 only. */
const MARK = [0xef, 0xbb, 0xbf];

/** The four RFC 8259 Section 2 whitespace bytes, in the order the prologue scan accepts them. */
const PROLOGUE_WHITESPACE = [0x20, 0x09, 0x0a, 0x0d];

const inputEncoder = new TextEncoder();

/**
 * One input array from text and byte lists, in order. Every call returns a fresh array, so no case can
 * observe another case's bytes and no case can be affected by a write it did not make.
 */
function inputBytes(...parts: (string | number[])[]): Uint8Array {
  const all: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") {
      for (const byte of inputEncoder.encode(part)) {
        all.push(byte);
      }
    } else {
      for (const byte of part) {
        all.push(byte);
      }
    }
  }
  return new Uint8Array(all);
}

/** The same text with exactly one leading byte-order mark in front of it. */
function textWithMark(text: string): Uint8Array {
  return inputBytes(MARK, text);
}

/** One parse call, always with the same canonical logical filename (FF-06). */
function parseTheseBytes(bytes: Uint8Array): SafeJsonParseResult {
  const input: SafeJsonParseInput = { logicalName: LOGICAL_NAME, bytes: bytes };
  return parseDocumentBytes(input);
}

/** Own-property equality of two byte arrays, by value and by length, with no library comparison. */
function sameByteValues(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

/** A detached copy of the caller's view of its own bytes, taken before a call. */
function byteSnapshot(bytes: Uint8Array): Uint8Array {
  return bytes.slice();
}

// -- stress generators. Each is a pure function of its integer argument: no clock, no random value,
//    no locale, no network, and no fixture file (phase-12.md "Generate deterministic large and deep
//    documents during tests. Keep source-control fixtures small.").

function repeated(unit: string, times: number): string {
  return unit.repeat(times);
}

/** A valid array nested `depth` levels deep, each level holding exactly one element. */
function deepArrayText(depth: number): string {
  return repeated("[", depth) + repeated("]", depth);
}

/** A valid object nested `depth` levels deep, each level holding exactly one member named `a`. */
function deepObjectText(depth: number): string {
  return repeated('{"a":', depth) + "1" + repeated("}", depth);
}

/** A valid object whose only key is `keyLength` characters long. */
function hugeKeyText(keyLength: number): string {
  return '{"' + repeated("k", keyLength) + '":1}';
}

/** A valid array of `count` numbers, values cycling deterministically through 0..96. */
function manyNumberArrayText(count: number): string {
  const items: string[] = [];
  for (let index = 0; index < count; index += 1) {
    items.push(String(index % 97));
  }
  return "[" + items.join(",") + "]";
}

/** A valid object with `count` members, keys named k0..k(count-1). */
function manyKeyObjectText(count: number): string {
  const items: string[] = [];
  for (let index = 0; index < count; index += 1) {
    items.push('"k' + String(index) + '":' + String(index));
  }
  return "{" + items.join(",") + "}";
}

/**
 * One results-shaped document with `sessionCount` sessions, built to the field names of the accepted
 * results family so the largest stress case resembles a real shard rather than a synthetic blob.
 */
function resultsDocumentText(sessionCount: number): string {
  const sessions: Record<string, unknown>[] = [];
  for (let index = 0; index < sessionCount; index += 1) {
    const sets: Record<string, unknown>[] = [];
    for (let setIndex = 0; setIndex < 5; setIndex += 1) {
      sets.push({
        index: setIndex,
        completion: "completed",
        weight: { value: 40 + setIndex, unit: "kg" },
        reps: 5 + setIndex,
        effort: "moderate"
      });
    }
    sessions.push({
      id: "00000000-0000-4000-8000-" + String(10000 + index),
      workoutId: "workout-" + String(index % 250),
      exerciseId: "exercise-" + String(index % 400),
      startedAtUtc: "2026-09-0" + String(1 + (index % 7)) + "T06:30:00Z",
      endedAtUtc: "2026-09-0" + String(1 + (index % 7)) + "T06:45:00Z",
      lifecycle: "completed",
      sets: sets
    });
  }
  return JSON.stringify({
    format: "repjot/results",
    schemaVersion: 1,
    yearMonthUtc: "2026-09",
    sessions: sessions
  });
}

/**
 * How many array levels a generated nest holds. A loop, so a deep value needs no stack. The innermost
 * array is empty, which is why the loop stops on length 0 as well as on a non-array.
 */
function arrayDepth(value: unknown): number {
  let depth = 0;
  let node: unknown = value;
  while (Array.isArray(node)) {
    depth += 1;
    node = node.length === 0 ? undefined : node[0];
  }
  return depth;
}

/** How deep a one-member-per-level object nest reaches. A loop, so a deep value needs no stack. */
function objectDepth(value: unknown): number {
  let depth = 0;
  let node: unknown = value;
  while (typeof node === "object" && node !== null && !Array.isArray(node)) {
    const keys = Object.keys(node);
    if (keys.length !== 1) {
      break;
    }
    node = (node as Record<string, unknown>)[keys[0]];
    depth += 1;
  }
  return depth;
}

// -- stress measurements. Recorded, never asserted: phase-12.md acceptance says "Stress measurements
//    are recorded without defining a limit", and GATES.md Section 3 forbids the opposite reading, "Do
//    not convert desktop stress results into a Kindle limit". No assertion below reads elapsed time, no
//    number here appears in the module, and physical Kindle evidence belongs to Phase 89.

/** One recorded stress measurement: what was parsed, how big it was, and what the shape turned out to be. */
interface StressMeasurement {
  readonly label: string;
  readonly shape: string;
  readonly inputBytes: number;
  readonly observedShape: string;
  readonly elapsedMs: number;
}

const STRESS_MEASUREMENTS: StressMeasurement[] = [];

/**
 * Parses one generated document, records the measurement, and returns the parsed value. The clock read
 * is the only one in this file and it measures only: it cannot change the input, which stays a pure
 * function of the generator arguments.
 */
function measureParse(label: string, shape: string, text: string, observed: string): SafeJsonParseResult {
  const bytes = inputBytes(text);
  const startedAtMs = Date.now();
  const result = parseTheseBytes(bytes);
  const elapsedMs = Date.now() - startedAtMs;
  STRESS_MEASUREMENTS.push({
    label: label,
    shape: shape,
    inputBytes: bytes.length,
    observedShape: observed,
    elapsedMs: elapsedMs
  });
  console.log(
    "P12T01-MEASURE label=" +
      label +
      " shape=" +
      shape +
      " inputBytes=" +
      String(bytes.length) +
      " observed=" +
      observed +
      " elapsedMs=" +
      String(elapsedMs) +
      " status=" +
      result.status
  );
  return result;
}

/** One parse-stage case: fresh bytes on every run, plus the outcome this phase's contract fixes. */
interface ParseCase {
  readonly label: string;
  readonly bytes: () => Uint8Array;
  /** "parsed", or the one reason of the closed set that this input must produce. */
  readonly expect: ParseFailureReason | "parsed";
}

/**
 * One malformed input and the one reason it must produce. A case cannot declare "parsed", so no row of
 * the table below can drift into a valid case.
 */
interface MalformedCase {
  readonly label: string;
  readonly bytes: () => Uint8Array;
  readonly expect: ParseFailureReason;
}

/**
 * Malformed encoding and malformed JSON, kept in their own group so a stress document cannot mask a
 * byte-level rejection and one rejection cannot mask a stress document (phase-12.md "Test malformed
 * bytes separately from valid stress documents.").
 */
const MALFORMED_BYTE_CASES: readonly MalformedCase[] = [
  // -- invalid UTF-8. Each row is one class of ill-formed sequence, so a decoder that only recognized
  //    one class could not pass.
  { label: "lone continuation byte", bytes: () => inputBytes([0x80]), expect: "invalid-utf8" },
  { label: "continuation byte inside a string", bytes: () => inputBytes('{"note":"', [0x80], '"}'), expect: "invalid-utf8" },
  { label: "truncated two-byte sequence", bytes: () => inputBytes([0xc3]), expect: "invalid-utf8" },
  { label: "truncated three-byte sequence", bytes: () => inputBytes('{"a":', [0xe2, 0x82]), expect: "invalid-utf8" },
  { label: "truncated four-byte sequence", bytes: () => inputBytes([0xf0, 0x9f, 0x98]), expect: "invalid-utf8" },
  { label: "overlong two-byte encoding of U+0000", bytes: () => inputBytes([0xc0, 0x80]), expect: "invalid-utf8" },
  { label: "overlong three-byte encoding", bytes: () => inputBytes([0xe0, 0x80, 0x80]), expect: "invalid-utf8" },
  { label: "overlong four-byte encoding", bytes: () => inputBytes([0xf0, 0x80, 0x80, 0x80]), expect: "invalid-utf8" },
  { label: "encoded lone surrogate D800", bytes: () => inputBytes([0xed, 0xa0, 0x80]), expect: "invalid-utf8" },
  { label: "encoded lone surrogate DFFF", bytes: () => inputBytes('{"a":"', [0xed, 0xbf, 0xbf], '"}'), expect: "invalid-utf8" },
  { label: "five-byte sequence start F5", bytes: () => inputBytes([0xf5, 0x80, 0x80, 0x80]), expect: "invalid-utf8" },
  { label: "invalid start byte FE", bytes: () => inputBytes([0xfe]), expect: "invalid-utf8" },
  { label: "invalid start byte FF inside a document", bytes: () => inputBytes('{"a":', [0xff], "}"), expect: "invalid-utf8" },
  { label: "truncated after a valid member", bytes: () => inputBytes('{"a":1,', [0xe2, 0x82]), expect: "invalid-utf8" },
  // -- malformed JSON over well-formed UTF-8.
  { label: "empty bytes", bytes: () => inputBytes(), expect: "malformed-json" },
  { label: "one space", bytes: () => inputBytes(" "), expect: "malformed-json" },
  { label: "only whitespace", bytes: () => inputBytes(" \t\n\r"), expect: "malformed-json" },
  { label: "byte-order mark and nothing else", bytes: () => inputBytes(MARK), expect: "malformed-json" },
  { label: "opening brace only", bytes: () => inputBytes("{"), expect: "malformed-json" },
  { label: "missing value", bytes: () => inputBytes('{"a":}'), expect: "malformed-json" },
  { label: "trailing comma", bytes: () => inputBytes('{"a":1,}'), expect: "malformed-json" },
  { label: "extra closing brace", bytes: () => inputBytes('{"a":1}}'), expect: "malformed-json" },
  { label: "unclosed array", bytes: () => inputBytes("[1,2"), expect: "malformed-json" },
  { label: "trailing second value", bytes: () => inputBytes("1 2"), expect: "malformed-json" },
  { label: "NaN is not JSON", bytes: () => inputBytes("NaN"), expect: "malformed-json" },
  { label: "Infinity is not JSON", bytes: () => inputBytes("Infinity"), expect: "malformed-json" },
  { label: "single-quoted string", bytes: () => inputBytes("'a'"), expect: "malformed-json" },
  { label: "leading zero number", bytes: () => inputBytes("01"), expect: "malformed-json" },
  { label: "unquoted key", bytes: () => inputBytes("{a:1}"), expect: "malformed-json" },
  { label: "comma outside any container", bytes: () => inputBytes(","), expect: "malformed-json" },
  { label: "document of dashes", bytes: () => inputBytes("---"), expect: "malformed-json" },
  // -- a byte-order mark at any offset greater than 0. FF-14 and D-02 make this a third, distinct
  //    reason, and none of these rows is an encoding failure or a JSON-syntax failure on its own.
  { label: "repeated mark", bytes: () => inputBytes(MARK, MARK, "{}"), expect: "byte-order-mark" },
  { label: "repeated mark with no document", bytes: () => inputBytes(MARK, MARK), expect: "byte-order-mark" },
  { label: "third mark in a row", bytes: () => inputBytes(MARK, MARK, MARK, "1"), expect: "byte-order-mark" },
  { label: "mark after one space", bytes: () => inputBytes(" ", MARK, "{}"), expect: "byte-order-mark" },
  { label: "mark after one newline", bytes: () => inputBytes("\n", MARK, "1"), expect: "byte-order-mark" },
  { label: "mark after one tab", bytes: () => inputBytes("\t", MARK, "[]"), expect: "byte-order-mark" },
  { label: "mark after one carriage return", bytes: () => inputBytes("\r", MARK, "[]"), expect: "byte-order-mark" },
  { label: "mark after all four whitespace bytes", bytes: () => inputBytes(" \t\n\r", MARK, "{}"), expect: "byte-order-mark" },
  { label: "mark after the accepted mark and whitespace", bytes: () => inputBytes(MARK, "   ", MARK, "{}"), expect: "byte-order-mark" },
  { label: "mark after newline and the accepted mark", bytes: () => inputBytes(MARK, "\n", MARK, "1"), expect: "byte-order-mark" },
  { label: "two marks then whitespace then a value", bytes: () => inputBytes(MARK, MARK, "  ", "1"), expect: "byte-order-mark" }
];

/**
 * Valid documents of every shape this stage must accept, including the ones an over-eager marker scan
 * or a non-strict decoder would reject. FF-14 positive column: "Valid UTF-8 JSON parses to `unknown`".
 */
interface ValidSmallCase {
  readonly label: string;
  readonly bytes: () => Uint8Array;
  readonly expectedValue: unknown;
}

const VALID_SMALL_CASES: readonly ValidSmallCase[] = [
  { label: "empty object", bytes: () => inputBytes("{}"), expectedValue: {} },
  { label: "empty array", bytes: () => inputBytes("[]"), expectedValue: [] },
  { label: "one leading mark then an object", bytes: () => textWithMark("{}"), expectedValue: {} },
  { label: "one leading mark then an array", bytes: () => textWithMark("[1,2,3]"), expectedValue: [1, 2, 3] },
  { label: "one leading mark then a string", bytes: () => textWithMark('"text"'), expectedValue: "text" },
  { label: "one leading mark then whitespace", bytes: () => textWithMark("  \n {}"), expectedValue: {} },
  { label: "one leading mark then zero", bytes: () => textWithMark("0"), expectedValue: 0 },
  { label: "whitespace prologue of all four bytes", bytes: () => inputBytes(" \t\n\r{}"), expectedValue: {} },
  { label: "interior whitespace", bytes: () => inputBytes('{ "a" : [ 1 , 2 ] }'), expectedValue: { a: [1, 2] } },
  // A U+FEFF code point inside a JSON string is string content. Its bytes are exactly a mark signature,
  // so a whole-document byte scan would reject these rows and FF-14 forbids rejecting valid input.
  { label: "raw mark bytes inside a string", bytes: () => inputBytes('{"note":"', MARK, '"}'), expectedValue: { note: "\uFEFF" } },
  { label: "three raw mark bytes inside one string", bytes: () => inputBytes('["', MARK, MARK, MARK, '"]'), expectedValue: ["\uFEFF\uFEFF\uFEFF"] },
  { label: "raw mark bytes split across two strings", bytes: () => inputBytes('{"a":"', MARK, '","b":"', MARK, '"}'), expectedValue: { a: "\uFEFF", b: "\uFEFF" } },
  { label: "one leading mark and a mark inside a string", bytes: () => textWithMark('{"a":"' + "\uFEFF" + '"}'), expectedValue: { a: "\uFEFF" } },
  { label: "escaped U+FEFF in a string", bytes: () => inputBytes('{"a":"\\uFEFF\\uFEFF"}'), expectedValue: { a: "\uFEFF\uFEFF" } },
  { label: "mark bytes as a key", bytes: () => inputBytes('{"', MARK, '":1}'), expectedValue: { "\uFEFF": 1 } },
  // Well-formed UTF-8 at the edges of the encoding, which a decoder stricter than the standard would fail.
  { label: "largest code point U+10FFFF", bytes: () => inputBytes([0x22, 0xf4, 0x8f, 0xbf, 0xbf, 0x22]), expectedValue: "\u{10FFFF}" },
  { label: "four-byte sequence inside a document", bytes: () => inputBytes('{"a":"', [0xf0, 0x9f, 0x98, 0x80], '"}'), expectedValue: { a: "\u{1F600}" } },
  { label: "a real U+FFFD in the source is content", bytes: () => inputBytes([0x22, 0xef, 0xbf, 0xbd, 0x22]), expectedValue: "\uFFFD" },
  { label: "a real U+FFFD beside a mark", bytes: () => inputBytes(MARK, '["', [0xef, 0xbf, 0xbd], '"]'), expectedValue: ["\uFFFD"] },
  { label: "two-byte sequence", bytes: () => inputBytes('{"a":"', [0xc3, 0xa9], '"}'), expectedValue: { a: "\u00E9" } },
  { label: "three-byte sequence", bytes: () => inputBytes('{"a":"', [0xe2, 0x82, 0xac], '"}'), expectedValue: { a: "\u20AC" } },
  { label: "escaped surrogate pair", bytes: () => inputBytes('"\\uD83D\\uDE00"'), expectedValue: "\u{1F600}" }
];

/** The primitive roots of phase-12.md "Edge cases", each alone as the whole document. */
const PRIMITIVE_ROOT_TEXTS: readonly (readonly [string, string, unknown])[] = [
  ["zero", "0", 0],
  ["negative one", "-1", -1],
  // Number("-0") keeps the sign, which the plain -0 literal in this source does not.
  ["negative zero", "-0", Number("-0")],
  ["fraction", "1.5", 1.5],
  ["exponent", "1e3", 1000],
  ["small exponent", "1.5e-8", 1.5e-8],
  ["true", "true", true],
  ["false", "false", false],
  ["null", "null", null],
  ["empty string", '""', ""],
  ["text string", '"text"', "text"],
  ["string with escapes", '"a\\tb\\nc\\u0044"', "a\tb\ncD"]
];

/**
 * The valid stress documents of phase-12.md "Tests or fixtures". Every input is generated from the
 * integers below with no clock, no random value, and no fixture file. The depths reach past the point
 * where the project's recursive JSON reader in src/curation/exact-json.ts gives up with "Maximum call
 * stack size exceeded" (measured at depth 50,000 in .agent-work/phase-12/logs/base-mechanism-probe.log),
 * so these rows are the FF-14 evidence that no project nesting threshold stands in this path.
 */
const STRESS_DEPTH_ARRAY = 200000;
const STRESS_DEPTH_OBJECT = 50000;
const STRESS_KEY_BYTES = 2 * 1024 * 1024;
const STRESS_NODE_COUNT_ARRAY = 300000;
const STRESS_KEY_COUNT = 150000;
const STRESS_STRING_BYTES = 8 * 1024 * 1024;
const STRESS_SESSION_COUNT = 20000;

// ---------------------------------------------------------------------------
// Group 1: malformed bytes (phase-12.md "Test malformed bytes separately from valid stress documents")
// ---------------------------------------------------------------------------

/** The descriptor row the accepted Phase 11 module fixes for every rejection this stage produces. */
const PARSE_FAILED_DESCRIPTOR = PIPELINE_ERROR_DESCRIPTORS["parse-failed"];

/** The three members of the closed reason set, written here independently of the module under test. */
const CLOSED_PARSE_REASONS: readonly ParseFailureReason[] = ["invalid-utf8", "malformed-json", "byte-order-mark"];

function rejectReasonOf(result: SafeJsonParseResult): string {
  return result.status === "rejected" ? result.error.safeContext.reason : "no-rejection";
}

describe("parse stage: malformed bytes are rejected with the closed reason set", () => {
  test("no malformed-byte case is accepted", () => {
    for (const oneCase of MALFORMED_BYTE_CASES) {
      expect(parseTheseBytes(oneCase.bytes()).status === "parsed").toBe(false);
    }
  });

  test("every malformed-byte case is one parse-failed rejection carrying its expected reason", () => {
    for (const oneCase of MALFORMED_BYTE_CASES) {
      const result = parseTheseBytes(oneCase.bytes());
      expect(result.status).toBe("rejected");
      if (result.status !== "rejected") {
        continue;
      }
      expect(result.error.kind).toBe("parse-failed");
      expect(result.error.safeContext.reason).toBe(oneCase.expect);
      expect(CLOSED_PARSE_REASONS.indexOf(result.error.safeContext.reason) !== -1).toBe(true);
      expect(result.error.logicalName).toBe(LOGICAL_NAME);
      expect(result.error.stage).toBe(PARSE_FAILED_DESCRIPTOR.stage);
      expect(result.error.userCategory).toBe(PARSE_FAILED_DESCRIPTOR.userCategory);
      expect(result.error.retryable).toBe(PARSE_FAILED_DESCRIPTOR.retryable);
      expect(result.error.safeMessage).toBe(PARSE_FAILED_DESCRIPTOR.safeMessage);
      expect(Object.keys(result).sort()).toEqual(["error", "status"]);
      expect(Object.keys(result.error).sort()).toEqual(PIPELINE_ERROR_FIELD_NAMES);
      expect(Object.keys(result.error.safeContext)).toEqual(["reason"]);
    }
  });

  test("the three failure classes are three distinct diagnostics", () => {
    const reasons: string[] = [];
    for (const oneCase of MALFORMED_BYTE_CASES) {
      const reason = rejectReasonOf(parseTheseBytes(oneCase.bytes()));
      if (reasons.indexOf(reason) === -1) {
        reasons.push(reason);
      }
    }
    expect(reasons.length).toBe(3);
    for (const reason of CLOSED_PARSE_REASONS) {
      expect(reasons.indexOf(reason) !== -1).toBe(true);
    }
    // Distinctness, stated as the pair the FF-14 negative column cares about: an encoding failure and a
    // marker failure are not reported as a JSON-syntax failure.
    const encoding = rejectReasonOf(parseTheseBytes(inputBytes([0xff])));
    const syntax = rejectReasonOf(parseTheseBytes(inputBytes("{")));
    const marker = rejectReasonOf(parseTheseBytes(inputBytes(MARK, MARK, "{}")));
    expect(encoding === syntax).toBe(false);
    expect(marker === syntax).toBe(false);
    expect(encoding === marker).toBe(false);
  });

  test("invalid UTF-8 never reaches the parser as a substitution character", () => {
    // A non-strict decode turns each of these into U+FFFD text that JSON.parse would then read as a
    // string, that is, a malformed document reported as valid. Each row stays one encoding rejection.
    const substitutionRows: readonly (readonly [string, Uint8Array])[] = [
      ["lone continuation", inputBytes('["a', [0x80], '"]')],
      ["truncated three-byte", inputBytes('["', [0xe2, 0x82])],
      ["overlong", inputBytes('["', [0xc0, 0x80], '"]')],
      ["encoded lone surrogate", inputBytes('["', [0xed, 0xa0, 0x80], '"]')]
    ];
    for (const row of substitutionRows) {
      expect(rejectReasonOf(parseTheseBytes(row[1]))).toBe("invalid-utf8");
      // The same shape with well-formed bytes parses, so the rejection is the bytes and not the wrapper.
      expect(parseTheseBytes(inputBytes('["a"]')).status).toBe("parsed");
    }
  });

  test("a marker is a marker only in the prologue, never inside a string", () => {
    // The positive half of the same boundary the group above tests: these rows carry the same three
    // bytes as every byte-order-mark rejection above.
    const rejected: string[] = [];
    for (const oneCase of VALID_SMALL_CASES) {
      const reason = rejectReasonOf(parseTheseBytes(oneCase.bytes()));
      if (reason !== "no-rejection") {
        rejected.push(oneCase.label + " -> " + reason);
      }
    }
    expect(rejected).toEqual([]);
  });

  test("empty bytes are one safe malformed-JSON rejection, not an exception and not undefined", () => {
    let result: SafeJsonParseResult | null = null;
    let escaped = false;
    try {
      result = parseTheseBytes(new Uint8Array(0));
    } catch {
      escaped = true;
    }
    expect(escaped).toBe(false);
    if (result === null) {
      expect("parsed").toBe("rejected");
      return;
    }
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      return;
    }
    expect(result.error.safeContext.reason).toBe("malformed-json");
    expect(result.error.kind).toBe("parse-failed");
    expect("value" in result).toBe(false);
  });

  test("a simulated engine failure inside the parser cannot escape the module", () => {
    // No valid input makes the engine report a resource failure on demand, so the failure is injected
    // for one call and restored. What the phase fixes about such a failure is that the caller still gets
    // one typed rejection and its own bytes unchanged, and that the closed reason set has no fourth
    // member for it (scope decision 4). Nothing here turns the injected failure into a limit.
    const bytes = inputBytes('{"a":[1,2,3]}');
    const before = byteSnapshot(bytes);
    let result: SafeJsonParseResult | null = null;
    let escaped = false;
    try {
      result = callWithFailingJsonParse(new RangeError("simulated engine resource failure"), bytes);
    } catch {
      escaped = true;
    }
    expect(escaped).toBe(false);
    if (result === null) {
      expect("parsed").toBe("rejected");
      return;
    }
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      return;
    }
    expect(result.error.kind).toBe("parse-failed");
    expect(result.error.safeContext.reason).toBe("malformed-json");
    expect(sameByteValues(bytes, before)).toBe(true);
  });

  test("a simulated engine failure inside the decoder cannot escape the module", () => {
    // A TypeError is the Encoding Standard's fatal-decode signal, so it is the encoding reason. Any
    // other throw is not an encoding decision and takes the closed set's non-encoding member.
    const bytes = inputBytes('{"a":1}');
    const before = byteSnapshot(bytes);
    const asEncoding = callWithFailingDecode(new TypeError("simulated fatal decode"), bytes);
    expect(asEncoding.status).toBe("rejected");
    if (asEncoding.status === "rejected") {
      expect(asEncoding.error.safeContext.reason).toBe("invalid-utf8");
    }
    const asResource = callWithFailingDecode(new RangeError("simulated decoder resource failure"), bytes);
    expect(asResource.status).toBe("rejected");
    if (asResource.status === "rejected") {
      expect(asResource.error.safeContext.reason).toBe("malformed-json");
    }
    expect(sameByteValues(bytes, before)).toBe(true);
    // The prototype is restored, so no later test inherits the injection.
    expect(new TextDecoder("utf-8", { fatal: true }).decode(inputBytes("ok"))).toBe("ok");
  });

  test("a simulated TextDecoder construction failure cannot escape the module", () => {
    // P12-J1-01. A platform resource failure can strike the decoder constructor as well as the decode
    // operation, and the edge case in phase-12.md covers both, so a constructor failure must produce the
    // same typed boundary rather than an exception the caller never sees. No valid input fails this way on
    // demand, so the failure is injected for one call and restored. Nothing here turns it into a limit.
    const bytes = inputBytes('{"a":[1,2,3]}');
    const before = byteSnapshot(bytes);
    // Valid control, taken with no substitution in place: these very bytes parse normally, so the
    // rejection below can only be the injected failure and no reading of this document's bytes.
    expect(parseTheseBytes(bytes).status).toBe("parsed");
    const result = callWithFailingTextDecoderConstruction(new RangeError("simulated decoder construction resource failure"), bytes);
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.error.kind).toBe("parse-failed");
      expect(Object.keys(result.error.safeContext)).toEqual(["reason"]);
      expect(result.error.safeContext.reason).toBe("malformed-json");
    }
    expect(sameByteValues(bytes, before)).toBe(true);
    assertNativeTextDecoderRestored();
  });

  test("a simulated TextDecoder construction TypeError is not read as an encoding failure", () => {
    // P12-J1-01, the mapping half. A TypeError is the Encoding Standard's signal from the decode
    // operation, so only that operation's TypeError may be the encoding reason; a constructor that throws
    // a TypeError is a platform failure and takes the closed set's non-encoding member. The two calls
    // below use one input and differ only in which engine step fails, which is what keeps the two catch
    // boundaries distinguishable instead of collapsed into one.
    const bytes = inputBytes('{"a":1}');
    const before = byteSnapshot(bytes);
    // Valid control, taken with no substitution in place.
    expect(parseTheseBytes(bytes).status).toBe("parsed");
    const construction = callWithFailingTextDecoderConstruction(new TypeError("simulated decoder construction failure"), bytes);
    expect(construction.status).toBe("rejected");
    if (construction.status === "rejected") {
      expect(construction.error.kind).toBe("parse-failed");
      expect(construction.error.safeContext.reason).toBe("malformed-json");
    }
    assertNativeTextDecoderRestored();
    const decoding = callWithFailingDecode(new TypeError("simulated fatal decode"), bytes);
    expect(decoding.status).toBe("rejected");
    if (decoding.status === "rejected") {
      expect(decoding.error.safeContext.reason).toBe("invalid-utf8");
    }
    expect(sameByteValues(bytes, before)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 2: valid documents, including every marker and encoding edge that must stay valid
// ---------------------------------------------------------------------------

describe("parse stage: valid documents parse once to an unknown value", () => {
  test("every valid small case is accepted with its expected value", () => {
    const failures: string[] = [];
    for (const oneCase of VALID_SMALL_CASES) {
      const result = parseTheseBytes(oneCase.bytes());
      if (result.status !== "parsed") {
        failures.push(oneCase.label + " rejected as " + rejectReasonOf(result));
        continue;
      }
      if (JSON.stringify(result.value) !== JSON.stringify(oneCase.expectedValue)) {
        failures.push(oneCase.label + " value " + String(JSON.stringify(result.value)));
      }
      if (Object.keys(result).sort().join(",") !== "status,value") {
        failures.push(oneCase.label + " keys " + Object.keys(result).sort().join(","));
      }
      if ("error" in result) {
        failures.push(oneCase.label + " carries an error field");
      }
    }
    expect(failures).toEqual([]);
  });

  test("one leading byte-order mark changes only the parsed view", () => {
    // D-02 Option BOM-2: "those three bytes are stripped only for the parsed/validated view". The same
    // text with and without the mark must produce the same value, and the caller's array must still hold
    // the mark, which is what cache, recovery, and export keep.
    const texts: readonly string[] = [
      "{}",
      "[1,2,3]",
      '"text"',
      "0",
      "null",
      '{"format":"repjot/exercises","schemaVersion":1}',
      "  {}",
      "[[[1]]]"
    ];
    for (const text of texts) {
      const without = parseTheseBytes(inputBytes(text));
      const bytesWithMark = textWithMark(text);
      const withMark = parseTheseBytes(bytesWithMark);
      expect(without.status).toBe("parsed");
      expect(withMark.status).toBe("parsed");
      if (withMark.status === "parsed" && without.status === "parsed") {
        expect(JSON.stringify(withMark.value)).toBe(JSON.stringify(without.value));
      }
      // The mark is still there, byte for byte, after the successful parse.
      expect(bytesWithMark.length).toBe(inputBytes(text).length + MARK.length);
      expect(sameByteValues(bytesWithMark.slice(0, MARK.length), inputBytes(MARK))).toBe(true);
    }
  });

  test("the primitive roots of phase-12.md parse at this stage, with and without a mark", () => {
    // A non-object root is Phase 13's envelope rejection, not this stage's: FF-14 says a valid document
    // "parses to `unknown` and proceeds to envelope recognition".
    const failures: string[] = [];
    for (const row of PRIMITIVE_ROOT_TEXTS) {
      const label = row[0];
      const plain = parseTheseBytes(inputBytes(row[1]));
      if (rejectReasonOf(plain) !== "no-rejection") {
        failures.push(label + " rejected as " + rejectReasonOf(plain));
      }
      expect(plain.status).toBe("parsed");
      if (plain.status === "parsed") {
        expect(plain.value).toBe(row[2]);
        expect(Object.is(plain.value, row[2])).toBe(true);
      }
      const marked = parseTheseBytes(textWithMark(row[1]));
      expect(marked.status).toBe("parsed");
      if (marked.status === "parsed") {
        expect(marked.value).toBe(row[2]);
      }
      if (marked.status !== "parsed") {
        failures.push(label + " with a mark rejected as " + rejectReasonOf(marked));
      }
    }
    expect(failures).toEqual([]);
    // null is a value, not an absence: this stage must not report it as missing input.
    const nullRoot = parseTheseBytes(inputBytes("null"));
    expect(nullRoot.status).toBe("parsed");
    if (nullRoot.status === "parsed") {
      expect(nullRoot.value === undefined).toBe(false);
      expect(nullRoot.value).toBe(null);
    }
  });
});

// ---------------------------------------------------------------------------
// Group 3: valid stress documents. Recorded measurements, never thresholds.
// ---------------------------------------------------------------------------

describe("parse stage: valid stress documents meet no project limit", () => {
  test("a deep array deeper than the project recursive reader reaches", () => {
    const result = measureParse(
      "deep-array",
      "depth=" + String(STRESS_DEPTH_ARRAY),
      deepArrayText(STRESS_DEPTH_ARRAY),
      "depth=" + String(STRESS_DEPTH_ARRAY)
    );
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(arrayDepth(result.value)).toBe(STRESS_DEPTH_ARRAY);
    }
  });

  test("a deep object of the same order", () => {
    const result = measureParse(
      "deep-object",
      "depth=" + String(STRESS_DEPTH_OBJECT),
      deepObjectText(STRESS_DEPTH_OBJECT),
      "depth=" + String(STRESS_DEPTH_OBJECT)
    );
    expect(result.status).toBe("parsed");
    if (result.status === "parsed") {
      expect(objectDepth(result.value)).toBe(STRESS_DEPTH_OBJECT);
    }
  });

  test("a multi-megabyte object key", () => {
    const result = measureParse(
      "huge-key",
      "keyBytes=" + String(STRESS_KEY_BYTES),
      hugeKeyText(STRESS_KEY_BYTES),
      "keyChars=" + String(STRESS_KEY_BYTES)
    );
    expect(result.status).toBe("parsed");
    if (result.status === "parsed" && result.value !== null && typeof result.value === "object") {
      const keys = Object.keys(result.value);
      expect(keys.length).toBe(1);
      expect(keys[0].length).toBe(STRESS_KEY_BYTES);
      expect((result.value as Record<string, unknown>)[keys[0]]).toBe(1);
    }
  });

  test("a large node count in an array", () => {
    const result = measureParse(
      "node-count-array",
      "nodes=" + String(STRESS_NODE_COUNT_ARRAY),
      manyNumberArrayText(STRESS_NODE_COUNT_ARRAY),
      "length=" + String(STRESS_NODE_COUNT_ARRAY)
    );
    expect(result.status).toBe("parsed");
    if (result.status === "parsed" && Array.isArray(result.value)) {
      expect(result.value.length).toBe(STRESS_NODE_COUNT_ARRAY);
      expect(result.value[0]).toBe(0);
      expect(result.value[STRESS_NODE_COUNT_ARRAY - 1]).toBe((STRESS_NODE_COUNT_ARRAY - 1) % 97);
    }
  });

  test("a large member count in an object", () => {
    const result = measureParse(
      "key-count-object",
      "members=" + String(STRESS_KEY_COUNT),
      manyKeyObjectText(STRESS_KEY_COUNT),
      "members=" + String(STRESS_KEY_COUNT)
    );
    expect(result.status).toBe("parsed");
    if (result.status === "parsed" && result.value !== null && typeof result.value === "object") {
      expect(Object.keys(result.value).length).toBe(STRESS_KEY_COUNT);
    }
  });

  test("a multi-megabyte string value", () => {
    const result = measureParse(
      "huge-string",
      "stringBytes=" + String(STRESS_STRING_BYTES),
      '"' + repeated("x", STRESS_STRING_BYTES) + '"',
      "codeUnits=" + String(STRESS_STRING_BYTES)
    );
    expect(result.status).toBe("parsed");
    if (result.status === "parsed" && typeof result.value === "string") {
      expect(result.value.length).toBe(STRESS_STRING_BYTES);
    }
  });

  test("a results-shaped document with twenty thousand sessions", () => {
    const text = resultsDocumentText(STRESS_SESSION_COUNT);
    const result = measureParse(
      "results-document",
      "sessions=" + String(STRESS_SESSION_COUNT),
      text,
      "sessions=" + String(STRESS_SESSION_COUNT)
    );
    expect(result.status).toBe("parsed");
    if (result.status === "parsed" && result.value !== null && typeof result.value === "object") {
      const sessions = (result.value as Record<string, unknown>).sessions;
      expect(Array.isArray(sessions)).toBe(true);
      if (Array.isArray(sessions)) {
        expect(sessions.length).toBe(STRESS_SESSION_COUNT);
      }
    }
  });

  test("the stress group recorded its measurements and asserted none of them", () => {
    // Nothing above compares elapsed time, and no number recorded here exists in the module: the
    // static scan below proves every numeric literal in the parse module is a byte signature.
    expect(STRESS_MEASUREMENTS.length).toBe(7);
    for (const oneMeasurement of STRESS_MEASUREMENTS) {
      expect(oneMeasurement.inputBytes > 0).toBe(true);
      expect(oneMeasurement.elapsedMs >= 0).toBe(true);
      expect(oneMeasurement.label.length > 0).toBe(true);
    }
    console.log("P12T01-MEASURE summary desktop bun measurements, recorded with no limit attached; " +
      "physical Kindle evidence belongs to Phase 89 (GATES.md Section 3)");
    for (const oneMeasurement of STRESS_MEASUREMENTS) {
      console.log(
        "P12T01-MEASURE row label=" + oneMeasurement.label +
          " shape=" + oneMeasurement.shape +
          " inputBytes=" + String(oneMeasurement.inputBytes) +
          " observed=" + oneMeasurement.observedShape +
          " elapsedMs=" + String(oneMeasurement.elapsedMs)
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Group 4: the caller's Uint8Array is retained on every path
// ---------------------------------------------------------------------------

/** Every malformed case, every valid small case, and two moderate generated documents, as one case list. */
const ALL_PATH_CASES: readonly ParseCase[] = ([] as ParseCase[])
  .concat(MALFORMED_BYTE_CASES.map((oneCase): ParseCase => ({ label: oneCase.label, bytes: oneCase.bytes, expect: oneCase.expect })))
  .concat(VALID_SMALL_CASES.map((oneCase): ParseCase => ({ label: oneCase.label, bytes: oneCase.bytes, expect: "parsed" })))
  .concat([
    { label: "moderate deep array", bytes: () => inputBytes(deepArrayText(5000)), expect: "parsed" },
    { label: "moderate results document", bytes: () => inputBytes(resultsDocumentText(200)), expect: "parsed" },
    { label: "moderate deep array with a mark", bytes: () => textWithMark(deepArrayText(5000)), expect: "parsed" }
  ]);

/** Every value a parse result may hand back, so a leaked byte reference is visible to a check. */
function ownValuesOf(result: SafeJsonParseResult): readonly unknown[] {
  return Object.keys(result).map((key) => (result as unknown as Record<string, unknown>)[key]);
}

describe("parse stage: the caller keeps its own bytes on every path", () => {
  test("no case, accepted or rejected, changes one byte of the caller's array", () => {
    for (const oneCase of ALL_PATH_CASES) {
      const bytes = oneCase.bytes();
      const before = byteSnapshot(bytes);
      const bufferIdentity = bytes.buffer;
      const lengthBefore = bytes.length;
      const byteOffsetBefore = bytes.byteOffset;
      let escaped = false;
      try {
        parseTheseBytes(bytes);
      } catch {
        escaped = true;
      }
      // Nothing escapes, so nothing can leave the caller mid-write.
      expect(escaped).toBe(false);
      expect(sameByteValues(bytes, before)).toBe(true);
      expect(bytes.buffer).toBe(bufferIdentity);
      expect(bytes.length).toBe(lengthBefore);
      expect(bytes.byteOffset).toBe(byteOffsetBefore);
    }
  });

  test("no result field hands back the caller's bytes, a view of them, or their buffer", () => {
    for (const oneCase of ALL_PATH_CASES) {
      const bytes = oneCase.bytes();
      const result = parseTheseBytes(bytes);
      for (const value of ownValuesOf(result)) {
        expect(value === bytes).toBe(false);
        expect(value instanceof Uint8Array).toBe(false);
        expect(value instanceof ArrayBuffer).toBe(false);
        expect(value instanceof SharedArrayBuffer).toBe(false);
        if (value !== null && typeof value === "object" && "buffer" in value) {
          expect((value as { buffer: unknown }).buffer === bytes.buffer).toBe(false);
        }
      }
    }
  });

  test("an accepted value does not alias the caller's bytes", () => {
    // After a successful parse the caller may reuse or clear its own buffer; the parsed value must not
    // move, because the parse stage handed back decoded text, never a window onto these bytes.
    for (const oneCase of VALID_SMALL_CASES) {
      const bytes = oneCase.bytes();
      const result = parseTheseBytes(bytes);
      if (result.status !== "parsed") {
        continue;
      }
      const before = JSON.stringify(result.value);
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = 0x20;
      }
      expect(JSON.stringify(result.value)).toBe(before);
    }
  });

  test("a rejection changes nothing outside its own return value", () => {
    // The parse stage owns no write path: it imports no Drive, IndexedDB, filesystem, DOM, or network
    // module, so a rejection cannot touch a remote byte, a cache row, or a pending edit (FF-14 failure
    // column, FF-20 "Last valid cache + raw remote bytes preserved for download"). The static half of
    // that claim is the import scan in the module-shape group below; this is the runtime half.
    const bytes = inputBytes('{"sessions":["', SENTINELS[0], '"]');
    const before = byteSnapshot(bytes);
    const result = parseTheseBytes(bytes);
    expect(rejectReasonOf(result)).toBe("malformed-json");
    expect(sameByteValues(bytes, before)).toBe(true);
    const rejected = parseTheseBytes(bytes);
    expect(rejectReasonOf(rejected)).toBe("malformed-json");
    expect(sameByteValues(bytes, before)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Group 5: one typed error, branched on kind and reason, from exactly one parse
// ---------------------------------------------------------------------------

/**
 * One caller's branch over the two fields this phase owns: the error discriminant and that kind's
 * declared reason. `safeMessage` is never read, which is the Phase 11 acceptance line applied to a real
 * parse failure ("Callers can branch on error kind without parsing messages").
 */
function branchForParseFailure(error: PipelineError): string {
  switch (error.kind) {
    case "parse-failed":
      switch (error.safeContext.reason) {
        case "invalid-utf8":
          return "report-encoding-failure";
        case "malformed-json":
          return "report-json-syntax-failure";
        case "byte-order-mark":
          return "report-byte-order-mark";
        default:
          return "no-branch";
      }
    default:
      return "not-a-parse-failure";
  }
}

/** The expected branch per reason, written here independently of the module under test. */
const BRANCH_PER_REASON: Readonly<Record<ParseFailureReason, string>> = {
  "invalid-utf8": "report-encoding-failure",
  "malformed-json": "report-json-syntax-failure",
  "byte-order-mark": "report-byte-order-mark"
};

/** Replaces `JSON.parse` with a thrower for one call, then restores it. */
function callWithFailingJsonParse(failure: unknown, bytes: Uint8Array): SafeJsonParseResult {
  const holder = JSON as unknown as { parse: (text: string) => unknown };
  const original = holder.parse;
  holder.parse = (): unknown => {
    throw failure;
  };
  try {
    return parseTheseBytes(bytes);
  } finally {
    holder.parse = original;
  }
}

/** Replaces `TextDecoder.prototype.decode` with a thrower for one call, then restores it. */
function callWithFailingDecode(failure: unknown, bytes: Uint8Array): SafeJsonParseResult {
  const holder = TextDecoder.prototype as unknown as { decode: (input?: ArrayBufferView | ArrayBuffer | null) => string };
  const original = holder.decode;
  holder.decode = (): string => {
    throw failure;
  };
  try {
    return parseTheseBytes(bytes);
  } finally {
    holder.decode = original;
  }
}

/** The native constructor, taken before any test substitutes it, for the restoration check below. */
const NATIVE_TEXT_DECODER = TextDecoder;

/**
 * Replaces the `TextDecoder` constructor with one that throws, for one call, then restores it. The
 * substitution lives on `globalThis`, which is what the module reads when it constructs a decoder. The
 * `finally` is what keeps the file safe: the constructor is put back on every path, including a path where
 * the module under test throws or a later assertion fails, so no other test can observe the substitution.
 */
function callWithFailingTextDecoderConstruction(failure: unknown, bytes: Uint8Array): SafeJsonParseResult {
  const holder = globalThis as unknown as { TextDecoder: typeof TextDecoder };
  const original = holder.TextDecoder;
  holder.TextDecoder = class {
    constructor() {
      throw failure;
    }
  } as unknown as typeof TextDecoder;
  try {
    return parseTheseBytes(bytes);
  } finally {
    holder.TextDecoder = original;
  }
}

/** Proof that no substitution survives: the global constructor is the native one and still decodes. */
function assertNativeTextDecoderRestored(): void {
  expect(TextDecoder).toBe(NATIVE_TEXT_DECODER);
  expect(new TextDecoder("utf-8", { fatal: true }).decode(inputBytes("ok"))).toBe("ok");
}

/** How many times one call reaches `JSON.parse`. */
function countJsonParseCalls(bytes: Uint8Array): { readonly calls: number; readonly result: SafeJsonParseResult } {
  const holder = JSON as unknown as { parse: (text: string) => unknown };
  const original = holder.parse;
  let calls = 0;
  holder.parse = (text: string): unknown => {
    calls += 1;
    return original.call(JSON, text);
  };
  let result: SafeJsonParseResult;
  try {
    result = parseTheseBytes(bytes);
  } finally {
    holder.parse = original;
  }
  return { calls: calls, result: result };
}

/** How many times one call reaches `TextDecoder.prototype.decode`. */
function countDecodeCalls(bytes: Uint8Array): { readonly calls: number; readonly result: SafeJsonParseResult } {
  const holder = TextDecoder.prototype as unknown as { decode: (input?: ArrayBufferView | ArrayBuffer | null) => string };
  const original = holder.decode;
  let calls = 0;
  holder.decode = function (input?: ArrayBufferView | ArrayBuffer | null): string {
    calls += 1;
    return original.call(this, input);
  };
  let result: SafeJsonParseResult;
  try {
    result = parseTheseBytes(bytes);
  } finally {
    holder.decode = original;
  }
  return { calls: calls, result: result };
}

describe("parse stage: callers branch on kind and reason without a message", () => {
  test("every rejection selects one branch from the reason alone", () => {
    for (const oneCase of MALFORMED_BYTE_CASES) {
      const result = parseTheseBytes(oneCase.bytes());
      if (result.status !== "rejected") {
        continue;
      }
      const branch = branchForParseFailure(result.error);
      expect(branch === "no-branch").toBe(false);
      expect(branch === "not-a-parse-failure").toBe(false);
      expect(BRANCH_PER_REASON[oneCase.expect]).toBe(branch);
    }
  });

  test("the reasons this stage can produce are exactly the three accepted members", () => {
    const observed: string[] = [];
    for (const oneCase of ALL_PATH_CASES) {
      const reason = rejectReasonOf(parseTheseBytes(oneCase.bytes()));
      if (reason !== "no-rejection" && observed.indexOf(reason) === -1) {
        observed.push(reason);
      }
    }
    expect(observed.length).toBe(3);
    for (const reason of observed) {
      expect(CLOSED_PARSE_REASONS.indexOf(reason as ParseFailureReason) !== -1).toBe(true);
    }
    for (const reason of CLOSED_PARSE_REASONS) {
      expect(observed.indexOf(reason) !== -1).toBe(true);
    }
  });

  test("a parse failure names no new user-facing kind and adds no field", () => {
    const result = parseTheseBytes(inputBytes("{" ));
    if (result.status !== "rejected") {
      expect("rejected").toBe("unreachable");
      return;
    }
    const error = result.error;
    expect(APP_ERROR_KINDS.indexOf(error.userCategory) !== -1).toBe(true);
    expect(SECTION_16_KINDS.indexOf(error.userCategory) !== -1).toBe(true);
    expect(Object.keys(error).sort()).toEqual(PIPELINE_ERROR_FIELD_NAMES);
    expect(Object.isFrozen(error)).toBe(true);
    expect(APP_ERROR_KINDS.length).toBe(13);
  });

  test("no rejection carries document text, and the fixed message never bends to the input", () => {
    // One input per reason class, each carrying a sentinel value in the position a careless error would
    // quote: the undecodable byte, the offending token, the second mark.
    const cases: readonly (readonly [string, Uint8Array, ParseFailureReason])[] = [
      ["encoding", inputBytes('{"note":"', SENTINELS[0], [0xff], '"}'), "invalid-utf8"],
      ["syntax", inputBytes('{"note":"' + SENTINELS[0] + '"]'), "malformed-json"],
      ["marker", inputBytes(MARK, " ", MARK, '{"note":"' + SENTINELS[0] + '"}'), "byte-order-mark"]
    ];
    for (const oneCase of cases) {
      const result = parseTheseBytes(oneCase[1]);
      expect(result.status).toBe("rejected");
      if (result.status !== "rejected") {
        continue;
      }
      expect(result.error.safeContext.reason).toBe(oneCase[2]);
      expect(result.error.logicalName).toBe(LOGICAL_NAME);
      expect(result.error.safeMessage).toBe(PARSE_FAILED_DESCRIPTOR.safeMessage);
      for (const sentinel of SENTINELS) {
        expect(JSON.stringify(result.error).indexOf(sentinel)).toBe(-1);
      }
    }
  });

  test("the stage parses exactly once and never falls back to a second parser", () => {
    const accepted = countJsonParseCalls(inputBytes('{"a":[1,2,3]}'));
    expect(accepted.calls).toBe(1);
    expect(accepted.result.status).toBe("parsed");

    const withMark = countJsonParseCalls(textWithMark('{"a":[1,2,3]}'));
    expect(withMark.calls).toBe(1);
    expect(withMark.result.status).toBe("parsed");

    const syntax = countJsonParseCalls(inputBytes("{" ));
    expect(syntax.calls).toBe(1);
    expect(rejectReasonOf(syntax.result)).toBe("malformed-json");

    const empty = countJsonParseCalls(new Uint8Array(0));
    expect(empty.calls).toBe(1);
    expect(rejectReasonOf(empty.result)).toBe("malformed-json");

    // A document that fails before the parser is reached is not parsed twice, and not parsed at all.
    const encoding = countJsonParseCalls(inputBytes([0xff, 0xfe]));
    expect(encoding.calls).toBe(0);
    expect(rejectReasonOf(encoding.result)).toBe("invalid-utf8");

    const marker = countJsonParseCalls(inputBytes(MARK, MARK, "{}"));
    expect(marker.calls).toBe(0);
    expect(rejectReasonOf(marker.result)).toBe("byte-order-mark");

    // Restored, so no later test inherits the wrapper.
    expect(JSON.parse("1")).toBe(1);
  });

  test("the stage decodes exactly once, and not at all once a marker is rejected", () => {
    const accepted = countDecodeCalls(inputBytes('{"a":1}'));
    expect(accepted.calls).toBe(1);
    expect(accepted.result.status).toBe("parsed");

    const encoding = countDecodeCalls(inputBytes([0xff]));
    expect(encoding.calls).toBe(1);
    expect(rejectReasonOf(encoding.result)).toBe("invalid-utf8");

    const syntax = countDecodeCalls(inputBytes("{"));
    expect(syntax.calls).toBe(1);
    expect(rejectReasonOf(syntax.result)).toBe("malformed-json");

    const marker = countDecodeCalls(inputBytes(MARK, MARK, "{}"));
    expect(marker.calls).toBe(0);
    expect(rejectReasonOf(marker.result)).toBe("byte-order-mark");

    expect(new TextDecoder("utf-8", { fatal: true }).decode(inputBytes("[1]"))).toBe("[1]");
  });

  test("the parsed value is unknown to this stage: no shape, envelope, or family decision", () => {
    // An envelope-looking document and a bare number are accepted the same way, with the same result
    // shape and no field naming a family, a version, or an envelope.
    const envelope = parseTheseBytes(inputBytes('{"format":"repjot/results","schemaVersion":1}'));
    const number = parseTheseBytes(inputBytes("7"));
    expect(envelope.status).toBe("parsed");
    expect(number.status).toBe("parsed");
    expect(Object.keys(envelope).sort()).toEqual(Object.keys(number).sort());
    expect(Object.keys(envelope).sort()).toEqual(["status", "value"]);
  });
});

// ---------------------------------------------------------------------------
// Group 6: module shape, purity, and ES2019 output (static evidence)
// ---------------------------------------------------------------------------

/** The module under test, read as text. The rows in this group close "no such mechanism exists", which
 * no single call can show; GATES.md Section 3 has the parent inspect the same diff. */
const PARSER_SOURCE = readFileSync(new URL("../src/documents/safe-json-parser.ts", import.meta.url), "utf8");

function stripBlockComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ");
}

function stripLineComments(source: string): string {
  return source.replace(/\/\/[^\n]*/g, " ");
}

/** Comments gone, string literals kept: what an import or identifier scan should see. */
function uncommented(source: string): string {
  return stripLineComments(stripBlockComments(source));
}

/** Comments gone and string literals emptied: what a numeric-literal scan should see. */
function codeOnly(source: string): string {
  return stripStrings(stripLineComments(stripBlockComments(source)));
}

function stripStrings(source: string): string {
  return source.replace(/"(?:[^"\\]|\\.)*"/g, '""');
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

/** Declared function names, taken from the module text itself so no name can hide from a scan. */
function declaredFunctions(code: string): string[] {
  const names: string[] = [];
  for (const hit of matchesOf(code, /\bfunction [A-Za-z_$][\w$]*/)) {
    names.push(hit.replace(/^.*\bfunction\s+/, ""));
  }
  return names;
}

/** The body of one declared function, by brace matching over comment- and string-free code. */
function functionBody(code: string, name: string): string {
  const start = code.indexOf("function " + name + "(");
  if (start === -1) {
    return "";
  }
  const open = code.indexOf("{", start);
  if (open === -1) {
    return "";
  }
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code.charAt(index) === "{") {
      depth += 1;
    } else if (code.charAt(index) === "}") {
      depth -= 1;
      if (depth === 0) {
        return code.slice(open, index + 1);
      }
    }
  }
  return code.slice(open);
}

/**
 * Every numeric literal the parse module may hold: the three marker bytes, the four RFC 8259 whitespace
 * bytes, and 0, 1, 2, 3, which name the marker position at byte offset 0, the two index steps that read a
 * marker signature, and its width. Any other number would be a new constant, and FF-14 admits no project
 * byte, nesting, or node constant. The list cannot prove that an allowed number is used harmlessly, so
 * GATES.md Section 3 keeps the diff inspection with the parent for that part.
 */
const ALLOWED_NUMERIC_LITERALS: readonly string[] = [
  "0xef",
  "0xbb",
  "0xbf",
  "0x20",
  "0x09",
  "0x0a",
  "0x0d",
  "3",
  "2",
  "1",
  "0"
];

/** Names that would put a capability on this path. GATES.md Section 3: "imports no DOM, clock, locale,
 * random, Svelte, Drive, or IndexedDB module"; phase-12 scope adds no I/O of any kind. */
const FORBIDDEN_MODULE_IDENTIFIERS: readonly (readonly [string, string])[] = [
  ["fetch", "no network (the fetch adapter is Phase 17)"],
  ["XMLHttpRequest", "no network"],
  ["indexedDB", "no IndexedDB (Phases 19-26)"],
  ["IDBKeyRange", "no IndexedDB"],
  ["localStorage", "no browser storage"],
  ["sessionStorage", "no browser storage"],
  ["document", "no DOM"],
  ["window", "no DOM"],
  ["navigator", "no DOM"],
  ["Blob", "no download path"],
  ["URL", "no download path"],
  ["Date", "no clock"],
  ["performance", "no clock"],
  ["setTimeout", "no timer"],
  ["setInterval", "no timer"],
  ["Math", "no arithmetic that could become a budget"],
  ["random", "no random input"],
  ["crypto", "no digest (Phase 16)"],
  ["Intl", "no locale"],
  ["toLocaleString", "no locale"],
  ["svelte", "no UI"],
  ["Drive", "no Drive adapter"],
  ["parseExactJson", "no project JSON grammar (scope decision 2)"],
  ["stringify", "no re-serialization of a document"],
  ["freeze", "nothing is frozen (scope decision 5)"],
  ["TextEncoder", "the stage encodes nothing"],
  ["eval", "no execution of content"],
  ["Function", "no execution of content"],
  ["require", "no CommonJS dependency"],
  ["write", "no write of any kind (FF-14, FF-20)"],
  ["node:", "no filesystem"],
  ["bun:", "no test or runtime API"]
];

/** Words that would name a limit. FF-14: "no project byte, nesting, or node thresholds". */
const FORBIDDEN_LIMIT_WORDS: readonly string[] = [
  "max",
  "maximum",
  "limit",
  "threshold",
  "budget",
  "quota",
  "capacity",
  "depth",
  "size",
  "truncat",
  "tooDeep",
  "tooLarge",
  "nodeCount",
  "byteLimit"
];

/** Syntax and library members newer than ES2019. docs/ARCHITECTURE.md Section 14: "The build parses every
 * executable output as ES2019 and scans for optional chaining and nullish coalescing";
 * String.prototype.replaceAll is the one demonstrated Svelte polyfill and stays unused. */
const FORBIDDEN_ES2020_TOKENS: readonly string[] = [
  "?.",
  "??",
  "??=",
  "||=",
  "&&=",
  "replaceAll",
  "matchAll",
  "hasOwn",
  "globalThis",
  "structuredClone",
  "BigInt",
  "WeakRef",
  ".at(",
  "toSorted",
  "toReversed",
  "findLast",
  "allSettled",
  "import.meta",
  "Object.entries"
];

describe("parse stage: module shape, purity, and ES2019 output", () => {
  test("the module exports one function and no table, constant, or class", () => {
    expect(Object.keys(safeJsonParserModule).sort()).toEqual(["parseDocumentBytes"]);
    expect(typeof safeJsonParserModule.parseDocumentBytes).toBe("function");
  });

  test("the module imports the accepted Phase 11 module and nothing else", () => {
    const specifiers = matchesOf(uncommented(PARSER_SOURCE), /from\s+"([^"]*)"/).map((hit) => hit.replace(/^from\s+"/, "").replace(/"$/, ""));
    // One value import for the error constructor and one type import for its types.
    expect(specifiers.length > 0).toBe(true);
    for (const specifier of specifiers) {
      expect(specifier).toBe("./pipeline-types");
    }
    expect(specifiers.length).toBe(2);
    expect(matchesOf(uncommented(PARSER_SOURCE), /\brequire\s*\(/).length).toBe(0);
    expect(matchesOf(uncommented(PARSER_SOURCE), /\bimport\s*\(/).length).toBe(0);
    expect(matchesOf(uncommented(PARSER_SOURCE), /export\s+\*/).length).toBe(0);
  });

  test("no forbidden capability appears anywhere in the module", () => {
    const source = uncommented(PARSER_SOURCE);
    for (const row of FORBIDDEN_MODULE_IDENTIFIERS) {
      const pattern = new RegExp("\\b" + row[0].replace(/[.]/g, "\\$&") + "\\b");
      expect(row[0] + " (" + row[1] + "): " + String(pattern.test(source))).toBe(row[0] + " (" + row[1] + "): false");
    }
  });

  test("every numeric literal in the module is a byte signature, never a size", () => {
    const literals = matchesOf(
      codeOnly(PARSER_SOURCE),
      /(?<![\w.])0x[0-9a-fA-F]+(?![\w])|(?<![\w.])\d+(?:\.\d+)?(?![\w])/
    );
    expect(literals.length > 0).toBe(true);
    for (const literal of literals) {
      expect(ALLOWED_NUMERIC_LITERALS.indexOf(literal) !== -1).toBe(true);
    }
  });

  test("no limit word appears in the module code", () => {
    const code = codeOnly(PARSER_SOURCE);
    for (const word of FORBIDDEN_LIMIT_WORDS) {
      const pattern = new RegExp("\\b" + word, "i");
      expect(word + ": " + String(pattern.test(code))).toBe(word + ": false");
    }
  });

  test("no function in the module calls itself or each other", () => {
    const code = codeOnly(PARSER_SOURCE);
    const names = declaredFunctions(code);
    // hasMarkAt, isJsonWhitespace, hasMarkAfterOffsetZero, rejectParse, parseDocumentBytes.
    expect(names.length).toBe(5);
    for (const name of names) {
      const body = functionBody(code, name);
      expect(name + " has a body: " + String(body.length > 0)).toBe(name + " has a body: true");
      expect(name + " is not called from its own body: " + String(new RegExp("\\b" + name + "\\b").test(body))).toBe(
        name + " is not called from its own body: false"
      );
    }
    // Mutual recursion is recursion: no two functions may call each other in both directions.
    for (const first of names) {
      for (const second of names) {
        if (first === second) {
          continue;
        }
        const firstCallsSecond = new RegExp("\\b" + second + "\\b").test(functionBody(code, first));
        const secondCallsFirst = new RegExp("\\b" + first + "\\b").test(functionBody(code, second));
        expect(String(firstCallsSecond && secondCallsFirst)).toBe("false");
      }
    }
  });

  test("the module stays ES2019-clean", () => {
    // Scanned on the raw source, comments included, so even a comment cannot carry one of these tokens
    // into a reader's eye. bun run check:compat is the build-side half of this row.
    for (const token of FORBIDDEN_ES2020_TOKENS) {
      expect(token + ": " + String(PARSER_SOURCE.indexOf(token) !== -1)).toBe(token + ": false");
    }
  });

  test("the module imports no fixture, data file, or document", () => {
    for (const forbidden of ["tests/", "data/", "fixtures", ".json"]) {
      expect(forbidden + ": " + String(PARSER_SOURCE.indexOf(forbidden) !== -1)).toBe(forbidden + ": false");
    }
  });
});

// ---------------------------------------------------------------------------
// Compile-time probes for the parse stage. Never called: `bun run check` runs their evidence, because
// an expect-error directive is itself an error when the line below it compiles.
// ---------------------------------------------------------------------------

function parseStageTypeProbes(): void {
  const result = parseDocumentBytes({ logicalName: LOGICAL_NAME, bytes: new Uint8Array([]) });
  // @ts-expect-error an un-narrowed result is a union, so it has no value field of its own
  const valueBeforeNarrowing: unknown = result.value;
  // @ts-expect-error an accepted result carries no error
  const errorOnSuccess: unknown = result.status === "parsed" ? result.error : null;
  // @ts-expect-error the parsed value stays `unknown`, so no property of it may be read here
  const propertyOfUnknownValue: string = result.status === "parsed" ? String(result.value.format) : "";
  // @ts-expect-error the stage returns no bytes, no provenance, and no digest (Phase 16 owns those)
  const leakedBytes: Uint8Array | undefined = result.status === "parsed" ? result.bytes : undefined;
  // @ts-expect-error the accepted reason set is closed at three members, so no fourth reason exists
  const inventedReason: ParseFailureReason = "resource-exhausted";
  // @ts-expect-error the input has no field in which a caller could pass a limit
  const inputWithLimit: SafeJsonParseInput = { logicalName: LOGICAL_NAME, bytes: new Uint8Array([]), maxBytes: 10 };
  // A rejection error is the parse-failed member of the accepted union, so it is assignable to the
  // general pipeline error type that Phase 15 will carry. No assertion needed: this line must compile.
  const asPipelineError: PipelineError | null = result.status === "rejected" ? result.error : null;
  expect(valueBeforeNarrowing === undefined || valueBeforeNarrowing === null).toBe(true);
  expect(errorOnSuccess === null).toBe(true);
  expect(typeof propertyOfUnknownValue).toBe("string");
  expect(leakedBytes === undefined).toBe(true);
  expect(typeof inventedReason).toBe("string");
  expect(inputWithLimit.logicalName).toBe(LOGICAL_NAME);
  expect(asPipelineError === null).toBe(true);
}

describe("parse stage: compile-time boundaries", () => {
  test("the parse-stage type probes are present for bun run check", () => {
    expect(typeof parseStageTypeProbes).toBe("function");
  });
});
// ===========================================================================
// P13-T01 — the envelope stage: exact envelopes and exact logical names.
//
// Authority for every expectation below, written by hand from the sources rather than read back from
// the modules under test:
// - docs/implementation/phase-13.md: the objective "Select a family registry only from validated
//   envelope fields and the expected logical name", the Steps line "Read only own `format` and
//   `schemaVersion` fields from a plain object. Require a positive integer. Match static names and
//   result-name patterns to exact families", the seven edge cases, and the acceptance line "No shape
//   heuristic or Drive metadata influences family/version selection".
// - docs/ARCHITECTURE.md Section 12 stage 2 with its failure column, and the Section 7 module-table row
//   for src/documents/document-pipeline.ts.
// - docs/contracts/families-and-files.md FF-01..FF-11 and FF-20, and specs/schema-versioning.md
//   "Document envelope" and "Independent family versions".
// - The accepted Phase 11 kind set and `PIPELINE_ERROR_DESCRIPTORS`, and the accepted constants
//   CURRENT_VERSION and SUPPORT_FLOOR_VERSION.
//
// Every expectation names a kind, a safe-context field set, or a selection fact. No test decides an
// outcome by reading an error message; the one message comparison asserts that `safeMessage` equals the
// accepted fixed descriptor text, which is a table fact and not a branch. Inputs are fixed literals, the
// small fixtures under tests/fixtures/envelopes/, or values built by the helpers below: no clock, no
// random, no locale, no network, and no fixture outside that one new directory. Every rejected shape sits
// next to a passing valid control, and each of the seven phase edge cases has a named test.
// ===========================================================================

import { readdirSync } from "node:fs";

import * as documentEnvelopeModule from "../src/documents/envelope";
import * as documentPipelineModule from "../src/documents/document-pipeline";
import {
  envelopeOutcomeForRecognition,
  matchCanonicalLogicalName,
  selectFamilyRegistry
} from "../src/documents/envelope";
import type { FamilyRegistryOutcome, FamilyRegistrySelection } from "../src/documents/envelope";
import { recognizeDocumentEnvelope } from "../src/documents/document-pipeline";
import type { DocumentEnvelopeInput, DocumentEnvelopeResult } from "../src/documents/document-pipeline";
import { CURRENT_VERSION, SUPPORT_FLOOR_VERSION } from "../src/domain/families";
import type { DocumentFamily, EnvelopeRecognition } from "../src/domain/families";

// ---------------------------------------------------------------------------
// Fixed inputs for the envelope stage, written from the contract rows by hand
// ---------------------------------------------------------------------------

/** The canonical filename of each family (FF-01..FF-04). */
const ENVELOPE_NAME_BY_FAMILY: Readonly<Record<DocumentFamily, string>> = {
  exercises: "exercises.json",
  workouts: "workouts.json",
  preferences: "preferences.json",
  results: "results-2026-09.json"
};

/** The `format` value of each family (FF-01..FF-04). */
const ENVELOPE_FORMAT_BY_FAMILY: Readonly<Record<DocumentFamily, string>> = {
  exercises: "repjot/exercises",
  workouts: "repjot/workouts",
  preferences: "repjot/preferences",
  results: "repjot/results"
};

/** The accepted version facts of each family, written from src/domain/families.ts by hand. */
const ENVELOPE_EXPECTED_VERSIONS: Readonly<Record<DocumentFamily, { current: number; floor: number }>> = {
  exercises: { current: 1, floor: 1 },
  workouts: { current: 1, floor: 1 },
  preferences: { current: 1, floor: 1 },
  results: { current: 1, floor: 1 }
};

/** The four families, in the loading order of FF-19. */
const ENVELOPE_FAMILIES: readonly DocumentFamily[] = ["exercises", "workouts", "preferences", "results"];

/**
 * The kinds whose accepted descriptor stage is `"envelope"`, read from the accepted table so that a kind
 * added or renamed there shows up here rather than drifting from a hand-copied list.
 */
const envelopeStageKindList: PipelineErrorKind[] = [];
for (const kindOfTable of PIPELINE_ERROR_KINDS) {
  if (PIPELINE_ERROR_DESCRIPTORS[kindOfTable].stage === "envelope") {
    envelopeStageKindList.push(kindOfTable);
  }
}
const ENVELOPE_STAGE_KINDS: readonly PipelineErrorKind[] = envelopeStageKindList;

/**
 * The Section 16 category expected for each envelope kind, written from docs/ARCHITECTURE.md Section 16
 * ("Unsupported schema: Name file and supported version range", "Invalid document: Name file and safe
 * JSON path details") rather than from the descriptor table, so the assertion below compares the stage
 * with the authority instead of with itself.
 */
const ENVELOPE_EXPECTED_CATEGORY: Readonly<Record<string, PipelineUserCategory>> = {
  "envelope-not-object": "invalid_document",
  "envelope-missing-format": "invalid_document",
  "envelope-unknown-format": "invalid_document",
  "envelope-wrong-family": "invalid_document",
  "envelope-missing-version": "invalid_document",
  "envelope-non-number-version": "invalid_document",
  "envelope-non-integer-version": "invalid_document",
  "envelope-non-positive-version": "invalid_document",
  "envelope-unsupported-old-version": "unsupported_schema",
  "envelope-future-version": "unsupported_schema"
};

/** The five and only five fields of a family registry selection. */
const SELECTION_FIELD_NAMES: readonly string[] = [
  "currentSchemaVersion",
  "family",
  "format",
  "schemaVersion",
  "supportFloorSchemaVersion"
];

/** One valid results envelope, reused where only the envelope matters. */
function resultsEnvelope(version: number): Record<string, unknown> {
  return { format: "repjot/results", schemaVersion: version };
}

/** One envelope of one family, as a fresh mutable record. */
function familyEnvelope(family: DocumentFamily, version: number): Record<string, unknown> {
  return { format: ENVELOPE_FORMAT_BY_FAMILY[family], schemaVersion: version };
}

/**
 * One document that carries every forbidden value class plus a given envelope, with the named envelope
 * fields removed: the retention probe, where a leak of body text must show up in the error.
 */
function envelopeSentinelValue(envelope: Record<string, unknown>, omit?: readonly string[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  const sentinel = sentinelDocument();
  for (const key of Object.keys(sentinel)) {
    merged[key] = sentinel[key];
  }
  for (const key of Object.keys(envelope)) {
    merged[key] = envelope[key];
  }
  if (omit !== undefined) {
    for (const key of omit) {
      delete merged[key];
    }
  }
  return merged;
}

/**
 * The body field names of the four families. A value built by `envelopeReadProbe` reports every read of
 * any of them, which is how the tests below show that the stage reads two fields and nothing else.
 */
const ENVELOPE_BODY_FIELDS: readonly string[] = [
  "yearMonthUtc",
  "sessions",
  "sessionTombstones",
  "exercises",
  "workouts",
  "preferences",
  "nodes",
  "id",
  "note"
];

/** A results-shaped document that records every body-field read made through a getter. */
function envelopeReadProbe(): { readonly value: unknown; readonly reads: readonly string[] } {
  const reads: string[] = [];
  const target: Record<string, unknown> = { format: "repjot/results", schemaVersion: 1 };
  for (const field of ENVELOPE_BODY_FIELDS) {
    Object.defineProperty(target, field, {
      enumerable: true,
      get: (): unknown => {
        reads.push(field);
        return [];
      }
    });
  }
  return { value: target, reads: reads };
}

/** A document whose every property read throws: used to prove that no document is read at all. */
function envelopeUnreadableDocument(): unknown {
  const target: Record<string, unknown> = {};
  for (const field of ["format", "schemaVersion", "yearMonthUtc", "sessions"]) {
    Object.defineProperty(target, field, {
      enumerable: true,
      get: (): never => {
        throw new Error("the envelope stage must not read the document");
      }
    });
  }
  return target;
}

/** One deterministic structural description of a caller's value: identity-free, clock-free, total. */
function envelopeSnapshot(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return typeof value + ":" + String(value);
  }
  const parts: string[] = [
    Array.isArray(value) ? "array" : "object",
    "frozen:" + String(Object.isFrozen(value)),
    "extensible:" + String(Object.isExtensible(value)),
    "proto:" + (Object.getPrototypeOf(value) === Object.prototype ? "Object.prototype" : "other")
  ];
  for (const name of Object.getOwnPropertyNames(value).sort()) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (descriptor === undefined) {
      parts.push(name + ":missing");
      continue;
    }
    const flags =
      (descriptor.enumerable === true ? "e" : "") +
      (descriptor.configurable === true ? "c" : "") +
      (descriptor.writable === true ? "w" : "");
    parts.push(name + "{" + flags + "}=" + envelopeDescribeValue(descriptor.value));
  }
  return parts.join("|");
}

function envelopeDescribeValue(value: unknown): string {
  if (typeof value === "number" && Object.is(value, -0)) {
    return "number:-0";
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    return "nonfinite:" + String(value);
  }
  if (value !== null && typeof value === "object") {
    return "ref(" + (Array.isArray(value) ? "array" : "object") + ":" + Object.getOwnPropertyNames(value).length + ")";
  }
  return typeof value + ":" + String(value);
}

/** Run the stage. Every test hands it a value the way Phase 15 will: name plus parsed value. */
function runEnvelopeStage(logicalName: unknown, value: unknown): DocumentEnvelopeResult {
  return recognizeDocumentEnvelope({ logicalName: logicalName, value: value });
}

/** Assert the shape shared by every rejection, and return the error for the caller's own assertions. */
function expectRejected(result: DocumentEnvelopeResult, label: string): PipelineError {
  if (result.status !== "rejected") {
    throw new Error(label + ": expected a rejection, observed status " + result.status);
  }
  expect(label + " result fields: " + Object.keys(result).sort().join(",")).toBe(label + " result fields: error,status");
  const error = result.error;
  expect(label + " error fields: " + Object.keys(error).sort().join(",")).toBe(
    label + " error fields: " + PIPELINE_ERROR_FIELD_NAMES.join(",")
  );
  expect(label + " stage: " + error.stage).toBe(label + " stage: envelope");
  expect(label + " frozen: " + String(Object.isFrozen(error))).toBe(label + " frozen: true");
  expect(label + " context frozen: " + String(Object.isFrozen(error.safeContext))).toBe(label + " context frozen: true");
  return error;
}

/**
 * Read the two version integers a version-bound envelope error declares. The switch is the whole
 * decision: the kind discriminant selects the arm, and the arm alone reads its own declared context
 * fields, which is the accepted way to consume a pipeline error without parsing a message
 * (docs/implementation/phase-11.md acceptance "Callers can branch on error kind without parsing
 * messages"). An error of another kind reports `no-version-bound` instead of reading a field it does not
 * declare.
 */
function versionBoundFacts(error: PipelineError): { readonly kind: string; readonly declared: number; readonly bound: number } {
  switch (error.kind) {
    case "envelope-future-version":
      return { kind: error.kind, declared: error.safeContext.schemaVersion, bound: error.safeContext.currentSchemaVersion };
    case "envelope-unsupported-old-version":
      return { kind: error.kind, declared: error.safeContext.schemaVersion, bound: error.safeContext.supportFloor };
    default:
      return { kind: "no-version-bound", declared: -1, bound: -1 };
  }
}

/** Assert the shape shared by every acceptance, and return the selection. */
function expectRecognized(result: DocumentEnvelopeResult, label: string): FamilyRegistrySelection {
  if (result.status !== "recognized") {
    throw new Error(label + ": expected an acceptance, observed status " + result.status);
  }
  expect(label + " result fields: " + Object.keys(result).sort().join(",")).toBe(label + " result fields: selection,status");
  expect(label + " selection fields: " + Object.keys(result.selection).sort().join(",")).toBe(
    label + " selection fields: " + SELECTION_FIELD_NAMES.join(",")
  );
  expect(label + " selection frozen: " + String(Object.isFrozen(result.selection))).toBe(label + " selection frozen: true");
  return result.selection;
}

// ---------------------------------------------------------------------------
// Group 1: the exact logical-name match
// ---------------------------------------------------------------------------

describe("envelope stage: the exact name match selects a family or nothing", () => {
  test("each of the four canonical names matches exactly one family", () => {
    for (const family of ENVELOPE_FAMILIES) {
      const name = ENVELOPE_NAME_BY_FAMILY[family];
      const match = matchCanonicalLogicalName(name);
      expect(family + " status: " + match.status).toBe(family + " status: canonical");
      if (match.status !== "canonical") {
        continue;
      }
      expect(family + " family: " + match.family).toBe(family + " family: " + family);
      expect(family + " name: " + match.name).toBe(family + " name: " + name);
      // Only the family and the name: no version, no format, and no shard month is carried forward.
      expect(family + " fields: " + Object.keys(match).sort().join(",")).toBe(family + " fields: family,name,status");
    }
  });

  test("every monthly results shard name matches the results family and no other family", () => {
    for (const name of ["results-2026-09.json", "results-1999-01.json", "results-2026-12.json", "results-0000-01.json"]) {
      const match = matchCanonicalLogicalName(name);
      expect(name + " status: " + match.status).toBe(name + " status: canonical");
      expect(name + " family: " + (match.status === "canonical" ? match.family : "none")).toBe(name + " family: results");
    }
  });

  test("edge case results-2026-00.json: a near-miss name gets the distinct unrecognized outcome", () => {
    const rejectedNames = [
      "results-2026-00.json",
      "results-2026-13.json",
      "results-2026-9.json",
      "results-2026-09.JSON",
      "Results-2026-09.json",
      "results-2026-09.json5",
      "index.json",
      "preferences.JSON",
      "exercises.json5",
      "workouts.json ",
      ""
    ];
    for (const name of rejectedNames) {
      const match = matchCanonicalLogicalName(name);
      expect(name + " status: " + match.status).toBe(name + " status: unknown-file");
      expect(name + " name: " + String(match.name)).toBe(name + " name: " + name);
      expect(name + " fields: " + Object.keys(match).sort().join(",")).toBe(name + " fields: name,status");
    }
  });

  test("a name that is not a string is unrecognized with a null name and raises nothing", () => {
    for (const candidate of [null, undefined, 7, {}, [], true, Symbol("name"), function named() {}]) {
      const match = matchCanonicalLogicalName(candidate);
      expect("non-string status: " + match.status).toBe("non-string status: unknown-file");
      expect("non-string name: " + String(match.name)).toBe("non-string name: null");
      expect("non-string fields: " + Object.keys(match).sort().join(",")).toBe("non-string fields: name,status");
    }
  });

  test("the unrecognized outcome invents no pipeline error kind and fabricates no family value", () => {
    for (const name of ["results-2026-00.json", "results-2026-13.json", "index.json", "preferences.JSON"]) {
      const match = matchCanonicalLogicalName(name);
      const values: string[] = [];
      for (const key of Object.keys(match)) {
        const value = (match as Record<string, unknown>)[key];
        values.push(String(value));
        expect(name + " has no family field: " + key).not.toBe(name + " has no family field: family");
        expect(name + " has no version field: " + key).not.toBe(name + " has no version field: schemaVersion");
      }
      for (const kind of ENVELOPE_STAGE_KINDS) {
        expect(name + " value equals no error kind: " + String(values.indexOf(kind) !== -1)).toBe(
          name + " value equals no error kind: false"
        );
      }
      for (const family of ENVELOPE_FAMILIES) {
        expect(name + " value equals no family: " + String(values.indexOf(family) !== -1)).toBe(
          name + " value equals no family: false"
        );
      }
    }
  });

  test("the name match reads no document: its body names no envelope field", () => {
    const body = functionBody(uncommented(ENVELOPE_MODULE_SOURCE), "matchCanonicalLogicalName");
    expect("matcher has a body: " + String(body.length > 0)).toBe("matcher has a body: true");
    for (const field of ["format", "schemaVersion", "yearMonthUtc", "sessions"]) {
      expect("matcher never reads " + field + ": " + String(body.indexOf(field) !== -1)).toBe(
        "matcher never reads " + field + ": false"
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Group 2: one family registry selection per recognized document
// ---------------------------------------------------------------------------

describe("envelope stage: one family registry selection per recognized document", () => {
  test("the current version of each family selects that family's registry", () => {
    for (const family of ENVELOPE_FAMILIES) {
      const selection = expectRecognized(
        runEnvelopeStage(ENVELOPE_NAME_BY_FAMILY[family], familyEnvelope(family, 1)),
        family
      );
      expect(family + " family: " + selection.family).toBe(family + " family: " + family);
      expect(family + " format: " + selection.format).toBe(family + " format: " + ENVELOPE_FORMAT_BY_FAMILY[family]);
      expect(family + " declared version: " + String(selection.schemaVersion)).toBe(family + " declared version: 1");
      expect(family + " current: " + String(selection.currentSchemaVersion)).toBe(
        family + " current: " + String(ENVELOPE_EXPECTED_VERSIONS[family].current)
      );
      expect(family + " floor: " + String(selection.supportFloorSchemaVersion)).toBe(
        family + " floor: " + String(ENVELOPE_EXPECTED_VERSIONS[family].floor)
      );
    }
  });

  test("a selection never carries another family's format or version constants", () => {
    for (const family of ENVELOPE_FAMILIES) {
      const selection = expectRecognized(
        runEnvelopeStage(ENVELOPE_NAME_BY_FAMILY[family], familyEnvelope(family, 1)),
        family
      );
      expect(family + " current is the accepted constant: " + String(selection.currentSchemaVersion)).toBe(
        family + " current is the accepted constant: " + String(CURRENT_VERSION[family])
      );
      expect(family + " floor is the accepted constant: " + String(selection.supportFloorSchemaVersion)).toBe(
        family + " floor is the accepted constant: " + String(SUPPORT_FLOOR_VERSION[family])
      );
      for (const other of ENVELOPE_FAMILIES) {
        if (other === family) {
          continue;
        }
        expect(family + " is not " + other + ": " + String(selection.family === other)).toBe(family + " is not " + other + ": false");
        expect(family + " format is not " + other + ": " + String(selection.format === ENVELOPE_FORMAT_BY_FAMILY[other])).toBe(
          family + " format is not " + other + ": false"
        );
      }
    }
  });

  test("two result shards of the same family select the same registry", () => {
    const first = expectRecognized(runEnvelopeStage("results-2026-09.json", resultsEnvelope(1)), "shard 2026-09");
    const second = expectRecognized(runEnvelopeStage("results-1999-01.json", resultsEnvelope(1)), "shard 1999-01");
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.family).toBe("results");
    expect(second.family).toBe("results");
    // The filename is not part of a selection: only the five family-scoped facts are.
    expect(Object.keys(first).sort()).toEqual(SELECTION_FIELD_NAMES.slice());
  });

  test("the declared version is the document's own value while the range stays the family's", () => {
    // Table case, not a changed constant: `CURRENT_VERSION.results` is 1 today, so a declared v2 cannot
    // arrive as a document value. Handed to the accepted-status mapping directly it shows that a shard at
    // a newer declared version keeps its own declared version while the family's current version and
    // support floor stay the family's (FF-08 "Different monthly shards may hold different supported
    // versions").
    const atOne = envelopeOutcomeForRecognition(
      { status: "recognized", family: "results", format: "repjot/results", schemaVersion: 1 },
      "results-2026-09.json"
    );
    const atTwo = envelopeOutcomeForRecognition(
      { status: "recognized", family: "results", format: "repjot/results", schemaVersion: 2 },
      "results-2026-10.json"
    );
    if (atOne.status !== "selected" || atTwo.status !== "selected") {
      throw new Error("both table recognitions must select a registry");
    }
    expect(String(atOne.selection.schemaVersion)).toBe("1");
    expect(String(atTwo.selection.schemaVersion)).toBe("2");
    expect(String(atTwo.selection.family)).toBe("results");
    expect(String(atTwo.selection.format)).toBe("repjot/results");
    expect(String(atTwo.selection.currentSchemaVersion)).toBe(String(atOne.selection.currentSchemaVersion));
    expect(String(atTwo.selection.supportFloorSchemaVersion)).toBe(String(atOne.selection.supportFloorSchemaVersion));
  });

  test("a selection references nothing from the caller's document", () => {
    const doc = resultsEnvelope(1);
    doc.sessions = [];
    const selection = expectRecognized(runEnvelopeStage("results-2026-09.json", doc), "alias probe");
    const before = JSON.stringify(selection);
    doc.schemaVersion = 99;
    doc.sessions = [{ id: "created-after-the-call" }];
    doc.addedAfterTheCall = true;
    delete doc.sessions;
    expect(JSON.stringify(selection)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// One shared table of rejected shapes, used by the shape groups and again by the
// typed-error, retention, and purity groups.
// ---------------------------------------------------------------------------

interface EnvelopeStageCase {
  readonly label: string;
  readonly logicalName: string;
  readonly build: () => unknown;
  readonly expectedKind: PipelineErrorKind;
  readonly expectedContextJson: string;
}

/** An array that carries own `format` and `schemaVersion` properties: still not a plain object. */
function arrayWithEnvelopeFields(): unknown {
  const list: unknown[] = [{ format: "repjot/results", schemaVersion: 1 }];
  Object.defineProperty(list, "format", { enumerable: true, value: "repjot/results" });
  Object.defineProperty(list, "schemaVersion", { enumerable: true, value: 1 });
  return list;
}

/** An object whose only envelope fields live on the prototype chain. */
function inheritedEnvelopeOnly(): unknown {
  return Object.create({ format: "repjot/results", schemaVersion: 1 });
}

/** An object with own `format` and an inherited `schemaVersion` only. */
function inheritedVersionOnly(): unknown {
  const target: Record<string, unknown> = { format: "repjot/results" };
  return Object.setPrototypeOf(target, { schemaVersion: 1 });
}

/** An object with own `format` and an inherited `format` shadowed by nothing else. */
function ownFormatInheritedNothing(): unknown {
  return { format: "repjot/results" };
}

/** One rejected shape per envelope condition, each with the kind and context it must produce. */
const ENVELOPE_STAGE_CASES: readonly EnvelopeStageCase[] = [
  { label: "root: empty array", logicalName: "results-2026-09.json", build: (): unknown => [], expectedKind: "envelope-not-object", expectedContextJson: "{}" },
  { label: "root: array of documents", logicalName: "results-2026-09.json", build: (): unknown => [{ format: "repjot/results", schemaVersion: 1 }], expectedKind: "envelope-not-object", expectedContextJson: "{}" },
  { label: "root: array with own envelope fields", logicalName: "exercises.json", build: arrayWithEnvelopeFields, expectedKind: "envelope-not-object", expectedContextJson: "{}" },
  { label: "root: null", logicalName: "results-2026-09.json", build: (): unknown => null, expectedKind: "envelope-not-object", expectedContextJson: "{}" },
  { label: "root: number", logicalName: "results-2026-09.json", build: (): unknown => 7, expectedKind: "envelope-not-object", expectedContextJson: "{}" },
  { label: "root: string", logicalName: "results-2026-09.json", build: (): unknown => "repjot/results", expectedKind: "envelope-not-object", expectedContextJson: "{}" },
  { label: "root: boolean", logicalName: "results-2026-09.json", build: (): unknown => true, expectedKind: "envelope-not-object", expectedContextJson: "{}" },
  { label: "root: undefined", logicalName: "results-2026-09.json", build: (): unknown => undefined, expectedKind: "envelope-not-object", expectedContextJson: "{}" },
  { label: "root: function", logicalName: "results-2026-09.json", build: (): unknown => function root() {}, expectedKind: "envelope-not-object", expectedContextJson: "{}" },
  { label: "format: inherited only", logicalName: "results-2026-09.json", build: inheritedEnvelopeOnly, expectedKind: "envelope-missing-format", expectedContextJson: "{}" },
  { label: "format: own number", logicalName: "results-2026-09.json", build: (): unknown => ({ format: 5, schemaVersion: 1 }), expectedKind: "envelope-missing-format", expectedContextJson: "{}" },
  { label: "format: own null", logicalName: "preferences.json", build: (): unknown => ({ format: null, schemaVersion: 1 }), expectedKind: "envelope-missing-format", expectedContextJson: "{}" },
  { label: "format: own object", logicalName: "workouts.json", build: (): unknown => ({ format: {}, schemaVersion: 1 }), expectedKind: "envelope-missing-format", expectedContextJson: "{}" },
  { label: "format: own array", logicalName: "workouts.json", build: (): unknown => ({ format: [], schemaVersion: 1 }), expectedKind: "envelope-missing-format", expectedContextJson: "{}" },
  { label: "format: unknown nano", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/nano", schemaVersion: 1 }), expectedKind: "envelope-unknown-format", expectedContextJson: "{}" },
  { label: "format: empty string", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "", schemaVersion: 1 }), expectedKind: "envelope-unknown-format", expectedContextJson: "{}" },
  { label: "format: wrong case", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "RepJot/Results", schemaVersion: 1 }), expectedKind: "envelope-unknown-format", expectedContextJson: "{}" },
  { label: "format: trailing space", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results ", schemaVersion: 1 }), expectedKind: "envelope-unknown-format", expectedContextJson: "{}" },
  { label: "format: newline suffix", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results\n", schemaVersion: 1 }), expectedKind: "envelope-unknown-format", expectedContextJson: "{}" },
  { label: "family: preferences in a result name", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/preferences", schemaVersion: 1 }), expectedKind: "envelope-wrong-family", expectedContextJson: '{"family":"preferences","expectedFamily":"results"}' },
  { label: "family: results in a preference name", logicalName: "preferences.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: 1 }), expectedKind: "envelope-wrong-family", expectedContextJson: '{"family":"results","expectedFamily":"preferences"}' },
  { label: "family: exercises in a workout name", logicalName: "workouts.json", build: (): unknown => ({ format: "repjot/exercises", schemaVersion: 1 }), expectedKind: "envelope-wrong-family", expectedContextJson: '{"family":"exercises","expectedFamily":"workouts"}' },
  { label: "family: workouts in a result name", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/workouts", schemaVersion: 1 }), expectedKind: "envelope-wrong-family", expectedContextJson: '{"family":"workouts","expectedFamily":"results"}' },
  { label: "version: absent", logicalName: "results-2026-09.json", build: ownFormatInheritedNothing, expectedKind: "envelope-missing-version", expectedContextJson: "{}" },
  { label: "version: inherited only", logicalName: "results-2026-09.json", build: inheritedVersionOnly, expectedKind: "envelope-missing-version", expectedContextJson: "{}" },
  { label: "version: string one", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: "1" }), expectedKind: "envelope-non-number-version", expectedContextJson: "{}" },
  { label: "version: true", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: true }), expectedKind: "envelope-non-number-version", expectedContextJson: "{}" },
  { label: "version: false", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: false }), expectedKind: "envelope-non-number-version", expectedContextJson: "{}" },
  { label: "version: null", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: null }), expectedKind: "envelope-non-number-version", expectedContextJson: "{}" },
  { label: "version: object", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: {} }), expectedKind: "envelope-non-number-version", expectedContextJson: "{}" },
  { label: "version: array", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: [] }), expectedKind: "envelope-non-number-version", expectedContextJson: "{}" },
  { label: "version: own undefined", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: undefined }), expectedKind: "envelope-non-number-version", expectedContextJson: "{}" },
  { label: "version: boxed number", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: Object(1) }), expectedKind: "envelope-non-number-version", expectedContextJson: "{}" },
  { label: "version: bigint one", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: BigInt(1) }), expectedKind: "envelope-non-number-version", expectedContextJson: "{}" },
  { label: "version: symbol", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: Symbol("1") }), expectedKind: "envelope-non-number-version", expectedContextJson: "{}" },
  { label: "version: decimal 1.5", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: 1.5 }), expectedKind: "envelope-non-integer-version", expectedContextJson: "{}" },
  { label: "version: decimal -0.5", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: -0.5 }), expectedKind: "envelope-non-integer-version", expectedContextJson: "{}" },
  { label: "version: NaN", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: NaN }), expectedKind: "envelope-non-integer-version", expectedContextJson: "{}" },
  { label: "version: Infinity", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: Infinity }), expectedKind: "envelope-non-integer-version", expectedContextJson: "{}" },
  { label: "version: -Infinity", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: -Infinity }), expectedKind: "envelope-non-integer-version", expectedContextJson: "{}" },
  { label: "version: zero", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: 0 }), expectedKind: "envelope-non-positive-version", expectedContextJson: "{}" },
  { label: "version: negative one", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: -1 }), expectedKind: "envelope-non-positive-version", expectedContextJson: "{}" },
  { label: "version: negative zero", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: -0 }), expectedKind: "envelope-non-positive-version", expectedContextJson: "{}" },
  { label: "version: large negative", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: -1000000 }), expectedKind: "envelope-non-positive-version", expectedContextJson: "{}" },
  { label: "version: future two", logicalName: "results-2026-09.json", build: (): unknown => ({ format: "repjot/results", schemaVersion: 2 }), expectedKind: "envelope-future-version", expectedContextJson: '{"schemaVersion":2,"currentSchemaVersion":1}' },
  { label: "version: future large", logicalName: "preferences.json", build: (): unknown => ({ format: "repjot/preferences", schemaVersion: 9001 }), expectedKind: "envelope-future-version", expectedContextJson: '{"schemaVersion":9001,"currentSchemaVersion":1}' },
  { label: "version: future at floor edge", logicalName: "exercises.json", build: (): unknown => ({ format: "repjot/exercises", schemaVersion: 2 }), expectedKind: "envelope-future-version", expectedContextJson: '{"schemaVersion":2,"currentSchemaVersion":1}' }
];

// ---------------------------------------------------------------------------
// Group 3: only a plain object root is a document
// ---------------------------------------------------------------------------

describe("envelope stage: only a plain object root is a document", () => {
  test("edge case arrays: an array root rejects as envelope-not-object whatever it holds", () => {
    for (const root of [[], [1, 2, 3], [{ format: "repjot/results", schemaVersion: 1 }], arrayWithEnvelopeFields()]) {
      const error = expectRejected(runEnvelopeStage("results-2026-09.json", root), "array root");
      expect(error.kind).toBe("envelope-not-object");
      expect(Object.keys(error.safeContext)).toEqual([]);
      expect(JSON.stringify(error.safeContext)).toBe("{}");
    }
  });

  test("edge case arrays: the array rule holds for every family name, not only results", () => {
    for (const name of [ENVELOPE_NAME_BY_FAMILY.exercises, ENVELOPE_NAME_BY_FAMILY.workouts, ENVELOPE_NAME_BY_FAMILY.preferences, ENVELOPE_NAME_BY_FAMILY.results]) {
      const error = expectRejected(runEnvelopeStage(name, arrayWithEnvelopeFields()), name + " array root");
      expect(error.kind).toBe("envelope-not-object");
      expect(error.logicalName).toBe(name);
    }
  });

  test("a primitive root, null, and undefined each reject as envelope-not-object", () => {
    for (const root of [null, undefined, 0, 7, "repjot/results", "", true, false, function root() {}]) {
      const error = expectRejected(runEnvelopeStage("results-2026-09.json", root), "primitive root " + String(root));
      expect(error.kind).toBe("envelope-not-object");
    }
  });

  test("an array root produces no selection and reaches no version decision", () => {
    const result = runEnvelopeStage("results-2026-09.json", [{ format: "repjot/results", schemaVersion: 99 }]);
    expect(result.status).toBe("rejected");
    if (result.status !== "rejected") {
      return;
    }
    expect(result.error.kind).toBe("envelope-not-object");
    expect(String(ENVELOPE_STAGE_KINDS.indexOf(result.error.kind) !== -1)).toBe("true");
    // No version of the document body is named, because no version decision was reached.
    expect(JSON.stringify(result).indexOf("99")).toBe(-1);
  });

  test("valid control: the same fields on a plain object root are accepted", () => {
    expectRecognized(runEnvelopeStage("results-2026-09.json", resultsEnvelope(1)), "plain object control");
  });
});

// ---------------------------------------------------------------------------
// Group 4: own properties only
// ---------------------------------------------------------------------------

describe("envelope stage: only own format and schemaVersion are read", () => {
  test("edge case inherited fields: a document that inherits both envelope fields has neither", () => {
    const error = expectRejected(runEnvelopeStage("results-2026-09.json", inheritedEnvelopeOnly()), "inherited both");
    expect(error.kind).toBe("envelope-missing-format");
    expect(Object.keys(error.safeContext)).toEqual([]);
  });

  test("edge case inherited fields: an inherited schemaVersion is a missing version, not a malformed one", () => {
    const error = expectRejected(runEnvelopeStage("results-2026-09.json", inheritedVersionOnly()), "inherited version");
    expect(error.kind).toBe("envelope-missing-version");
    for (const malformed of [
      "envelope-non-number-version",
      "envelope-non-integer-version",
      "envelope-non-positive-version",
      "envelope-future-version"
    ] as readonly PipelineErrorKind[]) {
      expect("missing differs from " + malformed + ": " + String(error.kind === malformed)).toBe(
        "missing differs from " + malformed + ": false"
      );
    }
  });

  test("edge case inherited fields: an inherited format stays missing beside a valid own version", () => {
    const target: Record<string, unknown> = { schemaVersion: 1 };
    Object.setPrototypeOf(target, { format: "repjot/results" });
    const error = expectRejected(runEnvelopeStage("results-2026-09.json", target), "inherited format own version");
    expect(error.kind).toBe("envelope-missing-format");
  });

  test("edge case inherited fields: the prototype chain cannot supply a family either", () => {
    const target: Record<string, unknown> = { format: "repjot/results", body: true };
    Object.setPrototypeOf(target, { format: "repjot/preferences", schemaVersion: 1 });
    const error = expectRejected(runEnvelopeStage("results-2026-09.json", target), "shadowed prototype");
    // The own format is read and the own version is absent; the inherited pair changes nothing.
    expect(error.kind).toBe("envelope-missing-version");
  });

  test("a present but non-string own format is a missing format, never an unknown family", () => {
    for (const value of [5, null, {}, [], true, undefined]) {
      const error = expectRejected(
        runEnvelopeStage("results-2026-09.json", { format: value, schemaVersion: 1 }),
        "non-string format " + String(value)
      );
      expect(error.kind).toBe("envelope-missing-format");
    }
  });

  test("valid control: own envelope fields are read whatever else the object owns", () => {
    const doc = resultsEnvelope(1);
    doc.sessions = [];
    doc.yearMonthUtc = "2026-09";
    doc.notes = "extra own member";
    const selection = expectRecognized(runEnvelopeStage("results-2026-09.json", doc), "extra members control");
    expect(selection.family).toBe("results");
  });
});

// ---------------------------------------------------------------------------
// Group 5: unknown format and wrong family stay distinct
// ---------------------------------------------------------------------------

describe("envelope stage: unknown format and wrong family stay distinct", () => {
  test("an unrecognized format string rejects as envelope-unknown-format with an empty context", () => {
    for (const format of ["repjot/nano", "", "RepJot/Results", "repjot/results ", "repjot/results\n", "repjot/Results", "results"]) {
      const error = expectRejected(
        runEnvelopeStage("results-2026-09.json", { format: format, schemaVersion: 1 }),
        "unknown format " + format
      );
      expect(error.kind).toBe("envelope-unknown-format");
      expect(Object.keys(error.safeContext)).toEqual([]);
      expect(JSON.stringify(error.safeContext)).toBe("{}");
      if (format.length > 0) {
        // The canonical filename is a legitimate field of an error; the document's own format text is not.
        const echoed = JSON.stringify(error).replace(error.logicalName, "the-logical-name");
        expect("format text is never echoed: " + String(echoed.indexOf(format) !== -1)).toBe(
          "format text is never echoed: false"
        );
      }
    }
  });

  test("edge case a preferences envelope in a result filename: wrong-family carries exactly two names", () => {
    const forward = expectRejected(
      runEnvelopeStage("results-2026-09.json", { format: "repjot/preferences", schemaVersion: 1 }),
      "preferences in results"
    );
    expect(forward.kind).toBe("envelope-wrong-family");
    expect(Object.keys(forward.safeContext).sort()).toEqual(["expectedFamily", "family"]);
    expect(JSON.stringify(forward.safeContext)).toBe('{"family":"preferences","expectedFamily":"results"}');

    const reverse = expectRejected(
      runEnvelopeStage("preferences.json", { format: "repjot/results", schemaVersion: 1 }),
      "results in preferences"
    );
    expect(reverse.kind).toBe("envelope-wrong-family");
    expect(JSON.stringify(reverse.safeContext)).toBe('{"family":"results","expectedFamily":"preferences"}');
  });

  test("a family mismatch is not an unknown family, and the same string keeps its own outcome", () => {
    const mismatch = expectRejected(
      runEnvelopeStage("results-2026-09.json", { format: "repjot/preferences", schemaVersion: 1 }),
      "mismatch"
    );
    const unknown = expectRejected(
      runEnvelopeStage("results-2026-09.json", { format: "repjot/nano", schemaVersion: 1 }),
      "unknown"
    );
    expect(mismatch.kind).toBe("envelope-wrong-family");
    expect(unknown.kind).toBe("envelope-unknown-format");
    expect(String(mismatch.kind === unknown.kind)).toBe("false");
    expect(Object.keys(mismatch.safeContext).length).toBe(2);
    expect(Object.keys(unknown.safeContext).length).toBe(0);
    // The same recognized format string is a family, not an unknown, when the name agrees with it.
    expectRecognized(runEnvelopeStage("preferences.json", { format: "repjot/preferences", schemaVersion: 1 }), "agrees");
  });

  test("a wrong-family document is refused before its version is judged", () => {
    const error = expectRejected(
      runEnvelopeStage("results-2026-09.json", { format: "repjot/preferences", schemaVersion: 99 }),
      "wrong family and future version"
    );
    expect(error.kind).toBe("envelope-wrong-family");
    expect(JSON.stringify(error.safeContext).indexOf("99")).toBe(-1);
  });

  test("valid control: each family's own format under its own name is accepted", () => {
    for (const family of ENVELOPE_FAMILIES) {
      const selection = expectRecognized(
        runEnvelopeStage(ENVELOPE_NAME_BY_FAMILY[family], familyEnvelope(family, 1)),
        family + " pairing control"
      );
      expect(selection.family).toBe(family);
    }
  });
});

// ---------------------------------------------------------------------------
// Group 6: the version conditions keep their own kinds
// ---------------------------------------------------------------------------

describe("envelope stage: the three malformed version kinds stay distinct", () => {
  test("a version that is not a number rejects as envelope-non-number-version", () => {
    for (const value of ["1", "one", "", true, false, null, {}, [], Object(1), BigInt(1), Symbol("1")]) {
      const error = expectRejected(runEnvelopeStage("results-2026-09.json", { format: "repjot/results", schemaVersion: value }), "non-number " + String(value));
      expect(error.kind).toBe("envelope-non-number-version");
      expect(Object.keys(error.safeContext)).toEqual([]);
    }
  });

  test("edge case NaN-like values and decimal versions reject as envelope-non-integer-version", () => {
    for (const value of [1.5, -0.5, 0.0000001, NaN, Infinity, -Infinity, 1e-300]) {
      const error = expectRejected(runEnvelopeStage("results-2026-09.json", { format: "repjot/results", schemaVersion: value }), "non-integer " + String(value));
      expect(error.kind).toBe("envelope-non-integer-version");
    }
  });

  test("a whole number below one rejects as envelope-non-positive-version, -0 included", () => {
    for (const value of [0, -1, -2, -0, -1000000]) {
      const error = expectRejected(runEnvelopeStage("results-2026-09.json", { format: "repjot/results", schemaVersion: value }), "non-positive " + String(value));
      expect(error.kind).toBe("envelope-non-positive-version");
    }
    // -0 is a whole number that is not below one in magnitude but is below 1 in the accepted order, so it
    // is the non-positive kind and not the non-integer kind.
    const negativeZero = expectRejected(runEnvelopeStage("results-2026-09.json", resultsEnvelope(-0)), "negative zero");
    expect(negativeZero.kind).toBe("envelope-non-positive-version");
  });

  test("an absent version keeps its own kind apart from all three malformed kinds", () => {
    const absent = expectRejected(runEnvelopeStage("results-2026-09.json", { format: "repjot/results" }), "absent version");
    expect(absent.kind).toBe("envelope-missing-version");
    const observed = [
      expectRejected(runEnvelopeStage("results-2026-09.json", { format: "repjot/results", schemaVersion: "1" }), "string version").kind,
      expectRejected(runEnvelopeStage("results-2026-09.json", resultsEnvelope(1.5)), "decimal version").kind,
      expectRejected(runEnvelopeStage("results-2026-09.json", resultsEnvelope(0)), "zero version").kind
    ];
    expect(observed).toEqual(["envelope-non-number-version", "envelope-non-integer-version", "envelope-non-positive-version"]);
    for (const kind of observed) {
      expect("absent is not " + kind + ": " + String(absent.kind === kind)).toBe("absent is not " + kind + ": false");
    }
  });

  test("the three malformed kinds are three different kinds", () => {
    const kinds = [
      expectRejected(runEnvelopeStage("results-2026-09.json", { format: "repjot/results", schemaVersion: "1" }), "a").kind,
      expectRejected(runEnvelopeStage("results-2026-09.json", { format: "repjot/results", schemaVersion: 1.5 }), "b").kind,
      expectRejected(runEnvelopeStage("results-2026-09.json", { format: "repjot/results", schemaVersion: 0 }), "c").kind
    ];
    expect(new Set<string>(kinds).size).toBe(3);
    expect(kinds).toEqual([
      "envelope-non-number-version",
      "envelope-non-integer-version",
      "envelope-non-positive-version"
    ]);
  });

  test("valid control: version 1 is accepted for every family and reaches a selection", () => {
    for (const family of ENVELOPE_FAMILIES) {
      const selection = expectRecognized(
        runEnvelopeStage(ENVELOPE_NAME_BY_FAMILY[family], familyEnvelope(family, 1)),
        family + " version control"
      );
      expect(selection.schemaVersion).toBe(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Group 7: the version bounds are the accepted per-family constants
// ---------------------------------------------------------------------------

describe("envelope stage: version bounds come from the accepted family constants", () => {
  test("the accepted constant pair that makes the unsupported-old arm unreachable is stated", () => {
    for (const family of ENVELOPE_FAMILIES) {
      expect(family + " current: " + String(CURRENT_VERSION[family])).toBe(family + " current: 1");
      expect(family + " floor: " + String(SUPPORT_FLOOR_VERSION[family])).toBe(family + " floor: 1");
      expect(family + " floor equals current: " + String(SUPPORT_FLOOR_VERSION[family] === CURRENT_VERSION[family])).toBe(
        family + " floor equals current: true"
      );
    }
  });

  test("a version above the family's current version rejects as envelope-future-version", () => {
    for (const version of [2, 3, 9001, Number.MAX_SAFE_INTEGER]) {
      const error = expectRejected(runEnvelopeStage("results-2026-09.json", resultsEnvelope(version)), "future " + String(version));
      expect(error.kind).toBe("envelope-future-version");
      expect(Object.keys(error.safeContext).sort()).toEqual(["currentSchemaVersion", "schemaVersion"]);
      const facts = versionBoundFacts(error);
      expect(facts.kind).toBe("envelope-future-version");
      expect(facts.declared).toBe(version);
      expect(facts.bound).toBe(CURRENT_VERSION.results);
      expect(error.userCategory).toBe("unsupported_schema");
      expect(error.retryable).toBe(false);
    }
  });

  test("the unsupported-old arm is stated as a table case, with no constant changed", () => {
    // No document value can be both positive and below the floor while floor and current are both 1, so
    // FF-10's "unsupported-old" condition has no fixture. Its mapping is still required by FF-10 and
    // FF-20 ("Unsupported-old data reports the support floor and is never overwritten"), so it is proven
    // here as a table case over the accepted recognition status, with a synthetic floor and with
    // SUPPORT_FLOOR_VERSION left untouched.
    const outcome = envelopeOutcomeForRecognition(
      { status: "unsupported-old-version", schemaVersion: 1, supportFloor: 2 },
      "results-2026-09.json"
    );
    if (outcome.status !== "rejected") {
      throw new Error("an unsupported-old recognition must reject");
    }
    expect(outcome.error.kind).toBe("envelope-unsupported-old-version");
    expect(outcome.error.stage).toBe("envelope");
    expect(outcome.error.userCategory).toBe("unsupported_schema");
    expect(outcome.error.retryable).toBe(false);
    expect(Object.keys(outcome.error.safeContext).sort()).toEqual(["schemaVersion", "supportFloor"]);
    expect(JSON.stringify(outcome.error.safeContext)).toBe('{"schemaVersion":1,"supportFloor":2}');
    expect(String(SUPPORT_FLOOR_VERSION.results)).toBe("1");
  });

  test("future and unsupported-old are distinct kinds and both name a version range", () => {
    const future = expectRejected(runEnvelopeStage("results-2026-09.json", resultsEnvelope(2)), "future");
    const old = envelopeOutcomeForRecognition(
      { status: "unsupported-old-version", schemaVersion: 1, supportFloor: 2 },
      "results-2026-09.json"
    );
    if (old.status !== "rejected") {
      throw new Error("an unsupported-old recognition must reject");
    }
    expect(future.kind).toBe("envelope-future-version");
    expect(old.error.kind).toBe("envelope-unsupported-old-version");
    expect(String(future.kind === old.error.kind)).toBe("false");
    expect(Object.keys(future.safeContext).length).toBe(2);
    expect(Object.keys(old.error.safeContext).length).toBe(2);
    expect(future.userCategory).toBe(old.error.userCategory);
    expect(future.userCategory).toBe("unsupported_schema");
  });

  test("a future document keeps its own version in the safe context and nothing else", () => {
    const doc = envelopeSentinelValue({ format: "repjot/results", schemaVersion: 7 });
    const error = expectRejected(runEnvelopeStage("results-2026-09.json", doc), "future with body");
    expect(error.kind).toBe("envelope-future-version");
    expect(versionBoundFacts(error).declared).toBe(7);
    expect(versionBoundFacts(error).bound).toBe(CURRENT_VERSION.results);
    const serialized = JSON.stringify(error);
    for (const sentinel of SENTINELS) {
      expect("no sentinel in a future error: " + String(serialized.indexOf(sentinel) !== -1)).toBe("no sentinel in a future error: false");
    }
  });

  test("valid control: version 1 is accepted today for every family at the stated floor", () => {
    for (const family of ENVELOPE_FAMILIES) {
      const selection = expectRecognized(
        runEnvelopeStage(ENVELOPE_NAME_BY_FAMILY[family], familyEnvelope(family, CURRENT_VERSION[family])),
        family + " current-version control"
      );
      expect(selection.currentSchemaVersion).toBe(CURRENT_VERSION[family]);
      expect(selection.supportFloorSchemaVersion).toBe(SUPPORT_FLOOR_VERSION[family]);
      expect(selection.schemaVersion).toBe(CURRENT_VERSION[family]);
    }
  });
});

// ---------------------------------------------------------------------------
// Fixtures: one small file per distinct rejection, one valid control per family
// ---------------------------------------------------------------------------

/** The one fixture directory this phase adds. No other fixture path is read here. */
const ENVELOPE_FIXTURE_ROOT = "./fixtures/envelopes/";

const envelopeEncoder = new TextEncoder();

interface EnvelopeFixtureCase {
  readonly file: string;
  readonly logicalName: string;
  readonly expectedKind: PipelineErrorKind;
  readonly expectedContextJson: string;
}

interface EnvelopeControlFixture {
  readonly file: string;
  readonly logicalName: string;
  readonly family: DocumentFamily;
  readonly format: string;
}

/** One fixture per rejection that a document value can produce, named for what it proves. */
const ENVELOPE_REJECTION_FIXTURES: readonly EnvelopeFixtureCase[] = [
  { file: "envelope-not-object.json", logicalName: "results-2026-09.json", expectedKind: "envelope-not-object", expectedContextJson: "{}" },
  { file: "envelope-missing-format.json", logicalName: "results-2026-09.json", expectedKind: "envelope-missing-format", expectedContextJson: "{}" },
  { file: "envelope-unknown-format.json", logicalName: "results-2026-09.json", expectedKind: "envelope-unknown-format", expectedContextJson: "{}" },
  { file: "envelope-wrong-family.json", logicalName: "results-2026-09.json", expectedKind: "envelope-wrong-family", expectedContextJson: '{"family":"preferences","expectedFamily":"results"}' },
  { file: "envelope-missing-version.json", logicalName: "results-2026-09.json", expectedKind: "envelope-missing-version", expectedContextJson: "{}" },
  { file: "envelope-non-number-version.json", logicalName: "results-2026-09.json", expectedKind: "envelope-non-number-version", expectedContextJson: "{}" },
  { file: "envelope-non-integer-version.json", logicalName: "results-2026-09.json", expectedKind: "envelope-non-integer-version", expectedContextJson: "{}" },
  { file: "envelope-non-positive-version.json", logicalName: "results-2026-09.json", expectedKind: "envelope-non-positive-version", expectedContextJson: "{}" },
  { file: "envelope-future-version.json", logicalName: "results-2026-09.json", expectedKind: "envelope-future-version", expectedContextJson: '{"schemaVersion":2,"currentSchemaVersion":1}' }
];

/** One accepted document per family, exactly as its own canonical name would deliver it. */
const ENVELOPE_CONTROL_FIXTURES: readonly EnvelopeControlFixture[] = [
  { file: "control-exercises.json", logicalName: "exercises.json", family: "exercises", format: "repjot/exercises" },
  { file: "control-workouts.json", logicalName: "workouts.json", family: "workouts", format: "repjot/workouts" },
  { file: "control-preferences.json", logicalName: "preferences.json", family: "preferences", format: "repjot/preferences" },
  { file: "control-results.json", logicalName: "results-2026-09.json", family: "results", format: "repjot/results" }
];

/**
 * Read one fixture and hand its value on through the accepted parse stage, which is how the pipeline
 * produces the `unknown` this stage consumes (FF-14 "Valid UTF-8 JSON parses to `unknown` and proceeds to
 * envelope recognition"). A fixture that failed to parse would be a broken fixture, so this throws.
 */
function envelopeFixtureValue(file: string): unknown {
  const text = readFileSync(new URL(ENVELOPE_FIXTURE_ROOT + file, import.meta.url), "utf8");
  const parsed = parseDocumentBytes({ logicalName: file, bytes: envelopeEncoder.encode(text) });
  if (parsed.status !== "parsed") {
    throw new Error("an envelope fixture must reach the envelope stage: " + file);
  }
  return parsed.value;
}

/** The names of every file in the fixture directory, sorted, for the census test. */
function envelopeFixtureFiles(): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(new URL(ENVELOPE_FIXTURE_ROOT, import.meta.url))) {
    const name = String(entry);
    if (name.indexOf(".json") === name.length - 5) {
      names.push(name);
    }
  }
  return names.sort();
}

// ---------------------------------------------------------------------------
// Group 8: the fixture set
// ---------------------------------------------------------------------------

describe("envelope stage: one fixture per distinct rejection and one control per family", () => {
  test("each rejection fixture produces exactly its declared kind and safe context", () => {
    for (const fixture of ENVELOPE_REJECTION_FIXTURES) {
      const value = envelopeFixtureValue(fixture.file);
      const error = expectRejected(runEnvelopeStage(fixture.logicalName, value), fixture.file);
      expect(fixture.file + " kind: " + error.kind).toBe(fixture.file + " kind: " + fixture.expectedKind);
      expect(fixture.file + " context: " + JSON.stringify(error.safeContext)).toBe(fixture.file + " context: " + fixture.expectedContextJson);
      expect(fixture.file + " logicalName: " + error.logicalName).toBe(fixture.file + " logicalName: " + fixture.logicalName);
      expect(fixture.file + " category: " + error.userCategory).toBe(
        fixture.file + " category: " + ENVELOPE_EXPECTED_CATEGORY[fixture.expectedKind]
      );
    }
  });

  test("each control fixture is accepted into its own family registry", () => {
    for (const fixture of ENVELOPE_CONTROL_FIXTURES) {
      const selection = expectRecognized(runEnvelopeStage(fixture.logicalName, envelopeFixtureValue(fixture.file)), fixture.file);
      expect(fixture.file + " family: " + selection.family).toBe(fixture.file + " family: " + fixture.family);
      expect(fixture.file + " format: " + selection.format).toBe(fixture.file + " format: " + fixture.format);
      expect(fixture.file + " declared: " + selection.schemaVersion).toBe(fixture.file + " declared: 1");
    }
  });

  test("the fixture and table set covers every envelope kind the accepted table declares", () => {
    const fixtureKinds: string[] = [];
    for (const fixture of ENVELOPE_REJECTION_FIXTURES) {
      fixtureKinds.push(fixture.expectedKind);
    }
    expect(new Set<string>(fixtureKinds).size).toBe(fixtureKinds.length);
    // One kind has no fixture because no document value can produce it while the floor equals current;
    // it is stated as a table case instead, so the union of the two still covers the whole set.
    const covered = new Set<string>(fixtureKinds);
    covered.add("envelope-unsupported-old-version");
    for (const kind of ENVELOPE_STAGE_KINDS) {
      expect(kind + " is covered: " + String(covered.has(kind))).toBe(kind + " is covered: true");
    }
    expect(covered.size).toBe(ENVELOPE_STAGE_KINDS.length);
  });

  test("every fixture file is used and no fixture is a full-size document", () => {
    const used: string[] = [];
    for (const fixture of ENVELOPE_REJECTION_FIXTURES) {
      used.push(fixture.file);
    }
    for (const fixture of ENVELOPE_CONTROL_FIXTURES) {
      used.push(fixture.file);
    }
    expect(new Set<string>(used).size).toBe(used.length);
    expect(envelopeFixtureFiles()).toEqual(used.slice().sort());
    for (const name of envelopeFixtureFiles()) {
      const bytes = envelopeEncoder.encode(readFileSync(new URL(ENVELOPE_FIXTURE_ROOT + name, import.meta.url), "utf8")).length;
      expect(name + " is small: " + String(bytes < 200)).toBe(name + " is small: true");
    }
  });

  test("a fixture rejected once is accepted after its envelope is corrected", () => {
    const value = envelopeFixtureValue("envelope-future-version.json");
    const error = expectRejected(runEnvelopeStage("results-2026-09.json", value), "future fixture");
    expect(error.kind).toBe("envelope-future-version");
    const corrected = value as Record<string, unknown>;
    corrected.schemaVersion = 1;
    expectRecognized(runEnvelopeStage("results-2026-09.json", corrected), "corrected fixture");
  });
});

// ---------------------------------------------------------------------------
// Group 9: a name that is not canonical selects no registry
// ---------------------------------------------------------------------------

describe("envelope stage: a name that is not canonical selects no registry", () => {
  test("edge case results-2026-00.json: a valid envelope under a near-miss name selects nothing", () => {
    const nearMisses = [
      "results-2026-00.json",
      "results-2026-13.json",
      "results-2026-9.json",
      "results-2026-09.JSON",
      "Results-2026-09.json",
      "results-2026-09.json5",
      "index.json",
      "preferences.JSON"
    ];
    for (const name of nearMisses) {
      for (const family of ENVELOPE_FAMILIES) {
        const result = runEnvelopeStage(name, familyEnvelope(family, 1));
        expect(name + " status: " + result.status).toBe(name + " status: unknown-file");
        expect(name + " fields: " + Object.keys(result).sort().join(",")).toBe(name + " fields: name,status");
      }
    }
  });

  test("the refusal carries no kind, no family, no version, and no registry handle", () => {
    const result = runEnvelopeStage("results-2026-00.json", resultsEnvelope(1));
    if (result.status !== "unknown-file") {
      throw new Error("expected the refusal outcome");
    }
    expect(String(result.name)).toBe("results-2026-00.json");
    // The candidate name is the one fact the refusal may carry, so it is removed before the search.
    const serialized = JSON.stringify(result).replace(String(result.name), "the-candidate-name");
    for (const kind of ENVELOPE_STAGE_KINDS) {
      expect("no kind text: " + String(serialized.indexOf(kind) !== -1)).toBe("no kind text: false");
    }
    for (const family of ENVELOPE_FAMILIES) {
      expect("no family text: " + String(serialized.indexOf(family) !== -1)).toBe("no family text: false");
    }
    expect("no version field: " + String(serialized.indexOf("schemaVersion") !== -1)).toBe("no version field: false");
    expect("no format text: " + String(serialized.indexOf("repjot/") !== -1)).toBe("no format text: false");
    expect("no selection field: " + String(serialized.indexOf("selection") !== -1)).toBe("no selection field: false");
    expect("no error field: " + String(serialized.indexOf("error") !== -1)).toBe("no error field: false");
  });

  test("the refusal reads no document: a document whose every read throws is never read", () => {
    const unreadable = envelopeUnreadableDocument();
    for (const name of ["results-2026-00.json", "index.json", "preferences.JSON", "", 7, null]) {
      const result = runEnvelopeStage(name, unreadable);
      expect("refusal for " + String(name) + ": " + result.status).toBe("refusal for " + String(name) + ": unknown-file");
    }
  });

  test("the refusal does not touch the document and leaves it intact", () => {
    const doc = resultsEnvelope(1);
    const before = envelopeSnapshot(doc);
    expect(runEnvelopeStage("results-2026-00.json", doc).status).toBe("unknown-file");
    expect(envelopeSnapshot(doc)).toBe(before);
  });

  test("valid control: the identical value under its canonical name is recognized", () => {
    const doc = resultsEnvelope(1);
    expect(runEnvelopeStage("results-2026-00.json", doc).status).toBe("unknown-file");
    expectRecognized(runEnvelopeStage("results-2026-09.json", doc), "canonical control");
  });
});

// ---------------------------------------------------------------------------
// Group 10: no shape heuristic, no metadata, no semantic rule
// ---------------------------------------------------------------------------

describe("envelope stage: no shape heuristic and no metadata influence a selection", () => {
  test("two documents with the same envelope and different bodies select the same registry", () => {
    const minimal = { format: "repjot/results", schemaVersion: 1 };
    const full = {
      format: "repjot/results",
      schemaVersion: 1,
      yearMonthUtc: "2026-09",
      sessions: [{ id: "session-1", startedAtUtc: "2026-09-01T06:30:00Z" }],
      sessionTombstones: []
    };
    const first = expectRecognized(runEnvelopeStage("results-2026-09.json", minimal), "minimal body");
    const second = expectRecognized(runEnvelopeStage("results-2026-09.json", full), "full body");
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("a document body can neither rescue nor corrupt its own envelope", () => {
    const shaped = {
      format: "repjot/preferences",
      schemaVersion: 1,
      yearMonthUtc: "2026-09",
      sessions: [{ id: "session-1" }]
    };
    const error = expectRejected(runEnvelopeStage("results-2026-09.json", shaped), "results body, preferences envelope");
    expect(error.kind).toBe("envelope-wrong-family");
    expect(JSON.stringify(error.safeContext)).toBe('{"family":"preferences","expectedFamily":"results"}');

    const workoutsBody = { format: "repjot/workouts", schemaVersion: 1, sessions: [], yearMonthUtc: "2026-09" };
    const selection = expectRecognized(runEnvelopeStage("workouts.json", workoutsBody), "workouts envelope, results body");
    expect(selection.family).toBe("workouts");
  });

  test("a document needs no results shape at all to enter the results registry", () => {
    const selection = expectRecognized(runEnvelopeStage("results-2026-09.json", { format: "repjot/results", schemaVersion: 1 }), "no body");
    expect(selection.family).toBe("results");
  });

  test("Drive change indicators carried as document fields cannot change a selection", () => {
    const plain = { format: "repjot/results", schemaVersion: 1 };
    const withMetadata = {
      format: "repjot/results",
      schemaVersion: 1,
      md5Checksum: "1234567890abcdef",
      version: 99,
      modifiedTime: "2026-01-01T00:00:00Z",
      size: 4096,
      fileId: "drive-file-id-never-a-logical-name",
      mimeType: "application/json"
    };
    const first = expectRecognized(runEnvelopeStage("results-2026-09.json", plain), "plain");
    const second = expectRecognized(runEnvelopeStage("results-2026-09.json", withMetadata), "with metadata fields");
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  test("the stage input has no field for a change indicator, a family, or a byte", () => {
    const expected = JSON.stringify(runEnvelopeStage("results-2026-09.json", resultsEnvelope(1)));
    const widened: DocumentEnvelopeInput = Object.assign(
      { logicalName: "results-2026-09.json", value: resultsEnvelope(1) },
      { md5Checksum: "abc", modifiedTime: "2026-01-01T00:00:00Z", expectedFamily: "preferences", bytes: new Uint8Array([]) }
    );
    expect(JSON.stringify(recognizeDocumentEnvelope(widened))).toBe(expected);
  });

  test("edge case yearMonthUtc: a shard body that disagrees with its name is accepted here", () => {
    const mismatch = { format: "repjot/results", schemaVersion: 1, yearMonthUtc: "2026-01" };
    const selection = expectRecognized(runEnvelopeStage("results-2026-09.json", mismatch), "month mismatch");
    expect(selection.family).toBe("results");
    const match = { format: "repjot/results", schemaVersion: 1, yearMonthUtc: "2026-09" };
    expectRecognized(runEnvelopeStage("results-2026-09.json", match), "month match");
  });

  test("the stage never reads a body field, on an acceptance or on a rejection", () => {
    const accepted = envelopeReadProbe();
    expectRecognized(runEnvelopeStage("results-2026-09.json", accepted.value), "probe accepted");
    expect(accepted.reads.join(",")).toBe("");

    const rejected = envelopeReadProbe();
    const error = expectRejected(runEnvelopeStage("preferences.json", rejected.value), "probe rejected");
    expect(error.kind).toBe("envelope-wrong-family");
    expect(rejected.reads.join(",")).toBe("");
  });

  test("a rejection leaves nothing cached: the same value is judged the same way twice", () => {
    const doc = resultsEnvelope(2);
    const first = JSON.stringify(runEnvelopeStage("results-2026-09.json", doc));
    const second = JSON.stringify(runEnvelopeStage("results-2026-09.json", doc));
    expect(second).toBe(first);
    doc.schemaVersion = 1;
    expectRecognized(runEnvelopeStage("results-2026-09.json", doc), "recovered after two rejections");
  });

  test("after forty rejections the accepted case still selects the same registry", () => {
    const before = JSON.stringify(expectRecognized(runEnvelopeStage("results-2026-09.json", resultsEnvelope(1)), "before"));
    let index = 0;
    while (index < 40) {
      const oneCase = ENVELOPE_STAGE_CASES[index % ENVELOPE_STAGE_CASES.length];
      runEnvelopeStage(oneCase.logicalName, oneCase.build());
      runEnvelopeStage("results-2026-00.json", resultsEnvelope(1));
      index += 1;
    }
    const after = JSON.stringify(expectRecognized(runEnvelopeStage("results-2026-09.json", resultsEnvelope(1)), "after"));
    expect(after).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Group 11: every rejection is one frozen typed error, and every kind is reached
// ---------------------------------------------------------------------------

/** One accepted recognition status and the one outcome the stage must map it to. */
interface EnvelopeMappingCase {
  readonly label: string;
  readonly recognition: EnvelopeRecognition;
  readonly expectedKind: PipelineErrorKind | null;
  readonly expectedContextJson: string;
}

const ENVELOPE_MAPPING_CASES: readonly EnvelopeMappingCase[] = [
  { label: "recognized", recognition: { status: "recognized", family: "results", format: "repjot/results", schemaVersion: 1 }, expectedKind: null, expectedContextJson: "" },
  { label: "not-an-object", recognition: { status: "not-an-object" }, expectedKind: "envelope-not-object", expectedContextJson: "{}" },
  { label: "missing-format", recognition: { status: "missing-format" }, expectedKind: "envelope-missing-format", expectedContextJson: "{}" },
  { label: "unknown-format", recognition: { status: "unknown-format" }, expectedKind: "envelope-unknown-format", expectedContextJson: "{}" },
  { label: "wrong-family", recognition: { status: "wrong-family", family: "workouts", expectedFamily: "results" }, expectedKind: "envelope-wrong-family", expectedContextJson: '{"family":"workouts","expectedFamily":"results"}' },
  { label: "missing-version", recognition: { status: "missing-version" }, expectedKind: "envelope-missing-version", expectedContextJson: "{}" },
  { label: "non-number-version", recognition: { status: "non-number-version" }, expectedKind: "envelope-non-number-version", expectedContextJson: "{}" },
  { label: "non-integer-version", recognition: { status: "non-integer-version" }, expectedKind: "envelope-non-integer-version", expectedContextJson: "{}" },
  { label: "non-positive-version", recognition: { status: "non-positive-version" }, expectedKind: "envelope-non-positive-version", expectedContextJson: "{}" },
  { label: "unsupported-old-version", recognition: { status: "unsupported-old-version", schemaVersion: 1, supportFloor: 2 }, expectedKind: "envelope-unsupported-old-version", expectedContextJson: '{"schemaVersion":1,"supportFloor":2}' },
  { label: "future-version", recognition: { status: "future-version", schemaVersion: 4, currentVersion: 1 }, expectedKind: "envelope-future-version", expectedContextJson: '{"schemaVersion":4,"currentSchemaVersion":1}' }
];

/** The branch a caller takes per envelope kind. No case reads a message. */
function branchForEnvelopeKind(error: PipelineError): string {
  switch (error.kind) {
    case "envelope-not-object":
      return "report-invalid-document-root";
    case "envelope-missing-format":
      return "report-missing-format";
    case "envelope-unknown-format":
      return "report-unknown-format";
    case "envelope-wrong-family":
      return "report-family-mismatch";
    case "envelope-missing-version":
      return "report-missing-version";
    case "envelope-non-number-version":
      return "report-non-number-version";
    case "envelope-non-integer-version":
      return "report-non-integer-version";
    case "envelope-non-positive-version":
      return "report-non-positive-version";
    case "envelope-unsupported-old-version":
      return "report-support-floor";
    case "envelope-future-version":
      return "report-current-version";
    default:
      return "other-stage";
  }
}

/** The branch expected of each kind, written beside the Section 12 failure column by hand. */
const ENVELOPE_EXPECTED_BRANCH: Readonly<Record<string, string>> = {
  "envelope-not-object": "report-invalid-document-root",
  "envelope-missing-format": "report-missing-format",
  "envelope-unknown-format": "report-unknown-format",
  "envelope-wrong-family": "report-family-mismatch",
  "envelope-missing-version": "report-missing-version",
  "envelope-non-number-version": "report-non-number-version",
  "envelope-non-integer-version": "report-non-integer-version",
  "envelope-non-positive-version": "report-non-positive-version",
  "envelope-unsupported-old-version": "report-support-floor",
  "envelope-future-version": "report-current-version"
};

describe("envelope stage: every rejection is one frozen typed error", () => {
  test("every rejected shape yields the declared kind, context, stage, category, and message", () => {
    for (const oneCase of ENVELOPE_STAGE_CASES) {
      const error = expectRejected(runEnvelopeStage(oneCase.logicalName, oneCase.build()), oneCase.label);
      expect(oneCase.label + " kind: " + error.kind).toBe(oneCase.label + " kind: " + oneCase.expectedKind);
      expect(oneCase.label + " context: " + JSON.stringify(error.safeContext)).toBe(
        oneCase.label + " context: " + oneCase.expectedContextJson
      );
      expect(oneCase.label + " logicalName: " + error.logicalName).toBe(oneCase.label + " logicalName: " + oneCase.logicalName);
      expect(oneCase.label + " category: " + error.userCategory).toBe(
        oneCase.label + " category: " + ENVELOPE_EXPECTED_CATEGORY[oneCase.expectedKind]
      );
      expect(oneCase.label + " retryable: " + String(error.retryable)).toBe(oneCase.label + " retryable: false");
      // The fixed text of the accepted descriptor, asserted as a table fact rather than branched on.
      expect(oneCase.label + " message: " + error.safeMessage).toBe(
        oneCase.label + " message: " + PIPELINE_ERROR_DESCRIPTORS[oneCase.expectedKind].safeMessage
      );
    }
  });

  test("every accepted recognition status maps to exactly one outcome", () => {
    for (const oneCase of ENVELOPE_MAPPING_CASES) {
      const outcome = envelopeOutcomeForRecognition(oneCase.recognition, "results-2026-09.json");
      if (oneCase.expectedKind === null) {
        if (outcome.status !== "selected") {
          throw new Error(oneCase.label + ": expected a selection");
        }
        expect(oneCase.label + " family: " + outcome.selection.family).toBe(oneCase.label + " family: results");
        continue;
      }
      if (outcome.status !== "rejected") {
        throw new Error(oneCase.label + ": expected a rejection");
      }
      expect(oneCase.label + " kind: " + outcome.error.kind).toBe(oneCase.label + " kind: " + oneCase.expectedKind);
      expect(oneCase.label + " context: " + JSON.stringify(outcome.error.safeContext)).toBe(
        oneCase.label + " context: " + oneCase.expectedContextJson
      );
      expect(oneCase.label + " stage: " + outcome.error.stage).toBe(oneCase.label + " stage: envelope");
      expect(oneCase.label + " category: " + outcome.error.userCategory).toBe(
        oneCase.label + " category: " + ENVELOPE_EXPECTED_CATEGORY[oneCase.expectedKind]
      );
      expect(oneCase.label + " frozen: " + String(Object.isFrozen(outcome.error))).toBe(oneCase.label + " frozen: true");
    }
  });

  test("the mapping table covers all eleven statuses and the ten envelope kinds once each", () => {
    expect(ENVELOPE_MAPPING_CASES.length).toBe(11);
    const kinds: string[] = [];
    for (const oneCase of ENVELOPE_MAPPING_CASES) {
      if (oneCase.expectedKind !== null) {
        kinds.push(oneCase.expectedKind);
      }
    }
    expect(kinds.length).toBe(ENVELOPE_STAGE_KINDS.length);
    expect(kinds.slice().sort()).toEqual(ENVELOPE_STAGE_KINDS.slice().sort());
  });

  test("a caller branches on the kind alone, whatever the document was", () => {
    for (const oneCase of ENVELOPE_STAGE_CASES) {
      const error = expectRejected(runEnvelopeStage(oneCase.logicalName, oneCase.build()), oneCase.label + " branch");
      const decision = branchForEnvelopeKind(error);
      expect(oneCase.label + " branch: " + decision).toBe(oneCase.label + " branch: " + ENVELOPE_EXPECTED_BRANCH[oneCase.expectedKind]);
      expect(oneCase.label + " branch is not another stage's: " + String(decision === "other-stage")).toBe(
        oneCase.label + " branch is not another stage's: false"
      );
    }
  });

  test("no error carries a format string, document text, or a document value", () => {
    // Each row is one kind plus the envelope of a document that carries every forbidden value class in its
    // body, so a leak of body text, a token, a session id, or a measurement would show up here.
    const envelopes: readonly (readonly [string, Record<string, unknown>, readonly string[]])[] = [
      ["envelope-missing-format", {}, ["format"]],
      ["envelope-missing-version", {}, ["schemaVersion"]],
      ["envelope-unknown-format", { format: "repjot/nano", schemaVersion: 1 }, []],
      ["envelope-wrong-family", { format: "repjot/preferences", schemaVersion: 1 }, []],
      ["envelope-non-number-version", { format: "repjot/results", schemaVersion: "1" }, []],
      ["envelope-non-integer-version", { format: "repjot/results", schemaVersion: 1.5 }, []],
      ["envelope-non-positive-version", { format: "repjot/results", schemaVersion: 0 }, []],
      ["envelope-future-version", { format: "repjot/results", schemaVersion: 2 }, []]
    ];
    for (const row of envelopes) {
      const error = expectRejected(runEnvelopeStage("results-2026-09.json", envelopeSentinelValue(row[1], row[2])), row[0] + " retention");
      expect(String(error.kind)).toBe(row[0]);
      const serialized = JSON.stringify(error);
      for (const sentinel of SENTINELS) {
        expect(row[0] + " leaks no sentinel: " + String(serialized.indexOf(sentinel) !== -1)).toBe(row[0] + " leaks no sentinel: false");
      }
      // The `format` value is document text: it is named by kind and never echoed.
      expect(row[0] + " echoes no format: " + String(serialized.indexOf("repjot/") !== -1)).toBe(row[0] + " echoes no format: false");
    }
  });

  test("every logicalName this stage emits is a name it recognized as canonical", () => {
    const names: string[] = [];
    for (const oneCase of ENVELOPE_STAGE_CASES) {
      const error = expectRejected(runEnvelopeStage(oneCase.logicalName, oneCase.build()), oneCase.label + " name");
      names.push(error.logicalName);
      const match = matchCanonicalLogicalName(error.logicalName);
      expect(oneCase.label + " name is canonical: " + match.status).toBe(oneCase.label + " name is canonical: canonical");
      expect(oneCase.label + " name is the request: " + error.logicalName).toBe(oneCase.label + " name is the request: " + oneCase.logicalName);
    }
    expect(new Set<string>(names).size > 1).toBe(true);
  });

  test("a version integer in a safe context is the declared value or an accepted constant", () => {
    const error = expectRejected(runEnvelopeStage("results-2026-09.json", resultsEnvelope(2)), "version provenance");
    const future = versionBoundFacts(error);
    expect(future.kind).toBe("envelope-future-version");
    expect(future.declared).toBe(2);
    expect(future.bound).toBe(CURRENT_VERSION.results);
    const old = envelopeOutcomeForRecognition(
      { status: "unsupported-old-version", schemaVersion: 1, supportFloor: 2 },
      "results-2026-09.json"
    );
    if (old.status !== "rejected") {
      throw new Error("expected the unsupported-old rejection");
    }
    const oldFacts = versionBoundFacts(old.error);
    expect(oldFacts.kind).toBe("envelope-unsupported-old-version");
    expect(oldFacts.declared).toBe(1);
    expect(oldFacts.bound).toBe(2);
    // A malformed version names no range at all: nothing is invented for a caller to read.
    const malformed = expectRejected(runEnvelopeStage("results-2026-09.json", resultsEnvelope(0)), "malformed version");
    expect(versionBoundFacts(malformed).kind).toBe("no-version-bound");
  });
});

// ---------------------------------------------------------------------------
// Group 12: the stage never touches the caller's value
// ---------------------------------------------------------------------------

describe("envelope stage: the caller keeps its own value on every path", () => {
  test("no call writes to, freezes, or replaces the input value", () => {
    for (const oneCase of ENVELOPE_STAGE_CASES) {
      const value = oneCase.build();
      const before = envelopeSnapshot(value);
      runEnvelopeStage(oneCase.logicalName, value);
      expect(oneCase.label + " input unchanged: " + envelopeSnapshot(value)).toBe(oneCase.label + " input unchanged: " + before);
    }
  });

  test("a frozen caller object survives every rejection and every acceptance", () => {
    const frozenBroken = Object.freeze(envelopeSentinelValue({ format: "repjot/nano", schemaVersion: 1 }));
    const frozenValid = Object.freeze(resultsEnvelope(1));
    const beforeBroken = envelopeSnapshot(frozenBroken);
    const beforeValid = envelopeSnapshot(frozenValid);
    expectRejected(runEnvelopeStage("results-2026-09.json", frozenBroken), "frozen broken");
    expectRecognized(runEnvelopeStage("results-2026-09.json", frozenValid), "frozen valid");
    expect("frozen broken snapshot: " + envelopeSnapshot(frozenBroken)).toBe("frozen broken snapshot: " + beforeBroken);
    expect("frozen valid snapshot: " + envelopeSnapshot(frozenValid)).toBe("frozen valid snapshot: " + beforeValid);
    expect(String(Object.isFrozen(frozenBroken))).toBe("true");
    expect(String(Object.isFrozen(frozenValid))).toBe("true");
  });

  test("the caller can still write to its own object after a rejection and after an acceptance", () => {
    const rejectedValue = resultsEnvelope(0);
    expectRejected(runEnvelopeStage("results-2026-09.json", rejectedValue), "writable after rejection");
    rejectedValue.written = "the stage froze nothing";
    expect(String(rejectedValue.written)).toBe("the stage froze nothing");
    expect(String(Object.isFrozen(rejectedValue))).toBe("false");

    const acceptedValue = resultsEnvelope(1);
    expectRecognized(runEnvelopeStage("results-2026-09.json", acceptedValue), "writable after acceptance");
    acceptedValue.written = "still writable";
    expect(String(acceptedValue.written)).toBe("still writable");
    expect(String(Object.isFrozen(acceptedValue))).toBe("false");
  });

  test("an accepted selection and a rejected error reference no caller value", () => {
    const doc = resultsEnvelope(1);
    doc.sessions = [{ id: "before" }];
    const selection = expectRecognized(runEnvelopeStage("results-2026-09.json", doc), "selection alias");
    const selectionJson = JSON.stringify(selection);
    doc.sessions = [{ id: "after" }];
    expect(JSON.stringify(selection)).toBe(selectionJson);

    const broken = resultsEnvelope(0);
    broken.sessions = [{ id: "before" }];
    const error = expectRejected(runEnvelopeStage("results-2026-09.json", broken), "error alias");
    const errorJson = JSON.stringify(error);
    broken.sessions = [{ id: "after" }];
    broken.schemaVersion = 77;
    expect(JSON.stringify(error)).toBe(errorJson);
    expect(errorJson.indexOf("77")).toBe(-1);
  });

  test("a non-object root is left exactly as it arrived", () => {
    const list = [{ format: "repjot/results", schemaVersion: 1 }];
    const before = envelopeSnapshot(list);
    expectRejected(runEnvelopeStage("results-2026-09.json", list), "array purity");
    expect(envelopeSnapshot(list)).toBe(before);
    expect(list.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Group 13: module shape, imports, purity, and ES2019 output (static evidence)
// ---------------------------------------------------------------------------

/** The two new modules, read as text. Rows in this group close "no such mechanism exists", which no
 * single call can show; GATES.md Section 3 has the parent inspect the same diff. */
const ENVELOPE_MODULE_SOURCE = readFileSync(new URL("../src/documents/envelope.ts", import.meta.url), "utf8");
const STAGE_MODULE_SOURCE = readFileSync(new URL("../src/documents/document-pipeline.ts", import.meta.url), "utf8");

/**
 * Substrings that would put a second mechanism or a forbidden capability on this path. They are tested
 * against the module text with its comments removed, so a comment may still name the rule it follows.
 */
const FORBIDDEN_ENVELOPE_TEXT: readonly (readonly [string, string])[] = [
  ["fetch", "no network: the fetch adapter is Phase 17"],
  ["XMLHttpRequest", "no network"],
  ["indexedDB", "no IndexedDB (Phases 19-26)"],
  ["IDBKeyRange", "no IndexedDB"],
  ["localStorage", "no browser storage"],
  ["sessionStorage", "no browser storage"],
  ["document.", "no DOM"],
  ["window.", "no DOM"],
  ["navigator.", "no DOM"],
  ["Blob", "no download path"],
  ["URL", "no download path"],
  ["Date", "no clock"],
  ["performance", "no clock"],
  ["setTimeout", "no timer"],
  ["Math", "no arithmetic that could become a rule"],
  ["random", "no random input"],
  ["crypto", "no digest (Phase 16)"],
  ["Intl", "no locale"],
  ["toLocaleString", "no locale"],
  ["svelte", "no UI"],
  ["Drive", "no Drive adapter and no FF-11 change indicator on this path"],
  ["eval", "no execution of content"],
  ["Function", "no execution of content"],
  ["require", "no CommonJS dependency"],
  ["node:", "no filesystem and no node:url"],
  ["bun:", "no test or runtime API"],
  ["JSON", "no parse and no stringify: the parse stage produced this value (FF-14)"],
  ["TextDecoder", "no byte handling in this stage"],
  ["TextEncoder", "no byte handling in this stage"],
  ["schema-registry", "no schema-validator handle (scope decision 3)"],
  ["validation", "no schema or semantic validation on this stage"],
  ["migrat", "no migration (Phase 14)"],
  ["hasOwnProperty", "no second envelope reader: src/domain/families.ts owns the two-field read"],
  ["yearMonthUtc", "no shard-month read here (RS-01 belongs to semantic validation)"],
  ["shardNameAgreesWithDocument", "the month comparison is never called from this stage"],
  ["sessionStartAgreesWithShard", "the month comparison is never called from this stage"],
  ["RegExp", "no second filename pattern"],
  [".json", "no second filename pattern"],
  ["repjot/", "no second format table"],
  ["v0", "no invented legacy importer (FF-10)"]
];

function envelopeImportSpecifiers(source: string): string[] {
  return matchesOf(uncommented(source), /from\s+"([^"]*)"/)
    .map((hit) => hit.replace(/^from\s+"/, "").replace(/"$/, ""))
    .sort();
}

describe("envelope stage: module shape, imports, purity, and ES2019 output", () => {
  test("each module exports only its own seam", () => {
    expect(Object.keys(documentEnvelopeModule).sort()).toEqual([
      "envelopeOutcomeForRecognition",
      "matchCanonicalLogicalName",
      "selectFamilyRegistry"
    ]);
    expect(Object.keys(documentPipelineModule).sort()).toEqual(["loadDocument", "recognizeDocumentEnvelope"]);
    expect(typeof documentEnvelopeModule.matchCanonicalLogicalName).toBe("function");
    expect(typeof documentEnvelopeModule.selectFamilyRegistry).toBe("function");
    expect(typeof documentEnvelopeModule.envelopeOutcomeForRecognition).toBe("function");
    expect(typeof documentPipelineModule.recognizeDocumentEnvelope).toBe("function");
  });

  test("each module imports the accepted recognizer and the accepted error layer and nothing else", () => {
    expect(envelopeImportSpecifiers(ENVELOPE_MODULE_SOURCE)).toEqual([
      "../domain/families",
      "../domain/families",
      "./pipeline-types",
      "./pipeline-types"
    ]);
    expect(envelopeImportSpecifiers(STAGE_MODULE_SOURCE)).toEqual([
      "../domain/families",
      "../migrations/migration-registry",
      "../migrations/migration-registry",
      "./envelope",
      "./envelope",
      "./pipeline-types",
      "./pipeline-types",
      "./safe-json-parser"
    ]);
    for (const source of [ENVELOPE_MODULE_SOURCE, STAGE_MODULE_SOURCE]) {
      expect(matchesOf(uncommented(source), /\brequire\s*\(/).length).toBe(0);
      expect(matchesOf(uncommented(source), /\bimport\s*\(/).length).toBe(0);
      expect(matchesOf(uncommented(source), /export\s+\*/).length).toBe(0);
    }
  });

  test("neither module contains a second recognizer, pattern, version rule, or forbidden capability", () => {
    const codes = [uncommented(ENVELOPE_MODULE_SOURCE), uncommented(STAGE_MODULE_SOURCE)];
    for (const row of FORBIDDEN_ENVELOPE_TEXT) {
      for (const code of codes) {
        // Scope decision 7b (Amendment): the "migrat" row stays in force for envelope.ts; from
        // P15-T01 the pipeline module legitimately imports src/migrations (scope decision 1).
        if (row[0] === "migrat" && code === codes[1]) {
          continue;
        }
        expect(row[0] + " (" + row[1] + "): " + String(code.indexOf(row[0]) !== -1)).toBe(row[0] + " (" + row[1] + "): false");
      }
    }
    // No numeric literal at all: a version comparison needs a number, and there is none (R-11).
    expect(matchesOf(codeOnly(ENVELOPE_MODULE_SOURCE), /(?<![\w.])\d+(?:\.\d+)?(?![\w])/).length).toBe(0);
    expect(matchesOf(codeOnly(STAGE_MODULE_SOURCE), /(?<![\w.])\d+(?:\.\d+)?(?![\w])/).length).toBe(0);
  });

  test("the accepted recognizer is reused rather than re-implemented", () => {
    const envelopeCode = uncommented(ENVELOPE_MODULE_SOURCE);
    for (const reused of ["recognizeEnvelope", "recognizeLogicalName", "CURRENT_VERSION", "SUPPORT_FLOOR_VERSION", "makePipelineError"]) {
      expect("envelope.ts reuses " + reused + ": " + String(envelopeCode.indexOf(reused) !== -1)).toBe(
        "envelope.ts reuses " + reused + ": true"
      );
    }
    const stageCode = uncommented(STAGE_MODULE_SOURCE);
    for (const composed of ["matchCanonicalLogicalName", "selectFamilyRegistry"]) {
      expect("document-pipeline.ts composes " + composed + ": " + String(stageCode.indexOf(composed) !== -1)).toBe(
        "document-pipeline.ts composes " + composed + ": true"
      );
    }
    // The stage module reads no envelope field and builds no error of its own.
    // Scope decision 7b (Amendment): "schemaVersion" and "makePipelineError" left this list — the
    // wired pipeline must read the envelope's declared version and build rejections with the accepted
    // constructor; the P15 group asserts both are used only for those two duties.
    for (const absent of ["format", "recognizeEnvelope", "recognizeLogicalName"]) {
      expect("document-pipeline.ts never mentions " + absent + ": " + String(stageCode.indexOf(absent) !== -1)).toBe(
        "document-pipeline.ts never mentions " + absent + ": false"
      );
    }
  });

  test("neither module uses syntax newer than ES2019", () => {
    // Scanned on the raw source, comments included, so no such token can reach a reader's eye.
    for (const source of [ENVELOPE_MODULE_SOURCE, STAGE_MODULE_SOURCE]) {
      for (const token of FORBIDDEN_ES2020_TOKENS) {
        expect(token + ": " + String(source.indexOf(token) !== -1)).toBe(token + ": false");
      }
    }
  });

  test("neither module is reachable from the shipped entry point yet", () => {
    const entry = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    expect(String(entry.indexOf("documents/envelope") !== -1)).toBe("false");
    expect(String(entry.indexOf("documents/document-pipeline") !== -1)).toBe("false");
    for (const source of [ENVELOPE_MODULE_SOURCE, STAGE_MODULE_SOURCE]) {
      expect(String(source.indexOf("tests/") !== -1)).toBe("false");
      expect(String(source.indexOf("fixtures") !== -1)).toBe("false");
    }
  });

  test("selectFamilyRegistry is the array guard plus the accepted recognizer and nothing more", () => {
    const body = functionBody(uncommented(ENVELOPE_MODULE_SOURCE), "selectFamilyRegistry");
    expect("body present: " + String(body.length > 0)).toBe("body present: true");
    expect(String(body.indexOf("Array.isArray") !== -1)).toBe("true");
    expect(String(body.indexOf("recognizeEnvelope") !== -1)).toBe("true");
    expect(String(body.indexOf("envelopeOutcomeForRecognition") !== -1)).toBe("true");
    // One array test and one recognizer call: no second read of the value.
    expect(String(body.indexOf("hasOwnProperty") !== -1)).toBe("false");
    expect(String(body.indexOf("Object.keys") !== -1)).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// Group 14: compile-time probes. Never called: `bun run check` runs their evidence,
// because an expect-error directive is itself an error when the line below it compiles.
// ---------------------------------------------------------------------------

function envelopeStageTypeProbes(): void {
  const result = recognizeDocumentEnvelope({ logicalName: "results-2026-09.json", value: null });
  // @ts-expect-error the union carries no selection before its status is narrowed
  const beforeNarrowing: unknown = result.selection;
  // @ts-expect-error the refusal arm carries no family
  const familyOnRefusal: unknown = result.status === "unknown-file" ? result.family : null;
  // @ts-expect-error the refusal arm carries no error
  const errorOnRefusal: unknown = result.status === "unknown-file" ? result.error : null;
  // @ts-expect-error a rejection arm carries no selection
  const selectionOnRejection: unknown = result.status === "rejected" ? result.selection : null;
  // @ts-expect-error the refusal has no pipeline error kind of its own
  const kindOnRefusal: unknown = result.status === "unknown-file" ? result.kind : null;
  // @ts-expect-error the stage input has no field for a Drive change indicator (FF-11)
  const withChecksum: DocumentEnvelopeInput = { logicalName: "results-2026-09.json", value: null, md5Checksum: "abc" };
  // @ts-expect-error the expected family is derived from the name, never supplied
  const withFamily: DocumentEnvelopeInput = { logicalName: "results-2026-09.json", value: null, expectedFamily: "results" };
  // @ts-expect-error the stage takes the parsed value, not bytes (the parse stage produced this)
  const withBytes: DocumentEnvelopeInput = { logicalName: "results-2026-09.json", value: null, bytes: new Uint8Array([]) };
  // @ts-expect-error the stage takes no schema-validator handle (scope decision 3)
  const withRegistry: DocumentEnvelopeInput = { logicalName: "results-2026-09.json", value: null, registry: {} };
  // @ts-expect-error the stage takes no byte-order-mark field: the parse stage owns that rule (FF-14)
  const withMark: DocumentEnvelopeInput = { logicalName: "results-2026-09.json", value: null, byteOrderMark: true };
  if (result.status === "recognized") {
    // @ts-expect-error a selection has no validator handle and no registry of its own
    const registryHandle: unknown = result.selection.registry;
    // @ts-expect-error a selection carries no shard month (R-15)
    const month: unknown = result.selection.yearMonthUtc;
    // @ts-expect-error a selection carries no logical filename
    const name: unknown = result.selection.logicalName;
    // @ts-expect-error a selection carries no migration path (Phase 14)
    const path: unknown = result.selection.migrationPath;
    // @ts-expect-error a selection is read-only
    result.selection.schemaVersion = 2;
  }
  // @ts-expect-error the accepted kind set is closed, so no twelfth envelope kind exists
  const inventedKind: PipelineErrorKind = "envelope-name-not-canonical";
  // @ts-expect-error an unsupported-old recognition must name its floor
  const oldWithoutFloor: EnvelopeRecognition = { status: "unsupported-old-version", schemaVersion: 1 };
  // @ts-expect-error a selection needs the expected family implied by the canonical name
  const missingExpected: FamilyRegistryOutcome = selectFamilyRegistry({ value: null, logicalName: "results-2026-09.json" });
}

describe("envelope stage: compile-time boundaries", () => {
  test("the envelope-stage type probes are present for bun run check", () => {
    expect(typeof envelopeStageTypeProbes).toBe("function");
  });
});

// ===========================================================================
// P15-T01 — the whole-pipeline function `loadDocument`: one call runs parse,
// envelope, declared-schema, migration, post-migration-schema, semantic, and
// normalization, in that order, and fails byte-identically. Authority:
// docs/implementation/phase-15.md (task P15-T01 — objective "Make stage
// ordering impossible to bypass through normal pipeline use", acceptance "The
// call trace is parse, recognize, historical schema, migration, next schema,
// final semantic, normalize. Failed inputs remain byte-identical"), the seven
// binding Phase 15 scope decisions in .agent-work/phase-15/task.md,
// docs/ARCHITECTURE.md Section 12, specs/schema-versioning.md §Migration
// chains loader steps 1-9 and §Result migrations and references,
// docs/contracts/families-and-files.md FF-05, FF-14, FF-18, FF-19, FF-20, and
// docs/implementation/GATES.md Section 3 ("Validation-after-migration | Spy
// and Fixture", "Immutability | Unit | Frozen object, byte snapshot, repeated
// load"). Every document, registry, step, and context below is synthetic and
// labelled as such; no historical production document is invented, and no
// large eager fixture is imported.
// ===========================================================================

import { loadDocument } from "../src/documents/document-pipeline";
import type {
  DocumentPipelineInput,
  DocumentPipelinePorts,
  DocumentPipelineResult,
  LoadedDocument
} from "../src/documents/document-pipeline";
import { acceptedVersionRange, createFamilyMigrationRegistry } from "../src/migrations/migration-registry";
import type {
  FamilyMigrationRegistry,
  FamilyMigrationStep,
  FamilyMigrationStepInput,
  FamilyMigrationStepResult
} from "../src/migrations/migration-registry";
import type { MigrationStepId, SourceIdentity } from "../src/documents/pipeline-types";

// ---------------------------------------------------------------------------
// Synthetic inputs and spies for the pipeline call
// ---------------------------------------------------------------------------

/** The canonical results-shard name every pipeline case loads under (FF-06). */
const P15_NAME = "results-2026-09.json";

/** The results `format` value. */
const P15_FORMAT = "repjot/results";

/** One synthetic source identity; Phase 15 records nothing from it (scope decision 2). */
const P15_SOURCE: SourceIdentity = { kind: "drive-app-data-folder", driveFileId: "synthetic-drive-file-1" };

/** The accepted results registry at the accepted bounds: floor 1, current 1, zero steps. */
function p15AcceptedRegistry(family: DocumentFamily): FamilyMigrationRegistry<unknown> {
  const built = createFamilyMigrationRegistry<unknown>({
    family: family,
    range: acceptedVersionRange(family),
    steps: []
  });
  if (built.status !== "created") {
    throw new Error("synthetic setup refused: " + built.failure.reason);
  }
  return built.registry;
}

/** One synthetic multi-version registry — the only way a version above the accepted v1 is reached. */
function p15SyntheticRegistry(
  family: DocumentFamily,
  floor: number,
  current: number,
  steps: readonly FamilyMigrationStep<unknown>[]
): FamilyMigrationRegistry<unknown> {
  const built = createFamilyMigrationRegistry<unknown>({
    family: family,
    range: { supportFloorSchemaVersion: floor, currentSchemaVersion: current },
    steps: steps
  });
  if (built.status !== "created") {
    throw new Error("synthetic setup refused: " + built.failure.reason);
  }
  return built.registry;
}

/** How one synthetic step behaves when the walk applies it. */
type P15StepBehavior =
  | "advance"
  | "fail"
  | "throw"
  | "same-reference"
  | "wrong-version"
  | "garbage"
  | "mutate-input"
  | "require-context";

interface P15StepSpec {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly log: string[];
  readonly behavior?: P15StepBehavior;
  readonly seenInputs?: Record<string, unknown>[];
  readonly seenContexts?: unknown[];
  readonly produced?: Record<string, unknown>[];
}

/**
 * One synthetic migration step. "advance" copies the document, moves `schemaVersion` to `to`, and
 * records an `appliedThrough` field — the only document edit any synthetic step makes. Every other
 * behaviour is one of the defects GATES.md Section 3 requires negative tests for.
 */
function p15Step(spec: P15StepSpec): FamilyMigrationStep<unknown> {
  return {
    id: spec.id,
    fromSchemaVersion: spec.from,
    toSchemaVersion: spec.to,
    migrate: (stepInput: FamilyMigrationStepInput<unknown>): FamilyMigrationStepResult => {
      spec.log.push("step:" + spec.id);
      if (spec.seenContexts !== undefined) {
        spec.seenContexts.push(stepInput.context);
      }
      if (spec.seenInputs !== undefined) {
        spec.seenInputs.push(stepInput.document as Record<string, unknown>);
      }
      const behavior: P15StepBehavior = spec.behavior === undefined ? "advance" : spec.behavior;
      if (behavior === "fail") {
        return { status: "failed", detail: "synthetic: required reference workout-9 absent" };
      }
      if (behavior === "throw") {
        throw new Error("synthetic step exception");
      }
      if (behavior === "same-reference") {
        return { status: "migrated", document: stepInput.document };
      }
      if (behavior === "garbage") {
        return { status: "not-a-step-result" } as unknown as FamilyMigrationStepResult;
      }
      if (behavior === "require-context") {
        const reference = stepInput.context as { readonly hasWorkout9?: boolean } | null;
        if (reference === null || typeof reference !== "object" || reference.hasWorkout9 !== true) {
          return { status: "failed", detail: "synthetic: required reference workout-9 absent" };
        }
      }
      if (behavior === "mutate-input") {
        // Writes into the pipeline-owned value the step was given. In strict mode a frozen object
        // would throw here, so surviving this line is itself the not-deep-frozen evidence.
        (stepInput.document as Record<string, unknown>)["tampered"] = true;
      }
      const input = stepInput.document as Record<string, unknown>;
      const produced: Record<string, unknown> = {};
      for (const key of Object.keys(input)) {
        produced[key] = input[key];
      }
      produced["schemaVersion"] = spec.to;
      produced["appliedThrough"] = spec.id;
      if (behavior === "wrong-version") {
        produced["schemaVersion"] = spec.to + 5;
      }
      if (spec.produced !== undefined) {
        spec.produced.push(produced);
      }
      return { status: "migrated", document: produced };
    }
  };
}

interface P15HarnessSpec {
  readonly log: string[];
  readonly registries?: Partial<Record<DocumentFamily, FamilyMigrationRegistry<unknown>>>;
  readonly schemaRule?: (family: DocumentFamily, schemaVersion: number, document: unknown) => readonly string[] | null;
  readonly semanticRule?: (family: DocumentFamily, document: unknown, context: unknown) => readonly string[] | null;
  readonly normalize?: (document: unknown) => unknown;
}

/** The four accepted-bound registries, overridden only where a synthetic family is staged. */
function p15Ports(spec: P15HarnessSpec): DocumentPipelinePorts<unknown, unknown> {
  const registries: Record<DocumentFamily, FamilyMigrationRegistry<unknown>> = {
    exercises: p15AcceptedRegistry("exercises"),
    workouts: p15AcceptedRegistry("workouts"),
    preferences: p15AcceptedRegistry("preferences"),
    results: p15AcceptedRegistry("results")
  };
  const overrides = spec.registries;
  if (overrides !== undefined) {
    const families: DocumentFamily[] = ["exercises", "workouts", "preferences", "results"];
    for (const family of families) {
      const one = overrides[family];
      if (one !== undefined) {
        registries[family] = one;
      }
    }
  }
  const innerNormalize = spec.normalize;
  const ports: DocumentPipelinePorts<unknown, unknown> = {
    validateSchema: (schemaInput) => {
      spec.log.push("schema:" + schemaInput.schemaVersion);
      if (spec.schemaRule === undefined) {
        return { status: "valid" };
      }
      const paths = spec.schemaRule(schemaInput.family, schemaInput.schemaVersion, schemaInput.document);
      return paths === null ? { status: "valid" } : { status: "invalid", paths: paths };
    },
    migrationRegistries: registries,
    validateSemantic: (semanticInput) => {
      spec.log.push("semantic");
      if (spec.semanticRule === undefined) {
        return { status: "valid" };
      }
      const paths = spec.semanticRule(semanticInput.family, semanticInput.document, semanticInput.context);
      return paths === null ? { status: "valid" } : { status: "invalid", paths: paths };
    },
    normalize: innerNormalize === undefined
      ? undefined
      : (document: unknown) => {
          spec.log.push("normalize");
          return innerNormalize(document);
        }
  };
  return ports;
}

/** One pipeline call with the defaults this file uses everywhere. */
function p15Load(
  ports: DocumentPipelinePorts<unknown, unknown>,
  bytes: Uint8Array,
  context?: unknown,
  logicalName?: unknown
): DocumentPipelineResult<unknown> {
  return loadDocument<unknown, unknown>({
    logicalName: logicalName === undefined ? P15_NAME : logicalName,
    source: P15_SOURCE,
    bytes: bytes,
    context: context === undefined ? null : context,
    ports: ports
  });
}

/** The exact bytes of one minimal synthetic results document at one declared version. */
function p15Bytes(schemaVersion: number): Uint8Array {
  return inputEncoder.encode(
    JSON.stringify({ format: P15_FORMAT, schemaVersion: schemaVersion, yearMonthUtc: "2026-09", sessions: [] })
  );
}

/** The rejection arm of one result, or a test failure naming what arrived instead. */
function p15Rejected(result: DocumentPipelineResult<unknown>): PipelineError {
  if (result.status !== "rejected") {
    throw new Error("expected a rejection, observed status " + result.status);
  }
  return result.error;
}

/** Every field an accepted descriptor fixes, proven for the kind and the canonical name. */
function p15ExpectFromTable(error: PipelineError, kind: PipelineErrorKind, logicalName?: string): void {
  const descriptor = PIPELINE_ERROR_DESCRIPTORS[kind];
  expect(error.kind).toBe(kind);
  expect(error.stage).toBe(descriptor.stage);
  expect(error.userCategory).toBe(descriptor.userCategory);
  expect(error.retryable).toBe(descriptor.retryable);
  expect(error.safeMessage).toBe(descriptor.safeMessage);
  expect(error.logicalName).toBe(logicalName === undefined ? P15_NAME : logicalName);
}

/** A count of "normalize" entries in one spy log — the R-05 evidence. */
function p15NormalizeCalls(log: readonly string[]): number {
  let count = 0;
  for (const entry of log) {
    if (entry === "normalize") {
      count += 1;
    }
  }
  return count;
}

/** The frozen context every immutability case passes: a write into it would throw. */
function p15FrozenContext(): unknown {
  return Object.freeze({
    label: "synthetic-reference-context",
    refs: Object.freeze({ workouts: Object.freeze(["workout-1", "workout-2"]) })
  });
}

// ---------------------------------------------------------------------------
// R-01, R-05 — one call, one readable trace of the accepted stage order
// ---------------------------------------------------------------------------

describe("P15 pipeline: one call runs the stages in the accepted order", () => {
  test("a three-version load traces parse, envelope, declared-schema, migration, post-migration-schema, semantic", () => {
    const log: string[] = [];
    const registry = p15SyntheticRegistry("results", 1, 3, [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: log }),
      p15Step({ id: "step-2-3", from: 2, to: 3, log: log })
    ]);
    const ports = p15Ports({
      log: log,
      registries: { results: registry },
      normalize: (document: unknown) => ({ syntheticModel: true, from: document })
    });

    const result = p15Load(ports, p15Bytes(1));
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      return;
    }
    const loaded: LoadedDocument<unknown> = result;
    expect(loaded.stage).toBe("semantic");
    expect(loaded.trace).toEqual(["parse", "envelope", "declared-schema", "migration", "post-migration-schema", "semantic"]);
    expect(loaded.appliedStepIds).toEqual(["step-1-2", "step-2-3"]);
    expect(loaded.model).toEqual({ syntheticModel: true, from: {
      format: P15_FORMAT, schemaVersion: 3, yearMonthUtc: "2026-09", sessions: [], appliedThrough: "step-2-3"
    } });
  });

  test("the spy log is exactly parse through normalize in order", () => {
    const log: string[] = [];
    const registry = p15SyntheticRegistry("results", 1, 3, [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: log }),
      p15Step({ id: "step-2-3", from: 2, to: 3, log: log })
    ]);
    const ports = p15Ports({ log: log, registries: { results: registry }, normalize: (document) => document });

    p15Load(ports, p15Bytes(1));
    expect(log).toEqual(["schema:1", "step:step-1-2", "schema:2", "step:step-2-3", "schema:3", "semantic", "normalize"]);
  });

  test("a current-version load runs zero steps, consults one schema version, and traces five stages", () => {
    const log: string[] = [];
    const ports = p15Ports({ log: log });

    const result = p15Load(ports, p15Bytes(1));
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      return;
    }
    expect(result.trace).toEqual(["parse", "envelope", "declared-schema", "migration", "semantic"]);
    expect(result.appliedStepIds).toEqual([]);
    expect(log).toEqual(["schema:1", "semantic"]);
    expect(result.model).toEqual({ format: P15_FORMAT, schemaVersion: 1, yearMonthUtc: "2026-09", sessions: [] });
  });

  test("the trace is frozen, uses only accepted stage names, and ends at the last Section 12 stage", () => {
    const log: string[] = [];
    const ports = p15Ports({ log: log });
    const result = p15Load(ports, p15Bytes(1));
    if (result.status !== "loaded") {
      expect("loaded").toBe("observed");
      return;
    }
    expect(Object.isFrozen(result.trace)).toBe(true);
    for (const entry of result.trace) {
      expect(PIPELINE_STAGES.indexOf(entry) !== -1).toBe(true);
    }
    expect(result.trace[result.trace.length - 1]).toBe("semantic");
    // Scope decision 2: the outcome carries no provenance, digest, or validation-version value.
    expect(Object.keys(result).sort()).toEqual(["appliedStepIds", "model", "stage", "status", "trace"]);
  });
});

// ---------------------------------------------------------------------------
// R-02 — the declared schema runs before any migration step
// ---------------------------------------------------------------------------

describe("P15 pipeline: the declared schema is consulted before any migration step", () => {
  test("a document failing its declared schema is declared-schema-invalid with paths and zero step calls", () => {
    const log: string[] = [];
    const stepsSeen: Record<string, unknown>[] = [];
    const registry = p15SyntheticRegistry("results", 1, 3, [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: log, seenInputs: stepsSeen })
    ]);
    const ports = p15Ports({
      log: log,
      registries: { results: registry },
      schemaRule: (family, schemaVersion) => (schemaVersion === 1 ? ["/schemaVersion"] : null),
      normalize: (document) => document
    });

    const result = p15Load(ports, p15Bytes(1));
    const error = p15Rejected(result);
    p15ExpectFromTable(error, "declared-schema-invalid");
    expect(error.safeContext).toEqual({ paths: ["/schemaVersion"] });
    expect(log).toEqual(["schema:1"]);
    expect(stepsSeen.length).toBe(0);
    expect(p15NormalizeCalls(log)).toBe(0);
  });

  test("the declared consultation names the recognized family and the document's own version", () => {
    const log: string[] = [];
    const asked: ([DocumentFamily, number])[] = [];
    const ports = p15Ports({
      log: log,
      schemaRule: (family, schemaVersion) => {
        asked.push([family, schemaVersion]);
        return null;
      }
    });
    p15Load(ports, p15Bytes(1));
    expect(asked).toEqual([["results", 1]]);
  });
});

// ---------------------------------------------------------------------------
// R-03 — every next-version output is validated before the next step and before semantic
// ---------------------------------------------------------------------------

describe("P15 pipeline: every step output meets the next version schema before anything later runs", () => {
  test("an invalid intermediate output stops with post-migration-schema-invalid and no second step", () => {
    const log: string[] = [];
    const registry = p15SyntheticRegistry("results", 1, 3, [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: log }),
      p15Step({ id: "step-2-3", from: 2, to: 3, log: log })
    ]);
    const ports = p15Ports({
      log: log,
      registries: { results: registry },
      schemaRule: (family, schemaVersion) => (schemaVersion === 2 ? ["/appliedThrough"] : null),
      normalize: (document) => document
    });

    const bytes = p15Bytes(1);
    const before = byteSnapshot(bytes);
    const context = p15FrozenContext();
    const result = p15Load(ports, bytes, context);
    const error = p15Rejected(result);
    p15ExpectFromTable(error, "post-migration-schema-invalid");
    expect(error.safeContext).toEqual({ paths: ["/appliedThrough"] });
    expect(log).toEqual(["schema:1", "step:step-1-2", "schema:2"]);
    expect(sameByteValues(bytes, before)).toBe(true);
    expect(result).not.toHaveProperty("model");
  });

  test("an invalid final output stops with post-migration-schema-invalid and semantic never runs", () => {
    const log: string[] = [];
    const registry = p15SyntheticRegistry("results", 1, 3, [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: log }),
      p15Step({ id: "step-2-3", from: 2, to: 3, log: log })
    ]);
    const ports = p15Ports({
      log: log,
      registries: { results: registry },
      schemaRule: (family, schemaVersion) => (schemaVersion === 3 ? [""] : null)
    });

    const result = p15Load(ports, p15Bytes(1));
    p15ExpectFromTable(p15Rejected(result), "post-migration-schema-invalid");
    expect(log).toEqual(["schema:1", "step:step-1-2", "schema:2", "step:step-2-3", "schema:3"]);
    expect(log.indexOf("semantic")).toBe(-1);
  });

  test("the current version is validated exactly once for a migrated document", () => {
    const log: string[] = [];
    const registry = p15SyntheticRegistry("results", 1, 2, [p15Step({ id: "step-1-2", from: 1, to: 2, log: log })]);
    const ports = p15Ports({ log: log, registries: { results: registry } });
    p15Load(ports, p15Bytes(1));
    expect(log.filter((entry) => entry === "schema:2").length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// D001 — the document the next-version gate certifies is the document the
// accepted walk adopts: one read of a step's returned result, no accessor
// standing between the gate and the adoption
// ---------------------------------------------------------------------------

/**
 * One synthetic step whose returned result hands out its `document` member from a prepared list, one
 * value per read, so the gate's read and the adoption read can be told apart. This is the shape the
 * accepted walk already defends against inside one containment (`src/migrations/migration-registry.ts`
 * "a raising accessor or a proxy behind one of them is reported as that step having failed"): a legal
 * returned object may yield a different value on each read, so a wrapper that reads it and then hands
 * the same object on lets the gate certify one document while the walk adopts another.
 *
 * `useProxy` installs the same behaviour behind a Proxy rather than an accessor property;
 * `throwOnRead` makes every read raise; `reads` counts the reads the pipeline performs.
 */
interface P15AccessorSpec {
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly log: string[];
  /** What the 1st, 2nd, ... read of the returned result's `document` member yields. */
  readonly valuesFor: (stepInput: FamilyMigrationStepInput<unknown>) => readonly unknown[];
  readonly seenInputs?: Record<string, unknown>[];
  readonly reads?: { count: number };
  readonly throwOnRead?: boolean;
  readonly useProxy?: boolean;
}

function p15AccessorStep(spec: P15AccessorSpec): FamilyMigrationStep<unknown> {
  return {
    id: spec.id,
    fromSchemaVersion: spec.from,
    toSchemaVersion: spec.to,
    migrate: (stepInput: FamilyMigrationStepInput<unknown>): FamilyMigrationStepResult => {
      spec.log.push("step:" + spec.id);
      if (spec.seenInputs !== undefined) {
        spec.seenInputs.push(stepInput.document as Record<string, unknown>);
      }
      const values = spec.valuesFor(stepInput);
      const state = { reads: 0 };
      const handOut = (): unknown => {
        const index = state.reads < values.length ? state.reads : values.length - 1;
        state.reads += 1;
        if (spec.reads !== undefined) {
          spec.reads.count += 1;
        }
        if (spec.throwOnRead === true) {
          throw new Error("synthetic: the document member cannot be read");
        }
        return values[index];
      };
      if (spec.useProxy === true) {
        return new Proxy({ status: "migrated" } as Record<string, unknown>, {
          get: (target: Record<string, unknown>, key: PropertyKey) => (key === "document" ? handOut() : target[key as string])
        }) as unknown as FamilyMigrationStepResult;
      }
      const result = { status: "migrated" } as { status: "migrated"; readonly document: unknown };
      Object.defineProperty(result, "document", { enumerable: true, get: handOut });
      return result;
    }
  };
}

/** A synthetic v2 results document carrying one marker, so a test can name the exact object. */
function p15V2(marker: string): Record<string, unknown> {
  return {
    format: P15_FORMAT,
    schemaVersion: 2,
    yearMonthUtc: "2026-09",
    sessions: [],
    appliedThrough: "step-1-2",
    marker: marker
  };
}

/** The schema rule every D001 case uses: only the marker tells a valid document from an invalid one. */
function p15MarkerRule(schemaSawTwo: Record<string, unknown>[]): (family: DocumentFamily, schemaVersion: number, document: unknown) => readonly string[] | null {
  return (family, schemaVersion, document) => {
    if (schemaVersion === 2) {
      schemaSawTwo.push(document as Record<string, unknown>);
    }
    return (document as Record<string, unknown>)["marker"] === "invalid" ? ["/marker"] : null;
  };
}

describe("P15 pipeline: the gated step output is the adopted step output (D001)", () => {
  test("a varying document member cannot hand the gate one value and the walk another", () => {
    const log: string[] = [];
    const certified = p15V2("gate-saw-this");
    const neverAdopted = p15V2("invalid");
    const seenInputs: Record<string, unknown>[] = [];
    const schemaSawTwo: Record<string, unknown>[] = [];
    const reads = { count: 0 };
    const steps = [
      p15AccessorStep({ id: "step-1-2", from: 1, to: 2, log: log, reads: reads, seenInputs: seenInputs, valuesFor: () => [certified, neverAdopted] }),
      p15Step({ id: "step-2-3", from: 2, to: 3, log: log, seenInputs: seenInputs })
    ];
    const ports = p15Ports({
      log: log,
      registries: { results: p15SyntheticRegistry("results", 1, 3, steps) },
      schemaRule: p15MarkerRule(schemaSawTwo),
      normalize: (document) => document
    });

    const result = p15Load(ports, p15Bytes(1));

    // The gate consulted the version-2 schema once, and the object it consulted is the object the next
    // step received: the second read of the accessor is never taken, so nothing unvalidated is adopted.
    expect(schemaSawTwo.length).toBe(1);
    expect(seenInputs[1]).toBe(schemaSawTwo[0]);
    expect(seenInputs[1]).toBe(certified);
    expect(reads.count).toBe(1);
    expect(result.status).toBe("loaded");
    if (result.status === "loaded") {
      // The loaded model descends from the certified document, not from the never-adopted one.
      expect((result.model as Record<string, unknown>)["marker"]).toBe("gate-saw-this");
      expect(result.appliedStepIds).toEqual(["step-1-2", "step-2-3"]);
      expect(result.trace).toEqual(["parse", "envelope", "declared-schema", "migration", "post-migration-schema", "semantic"]);
    }
    expect(log).toEqual(["schema:1", "step:step-1-2", "schema:2", "step:step-2-3", "schema:3", "semantic", "normalize"]);
  });

  test("the same counterexample behind a Proxy instead of an accessor property", () => {
    const log: string[] = [];
    const certified = p15V2("gate-saw-this");
    const neverAdopted = p15V2("invalid");
    const seenInputs: Record<string, unknown>[] = [];
    const schemaSawTwo: Record<string, unknown>[] = [];
    const reads = { count: 0 };
    const steps = [
      p15AccessorStep({ id: "step-1-2", from: 1, to: 2, log: log, reads: reads, seenInputs: seenInputs, useProxy: true, valuesFor: () => [certified, neverAdopted] }),
      p15Step({ id: "step-2-3", from: 2, to: 3, log: log, seenInputs: seenInputs })
    ];
    const ports = p15Ports({
      log: log,
      registries: { results: p15SyntheticRegistry("results", 1, 3, steps) },
      schemaRule: p15MarkerRule(schemaSawTwo),
      normalize: (document) => document
    });

    const result = p15Load(ports, p15Bytes(1));

    expect(schemaSawTwo.length).toBe(1);
    expect(seenInputs[1]).toBe(schemaSawTwo[0]);
    expect(reads.count).toBe(1);
    expect(result.status).toBe("loaded");
    if (result.status === "loaded") {
      expect((result.model as Record<string, unknown>)["marker"]).toBe("gate-saw-this");
    }
    expect(log).toEqual(["schema:1", "step:step-1-2", "schema:2", "step:step-2-3", "schema:3", "semantic", "normalize"]);
  });

  test("control: a stable multi-step load still succeeds with the same trace and the same order", () => {
    const log: string[] = [];
    const seenInputs: Record<string, unknown>[] = [];
    const steps = [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: log, seenInputs: seenInputs }),
      p15Step({ id: "step-2-3", from: 2, to: 3, log: log, seenInputs: seenInputs })
    ];
    const ports = p15Ports({
      log: log,
      registries: { results: p15SyntheticRegistry("results", 1, 3, steps) },
      normalize: (document) => document
    });

    const result = p15Load(ports, p15Bytes(1));
    expect(result.status).toBe("loaded");
    if (result.status === "loaded") {
      expect(result.stage).toBe("semantic");
      expect(result.trace).toEqual(["parse", "envelope", "declared-schema", "migration", "post-migration-schema", "semantic"]);
      expect(result.appliedStepIds).toEqual(["step-1-2", "step-2-3"]);
      expect((result.model as Record<string, unknown>)["schemaVersion"]).toBe(3);
      expect((result.model as Record<string, unknown>)["appliedThrough"]).toBe("step-2-3");
    }
    expect(log).toEqual(["schema:1", "step:step-1-2", "schema:2", "step:step-2-3", "schema:3", "semantic", "normalize"]);
    // Each step still receives the previous step's own output by identity — no rebuild stands between.
    expect(seenInputs[1]["schemaVersion"]).toBe(2);
    expect(seenInputs[1]["appliedThrough"]).toBe("step-1-2");
  });

  test("a later valid read cannot rescue an output the gate already rejected", () => {
    const log: string[] = [];
    const neverAdopted = p15V2("invalid");
    const seenInputs: Record<string, unknown>[] = [];
    const steps = [
      p15AccessorStep({ id: "step-1-2", from: 1, to: 2, log: log, seenInputs: seenInputs, valuesFor: () => [neverAdopted, p15V2("valid-on-second-read")] }),
      p15Step({ id: "step-2-3", from: 2, to: 3, log: log, seenInputs: seenInputs })
    ];
    const schemaSawTwo: Record<string, unknown>[] = [];
    const ports = p15Ports({
      log: log,
      registries: { results: p15SyntheticRegistry("results", 1, 3, steps) },
      schemaRule: p15MarkerRule(schemaSawTwo),
      normalize: (document) => document
    });

    const result = p15Load(ports, p15Bytes(1));
    const error = p15Rejected(result);
    p15ExpectFromTable(error, "post-migration-schema-invalid");
    expect(error.safeContext).toEqual({ paths: ["/marker"] });
    expect(schemaSawTwo.length).toBe(1);
    expect(schemaSawTwo[0]).toBe(neverAdopted);
    // No later port recorded a call: no second step, no semantic pass, no normalization.
    expect(log).toEqual(["schema:1", "step:step-1-2", "schema:2"]);
    expect(log.indexOf("semantic")).toBe(-1);
    expect(p15NormalizeCalls(log)).toBe(0);
    expect(result).not.toHaveProperty("model");
  });

  test("an invalid final current-version output is still post-migration-schema-invalid", () => {
    const log: string[] = [];
    const steps = [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: log }),
      p15Step({ id: "step-2-3", from: 2, to: 3, log: log })
    ];
    const ports = p15Ports({
      log: log,
      registries: { results: p15SyntheticRegistry("results", 1, 3, steps) },
      schemaRule: (family, schemaVersion) => (schemaVersion === 3 ? [""] : null),
      normalize: (document) => document
    });

    const result = p15Load(ports, p15Bytes(1));
    const error = p15Rejected(result);
    p15ExpectFromTable(error, "post-migration-schema-invalid");
    expect(error.safeContext).toEqual({ paths: [""] });
    // No later port recorded a call.
    expect(log).toEqual(["schema:1", "step:step-1-2", "schema:2", "step:step-2-3", "schema:3"]);
    expect(log.indexOf("semantic")).toBe(-1);
    expect(p15NormalizeCalls(log)).toBe(0);
    expect(result).not.toHaveProperty("model");
  });

  // The accepted walk keeps every reason it owns for an output it rejects: the rebuilt result carries the
  // captured values, so an unchanged output is still reference-equal, a non-object is still invalid, a
  // wrong version is still the wrong version, and an unreadable member still throws inside the walk.
  interface AccessorRejectionCase {
    readonly label: string;
    readonly expectedReason: "step-output-unchanged" | "step-result-invalid" | "step-output-wrong-version" | "step-threw";
    readonly valuesFor?: (stepInput: FamilyMigrationStepInput<unknown>) => readonly unknown[];
    readonly throwOnRead?: boolean;
  }
  const ACCESSOR_REJECTIONS: readonly AccessorRejectionCase[] = [
    { label: "unchanged output", expectedReason: "step-output-unchanged", valuesFor: (stepInput) => [stepInput.document] },
    { label: "non-object output", expectedReason: "step-result-invalid", valuesFor: () => ["not-a-document"] },
    { label: "null output", expectedReason: "step-result-invalid", valuesFor: () => [null] },
    { label: "array output", expectedReason: "step-result-invalid", valuesFor: () => [[{ schemaVersion: 2 }]] },
    // One version ahead of the step's own target: the walk's wrong-version condition, not a schema gap.
    { label: "wrong-version output", expectedReason: "step-output-wrong-version", valuesFor: () => [{ format: P15_FORMAT, schemaVersion: 3, yearMonthUtc: "2026-09", sessions: [], marker: "skipped-a-version" }] },
    { label: "unreadable output member", expectedReason: "step-threw", throwOnRead: true }
  ];

  for (const oneCase of ACCESSOR_REJECTIONS) {
    test("an accessor " + oneCase.label + " keeps its own migration-failed reason, never a schema failure", () => {
      const log: string[] = [];
      const seenInputs: Record<string, unknown>[] = [];
      const steps = [
        p15AccessorStep({
          id: "step-1-2",
          from: 1,
          to: 2,
          log: log,
          seenInputs: seenInputs,
          throwOnRead: oneCase.throwOnRead,
          valuesFor: oneCase.valuesFor === undefined ? () => [null] : oneCase.valuesFor
        }),
        p15Step({ id: "step-2-3", from: 2, to: 3, log: log, seenInputs: seenInputs })
      ];
      const schemaSawTwo: Record<string, unknown>[] = [];
      const ports = p15Ports({
        log: log,
        registries: { results: p15SyntheticRegistry("results", 1, 3, steps) },
        schemaRule: p15MarkerRule(schemaSawTwo),
        normalize: (document) => document
      });

      const bytes = p15Bytes(1);
      const before = byteSnapshot(bytes);
      const result = p15Load(ports, bytes, p15FrozenContext());

      const error = p15Rejected(result);
      p15ExpectFromTable(error, "migration-failed");
      expect(error.safeContext).toEqual({ family: "results", fromSchemaVersion: 1, toSchemaVersion: 2 });
      // The next-version gate never ran, so none of these accepted walk reasons became a schema failure.
      expect(schemaSawTwo.length).toBe(0);
      // No later port recorded a call: no second step, no semantic pass, no normalization.
      expect(log).toEqual(["schema:1", "step:step-1-2"]);
      expect(log.indexOf("semantic")).toBe(-1);
      expect(p15NormalizeCalls(log)).toBe(0);
      expect(result).not.toHaveProperty("model");
      expect(sameByteValues(bytes, before)).toBe(true);

      // The underlying reason stays visible to a caller that reads the accepted registry directly.
      const direct = p15SyntheticRegistry("results", 1, 3, [
        p15AccessorStep({
          id: "step-1-2",
          from: 1,
          to: 2,
          log: [],
          throwOnRead: oneCase.throwOnRead,
          valuesFor: oneCase.valuesFor === undefined ? () => [null] : oneCase.valuesFor
        }),
        p15Step({ id: "step-2-3", from: 2, to: 3, log: [] })
      ]).migrate({ document: { format: P15_FORMAT, schemaVersion: 1 }, context: null });
      expect(direct.status).toBe("failed");
      if (direct.status === "failed") {
        expect(direct.failure.reason).toBe(oneCase.expectedReason);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// R-04 — semantic validation runs on the final current document, last of six
// ---------------------------------------------------------------------------

describe("P15 pipeline: semantic validation is the last stage before normalization", () => {
  test("an invalid final semantic pass is semantic-invalid with paths and no model", () => {
    const log: string[] = [];
    const registry = p15SyntheticRegistry("results", 1, 3, [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: log }),
      p15Step({ id: "step-2-3", from: 2, to: 3, log: log })
    ]);
    const ports = p15Ports({
      log: log,
      registries: { results: registry },
      semanticRule: (family, document) => (document === null ? null : ["/sessions/0"]),
      normalize: (document) => document
    });

    const result = p15Load(ports, p15Bytes(1));
    const error = p15Rejected(result);
    p15ExpectFromTable(error, "semantic-invalid");
    expect(error.safeContext).toEqual({ paths: ["/sessions/0"] });
    expect(log[log.length - 1]).toBe("semantic");
    expect(p15NormalizeCalls(log)).toBe(0);
    expect(result).not.toHaveProperty("model");
  });

  test("the semantic port sees the final version-3 document, and only it", () => {
    const log: string[] = [];
    const seen: unknown[] = [];
    const registry = p15SyntheticRegistry("results", 1, 3, [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: log }),
      p15Step({ id: "step-2-3", from: 2, to: 3, log: log })
    ]);
    const ports = p15Ports({
      log: log,
      registries: { results: registry },
      semanticRule: (family, document) => {
        seen.push(document);
        return null;
      }
    });
    p15Load(ports, p15Bytes(1));
    expect(seen.length).toBe(1);
    const final = seen[0] as Record<string, unknown>;
    expect(final["schemaVersion"]).toBe(3);
    expect(final["appliedThrough"]).toBe("step-2-3");
  });

  test("the semantic port sees the current document of a zero-step load", () => {
    const log: string[] = [];
    const seen: unknown[] = [];
    const ports = p15Ports({
      log: log,
      semanticRule: (family, document) => {
        seen.push(document);
        return null;
      }
    });
    const result = p15Load(ports, p15Bytes(1));
    expect(result.status).toBe("loaded");
    expect(seen.length).toBe(1);
    expect((seen[0] as Record<string, unknown>)["schemaVersion"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// R-05 — normalization only after success
// ---------------------------------------------------------------------------

describe("P15 pipeline: normalization runs last, once, only after a semantic success", () => {
  test("the injected normalizer runs exactly once, after semantic, and its value is the model", () => {
    const log: string[] = [];
    const sentinel = { syntheticModelFromNormalizer: 1 };
    const registry = p15SyntheticRegistry("results", 1, 2, [p15Step({ id: "step-1-2", from: 1, to: 2, log: log })]);
    const ports = p15Ports({ log: log, registries: { results: registry }, normalize: () => sentinel });

    const result = p15Load(ports, p15Bytes(1));
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      return;
    }
    expect(result.model).toBe(sentinel);
    expect(p15NormalizeCalls(log)).toBe(1);
    expect(log.slice(log.length - 2)).toEqual(["semantic", "normalize"]);
  });

  test("with no normalizer injected the model is the validated final document", () => {
    const log: string[] = [];
    const ports = p15Ports({ log: log });
    const result = p15Load(ports, p15Bytes(1));
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      return;
    }
    expect(result.model).toEqual({ format: P15_FORMAT, schemaVersion: 1, yearMonthUtc: "2026-09", sessions: [] });
    expect(p15NormalizeCalls(log)).toBe(0);
  });

  test("no rejection path calls the normalizer, for any of the seven failure arms", () => {
    const gapRegistry = p15SyntheticRegistry("results", 1, 3, []);
    const threeStep = (log: string[]) =>
      p15SyntheticRegistry("results", 1, 3, [
        p15Step({ id: "step-1-2", from: 1, to: 2, log: log }),
        p15Step({ id: "step-2-3", from: 2, to: 3, log: log })
      ]);
    interface FailureCase {
      readonly label: string;
      readonly expectedKind: PipelineErrorKind;
      readonly ports: (log: string[]) => DocumentPipelinePorts<unknown, unknown>;
      readonly bytes: Uint8Array;
      readonly unknownName?: unknown;
    }
    const cases: readonly FailureCase[] = [
      {
        label: "parse-failed",
        expectedKind: "parse-failed",
        ports: (log) => p15Ports({ log: log, normalize: (d) => d }),
        bytes: new Uint8Array([0xff, 0xfe])
      },
      {
        label: "envelope-missing-version",
        expectedKind: "envelope-missing-version",
        ports: (log) => p15Ports({ log: log, normalize: (d) => d }),
        bytes: inputEncoder.encode(JSON.stringify({ format: P15_FORMAT }))
      },
      {
        label: "declared-schema-invalid",
        expectedKind: "declared-schema-invalid",
        ports: (log) => p15Ports({ log: log, schemaRule: (f, v) => (v === 1 ? [""] : null), normalize: (d) => d }),
        bytes: p15Bytes(1)
      },
      {
        label: "migration-failed",
        expectedKind: "migration-failed",
        ports: (log) => p15Ports({ log: log, registries: { results: gapRegistry }, normalize: (d) => d }),
        bytes: p15Bytes(1)
      },
      {
        label: "post-migration-schema-invalid",
        expectedKind: "post-migration-schema-invalid",
        ports: (log) =>
          p15Ports({
            log: log,
            registries: { results: threeStep(log) },
            schemaRule: (f, v) => (v === 2 ? [""] : null),
            normalize: (d) => d
          }),
        bytes: p15Bytes(1)
      },
      {
        label: "semantic-invalid",
        expectedKind: "semantic-invalid",
        ports: (log) => p15Ports({ log: log, semanticRule: () => ["/sessions"], normalize: (d) => d }),
        bytes: p15Bytes(1)
      },
      {
        label: "unknown-file",
        expectedKind: "parse-failed",
        ports: (log) => p15Ports({ log: log, normalize: (d) => d }),
        bytes: p15Bytes(1),
        unknownName: "notes.txt"
      }
    ];
    for (const oneCase of cases) {
      const log: string[] = [];
      if (oneCase.unknownName === undefined) {
        const result = p15Load(oneCase.ports(log), oneCase.bytes);
        const error = p15Rejected(result);
        expect(error.kind).toBe(oneCase.expectedKind);
      } else {
        const result = p15Load(oneCase.ports(log), oneCase.bytes, null, oneCase.unknownName);
        expect(result.status).toBe("unknown-file");
      }
      expect(p15NormalizeCalls(log)).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// R-06 — caller bytes and context are byte-identical on every path
// ---------------------------------------------------------------------------

describe("P15 pipeline: the caller keeps its exact bytes and its context on every path", () => {
  interface PathCase {
    readonly label: string;
    readonly ports: (log: string[]) => DocumentPipelinePorts<unknown, unknown>;
    readonly bytes: () => Uint8Array;
    readonly expected: "loaded" | "rejected" | "unknown-file";
  }
  const gapRegistry = p15SyntheticRegistry("results", 1, 3, []);
  const twoSteps = (log: string[]) =>
    p15SyntheticRegistry("results", 1, 3, [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: log }),
      p15Step({ id: "step-2-3", from: 2, to: 3, log: log })
    ]);
  const PATH_CASES: readonly PathCase[] = [
    { label: "loaded", ports: (log) => p15Ports({ log: log }), bytes: () => p15Bytes(1), expected: "loaded" },
    {
      label: "loaded through a byte-order mark",
      ports: (log) => p15Ports({ log: log }),
      bytes: () => inputBytes(MARK, JSON.stringify({ format: P15_FORMAT, schemaVersion: 1, yearMonthUtc: "2026-09", sessions: [] })),
      expected: "loaded"
    },
    {
      label: "parse-failed",
      ports: (log) => p15Ports({ log: log }),
      bytes: () => new Uint8Array([0xff, 0x22, 0x22]),
      expected: "rejected"
    },
    {
      label: "envelope rejection",
      ports: (log) => p15Ports({ log: log }),
      bytes: () => inputEncoder.encode(JSON.stringify({ format: P15_FORMAT })),
      expected: "rejected"
    },
    {
      label: "declared-schema-invalid",
      ports: (log) => p15Ports({ log: log, schemaRule: (f, v) => (v === 1 ? ["/"] : null) }),
      bytes: () => p15Bytes(1),
      expected: "rejected"
    },
    {
      label: "migration-failed",
      ports: (log) => p15Ports({ log: log, registries: { results: gapRegistry } }),
      bytes: () => p15Bytes(1),
      expected: "rejected"
    },
    {
      label: "post-migration-schema-invalid",
      ports: (log) => p15Ports({ log: log, registries: { results: twoSteps(log) }, schemaRule: (f, v) => (v === 2 ? ["/"] : null) }),
      bytes: () => p15Bytes(1),
      expected: "rejected"
    },
    {
      label: "semantic-invalid",
      ports: (log) => p15Ports({ log: log, semanticRule: () => ["/"] }),
      bytes: () => p15Bytes(1),
      expected: "rejected"
    },
    {
      label: "unknown-file",
      ports: (log) => p15Ports({ log: log }),
      bytes: () => new Uint8Array([0xff, 0xfe, 0xfd]),
      expected: "unknown-file"
    }
  ];

  for (const oneCase of PATH_CASES) {
    test("path " + oneCase.label + ": bytes identical, writable, context untouched, frozen context accepted", () => {
      const log: string[] = [];
      const bytes = oneCase.bytes();
      const before = byteSnapshot(bytes);
      const context = p15FrozenContext();
      const contextBefore = JSON.stringify(context);

      const result = p15Load(oneCase.ports(log), bytes, context, oneCase.label === "unknown-file" ? "notes.txt" : undefined);
      expect(result.status).toBe(oneCase.expected);

      // Same length, same bytes, same identity, and still writable by the caller (FF-14, FF-20).
      expect(sameByteValues(bytes, before)).toBe(true);
      expect(bytes.length).toBe(before.length);
      const last = bytes.length - 1;
      bytes[last] = bytes[last];
      expect(sameByteValues(bytes, before)).toBe(true);
      // The frozen context was accepted and never written: it is a frozen object, so any write
      // anywhere in this call would already have thrown in strict mode.
      expect(JSON.stringify(context)).toBe(contextBefore);
    });
  }

  test("a byte-order-mark input keeps its mark and still loads", () => {
    const log: string[] = [];
    const bytes = inputBytes(MARK, JSON.stringify({ format: P15_FORMAT, schemaVersion: 1, yearMonthUtc: "2026-09", sessions: [] }));
    const result = p15Load(p15Ports({ log: log }), bytes);
    expect(result.status).toBe("loaded");
    expect(bytes[0]).toBe(0xef);
    expect(bytes[1]).toBe(0xbb);
    expect(bytes[2]).toBe(0xbf);
  });

  test("no port received a copy of the context: steps and semantic see the caller's own value", () => {
    const log: string[] = [];
    const seenContexts: unknown[] = [];
    const registry = p15SyntheticRegistry("results", 1, 2, [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: log, seenContexts: seenContexts })
    ]);
    let semanticContext: unknown = undefined;
    const ports = p15Ports({
      log: log,
      registries: { results: registry },
      semanticRule: (family, document, context) => {
        semanticContext = context;
        return null;
      }
    });
    const context = p15FrozenContext();
    p15Load(ports, p15Bytes(1), context);
    expect(seenContexts.length).toBe(1);
    expect(seenContexts[0]).toBe(context);
    expect(semanticContext).toBe(context);
  });
});

// ---------------------------------------------------------------------------
// R-07, R-08 — a step that mutates its input corrupts nothing caller-owned;
// each step receives the previous output, one read-only validated value
// ---------------------------------------------------------------------------

describe("P15 pipeline: a mutating step corrupts nothing the caller owns", () => {
  test("a tampered document is rejected by the schema stage and no later port runs", () => {
    const log: string[] = [];
    const registry = p15SyntheticRegistry("results", 1, 3, [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: log, behavior: "mutate-input" }),
      p15Step({ id: "step-2-3", from: 2, to: 3, log: log })
    ]);
    const ports = p15Ports({
      log: log,
      registries: { results: registry },
      // The synthetic schema rejects any document carrying the tampering marker.
      schemaRule: (family, schemaVersion, document) =>
        (document as Record<string, unknown>)["tampered"] === true ? ["/tampered"] : null,
      normalize: (document) => document
    });

    const bytes = p15Bytes(1);
    const before = byteSnapshot(bytes);
    const context = p15FrozenContext();
    const contextBefore = JSON.stringify(context);

    const result = p15Load(ports, bytes, context);
    const error = p15Rejected(result);
    p15ExpectFromTable(error, "post-migration-schema-invalid");
    expect(log).toEqual(["schema:1", "step:step-1-2", "schema:2"]);
    expect(sameByteValues(bytes, before)).toBe(true);
    expect(JSON.stringify(context)).toBe(contextBefore);
    expect(result).not.toHaveProperty("model");
  });

  test("the step input is not deep-frozen: a write into the pipeline-owned value does not throw", () => {
    const log: string[] = [];
    const registry = p15SyntheticRegistry("results", 1, 2, [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: log, behavior: "mutate-input" })
    ]);
    const ports = p15Ports({ log: log, registries: { results: registry } });
    // The mutation itself is the probe: this load only succeeds if the write above did not throw,
    // and no deep-frozen value was involved. Scope decision 3 adds neither freeze nor clone.
    const result = p15Load(ports, p15Bytes(1));
    expect(result.status).toBe("loaded");
  });

  test("one value per step: each step receives the previous step's output, never the parsed root twice", () => {
    const log: string[] = [];
    const seenInputs: Record<string, unknown>[] = [];
    const produced: Record<string, unknown>[] = [];
    const registry = p15SyntheticRegistry("results", 1, 3, [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: log, seenInputs: seenInputs, produced: produced }),
      p15Step({ id: "step-2-3", from: 2, to: 3, log: log, seenInputs: seenInputs, produced: produced })
    ]);
    const ports = p15Ports({ log: log, registries: { results: registry } });

    const result = p15Load(ports, p15Bytes(1));
    expect(result.status).toBe("loaded");
    expect(seenInputs.length).toBe(2);
    expect(produced.length).toBe(2);
    // Step two received exactly what step one produced — the identity proves no clone stands between
    // steps — and neither step received the same value twice.
    expect(seenInputs[1]).toBe(produced[0]);
    expect(seenInputs[0]).not.toBe(seenInputs[1]);
    expect(seenInputs[0]["schemaVersion"]).toBe(1);
    expect(seenInputs[1]["schemaVersion"]).toBe(2);
    // The applied identifiers appear in application order (R-08).
    if (result.status === "loaded") {
      expect(result.appliedStepIds).toEqual(["step-1-2", "step-2-3"]);
    }
  });
});

// ---------------------------------------------------------------------------
// R-09 — every accepted registry failure arm is one typed migration-failed
// ---------------------------------------------------------------------------

describe("P15 pipeline: each registry failure is one typed migration-failed carrying family and versions", () => {
  interface MigrationCase {
    readonly label: string;
    readonly behavior: P15StepBehavior;
    readonly expectedReason:
      | "step-reported-failure"
      | "step-threw"
      | "step-output-unchanged"
      | "step-output-wrong-version"
      | "step-result-invalid";
  }
  const MIGRATION_CASES: readonly MigrationCase[] = [
    { label: "step-reported-failure", behavior: "fail", expectedReason: "step-reported-failure" },
    { label: "step-threw", behavior: "throw", expectedReason: "step-threw" },
    { label: "step-output-unchanged", behavior: "same-reference", expectedReason: "step-output-unchanged" },
    { label: "step-output-wrong-version", behavior: "wrong-version", expectedReason: "step-output-wrong-version" },
    { label: "step-result-invalid", behavior: "garbage", expectedReason: "step-result-invalid" }
  ];

  for (const oneCase of MIGRATION_CASES) {
    test("a " + oneCase.label + " step stops with migration-failed 1->2 and no second step", () => {
      const log: string[] = [];
      const steps = [
        p15Step({ id: "step-1-2", from: 1, to: 2, log: log, behavior: oneCase.behavior }),
        p15Step({ id: "step-2-3", from: 2, to: 3, log: log })
      ];
      const ports = p15Ports({ log: log, registries: { results: p15SyntheticRegistry("results", 1, 3, steps) } });

      const bytes = p15Bytes(1);
      const before = byteSnapshot(bytes);
      const context = p15FrozenContext();
      const result = p15Load(ports, bytes, context);

      const error = p15Rejected(result);
      p15ExpectFromTable(error, "migration-failed");
      expect(error.safeContext).toEqual({ family: "results", fromSchemaVersion: 1, toSchemaVersion: 2 });
      // The step detail never reaches the pipeline error: only the three declared fields exist.
      expect(Object.keys(error.safeContext).sort()).toEqual(["family", "fromSchemaVersion", "toSchemaVersion"]);
      expect(log).toEqual(["schema:1", "step:step-1-2"]);
      expect(sameByteValues(bytes, before)).toBe(true);
      expect(result).not.toHaveProperty("model");

      // The distinct underlying reason stays visible to a caller that reads the accepted registry.
      const direct = p15SyntheticRegistry("results", 1, 3, [
        p15Step({ id: "step-1-2", from: 1, to: 2, log: [], behavior: oneCase.behavior }),
        p15Step({ id: "step-2-3", from: 2, to: 3, log: [] })
      ]).migrate({ document: { format: P15_FORMAT, schemaVersion: 1 }, context: null });
      expect(direct.status).toBe("failed");
      if (direct.status === "failed") {
        expect(direct.failure.reason).toBe(oneCase.expectedReason);
      }
    });
  }

  test("a chain gap stops with migration-failed naming the version that has no step", () => {
    const log: string[] = [];
    const ports = p15Ports({ log: log, registries: { results: p15SyntheticRegistry("results", 1, 3, []) } });
    const result = p15Load(ports, p15Bytes(1));
    const error = p15Rejected(result);
    p15ExpectFromTable(error, "migration-failed");
    // The two integers are reads of the failure's own fields: the gap at version 1 and the walk's
    // target, the current version 3 — the module performs no version arithmetic at all.
    expect(error.safeContext).toEqual({ family: "results", fromSchemaVersion: 1, toSchemaVersion: 3 });
    expect(log).toEqual(["schema:1"]);
  });
});

// ---------------------------------------------------------------------------
// R-10 — missing reference context is one typed failure that invents nothing
// ---------------------------------------------------------------------------

describe("P15 pipeline: reference context is passed through, never fabricated", () => {
  function requireContextPorts(log: string[]): DocumentPipelinePorts<unknown, unknown> {
    return p15Ports({
      log: log,
      registries: {
        results: p15SyntheticRegistry("results", 1, 2, [
          p15Step({ id: "step-1-2", from: 1, to: 2, log: log, behavior: "require-context" })
        ])
      }
    });
  }

  test("a document needing a reference with context null is one typed failure naming no invented identity", () => {
    const log: string[] = [];
    const bytes = p15Bytes(1);
    const before = byteSnapshot(bytes);
    const result = p15Load(requireContextPorts(log), bytes, null);
    const error = p15Rejected(result);
    p15ExpectFromTable(error, "migration-failed");
    // Nothing was invented: the safe context holds only the closed family and the two integers.
    expect(Object.keys(error.safeContext).sort()).toEqual(["family", "fromSchemaVersion", "toSchemaVersion"]);
    expect(sameByteValues(bytes, before)).toBe(true);
    expect(result).not.toHaveProperty("model");
  });

  test("a context lacking the required reference fails the same way", () => {
    const log: string[] = [];
    const result = p15Load(requireContextPorts(log), p15Bytes(1), { hasWorkout9: false });
    p15ExpectFromTable(p15Rejected(result), "migration-failed");
  });

  test("a document that needs no reference loads with a context of null", () => {
    const log: string[] = [];
    const ports = p15Ports({ log: log });
    const result = p15Load(ports, p15Bytes(1), null);
    expect(result.status).toBe("loaded");
  });

  test("the supplied context reaches the step and the semantic port unchanged and by identity", () => {
    const log: string[] = [];
    const seenContexts: unknown[] = [];
    const ports = p15Ports({
      log: log,
      registries: {
        results: p15SyntheticRegistry("results", 1, 2, [
          p15Step({ id: "step-1-2", from: 1, to: 2, log: log, behavior: "require-context", seenContexts: seenContexts })
        ])
      }
    });
    const context = Object.freeze({ hasWorkout9: true });
    const result = p15Load(ports, p15Bytes(1), context);
    expect(result.status).toBe("loaded");
    expect(seenContexts).toEqual([context]);
    expect(seenContexts[0]).toBe(context);
  });
});

// ---------------------------------------------------------------------------
// R-11 — an unknown name is refused before any byte is read or any port runs
// ---------------------------------------------------------------------------

describe("P15 pipeline: an unknown name is refused before parsing and before every port", () => {
  test("a non-canonical name on unparseable bytes is still the accepted unknown-file outcome", () => {
    const log: string[] = [];
    const ports = p15Ports({ log: log });
    const bytes = new Uint8Array([0xff, 0xfe, 0xfd, 0xfc]);
    const before = byteSnapshot(bytes);

    const result = p15Load(ports, bytes, null, "notes.txt");
    expect(result).toEqual({ status: "unknown-file", name: "notes.txt" });
    // Nothing ran: no schema, no step, no semantic, no normalizer — and the parse failure that a
    // later stage would have reported never happened, because the name match came first.
    expect(log).toEqual([]);
    expect(sameByteValues(bytes, before)).toBe(true);
    expect(Object.keys(result).sort()).toEqual(["name", "status"]);
  });

  test("a non-string candidate returns the accepted null name", () => {
    const log: string[] = [];
    const ports = p15Ports({ log: log });
    const result = p15Load(ports, p15Bytes(1), null, 42);
    expect(result).toEqual({ status: "unknown-file", name: null });
    expect(log).toEqual([]);
  });

  test("the refusal selects no family, no version, and no registry, and no error kind is invented", () => {
    const log: string[] = [];
    const ports = p15Ports({ log: log });
    const result = p15Load(ports, p15Bytes(1), null, "results-2026-99.json");
    expect(result.status).toBe("unknown-file");
    expect(result).not.toHaveProperty("error");
    expect(result).not.toHaveProperty("family");
    expect(log).toEqual([]);
  });

  test("the module matches the name before it parses inside loadDocument", () => {
    const source = uncommented(PIPELINE_MODULE_SOURCE);
    const start = source.indexOf("export function loadDocument");
    expect(start !== -1).toBe(true);
    const body = source.slice(start);
    const nameAt = body.indexOf("matchCanonicalLogicalName(");
    const parseAt = body.indexOf("parseDocumentBytes(");
    expect(nameAt !== -1).toBe(true);
    expect(parseAt !== -1).toBe(true);
    expect(nameAt < parseAt).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// R-12 — parse failures keep the accepted reasons and stop the run
// ---------------------------------------------------------------------------

describe("P15 pipeline: parse failures stop before every other stage", () => {
  test("ill-formed UTF-8 is parse-failed invalid-utf8 with every later port uncalled", () => {
    const log: string[] = [];
    const bytes = new Uint8Array([0xff, 0xfe]);
    const before = byteSnapshot(bytes);
    const result = p15Load(p15Ports({ log: log }), bytes);
    const error = p15Rejected(result);
    p15ExpectFromTable(error, "parse-failed");
    expect(error.safeContext).toEqual({ reason: "invalid-utf8" });
    expect(log).toEqual([]);
    expect(sameByteValues(bytes, before)).toBe(true);
  });

  test("text that is not one JSON value is parse-failed malformed-json", () => {
    const log: string[] = [];
    const bytes = inputEncoder.encode("{not json");
    const result = p15Load(p15Ports({ log: log }), bytes);
    const error = p15Rejected(result);
    p15ExpectFromTable(error, "parse-failed");
    expect(error.safeContext).toEqual({ reason: "malformed-json" });
    expect(log).toEqual([]);
  });

  test("a second byte-order mark is parse-failed byte-order-mark and both marks stay in the caller's bytes", () => {
    const log: string[] = [];
    const bytes = inputBytes(MARK, MARK, "{}");
    const before = byteSnapshot(bytes);
    const result = p15Load(p15Ports({ log: log }), bytes);
    const error = p15Rejected(result);
    p15ExpectFromTable(error, "parse-failed");
    expect(error.safeContext).toEqual({ reason: "byte-order-mark" });
    expect(log).toEqual([]);
    expect(sameByteValues(bytes, before)).toBe(true);
  });

  test("exactly one leading mark is stripped for the parsed view while the caller keeps it", () => {
    const log: string[] = [];
    const body = JSON.stringify({ format: P15_FORMAT, schemaVersion: 1, yearMonthUtc: "2026-09", sessions: [] });
    const bytes = inputBytes(MARK, body);
    const before = byteSnapshot(bytes);
    const result = p15Load(p15Ports({ log: log }), bytes);
    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") {
      return;
    }
    // The parsed view excludes the mark (the load succeeded), while the caller still owns every
    // original byte, mark included (FF-14, D-02 Option BOM-2).
    expect((result.model as Record<string, unknown>)["schemaVersion"]).toBe(1);
    expect(sameByteValues(bytes, before)).toBe(true);
    expect(bytes.length).toBe(MARK.length + inputEncoder.encode(body).length);
    expect(bytes[0]).toBe(MARK[0]);
  });
});

// ---------------------------------------------------------------------------
// R-13 — envelope rejections keep their own kinds and precede every port
// ---------------------------------------------------------------------------

describe("P15 pipeline: each envelope rejection keeps its kind and precedes schema and migration", () => {
  interface EnvelopeCase {
    readonly label: string;
    readonly document: unknown;
    readonly name?: string;
    readonly expectedKind: PipelineErrorKind;
    readonly expectedContext?: Record<string, unknown>;
  }
  const ENVELOPE_CASES: readonly EnvelopeCase[] = [
    { label: "primitive root", document: 42, expectedKind: "envelope-not-object" },
    { label: "null root", document: null, expectedKind: "envelope-not-object" },
    { label: "array root", document: [1, 2], expectedKind: "envelope-not-object" },
    { label: "missing format", document: {}, expectedKind: "envelope-missing-format" },
    { label: "unknown format", document: { format: "repjot/unknown", schemaVersion: 1 }, expectedKind: "envelope-unknown-format" },
    {
      label: "wrong family",
      document: { format: P15_FORMAT, schemaVersion: 1 },
      name: "exercises.json",
      expectedKind: "envelope-wrong-family",
      expectedContext: { family: "results", expectedFamily: "exercises" }
    },
    { label: "missing version", document: { format: P15_FORMAT }, expectedKind: "envelope-missing-version" },
    { label: "string version", document: { format: P15_FORMAT, schemaVersion: "1" }, expectedKind: "envelope-non-number-version" },
    { label: "fractional version", document: { format: P15_FORMAT, schemaVersion: 1.5 }, expectedKind: "envelope-non-integer-version" },
    { label: "zero version", document: { format: P15_FORMAT, schemaVersion: 0 }, expectedKind: "envelope-non-positive-version" },
    {
      label: "future version",
      document: { format: P15_FORMAT, schemaVersion: 2 },
      expectedKind: "envelope-future-version",
      expectedContext: { schemaVersion: 2, currentSchemaVersion: 1 }
    }
  ];

  for (const oneCase of ENVELOPE_CASES) {
    test("envelope case " + oneCase.label + " keeps its kind and calls no later port", () => {
      const log: string[] = [];
      const bytes = inputEncoder.encode(JSON.stringify(oneCase.document));
      const before = byteSnapshot(bytes);
      const result = p15Load(p15Ports({ log: log }), bytes, null, oneCase.name);
      const error = p15Rejected(result);
      p15ExpectFromTable(error, oneCase.expectedKind, oneCase.name);
      if (oneCase.expectedContext !== undefined) {
        expect(error.safeContext as unknown as Record<string, unknown>).toEqual(oneCase.expectedContext);
      }
      expect(log).toEqual([]);
      expect(sameByteValues(bytes, before)).toBe(true);
      expect(result).not.toHaveProperty("model");
    });
  }

  // The unsupported-old arm is unreachable through a pipeline call for a documented reason: with the
  // accepted CURRENT_VERSION and SUPPORT_FLOOR_VERSION both 1, no positive version is below the
  // floor, and the accepted envelope-stage group above proves that table case unchanged. It therefore
  // reaches no migration call here — because no input can reach one as unsupported-old at all.
});

// ---------------------------------------------------------------------------
// R-16 — no state: repeated loads agree, documents are independent
// ---------------------------------------------------------------------------

describe("P15 pipeline: the pipeline holds no state across calls", () => {
  test("the same bytes, ports, and context load twice to deep-equal outcomes and traces", () => {
    const registry = p15SyntheticRegistry("results", 1, 2, [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: [] })
    ]);
    const first = p15Load(p15Ports({ log: [], registries: { results: registry } }), p15Bytes(1));
    const second = p15Load(p15Ports({ log: [], registries: { results: registry } }), p15Bytes(1));
    expect(second).toEqual(first);
    if (first.status === "loaded" && second.status === "loaded") {
      expect(second.trace).toEqual(first.trace);
    }
  });

  // "Every shard migrates independently" (FF-08): two shards of one family load through one port set
  // in sequence without influencing each other. Both declare v1 because the accepted
  // CURRENT_VERSION of every family is 1, so the envelope stage refuses a v2 document today; the
  // version difference that a migration chain will carry lives in the injected registry, not in a
  // document the accepted version bounds would admit.
  test("two documents of one family load independently in sequence", () => {
    const registry = p15SyntheticRegistry("results", 1, 2, [
      p15Step({ id: "step-1-2", from: 1, to: 2, log: [] })
    ]);
    const ports = p15Ports({ log: [], registries: { results: registry } });
    const september = p15Load(ports, p15Bytes(1), null, "results-2026-09.json");
    const october = p15Load(ports, p15Bytes(1), null, "results-2026-10.json");
    expect(september.status).toBe("loaded");
    expect(october.status).toBe("loaded");
    if (september.status === "loaded" && october.status === "loaded") {
      expect(september.appliedStepIds).toEqual(["step-1-2"]);
      expect(october.appliedStepIds).toEqual(["step-1-2"]);
      expect(september.trace).toEqual(october.trace);
      expect(september.model).toEqual(october.model);
    }
  });

  test("a failed load consumes nothing and a corrected load still succeeds through the same ports", () => {
    const log: string[] = [];
    const ports = p15Ports({
      log: log,
      registries: {
        results: p15SyntheticRegistry("results", 1, 2, [
          p15Step({ id: "step-1-2", from: 1, to: 2, log: log, behavior: "require-context" })
        ])
      }
    });
    const failed = p15Load(ports, p15Bytes(1), null);
    p15ExpectFromTable(p15Rejected(failed), "migration-failed");
    const fixed = p15Load(ports, p15Bytes(1), { hasWorkout9: true });
    expect(fixed.status).toBe("loaded");
  });
});

// ---------------------------------------------------------------------------
// R-14, R-15, R-17 — module shape, imports, purity, ES2019, closed kind set
// ---------------------------------------------------------------------------

/** The pipeline module's own text, scanned for mechanisms GATES.md Section 3 forbids on this path. */
const PIPELINE_MODULE_SOURCE = readFileSync(new URL("../src/documents/document-pipeline.ts", import.meta.url), "utf8");

/** Names and shapes that would put a second mechanism or a forbidden capability on this path. */
const P15_FORBIDDEN_SHAPES: readonly (readonly [string, RegExp])[] = [
  ["node module", /node:/],
  ["bun module", /bun:/],
  ["validation implementation import", /\.\.\/validation/],
  ["fetch", /\bfetch\s*\(/],
  ["XMLHttpRequest", /XMLHttpRequest/],
  ["indexedDB", /indexedDB/i],
  ["browser storage", /localStorage|sessionStorage/],
  ["window", /\bwindow\b/],
  ["navigator", /\bnavigator\b/],
  ["clock", /\bDate\b/],
  ["locale", /\bIntl\b/],
  ["arithmetic budget", /\bMath\b/],
  ["digest", /\bcrypto\b/],
  ["UI", /svelte/i],
  ["decoding here", /\bTextDecoder\b/],
  ["encoding here", /\bTextEncoder\b/],
  ["second parse", /\bJSON\b/],
  ["deep clone", /structuredClone|Object\.assign/],
  ["execution of content", /\beval\b|new Function/],
  ["CommonJS", /\brequire\b/],
  ["write path", /\bwrite[A-Z(]/],
  ["schema document", /\$id/],
  ["second envelope reader", /recognizeEnvelope\(|recognizeLogicalName\(/],
  ["second name matcher", /2026|\.json["']/]
];

describe("P15 pipeline: module shape, imports, purity, ES2019, and the closed kind set", () => {
  test("the module value-exports exactly the accepted P13 stage and the P15 pipeline call", () => {
    expect(Object.keys(documentPipelineModule).sort()).toEqual(["loadDocument", "recognizeDocumentEnvelope"]);
  });

  test("the module imports the accepted siblings and nothing else — the positive census that replaces the P14 'not yet' fact", () => {
    // Scope decision 7 moved the replaced Phase 14 expectation here as a positive closed-world
    // census: document-pipeline.ts may import exactly these specifiers and no other, and the
    // migration import is now required (scope decision 1) while src/main.ts still reaches none of it.
    const code = uncommented(PIPELINE_MODULE_SOURCE);
    const specifiers: string[] = [];
    for (const hit of matchesOf(code, /from\s+"[^"]*"/)) {
      specifiers.push(hit.replace(/^from\s+"/, "").replace(/"$/, ""));
    }
    specifiers.sort();
    expect(specifiers).toEqual([
      "../domain/families",
      "../migrations/migration-registry",
      "../migrations/migration-registry",
      "./envelope",
      "./envelope",
      "./pipeline-types",
      "./pipeline-types",
      "./safe-json-parser"
    ]);
    // The one-way direction the same accepted census keeps: nothing under src/migrations imports
    // src/documents, and the shipped entry point still reaches neither module.
    const migrationsSource = uncommented(readFileSync(new URL("../src/migrations/migration-registry.ts", import.meta.url), "utf8"));
    expect(migrationsSource.indexOf("documents/")).toBe(-1);
  });

  for (const forbidden of P15_FORBIDDEN_SHAPES) {
    test("the module contains no " + forbidden[0], () => {
      expect(forbidden[1].test(uncommented(PIPELINE_MODULE_SOURCE))).toBe(false);
    });
  }

  test("the module holds no syntax newer than ES2019", () => {
    const code = codeOnly(PIPELINE_MODULE_SOURCE);
    for (const token of FORBIDDEN_ES2020_TOKENS) {
      expect(code.indexOf(token)).toBe(-1);
    }
  });

  test("the module freezes exactly one value it owns and copies no caller value", () => {
    // The single Object.freeze is the success trace. There is no clone, no copy helper, and no freeze
    // of any caller value (scope decision 3: no deep copy, no deep freeze).
    expect(matchesOf(uncommented(PIPELINE_MODULE_SOURCE), /Object\.freeze\(/).length).toBe(1);
  });

  test("schemaVersion is only read and makePipelineError only builds rejections (decision 7b)", () => {
    const code = uncommented(PIPELINE_MODULE_SOURCE);
    // makePipelineError appears exactly once in the module, and only as the error field of the one
    // rejection arm — it builds rejections and nothing else.
    expect(matchesOf(code, /makePipelineError\(/).length).toBe(1);
    expect(matchesOf(code, /error: makePipelineError\(/).length).toBe(1);
    // No write to any schemaVersion: every mention is a read of an accepted value or a declared
    // field name. The only property writes in the module would match these scans; both are empty.
    expect(matchesOf(code, /schemaVersion\s*=[^=>]/).length).toBe(0);
    expect(matchesOf(code, /"schemaVersion"\s*=[^=]/).length).toBe(0);
    // The reads are exactly the envelope's declared version and the accepted result's version facts.
    expect(code.indexOf("selection.schemaVersion") !== -1).toBe(true);
    expect(code.indexOf("walked.currentSchemaVersion") !== -1).toBe(true);
    expect(code.indexOf("selection.currentSchemaVersion") !== -1).toBe(true);
    // And the accepted no-numeric-literal duty that stays in force for this module has its module-side
    // half here: the migration-failed mapping performs no version arithmetic, so the wired module
    // still holds no digit outside comments and strings.
    expect(matchesOf(codeOnly(PIPELINE_MODULE_SOURCE), /(?<![\w.])\d+(?:\.\d+)?(?![\w])/).length).toBe(0);
  });

  test("every pipeline kind the module rejects with is an accepted member and none is new", () => {
    const code = uncommented(PIPELINE_MODULE_SOURCE);
    const used: string[] = [];
    for (const hit of matchesOf(code, /rejectStage\("[a-z-]+"/)) {
      used.push(hit.slice('rejectStage("'.length, hit.length - 1));
    }
    expect(used.sort()).toEqual([
      "declared-schema-invalid",
      "migration-failed",
      "migration-failed",
      "post-migration-schema-invalid",
      "post-migration-schema-invalid",
      "semantic-invalid"
    ]);
    for (const kindText of used) {
      expect(PIPELINE_ERROR_KINDS.indexOf(kindText as PipelineErrorKind) !== -1).toBe(true);
    }
    expect(PIPELINE_ERROR_KINDS.length).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Compile-time boundaries for the pipeline call
// ---------------------------------------------------------------------------

function p15TypeProbes(): void {
  const ports = p15Ports({ log: [] });
  const bytes = p15Bytes(1);
  const ok: DocumentPipelineResult<unknown> = loadDocument<unknown, unknown>({
    logicalName: P15_NAME,
    source: P15_SOURCE,
    bytes: bytes,
    context: null,
    ports: ports
  });
  // @ts-expect-error the input carries no Drive change-indicator field (FF-11)
  loadDocument<unknown, unknown>({ logicalName: P15_NAME, source: P15_SOURCE, bytes: bytes, context: null, ports: ports, modifiedTime: "synthetic" });
  // @ts-expect-error the ports are required, so a load without them does not compile
  loadDocument<unknown, unknown>({ logicalName: P15_NAME, source: P15_SOURCE, bytes: bytes, context: null });
  // @ts-expect-error the accepted kind set is closed, so no normalize-stage error kind exists
  const inventedKind: PipelineErrorKind = "normalize-failed";
  // @ts-expect-error a trace holds Section 12 stage names only, and normalize is not one
  const traceEntry: PipelineStage = "normalize";
  if (ok.status === "loaded") {
    // @ts-expect-error the loaded outcome is read-only
    ok.stage = "parse";
    const stageOfLoad: PipelineStage = ok.stage;
    const stepsOfLoad: readonly MigrationStepId[] = ok.appliedStepIds;
    void stageOfLoad;
    void stepsOfLoad;
  }
  void ok;
  void inventedKind;
  void traceEntry;
}

describe("P15 pipeline: compile-time boundaries", () => {
  test("the P15 type probes are present for bun run check", () => {
    expect(typeof p15TypeProbes).toBe("function");
  });
});
