/**
 * P8-T01 — Promote a reviewed curation artifact to the canonical exercises file. Separate from
 * generation: reads an explicit review artifact and a separate human approval, validates both,
 * then atomically replaces only the canonical path with the exact approved candidate bytes.
 *
 * Usage:
 *   bun scripts/promote-static-data.ts --approval <file>
 *       [--artifact <file>]    default: .curation-staging/exercises.review.json
 *       [--canonical <file>]   default: src/public/exercises.json
 *
 * Behavior:
 - The review artifact is ingested as exact bytes through `parseExactJson` (strict UTF-8, no
   duplicate members) and strictly validated: envelope, allowed keys, deterministic candidate
   byte reconstruction, and confirmation of the embedded `candidateSha256`. A changed candidate
   or digest fails before any other step.
 - The reconstructed candidate then runs the existing exercise schema validation and the static
   semantic validation.
 - The separate approval input is exact-parsed, strictly validated, and must carry the SHA-256
   of the exact canonical candidate bytes (not raw artifact formatting). A missing, malformed,
   stale, or mismatched approval fails without touching the canonical target.
 - Only after every validation passes does the command atomically replace the canonical path
   (same-directory temporary file plus rename) with the exact candidate bytes. Every failure
   leaves the canonical bytes unchanged.
 - One operator runs this development-time tool. One invocation per output path is supported;
   same-path multi-process concurrency is unsupported. The local workspace and operator are
   trusted against hostile concurrent filesystem mutation.
 */
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { parseApproval } from "../src/curation/approval";
import { OutputWriteError, writeAtomicFile } from "../src/curation/atomic-write";
import { parseExactJson } from "../src/curation/exact-json";
import { parseReviewArtifact, REVIEW_ARTIFACT_FILE_NAME } from "../src/curation/review-artifact";
import type { CurationDiagnostic } from "../src/curation/source";
import { createProductionValidator } from "../src/validation/schema-validator";
import { validateStaticDocuments } from "../src/validation/semantic";

export { REVIEW_ARTIFACT_FILE_NAME } from "../src/curation/review-artifact";

const REPO_ROOT = resolve(import.meta.dir, "..");

export const DEFAULT_ARTIFACT_PATH = ".curation-staging/exercises.review.json";
export const DEFAULT_CANONICAL_PATH = "src/public/exercises.json";

interface Options {
  artifact: string;
  approval: string | null;
  canonical: string;
}

function usageError(message: string): never {
  console.error("Usage error: " + message);
  console.error(
    [
      "Usage: bun scripts/promote-static-data.ts --approval <file>",
      "  [--artifact <file>]   default: " + DEFAULT_ARTIFACT_PATH,
      "  [--canonical <file>]  default: " + DEFAULT_CANONICAL_PATH,
      "",
      "Promotes the reviewed artifact to canonical data only after the separate approval"
    ].join("\n")
  );
  process.exit(2);
}

function parseArgs(args: readonly string[]): Options {
  const options: Options = {
    artifact: DEFAULT_ARTIFACT_PATH,
    approval: null,
    canonical: DEFAULT_CANONICAL_PATH
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = i + 1 < args.length ? args[i + 1] : undefined;
    if (next === undefined || next.length === 0) {
      usageError("flag " + arg + " needs a value");
    }
    switch (arg) {
      case "--artifact":
        options.artifact = resolve(next);
        i += 1;
        break;
      case "--approval":
        options.approval = resolve(next);
        i += 1;
        break;
      case "--canonical":
        options.canonical = resolve(next);
        i += 1;
        break;
      default:
        usageError("unknown argument " + arg);
    }
  }
  if (options.approval === null) {
    usageError("--approval <file> is required; promotion never runs without a separate human approval");
  }
  return options;
}

function printDiagnostics(diagnostics: readonly CurationDiagnostic[]): void {
  for (const item of diagnostics) {
    const target = item.sourceId === null ? "" : " [" + item.sourceId + "]";
    console.error(item.code + target + " " + item.message);
  }
}

