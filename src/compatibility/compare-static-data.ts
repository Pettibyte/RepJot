/**
 * P9-T01 — Static-data compatibility boundary: compare the current static bundle with the prior
 * production bundle and protect published identity across releases.
 *
 * Authority: docs/REQUIREMENTS.md 6.1-6.17; docs/ARCHITECTURE.md Section 18 (build gate 7,
 * production comparison) and Section 20 ("Prior-production compatibility");
 * specs/schema-versioning.md "Static bundle compatibility"; specs/rep-jot-json-schema-spec.md
 * Section 1 "Stable IDs and Deprecation".
 *
 * Contract:
 * - Published equipment, exercise, workout, and workout-node IDs are permanent. Deletion or reuse
 *   (including reuse in a different namespace) fails with a stable diagnostic code.
 * - Preserved identity facts per surviving node: kind (container/exercise), parent ID, exercise
 *   reference, container strategy, and the scoring/result-capture contract (mode, scoreType,
 *   childDetail). Per surviving exercise: previously supported measurement dimensions and units.
 * - Labels, instructions, notes, prescriptions, strategy configuration values, benchmarks, icons,
 *   and array ordering are permitted to change or reorder; they are never compared.
 * - Deprecation is lifecycle state, not identity: a newly deprecated exercise remains resolvable
 *   and cannot appear in new nodes (a node absent from the prior bundle is new, even when its
 *   workout ID already exists). The comparison reports every affected workout and scored or timed
 *   container instead of failing. A newly deprecated workout is informational.
 * - This module is pure: no file access, no clock, no randomness, no network, no browser APIs.
 *   It never mutates its inputs. Repeated calls on equivalent inputs return identical output;
 *   diagnostics are sorted and carry only stable codes and identifiers, never raw content text.
 */
import { createHash } from "node:crypto";

import { parseExactJson } from "../curation/exact-json";
import { createProductionValidator } from "../validation/schema-validator";
import { validateStaticDocuments } from "../validation/semantic";

/** Every stable failure code emitted by the compatibility comparison. */
export type CompatibilityCode =
  | "equipment-id-deleted"
  | "exercise-id-deleted"
  | "workout-id-deleted"
  | "node-id-deleted"
  | "id-reused-in-different-namespace"
  | "node-id-reused"
  | "node-type-changed"
  | "node-parent-changed"
  | "node-exercise-reference-changed"
  | "node-strategy-changed"
  | "node-result-capture-changed"
  | "exercise-dimension-removed"
  | "exercise-unit-removed"
  | "deprecated-exercise-in-new-node";

/** Informational (non-failure) lifecycle transitions reported for operator awareness. */
export type CompatibilityInformationalCode = "workout-newly-deprecated" | "exercise-reenabled";

/** One stable failure diagnostic: a code plus the affected identifier path. */
export interface CompatibilityDiagnostic {
  readonly code: CompatibilityCode;
  /** Deterministic identifier, e.g. `exercise:plank` or `workout:core-day/node:core-plank`. */
  readonly subject: string;
}

/** One informational (non-failure) lifecycle line. */
export interface CompatibilityInformational {
  readonly code: CompatibilityInformationalCode;
  readonly subject: string;
}

/** Workouts and scored or timed containers affected by one newly deprecated exercise (Req 6.7). */
export interface DeprecationImpactEntry {
  readonly workoutId: string;
  /** Sorted IDs of ancestor containers that are scored or timed; empty when none apply. */
  readonly containerIds: readonly string[];
}

/** The complete deterministic outcome of one compatibility comparison. */
export interface CompatibilityReport {
  readonly status: "compatible" | "incompatible";
  readonly diagnostics: readonly CompatibilityDiagnostic[];
  /** One entry per newly deprecated exercise, sorted by exercise ID and workout ID. */
  readonly deprecationImpact: readonly (readonly [string, readonly DeprecationImpactEntry[]])[];
  readonly informational: readonly CompatibilityInformational[];
}

