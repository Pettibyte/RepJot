/**
 * Migration registry: one ordered, pure, per-family `vN -> vN+1` chain plus that family's version
 * bounds (P14-T01).
 *
 * Authority: docs/implementation/phase-14.md (task P14-T01, objective "Represent support floors and
 * ordered transitions without fake legacy migrations", steps "Register current v1 schemas for each
 * family. Require every real step to accept exactly version N and return N+1. Detect gaps, duplicate
 * steps, wrong outputs, unsupported-old inputs, and future inputs", edge cases "A current v1 input uses
 * zero transitions. Version 0 is malformed, not legacy. Do not add a no-op `v0 -> v1` migration",
 * acceptance "Production registries contain no invented migration. Synthetic chains prove strict
 * N-to-N+1 behavior"), specs/schema-versioning.md (§Migration chains "Maintain one current-version
 * constant, schema set, and migration registry for each family" and "A migration registered for version
 * 2 accepts only version 2 and produces version 3" and "Do not create a matrix of direct conversions to
 * the current version", §Read and migration policy, §Result migrations and references, §Versioned
 * schemas, §Version handling, §Tests, §Failure and recovery), docs/ARCHITECTURE.md §7 row
 * `src/migrations/migration-registry.ts` ("Apply ordered, pure, family-specific migrations"; may depend
 * on "Historical schemas and pure migrations"), §8 ("Provenance includes source family, source schema
 * version, current schema version, validation version, and migration path"), §12 row "Ordered
 * migration" ("Apply pure `vN -> vN+1` functions with read-only validated context" / "Report migration
 * context and preserve source unchanged. Never guess identity") and its purity line ("Migrations have
 * no access to the DOM, clock, locale, random APIs, Drive, or IndexedDB"), and
 * docs/contracts/families-and-files.md FF-07, FF-08, FF-10, FF-15, FF-16, FF-18, FF-19, FF-20.
 *
 * What this module owns. One registry per family, holding that family's current version, that family's
 * support floor, that family's supported schema-version set, and that family's ordered steps; and the
 * one walk that applies those steps to one document. Each family's registry is constructed in its own
 * file under src/migrations/families/, so no step list is shared and a step of one family cannot be
 * reached through another family's registry (FF-07 negative case "One family's version selecting another
 * family's migration").
 *
 * What this module does not own, and therefore does not contain. No validation of any kind:
 * docs/ARCHITECTURE.md §12 gives stage 3 "Historical schema validation" and stage 5 "Post-migration
 * validation" to the pipeline, and docs/implementation/phase-15.md names them as its own steps, so this
 * module imports neither src/validation/schema-registry.ts nor src/validation/schema-validator.ts and
 * holds no `$id`, no schema document, and no compiled validator (FF-15 keeps one machine-readable schema
 * per supported version in the schema registry, which is the only validator). No pipeline error:
 * src/documents/pipeline-types.ts fixes the closed `PipelineErrorKind` set and Phase 15 is the stage that
 * maps a migration outcome to `migration-failed`, `envelope-unsupported-old-version`, or
 * `envelope-future-version`, so this module returns a plain typed outcome and imports no
 * src/documents/** module (import direction stays one way, docs/implementation/GATES.md §3 "Inspect the
 * complete diff and its import direction"). No `MigrationPath`, `DocumentProvenance`, normalizer,
 * digest, static loader, context construction, cross-family ordering, cache, or `fetch` (Phases 16, 17,
 * 18, 19 own those); FF-19 gives the ordering of the read-only migration context to "Document pipeline".
 *
 * Zero production steps. All four families are at v1 with floor v1 in the accepted
 * `CURRENT_VERSION` and `SUPPORT_FLOOR_VERSION`, so no real transition exists to register today and
 * none is invented (docs/implementation/phase-14.md edge case quoted above; docs/implementation/GATES.md
 * §3 "Confirm that no real `v0` or speculative legacy migration was invented"). The four family files
 * therefore register empty chains, and every multi-version behaviour below — multi-step, gap, duplicate,
 * wrong output, unsupported-old, future — is exercised by a registry a test constructs. Because the
 * accepted constants cannot express a family whose current version is above its floor, the spec takes the
 * version bounds as a value and `acceptedVersionRange` is the one place that reads the accepted
 * constants. That seam exists for the synthetic chains this phase is told to build
 * (docs/implementation/phase-14.md "Use synthetic test-only registries to exercise multi-step sequencing
 * and registry failures"); production callers reach the same builder through `acceptedVersionRange` and
 * cannot supply bounds of their own, and tests/migration-registry.test.ts proves the four production
 * registries carry exactly the accepted constants' values.
 *
 * Version facts, read once. `schemaVersion` is read from a document exactly the way the accepted
 * `recognizeEnvelope` reads it, as one own property, and it is never inferred from shape
 * (FF-10 "The loader never infers either value from shape"): a non-object root and an object with no own
 * `schemaVersion` are the same `missing-version` condition, and the four malformed conditions stay
 * separate because src/documents/pipeline-types.ts keeps them separate
 * (`envelope-missing-version`, `envelope-non-number-version`, `envelope-non-integer-version`,
 * `envelope-non-positive-version`). `format` is never read, family agreement is never checked, and no
 * document shape is inspected, so this module is not a second envelope matcher.
 *
 * Purity. Nothing here performs I/O or holds state: no `node:` module, network, DOM, Svelte, IndexedDB,
 * Drive, clock, locale, randomness, or entropy source is imported or used, and no value is written,
 * frozen, deleted, or replaced on the caller's document, on the caller's step list, or on the caller's
 * context (FF-18 "produce a new object (input unchanged)"; specs/schema-versioning.md "Avoid Drive,
 * IndexedDB, network, DOM, UI, time, random, and locale operations"). The caller's document comes back
 * unchanged on every path, and the zero-step current-version path returns that same reference because
 * specs/schema-versioning.md §Version handling asks only that "Current version | Validate it without
 * migration". A step is never invoked for a version other than its declared one, and no step's exception
 * escapes: the accepted parse stage maps every engine failure into a typed outcome rather than an
 * exception, and a step is a caller-supplied value in the same sense, so one step application is bounded
 * end to end — the call and every read of the value it returned. Only ES2019 syntax appears.
 */

