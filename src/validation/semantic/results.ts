/**
 * Result shard lifecycle validation (P5-T01) — the public entry point of the result semantic pass.
 *
 * Authority: docs/contracts/user-data-contracts.md rows RS-01 (sem primary; invariant 19), RS-03
 * through RS-11, RS-15 (sem document-exclusivity check; invariant 20 document half), RS-02 and RS-15
 * identity uniqueness (Req 11.14, Req 11.22; docs/ARCHITECTURE.md §12), RS-17 (sem
 * document-link check; invariant 22 document half), RS-18, RS-19, and the invariants 1-28 ownership
 * summary; docs/contracts/families-and-files.md row FF-04 (filename, `yearMonthUtc`, and every session
 * `startedAtUtc` agree); docs/contracts/temporal-and-omission-contracts.md rows TR-04, TR-05, TR-08, TR-12
 * (each session's paths and direct IDs resolve in its frozen plan while `in_progress` and in the retained
 * workout tree once terminal — see `result-session`);
 * specs/rep-jot-json-schema-spec.md §5 and §8; docs/REQUIREMENTS.md 3.3-3.4, 11.3-11.7, 11.14, 11.23.
 *
 * Scope is the current document state only, as the phase requires. Identity uniqueness, exclusivity, and
 * link integrity are checked as facts of this one shard: one ID names one live session and one ID is
 * tombstoned once (Req 11.14, Req 11.22; docs/ARCHITECTURE.md §12 "UUID uniqueness, tombstone uniqueness"),
 * a live session and a tombstone never share an ID, and a sync copy names a different ID this shard already
 * knows. A copy forks the session both sides changed, and that source keeps the same ID whether the shard now
 * holds it as a live session or as the tombstone of a session deleted afterwards, so either state satisfies
 * the link and only an ID in neither state breaks it (spec §5 "Session Sync Copy"; RS-17 fails on "a
 * `conflictOfSessionId` pointing at an absent ID in the shard"). Merge precedence, tombstone-versus-live wins,
 * ID reservation, retry, and convergence belong to Phases 37-42, and the `Sync copy` history label belongs to
 * Phase 75.
 *
 * The logical shard file name is a required argument, because RS-01 lists "Filename + `yearMonthUtc` +
 * envelope fields" as its input facts and FF-04 makes `results-YYYY-MM.json` the family's canonical
 * location: the pass reports `shard-file-name-month-unreadable` when that name is absent or unreadable and
 * otherwise proves the cited agreement, so no caller can validate a shard while skipping the filename half
 * of the row.
 *
 * RS-19 is validated by exclusion: a shard's identity comes from the session `startedAtUtc` alone, so a
 * result-level `startedAtUtc` or `endedAtUtc` in any other month never produces a shard diagnostic.
 * Timestamp *format* stays FF-12's (schema plus the Phase 12 format assertion); this module reads only
 * the UTC year and month it needs and reports `session-start-month-unreadable` when even that cannot be
 * derived, because the row's own input fact is then missing.
 *
 * Score, child-detail, and deprecated-omission behavior is delegated to the separate Phase 6 score module
 * below. Under approved D-01 Option A (TR-12), that module uses a recorded `reasonCode: "deprecated"` skip
 * as the only omission evidence, never inspects missing paths as evidence, and never rejects a terminal
 * document for a historical fact it cannot prove.
 *
 * Pure: the `unknown` inputs are never mutated, no clock, locale, randomness, storage, or browser
 * module is read, and repeated calls on equal inputs return identical sorted diagnostics.
 */

import { buildExercisesModel } from "./exercises";
import { buildWorkoutIndex } from "./workout-index";
import { finalizeDiagnostics, joinPointer } from "./types";
import { makeResultDiagnostic, type ResultSemanticDiagnostic, type ResultSemanticResult } from "./result-types";
import { validateSession, type SessionValidationContext } from "./result-session";
import { validateResultScores } from "./result-score";

const YEAR_MONTH_TEXT = /^([0-9]{4})-([0-9]{2})$/;
const SHARD_FILE_NAME = /^results-([0-9]{4})-([0-9]{2})\.json$/;
const UTC_INSTANT = /^([0-9]{4})-([0-9]{2})-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A month number outside 01..12 carries no UTC month, so the row's input fact cannot be read. */
function monthText(month: string): string | null {
  const number = Number(month);
  if (!Number.isInteger(number) || number < 1 || number > 12) {
    return null;
  }
  return month;
}

/** The `YYYY-MM` identity of a `YYYY-MM` string, or null when it cannot be read (RS-01 input fact). */
function readYearMonth(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = YEAR_MONTH_TEXT.exec(value);
  if (match === null) {
    return null;
  }
  const month = monthText(match[2]);
  return month === null ? null : match[1] + "-" + month;
}

/**
 * The `YYYY-MM` identity of a shard file name, or null when the name carries no readable monthly shard
 * month — a name that is absent, not a string, empty, or not of the `results-YYYY-MM.json` shape.
 */
