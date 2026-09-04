/**
 * Session and result lifecycle checks (P5-T01).
 *
 * Authority: docs/contracts/user-data-contracts.md rows RS-03 (schema primary, sem supporting),
 * RS-04 (session primary, sem supporting), RS-05, RS-06, RS-07, RS-08, RS-09 (schema primary, sem
 * supporting), RS-10, RS-11, RS-18 (sem supporting for WK-12) and its RS-06 input facts ("the frozen plan
 * path (active) or current tree (terminal, TR-05)"); docs/contracts/temporal-and-omission-contracts.md
 * rows TR-04 (an `in_progress` session always executes its frozen plan) and TR-05 (no terminal
 * `executionPlan`; recorded paths overlay the current tree); specs/rep-jot-json-schema-spec.md §5 (Workout
 * Session, Frozen Execution Plan, Execution Path, Exercise Result, Save and Omission Rules) and §8
 * invariants 3-8, 14-18, 24; specs/storage-and-lookup.md §Loading policy; docs/REQUIREMENTS.md 6.11,
 * 11.2-11.7, 11.9, 11.17-11.21.
 *
 * Each session's path and identity resolution follows one decision: the root is the one its own persisted
 * lifecycle names.
 * - `in_progress` resolves in the session's frozen `executionPlan` (Req 6.11; TR-04; spec §5 Frozen
 *   Execution Plan; storage §Loading policy: "An in-progress session always resumes from its frozen plan.
 *   Later bundle corrections or deprecations do not change it."). Invariant 5 and spec §5 name the workout
 *   root the plan itself is a copy of ("`executionPlan` copies the effective workout root, including node
 *   IDs"), so the two readings agree once the correct copy is selected; resolving an active session against
 *   the current bundle instead is the TR-04 negative — "a resumed session silently adopting a new bundle's
 *   nodes".
 * - `completed` and `abandoned` resolve in the retained workout tree, because a terminal session persists
 *   no plan and history overlays recorded results on the current tree (Req 11.17-11.18, TR-05).
 * - An unreadable status keeps the retained-tree behavior: no cited row names a plan rule for a session
 *   that is neither active nor terminal, and `session-status-invalid` is already reported for it.
 *
 * The frozen plan is itself checked against the workout the session references (RS-05, Req 6.11, spec §5
 * Frozen Execution Plan "`executionPlan` copies the effective workout root, including node IDs", invariant 5
 * "Each result path resolves from *that workout's* root", ARCHITECTURE §12 and Req 6.14-6.15 stable IDs):
 * the plan's root must carry the referenced workout root's node ID and every node ID the plan carries must be
 * the referenced workout's node at the same position. Identity, position, role, container strategy, one copy per
 * parent, and the exercise reference are the compared facts, so a plan may still omit nodes and may still differ
 * in labels, prescriptions, scoring rules, and `childDetail`, which is how a start-time omission and an
 * affected scored container are represented (TR-02, Req 6.8). Role and strategy are compared because Req 6.3 and
 * 6.15 keep them out of what a correction may change: the published ID keeps its node role, and a published
 * container keeps its strategy and that strategy's configuration, so a plan that rewrites either one is not a
 * copy of that workout. The two narrower facts close the two fabrications
 * a self-consistent plan still gets past. Under one parent the plan may carry each node ID at most once: the
 * retained parent holds each child once, so a parent that lists one retained child twice is not a copy of it
 * (spec §5 "copies the effective workout root, including node IDs"; Req 6.14 and invariant 23 keep one published
 * ID present once; ARCHITECTURE §12 forbids ID reuse and reparenting). And a plan exercise node carries the
 * referenced workout's exercise reference: spec §5 lists "exercise references" among what the copy preserves and
 * Req 6.15 keeps a published node's exercise reference unchanged, so a plan that points a retained node at a
 * different exercise — another valid exercise or one nothing retains — is not that workout's plan. That second
 * fact is what makes invariant 6 hold for an active session at all, because a result's direct ID is compared with
 * the plan node and the plan node must itself be the retained node's copy. The comparison never runs the other
 * way: a node the plan omits is omitted, never inferred, and an
 * unresolved workout reference or an unreadable retained root disables the comparison instead of guessing at
 * an identity. Resolution still runs in the plan (TR-04), so this check proves the plan is that workout's
 * copy and never replaces it with the current tree.
 *
 * One persisted record is allowed to name a path the frozen plan omits, and it is exactly the record the
 * cited writers create at session start: `status: "skipped"` with `reasonCode: "deprecated"` at the path of
 * an exercise the plan excludes (TR-02; spec §5 Frozen Execution Plan; storage §Loading policy). The
 * exception buys one lookup, never a waiver: every other active record resolves in the frozen plan and
 * nowhere else, and for that one record the plan is precisely the root that cannot resolve the path, so the
 * two persisted facts it carries — its `executionPath` and its direct `exerciseId` — are checked in the
 * retained workout tree, where invariants 23-24 keep the published node and the deprecated exercise
 * resolvable (RS-06, RS-07; invariants 5-6, 24). The lookup runs only when the plan's own finding on that
 * record is that a named node is absent from it, so a malformed path is never rerouted to a second tree,
 * and it decides nothing else: the retained tree proves no fact about the omitted work, so no value, score,
 * child-detail, or merge rule reads it, and such a record is never required or inferred.
 *
 * What this module never does:
 * - It never resolves a session against a score, a plan-derived projection, or an inferred historical
 *   tree: the root is the frozen plan or the retained workout tree named above, chosen by the session's own
 *   status with the one record-class lookup named above as the only exception, and an unreadable root
 *   disables resolution instead of substituting another tree.
 * - It reads no score and derives no child detail. The single score fact any rule reads here is whether a
 *   container result stores a `score` at all, as the partial-data half of the stored-state rule (RS-11); its
 *   type, shape, and agreement with the container's configuration stay unread. RS-12, RS-13, invariant 10-13,
 *   invariant 25, and invariant 28 belong to the score service (Phase 6, Phase 53).
 * - It infers no omission. Under approved D-01 Option A (TR-12) a recorded `reasonCode: "deprecated"`
 *   skip is the only omission evidence and a missing result never proves one, so this module reports
 *   nothing about paths that hold no result, validates only the recorded skip named above, and never
 *   requires `nonstandard` on historical data.
 * - It never mutates its input and never reads a clock, a locale, or randomness.
 */