import { CURRENT_VERSION, SUPPORT_FLOOR_VERSION } from "../domain/families";
import type { DocumentFamily } from "../domain/families";

// ---------------------------------------------------------------------------
// Step identity and migration context
// ---------------------------------------------------------------------------

/**
 * Stable identifier of one registered `vN -> vN+1` migration step. It is structurally the accepted
 * `MigrationStepId` of src/documents/pipeline-types.ts, which is `string`; that module is re-imported
 * here under no form, because docs/implementation/GATES.md §3 and docs/ARCHITECTURE.md §7 keep the
 * migration module's dependency list at "Historical schemas and pure migrations" and the pipeline is the
 * importer, not the imported. tests/migration-registry.test.ts carries the applied identifier list into
 * an accepted `MigrationPath`, which is what proves the two names stay one type.
 */
export type MigrationStepId = string;

/**
 * The read-only migration context, opaque here and supplied by the caller. FF-19 fixes what may enter it
 * ("only current, validated static references enter the read-only migration context") and gives that
 * duty to "Document pipeline"; Phase 17 loads the static families. Naming a shape here would invent that
 * contract early, so the registry only carries the value through to each step, unchanged and in
 * application order, and never builds one.
 */
export type MigrationContext = unknown;

// ---------------------------------------------------------------------------
// One migration step
// ---------------------------------------------------------------------------

/**
 * What one step receives: the document to convert, the one version the registry is converting it from
 * (always equal to the step's own `fromSchemaVersion`, never another version), and the caller's context.
 * The step's output version is not offered, because "Return exactly the next version"
 * (specs/schema-versioning.md) fixes it as input plus one.
 */
export interface FamilyMigrationStepInput<TContext = MigrationContext> {
  readonly document: unknown;
  readonly schemaVersion: number;
  readonly context: TContext;
}

/**
 * What one step returns. A step that cannot derive a required value reports it with a precise detail
 * rather than throwing (FF-18 "fail with a precise diagnostic when a value cannot be derived";
 * specs/schema-versioning.md "If a reference is missing or ambiguous, the migration must identify the
 * shard, session, workout, and node, then fail."). `detail` belongs to the step: it is never logged and
 * never carried into a pipeline error, whose `migration-failed` context is fixed by
 * src/documents/pipeline-types.ts at family and the two versions.
 */
