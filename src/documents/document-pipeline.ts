/**
 * Document pipeline: the envelope-recognition stage of the load pipeline (P13-T01).
 *
 * Authority: docs/implementation/phase-13.md (task P13-T01 "Recognize exact envelopes and logical
 * names", objective "Select a family registry only from validated envelope fields and the expected
 * logical name", acceptance "No shape heuristic or Drive metadata influences family/version selection"),
 * docs/ARCHITECTURE.md Section 7 module table row `src/documents/document-pipeline.ts` ("Parse,
 * recognize, validate, migrate, revalidate, and normalize documents", may depend on "Schema, migration,
 * semantic validation") and Section 12 stage table row "Envelope recognition", whose failure column this
 * stage satisfies ("Reject missing, mismatched, unknown, unsupported-old, or future envelopes with
 * distinct errors"). See src/documents/envelope.ts for the full authority list of the recognition seam
 * this stage composes.
 *
 * Scope. Phase 13 adds this one stage entry to the pipeline module. The rest of the module's named
 * responsibilities belong to later tasks and are absent here by design: no migration registry or
 * migration function (Phase 14, accepted as `src/migrations/migration-registry.ts`), no normalizer and
 * no digest service (Phase 16), no static loader and no network adapter (Phase 17). Phase 15 (P15-T01)
 * adds the whole-pipeline function `loadDocument` below, which owns the stage order. The module is
 * imported by nothing yet — `src/main.ts` does not reach it — so no shipped output changes.
 *
 * Three outcomes, and the third one is the reason this stage is not a call to the recognizer. A
 * canonical filename with a conforming envelope yields a family registry selection. A canonical filename
 * with a non-conforming envelope yields exactly one typed pipeline error of the closed accepted kind set.
 * A filename that is not canonical yields neither: this stage selects no registry at all, so a caller
 * gets no family, no version, no registry handle, and no reason to read the file, because
 * docs/contracts/families-and-files.md FF-05 and FF-06 make an unrecognized name a never-read,
 * never-edited, never-deleted file whose owner is the Drive catalog service. That refusal is not forced
 * into a `PipelineErrorKind`, and no family value is fabricated for it.
 *
 * The stage is pure. It parses nothing — its input value is the `unknown` the accepted parse stage
 * produced (FF-14) — reads nothing from that value, writes nothing to it, freezes nothing of it, and
 * returns no record that references it, so a rejected call leaves the caller's object byte-for-byte as it
 * arrived (FF-10 "None on rejection — original bytes preserved unchanged", FF-20). It performs no I/O and
 * imports no I/O: no `node:` module, no network, no DOM, no Svelte, no IndexedDB, no Drive adapter, no
 * clock, no locale, no random, and not src/validation/schema-registry.ts, whose `node:url` import and
 * repository reads must stay out of a browser-reachable pipeline module. It uses no syntax newer than
 * ES2019 (AGENTS.md, docs/implementation/README.md Section 3, docs/CAPABILITIES-kindle-scribe.md).
 */

import type { DocumentFamily } from "../domain/families";
import type {
  DocumentPointer,
  MigrationStepId,
  PipelineError,
  PipelineErrorFor,
  PipelineErrorKind,
  PipelineSafeContextByKind,
  PipelineStage,
  SourceIdentity
} from "./pipeline-types";
import { makePipelineError } from "./pipeline-types";
import { matchCanonicalLogicalName, selectFamilyRegistry } from "./envelope";
import type { FamilyRegistrySelection } from "./envelope";
import { parseDocumentBytes } from "./safe-json-parser";
import { createFamilyMigrationRegistry } from "../migrations/migration-registry";
import type {
  FamilyMigrationRegistry,
  FamilyMigrationStep,
  FamilyMigrationStepInput,
  FamilyMigrationStepResult,
  MigrationContext,
  MigrationFailure
} from "../migrations/migration-registry";

// ---------------------------------------------------------------------------
// Stage input and result
// ---------------------------------------------------------------------------

/**
 * The two facts this stage needs, and no others: the parsed document value handed on from the accepted
 * parse stage, and the candidate filename whose canonical form implies the expected family. The filename
 * is `unknown` because a candidate arrives from a catalog listing and the accepted matcher answers any
 * input, string or not, with a definite outcome. Drive `version`, `md5Checksum`, `modifiedTime`, size,
 * and file ID are FF-11 change indicators that "None selects a schema migration", and this input has no
 * field that could receive one.
 */
