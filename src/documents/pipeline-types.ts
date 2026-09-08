/**
 * Document pipeline stage, provenance, and error types (P11-T01).
 *
 * Authority: docs/implementation/phase-11.md ("Give every pipeline result an explicit stage,
 * provenance record, and safe error category"), docs/ARCHITECTURE.md Section 12 (the six
 * load-pipeline stage rows), Section 16 (the user-facing category set and the naming duty of each
 * category row), Section 8 ("Provenance includes source family, source schema version, current
 * schema version, validation version, and migration path"), Section 15 (safe-log redaction list),
 * docs/contracts/families-and-files.md FF-06, FF-09, FF-10, FF-14, FF-18, FF-20, and
 * specs/schema-versioning.md (envelope, migration chains, version handling, failure and recovery).
 *
 * Scope. This module names types, one descriptor table, and one constructor that reads that table. It
 * implements no behaviour that a later phase owns:
 * no byte parsing (Phase 12), no envelope reading or filename matching (Phase 13), no migration
 * registry or migration function (Phase 14), no stage-order enforcement and no pipeline function
 * (Phase 15), no normalizer and no digest service (Phase 16), no static loader and no network
 * adapter (Phase 17). `recognizeEnvelope` in src/domain/families.ts stays the only envelope
 * recogniser and `src/validation/**` stays the only validator; nothing here re-implements either.
 *
 * Dependency direction. docs/ARCHITECTURE.md Section 7 gives the document pipeline "Can depend on:
 * Schema, migration, semantic validation" and docs/implementation/GATES.md Section 3 forbids a DOM,
 * clock, locale, random, Svelte, Drive, IndexedDB, or `src/infrastructure` import on this path. This
 * file imports pure domain types only. It does not import `src/errors/app-error.ts`: the pipeline
 * error layer below carries its own kind set, and the link to the Section 16 user-facing set is a
 * closed set of member names that `tests/document-pipeline.test.ts` proves against
 * `APP_ERROR_KINDS`.
 *
 * Two error layers, never one. Section 16 fixes the user-facing `AppErrorKind` set at thirteen
 * members with no per-stage member, while FF-10 requires a distinct typed envelope rejection per
 * condition and FF-14 a distinct parse rejection. So a pipeline error kind is per stage and per
 * condition, and each one maps to exactly one Section 16 category in `PIPELINE_ERROR_DESCRIPTORS`.
 * The seven kinds named by `docs/implementation/phase-11.md` ("parse, envelope, unsupported-old,
 * future, schema, migration, and semantic errors") all appear; the envelope and schema groups carry
 * more than one member because FF-09, FF-10, and the Phase 11 edge cases require that distinctness.
 */
import type { DocumentFamily } from "../domain/families";

// ---------------------------------------------------------------------------
// Stage set (docs/ARCHITECTURE.md Section 12)
// ---------------------------------------------------------------------------

/**
 * The six load-pipeline stages, in execution order, from the Section 12 stage table. The table's
 * seventh row, prior-production compatibility, is a build-time gate already implemented and owned by
 * Phases 1-10 (`scripts/compare-production.ts`) and recorded again at Phase 82; it never runs inside
 * a load, so it is not a member of this set and is not redefined here.
 */
export type PipelineStage =
  /** Section 12 "JSON parsing": parse source bytes as `unknown`. */
  | "parse"
  /** Section 12 "Envelope recognition": read only `format` and positive integer `schemaVersion`. */
  | "envelope"
  /** Section 12 "Historical schema validation": validate the exact declared historical schema. */
  | "declared-schema"
  /** Section 12 "Ordered migration": apply pure `vN -> vN+1` functions. */
  | "migration"
  /** Section 12 "Post-migration validation": validate every intermediate and final output. */
  | "post-migration-schema"
  /** Section 12 "Cross-file semantic validation": references, identities, paths, units, scores. */
  | "semantic";

const PIPELINE_STAGE_LIST = [
  "parse",
  "envelope",
  "declared-schema",
  "migration",
  "post-migration-schema",
  "semantic"
] as const satisfies readonly PipelineStage[];

/** A type-level assertion: instantiation only type-checks when the argument is `never`. */
type AssertNever<T extends never> = T;

/** Compile-time coverage guard for the stage list above. */
type PipelineStageListCoverage = AssertNever<
  Exclude<(typeof PIPELINE_STAGE_LIST)[number], PipelineStage> | Exclude<PipelineStage, (typeof PIPELINE_STAGE_LIST)[number]>