export type FamilyMigrationStepResult =
  | { readonly status: "migrated"; readonly document: unknown }
  | { readonly status: "failed"; readonly detail: string };

/**
 * One ordered transition of one family. `fromSchemaVersion` is the single version the step accepts and
 * `toSchemaVersion` is the single version it must produce; the builder rejects a step whose two versions
 * are not `N` and `N+1`, and the walk rejects an output that does not carry `N+1`. A step is a value in
 * exactly one family's registry, which is what makes FF-07's cross-family negative case unreachable
 * rather than merely unlikely.
 */
export interface FamilyMigrationStep<TContext = MigrationContext> {
  readonly id: MigrationStepId;
  readonly fromSchemaVersion: number;
  readonly toSchemaVersion: number;
  readonly migrate: (input: FamilyMigrationStepInput<TContext>) => FamilyMigrationStepResult;
}

// ---------------------------------------------------------------------------
// The version bounds of one family
// ---------------------------------------------------------------------------

/**
 * The two bounds a registry enforces for one family. Both are integers from the accepted per-family
 * constants on every production path.
 */
export interface FamilyVersionRange {
  readonly supportFloorSchemaVersion: number;
  readonly currentSchemaVersion: number;
}

/**
 * The accepted version bounds of one family, read from `CURRENT_VERSION` and `SUPPORT_FLOOR_VERSION` in
 * src/domain/families.ts. This is the only read of those two constants inside src/migrations/**, so no
 * family file and no registry re-declares a version (FF-07 "Each family owns an independent,
 * monotonically increasing version sequence").
 */
export function acceptedVersionRange(family: DocumentFamily): FamilyVersionRange {
  return Object.freeze({
    supportFloorSchemaVersion: SUPPORT_FLOOR_VERSION[family],
    currentSchemaVersion: CURRENT_VERSION[family]
  });
}

// ---------------------------------------------------------------------------
// Outcomes: one successful migration, or one typed failure
// ---------------------------------------------------------------------------

/**
 * The four malformed-version conditions, kept distinct from one another and from unsupported-old and
 * future (FF-09 negative case "`0`, `-1`, `1.5`, `\"1\"` rejected with distinct errors";
 * docs/implementation/phase-11.md edge case "Keep missing version separate from malformed version").
 */
export type MalformedVersionReason =
  | "missing-version"
  | "non-number-version"
  | "non-integer-version"
  | "non-positive-version";

/**
 * Every failure of one migration, one arm per condition the contract keeps separate.
 *
 * `unsupported-old-version` carries the floor and `future-version` carries the current version, which is
 * what FF-20 and §Version handling require a caller to report ("Unsupported older version | Report the
 * support floor and do not overwrite it", "Future version | Do not edit or overwrite it. Report that
 * newer code is required"). `chain-gap` names the one boundary version that has no step, the reason
 * specs/schema-versioning.md forbids "a matrix of direct conversions to the current version": a missing
 * step stops the walk instead of being skipped. The four step arms name the step and its two versions,
 * because §12 requires a migration failure to report its context, and none of them carries a document.
 */
export type MigrationFailure =
  | { readonly reason: MalformedVersionReason }
  | {
      readonly reason: "unsupported-old-version";
      readonly schemaVersion: number;
      readonly supportFloorSchemaVersion: number;
    }
  | {
      readonly reason: "future-version";
      readonly schemaVersion: number;
      readonly currentSchemaVersion: number;
    }
  | {
      readonly reason: "chain-gap";
      readonly family: DocumentFamily;
      readonly schemaVersion: number;
      readonly supportFloorSchemaVersion: number;
      readonly currentSchemaVersion: number;
    }
  | {
      readonly reason: "step-reported-failure";
      readonly stepId: MigrationStepId;
      readonly fromSchemaVersion: number;
      readonly toSchemaVersion: number;
      readonly detail: string;
    }
  | {
      readonly reason: "step-result-invalid";
      readonly stepId: MigrationStepId;
      readonly fromSchemaVersion: number;
      readonly toSchemaVersion: number;
    }
  | {
      readonly reason: "step-output-unchanged";
      readonly stepId: MigrationStepId;
      readonly fromSchemaVersion: number;
      readonly toSchemaVersion: number;
    }
  | {
      readonly reason: "step-output-wrong-version";
      readonly stepId: MigrationStepId;
      readonly fromSchemaVersion: number;
      readonly toSchemaVersion: number;
      readonly expectedSchemaVersion: number;
      /** The version the step actually produced, or null when its output carries no usable own value. */
      readonly actualSchemaVersion: number | null;
    }
  | {
      readonly reason: "step-threw";
      readonly stepId: MigrationStepId;
      readonly fromSchemaVersion: number;
      readonly toSchemaVersion: number;
    };

