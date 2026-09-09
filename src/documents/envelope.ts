/**
 * Envelope stage: select one family registry from the two accepted envelope fields and the expected
 * canonical logical name (P13-T01).
 *
 * Authority: docs/implementation/phase-13.md ("Select a family registry only from validated envelope
 * fields and the expected logical name", "Read only own `format` and `schemaVersion` fields from a plain
 * object. Require a positive integer. Match static names and result-name patterns to exact families."),
 * docs/ARCHITECTURE.md Section 12 row "Envelope recognition" ("Read only `format` and positive integer
 * `schemaVersion`; match expected filename family" / "Reject missing, mismatched, unknown,
 * unsupported-old, or future envelopes with distinct errors"), docs/contracts/families-and-files.md
 * FF-01..FF-08, FF-09, FF-10, FF-11, FF-20, specs/schema-versioning.md "Document envelope" and
 * "Independent family versions", and the accepted modules this file builds on and does not re-implement:
 * `recognizeEnvelope`, `recognizeLogicalName`, `CURRENT_VERSION` and `SUPPORT_FLOOR_VERSION` from
 * src/domain/families.ts, and `makePipelineError` from ./pipeline-types.ts.
 *
 * This file adds the stage seam and nothing else. The accepted recognizer stays the only envelope reader
 * and the only name matcher: there is no `format` table here, no filename pattern here, no version
 * comparison here, and no schema check here. What is added is exactly two things — the mapping from one
 * accepted recognition status to one accepted `PipelineErrorKind`, and the family-scoped facts a later
 * stage needs from a recognized document. Every rejection is built by `makePipelineError`, so stage,
 * user-facing category, retryability, and safe message come from the accepted descriptor table and a
 * caller branches on `kind` without parsing a message (docs/implementation/phase-11.md acceptance).
 *
 * No new error kind exists here, and none is needed. The closed `PipelineErrorKind` set of the accepted
 * Phase 11 module already names every envelope condition FF-10 requires to stay distinct. In particular,
 * a filename that is not canonical is NOT forced into a pipeline error kind: `matchCanonicalLogicalName`
 * answers it with its own `unknown-file` outcome, which mirrors the accepted `recognizeLogicalName`
 * state, and the caller performs no registry selection and no document read for it, because FF-05 makes
 * an unrecognized file a never-read, never-edited, never-deleted file whose owner is the Drive catalog
 * service. A family value is never fabricated for such a name.
 *
 * "Family registry" means the per-family registry SELECTION, not a schema-validator handle.
 * specs/schema-versioning.md fixes one current-version constant, schema set, and migration registry per
 * family, so this file returns the family-scoped facts that let a later stage pick that registry —
 * family, exact `format`, declared version, that family's current version, and that family's support
 * floor. It does not import src/validation/schema-registry.ts: that module imports `node:url` and reads
 * repository files, and neither belongs in a browser-reachable pipeline module
 * (docs/implementation/README.md Section 3, AGENTS.md "Bundled HTML & JS MUST respect features in
 * docs/CAPABILITIES-kindle-scribe.md"). Phases 15 and 17 acquire the compiled registry.
 *
 * The input value is the already-parsed `unknown` that the accepted parse stage produced
 * (docs/contracts/families-and-files.md FF-14 positive case "Valid UTF-8 JSON parses to `unknown` and
 * proceeds to envelope recognition"). This file performs no parse, no decode, and no byte handling, and
 * it reads no field of that value except own `format` and own `schemaVersion`, which it never reads
 * itself: it hands the value to the accepted recognizer and reads only the recognizer's result. It never
 * reads `yearMonthUtc`, never calls `shardNameAgreesWithDocument` or `sessionStartAgreesWithShard`, and
 * never compares a filename month with a document field, because docs/implementation/phase-13.md states
 * "Compare result filename and `yearMonthUtc` later in semantic validation" (RS-01, invariant 19).
 * Drive `version`, `md5Checksum`, `modifiedTime`, size, and file ID are FF-11 change indicators that
 * "None selects a schema migration": no parameter of any function here can receive them, and no such
 * value is read, so no metadata can influence a selection.
 *
 * Purity. Neither this file nor its result touches the caller's value: nothing is written, frozen,
 * deleted, or replaced (FF-10 "None on rejection — original bytes preserved unchanged", FF-20 "Any
 * overwrite of blocked bytes" is an implementation defect), and no returned record references that
 * value, so a later mutation of the document cannot reach a returned error or selection. The stage holds
 * no state, throws nothing, and imports no I/O: no `node:` module, no network, no DOM, no Svelte, no
 * IndexedDB, no Drive adapter, no clock, no locale, no random (docs/implementation/GATES.md Section 3,
 * docs/ARCHITECTURE.md Section 12 "Migrations have no access to the DOM, clock, locale, random APIs,
 * Drive, or IndexedDB"). It uses no syntax newer than ES2019.
 */