>;

/** The six load stages as one stable, ordered, enumerable value. */
export const PIPELINE_STAGES: readonly PipelineStage[] = PIPELINE_STAGE_LIST;

// ---------------------------------------------------------------------------
// User-facing category link (docs/ARCHITECTURE.md Section 16)
// ---------------------------------------------------------------------------

/**
 * The Section 16 category rows a pipeline failure may name: Unsupported schema, Invalid document,
 * Migration, Semantic reference. These four strings are members of `AppErrorKind`
 * (src/errors/app-error.ts); this module does not import that file, so
 * `tests/document-pipeline.test.ts` proves the membership and the one-category-per-kind rule.
 */
export type PipelineUserCategory = "unsupported_schema" | "invalid_document" | "migration" | "semantic_reference";

const PIPELINE_USER_CATEGORY_LIST = ["unsupported_schema", "invalid_document", "migration", "semantic_reference"] as const satisfies readonly PipelineUserCategory[];

/** Compile-time coverage guard for the category list above. */
type PipelineUserCategoryListCoverage = AssertNever<
  Exclude<(typeof PIPELINE_USER_CATEGORY_LIST)[number], PipelineUserCategory> | Exclude<PipelineUserCategory, (typeof PIPELINE_USER_CATEGORY_LIST)[number]>
>;

/** The four pipeline-reachable Section 16 categories as one stable, enumerable value. */
export const PIPELINE_USER_CATEGORIES: readonly PipelineUserCategory[] = PIPELINE_USER_CATEGORY_LIST;

// ---------------------------------------------------------------------------
// Safe context (docs/ARCHITECTURE.md Section 15, Section 16 category naming duty)
// ---------------------------------------------------------------------------

/**
 * The three parse-stage failure classes named by FF-14 and docs/decisions/document-parsing-byte-order-mark.md
 * (D-02, approved Option BOM-2): strict UTF-8 decoding failure, JSON text that is not one JSON value
 * (empty input included), and a repeated byte-order mark or one at any offset other than zero.
 * Phase 12 implements the detection; this phase only fixes the diagnostic names FF-14 requires to be
 * distinct. No byte, nesting, or node threshold appears anywhere (FF-14).
 */
export type ParseFailureReason = "invalid-utf8" | "malformed-json" | "byte-order-mark";

/**
 * A context that carries no field at all. Not `{}`: an index signature of `never` rejects every
 * extra property, so a kind with no declared context cannot be given one.
 */
export type EmptyPipelineSafeContext = Readonly<Record<string, never>>;

/** One JSON Pointer (RFC 6901) into the document that failed; the root pointer is the empty string. */
export type DocumentPointer = string;

/**
 * The fixed safe context of each pipeline error kind. Every field is a closed enumeration, an
 * integer, or a JSON Pointer made of schema property names and array indices, which is what lets a
 * Section 16 category name what it must — "file and supported version range", "file and safe JSON
 * path details", "family and version transition", "logical file and failed reference without health
 * values" — while no field can hold document text, a note, a measurement, a token, a session ID, an
 * account key, a Drive file ID, or the input document itself
 * (docs/ARCHITECTURE.md Section 15; docs/REQUIREMENTS.md 12.12). A reference is named by its pointer,
 * never by the identifier value it holds, because a result document pointer can otherwise reach a
 * session identity. The type system is the boundary: `makePipelineError` accepts only the shape
 * declared for the chosen kind and supplies every other field from `PIPELINE_ERROR_DESCRIPTORS`.
 */