/**
 * One migration outcome. Success names the document at the current version, the declared version it
 * started from, that current version, and the applied step identifiers in application order — exactly the
 * three values `MigrationPath` records in provenance for Phase 16, with the document kept beside them
 * rather than inside that record. The zero-step current-version case names an empty list
 * (docs/implementation/phase-14.md edge case "A current v1 input uses zero transitions").
 *
 * Failure carries no document: an unsupported-old, future, malformed, gap, or failed-step result cannot
 * hand a caller a half-migrated value to mistake for a migrated one (FF-20 "future data is never edited
 * or overwritten"; specs/schema-versioning.md §Failure and recovery "Migration failure never modifies a
 * Drive document").
 */
export type FamilyMigrationResult =
  | {
      readonly status: "migrated";
      readonly document: unknown;
      readonly declaredSchemaVersion: number;
      readonly currentSchemaVersion: number;
      readonly appliedStepIds: readonly MigrationStepId[];
    }
  | { readonly status: "failed"; readonly failure: MigrationFailure };

// ---------------------------------------------------------------------------
// Registry, request, and build outcome
// ---------------------------------------------------------------------------

/** The one document and one context handed to one family's registry. */
export interface FamilyMigrationRequest<TContext = MigrationContext> {
  readonly document: unknown;
  readonly context: TContext;
}

/**
 * One family's registry. The four version fields are that family's own: `supportedSchemaVersions` is the
 * contiguous set the family accepts today, derived from the two bounds rather than declared a second
 * time, and is the list a pipeline stage needs in order to pick the matching historical schema
 * (FF-15, FF-16). `steps` is the family's chain in version order as a frozen copy, so a later change to
 * the caller's array cannot change a built registry.
 */
export interface FamilyMigrationRegistry<TContext = MigrationContext> {
  readonly family: DocumentFamily;
  readonly supportFloorSchemaVersion: number;
  readonly currentSchemaVersion: number;
  readonly supportedSchemaVersions: readonly number[];
  readonly steps: readonly FamilyMigrationStep<TContext>[];
  /** Apply this family's chain to one document. Never throws, never mutates, never reaches another family. */
  migrate(request: FamilyMigrationRequest<TContext>): FamilyMigrationResult;
}

/** What one caller declares when it builds a registry. */
export interface FamilyMigrationRegistrySpec<TContext = MigrationContext> {
  readonly family: DocumentFamily;
  readonly range: FamilyVersionRange;
  readonly steps: readonly FamilyMigrationStep<TContext>[];
}

/**
 * Every reason a registry can be refused. `step-version-not-sequential` is the registration half of
 * strict `vN -> vN+1` (FF-18 "accept exactly one input version, return exactly the next"): it refuses a step
 * whose two declared versions are not `N` and `N+1`, and now also one whose boundaries are not positive whole
 * versions, because a boundary of `0`, a negative one, or a fractional one is not a schema version at all and
 * so can never be the single version a migration accepts (FF-09 "`schemaVersion` is a positive integer"). That
 * arm already names the step and carries both boundaries verbatim, which is all a caller needs to find the
 * mis-declared pair, so no second build reason exists for it. `duplicate-step-version` is the reason two steps can never both run for one input version and can
 * never be resolved by a silent choice between them. `invalid-step` refuses an entry that is not a step
 * or carries no usable identifier, which is what keeps every applied step nameable in provenance (R-13:
 * Phase 16 records these identifiers in `MigrationPath.steps`); no contract requires identifiers to be
 * unique across steps, so no uniqueness rule exists here.
 */