import { CURRENT_VERSION, recognizeEnvelope, recognizeLogicalName, SUPPORT_FLOOR_VERSION } from "../domain/families";
import type { DocumentFamily, DocumentFormat, EnvelopeRecognition } from "../domain/families";
import { makePipelineError } from "./pipeline-types";
import type { PipelineError, PipelineErrorFor, PipelineErrorKind, PipelineSafeContextByKind } from "./pipeline-types";

// ---------------------------------------------------------------------------
// The exact logical-name match (FF-05, FF-06; Arch Section 12 "match expected filename family")
// ---------------------------------------------------------------------------

/**
 * The outcome of the exact-name match. `canonical` names one family and carries the canonical filename
 * that the accepted matcher returned, which is the only string this phase is allowed to put into a
 * pipeline error's `logicalName` (FF-06). `unknown-file` is the distinct unrecognized outcome: the
 * candidate file has no family, no version, no registry, and is never read (FF-05 "never deleted,
 * edited, or migrated"), and the value is the caller's candidate name, or `null` when the input was not
 * a string at all — the accepted matcher's own convention.
 *
 * A recognized results shard's `YYYY-MM` value is deliberately dropped rather than carried: this stage
 * must not use it, because comparing it with a document field is semantic validation (R-15, RS-01).
 */
export type CanonicalNameMatch =
  | { readonly status: "canonical"; readonly family: DocumentFamily; readonly name: string }
  | { readonly status: "unknown-file"; readonly name: string | null };

/**
 * Match one candidate filename to exactly one family, or to nothing.
 *
 * The whole match is the accepted `recognizeLogicalName` call below: the four canonical statuses of
 * `docs/contracts/families-and-files.md` FF-01..FF-04 become the four families, and its `unknown-file`
 * status becomes this file's `unknown-file`. A name is matched as text only — no document is opened, so
 * a candidate such as a mistyped shard month is refused before a byte of it is read, and no shape of a
 * document can make an unrecognized name recognized.
 */
export function matchCanonicalLogicalName(name: unknown): CanonicalNameMatch {
  const recognized = recognizeLogicalName(name);
  switch (recognized.status) {
    case "static-exercises":
      return { status: "canonical", family: "exercises", name: recognized.name };
    case "static-workouts":
      return { status: "canonical", family: "workouts", name: recognized.name };
    case "user-preferences":
      return { status: "canonical", family: "preferences", name: recognized.name };
    case "user-results-shard":
      return { status: "canonical", family: "results", name: recognized.name };
    case "unknown-file":
      return { status: "unknown-file", name: recognized.name };
    default:
      return assertNoUncoveredArm(recognized);
  }
}

// ---------------------------------------------------------------------------
// The family registry selection (FF-07, FF-09; Arch Section 12 stage 2 success)
// ---------------------------------------------------------------------------

/**
 * Which family registry one recognized document enters, and the version facts of that one family.
 * `schemaVersion` is the document's own declared value; the other two are that family's own accepted
 * constants, indexed by the recognized family, so a results selection can never carry another family's
 * range (FF-07 negative case "One family's version selecting another family's migration"). Exactly these
 * five fields exist: no schema-validator handle, no migration list, no document reference, and no Drive
 * value has a place here, and the record is frozen because a selection is a fact, not a draft.
 */
export interface FamilyRegistrySelection {
  readonly family: DocumentFamily;
  readonly format: DocumentFormat;
  readonly schemaVersion: number;
  readonly currentSchemaVersion: number;
  readonly supportFloorSchemaVersion: number;
}

/** One family registry selection, or the one typed envelope rejection that prevented it. */
export type FamilyRegistryOutcome =
  | { readonly status: "selected"; readonly selection: FamilyRegistrySelection }
  | { readonly status: "rejected"; readonly error: PipelineError };

/**
 * The compile-time half of every switch in this file. Each switch names one arm of an accepted
 * discriminated union, so the argument below is `never` exactly while every arm is covered; an arm added
 * to the accepted union later turns its switch into a type error instead of a silent fall-through. At
 * run time no call can reach it, and it raises nothing.
 */
function assertNoUncoveredArm(uncovered: never): never {
  return uncovered;
}

/**
 * Build the one rejection of one envelope kind. The kind chooses its own declared safe-context shape, so
 * a caller of this helper cannot pair a kind with a context it does not declare
 * (docs/ARCHITECTURE.md Section 15: what keeps document text out of a safe context is the declared shape
 * per kind, not a filter). The rejected arm is returned under its own literal kind type, so each call site
 * of the switch below yields the accepted member of the `PipelineError` union for its one kind.
 */
function rejectEnvelope<K extends PipelineErrorKind>(
  kind: K,
  logicalName: string,
  safeContext: PipelineSafeContextByKind[K]
): { readonly status: "rejected"; readonly error: PipelineErrorFor<K> } {
  return {
    status: "rejected",
    error: makePipelineError({ kind: kind, logicalName: logicalName, safeContext: safeContext })
  };
}