export interface PipelineSafeContextByKind {
  "parse-failed": { readonly reason: ParseFailureReason };
  /** Section 12 stage 2 reads `format` and `schemaVersion` from a plain object; a root that is an
   * array, a primitive, or `null` is not one. FF-10 and the Phase 13 array edge case. */
  "envelope-not-object": EmptyPipelineSafeContext;
  /** FF-10 "Missing". A `format` that exists only on the prototype chain is absent, so it is this
   * same kind: src/domain/families.ts rejects an inherited `format` as missing and never infers a
   * value from shape. A present non-string `format` is this kind too, not an unknown family. */
  "envelope-missing-format": EmptyPipelineSafeContext;
  /** R-10: an unrecognized `format` is not a family mismatch. The value itself is document text, so
   * it is named by kind and never echoed. */
  "envelope-unknown-format": EmptyPipelineSafeContext;
  /** R-10: a recognized `format` for a different family than the caller expected (FF-10
   * "wrong-family"). Both values come from the closed family set, so no document text appears. */
  "envelope-wrong-family": {
    readonly family: DocumentFamily;
    readonly expectedFamily: DocumentFamily;
  };
  /** FF-10 "absent (inherited)" plus a plain absence: no own `schemaVersion` property. Kept separate
   * from every malformed-version kind by the Phase 11 edge case "Keep missing version separate from
   * malformed version". */
  "envelope-missing-version": EmptyPipelineSafeContext;
  /** FF-09 negative case `"1"`: `schemaVersion` exists, is an own property, and is not a number. */
  "envelope-non-number-version": EmptyPipelineSafeContext;
  /** FF-09 negative case `1.5`: a number that is not a whole number. */
  "envelope-non-integer-version": EmptyPipelineSafeContext;
  /** FF-09 negative cases `0` and `-1`: a whole number that is not positive. */
  "envelope-non-positive-version": EmptyPipelineSafeContext;
  /** FF-10 "unsupported-old". Section 16 "Unsupported schema: Name file and supported version
   * range"; FF-20 "Unsupported-old data reports the support floor and is never overwritten". */
  "envelope-unsupported-old-version": {
    readonly schemaVersion: number;
    readonly supportFloor: number;
  };
  /** FF-10 "future". Version handling: "Future version | Do not edit or overwrite it. Report that
   * newer code is required"; the two integers name the range that requirement comes from. */
  "envelope-future-version": {
    readonly schemaVersion: number;
    readonly currentSchemaVersion: number;
  };
  /** Section 12 stage 3: "Stop before migration and report JSON Pointer paths." */
  "declared-schema-invalid": { readonly paths: readonly DocumentPointer[] };
  /** Section 12 stage 4 and Section 16 "Migration: Name family and version transition". The failing
   * migration's own detail stays out of the pipeline error: FF-18 gives it a precise diagnostic, and
   * this layer records only the closed-enum family and the two integers. */
  "migration-failed": {
    readonly family: DocumentFamily;
    readonly fromSchemaVersion: number;
    readonly toSchemaVersion: number;
  };
  /** Section 12 stage 5: "Validate every intermediate output and the final current document." */
  "post-migration-schema-invalid": { readonly paths: readonly DocumentPointer[] };
  /** Section 12 stage 6 and Section 16 "Semantic reference: Name logical file and failed reference
   * without health values". The logical file is `PipelineError.logicalName`. */
  "semantic-invalid": { readonly paths: readonly DocumentPointer[] };
}

/**
 * Every pipeline error kind: one stable, enumerable string per Section 12 stage and per distinct
 * rejection condition that FF-09, FF-10, or the Phase 11 edge cases require to stay separate. A
 * caller branches on these values and never parses a message
 * (docs/implementation/phase-11.md acceptance).
 *
 * The seven names in the Phase 11 step list map here as follows: parse -> `parse-failed`;
 * envelope -> `envelope-not-object`, `envelope-missing-format`, `envelope-unknown-format`,
 * `envelope-missing-version`, and the three malformed-version kinds; unsupported-old ->
 * `envelope-unsupported-old-version`; future -> `envelope-future-version`; schema ->
 * `declared-schema-invalid` and `post-migration-schema-invalid`; migration -> `migration-failed`;
 * semantic -> `semantic-invalid`.
 */
export type PipelineErrorKind = keyof PipelineSafeContextByKind;

const PIPELINE_ERROR_KIND_LIST = [
  "parse-failed",
  "envelope-not-object",
  "envelope-missing-format",
  "envelope-unknown-format",
  "envelope-wrong-family",
  "envelope-missing-version",
  "envelope-non-number-version",
  "envelope-non-integer-version",
  "envelope-non-positive-version",
  "envelope-unsupported-old-version",
  "envelope-future-version",
  "declared-schema-invalid",
  "migration-failed",
  "post-migration-schema-invalid",
  "semantic-invalid"
] as const satisfies readonly PipelineErrorKind[];

/** Compile-time coverage guard: the list and `keyof PipelineSafeContextByKind` must agree exactly. */
type PipelineErrorKindListCoverage = AssertNever<
  Exclude<(typeof PIPELINE_ERROR_KIND_LIST)[number], PipelineErrorKind> | Exclude<PipelineErrorKind, (typeof PIPELINE_ERROR_KIND_LIST)[number]>