export interface DocumentEnvelopeInput {
  readonly logicalName: unknown;
  readonly value: unknown;
}

/**
 * The stage outcome. `recognized` carries the one family registry selection the document enters.
 * `rejected` carries the one typed pipeline error whose `stage` is `"envelope"`, whose `logicalName` is
 * the canonical filename this stage recognized, and whose safe context holds only that kind's declared
 * fields, so a caller branches on `kind` alone (docs/implementation/phase-11.md acceptance).
 * `unknown-file` is the refusal to select: the caller's candidate name comes back and nothing else does.
 */
export type DocumentEnvelopeResult =
  | { readonly status: "recognized"; readonly selection: FamilyRegistrySelection }
  | { readonly status: "rejected"; readonly error: PipelineError }
  | { readonly status: "unknown-file"; readonly name: string | null };

/**
 * Recognize one parsed document against one expected logical name and select its family registry.
 *
 * The sequence is fixed and short. First the exact-name match, which reads only filename text; a
 * non-canonical name returns the refusal and the document value is never touched again. Then the
 * registry selection for the family that name implies, which reads the value through the accepted
 * recognizer and nothing else. Every error therefore names a canonical filename — the string the
 * matcher itself returned — so no arbitrary caller string reaches a pipeline error's `logicalName`
 * through this stage.
 *
 * A filename month is never compared with a document field here, and `yearMonthUtc` is never read: a
 * results shard whose body disagrees with its own name is accepted by this stage and rejected later by
 * semantic validation (RS-01, invariant 19).
 */
export function recognizeDocumentEnvelope(input: DocumentEnvelopeInput): DocumentEnvelopeResult {
  const name = matchCanonicalLogicalName(input.logicalName);
  if (name.status === "unknown-file") {
    return { status: "unknown-file", name: name.name };
  }

  const outcome = selectFamilyRegistry({
    value: input.value,
    expectedFamily: name.family,
    logicalName: name.name
  });

  if (outcome.status === "selected") {
    return { status: "recognized", selection: outcome.selection };
  }
  return { status: "rejected", error: outcome.error };
}

// ===========================================================================
// P15-T01 — the whole-pipeline function: stage order enforced by one call
// ===========================================================================