export type RegistryBuildFailure =
  | {
      readonly reason: "invalid-version-range";
      readonly supportFloorSchemaVersion: number;
      readonly currentSchemaVersion: number;
    }
  | { readonly reason: "invalid-step"; readonly stepIndex: number }
  | {
      readonly reason: "step-version-not-sequential";
      readonly stepId: MigrationStepId;
      readonly fromSchemaVersion: number;
      readonly toSchemaVersion: number;
    }
  | {
      readonly reason: "duplicate-step-version";
      readonly schemaVersion: number;
      readonly firstStepId: MigrationStepId;
      readonly duplicateStepId: MigrationStepId;
    };

/** A built registry, or the one reason it was refused. No registry exists in the refused case. */
export type FamilyRegistryBuild<TContext = MigrationContext> =
  | { readonly status: "created"; readonly registry: FamilyMigrationRegistry<TContext> }
  | { readonly status: "rejected"; readonly failure: RegistryBuildFailure };

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * The compile-time half of every switch here, as in the accepted envelope stage: the argument below is
 * `never` exactly while every arm is covered, so an arm added to one of these unions later turns into a
 * type error rather than a silent fall-through. No call can reach it, and it raises nothing.
 */
function assertNoUncoveredArm(uncovered: never): never {
  return uncovered;
}

/** The four malformed-version kinds, as the reader below reports them. */
type MalformedVersionKind = "missing" | "non-number" | "non-integer" | "non-positive";

/** A document's own `schemaVersion`, or the one reason it is unusable. */
type DeclaredVersion =
  | { readonly kind: "present"; readonly schemaVersion: number }
  | { readonly kind: MalformedVersionKind };

/**
 * Read one own `schemaVersion` and classify it, in the order §Version handling and FF-09 require: an
 * absent own property, then a non-number, then a non-integer, then a non-positive value. A root that is
 * not an object has no own property and is therefore `missing`; no shape ever supplies a version
 * (FF-10). A value that exists only on the prototype chain is absent, exactly as the accepted
 * `recognizeEnvelope` treats it, and `null` is a present non-number rather than a missing value.
 */
function readDeclaredSchemaVersion(value: unknown): DeclaredVersion {
  if (typeof value !== "object" || value === null) {
    return { kind: "missing" };
  }
  if (!Object.prototype.hasOwnProperty.call(value, "schemaVersion")) {
    return { kind: "missing" };
  }
  const declared = (value as Record<string, unknown>)["schemaVersion"];
  if (typeof declared !== "number") {
    return { kind: "non-number" };
  }
  if (!Number.isInteger(declared)) {
    return { kind: "non-integer" };
  }
  if (declared < 1) {
    return { kind: "non-positive" };
  }
  return { kind: "present", schemaVersion: declared };
}

/** The one failure arm of one malformed-version kind. */
function malformedVersionFailure(kind: MalformedVersionKind): MigrationFailure {
  switch (kind) {
    case "missing":
      return { reason: "missing-version" };
    case "non-number":
      return { reason: "non-number-version" };
    case "non-integer":
      return { reason: "non-integer-version" };
    case "non-positive":
      return { reason: "non-positive-version" };
    default:
      return assertNoUncoveredArm(kind);
  }
}

/** Wrap one failure. The failure record and its wrapper are frozen, so a caller cannot widen either. */
function migrationFailureResult(failure: MigrationFailure): FamilyMigrationResult {
  Object.freeze(failure);
  const built: FamilyMigrationResult = { status: "failed", failure: failure };
  Object.freeze(built);
  return built;
}

/** Wrap one success. The record and its applied-step list are frozen; the document is not touched. */
function migratedResult(
  document: unknown,
  declaredSchemaVersion: number,
  currentSchemaVersion: number,
  appliedStepIds: readonly MigrationStepId[]
): FamilyMigrationResult {
  const built: FamilyMigrationResult = {
    status: "migrated",
    document: document,
    declaredSchemaVersion: declaredSchemaVersion,
    currentSchemaVersion: currentSchemaVersion,
    appliedStepIds: Object.freeze(appliedStepIds.slice())
  };
  Object.freeze(built);
  return built;
}