>;

/** The pipeline error kinds as one stable, ordered, enumerable value. */
export const PIPELINE_ERROR_KINDS: readonly PipelineErrorKind[] = PIPELINE_ERROR_KIND_LIST;

// ---------------------------------------------------------------------------
// One fixed descriptor per kind
// ---------------------------------------------------------------------------

/** The shape every descriptor row must fill in. */
interface PipelineErrorDescriptorShape {
  readonly stage: PipelineStage;
  readonly userCategory: PipelineUserCategory;
  readonly retryable: boolean;
  readonly safeMessage: string;
}

/**
 * The one source of truth for stage, user-facing category, retryability, and safe message per kind.
 * `as const` keeps every field at its literal type, so `PipelineErrorFor<K>` forces a caller to carry
 * exactly these values: no caller can supply its own message, stage, or category, which is what makes
 * "safe messages fixed per code" a type fact rather than a convention
 * (docs/implementation/phase-11.md edge case "Never include raw notes or content in safe messages").
 *
 * `retryable` is `false` for every kind because the recovery column of each of the four named
 * Section 16 category rows is an action outside the client — "Upgrade REP JOT or export raw file;
 * never edit or overwrite", "Keep valid cache, download raw bytes, repair externally", "Keep source
 * unchanged; use export and later software fix", "update compatible app or repair static release".
 * Repeating a load that failed for one of these reasons cannot change the outcome, and FF-20 requires
 * the rejected bytes to stay untouched.
 */
export const PIPELINE_ERROR_DESCRIPTORS = {
  "parse-failed": {
    stage: "parse",
    userCategory: "invalid_document",
    retryable: false,
    safeMessage: "the document bytes could not be read as UTF-8 JSON"
  },
  "envelope-not-object": {
    stage: "envelope",
    userCategory: "invalid_document",
    retryable: false,
    safeMessage: "the document root is not a JSON object"
  },
  "envelope-missing-format": {
    stage: "envelope",
    userCategory: "invalid_document",
    retryable: false,
    safeMessage: "the document declares no own format"
  },
  "envelope-unknown-format": {
    stage: "envelope",
    userCategory: "invalid_document",
    retryable: false,
    safeMessage: "the document format is not a known REP JOT family"
  },
  "envelope-wrong-family": {
    stage: "envelope",
    userCategory: "invalid_document",
    retryable: false,
    safeMessage: "the document format belongs to a different family than its filename"
  },
  "envelope-missing-version": {
    stage: "envelope",
    userCategory: "invalid_document",
    retryable: false,
    safeMessage: "the document declares no own schemaVersion"
  },
  "envelope-non-number-version": {
    stage: "envelope",
    userCategory: "invalid_document",
    retryable: false,
    safeMessage: "schemaVersion is not a number"
  },
  "envelope-non-integer-version": {
    stage: "envelope",
    userCategory: "invalid_document",
    retryable: false,
    safeMessage: "schemaVersion is not a whole number"
  },
  "envelope-non-positive-version": {
    stage: "envelope",
    userCategory: "invalid_document",
    retryable: false,
    safeMessage: "schemaVersion is not a positive integer"
  },
  "envelope-unsupported-old-version": {
    stage: "envelope",
    userCategory: "unsupported_schema",
    retryable: false,
    safeMessage: "the document schemaVersion is older than the supported range"
  },
  "envelope-future-version": {
    stage: "envelope",
    userCategory: "unsupported_schema",
    retryable: false,
    safeMessage: "the document schemaVersion requires a newer version of REP JOT"
  },
  "declared-schema-invalid": {
    stage: "declared-schema",
    userCategory: "invalid_document",
    retryable: false,
    safeMessage: "the document does not match its declared schema"
  },
  "migration-failed": {
    stage: "migration",
    userCategory: "migration",
    retryable: false,
    safeMessage: "the migration for this document family failed"
  },
  "post-migration-schema-invalid": {
    stage: "post-migration-schema",
    userCategory: "invalid_document",
    retryable: false,
    safeMessage: "the migrated document does not match the current schema"
  },
  "semantic-invalid": {
    stage: "semantic",
    userCategory: "semantic_reference",
    retryable: false,
    safeMessage: "the document fails cross-file semantic validation"
  }
} as const satisfies Record<PipelineErrorKind, PipelineErrorDescriptorShape>;