/** Fixed safe text per failure code; raw document values never appear in a result. */
export const COMPATIBILITY_MESSAGES: Readonly<Record<CompatibilityCode, string>> = {
  "equipment-id-deleted": "a published equipment ID is missing from the current bundle",
  "exercise-id-deleted": "a published exercise ID is missing from the current bundle",
  "workout-id-deleted": "a published workout ID is missing from the current bundle",
  "node-id-deleted": "a published workout-node ID is missing from its workout in the current bundle",
  "id-reused-in-different-namespace": "a published ID now appears in a different namespace than before",
  "node-id-reused": "a deleted workout-node ID reappears under a different workout",
  "node-type-changed": "a published node changed between container and exercise",
  "node-parent-changed": "a published node moved to a different parent; result paths depend on ancestry",
  "node-exercise-reference-changed": "a published node now references a different exercise",
  "node-strategy-changed": "a published container changed its execution strategy",
  "node-result-capture-changed": "a published container changed its scoring or result-capture contract",
  "exercise-dimension-removed": "a previously supported measurement dimension was removed from an exercise",
  "exercise-unit-removed": "a previously supported measurement unit was removed from an exercise dimension",
  "deprecated-exercise-in-new-node": "a deprecated exercise appears in a node that is new in the current bundle"
};

export const COMPATIBILITY_INFORMATIONAL_MESSAGES: Readonly<Record<CompatibilityInformationalCode, string>> = {
  "workout-newly-deprecated": "the workout is newly deprecated; it remains resolvable for history but cannot start",
  "exercise-reenabled": "the exercise was previously deprecated and is no longer marked deprecated"
};

// ---------------------------------------------------------------------------
// Identity extraction
// ---------------------------------------------------------------------------

interface ExerciseIdentity {
  readonly deprecated: boolean;
  /** dimension -> compatible units (order-insensitive). */
  readonly measurements: Map<string, string[]>;
}

interface NodeIdentity {
  readonly kind: "container" | "exercise";
  readonly parentId: string | null;
  readonly exerciseId: string | null;
  readonly strategy: string | null;
  /** `mode/scoreType/childDetail` for a scored container, or null. */
  readonly scoreContract: string | null;
  readonly scored: boolean;
  readonly timed: boolean;
}

interface WorkoutIdentity {
  readonly deprecated: boolean;
  readonly nodes: Map<string, NodeIdentity>;
}

