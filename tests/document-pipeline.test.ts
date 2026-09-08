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