/** The literal descriptor row of one kind. */
export type PipelineErrorDescriptorFor<K extends PipelineErrorKind> = (typeof PIPELINE_ERROR_DESCRIPTORS)[K];

// ---------------------------------------------------------------------------
// Error and result
// ---------------------------------------------------------------------------

/**
 * One rejected pipeline outcome. `kind` is the discriminant a caller branches on; stage, category,
 * retryability, and message are fixed per kind by `PIPELINE_ERROR_DESCRIPTORS`, and `safeContext` is
 * the declared shape for that one kind. The error never carries the input document, its bytes, its
 * parsed value, or any value read from it.
 */
export type PipelineErrorFor<K extends PipelineErrorKind> = PipelineErrorDescriptorFor<K> & {
  readonly kind: K;
  /** Canonical logical filename of the affected logical document (FF-06, Section 16 `logicalName?`). */
  readonly logicalName: string;
  readonly safeContext: PipelineSafeContextByKind[K];
};

/** One rejected pipeline outcome, for any kind. */
export type PipelineError = { [K in PipelineErrorKind]: PipelineErrorFor<K> }[PipelineErrorKind];

/** What a caller supplies to build one pipeline error: the three fields that are not fixed per code. */
export interface PipelineErrorInput<K extends PipelineErrorKind> {
  readonly kind: K;
  readonly logicalName: string;
  readonly safeContext: PipelineSafeContextByKind[K];
}

/**
 * Detach one declared safe context from the object the caller keeps. The shapes in
 * `PipelineSafeContextByKind` are flat records whose values are closed names, integers, or one array of
 * JSON Pointers, so copying the record and copying and freezing each array field reaches every declared
 * field and no declared shape nests deeper. A general deep copy or a runtime shape check would be a
 * second contract on top of the declared per-kind shape, which this phase fixes as the boundary.
 *
 * TypeScript cannot name "a copy of `PipelineSafeContextByKind[K]`", so the copy is assembled as a
 * record and handed back under the caller's own context type: the one cast below changes no value.
 */
function detachSafeContext<C extends object>(context: C): C {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(context)) {
    const value: unknown = (context as Record<string, unknown>)[key];
    copy[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
  }
  return Object.freeze(copy) as C;
}

/**
 * Build one pipeline error from a kind, one canonical logical filename, and that kind's declared safe
 * context. Stage, user-facing category, retryability, and safe message come only from
 * `PIPELINE_ERROR_DESCRIPTORS`, never from the caller, and the returned record is read-only and frozen,
 * so no caller can widen the message, add a field, or attach a value after the fact. The declared safe
 * context is taken as given — the declared shape per kind, not a runtime filter, is the boundary that
 * keeps document content out of it — but it is detached at construction by `detachSafeContext`: the
 * error holds its own frozen copy of the record and of every array in it, so a caller that keeps the
 * context object or a `paths` array cannot add or change a field on a completed error.
 */
export function makePipelineError<K extends PipelineErrorKind>(input: PipelineErrorInput<K>): PipelineErrorFor<K> {
  const built: PipelineErrorFor<K> = {
    ...PIPELINE_ERROR_DESCRIPTORS[input.kind],
    kind: input.kind,
    logicalName: input.logicalName,
    safeContext: detachSafeContext(input.safeContext)
  };
  // Frozen for the runtime effect alone: `Object.freeze` returns the same object it was given, and
  // annotating the call is what loses the literal field types that `PipelineErrorFor<K>` fixes per
  // kind. The annotation on `built` above is the checked contract. The safe context is already frozen
  // by `detachSafeContext`, so `built` and everything it can reach is immutable.
  Object.freeze(built);
  return built;
}

// ---------------------------------------------------------------------------
// Provenance (docs/ARCHITECTURE.md Section 8, FF-14, FF-20)
// ---------------------------------------------------------------------------

/** Where the exact source bytes came from. R-01: it names the source document, separately from its
 * canonical filename (R-03) and from the bytes themselves (R-04). */
export type SourceIdentity =
  /** A file shipped in the static bundle: `exercises.json` or `workouts.json` (FF-01, FF-02). */
  | { readonly kind: "static-bundle" }
  /** One file in the account's Drive `appDataFolder`, identified by its Drive file ID. The ID is a
   * source identity, never a logical name: FF-06 keeps `preferences.json` and
   * `results-YYYY-MM.json` as the only recognized canonical names. */
  | { readonly kind: "drive-app-data-folder"; readonly driveFileId: string };