function readShardFileName(name: unknown): string | null {
  if (typeof name !== "string") {
    return null;
  }
  const match = SHARD_FILE_NAME.exec(name);
  if (match === null) {
    return null;
  }
  const month = monthText(match[2]);
  return month === null ? null : match[1] + "-" + month;
}

/** The UTC year and month of a `Z`-suffixed instant, or null when even the month cannot be derived. */
function readStartYearMonth(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = UTC_INSTANT.exec(value);
  if (match === null) {
    return null;
  }
  const month = monthText(match[2]);
  return month === null ? null : match[1] + "-" + month;
}

function finalize(diagnostics: ResultSemanticDiagnostic[]): ResultSemanticResult {
  const finalized = finalizeDiagnostics(diagnostics);
  return { valid: finalized.length === 0, diagnostics: finalized };
}

/**
 * Validate one results shard document against the retained static directories.
 *
 * `shardFileName` is required and covers the filename half of RS-01 / FF-04: the logical
 * `results-YYYY-MM.json` name is a persisted input fact of RS-01 ("Filename + `yearMonthUtc` + envelope
 * fields") and the canonical location FF-04 gives the family (Req 3.3-3.4, spec §5 "`yearMonthUtc` must
 * match the `YYYY-MM` part of the file name"), so this pass never runs without it and never substitutes
 * a guessed name. The month the name carries must equal `yearMonthUtc`, and that agreement is proven in
 * exactly three ways: both readable and equal (no diagnostic), both readable and different
 * (`shard-year-month-name-mismatch`), or one side unreadable (that side's own `*-unreadable` code, which
 * makes the result invalid). An absent, non-string, or unreadable name therefore fails closed as
 * `shard-file-name-month-unreadable` rather than skipping the half of the row it proves. Filename
 * *recognition* — deciding that a Drive name is a canonical shard at all — stays with the catalog stage
 * (FF-06, Phase 13); a name this module cannot read is never treated as agreement.
 *
 * The name is read before the document shape check, so the requirement never depends on the document
 * being readable: an unreadable name is reported even when the shard is rejected as unstructured.
 *
 * The static directories are read the way the accepted static pass reads them: an unreadable directory
 * disables resolution rather than producing invented references, and its own diagnostics are not
 * re-reported here (callers run static validation first, per the FF-19 loading order).
 */