/*
 * Authority for everything below: docs/implementation/phase-15.md (task P15-T01, objective "Make stage
 * ordering impossible to bypass through normal pipeline use", steps "Validate the declared schema first.
 * Clone or pass read-only validated input to each migration. Validate each next-version output. Run
 * complete current schema validation and semantic validation. Normalize only after success", edge cases
 * "invalid historical input, a migration that mutates input, wrong next version, invalid intermediate
 * output, missing reference context, invalid final semantics", acceptance "The call trace is parse,
 * recognize, historical schema, migration, next schema, final semantic, normalize. Failed inputs remain
 * byte-identical"), docs/ARCHITECTURE.md Section 12 (the six load-stage rows and their failure columns)
 * and its purity line, specs/schema-versioning.md (§Migration chains loader steps 1-9, §Result migrations
 * and references "If a reference is missing or ambiguous ... then fail", §Failure and recovery "Automatic
 * recovery never invents IDs or workout results", §Version handling), docs/contracts/families-and-files.md
 * FF-05, FF-06, FF-10, FF-14, FF-18, FF-19, FF-20, and docs/implementation/GATES.md Section 3
 * ("Validation-after-migration | Spy and fixture", "Immutability | Unit | Frozen object, byte snapshot,
 * repeated load", "Inspect the diff for a second schema validator, shape inference, or migration
 * write-back").
 *
 * Every external capability is an injected port (Phase 15 scope decision 1): the schema validator, the
 * four migration registries, the semantic validator, and the optional normalizer arrive as values the
 * caller supplies, and this module imports no validator implementation and no Node-linked module —
 * src/validation/schema-registry.ts reads repository files through `node:fs` and must stay out of a
 * browser-reachable module (AGENTS.md, docs/CAPABILITIES-kindle-scribe.md). Only src/migrations/** is
 * imported directly, because the accepted Phase 14 module is pure and Node-free and the phase-15 scope
 * decision 1 names that import as permitted; the direction stays one-way — nothing under
 * src/migrations/** imports src/documents/**.
 *
 * What this function does not build, and cannot, because pipeline-types.ts fixes the boundary: no
 * DocumentProvenance, no SourceDigest, no ValidationVersion, and no MigrationPath value (Phase 16
 * attaches provenance when it adds the digest service), no normalizer implementation (Phase 16), no
 * static loading or `fetch` (Phase 17), and no new PipelineErrorKind (scope decision 4 — every rejection
 * is one makePipelineError result of the accepted closed set, and a missing port is a compile-time
 * impossibility, never an invented kind). The success outcome carries the ordered trace of the stages
 * that actually ran, named by the accepted PIPELINE_STAGES set (scope decision 5), and the identifiers of
 * the migration steps the accepted registry applied, in application order. Normalization adds no stage of
 * its own (the accepted PipelineResult comment): a caller proves normalization by the normalizer it
 * injected, which this function calls last, exactly once, only after a semantic success, and never on a
 * rejection.
 *
 * Why the migration stage wraps the injected registry instead of walking it. R-03 of the phase requires
 * the next version's schema to be consulted after every step and before the next step runs. The accepted
 * registry's own walk offers no hook between steps, and re-walking registry.steps here would be a second
 * migration mechanism next to the accepted one, which GATES.md Section 3 forbids. So the stage builds a
 * gated registry through the accepted createFamilyMigrationRegistry builder, whose steps call the
 * injected steps and then apply the schema gate to every intermediate output; the accepted builder and
 * the accepted walk still enforce strict N-to-N+1, chain gaps, duplicates, unchanged outputs, wrong
 * versions, and step exceptions exactly as the accepted Phase 14 module does. The final current-version
 * output is validated once by this function after the walk, which is the Section 12 stage 5 sentence
 * "validate every intermediate output and the final current document" with no version validated twice.
 * A step that fails inside its own gate reports the gate's JSON Pointer paths under the accepted
 * post-migration-schema-invalid kind, because a step output that is not a schema-valid next-version
 * document is exactly that failure and no new kind exists.
 *
 * Purity. Nothing here performs I/O or holds state: no `node:` module, network, DOM, Svelte, IndexedDB,
 * Drive, clock, locale, randomness, or entropy source is imported or used, no TextDecoder or JSON call
 * appears (byte decoding belongs to the accepted parse stage), and no value is written, frozen, or
 * replaced on the caller's bytes, the caller's context, the caller's ports, or the caller's registries.
 * The parsed value is produced inside this call from the caller's bytes, so it — not any caller-owned
 * object — is what each migration receives (scope decision 3, the disposition of the Phase 14 packet
 * D002): a step that writes into it corrupts nothing the caller owns, and the schema gate or the accepted
 * walk then rejects whatever it produced. There is deliberately no deep copy and no deep freeze of any
 * document value. A port that raises is a caller programming error and its exception propagates, except
 * that the accepted walk contains raises from inside a step application, including from the schema gate
 * this stage places around a step, as that step having failed. Only ES2019 syntax appears.
 */

/**
 * What the schema port receives: the recognized family, the exact version whose schema is consulted,
 * and the pipeline-owned document value. The version is a value, not a second schema document or `$id`:
 * one port serves the declared-version consultation, every intermediate next-version gate, and the
 * final current-version validation, which is what keeps this module from holding a second validator
 * (GATES.md Section 3). The document arrives as the pipeline-owned parsed or step-produced value and is
 * read by convention only; the port writes nothing the pipeline relies on.
 */
export interface DocumentSchemaValidationInput {
  readonly family: DocumentFamily;
  readonly schemaVersion: number;
  readonly document: unknown;
}

/** The schema port's outcome: valid, or invalid with JSON Pointer paths (Section 12 stages 3 and 5). */
export type DocumentSchemaValidationOutcome =
  | { readonly status: "valid" }
  | { readonly status: "invalid"; readonly paths: readonly DocumentPointer[] };

/**
 * What the semantic port receives: the final current-version document and the caller's one read-only
 * reference context, passed through unchanged (FF-19 — this function builds no context, orders no
 * families, and invents no identity).
 */
export interface DocumentSemanticValidationInput<TContext = MigrationContext> {
  readonly family: DocumentFamily;
  readonly document: unknown;
  readonly context: TContext;
}