/**
 * The identity of one digest over the exact source bytes. Phase 16 owns the injected digest service
 * and names the algorithm; this phase fixes only the two-field identity, because FF-14 requires the
 * exact bytes to survive and Phase 16 records that "two byte encodings of equivalent JSON can have
 * different source digests".
 */
export interface SourceDigest {
  readonly algorithm: string;
  readonly value: string;
}

/**
 * Identifier of the schema set and validator build that accepted a document
 * (docs/ARCHITECTURE.md Section 8 "validation version"). Supplied by the caller-side schema registry
 * in later phases; no registry, validator, or version constant is defined here.
 */
export type ValidationVersion = string;

/**
 * Stable identifier of one registered `vN -> vN+1` migration step (Phase 14 owns the registries and
 * their identifiers; docs/implementation/phase-16.md records them in provenance).
 */
export type MigrationStepId = string;

/**
 * The path one document travelled from its declared version to the current version. Section 12 stage
 * 4 applies pure `vN -> vN+1` functions and specs/schema-versioning.md forbids "a matrix of direct
 * conversions to the current version", so the applied steps are recorded in order and a zero-step list
 * is the current-version case. These two integers are the "source schema version" and "current schema
 * version" of the Section 8 provenance list, recorded once.
 */
export interface MigrationPath {
  readonly declaredSchemaVersion: number;
  readonly currentSchemaVersion: number;
  readonly steps: readonly MigrationStepId[];
}

/**
 * The one provenance record that lets a cache prove which bytes and which version produced a model
 * (docs/implementation/phase-11.md mission; docs/ARCHITECTURE.md Section 8; FF-20 "Last valid cache +
 * raw remote bytes preserved for download"). The retained source and the disposable model stay
 * separate: `sourceBytes` is the exact original bytes, BOM included, that cache, recovery, and export
 * must preserve (FF-14), and normalization never implies write-back
 * (docs/implementation/phase-16.md acceptance).
 */
export interface DocumentProvenance {
  /** R-01: which source produced the bytes. */
  readonly source: SourceIdentity;
  /** R-03: the canonical logical filename, never a Drive file ID (FF-06). */
  readonly logicalName: string;
  /** The recognized family of the document, from its own `format` (FF-09, FF-10). */
  readonly sourceFamily: DocumentFamily;
  /** R-04: the exact retained source bytes, unchanged and including any byte-order mark (FF-14). */
  readonly sourceBytes: Uint8Array;
  /** R-04: digest identity of those exact bytes, computed by the Phase 16 injected service. */
  readonly sourceDigest: SourceDigest;
  /** R-05: declared version, current version, and the ordered applied steps. */
  readonly migrationPath: MigrationPath;
  /** R-06: the validation build that accepted the document. */
  readonly validationVersion: ValidationVersion;
}

/**
 * What a caller declares before the pipeline reads anything. `expectedFamily` is the input FF-10
 * checks the document's own `format` against (R-02), and `logicalName` is the canonical filename
 * FF-06 recognized (R-03). `bytes` are the exact source bytes the pipeline must retain unchanged
 * (FF-14); no digest appears here because Phase 16 owns the digest service that computes it.
 */
export interface PipelineRequest {
  readonly expectedFamily: DocumentFamily;
  readonly logicalName: string;
  readonly source: SourceIdentity;
  readonly bytes: Uint8Array;
}

/**
 * The result of one pipeline run. A success names the Section 12 stage it reached — always
 * `"semantic"`, the last load stage in the Section 12 table, since Phase 15 fixes the trace as
 * "parse, recognize, historical schema, migration, next schema, final semantic, normalize" and
 * normalization adds no stage of its own — and keeps the disposable model in a field apart from the
 * provenance record, so a caller can retain raw bytes and use a current model at the same time (R-07).
 * A rejection names its stage through `error.stage`, so no second stage value exists to drift.
 */
export type PipelineResult<TModel> =
  | {
      readonly status: "loaded";
      readonly stage: PipelineStage;
      readonly provenance: DocumentProvenance;
      readonly model: TModel;
    }
  | { readonly status: "rejected"; readonly error: PipelineError };
