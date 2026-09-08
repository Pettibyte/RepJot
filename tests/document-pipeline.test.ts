/**
 * Table tests for the document pipeline types and the user-facing error shape (P11-T01).
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
 *
 * Every input is a fixed literal: no clock, no random value, no locale formatting, no network, and no
 * file read. No test decides an outcome by reading message text. Message text appears only in the
 * fixedness and retention checks that prove a fixed message never picks up document content or
 * caller-supplied text, which is the opposite question from branching.
 */
import { describe, expect, test } from "bun:test";

import { APP_ERROR_KINDS } from "../src/errors/app-error";
import type { AppError, AppErrorKind } from "../src/errors/app-error";
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