export interface BundleIdentity {
  readonly equipmentIds: Set<string>;
  readonly exercises: Map<string, ExerciseIdentity>;
  readonly workouts: Map<string, WorkoutIdentity>;
  /** Node IDs are indexed globally for namespace checks, but may occur in many workouts. */
  readonly nodeIds: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Extract the identity model from one schema- and semantically-validated bundle pair. */
export function extractBundleIdentity(exercisesDocument: unknown, workoutsDocument: unknown): BundleIdentity {
  const equipmentIds = new Set<string>();
  const exercises = new Map<string, ExerciseIdentity>();
  if (isRecord(exercisesDocument)) {
    for (const entry of Array.isArray(exercisesDocument["equipment"]) ? exercisesDocument["equipment"] : []) {
      if (!isRecord(entry)) continue;
      const id = asString(entry["id"]);
      if (id !== null) equipmentIds.add(id);
    }
    for (const entry of Array.isArray(exercisesDocument["exercises"]) ? exercisesDocument["exercises"] : []) {
      if (!isRecord(entry)) continue;
      const id = asString(entry["id"]);
      if (id === null) continue;
      const measurements = new Map<string, string[]>();
      for (const m of Array.isArray(entry["measurements"]) ? entry["measurements"] : []) {
        if (!isRecord(m)) continue;
        const dimension = asString(m["dimension"]);
        if (dimension === null) continue;
        const units: string[] = [];
        for (const unit of Array.isArray(m["compatibleUnits"]) ? m["compatibleUnits"] : []) {
          const u = asString(unit);
          if (u !== null && units.indexOf(u) === -1) units.push(u);
        }
        measurements.set(dimension, units);
      }
      exercises.set(id, { deprecated: entry["deprecated"] === true, measurements });
    }
  }

  const workouts = new Map<string, WorkoutIdentity>();
  const nodeIds = new Set<string>();
  if (isRecord(workoutsDocument)) {
    for (const entry of Array.isArray(workoutsDocument["workouts"]) ? workoutsDocument["workouts"] : []) {
      if (!isRecord(entry)) continue;
      const id = asString(entry["id"]);
      if (id === null) continue;
      const nodes = new Map<string, NodeIdentity>();
      const root = isRecord(entry["root"]) ? entry["root"] : null;
      if (root !== null) {
        collectNodes(root, null, nodes);
      }
      for (const nodeId of nodes.keys()) nodeIds.add(nodeId);
      workouts.set(id, { deprecated: entry["deprecated"] === true, nodes });
    }
  }

  return { equipmentIds, exercises, workouts, nodeIds };
}

function collectNodes(node: Record<string, unknown>, parentId: string | null, out: Map<string, NodeIdentity>): void {
  const id = asString(node["id"]);
  const type = asString(node["type"]);
  if (id === null || (type !== "container" && type !== "exercise")) {
    return;
  }
  let exerciseId: string | null = null;
  let strategy: string | null = null;
  let scoreContract: string | null = null;
  let scored = false;
  let timed = false;
  if (type === "exercise") {
    exerciseId = asString(node["exerciseId"]);
  } else {
    strategy = asString(node["strategy"]);
    if (strategy === "amrap" || strategy === "emom") {
      timed = true;
    }
    const capture = isRecord(node["resultCapture"]) ? node["resultCapture"] : null;
    if (capture !== null && asString(capture["mode"]) === "scored") {
      scored = true;
      const mode = asString(capture["mode"]);
      const scoreType = asString(capture["scoreType"]);
      const childDetail = asString(capture["childDetail"]);
      if (scoreType !== null && childDetail !== null) {
        scoreContract = [mode, scoreType, childDetail].join("/");
      }
    }
    for (const child of Array.isArray(node["children"]) ? node["children"] : []) {
      if (isRecord(child)) {
        collectNodes(child, id, out);
      }
    }
  }
  // Node IDs are unique within a workout (semantically validated before this runs).
  out.set(id, { kind: type, parentId, exerciseId, strategy, scoreContract, scored, timed });
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function sortedDiagnostics(items: CompatibilityDiagnostic[]): CompatibilityDiagnostic[] {
  return items.sort((a, b) => (a.code === b.code ? compareSubjects(a.subject, b.subject) : a.code < b.code ? -1 : 1));
}

function compareSubjects(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Compare two validated identity models. Pure and deterministic. */
export function compareBundleIdentities(prior: BundleIdentity, current: BundleIdentity): CompatibilityReport {
  const diagnostics: CompatibilityDiagnostic[] = [];
  const informational: CompatibilityInformational[] = [];

  // Deletions in each published namespace (Req 6.1).
  for (const id of [...prior.equipmentIds].sort()) {
    if (!current.equipmentIds.has(id)) {
      diagnostics.push({ code: "equipment-id-deleted", subject: "equipment:" + id });
    }
  }
  for (const id of [...prior.exercises.keys()].sort()) {
    if (!current.exercises.has(id)) {
      diagnostics.push({ code: "exercise-id-deleted", subject: "exercise:" + id });
    }
  }
  for (const id of [...prior.workouts.keys()].sort()) {
    if (!current.workouts.has(id)) {
      diagnostics.push({ code: "workout-id-deleted", subject: "workout:" + id });
    }
  }

  // Reuse of a published ID in a different namespace (Req 6.14). Nodes are a
  // namespace for collision purposes, but their IDs are only unique within one
  // workout, so node occurrences are intentionally collapsed into one set.
  type Namespace = "equipment" | "exercise" | "workout" | "node";
  const namespaces = (identity: BundleIdentity): Map<string, Set<Namespace>> => {
    const index = new Map<string, Set<Namespace>>();
    const add = (id: string, namespace: Namespace): void => {
      let found = index.get(id);
      if (found === undefined) {
        found = new Set<Namespace>();
        index.set(id, found);
      }
      found.add(namespace);
    };
    for (const id of identity.equipmentIds) add(id, "equipment");
    for (const id of identity.exercises.keys()) add(id, "exercise");
    for (const id of identity.workouts.keys()) add(id, "workout");
    for (const id of identity.nodeIds) add(id, "node");
    return index;
  };
  const reportedReuse = new Set<string>();
  const reportReuse = (id: string, from: Namespace, to: Namespace): void => {
    if (from === to) return;
    const subject = id + " (" + from + " -> " + to + ")";
    const ordered = [from, to].sort();
    const key = "id-reused-in-different-namespace|" + id + "|" + ordered[0] + "|" + ordered[1];
    if (reportedReuse.has(key)) return;
    reportedReuse.add(key);
    diagnostics.push({ code: "id-reused-in-different-namespace", subject });
  };
  const namespacePairs = (index: Map<string, Set<Namespace>>): void => {
    for (const [id, found] of index) {
      const ordered = [...found].sort();
      for (let i = 0; i < ordered.length; i += 1) {
        for (let j = i + 1; j < ordered.length; j += 1) {
          reportReuse(id, ordered[i] as Namespace, ordered[j] as Namespace);
        }
      }
    }
  };
  const priorNamespaceIndex = namespaces(prior);
  const currentNamespaceIndex = namespaces(current);
  // Check each candidate independently. This catches current-only collisions and
  // malformed prior identity without treating repeated node IDs across workouts
  // as collisions.
  namespacePairs(priorNamespaceIndex);
  // A surviving ID must retain its namespace. A change in namespace is reported
  // in the historical direction, which keeps diagnostics stable. Run this before
  // the current-side index so a transition wins over its reverse display order.
  for (const [id, priorFound] of priorNamespaceIndex) {
    const currentFound = currentNamespaceIndex.get(id);
    if (currentFound === undefined) continue;
    for (const from of priorFound) {
      for (const to of currentFound) reportReuse(id, from, to);
    }
  }
  namespacePairs(currentNamespaceIndex);

  // Surviving exercises: preserved dimensions and units (Req 6.15); lifecycle transitions.
  const newlyDeprecatedExercises: string[] = [];
  for (const [id, priorExercise] of [...prior.exercises.entries()].sort((a, b) => compareSubjects(a[0], b[0]))) {
    const currentExercise = current.exercises.get(id);
    if (currentExercise === undefined) continue;
    for (const dimension of [...priorExercise.measurements.keys()].sort()) {
      const currentUnits = currentExercise.measurements.get(dimension);
      if (currentUnits === undefined) {
        diagnostics.push({ code: "exercise-dimension-removed", subject: "exercise:" + id + " dimension:" + dimension });
        continue;
      }
      for (const unit of priorExercise.measurements.get(dimension) as string[]) {
        if (currentUnits.indexOf(unit) === -1) {
          diagnostics.push({ code: "exercise-unit-removed", subject: "exercise:" + id + " dimension:" + dimension + " unit:" + unit });
        }
      }
    }
    if (!priorExercise.deprecated && currentExercise.deprecated) {
      newlyDeprecatedExercises.push(id);
    }
    if (priorExercise.deprecated && !currentExercise.deprecated) {
      informational.push({ code: "exercise-reenabled", subject: "exercise:" + id });
    }
  }

  // Surviving workouts: lifecycle transitions.
  for (const [id, priorWorkout] of [...prior.workouts.entries()].sort((a, b) => compareSubjects(a[0], b[0]))) {
    const currentWorkout = current.workouts.get(id);
    if (currentWorkout === undefined) continue;
    if (!priorWorkout.deprecated && currentWorkout.deprecated) {
      informational.push({ code: "workout-newly-deprecated", subject: "workout:" + id });
    }
  }

  // Node identity per surviving workout (Req 6.3, 6.4, 6.15).
  const currentNodeWorkouts = new Map<string, Set<string>>();
  for (const [workoutId, workout] of current.workouts) {
    const ids = new Set<string>();
    for (const nodeId of workout.nodes.keys()) ids.add(nodeId);
    currentNodeWorkouts.set(workoutId, ids);
  }

  for (const [workoutId, priorWorkout] of [...prior.workouts.entries()].sort((a, b) => compareSubjects(a[0], b[0]))) {
    const currentWorkout = current.workouts.get(workoutId);
    if (currentWorkout === undefined) {
      // Every node inside a deleted workout is itself a published node ID deletion (Req 6.1).
      for (const nodeId of [...priorWorkout.nodes.keys()].sort()) {
        diagnostics.push({ code: "node-id-deleted", subject: "workout:" + workoutId + "/node:" + nodeId });
      }
      continue;
    }
    for (const [nodeId, priorNode] of [...priorWorkout.nodes.entries()].sort((a, b) => compareSubjects(a[0], b[0]))) {
      const subject = "workout:" + workoutId + "/node:" + nodeId;
      const currentNode = currentWorkout.nodes.get(nodeId);
      if (currentNode === undefined) {
        diagnostics.push({ code: "node-id-deleted", subject });
        continue;
      }
      if (priorNode.kind !== currentNode.kind) {
        diagnostics.push({ code: "node-type-changed", subject });
        continue;
      }
      if (priorNode.parentId !== currentNode.parentId) {
        diagnostics.push({ code: "node-parent-changed", subject });
      }
      if (priorNode.kind === "exercise") {
        if (priorNode.exerciseId !== currentNode.exerciseId) {
          diagnostics.push({ code: "node-exercise-reference-changed", subject });
        }
      } else {
        if (priorNode.strategy !== currentNode.strategy) {
          diagnostics.push({ code: "node-strategy-changed", subject });
        }
        if (priorNode.scoreContract !== currentNode.scoreContract) {
          diagnostics.push({ code: "node-result-capture-changed", subject });
        }
      }
    }
  }

  // New nodes: reuse of a deleted node ID from another workout, and deprecated references.
  for (const [workoutId, currentWorkout] of [...current.workouts.entries()].sort((a, b) => compareSubjects(a[0], b[0]))) {
    const priorWorkout = prior.workouts.get(workoutId);
    for (const [nodeId, currentNode] of [...currentWorkout.nodes.entries()].sort((a, b) => compareSubjects(a[0], b[0]))) {
      if (priorWorkout !== undefined && priorWorkout.nodes.has(nodeId)) continue; // surviving node, checked above
      const subject = "workout:" + workoutId + "/node:" + nodeId;
      for (const otherWorkout of [...prior.workouts.keys()].sort()) {
        if (otherWorkout === workoutId) continue;
        const priorOther = prior.workouts.get(otherWorkout);
        if (priorOther === undefined || !priorOther.nodes.has(nodeId)) continue;
        const stillPublished = currentNodeWorkouts.get(otherWorkout);
        if (stillPublished !== undefined && stillPublished.has(nodeId)) continue; // still published there
        diagnostics.push({ code: "node-id-reused", subject: subject + " (from workout:" + otherWorkout + ")" });
      }
      if (currentNode.kind === "exercise" && currentNode.exerciseId !== null) {
        const exercise = current.exercises.get(currentNode.exerciseId);
        if (exercise !== undefined && exercise.deprecated) {
          diagnostics.push({ code: "deprecated-exercise-in-new-node", subject });
        }
      }
    }
  }

  // Newly deprecated exercises: report affected workouts and scored or timed containers (Req 6.7).
  const deprecationImpact: (readonly [string, readonly DeprecationImpactEntry[]])[] = [];
  for (const exerciseId of newlyDeprecatedExercises.sort()) {
    const entries: DeprecationImpactEntry[] = [];
    for (const [workoutId, workout] of [...current.workouts.entries()].sort((a, b) => compareSubjects(a[0], b[0]))) {
      const containerIds = new Set<string>();
      let affected = false;
      for (const node of workout.nodes.values()) {
        if (node.kind !== "exercise" || node.exerciseId !== exerciseId) continue;
        affected = true;
        // A container's own ID is exactly the parentId recorded on its children.
        let cursor: NodeIdentity | undefined = node;
        while (cursor !== undefined && cursor.parentId !== null) {
          const parent = workout.nodes.get(cursor.parentId);
          if (parent === undefined) break;
          if (parent.scored || parent.timed) containerIds.add(cursor.parentId);
          cursor = parent;
        }
      }
      if (affected) {
        entries.push({ workoutId, containerIds: [...containerIds].sort() });
      }
    }
    deprecationImpact.push([exerciseId, entries]);
  }

  const sortedInformational = informational.sort((a, b) =>
    a.code === b.code ? compareSubjects(a.subject, b.subject) : a.code < b.code ? -1 : 1
  );

  return {
    status: diagnostics.length === 0 ? "compatible" : "incompatible",
    diagnostics: sortedDiagnostics(diagnostics),
    deprecationImpact,
    informational: sortedInformational
  };
}

// ---------------------------------------------------------------------------
// Bundle ingress validation (schema + semantic) before identity comparison
// ---------------------------------------------------------------------------

export type BundleValidationKind = "schema" | "semantic";

export type BundleValidationOutcome =
  | { readonly ok: true; readonly identity: BundleIdentity }
  | { readonly ok: false; readonly kind: BundleValidationKind; readonly detail: string };

export type CanonicalCandidateValidationOutcome =
  | BundleValidationOutcome
  | {
      readonly ok: false;
      readonly kind: "compatibility";
      readonly detail: string;
      readonly report: CompatibilityReport;
    };

/** Validate one bundle pair with the accepted schema and semantic gates, then extract identity. */
export function validateAndExtract(exercisesDocument: unknown, workoutsDocument: unknown): BundleValidationOutcome {
  const validator = createProductionValidator();
  const exerciseSchema = validator.validate("exercises", 1, exercisesDocument);
  if (!exerciseSchema.valid) {
    return { ok: false, kind: "schema", detail: "exercises document failed schema validation" };
  }
  const workoutSchema = validator.validate("workouts", 1, workoutsDocument);
  if (!workoutSchema.valid) {
    return { ok: false, kind: "schema", detail: "workouts document failed schema validation" };
  }
  const semantic = validateStaticDocuments(exercisesDocument, workoutsDocument);
  if (!semantic.valid) {
    return { ok: false, kind: "semantic", detail: "the bundle pair failed static semantic validation (" + semantic.diagnostics[0].code + ")" };
  }
  return { ok: true, identity: extractBundleIdentity(exercisesDocument, workoutsDocument) };
}

/**
 * Validate a first-release candidate against the explicit blank prior identity.
 * This preserves current-bundle namespace checks while classifying every candidate node as new.
 */
export function validateCanonicalCandidate(exercisesDocument: unknown, workoutsDocument: unknown): CanonicalCandidateValidationOutcome {
  const validation = validateAndExtract(exercisesDocument, workoutsDocument);
  if (!validation.ok) return validation;
  const blankPrior: BundleIdentity = {
    equipmentIds: new Set(),
    exercises: new Map(),
    workouts: new Map(),
    nodeIds: new Set()
  };
  const report = compareBundleIdentities(blankPrior, validation.identity);
  if (report.status !== "compatible") {
    return { ok: false, kind: "compatibility", detail: "the candidate failed static identity compatibility validation", report };
  }
  return validation;
}

/** Read-and-validate both sides of a comparison; the first invalid side fails closed. */
export function compareStaticBundles(
  prior: readonly [unknown, unknown],
  current: readonly [unknown, unknown]
):
  | { readonly ok: true; readonly report: CompatibilityReport }
  | { readonly ok: false; readonly side: "prior" | "current"; readonly kind: BundleValidationKind; readonly detail: string } {
  const priorCheck = validateAndExtract(prior[0], prior[1]);
  if (!priorCheck.ok) return { ok: false, side: "prior", kind: priorCheck.kind, detail: priorCheck.detail };
  const currentCheck = validateAndExtract(current[0], current[1]);
  if (!currentCheck.ok) return { ok: false, side: "current", kind: currentCheck.kind, detail: currentCheck.detail };
  return { ok: true, report: compareBundleIdentities(priorCheck.identity, currentCheck.identity) };
}

/** Parse untrusted bundle bytes exactly (strict UTF-8, no BOM, RFC 8259, no duplicate members). */
export function parseBundleBytes(bytes: Uint8Array): { readonly ok: true; readonly value: unknown } | { readonly ok: false; readonly detail: string } {
  const result = parseExactJson(bytes);
  if (result.ok) return { ok: true, value: result.value };
  return { ok: false, detail: result.detail };
}

// ---------------------------------------------------------------------------
// First-release baseline document and its separate human approval
// ---------------------------------------------------------------------------

export const BASELINE_FORMAT = "repjot/compatibility/baseline";
export const BASELINE_APPROVAL_FORMAT = "repjot/compatibility/baseline-approval";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/** The pinned release manifest for the first (blank-prior) production bundle. */
export interface BaselineDocument {
  readonly format: typeof BASELINE_FORMAT;
  readonly schemaVersion: 1;
  /** `blank` states that no prior production bundle existed; it is never inferred. */
  readonly priorRelease: "blank";
  readonly exercisesSha256: string;
  readonly workoutsSha256: string;
}

/** The separate human approval record bound to one exact first-release bundle by digest. */
export interface BaselineApprovalDocument {
  readonly format: typeof BASELINE_APPROVAL_FORMAT;
  readonly schemaVersion: 1;
  readonly exercisesSha256: string;
  readonly workoutsSha256: string;
}

/** SHA-256 of exact bytes, lowercase hex. */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Deterministic baseline bytes for one exact bundle digest pair. */
export function buildBaselineBytes(exercisesSha256: string, workoutsSha256: string): Uint8Array {
  const document: Record<string, unknown> = {
    format: BASELINE_FORMAT,
    schemaVersion: 1,
    priorRelease: "blank",
    exercisesSha256,
    workoutsSha256
  };
  return new TextEncoder().encode(JSON.stringify(document, null, 2) + "\n");
}

/** Strict envelope validation of a parsed baseline manifest; unknown keys fail closed. */
export function parseBaselineDocument(raw: unknown): { readonly ok: true; readonly document: BaselineDocument } | { readonly ok: false; readonly detail: string } {
  if (!isRecord(raw)) return { ok: false, detail: "the baseline manifest is not a JSON object" };
  const keys = Object.keys(raw).sort();
  const allowed = ["exercisesSha256", "format", "priorRelease", "schemaVersion", "workoutsSha256"];
  if (keys.length !== allowed.length || keys.some((key) => allowed.indexOf(key) === -1)) {
    return { ok: false, detail: "the baseline manifest has unknown or missing keys (allowed: format, schemaVersion, priorRelease, exercisesSha256, workoutsSha256)" };
  }
  if (raw["format"] !== BASELINE_FORMAT) return { ok: false, detail: 'field "format" must be "' + BASELINE_FORMAT + '"' };
  if (raw["schemaVersion"] !== 1) return { ok: false, detail: 'field "schemaVersion" must be 1' };
  if (raw["priorRelease"] !== "blank") return { ok: false, detail: 'field "priorRelease" must be "blank"' };
  if (typeof raw["exercisesSha256"] !== "string" || !SHA256_PATTERN.test(raw["exercisesSha256"])) {
    return { ok: false, detail: 'field "exercisesSha256" must be a 64-character lowercase hexadecimal SHA-256 digest' };
  }
  if (typeof raw["workoutsSha256"] !== "string" || !SHA256_PATTERN.test(raw["workoutsSha256"])) {
    return { ok: false, detail: 'field "workoutsSha256" must be a 64-character lowercase hexadecimal SHA-256 digest' };
  }
  return {
    ok: true,
    document: {
      format: BASELINE_FORMAT,
      schemaVersion: 1,
      priorRelease: "blank",
      exercisesSha256: raw["exercisesSha256"] as string,
      workoutsSha256: raw["workoutsSha256"] as string
    }
  };
}

/** Strict envelope validation of the separate human approval; unknown keys fail closed. */
export function parseBaselineApproval(raw: unknown): { readonly ok: true; readonly approval: BaselineApprovalDocument } | { readonly ok: false; readonly detail: string } {
  if (!isRecord(raw)) return { ok: false, detail: "the baseline approval is not a JSON object" };
  const keys = Object.keys(raw).sort();
  const allowed = ["exercisesSha256", "format", "schemaVersion", "workoutsSha256"];
  if (keys.length !== allowed.length || keys.some((key) => allowed.indexOf(key) === -1)) {
    return { ok: false, detail: "the baseline approval has unknown or missing keys (allowed: format, schemaVersion, exercisesSha256, workoutsSha256)" };
  }
  if (raw["format"] !== BASELINE_APPROVAL_FORMAT) return { ok: false, detail: 'field "format" must be "' + BASELINE_APPROVAL_FORMAT + '"' };
  if (raw["schemaVersion"] !== 1) return { ok: false, detail: 'field "schemaVersion" must be 1' };
  if (typeof raw["exercisesSha256"] !== "string" || !SHA256_PATTERN.test(raw["exercisesSha256"])) {
    return { ok: false, detail: 'field "exercisesSha256" must be a 64-character lowercase hexadecimal SHA-256 digest' };
  }
  if (typeof raw["workoutsSha256"] !== "string" || !SHA256_PATTERN.test(raw["workoutsSha256"])) {
    return { ok: false, detail: 'field "workoutsSha256" must be a 64-character lowercase hexadecimal SHA-256 digest' };
  }
  return {
    ok: true,
    approval: {
      format: BASELINE_APPROVAL_FORMAT,
      schemaVersion: 1,
      exercisesSha256: raw["exercisesSha256"] as string,
      workoutsSha256: raw["workoutsSha256"] as string
    }
  };
}