/** The one step whose declared input version is `schemaVersion`, or null when the chain has no such step. */
function stepForVersion<TContext>(
  steps: readonly FamilyMigrationStep<TContext>[],
  schemaVersion: number
): FamilyMigrationStep<TContext> | null {
  for (let index = 0; index < steps.length; index += 1) {
    if (steps[index].fromSchemaVersion === schemaVersion) {
      return steps[index];
    }
  }
  return null;
}

/** One step application: the next document, or the one failure that stops the chain. */
type StepApplication =
  | { readonly kind: "applied"; readonly document: unknown }
  | { readonly kind: "failed"; readonly failure: MigrationFailure };

/**
 * Apply one step and validate what it returned, which is where strict `vN -> vN+1` is enforced at every
 * application.
 *
 * The step result must be one of the two declared arms, its migrated document must be a plain object,
 * must not be the very object the step was given (FF-18 "produce a new object (input unchanged)"), and
 * must carry an own `schemaVersion` of exactly `schemaVersion + 1`. Anything else is a failure that names
 * the step and both versions, so the walk never adopts an output whose version it cannot prove and never
 * runs a later step on top of one. A step that throws is reported the same way rather than escaping: the
 * registry's contract is an outcome, and the step is a caller-supplied value.
 *
 * One boundary covers the whole application. A malformed result is a caller-supplied value too, so the
 * reads of `status`, `detail`, and `document`, and of the produced document's own `schemaVersion`, happen
 * inside the same containment as the call: a raising accessor or a proxy behind one of them is reported as
 * that step having failed, exactly as an exception from the step itself is, because a value that cannot be
 * read is a value from which nothing can be derived (FF-18 "fail with a precise diagnostic when a value
 * cannot be derived"; docs/ARCHITECTURE.md §12 "Report migration context and preserve source unchanged").
 * No text of the raised value is carried into the outcome, and nothing is re-raised.
 */
function applyStep<TContext>(
  step: FamilyMigrationStep<TContext>,
  document: unknown,
  schemaVersion: number,
  context: TContext
): StepApplication {
  const fromSchemaVersion = schemaVersion;
  const toSchemaVersion = schemaVersion + 1;
  // Read once, outside the boundary below, so building a failure record never touches the step again.
  const stepId = step.id;

  try {
    const result: FamilyMigrationStepResult = step.migrate({
      document: document,
      schemaVersion: schemaVersion,
      context: context
    });

    if (typeof result !== "object" || result === null) {
      return {
        kind: "failed",
        failure: { reason: "step-result-invalid", stepId: stepId, fromSchemaVersion: fromSchemaVersion, toSchemaVersion: toSchemaVersion }
      };
    }

    const fields = result as Record<string, unknown>;
    const status = fields["status"];

    if (status === "failed") {
      const detail = fields["detail"];
      if (typeof detail !== "string") {
        return {
          kind: "failed",
          failure: { reason: "step-result-invalid", stepId: stepId, fromSchemaVersion: fromSchemaVersion, toSchemaVersion: toSchemaVersion }
        };
      }
      return {
        kind: "failed",
        failure: {
          reason: "step-reported-failure",
          stepId: stepId,
          fromSchemaVersion: fromSchemaVersion,
          toSchemaVersion: toSchemaVersion,
          detail: detail
        }
      };
    }

    if (status !== "migrated") {
      return {
        kind: "failed",
        failure: { reason: "step-result-invalid", stepId: stepId, fromSchemaVersion: fromSchemaVersion, toSchemaVersion: toSchemaVersion }
      };
    }

    const produced = fields["document"];
    if (produced === document) {
      return {
        kind: "failed",
        failure: { reason: "step-output-unchanged", stepId: stepId, fromSchemaVersion: fromSchemaVersion, toSchemaVersion: toSchemaVersion }
      };
    }
    if (typeof produced !== "object" || produced === null || Array.isArray(produced)) {
      return {
        kind: "failed",
        failure: { reason: "step-result-invalid", stepId: stepId, fromSchemaVersion: fromSchemaVersion, toSchemaVersion: toSchemaVersion }
      };
    }

    const producedVersion = readDeclaredSchemaVersion(produced);
    if (producedVersion.kind === "present" && producedVersion.schemaVersion === toSchemaVersion) {
      return { kind: "applied", document: produced };
    }
    return {
      kind: "failed",
      failure: {
        reason: "step-output-wrong-version",
        stepId: stepId,
        fromSchemaVersion: fromSchemaVersion,
        toSchemaVersion: toSchemaVersion,
        expectedSchemaVersion: toSchemaVersion,
        actualSchemaVersion: producedVersion.kind === "present" ? producedVersion.schemaVersion : null
      }
    };
  } catch {
    return {
      kind: "failed",
      failure: { reason: "step-threw", stepId: stepId, fromSchemaVersion: fromSchemaVersion, toSchemaVersion: toSchemaVersion }
    };
  }
}

