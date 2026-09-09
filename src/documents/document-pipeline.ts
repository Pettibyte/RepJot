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
 * migration function (Phase 14), no stage-order machine and no whole-pipeline function (Phase 15), no
 * normalizer and no digest service (Phase 16), no static loader and no network adapter (Phase 17). The
 * module is imported by nothing yet — `src/main.ts` does not reach it — so no shipped output changes.
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

import type { PipelineError } from "./pipeline-types";
import { matchCanonicalLogicalName, selectFamilyRegistry } from "./envelope";
import type { FamilyRegistrySelection } from "./envelope";

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