/**
 * Map one accepted envelope recognition to a family registry selection or to one typed pipeline error.
 * This mapping is this phase's whole decision table: eleven accepted statuses in, one of ten envelope
 * kinds or one selection out, with no condition merged and none split.
 *
 * Three arms carry the closed context that their kind declares and nothing else. `envelope-wrong-family`
 * names two family names from the closed set; `envelope-future-version` and
 * `envelope-unsupported-old-version` name two integers each, one read from the document's own declared
 * `schemaVersion` and one from the accepted per-family constant, which is the "file and supported version
 * range" that docs/ARCHITECTURE.md Section 16 asks the Unsupported schema category to name. No `format`
 * string and no other document value is available to any of them.
 *
 * It is exported because one arm needs stating as a table case rather than as a changed constant: with
 * the accepted `CURRENT_VERSION` and `SUPPORT_FLOOR_VERSION` both 1 for all four families, no document
 * value can be older than the floor and at the same time positive, so the unsupported-old arm is
 * unreachable from a value today. Its mapping is still a requirement of FF-10 and is proven as a table
 * case, which keeps FF-20's floor-reporting behaviour correct the day a family gains a v2.
 */
export function envelopeOutcomeForRecognition(
  recognition: EnvelopeRecognition,
  logicalName: string
): FamilyRegistryOutcome {
  switch (recognition.status) {
    case "recognized":
      return {
        status: "selected",
        selection: Object.freeze({
          family: recognition.family,
          format: recognition.format,
          schemaVersion: recognition.schemaVersion,
          currentSchemaVersion: CURRENT_VERSION[recognition.family],
          supportFloorSchemaVersion: SUPPORT_FLOOR_VERSION[recognition.family]
        })
      };
    case "not-an-object":
      return rejectEnvelope("envelope-not-object", logicalName, {});
    case "missing-format":
      return rejectEnvelope("envelope-missing-format", logicalName, {});
    case "unknown-format":
      return rejectEnvelope("envelope-unknown-format", logicalName, {});
    case "wrong-family":
      return rejectEnvelope("envelope-wrong-family", logicalName, {
        family: recognition.family,
        expectedFamily: recognition.expectedFamily
      });
    case "missing-version":
      return rejectEnvelope("envelope-missing-version", logicalName, {});
    case "non-number-version":
      return rejectEnvelope("envelope-non-number-version", logicalName, {});
    case "non-integer-version":
      return rejectEnvelope("envelope-non-integer-version", logicalName, {});
    case "non-positive-version":
      return rejectEnvelope("envelope-non-positive-version", logicalName, {});
    case "unsupported-old-version":
      return rejectEnvelope("envelope-unsupported-old-version", logicalName, {
        schemaVersion: recognition.schemaVersion,
        supportFloor: recognition.supportFloor
      });
    case "future-version":
      return rejectEnvelope("envelope-future-version", logicalName, {
        schemaVersion: recognition.schemaVersion,
        currentSchemaVersion: recognition.currentVersion
      });
    default:
      return assertNoUncoveredArm(recognition);
  }
}

// ---------------------------------------------------------------------------
// The stage's registry selection for one parsed value and one expected family
// ---------------------------------------------------------------------------

/**
 * What a caller supplies: the already-parsed value, the family implied by the canonical filename, and
 * that canonical filename for the error to name. There is no field in which a Drive change indicator, a
 * size, a file ID, a MIME type, a timestamp, or a shape hint could be passed, which is the structural
 * half of FF-11 and of the phase acceptance criterion "No shape heuristic or Drive metadata influences
 * family/version selection".
 */
export interface SelectFamilyRegistryInput {
  readonly value: unknown;
  readonly expectedFamily: DocumentFamily;
  readonly logicalName: string;
}

/**
 * Select the family registry that one parsed document value enters.
 *
 * Two reads happen for the whole document. First, one `Array.isArray` test: the accepted recognizer's
 * root test is the `typeof` object test, and that test admits an array, so the caller has to close the
 * one condition it owns — the root of a JSON document must be a plain object, which is what
 * `envelope-not-object` states in its accepted comment ("a root that is an array, a primitive, or `null`
 * is not one") and what docs/implementation/phase-13.md lists as the "arrays" edge case. It is one test,
 * not a second envelope reader. Second, the accepted `recognizeEnvelope` call, which is the only reader
 * of own `format` and own `schemaVersion` in the project. Nothing else about the value is inspected, so
 * the body of a document cannot influence the outcome (FF-10 "The loader never infers either value from
 * shape").
 */
export function selectFamilyRegistry(input: SelectFamilyRegistryInput): FamilyRegistryOutcome {
  if (Array.isArray(input.value)) {
    return rejectEnvelope("envelope-not-object", input.logicalName, {});
  }
  return envelopeOutcomeForRecognition(
    recognizeEnvelope(input.value, input.expectedFamily),
    input.logicalName
  );
}