/**
 * Walk one family's chain from one document's declared version to the current version.
 *
 * The order of decisions is the order of §Version handling: a malformed own version first, then a future
 * version, then a version below the floor, then the current version with zero steps, then one step per
 * version while the version rises by exactly one. A version above the current one is never compared with
 * the floor, because only the current version proves a document is newer than this build. The loop
 * advances `version` by one on each applied step and stops at `currentSchemaVersion`, so it terminates
 * without a counter and can never apply two steps for one version.
 */
function migrateDocument<TContext>(
  family: DocumentFamily,
  supportFloorSchemaVersion: number,
  currentSchemaVersion: number,
  steps: readonly FamilyMigrationStep<TContext>[],
  request: FamilyMigrationRequest<TContext>
): FamilyMigrationResult {
  const declared = readDeclaredSchemaVersion(request.document);
  if (declared.kind !== "present") {
    return migrationFailureResult(malformedVersionFailure(declared.kind));
  }

  const declaredSchemaVersion = declared.schemaVersion;

  if (declaredSchemaVersion > currentSchemaVersion) {
    return migrationFailureResult({
      reason: "future-version",
      schemaVersion: declaredSchemaVersion,
      currentSchemaVersion: currentSchemaVersion
    });
  }
  if (declaredSchemaVersion < supportFloorSchemaVersion) {
    return migrationFailureResult({
      reason: "unsupported-old-version",
      schemaVersion: declaredSchemaVersion,
      supportFloorSchemaVersion: supportFloorSchemaVersion
    });
  }
  if (declaredSchemaVersion === currentSchemaVersion) {
    return migratedResult(request.document, declaredSchemaVersion, currentSchemaVersion, []);
  }

  let document = request.document;
  const appliedStepIds: MigrationStepId[] = [];
  let version = declaredSchemaVersion;

  while (version < currentSchemaVersion) {
    const step = stepForVersion(steps, version);
    if (step === null) {
      return migrationFailureResult({
        reason: "chain-gap",
        family: family,
        schemaVersion: version,
        supportFloorSchemaVersion: supportFloorSchemaVersion,
        currentSchemaVersion: currentSchemaVersion
      });
    }

    const applied = applyStep(step, document, version, request.context);
    if (applied.kind === "failed") {
      return migrationFailureResult(applied.failure);
    }
    document = applied.document;
    appliedStepIds.push(step.id);
    version += 1;
  }

  return migratedResult(document, declaredSchemaVersion, currentSchemaVersion, appliedStepIds);
}

/** True for a whole positive version number. */
function isPositiveWholeVersion(value: number): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/**
 * Build one family's registry.
 *
 * Registration refuses a family whose bounds are not whole positive versions with the floor above the
 * current version, a step entry that is not a step or carries no usable identifier, a step whose two
 * boundaries are not positive whole versions standing at `N` and `N+1`, and a second step for one input
 * version. Each refusal is one frozen
 * outcome, checked in that order and then step by step in list order, so the reported reason for a
 * mis-authored spec is the same on every run. No exception is raised and no registry is returned by a
 * refused call.
 *
 * The chain gap of a spec whose steps skip a version is reported by `migrate`, not here, because the
 * version that has no step is a fact about the document being migrated: a chain that covers v2 onward is
 * sound for a v2 document and names the missing boundary for a v1 one. Nothing in the walk skips a step,
 * so a gap is fatal for the document that reaches it rather than skippable
 * (specs/schema-versioning.md "Do not create a matrix of direct conversions to the current version").
 */