export function validateResultsShard(
  shardDocument: unknown,
  workoutsDocument: unknown,
  exercisesDocument: unknown,
  shardFileName: string
): ResultSemanticResult {
  const diagnostics: ResultSemanticDiagnostic[] = [];

  // --- RS-01 / FF-04, first half: the logical file name is a required input fact, so an absent,
  // non-string, or unreadable name fails the pass closed instead of leaving the row unproven. ---
  const nameMonth = readShardFileName(shardFileName);
  if (nameMonth === null) {
    diagnostics.push(makeResultDiagnostic("shard-file-name-month-unreadable", ""));
  }

  if (
    !isRecord(shardDocument) ||
    !Array.isArray(shardDocument["sessions"]) ||
    !Array.isArray(shardDocument["sessionTombstones"])
  ) {
    diagnostics.push(makeResultDiagnostic("results-document-unstructured", ""));
    return finalize(diagnostics);
  }

  // --- RS-01 (invariant 19) and FF-04, second half: file name, `yearMonthUtc`, and every session start
  // agree. An unreadable `yearMonthUtc` is reported on its own and no comparison is guessed against it. ---
  const yearMonth = readYearMonth(shardDocument["yearMonthUtc"]);
  if (yearMonth === null) {
    diagnostics.push(makeResultDiagnostic("shard-year-month-unreadable", "/yearMonthUtc"));
  } else if (nameMonth !== null && nameMonth !== yearMonth) {
    diagnostics.push(makeResultDiagnostic("shard-year-month-name-mismatch", "/yearMonthUtc"));
  }

  // --- Per-session lifecycle, identity, path, direct-ID, side, value, and uniqueness rules. ---
  const exercisesModel = buildExercisesModel(exercisesDocument);
  const context: SessionValidationContext = {
    workouts: buildWorkoutIndex(workoutsDocument),
    exercises: exercisesModel.exercises,
    exercisesAvailable: exercisesModel.available
  };

  const sessions = shardDocument["sessions"];
  const liveIds = new Set<string>();

  for (let i = 0; i < sessions.length; i += 1) {
    const session = sessions[i];
    if (!isRecord(session)) {
      continue; // unstructured session is schema-owned
    }
    const basePath = joinPointer("/sessions", i);

    // RS-01 / TR-08: the session's own UTC start month must equal the shard month. Result-level
    // timestamps are never consulted (RS-19).
    const startMonth = readStartYearMonth(session["startedAtUtc"]);
    if (startMonth === null) {
      diagnostics.push(makeResultDiagnostic("session-start-month-unreadable", joinPointer(basePath, "startedAtUtc")));
    } else if (yearMonth !== null && startMonth !== yearMonth) {
      diagnostics.push(makeResultDiagnostic("shard-start-month-mismatch", joinPointer(basePath, "startedAtUtc")));
    }

    const id = validateSession(session, basePath, context, diagnostics);
    if (id !== null) {
      // Req 11.22 with docs/ARCHITECTURE.md §12 ("UUID uniqueness") and spec §5 (a session `id` is one
      // globally stable identifier): one ID names one live session in this shard, so the second and later
      // holder is rejected at its own ID pointer and the first holder keeps the identity. Deciding which
      // holder survives is merge behavior owned by Phase 37 (invariant 21), never a document rule here.
      if (liveIds.has(id)) {
        diagnostics.push(makeResultDiagnostic("session-id-duplicate", joinPointer(basePath, "id")));
      } else {
        liveIds.add(id);
      }
    }
  }

  // --- RS-15 (invariant 20, document half): a live session and a tombstone never share an ID here. ---
  // Only the current document state is checked. Applying tombstone precedence over a stale live session
  // is merge behavior owned by Phase 37 (invariant 21), and pruning is never performed at all.
  //
  // Req 11.14 with docs/ARCHITECTURE.md §12 ("tombstone uniqueness") and spec §5 Session Tombstone add the
  // uniqueness half: a tombstone is the permanent record of one deleted ID, so the second and later tombstone
  // for one ID is rejected and the first stands. The two facts stay independent, and a tombstone that both
  // duplicates an earlier tombstone and collides with a live session reports each of them once.
  const tombstones = shardDocument["sessionTombstones"];
  const tombstonedIds = new Set<string>();
  for (let k = 0; k < tombstones.length; k += 1) {
    const tombstone = tombstones[k];
    if (!isRecord(tombstone) || !isNonEmptyString(tombstone["sessionId"])) {
      continue; // unreadable tombstone shape is schema-owned
    }
    const sessionId = tombstone["sessionId"];
    const pointer = joinPointer("/sessionTombstones", k, "sessionId");
    if (liveIds.has(sessionId)) {
      diagnostics.push(makeResultDiagnostic("tombstone-session-collision", pointer));
    }
    if (tombstonedIds.has(sessionId)) {
      diagnostics.push(makeResultDiagnostic("tombstone-session-id-duplicate", pointer));
    } else {
      tombstonedIds.add(sessionId);
    }
  }

  // Phase 6 owns score, structural-detail, and persisted deprecated-omission semantics. It runs after the
  // Phase 5 path/lifecycle pass and uses the same lifecycle-selected root without changing that pass's
  // diagnostics or inferring any missing result.
  const scoreResult = validateResultScores(shardDocument, workoutsDocument);
  for (const diagnostic of scoreResult.diagnostics) {
    diagnostics.push(diagnostic);
  }

  // --- RS-17 (invariant 22, document half): every sync-copy link names another session in this shard. ---
  // The link is the persisted record of one fact: the same live session changed on both sides, and the
  // remote version kept the original ID (spec §5 "Session Sync Copy"; specs/storage-and-lookup.md "If the
  // same live session changed locally and remotely"). This shard can hold that original ID in two states: a
  // live session, or the tombstone of a session the user deleted afterwards (Req 11.14, never pruned). Either
  // state names the recorded source, so either one satisfies the link, and deleting the original is an
  // ordinary later action that must not invalidate the copy that records it. Only an ID that appears in
  // neither state disproves the fact, which is the RS-17 failing column: "a `conflictOfSessionId` pointing at
  // an absent ID in the shard". The self-reference keeps its own code because a copy naming itself would
  // otherwise pass, and a live session and a tombstone that share the target ID are reported once as the
  // RS-15 collision at the tombstone pointer, never as a link defect. Creating the copy, reserving its ID,
  // and reusing that ID on retry belong to Phases 39 and 42; no merge precedence over a tombstoned target is
  // implied here (invariant 21, Phase 37).

  for (let i = 0; i < sessions.length; i += 1) {
    const session = sessions[i];
    if (!isRecord(session) || session["conflictOfSessionId"] === undefined) {
      continue;
    }
    const pointer = joinPointer("/sessions", i, "conflictOfSessionId");
    const target = session["conflictOfSessionId"];
    if (!isNonEmptyString(target)) {
      continue; // non-string link is schema-owned
    }
    const ownId = isNonEmptyString(session["id"]) ? session["id"] : null;
    if (ownId !== null && target === ownId) {
      diagnostics.push(makeResultDiagnostic("sync-copy-self-reference", pointer));
      continue;
    }
    // `liveIds` and `tombstonedIds` together name every session this shard knows; an ID in neither is absent.
    if (!liveIds.has(target) && !tombstonedIds.has(target)) {
      diagnostics.push(makeResultDiagnostic("sync-copy-target-missing", pointer));
    }
  }

  return finalize(diagnostics);
}