/** The semantic port's outcome: valid, or invalid with JSON Pointer paths (Section 12 stage 6). */
export type DocumentSemanticValidationOutcome =
  | { readonly status: "valid" }
  | { readonly status: "invalid"; readonly paths: readonly DocumentPointer[] };

/**
 * The injected capabilities of one pipeline call. The registry record is total over the four accepted
 * families, so a recognized family always has its registry and a missing port is a compile-time
 * impossibility rather than a runtime condition needing an invented kind (scope decision 4).
 * `normalize` is the only optional port: this phase proves the ordering rule "Normalize only after
 * success" (scope decision 2) by running it last, exactly once, only after a semantic success — and
 * ships no normalizer implementation, which Phase 16 owns. The model type a normalizer returns is the
 * call's model type; without a normalizer the model is the validated final document itself, so callers
 * omitting it take the default `unknown`.
 */
export interface DocumentPipelinePorts<TModel = unknown, TContext = MigrationContext> {
  readonly validateSchema: (input: DocumentSchemaValidationInput) => DocumentSchemaValidationOutcome;
  readonly migrationRegistries: Readonly<Record<DocumentFamily, FamilyMigrationRegistry<TContext>>>;
  readonly validateSemantic: (input: DocumentSemanticValidationInput<TContext>) => DocumentSemanticValidationOutcome;
  readonly normalize?: ((document: unknown) => TModel) | undefined;
}

/**
 * What one pipeline call receives. The candidate filename is `unknown` because it arrives from a catalog
 * listing and the accepted matcher answers any input. The bytes are the caller's exact source bytes,
 * which stay byte-identical on every path and stay the caller's writable array (FF-14, FF-20). The
 * context is the one read-only reference context, never built or extended here and `null` when the
 * document needs no reference (FF-19). `source` is the accepted source identity the caller declares;
 * Phase 15 records nothing from it — Phase 16's provenance is its consumer.
 */
export interface DocumentPipelineInput<TModel = unknown, TContext = MigrationContext> {
  readonly logicalName: unknown;
  readonly source: SourceIdentity;
  readonly bytes: Uint8Array;
  readonly context: TContext;
  readonly ports: DocumentPipelinePorts<TModel, TContext>;
}

/**
 * A successful load. `stage` names the Section 12 stage the call reached — always `"semantic"`, the
 * last load stage, because normalization adds no stage of its own — and `trace` is the ordered list of
 * the stages that actually ran, each one named by the accepted PIPELINE_STAGES set. The
 * post-migration-schema entry appears exactly when at least one step applied, because a
 * current-version document's final validation is its declared-schema consultation and no output is
 * validated twice for one version. `appliedStepIds` are the accepted registry's identifiers in
 * application order, and the zero-step load carries the empty list.
 */
export interface LoadedDocument<TModel = unknown> {
  readonly status: "loaded";
  readonly stage: PipelineStage;
  readonly trace: readonly PipelineStage[];
  readonly appliedStepIds: readonly MigrationStepId[];
  readonly model: TModel;
}

/**
 * One pipeline call's result. `loaded` names the stage reached with the ordered trace and the applied
 * step identifiers; `rejected` carries the one typed pipeline error of the accepted closed kind set,
 * whose `stage` field names where the run stopped; `unknown-file` is the accepted Phase 13 refusal to
 * select a registry for a non-canonical name — no family, no version, no registry, no invented kind,
 * and the candidate name returned unchanged (FF-05, FF-06).
 */
export type DocumentPipelineResult<TModel = unknown> =
  | LoadedDocument<TModel>
  | { readonly status: "rejected"; readonly error: PipelineError }
  | { readonly status: "unknown-file"; readonly name: string | null };

/** Build the one rejection arm from a kind, the canonical name, and that kind's declared context. */
function rejectStage<K extends PipelineErrorKind>(
  kind: K,
  logicalName: string,
  safeContext: PipelineSafeContextByKind[K]
): { readonly status: "rejected"; readonly error: PipelineErrorFor<K> } {
  return {
    status: "rejected",
    error: makePipelineError({ kind: kind, logicalName: logicalName, safeContext: safeContext })
  };
}

/** The one gate rejection this stage can raise, carried beside the step that caused it. */
interface SchemaGateMark {
  readonly stepId: MigrationStepId;
  readonly paths: readonly DocumentPointer[];
}