export function createFamilyMigrationRegistry<TContext = MigrationContext>(
  spec: FamilyMigrationRegistrySpec<TContext>
): FamilyRegistryBuild<TContext> {
  const supportFloorSchemaVersion = spec.range.supportFloorSchemaVersion;
  const currentSchemaVersion = spec.range.currentSchemaVersion;

  if (
    !isPositiveWholeVersion(supportFloorSchemaVersion) ||
    !isPositiveWholeVersion(currentSchemaVersion) ||
    supportFloorSchemaVersion > currentSchemaVersion
  ) {
    const failure: RegistryBuildFailure = {
      reason: "invalid-version-range",
      supportFloorSchemaVersion: supportFloorSchemaVersion,
      currentSchemaVersion: currentSchemaVersion
    };
    Object.freeze(failure);
    return { status: "rejected", failure: failure };
  }

  // A frozen copy, so the caller keeps its own array and can neither extend a built registry nor freeze
  // or reorder it after the fact by writing to the array it handed in.
  const steps: readonly FamilyMigrationStep<TContext>[] = Object.freeze(spec.steps.slice());

  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    if (
      step === null ||
      typeof step !== "object" ||
      typeof step.id !== "string" ||
      step.id.trim().length === 0
    ) {
      const failure: RegistryBuildFailure = { reason: "invalid-step", stepIndex: index };
      Object.freeze(failure);
      return { status: "rejected", failure: failure };
    }
    // A boundary that is not a positive whole version is not a schema version at all, so sequentiality is
    // never reached for it: `0 -> 1`, `-1 -> 0`, and `1.5 -> 2.5` each satisfy `to === from + 1` while no
    // document can declare either of their boundaries (FF-09 "`schemaVersion` is a positive integer"), and a
    // registry that took `fromSchemaVersion: 0` would be a registry that takes the `v0 -> v1` step this phase
    // forbids (docs/implementation/phase-14.md "Version 0 is malformed, not legacy"; GATES §3 "Confirm that
    // no real `v0` or speculative legacy migration was invented"). One frozen outcome of the existing arm,
    // both boundaries reported verbatim, no exception, no document reached.
    if (
      !isPositiveWholeVersion(step.fromSchemaVersion) ||
      !isPositiveWholeVersion(step.toSchemaVersion) ||
      step.toSchemaVersion !== step.fromSchemaVersion + 1
    ) {
      const failure: RegistryBuildFailure = {
        reason: "step-version-not-sequential",
        stepId: step.id,
        fromSchemaVersion: step.fromSchemaVersion,
        toSchemaVersion: step.toSchemaVersion
      };
      Object.freeze(failure);
      return { status: "rejected", failure: failure };
    }
    for (let prior = 0; prior < index; prior += 1) {
      if (steps[prior].fromSchemaVersion === step.fromSchemaVersion) {
        const failure: RegistryBuildFailure = {
          reason: "duplicate-step-version",
          schemaVersion: step.fromSchemaVersion,
          firstStepId: steps[prior].id,
          duplicateStepId: step.id
        };
        Object.freeze(failure);
        return { status: "rejected", failure: failure };
      }
    }
  }

  const supportedSchemaVersions: number[] = [];
  for (let version = supportFloorSchemaVersion; version <= currentSchemaVersion; version += 1) {
    supportedSchemaVersions.push(version);
  }

  const registry: FamilyMigrationRegistry<TContext> = {
    family: spec.family,
    supportFloorSchemaVersion: supportFloorSchemaVersion,
    currentSchemaVersion: currentSchemaVersion,
    supportedSchemaVersions: Object.freeze(supportedSchemaVersions),
    steps: steps,
    migrate: (request: FamilyMigrationRequest<TContext>): FamilyMigrationResult =>
      migrateDocument(
        spec.family,
        supportFloorSchemaVersion,
        currentSchemaVersion,
        steps,
        request
      )
  };
  Object.freeze(registry);
  return { status: "created", registry: registry };
}