/** Read and exact-parse the review artifact, then validate envelope and digest binding. */
async function loadArtifact(artifactPath: string): Promise<{ ok: true; candidateBytes: Uint8Array; candidateSha256: string; candidate: unknown } | { ok: false }> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(artifactPath));
  } catch (error) {
    const isMissing = (error as NodeJS.ErrnoException).code === "ENOENT";
    printDiagnostics([
      {
        code: isMissing ? "artifact-file-missing" : "artifact-json-invalid",
        sourceId: null,
        message: 'the review artifact "' + artifactPath + '" ' + (isMissing ? "is missing; run bun scripts/build-static-data.ts first" : "could not be read as bytes; check the file and rerun")
      }
    ]);
    return { ok: false };
  }
  const exact = parseExactJson(bytes);
  if (!exact.ok) {
    printDiagnostics([{ code: "artifact-json-invalid", sourceId: null, message: 'the review artifact "' + artifactPath + '" is not valid strict JSON: ' + exact.detail + "; regenerate the artifact" }]);
    return { ok: false };
  }
  const parsed = parseReviewArtifact(exact.value);
  if (!parsed.ok) {
    printDiagnostics(parsed.diagnostics);
    return { ok: false };
  }
  return { ok: true, candidateBytes: parsed.artifact.candidateBytes, candidateSha256: parsed.artifact.candidateSha256, candidate: parsed.artifact.candidate };
}

/** Read and exact-parse the separate human approval, then validate its envelope. */
async function loadApproval(approvalPath: string): Promise<{ ok: true; candidateSha256: string } | { ok: false }> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(approvalPath));
  } catch (error) {
    const isMissing = (error as NodeJS.ErrnoException).code === "ENOENT";
    printDiagnostics([
      { code: isMissing ? "approval-file-missing" : "approval-json-invalid", sourceId: null, message: 'the approval file "' + approvalPath + '" ' + (isMissing ? "is missing; record human approval bound to the candidate digest first" : "could not be read as bytes; check the file and rerun") }
    ]);
    return { ok: false };
  }
  const exact = parseExactJson(bytes);
  if (!exact.ok) {
    printDiagnostics([{ code: "approval-json-invalid", sourceId: null, message: 'the approval file "' + approvalPath + '" is not valid strict JSON: ' + exact.detail + "; correct the file and rerun" }]);
    return { ok: false };
  }
  const parsed = parseApproval(exact.value);
  if (!parsed.ok) {
    printDiagnostics(parsed.diagnostics);
    return { ok: false };
  }
  return { ok: true, candidateSha256: parsed.approval.candidateSha256 };
}

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));

  // Validation order: artifact envelope and digest binding, then candidate schema and semantic
  // validation, then the separate approval. The canonical target is touched only after all of
  // these pass, so every failure leaves the canonical bytes unchanged.
  const artifact = await loadArtifact(options.artifact);
  if (!artifact.ok) {
    return 1;
  }

  const schemaCheck = createProductionValidator().validate("exercises", 1, artifact.candidate);
  if (!schemaCheck.valid) {
    for (const item of schemaCheck.errors) {
      printDiagnostics([{ code: "candidate-schema-invalid", sourceId: null, message: item.instancePath + ": " + item.message }]);
    }
    return 1;
  }

  const semanticCheck = validateStaticDocuments(artifact.candidate, {
    format: "repjot/workouts",
    schemaVersion: 1,
    workouts: []
  });
  if (!semanticCheck.valid) {
    for (const item of semanticCheck.diagnostics) {
      printDiagnostics([{ code: "candidate-semantic-invalid", sourceId: null, message: item.path + ": " + item.message }]);
    }
    return 1;
  }

  const approval = await loadApproval(options.approval!);
  if (!approval.ok) {
    return 1;
  }
  if (approval.candidateSha256 !== artifact.candidateSha256) {
    printDiagnostics([
      {
        code: "approval-mismatch",
        sourceId: null,
        message: "the approval digest does not match the reviewed candidate (stale or mismatched review); re-review the artifact and record a new approval"
      }
    ]);
    return 1;
  }

  try {
    await mkdir(dirname(options.canonical), { recursive: true });
    await writeAtomicFile(options.canonical, artifact.candidateBytes, "canonical-write-failed");
  } catch (error) {
    if (error instanceof OutputWriteError) {
      printDiagnostics([{ code: error.code, sourceId: null, message: error.message }]);
    } else {
      printDiagnostics([{ code: "canonical-write-failed", sourceId: null, message: "unexpected filesystem error during canonical replacement: " + String(error) }]);
    }
    return 1;
  }

  console.log("Canonical written to " + options.canonical);
  console.log("candidateSha256: " + artifact.candidateSha256);
  return 0;
}

// Runs only when executed directly (`bun scripts/promote-static-data.ts`), not when imported by tests.
if (import.meta.main) {
  process.exitCode = await main();
}