/**
 * Map one accepted registry failure to the one typed migration rejection. `migration-failed` is the
 * only kind the accepted set names for this stage (scope decision 4), and both integers are reads of
 * version fields the failure or the envelope already carries — the function performs no version
 * arithmetic, which is how the accepted no-numeric-literal census over this module keeps its force:
 * the step arms name their own two versions, `unsupported-old-version` names its floor, `future-version`
 * and `chain-gap` name the current version the walk was heading to, and the malformed-version arms —
 * unreachable here because the envelope stage has already read and required the same own
 * `schemaVersion` — fall back to the declared version and the envelope's current version.
 */
function migrationFailureError(
  failure: MigrationFailure,
  family: DocumentFamily,
  declaredSchemaVersion: number,
  currentSchemaVersion: number,
  logicalName: string
): { readonly status: "rejected"; readonly error: PipelineErrorFor<"migration-failed"> } {
  let fromSchemaVersion = declaredSchemaVersion;
  let toSchemaVersion = currentSchemaVersion;
  switch (failure.reason) {
    case "unsupported-old-version":
      fromSchemaVersion = failure.schemaVersion;
      toSchemaVersion = failure.supportFloorSchemaVersion;
      break;
    case "future-version":
      fromSchemaVersion = failure.schemaVersion;
      toSchemaVersion = failure.currentSchemaVersion;
      break;
    case "chain-gap":
      // A gap is always below the current version, so the walk's own target is the honest second
      // integer: the version that has no step is named as the step that never ran toward current.
      fromSchemaVersion = failure.schemaVersion;
      toSchemaVersion = failure.currentSchemaVersion;
      break;
    case "step-reported-failure":
    case "step-result-invalid":
    case "step-output-unchanged":
    case "step-output-wrong-version":
    case "step-threw":
      fromSchemaVersion = failure.fromSchemaVersion;
      toSchemaVersion = failure.toSchemaVersion;
      break;
    case "missing-version":
    case "non-number-version":
    case "non-integer-version":
    case "non-positive-version":
      fromSchemaVersion = declaredSchemaVersion;
      toSchemaVersion = currentSchemaVersion;
      break;
    default:
      break;
  }
  return rejectStage("migration-failed", logicalName, {
    family: family,
    fromSchemaVersion: fromSchemaVersion,
    toSchemaVersion: toSchemaVersion
  });
}

/**
 * Run one document through the whole load pipeline: parse, envelope, declared-schema, migration,
 * post-migration-schema, semantic, and — only after a semantic success and only when the caller injected
 * one — normalize.
 *
 * The order is the Section 12 table and specs/schema-versioning.md loader steps 1-9, and it is the only
 * sequence the function has: every step of it is a local call inside this one call, so no normal use of
 * the pipeline can skip, duplicate, or reorder a stage (the phase objective). Concretely:
 *
 * 1. The exact-name match runs before the bytes are touched, because a non-canonical name is refused
 *    before any byte is parsed (FF-05) and produces the accepted `unknown-file` arm.
 * 2. The accepted parse stage turns the caller's bytes into the pipeline-owned parsed value, stripping
 *    exactly one leading byte-order mark from the parsed view while the caller keeps every byte (FF-14).
 * 3. The accepted envelope seam selects the family registry from own `format` and own `schemaVersion`
 *    only; unsupported-old and future versions stop here with their accepted kinds before any port of
 *    this function is consulted.
 * 4. The schema port is consulted for the declared version before any migration step, and its invalid
 *    outcome is `declared-schema-invalid` with the port's paths and zero step calls (Section 12 stage 3
 *    "Stop before migration and report JSON Pointer paths").
 * 5. The migration stage applies the family's accepted registry walk — gated as described in the
 *    section comment, so each intermediate output is validated against its next version's schema before
 *    the next step runs — and every registry failure is the one typed `migration-failed` carrying the
 *    family and the failure's own two versions.
 * 6. When at least one step applied, the final current-version document is validated completely against
 *    the current schema, and an invalid output is `post-migration-schema-invalid`: the migrated view is
 *    discarded and the caller's bytes keep their canonical value unchanged (Section 12 stage 5).
 * 7. The semantic port is consulted last among the six stages, on the final current-version document
 *    with the caller's unchanged context, and its invalid outcome is `semantic-invalid` with paths.
 * 8. The normalizer, if any, runs only after that success — last, exactly once, and never on any of the
 *    rejection paths above.
 *
 * The caller's bytes and context leave exactly as they arrived on every path, because this function has
 * no write to either, and the value each step receives is the pipeline-owned value parsed inside this
 * call. The function holds no state: two calls with equal inputs produce deep-equal results through the
 * same ports.
 */
