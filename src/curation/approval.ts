/**
 * P8-T01 — Strict parsing of the separate human-approval input that gates canonical publication.
 *
 * Authority: docs/REQUIREMENTS.md 13.2 (transformation plus allowlist produce the curated
 * directory); docs/implementation/phase-08.md Section 4 (a separate human-approval input is
 * required before canonical output can be written).
 *
 * An approval binds a named human review to one exact candidate by the SHA-256 digest of the
 * candidate bytes. Any other digest means the reviewed content changed after approval, so the
 * approval is stale and must fail closed. This module is pure: no file access, no clock, no
 * randomness, no browser APIs.
 */
import type { CurationDiagnostic } from "./source";

/** One human-approval record bound to one exact candidate by digest. */
export interface ApprovalDocument {
  readonly format: "repjot/curation/approval";
  readonly schemaVersion: 1;
  readonly candidateSha256: string;
}

type ApprovalParseResult =
  | { readonly ok: true; readonly approval: ApprovalDocument }
  | { readonly ok: false; readonly diagnostics: readonly CurationDiagnostic[] };

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** Validate one parsed approval record. Unknown keys, wrong envelope, or bad digests fail closed. */
export function parseApproval(raw: unknown): ApprovalParseResult {
  const malformed = (message: string): ApprovalParseResult => ({
    ok: false,
    diagnostics: [{ code: "approval-malformed", sourceId: null, message }]
  });

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return malformed("the approval document is not a JSON object");
  }
  const record = raw as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const allowed = ["candidateSha256", "format", "schemaVersion"];
  if (keys.length !== allowed.length || keys.some((key) => allowed.indexOf(key) === -1)) {
    return malformed("the approval document has unknown or missing keys (allowed: format, schemaVersion, candidateSha256)");
  }
  if (record["format"] !== "repjot/curation/approval") {
    return malformed('field "format" must be "repjot/curation/approval"');
  }
  if (record["schemaVersion"] !== 1) {
    return malformed('field "schemaVersion" must be 1');
  }
  if (typeof record["candidateSha256"] !== "string" || !SHA256_PATTERN.test(record["candidateSha256"])) {
    return malformed('field "candidateSha256" must be a 64-character lowercase hexadecimal SHA-256 digest');
  }
  const approval: ApprovalDocument = {
    format: "repjot/curation/approval",
    schemaVersion: 1,
    candidateSha256: record["candidateSha256"] as string
  };
  return { ok: true, approval };
}
