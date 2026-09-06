/**
 * P8-T01 — One structured review artifact: candidate data plus exact-byte digest and
 * candidate-derived review metadata in a single JSON document.
 *
 * Authority: docs/implementation/phase-08.md Section 4 (candidate and review report in an
 * ignored staging location; one artifact can contain both candidate data and review metadata);
 * recorded user decision 2026-09-05 (one complete structured review artifact, atomically
 * replaced per successful generation; last completed replacement wins; generation never writes
 * canonical data).
 *
 * The artifact binds the reviewed candidate by the SHA-256 digest of its exact canonical bytes
 * (`JSON.stringify(candidate, null, 2) + "\n"`), not by raw artifact formatting. Equivalent
 * semantic inputs (reordered files, arrays, or curation entries) produce byte-identical
 * artifact bytes. This module is pure: no file access, no clock, no randomness, no browser APIs.
 */
import { createHash } from "node:crypto";

import type { CandidateDocument } from "./transform";
import type { CurationDiagnostic } from "./source";

/** The one git-ignored review artifact file name (default staging: `.curation-staging/`). */
export const REVIEW_ARTIFACT_FILE_NAME = "exercises.review.json";

const ARTIFACT_FORMAT = "repjot/curation/review";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** One review summary row for an equipment entity. */
export interface ArtifactEquipmentRow {
  readonly id: string;
  readonly name: string;
}

/** One review summary row for a candidate exercise. */
export interface ArtifactExerciseRow {
  readonly id: string;
  readonly name: string;
  readonly equipmentIds: readonly string[];
  readonly movementPattern: string;
  readonly laterality: string;
  readonly loadSemantics: string | null;
}

/** The complete structured review artifact document (exact key set and order). */
export interface ReviewArtifactDocument {
  readonly format: "repjot/curation/review";
  readonly schemaVersion: 1;
  readonly candidateSha256: string;
  readonly equipmentCount: number;
  readonly candidateExerciseCount: number;
  readonly equipment: readonly ArtifactEquipmentRow[];
  readonly exercises: readonly ArtifactExerciseRow[];
  readonly candidate: CandidateDocument;
}

/** A parsed and validated review artifact with its reconstructed exact candidate bytes. */
export interface ParsedReviewArtifact {
  readonly document: ReviewArtifactDocument;
  readonly candidate: CandidateDocument;
  readonly candidateBytes: Uint8Array;
  readonly candidateSha256: string;
}

type ArtifactParseResult =
  | { readonly ok: true; readonly artifact: ParsedReviewArtifact }
  | { readonly ok: false; readonly diagnostics: readonly CurationDiagnostic[] };

/** Canonical candidate bytes: the exact bytes a promotion would write to the canonical path. */
export function serializeCandidateBytes(candidate: CandidateDocument): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(candidate, null, 2) + "\n");
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Build the complete structured review artifact for one successful generation. The candidate is
 * embedded as a JSON value; its digest binds it to the exact canonical bytes above. Review rows
 * are projections of that candidate, so promotion can validate every retained review field.
 */
function reviewMetadata(candidate: CandidateDocument): Pick<ReviewArtifactDocument, "equipmentCount" | "candidateExerciseCount" | "equipment" | "exercises"> {
  return {
    equipmentCount: candidate.equipment.length,
    candidateExerciseCount: candidate.exercises.length,
    equipment: candidate.equipment.map((item) => ({ id: item.id, name: item.name })),
    exercises: candidate.exercises.map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      equipmentIds: [...exercise.equipmentIds],
      movementPattern: exercise.movementPattern,
      laterality: exercise.laterality,
      loadSemantics: exercise.loadSemantics === undefined ? null : exercise.loadSemantics
    }))
  };
}

export function buildReviewArtifact(
  candidate: CandidateDocument
): { readonly document: ReviewArtifactDocument; readonly bytes: Uint8Array } {
  const candidateBytes = serializeCandidateBytes(candidate);
  const document: ReviewArtifactDocument = {
    format: ARTIFACT_FORMAT,
    schemaVersion: 1,
    candidateSha256: sha256Hex(candidateBytes),
    ...reviewMetadata(candidate),
    candidate
  };
  return { document, bytes: new TextEncoder().encode(JSON.stringify(document, null, 2) + "\n") };
}

function artifactMalformed(message: string): ArtifactParseResult {
  return { ok: false, diagnostics: [{ code: "artifact-malformed", sourceId: null, message }] };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  if (keys.length !== allowed.length) return false;
  for (const key of keys) {
    if (allowed.indexOf(key) === -1) return false;
  }
  return true;
}

/**
 * Strictly validate an already-exact-parsed artifact value: envelope, candidate-derived review
 * metadata, and digest binding. Reconstructs the deterministic candidate bytes and confirms
 * `candidateSha256`. Any change to the embedded candidate (content or key order) changes the
 * reconstructed bytes and fails the digest check. Schema and semantic validation of the candidate
 * run by the caller.
 */