import type { ExerciseIndexEntry } from "./exercises";
import { findChild, isRecord, nodeKind, repeatedState } from "./workout-index";
import type { WorkoutsSemanticIndex } from "./workout-index";
import { joinPointer } from "./types";
import {
  makeResultDiagnostic,
  REASON_CODES,
  RESULT_SIDES,
  type ResultSemanticCode,
  type ResultSemanticDiagnostic
} from "./result-types";

const TERMINAL_STATUSES: readonly string[] = ["completed", "abandoned"];
const SESSION_STATUSES: readonly string[] = ["in_progress", "completed", "abandoned"];
const STARTING_SIDES: readonly string[] = ["left", "right"];
const EFFORT_TYPES: readonly string[] = ["failure", "rir", "rpe"];

/** The reference directories one session is validated against. */
export interface SessionValidationContext {
  /** Retained workouts: the direct `workoutId` reference (RS-05) and the tree every path resolves in. */
  readonly workouts: WorkoutsSemanticIndex;
  /** Retained exercises including deprecated ones; used for RS-07 and RS-08 (invariants 6-8, 24). */
  readonly exercises: ReadonlyMap<string, ExerciseIndexEntry>;
  /** False disables exercise resolution rather than guessing at references. */
  readonly exercisesAvailable: boolean;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Whether a present path iteration is one-based (RS-06): an integer with no fraction, 1 or greater. */
function isOneBasedIteration(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function push(list: ResultSemanticDiagnostic[], code: ResultSemanticCode, path: string): void {
  list.push(makeResultDiagnostic(code, path));
}

/**
 * The outcome of one path resolution attempt.
 *
 * `absentFromRoot` separates the two ways a root fails to resolve a path, and the caller needs the
 * difference: a root that carries no node for one segment *omits* that path, while an unreadable segment,
 * a wrong root, or a terminal type mismatch is malformed input that no second root may excuse.
 */
interface PathResolution {
  /** The terminal node, present only when every segment resolved in this root. */
  readonly node: Record<string, unknown> | null;
  /** True only when a named segment has no node below its parent segment in this root. */
  readonly absentFromRoot: boolean;
}

/** A failed resolution that says nothing about omission. */
const PATH_NOT_RESOLVED: PathResolution = { node: null, absentFromRoot: false };

/**
 * Resolve one execution path (RS-06, invariant 5) from `rootNode` — the frozen plan root or the retained
 * workout root, per the header — and report every structural violation. The terminal node is returned only
 * when the whole path resolved.
 *
 * The iteration rule follows the specification's own paths: a repeated container contributes a
 * one-based `iteration` on the segment the path *descends through*, and the specification's aggregate
 * container paths (`[root, cindy]`, `[root, blocks]` in §5 and its Complete Monthly Example, and in the
 * accepted Phase 1 fixtures) name a repeated container without an iteration. A terminal segment
 * therefore never gains or loses a diagnostic for carrying an iteration on a repeated container; only
 * the matrix's stated negatives — an iteration on a non-repeated node, and a zero-based iteration — are
 * reported. That tolerance is about absence, never about value: where a segment that names a repeated
 * container does carry an `iteration`, the one-based rule applies to it and a value that is not an integer
 * 1 or greater is reported (`result-path-iteration-invalid`). A segment whose node cannot be read as
 * repeated or fixed stays unreported, because no rule is guessed from unvalidated input.
 */
function resolveExecutionPath(
  pathValue: unknown,
  pathPointer: string,
  rootNode: Record<string, unknown> | null,
  expectedKind: string,
  diagnostics: ResultSemanticDiagnostic[]
): PathResolution {
  if (!Array.isArray(pathValue) || pathValue.length === 0) {
    push(diagnostics, "result-path-unreadable", pathPointer);
    return PATH_NOT_RESOLVED;
  }
  if (rootNode === null) {
    // Nothing to resolve against: the missing workout reference is reported by RS-05 and the missing or
    // unreadable plan by RS-03, so no path fact is provable and none is reported here. An absent root
    // omits nothing, so no second tree is consulted either.
    return PATH_NOT_RESOLVED;
  }

  const rootId = rootNode["id"];
  const firstSegment = pathValue[0];
  const firstPointer = joinPointer(pathPointer, 0);
  if (!isRecord(firstSegment)) {
    push(diagnostics, "result-path-unreadable", firstPointer);
    return PATH_NOT_RESOLVED;
  }
  if (isNonEmptyString(rootId) && firstSegment["nodeId"] !== rootId) {
    push(diagnostics, "result-path-root-mismatch", joinPointer(firstPointer, "nodeId"));
    return PATH_NOT_RESOLVED;
  }

  let current: Record<string, unknown> = rootNode;
  for (let index = 0; index < pathValue.length; index += 1) {
    const segment = pathValue[index];
    const segmentPointer = joinPointer(pathPointer, index);
    if (!isRecord(segment)) {
      push(diagnostics, "result-path-unreadable", segmentPointer);
      return PATH_NOT_RESOLVED;
    }

    const last = index === pathValue.length - 1;
    const kind = nodeKind(current);
    const repeated = repeatedState(current, kind);
    const iteration = segment["iteration"];

    if (iteration !== undefined) {
      if (repeated === "fixed") {
        push(diagnostics, "result-path-iteration-forbidden", joinPointer(segmentPointer, "iteration"));
      } else if (repeated === "repeated" && !isOneBasedIteration(iteration)) {
        push(diagnostics, "result-path-iteration-invalid", joinPointer(segmentPointer, "iteration"));
      }
    } else if (!last && repeated === "repeated") {
      push(diagnostics, "result-path-iteration-missing", segmentPointer);
    }

    if (last) {
      if (expectedKind !== "any" && kind !== expectedKind) {
        push(diagnostics, "result-path-terminal-type-mismatch", segmentPointer);
      }
      return { node: current, absentFromRoot: false };
    }

    // Descend: the next segment must name a child of the current node.
    const next = pathValue[index + 1];
    if (!isRecord(next) || !isNonEmptyString(next["nodeId"])) {
      push(diagnostics, "result-path-unreadable", joinPointer(pathPointer, index + 1));
      return PATH_NOT_RESOLVED;
    }
    const child = kind === "container" ? findChild(current, next["nodeId"]) : null;
    if (child === null) {
      // Covers both an unknown node ID and a path that skips a level or runs past a leaf (RS-06 negatives).
      push(diagnostics, "result-path-node-unresolved", joinPointer(pathPointer, index + 1, "nodeId"));
      return { node: null, absentFromRoot: true };
    }
    current = child;
  }
  return PATH_NOT_RESOLVED; // unreachable: the loop returns at its last segment
}

/** RS-07 (invariant 6) plus invariant 24: the direct ID matches the terminal node and still resolves. */
function checkDirectExercise(
  result: Record<string, unknown>,
  resultPointer: string,
  terminalNode: Record<string, unknown> | null,
  context: SessionValidationContext,
  diagnostics: ResultSemanticDiagnostic[]
): void {
  const exerciseId = result["exerciseId"];
  const pointer = joinPointer(resultPointer, "exerciseId");
  if (!isNonEmptyString(exerciseId)) {
    if (exerciseId !== undefined) {
      push(diagnostics, "result-exercise-unresolved", pointer);
    }
    return;
  }
  if (context.exercisesAvailable) {
    // Deprecated entries stay in the index: historical references must resolve (invariant 24).
    if (!context.exercises.has(exerciseId)) {
      push(diagnostics, "result-exercise-unresolved", pointer);
    }
  }
  if (terminalNode !== null && typeof terminalNode["exerciseId"] === "string") {
    if (terminalNode["exerciseId"] !== exerciseId) {
      push(diagnostics, "result-exercise-mismatch", pointer);
    }
  }
}

/**
 * The retained exercise entry one exercise result measured, read through the node the session's own
 * lifecycle selected. Undefined when the reference cannot be resolved: an unavailable directory or an
 * unresolvable exercise already reports under RS-07, and no dimension or laterality fact is guessed.
 */
function exerciseFor(
  terminalNode: Record<string, unknown> | null,
  context: SessionValidationContext
): ExerciseIndexEntry | undefined {
  if (!context.exercisesAvailable || terminalNode === null) {
    return undefined;
  }
  const exerciseId = terminalNode["exerciseId"];
  return isNonEmptyString(exerciseId) ? context.exercises.get(exerciseId) : undefined;
}

/**
 * True when the record carries at least one measured value. `reps: 0` is a measured unsuccessful attempt,
 * not a skip (Req 11.2, RS-08), so a zero counts. A `values` field that is absent or holds no dimension
 * records no actual measurement.
 */
function hasMeasuredValues(result: Record<string, unknown>): boolean {
  const values = result["values"];
  return isRecord(values) && Object.keys(values).length > 0;
}

/** RS-08 (invariants 7-8): only supported dimensions with compatible units, and never effort (WK-12). */
function checkValues(
  result: Record<string, unknown>,
  resultPointer: string,
  terminalNode: Record<string, unknown> | null,
  context: SessionValidationContext,
  diagnostics: ResultSemanticDiagnostic[]
): void {
  const values = result["values"];
  if (values === undefined) {
    return;
  }
  const valuesPointer = joinPointer(resultPointer, "values");
  if (!isRecord(values)) {
    return; // malformed shape is schema-owned
  }

  // WK-12 (sem supporting): effort is an outcome, never a measurement dimension.
  if (values["effort"] !== undefined) {
    push(diagnostics, "result-values-contain-effort", joinPointer(valuesPointer, "effort"));
  }

  const exercise = exerciseFor(terminalNode, context);
  if (exercise === undefined) {
    // Dimensions come from the referenced exercise; nothing is guessed, and an unresolvable reference is
    // already reported by RS-07.
    return;
  }

  const keys = Object.keys(values);
  for (let i = 0; i < keys.length; i += 1) {
    const dimension = keys[i];
    if (dimension === "effort") {
      continue; // reported above as WK-12's rule
    }
    const valuePointer = joinPointer(valuesPointer, dimension);
    const allowed = exercise.dimensions.get(dimension);
    if (allowed === undefined) {
      push(diagnostics, "result-value-dimension-unsupported", valuePointer);
      continue;
    }
    if (dimension === "reps") {
      continue; // `reps` is a plain count; its controlled unit "rep" carries no unit object
    }
    const quantity = values[dimension];
    if (!isRecord(quantity) || !isNonEmptyString(quantity["unit"])) {
      continue; // malformed quantity shape is schema-owned
    }
    if (allowed.indexOf(quantity["unit"]) === -1) {
      push(diagnostics, "result-value-unit-incompatible", joinPointer(valuePointer, "unit"));
    }
  }
}

/**
 * Req 11.5-11.7 (RS-09): `side` is normally absent for bilateral work and required when unilateral actuals
 * are recorded. "Actuals" is the same fact RS-08 reads — a measured value — so a unilateral zero-repetition
 * attempt still names the side it measured and a skip with no `values` asks for no side at all.
 *
 * The laterality comes from the retained exercise directory through the same lifecycle-selected node the
 * measured values are checked against. The retained tree that resolves a recorded omission's path and direct
 * ID is never consulted here, because it proves nothing about what that omitted work measured, and an entry
 * with no readable laterality never produces a side requirement.
 */
function recordsUnilateralActuals(
  result: Record<string, unknown>,
  terminalNode: Record<string, unknown> | null,
  context: SessionValidationContext
): boolean {
  if (!hasMeasuredValues(result)) {
    return false; // no measured data, so there is no actual to attribute to a side
  }
  const exercise = exerciseFor(terminalNode, context);
  return exercise !== undefined && exercise.laterality === "unilateral";
}

/**
 * RS-09 (invariant 15): the sem supporting assertion over the conditional starting-side rule, plus the
 * unilateral requirement the schema cannot state.
 *
 * The two halves stay independent and each reports at its own field: a missing `side` and a malformed
 * `startingSide` are different facts, and a `startingSide` is never a substitute for a side because it names
 * only where an alternating set started. A `side` that is present never also reports as missing, so a record
 * states one finding per field.
 */
function checkSides(
  result: Record<string, unknown>,
  resultPointer: string,
  terminalNode: Record<string, unknown> | null,
  context: SessionValidationContext,
  diagnostics: ResultSemanticDiagnostic[]
): void {
  const side = result["side"];
  const startingSide = result["startingSide"];
  if (side !== undefined) {
    if (RESULT_SIDES.indexOf(side as string) === -1) {
      push(diagnostics, "result-side-invalid", joinPointer(resultPointer, "side"));
    }
  } else if (recordsUnilateralActuals(result, terminalNode, context)) {
    push(diagnostics, "result-unilateral-side-required", joinPointer(resultPointer, "side"));
  }
  if (startingSide === undefined) {
    if (side === "alternating") {
      push(diagnostics, "result-starting-side-required", joinPointer(resultPointer, "startingSide"));
    }
    return;
  }
  if (side !== "alternating" || STARTING_SIDES.indexOf(startingSide as string) === -1) {
    push(diagnostics, "result-starting-side-forbidden", joinPointer(resultPointer, "startingSide"));
  }
}

/**
 * RS-11 with spec §5 Save and Omission Rules: `incomplete` is stored only when partial values, timing, a
 * reason code, or notes are relevant, because REP JOT stores no state it inferred. "Relevant" is read
 * strictly, so a placeholder field never silences the rule: the partial-data field must hold something (an
 * exercise result names it in `values`, a container result in `score`), a time must be a non-empty string,
 * and notes must carry text. A `reasonCode` counts as soon as it is present — an uncontrolled code already
 * reports under RS-11 and never earns a second finding.
 */
function checkIncompleteState(
  result: Record<string, unknown>,
  resultPointer: string,
  diagnostics: ResultSemanticDiagnostic[]
): void {
  if (result["status"] !== "incomplete") {
    return; // `completed` and `skipped` carry their own rules elsewhere (RS-08, RS-12)
  }
  if (hasMeasuredValues(result) || isRecord(result["score"])) {
    return;
  }
  if (isNonEmptyString(result["startedAtUtc"]) || isNonEmptyString(result["endedAtUtc"])) {
    return;
  }
  if (result["reasonCode"] !== undefined) {
    return;
  }
  if (isNonEmptyString(result["notes"])) {
    return;
  }
  push(diagnostics, "result-incomplete-without-evidence", joinPointer(resultPointer, "status"));
}

/** RS-11: the reason code stays inside the controlled enum; free text belongs in notes. */
function checkReasonCode(
  result: Record<string, unknown>,
  resultPointer: string,
  diagnostics: ResultSemanticDiagnostic[]
): void {
  const reasonCode = result["reasonCode"];
  if (reasonCode === undefined) {
    return;
  }
  if (REASON_CODES.indexOf(reasonCode as string) === -1) {
    push(diagnostics, "result-reason-code-invalid", joinPointer(resultPointer, "reasonCode"));
  }
}

/**
 * RS-18 (WK-12 supporting): the observed effort outcome keeps one of the three controlled shapes and
 * stays out of `values`. Numeric bounds stay the schema's; they are restated here only so the semantic
 * pass cannot accept a malformed outcome on input it did not receive from the schema gate.
 */
function checkEffort(
  result: Record<string, unknown>,
  resultPointer: string,
  diagnostics: ResultSemanticDiagnostic[]
): void {
  const effort = result["effort"];
  if (effort === undefined) {
    return;
  }
  const pointer = joinPointer(resultPointer, "effort");
  if (!isRecord(effort) || typeof effort["type"] !== "string" || EFFORT_TYPES.indexOf(effort["type"]) === -1) {
    push(diagnostics, "result-effort-invalid", pointer);
    return;
  }
  if (effort["type"] === "failure") {
    if (typeof effort["achieved"] !== "boolean") {
      push(diagnostics, "result-effort-invalid", pointer);
    }
    return;
  }
  const value = effort["value"];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    push(diagnostics, "result-effort-invalid", pointer);
    return;
  }
  if (effort["type"] === "rpe" && (value < 1 || value > 10)) {
    push(diagnostics, "result-effort-invalid", pointer);
  }
}

/** RS-10 (invariant 14): the uniqueness tuple is workout, path, side, and attempt (default 1). */
function identityKey(result: Record<string, unknown>): string | null {
  const workoutId = typeof result["workoutId"] === "string" ? result["workoutId"] : "";
  const pathValue = result["executionPath"];
  if (!Array.isArray(pathValue) || pathValue.length === 0) {
    return null; // no readable path: uniqueness cannot be proven
  }
  const parts: string[] = [workoutId];
  for (let i = 0; i < pathValue.length; i += 1) {
    const segment = pathValue[i];
    if (!isRecord(segment)) {
      return null;
    }
    const nodeId = typeof segment["nodeId"] === "string" ? segment["nodeId"] : "";
    const iteration = typeof segment["iteration"] === "number" ? String(segment["iteration"]) : "-";
    parts.push(nodeId + ":" + iteration);
  }
  // An absent side is its own tuple value: the contract never equates it with `both`.
  parts.push(typeof result["side"] === "string" ? result["side"] : "\u0000absent");
  const attempt = result["attempt"];
  parts.push(attempt === undefined ? "1" : String(attempt));
  return parts.join("\u0000");
}

/** RS-10: reject an attempt number that is not a one-based integer; absence defaults to 1. */
function checkAttempt(
  result: Record<string, unknown>,
  resultPointer: string,
  diagnostics: ResultSemanticDiagnostic[]
): void {
  const attempt = result["attempt"];
  if (attempt === undefined) {
    return;
  }
  if (typeof attempt !== "number" || !Number.isInteger(attempt) || attempt < 1) {
    push(diagnostics, "result-attempt-invalid", joinPointer(resultPointer, "attempt"));
  }
}

/**
 * The one persisted record whose path the frozen plan may omit (TR-02; spec §5 Frozen Execution Plan;
 * storage §Loading policy). Both persisted fields are read: the record is a *skipped* result carrying the
 * `deprecated` reason, and no other record is excused from plan resolution. Being such a record buys only a
 * second lookup of its own path and direct ID in the retained tree — never a waiver of either check.
 */
function isRecordedPlanOmission(result: Record<string, unknown>): boolean {
  return result["status"] === "skipped" && result["reasonCode"] === "deprecated";
}

/**
 * The root one session's paths and identities resolve in, selected by the session's own persisted status
 * (header). An `in_progress` session with no readable plan resolves nothing: the plan is the cited root and
 * its absence is already reported as `session-plan-required`, so the current tree is never substituted.
 */
function resolutionRootFor(
  session: Record<string, unknown>,
  lifecycle: "in_progress" | "terminal" | "unknown",
  workoutRoot: Record<string, unknown> | null
): Record<string, unknown> | null {
  if (lifecycle !== "in_progress") {
    return workoutRoot;
  }
  const plan = session["executionPlan"];
  return isRecord(plan) ? plan : null;
}

/** One position of the frozen-plan walk: one plan node and the retained node it must be a copy of. */
interface PlanDescent {
  readonly planNode: Record<string, unknown>;
  readonly retainedNode: Record<string, unknown>;
  readonly pointer: string;
}

/**
 * The two shape facts one plan node owes the retained node it copies: its role, and for a container its
 * strategy identity (Req 6.3 "An existing ID cannot be repurposed for a different entity or node role",
 * Req 6.11 and 6.15, spec §5 Frozen Execution Plan "including node IDs, exercise references, strategies",
 * invariants 5-6, WK-03/WK-17 "parent, type, exercise ref, strategy, capture, units", ARCHITECTURE §12 and §17).
 *
 * Each fact is read the way the copy rule reads it, and never guessed:
 * - A role is compared only where both nodes name one, so a plan node with no readable `type` is schema shape.
 *   A retained container the plan rewrote as an exercise node, and a retained exercise node the plan rewrote as
 *   a container, are the same fabrication: the published ID now carries another node role (Req 6.3), and no path
 *   check can see it, because a path that resolves inside the plan still resolves.
 * - A strategy is compared only between two containers, and only by its name. The name is the fact the shape list
 *   preserves (WK-03/WK-17 "strategy", WK-03's persisted shape fields "parent, type, exercise ref, strategy,
 *   capture, units"), and Req 6.14-6.15 never let a published container change it, so a plan that names another
 *   strategy copies nothing.
 * - `strategyConfig` is never compared. The other half of this comparison is the *current* retained tree, and
 *   TR-04 (supporting: spec §5 Frozen Execution Plan, Req 6.11) states that an `in_progress` session executes its
 *   frozen plan after reload or deployment and that later static corrections never change it. A corrected
 *   configuration — a fixed `rounds` count, a corrected `interval` or `duration` — is exactly such a later
 *   correction, and WK-17 keeps the configuration out of the build comparison as well, which compares one bundle
 *   with the next and never a plan with a bundle. Comparing these values here would reject the one plan state TR-04
 *   requires: a plan that still carries the configuration the session started with. WK-04 bounds each shape, and the
 *   schema owns it, so nothing is lost by reading no value here.
 *   The scoring contract is not read here either: TR-02 changes `childDetail` in the plan on purpose, and score
 *   facts belong to the score service (RS-12, RS-13, invariants 10-13, 28).
 *
 * Returns whether the roles differ, which is how the caller stops descending into a node that copies nothing.
 */
function checkCopiedRoleAndStrategy(
  planNode: Record<string, unknown>,
  retainedNode: Record<string, unknown>,
  pointer: string,
  diagnostics: ResultSemanticDiagnostic[]
): boolean {
  const planKind = nodeKind(planNode);
  const retainedKind = nodeKind(retainedNode);
  if (planKind !== "unknown" && retainedKind !== "unknown" && planKind !== retainedKind) {
    push(diagnostics, "session-plan-node-role-mismatch", joinPointer(pointer, "type"));
    return true;
  }
  if (planKind !== "container" || retainedKind !== "container") {
    return false; // an exercise node names no strategy, and an unreadable role proves nothing
  }
  const planStrategy = planNode["strategy"];
  const retainedStrategy = retainedNode["strategy"];
  if (!isNonEmptyString(planStrategy) || !isNonEmptyString(retainedStrategy)) {
    return false; // an unreadable strategy is schema shape (WK-04), so no strategy is assumed
  }
  if (planStrategy !== retainedStrategy) {
    // One finding for the strategy name, and no comparison of either side's `strategyConfig`: a later retained
    // correction to those values changes no plan and proves nothing about this plan (TR-04).
    push(diagnostics, "session-plan-strategy-mismatch", joinPointer(pointer, "strategy"));
  }
  return false;
}

/**
 * The two positional identity facts an `in_progress` session's frozen plan owes the workout it references
 * (RS-05, Req 6.11, spec §5 Frozen Execution Plan, invariant 5, ARCHITECTURE §12 stable IDs). The two shape
 * facts of each pair — role and strategy — are compared by `checkCopiedRoleAndStrategy`:
 *
 * 1. Its root carries the referenced workout root's node ID. The plan *is* a copy of that root, so a plan
 *    that names another root — or names no readable root at all, which proves nothing — is not that copy.
 *    `result-path-root-mismatch` cannot cover this: it compares a path with the plan, so a plan and its paths
 *    that are fabricated together are self-consistent and report nothing.
 * 2. Every node ID the plan carries is the referenced workout's node at the same position. Node IDs are
 *    stable and never reused or reparented (invariant 23, Req 6.14-6.15), so a plan node that exists nowhere
 *    at that position, or a retained node ID moved under a different parent, is fabricated rather than frozen.
 *
 * The walk is one-directional and that is the whole point: the plan may omit nodes, because that is how a
 * start-time deprecation is represented (TR-02; spec §5 "Exercises deprecated before the start are absent"),
 * and it may change any content a correction or an affected scored container changes (Req 6.16 keeps labels,
 * instructions, notes, and prescriptions out of every comparison, and TR-02 changes one container's
 * `childDetail`). What it may not change is the shape it copies: a copied node's role (Req 6.3, 6.15; spec §5
 * "including node IDs"; ARCHITECTURE §12 "role changes") or a copied container's strategy name (Req 6.15; spec §5
 * "strategies"; WK-03, WK-17). That strategy's `strategyConfig` values are read by no comparison here, because the
 * retained side of every comparison is the current tree and a valid later correction to those values must leave an
 * active plan valid (TR-04, Req 6.11). Role and strategy are compared for the root pair and for every matched child
 * pair, and every fact here is reported at its own field, so one changed fact is one finding.
 *
 * Only the topmost node of an unresolved chain is reported, so one fabrication is one finding and its descendants
 * add no cascade: a second copy is reported at its own identifier and its subtree is never walked, because a copy
 * the workout does not hold proves nothing about what hangs below it, and a node of another role is the same kind
 * of non-copy, so the walk stops there too. Duplicates are counted per parent, which is the unit the copy
 * relationship has; the same ID under a different parent is fabricated ancestry and stays
 * `session-plan-node-unresolved`. An exercise reference is compared only where both sides name one, so a plan
 * node that drops the field is schema shape and reports nothing here; a role or strategy is compared only where
 * both sides name one, for the same reason.
 *
 * An unstructured child entry or unreadable `children` array is shape, owned by the schema, so the walk stops
 * there and guesses nothing. Iterative, like every other walk here, because the targeted devices have a small
 * stack.
 */
function checkFrozenPlanIdentity(
  plan: Record<string, unknown>,
  workoutRoot: Record<string, unknown>,
  basePath: string,
  diagnostics: ResultSemanticDiagnostic[]
): void {
  const planPointer = joinPointer(basePath, "executionPlan");
  const retainedRootId = workoutRoot["id"];
  if (!isNonEmptyString(retainedRootId)) {
    return // the retained workout root names no ID: no identity is provable and none is guessed
  }
  if (plan["id"] !== retainedRootId) {
    push(diagnostics, "session-plan-root-mismatch", joinPointer(planPointer, "id"));
  }
  // The plan root is a copied node like every other node in the walk, so its role and its strategy are
  // compared by the same rules: the plan *is* a copy of that root, and a root of another role or strategy is
  // not it.
  checkCopiedRoleAndStrategy(plan, workoutRoot, planPointer, diagnostics);

  const queue: PlanDescent[] = [{ planNode: plan, retainedNode: workoutRoot, pointer: planPointer }];
  for (let i = 0; i < queue.length; i += 1) {
    const descent: PlanDescent | undefined = queue[i];
    if (descent === undefined) {
      continue;
    }
    const children = descent.planNode["children"];
    if (!Array.isArray(children)) {
      continue; // unreadable children: the schema owns the shape and no node is invented
    }
    // The identifiers this one parent has already matched. Per parent is the unit the copy relationship has:
    // the retained parent holds each child once, so a second copy under the same parent copies nothing.
    const matchedChildIds = new Set<string>();
    for (let c = 0; c < children.length; c += 1) {
      const child = children[c];
      if (!isRecord(child)) {
        continue; // unstructured node is schema-owned
      }
      const childPointer = joinPointer(joinPointer(descent.pointer, "children"), c);
      const childId = child["id"];
      if (!isNonEmptyString(childId)) {
        push(diagnostics, "session-plan-node-unresolved", joinPointer(childPointer, "id"));
        continue; // no readable identifier: the schema owns the shape and no identity is assumed
      }
      const retained = findChild(descent.retainedNode, childId);
      if (retained === null) {
        push(diagnostics, "session-plan-node-unresolved", joinPointer(childPointer, "id"));
        continue;
      }
      if (matchedChildIds.has(childId)) {
        // One finding for the copy, and its subtree stays unwalked: the walk already descended into the node
        // this copy repeats, so the copy proves nothing that the first occurrence did not already prove.
        push(diagnostics, "session-plan-node-duplicate", joinPointer(childPointer, "id"));
        continue;
      }
      // Role and strategy are copied shape facts (spec §5, Req 6.3 and 6.15), reported at their own fields and
      // independently of every other fact here, so a plan node that changes two of them reports two findings.
      const roleChanged = checkCopiedRoleAndStrategy(child, retained, childPointer, diagnostics);
      // The exercise reference is a copied fact (spec §5, Req 6.15). Both sides must name one: a plan node with
      // no readable `exerciseId` is schema shape, and an unreadable retained reference proves nothing, so
      // neither half is guessed.
      const retainedExerciseId = retained["exerciseId"];
      const planExerciseId = child["exerciseId"];
      if (
        isNonEmptyString(retainedExerciseId) &&
        isNonEmptyString(planExerciseId) &&
        planExerciseId !== retainedExerciseId
      ) {
        push(diagnostics, "session-plan-exercise-mismatch", joinPointer(childPointer, "exerciseId"));
      }
      matchedChildIds.add(childId);
      if (roleChanged) {
        // One finding for the repurposed node, and its subtree stays unwalked for the reason the duplicate rule
        // gives: a node of another role copies nothing, so what hangs below it proves nothing about the workout.
        continue;
      }
      queue.push({ planNode: child, retainedNode: retained, pointer: childPointer });
    }
  }
}

/**
 * RS-03 (invariants 17-18), RS-04 (invariant 16), RS-05 (invariants 3-4), TR-04, and TR-05 for one session.
 * Returns the session's readable ID, or null, so the caller can run the shard-level identity rules.
 */
export function validateSession(
  session: Record<string, unknown>,
  basePath: string,
  context: SessionValidationContext,
  diagnostics: ResultSemanticDiagnostic[]
): string | null {
  const id = session["id"];
  if (!isNonEmptyString(id)) {
    push(diagnostics, "session-id-unreadable", joinPointer(basePath, "id"));
  }

  const status = session["status"];
  let lifecycle: "in_progress" | "terminal" | "unknown" = "unknown";
  if (status === "in_progress") {
    lifecycle = "in_progress";
  } else if (typeof status === "string" && TERMINAL_STATUSES.indexOf(status) !== -1) {
    lifecycle = "terminal";
  }
  if (typeof status === "string" && SESSION_STATUSES.indexOf(status) === -1) {
    push(diagnostics, "session-status-invalid", joinPointer(basePath, "status"));
  }

  const hasEndedAt = session["endedAtUtc"] !== undefined;
  const hasPlan = session["executionPlan"] !== undefined;
  if (lifecycle === "in_progress") {
    if (hasEndedAt) {
      push(diagnostics, "session-ended-at-forbidden", joinPointer(basePath, "endedAtUtc"));
    }
    if (!hasPlan || !isRecord(session["executionPlan"])) {
      push(diagnostics, "session-plan-required", joinPointer(basePath, "executionPlan"));
    }
  } else if (lifecycle === "terminal") {
    if (!hasEndedAt) {
      push(diagnostics, "session-ended-at-required", joinPointer(basePath, "endedAtUtc"));
    }
    // TR-05 and Req 11.18: a terminal session never persists an execution plan.
    if (hasPlan) {
      push(diagnostics, "session-plan-forbidden", joinPointer(basePath, "executionPlan"));
    }
  }

  // RS-04 (invariant 16): every session carries its last-correction time.
  if (session["updatedAtUtc"] === undefined || !isNonEmptyString(session["updatedAtUtc"])) {
    push(diagnostics, "session-updated-at-missing", joinPointer(basePath, "updatedAtUtc"));
  }

  // RS-05 (invariants 3-4). Deprecated workouts stay resolvable (invariant 24). The session's `workoutId`
  // always names a retained workout, in every lifecycle state; the plan an `in_progress` session carries is
  // a copy of that workout's root, so the two references describe the same workout.
  const workoutId = session["workoutId"];
  let workoutRoot: Record<string, unknown> | null = null;
  if (context.workouts.available) {
    const entry = isNonEmptyString(workoutId) ? context.workouts.workouts.get(workoutId) : undefined;
    if (entry === undefined) {
      push(diagnostics, "session-workout-unresolved", joinPointer(basePath, "workoutId"));
    } else {
      workoutRoot = entry.root;
    }
  }

  // TR-04 / Req 6.11 for an active session, TR-05 / Req 11.17 for a terminal one: the root the paths and
  // the direct-ID comparison resolve in. An unresolvable workout never stops an active session's plan
  // resolution, because the frozen plan is self-contained; the reference is reported on its own above.
  const resolutionRoot = resolutionRootFor(session, lifecycle, workoutRoot);
  const resolveFromPlan = lifecycle === "in_progress";

  // Req 6.11 / RS-05 for an active session: the plan itself must be a copy of the referenced workout's root
  // and stable node ancestry. Each fact reports on its own, so this runs alongside path resolution and blocks
  // nothing. A terminal session persists no plan and reports `session-plan-forbidden` above, so no plan rule
  // is applied to one, and an unresolved workout or unreadable plan disables this comparison rather than
  // substituting another tree.
  if (resolveFromPlan && resolutionRoot !== null && workoutRoot !== null) {
    checkFrozenPlanIdentity(resolutionRoot, workoutRoot, basePath, diagnostics);
  }

  const results = session["results"];
  if (!Array.isArray(results)) {
    return isNonEmptyString(id) ? id : null;
  }

  const seenIdentities = new Set<string>();
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    const resultPointer = joinPointer(basePath, "results", i);
    if (!isRecord(result)) {
      continue; // unstructured entry is schema-owned
    }

    if (isNonEmptyString(workoutId) && result["workoutId"] !== workoutId) {
      push(diagnostics, "result-workout-mismatch", joinPointer(resultPointer, "workoutId"));
    }

    const kind = nodeKindFromResult(result["type"]);
    const pathPointer = joinPointer(resultPointer, "executionPath");

    // The lifecycle-selected root resolves first, and its findings stay on hold only long enough to decide
    // the one cited exception below. Ordinary active records keep the frozen plan as their only root.
    const held: ResultSemanticDiagnostic[] = [];
    const primary = resolveExecutionPath(result["executionPath"], pathPointer, resolutionRoot, kind, held);

    // The recorded omission of a node the frozen plan excludes (TR-02) is the single record whose path may
    // be looked up again, and only for its own two persisted facts: the path shape and the direct exercise ID
    // are checked in the retained tree, which keeps the published node and the deprecated exercise present
    // (invariants 23-24). A plan failure of any other kind is malformed input and is never rerouted, and a
    // session with no readable plan has no plan to be absent from. The retained tree is consulted for these
    // two checks only: it proves nothing about the omitted work, so no value, score, or merge rule reads it.
    const resolveAgainInRetainedTree =
      resolveFromPlan &&
      resolutionRoot !== null &&
      primary.node === null &&
      primary.absentFromRoot &&
      workoutRoot !== null &&
      isRecordedPlanOmission(result);

    let pathNode = primary.node;
    if (resolveAgainInRetainedTree) {
      const retained = resolveExecutionPath(result["executionPath"], pathPointer, workoutRoot, kind, diagnostics);
      pathNode = retained.node;
    } else {
      for (let i = 0; i < held.length; i += 1) {
        diagnostics.push(held[i]);
      }
    }

    if (kind === "exercise") {
      checkDirectExercise(result, resultPointer, pathNode, context, diagnostics);
      // Measured values keep the lifecycle-selected node: the retained tree is consulted for the path and
      // the direct ID of an omission record, never for what the omitted work would have measured.
      checkValues(result, resultPointer, primary.node, context, diagnostics);
      // Sides read the same node the values do: laterality is a fact of the exercise this record measured.
      checkSides(result, resultPointer, primary.node, context, diagnostics);
      checkEffort(result, resultPointer, diagnostics);
      checkAttempt(result, resultPointer, diagnostics);
    }

    checkReasonCode(result, resultPointer, diagnostics);
    checkIncompleteState(result, resultPointer, diagnostics);

    // RS-10 (invariant 14) is stated for exercise results. Container-result-per-path uniqueness is
    // invariant 13, owned with the score service, so no tuple is built for a container result here.
    if (kind === "exercise") {
      const key = identityKey(result);
      if (key !== null) {
        if (seenIdentities.has(key)) {
          push(diagnostics, "result-identity-duplicate", resultPointer);
        } else {
          seenIdentities.add(key);
        }
      }
    }
  }

  return isNonEmptyString(id) ? id : null;
}

/** Map the result discriminator to the node kind its path must end at (RS-06, invariant 5). */
function nodeKindFromResult(type: unknown): "container" | "exercise" | "any" {
  if (type === "container") {
    return "container";
  }
  if (type === "exercise") {
    return "exercise";
  }
  return "any";
}

/** Whether a session status value is terminal; used by the shard-level and correction rules. */
export function isTerminalStatus(session: Record<string, unknown>): boolean {
  const status = session["status"];
  return typeof status === "string" && TERMINAL_STATUSES.indexOf(status) !== -1;
}