export function loadDocument<TModel = unknown, TContext = MigrationContext>(
  input: DocumentPipelineInput<TModel, TContext>
): DocumentPipelineResult<TModel> {
  // Stage 2 begins with the name match: a non-canonical name is refused before a byte is parsed
  // (FF-05 "never deleted, edited, or migrated"), and no port of this call is consulted for it.
  const nameMatch = matchCanonicalLogicalName(input.logicalName);
  if (nameMatch.status === "unknown-file") {
    return { status: "unknown-file", name: nameMatch.name };
  }
  const logicalName = nameMatch.name;

  // Stage 1: the accepted parse stage. It never writes to the caller's array, and its parsed value is
  // the pipeline-owned document every later stage reads.
  const parsed = parseDocumentBytes({ logicalName: logicalName, bytes: input.bytes });
  if (parsed.status === "rejected") {
    return { status: "rejected", error: parsed.error };
  }

  // Stage 2: the accepted envelope seam — the only reader of `format` and `schemaVersion` in the
  // project. Every envelope kind keeps its own accepted kind and stage here.
  const envelope = selectFamilyRegistry({
    value: parsed.value,
    expectedFamily: nameMatch.family,
    logicalName: logicalName
  });
  if (envelope.status === "rejected") {
    return { status: "rejected", error: envelope.error };
  }
  const selection: FamilyRegistrySelection = envelope.selection;
  const family = selection.family;

  // Stage 3: the declared version's schema, before any migration step and with nothing else consulted.
  const declaredCheck = input.ports.validateSchema({
    family: family,
    schemaVersion: selection.schemaVersion,
    document: parsed.value
  });
  if (declaredCheck.status === "invalid") {
    return rejectStage("declared-schema-invalid", logicalName, { paths: declaredCheck.paths });
  }

  // Stage 4: the family's accepted registry walk, gated so every intermediate output meets its next
  // version's schema before the next step runs. The marks array is call-local and holds only the
  // pointers this call's own gate produced.
  const registry = input.ports.migrationRegistries[family];
  const marks: SchemaGateMark[] = [];
  const gatedSteps: FamilyMigrationStep<TContext>[] = [];
  for (const step of registry.steps) {
    const gated: FamilyMigrationStep<TContext> = {
      id: step.id,
      fromSchemaVersion: step.fromSchemaVersion,
      toSchemaVersion: step.toSchemaVersion,
      migrate: (stepInput: FamilyMigrationStepInput<TContext>): FamilyMigrationStepResult => {
        const result = step.migrate(stepInput);
        // One read of the step's returned result, taken here, and a plain result of this wrapper's own
        // that carries the captured values. The accepted walk reads `status` and then `detail` or
        // `document` out of whatever value this wrapper returns, so handing it back the step's own
        // object would let an accessor or a Proxy behind one of those names give the gate below one
        // value and the walk another: the gate would certify a document the walk never adopts, and the
        // walk would adopt a document no schema ever saw. The reads below are the walk's own reads in
        // the walk's own order — `status`, then `detail` for a reported failure, then `document` for a
        // migrated output, never a name the walk would not touch — and each happens once.
        if (typeof result !== "object" || result === null) {
          // Nothing to read and nothing to adopt: the accepted walk reports step-result-invalid.
          return result;
        }
        const fields = result as Record<string, unknown>;
        const status = fields["status"];
        const captured: Record<string, unknown> = { status: status };
        if (status === "failed") {
          captured["detail"] = fields["detail"];
        } else if (status === "migrated") {
          captured["document"] = fields["document"];
        }
        const carried = captured as FamilyMigrationStepResult;
        // The gate runs only over an output the accepted walk itself would adopt: the accepted walk
        // still owns every migration condition — a malformed result, an unchanged output, a non-object,
        // and a wrong output version pass through untouched and are reported by the accepted walk as
        // step-result-invalid, step-output-unchanged, and step-output-wrong-version (R-09 keeps those
        // distinct from a schema failure). Only an adopted intermediate output then meets its next
        // version's schema, and the final output is validated once, after the walk, below. Every return
        // below carries the captured values, so the value the gate certifies is the value the walk
        // adopts: the captured unchanged output is still reference-equal to the input, a captured
        // non-object and a captured wrong version still reach the walk's own reasons, and an accessor
        // that cannot be read still throws inside the walk's own containment, reported as step-threw.
        if (status !== "migrated") {
          return carried;
        }
        const produced = captured["document"];
        if (produced === stepInput.document) {
          return carried;
        }
        if (typeof produced !== "object" || produced === null || Array.isArray(produced)) {
          return carried;
        }
        if ((produced as Record<string, unknown>)["schemaVersion"] !== step.toSchemaVersion) {
          return carried;
        }
        if (step.toSchemaVersion === registry.currentSchemaVersion) {
          return carried;
        }
        const gate = input.ports.validateSchema({
          family: family,
          schemaVersion: step.toSchemaVersion,
          document: produced
        });
        if (gate.status === "invalid") {
          marks.push({ stepId: step.id, paths: gate.paths });
          return { status: "failed", detail: "the step output failed the next-version schema gate" };
        }
        return carried;
      }
    };
    gatedSteps.push(gated);
  }
  const built = createFamilyMigrationRegistry<TContext>({
    family: family,
    range: {
      supportFloorSchemaVersion: registry.supportFloorSchemaVersion,
      currentSchemaVersion: registry.currentSchemaVersion
    },
    steps: gatedSteps
  });
  if (built.status === "rejected") {
    // Unreachable for a built injected registry — its bounds and steps were accepted by the same
    // builder — so the one typed migration failure carries the envelope's declared version facts.
    return rejectStage("migration-failed", logicalName, {
      family: family,
      fromSchemaVersion: selection.schemaVersion,
      toSchemaVersion: selection.currentSchemaVersion
    });
  }

  const walked = built.registry.migrate({ document: parsed.value, context: input.context });
  if (walked.status === "failed") {
    const failure = walked.failure;
    if (failure.reason === "step-reported-failure") {
      // A gate mark for the same step is the one way this arm can mean a schema failure rather than a
      // step failure: the walk visits each version once, so a mark for this step belongs to this walk.
      for (const mark of marks) {
        if (mark.stepId === failure.stepId) {
          return rejectStage("post-migration-schema-invalid", logicalName, { paths: mark.paths });
        }
      }
    }
    return migrationFailureError(failure, family, selection.schemaVersion, selection.currentSchemaVersion, logicalName);
  }

  // Stage 5: the complete current-schema validation of the final document, once, and only when a step
  // produced it; a zero-step load already met this condition as its declared-version consultation.
  // (Boolean of a length, not a comparison to 0: this module keeps the accepted no-digit census.)
  const migratedSomeSteps = Boolean(walked.appliedStepIds.length);
  if (migratedSomeSteps) {
    const finalCheck = input.ports.validateSchema({
      family: family,
      schemaVersion: walked.currentSchemaVersion,
      document: walked.document
    });
    if (finalCheck.status === "invalid") {
      return rejectStage("post-migration-schema-invalid", logicalName, { paths: finalCheck.paths });
    }
  }

  // Stage 6: complete semantic validation of the final current-version document with the caller's
  // unchanged context. A required reference missing from that context fails here, or inside a step
  // that could not derive an identity, and this function invents nothing either way (FF-19,
  // specs/schema-versioning.md "Automatic recovery never invents IDs or workout results").
  const semantic = input.ports.validateSemantic({
    family: family,
    document: walked.document,
    context: input.context
  });
  if (semantic.status === "invalid") {
    return rejectStage("semantic-invalid", logicalName, { paths: semantic.paths });
  }

  // Normalize only after success: the injected normalizer, if any, is the last thing this call runs.
  const ports = input.ports;
  const model: TModel =
    ports.normalize === undefined ? (walked.document as TModel) : ports.normalize(walked.document);

  const trace: PipelineStage[] = ["parse", "envelope", "declared-schema", "migration"];
  if (migratedSomeSteps) {
    trace.push("post-migration-schema");
  }
  trace.push("semantic");

  const loaded: LoadedDocument<TModel> = {
    status: "loaded",
    stage: "semantic",
    trace: Object.freeze(trace),
    appliedStepIds: walked.appliedStepIds,
    model: model
  };
  return loaded;
}