export function parseReviewArtifact(raw: unknown): ArtifactParseResult {
  if (!isPlainObject(raw)) {
    return artifactMalformed("the review artifact is not a JSON object");
  }
  const allowed = [
    "candidate",
    "candidateExerciseCount",
    "candidateSha256",
    "equipment",
    "equipmentCount",
    "exercises",
    "format",
    "schemaVersion"
  ];
  if (!hasExactKeys(raw, allowed)) {
    return artifactMalformed("the review artifact has unknown or missing keys (allowed: candidate, candidateExerciseCount, candidateSha256, equipment, equipmentCount, exercises, format, schemaVersion)");
  }
  if (raw["format"] !== ARTIFACT_FORMAT) {
    return artifactMalformed('field "format" must be "' + ARTIFACT_FORMAT + '"');
  }
  if (raw["schemaVersion"] !== 1) {
    return artifactMalformed('field "schemaVersion" must be 1');
  }
  if (typeof raw["candidateSha256"] !== "string" || !SHA256_PATTERN.test(raw["candidateSha256"])) {
    return artifactMalformed('field "candidateSha256" must be a 64-character lowercase hexadecimal SHA-256 digest');
  }
  for (const field of ["equipmentCount", "candidateExerciseCount"]) {
    if (typeof raw[field] !== "number" || !Number.isInteger(raw[field]) || (raw[field] as number) < 0) {
      return artifactMalformed('field "' + field + '" must be a non-negative integer');
    }
  }
  if (!Array.isArray(raw["equipment"]) || !Array.isArray(raw["exercises"])) {
    return artifactMalformed('fields "equipment" and "exercises" must be arrays');
  }
  for (const row of raw["equipment"] as unknown[]) {
    if (!isPlainObject(row) || !hasExactKeys(row, ["id", "name"]) || typeof row["id"] !== "string" || typeof row["name"] !== "string") {
      return artifactMalformed('each "equipment" row must be an object with exactly the string keys id and name');
    }
  }
  for (const row of raw["exercises"] as unknown[]) {
    if (
      !isPlainObject(row) ||
      !hasExactKeys(row, ["equipmentIds", "id", "laterality", "loadSemantics", "movementPattern", "name"]) ||
      typeof row["id"] !== "string" ||
      typeof row["name"] !== "string" ||
      typeof row["movementPattern"] !== "string" ||
      typeof row["laterality"] !== "string" ||
      !Array.isArray(row["equipmentIds"]) ||
      (row["loadSemantics"] !== null && typeof row["loadSemantics"] !== "string")
    ) {
      return artifactMalformed('each "exercises" row must be an object with exactly the keys equipmentIds, id, laterality, loadSemantics, movementPattern, and name');
    }
  }
  if (!isPlainObject(raw["candidate"])) {
    return artifactMalformed('field "candidate" must be a JSON object');
  }

  // Reconstruct the deterministic candidate bytes from the embedded value and confirm the digest.
  const candidate = raw["candidate"] as unknown as CandidateDocument;
  if (
    !Array.isArray(candidate.equipment) ||
    !Array.isArray(candidate.exercises) ||
    candidate.equipment.some((item) => !isPlainObject(item)) ||
    candidate.exercises.some((exercise) => !isPlainObject(exercise) || !Array.isArray(exercise.equipmentIds))
  ) {
    return artifactMalformed('field "candidate" must contain equipment and exercises arrays with structured rows');
  }
  const candidateBytes = serializeCandidateBytes(candidate);
  const actualSha256 = sha256Hex(candidateBytes);
  if (actualSha256 !== (raw["candidateSha256"] as string)) {
    return artifactMalformed(
      "the embedded candidate does not match candidateSha256 (reconstructed " +
        actualSha256 +
        ", declared " +
        (raw["candidateSha256"] as string) +
        "); the artifact was changed after generation"
    );
  }

  const expected = reviewMetadata(candidate);
  if (raw["equipmentCount"] !== expected.equipmentCount) {
    return artifactMalformed('field "equipmentCount" does not match the embedded candidate');
  }
  if (raw["candidateExerciseCount"] !== expected.candidateExerciseCount) {
    return artifactMalformed('field "candidateExerciseCount" does not match the embedded candidate');
  }
  if (JSON.stringify(raw["equipment"]) !== JSON.stringify(expected.equipment)) {
    return artifactMalformed('field "equipment" does not match the embedded candidate');
  }
  if (JSON.stringify(raw["exercises"]) !== JSON.stringify(expected.exercises)) {
    return artifactMalformed('field "exercises" does not match the embedded candidate');
  }
  const document: ReviewArtifactDocument = {
    format: ARTIFACT_FORMAT,
    schemaVersion: 1,
    candidateSha256: raw["candidateSha256"] as string,
    equipmentCount: expected.equipmentCount,
    candidateExerciseCount: expected.candidateExerciseCount,
    equipment: expected.equipment,
    exercises: expected.exercises,
    candidate
  };
  return { ok: true, artifact: { document, candidate, candidateBytes, candidateSha256: actualSha256 } };
}
