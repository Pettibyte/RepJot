/**
 * Focused result lifecycle tests (P5-T01), organized by the contract rows they evidence.
 *
 * Authority: docs/contracts/user-data-contracts.md rows RS-01, RS-02 and RS-15 identity uniqueness, RS-03
 * through RS-11, RS-15, RS-17 through RS-19 and the invariants 1-28 ownership summary;
 * docs/contracts/temporal-and-omission-contracts.md
 * rows TR-04, TR-05, TR-08, TR-12; docs/contracts/persisted-facts.md; specs/rep-jot-json-schema-spec.md §5
 * and §8; specs/storage-and-lookup.md §Loading policy; docs/ARCHITECTURE.md §12 ("UUID uniqueness, tombstone
 * uniqueness"); docs/REQUIREMENTS.md 6.11 and Sections 11 and 12.
 *
 * Where a row names the schema as its primary owner (RS-03, RS-09, RS-18 bounds, RS-11 enum) both gates
 * are asserted, so the semantic assertion never hides a schema gap. Where a mutation stays schema-valid,
 * the schema gate is asserted as passing first, which proves the semantic diagnostic is the only signal.
 * Tests an implementation worker writes are development evidence (docs/implementation/README.md §6).
 */
import { describe, expect, test } from "bun:test";

import { createProductionValidator } from "../../../src/validation/schema-validator";
import { validateResultsShard } from "../../../src/validation/semantic/results";
import { validateShardCorrection } from "../../../src/validation/semantic/result-correction";
import type { ResultSemanticResult } from "../../../src/validation/semantic/result-types";

import exercises from "../../fixtures/result-semantic/exercises.context.json";
import workouts from "../../fixtures/result-semantic/workouts.context.json";
import contextShard from "../../fixtures/result-semantic/shard.context.json";
import invalidShard from "../../fixtures/result-semantic/shard.invalid-shard.json";
import invalidPaths from "../../fixtures/result-semantic/shard.invalid-paths.json";
import invalidDuplicates from "../../fixtures/result-semantic/shard.invalid-duplicates.json";
import invalidIdentityLinks from "../../fixtures/result-semantic/shard.invalid-identity-links.json";
import invalidValues from "../../fixtures/result-semantic/shard.invalid-values.json";
import invalidFields from "../../fixtures/result-semantic/shard.invalid-fields.json";
import invalidLifecycle from "../../fixtures/result-semantic/shard.invalid-lifecycle.json";
import frozenPlanShard from "../../fixtures/result-semantic/shard.frozen-plan.json";
import laterBundleWorkouts from "../../fixtures/result-semantic/workouts.later-bundle.json";
import correctionBase from "../../fixtures/result-semantic/shard.correction-base.json";
import correctionCandidate from "../../fixtures/result-semantic/shard.correction-candidate.json";

// The approved Phase 1 acceptance fixtures carry the terminal omission states (TR-12).
import acceptanceExercises from "../../fixtures/contract-acceptance/exercises.min.json";
import acceptanceWorkouts from "../../fixtures/contract-acceptance/workouts.scenario.json";
import acceptanceLaterWorkouts from "../../fixtures/contract-acceptance/workouts.later-addition.json";
import acceptanceDeprecatedAtStart from "../../fixtures/contract-acceptance/results.deprecated-at-start.json";
import acceptanceUntouchedBeforeDeprecation from "../../fixtures/contract-acceptance/results.untouched-before-deprecation.json";
import acceptanceLaterAddition from "../../fixtures/contract-acceptance/results.later-addition.json";
import acceptanceNestedScored from "../../fixtures/contract-acceptance/results.nested-scored.json";

const schema = createProductionValidator();
const CONTEXT_NAME = "results-2026-09.json";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
function asRecord(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}
/** Validate one shard against the context static directories. The shard file name is required by the API. */
function check(document: unknown, name: string = CONTEXT_NAME): ResultSemanticResult {
  return validateResultsShard(document, workouts, exercises, name);
}
/** Validate one approved Phase 1 acceptance fixture against its own monthly shard name (RS-01 input fact). */
function checkAcceptance(document: unknown, name: string, laterBundle = false): ResultSemanticResult {
  return validateResultsShard(
    document,
    laterBundle ? acceptanceLaterWorkouts : acceptanceWorkouts,
    acceptanceExercises,
    name
  );
}
function codes(result: ResultSemanticResult): string[] {
  return result.diagnostics.map((diagnostic) => diagnostic.code);
}
function at(result: ResultSemanticResult, path: string): string[] {
  return result.diagnostics.filter((diagnostic) => diagnostic.path === path).map((diagnostic) => diagnostic.code);
}
/** Every diagnostic below one path prefix, used where a whole session or result must stay clean. */
function under(result: ResultSemanticResult, prefix: string): string[] {
  return result.diagnostics.filter((diagnostic) => diagnostic.path.indexOf(prefix) === 0).map((d) => d.code);
}
/** One exercise result written against a node path, used to probe which tree a session resolves in. */
function resultAtNode(
  workoutId: string,
  path: Record<string, unknown>[],
  exerciseId: string,
  values: Record<string, unknown>
): Record<string, unknown> {
  return {
    type: "exercise",
    workoutId: workoutId,
    executionPath: [{ nodeId: "root" }].concat(path),
    exerciseId: exerciseId,
    status: "completed",
    values: values
  };
}
function childIds(nodes: readonly unknown[]): string[] {
  return nodes.map((node) => String(asRecord(node)["id"]));
}
/** The children of the `finisher` container inside one session's frozen plan. */
function planFinisherChildIds(session: Record<string, unknown>): string[] {
  const plan = asRecord(session["executionPlan"]);
  return childIds(asRecord((plan["children"] as Record<string, unknown>[])[2])["children"] as unknown[]);
}
/** The children of `squat-day`'s `finisher` in any workouts document of this fixture set. */
function workoutFinisherChildIds(document: unknown): string[] {
  const list = asRecord(document)["workouts"] as Record<string, unknown>[];
  return childIds(asRecord((asRecord(list[0]["root"])["children"] as Record<string, unknown>[])[2])["children"] as unknown[]);
}
/** The children of `nested-workout`'s innermost `mini` container in a workouts document. */
function miniChildIds(document: unknown): string[] {
  const list = asRecord(document)["workouts"] as Record<string, unknown>[];
  const blocks = asRecord((asRecord(list[2]["root"])["children"] as Record<string, unknown>[])[0]);
  return childIds(asRecord((blocks["children"] as Record<string, unknown>[])[0])["children"] as unknown[]);
}
/** Turn one active session into a terminal one, the only change that moves resolution to the tree. */
function makeTerminal(session: Record<string, unknown>): void {
  delete session["executionPlan"];
  session["status"] = "completed";
  session["endedAtUtc"] = "2026-09-14T07:30:00Z";
}
function sessionsOf(document: Record<string, unknown>): Record<string, unknown>[] {
  return document["sessions"] as Record<string, unknown>[];
}
function tombstonesOf(document: Record<string, unknown>): Record<string, unknown>[] {
  return document["sessionTombstones"] as Record<string, unknown>[];
}
/** Append one permanent tombstone record, the shape spec §5 Session Tombstone names. */
function addTombstone(document: Record<string, unknown>, sessionId: string, deletedAtUtc: string): void {
  tombstonesOf(document).push({ sessionId: sessionId, deletedAtUtc: deletedAtUtc });
}
/** Append a copy of one live session under a different ID, the only identity a session carries. */
function addSessionLike(document: Record<string, unknown>, sessionIndex: number, id: string): void {
  const copy = clone(sessionsOf(document)[sessionIndex]);
  copy["id"] = id;
  sessionsOf(document).push(copy);
}
function resultsOf(document: Record<string, unknown>, sessionIndex: number): Record<string, unknown>[] {
  return sessionsOf(document)[sessionIndex]["results"] as Record<string, unknown>[];
}
/** The repeated `squat-sets` segment the iteration probes below mutate (session 2's only result). */
function repeatedSegment(document: Record<string, unknown>): Record<string, unknown> {
  return (resultsOf(document, 2)[0]["executionPath"] as Record<string, unknown>[])[1];
}
/** The terminal repeated `finisher` segment of session 0's aggregate container result. */
function repeatedTerminalSegment(document: Record<string, unknown>): Record<string, unknown> {
  return (resultsOf(document, 0)[6]["executionPath"] as Record<string, unknown>[])[1];
}
/** The non-repeated `singles` segment of session 0's third result, the fixed-node probe target. */
function fixedSegment(document: Record<string, unknown>): Record<string, unknown> {
  return (resultsOf(document, 0)[3]["executionPath"] as Record<string, unknown>[])[1];
}
function schemaValid(document: unknown): boolean {
  return schema.validate("results", 1, document).valid;
}
/** Validate one shard against a modified exercises directory. */
function checkWithExercises(document: unknown, exercisesDocument: unknown): ResultSemanticResult {
  return validateResultsShard(document, workouts, exercisesDocument, CONTEXT_NAME);
}
/** One exercise entry of an exercises directory, the source of the side and value facts a result needs. */
function exerciseEntryOf(document: Record<string, unknown>, id: string): Record<string, unknown> {
  for (const entry of document["exercises"] as Record<string, unknown>[]) {
    if (entry["id"] === id) {
      return entry;
    }
  }
  throw new Error("the context exercises fixture holds no exercise: " + id);
}
/** Remove every field that can make a stored result state relevant (spec §5 Save and Omission Rules). */
function stripResultEvidence(result: Record<string, unknown>): void {
  delete result["values"];
  delete result["score"];
  delete result["reasonCode"];
  delete result["notes"];
  delete result["startedAtUtc"];
  delete result["endedAtUtc"];
}

describe("context fixture (positive)", () => {
  test("the context shard passes the schema gate and the lifecycle pass", () => {
    expect(schemaValid(contextShard)).toBe(true);
    const result = check(contextShard);
    expect(result.valid).toBe(true);
    expect(codes(result)).toEqual([]);
  });

  test("the schema gate and the lifecycle pass agree on an unrelated family", () => {
    const notAShard = { format: "repjot/preferences", schemaVersion: 1 };
    const result = check(notAShard);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.length).toBe(1);
    expect(result.diagnostics[0].code).toBe("results-document-unstructured");
    expect(result.diagnostics[0].path).toBe("");
  });

  test("repeated validation of the context fixture is identical", () => {
    expect(check(contextShard)).toEqual(check(contextShard));
  });
});

describe("RS-01 / TR-08 / FF-04: shard identity", () => {
  test("a session start in another UTC month fails at its own pointer", () => {
    expect(schemaValid(invalidShard)).toBe(true);
    const result = check(invalidShard);
    expect(result.valid).toBe(false);
    expect(at(result, "/sessions/0/startedAtUtc")).toContain("shard-start-month-mismatch");
    expect(at(result, "/sessions/1/startedAtUtc")).toContain("shard-start-month-mismatch");
    // The in-month session is untouched: no cascading diagnostics for it.
    expect(at(result, "/sessions/2/startedAtUtc")).toEqual([]);
  });

  test("the file name month must equal `yearMonthUtc` (FF-04 negative)", () => {
    const result = check(contextShard, "results-2026-10.json");
    expect(at(result, "/yearMonthUtc")).toContain("shard-year-month-name-mismatch");
  });

  test("the file name month agreeing with `yearMonthUtc` passes", () => {
    expect(check(contextShard, CONTEXT_NAME).valid).toBe(true);
  });

  test("a name with no readable month is reported, never guessed", () => {
    const result = check(contextShard, "results-september.json");
    expect(at(result, "")).toContain("shard-file-name-month-unreadable");
    expect(codes(result).indexOf("shard-year-month-name-mismatch")).toBe(-1);
  });

  // The logical file name is a required argument (RS-01 input facts, FF-04, Req 3.3-3.4), so the API
  // offers no path that skips the file name half of the row: an absent or unreadable name fails closed.
  test("an absent or unreadable file name fails closed instead of skipping the row", () => {
    // Values a caller can still reach the runtime API with: none of them carries a readable shard month.
    const unreadableNames: unknown[] = [
      undefined,
      null,
      "",
      "not-a-name.json",
      "results-2026-09.json ",
      "Results-2026-09.json",
      "results.json",
      42
    ];
    for (const name of unreadableNames) {
      const result = validateResultsShard(contextShard, workouts, exercises, name as unknown as string);
      expect(result.valid).toBe(false);
      expect(codes(result)).toEqual(["shard-file-name-month-unreadable"]);
      expect(at(result, "")).toContain("shard-file-name-month-unreadable");
    }
  });

  test("an absent file name is reported even when the shard itself is unstructured", () => {
    const result = validateResultsShard(
      { format: "repjot/preferences", schemaVersion: 1 },
      workouts,
      exercises,
      undefined as unknown as string
    );
    expect(result.valid).toBe(false);
    expect(codes(result)).toEqual(["results-document-unstructured", "shard-file-name-month-unreadable"]);
  });

  test("file name agreement is proven for the whole `YYYY-MM`, so the year must agree too", () => {
    expect(check(contextShard, "results-2026-09.json").valid).toBe(true);
    const result = check(contextShard, "results-2025-09.json");
    expect(at(result, "/yearMonthUtc")).toContain("shard-year-month-name-mismatch");
    expect(codes(result)).toEqual(["shard-year-month-name-mismatch"]);
  });

  test("an unreadable `yearMonthUtc` stops the month comparison instead of guessing", () => {
    const document = clone(asRecord(contextShard));
    document["yearMonthUtc"] = "2026-13";
    const result = check(document);
    expect(at(result, "/yearMonthUtc")).toContain("shard-year-month-unreadable");
    // Session comparisons are skipped rather than compared against an unreadable month.
    expect(codes(result).indexOf("shard-start-month-mismatch")).toBe(-1);
    expect(result.diagnostics.length).toBe(1);
  });

  test("a name with no readable month is reported, matching the FF-06 negative name", () => {
    const result = check(contextShard, "results-2026-13.json");
    expect(codes(result)).toEqual(["shard-file-name-month-unreadable"]);
  });

  test("a session that crosses a UTC month boundary stays in its start-month shard (TR-08)", () => {
    const boundary = sessionsOf(asRecord(contextShard))[3];
    expect(boundary["startedAtUtc"]).toBe("2026-09-30T23:00:00Z");
    expect(boundary["endedAtUtc"]).toBe("2026-10-01T00:20:00Z");
    expect(check(contextShard).valid).toBe(true);
  });

  test("a non-canonical session start is reported as unreadable, not compared (FF-12 supporting)", () => {
    const document = clone(asRecord(invalidLifecycle));
    const session = sessionsOf(document)[0];
    session["endedAtUtc"] = "2026-09-01T06:40:00Z";
    session["startedAtUtc"] = "2026-09-01T06:00:00+02:00";
    const result = check(document);
    expect(at(result, "/sessions/0/startedAtUtc")).toContain("session-start-month-unreadable");
    expect(codes(result).indexOf("shard-start-month-mismatch")).toBe(-1);
  });
});

describe("RS-19: result timestamps never select a shard", () => {
  test("result interval times outside the shard month produce no shard diagnostic", () => {
    // Session index 2 starts in 2026-09 and records its result intervals on 2026-10-02.
    const results = resultsOf(asRecord(invalidShard), 2);
    expect(results[0]["startedAtUtc"]).toBe("2026-10-02T07:05:00Z");
    expect(results[0]["endedAtUtc"]).toBe("2026-10-02T07:06:00Z");
    const result = check(invalidShard);
    const touched = result.diagnostics.filter((diagnostic) => diagnostic.path.indexOf("/sessions/2") === 0);
    expect(touched).toEqual([]);
    // The two out-of-month sessions in the same fixture are the only shard findings.
    expect(result.diagnostics.length).toBe(2);
  });

  test("a session keeps its shard when only its results carry later timestamps (Req 11.19)", () => {
    const document = clone(asRecord(contextShard));
    const result = resultsOf(document, 3)[0];
    result["startedAtUtc"] = "2027-01-04T00:00:00Z";
    result["endedAtUtc"] = "2027-01-04T00:05:00Z";
    expect(check(document).valid).toBe(true);
  });
});

describe("RS-03: status, end time, and execution plan", () => {
  test("the context fixture holds the two legal lifecycle shapes", () => {
    const document = asRecord(contextShard);
    expect(sessionsOf(document)[1]["status"]).toBe("in_progress");
    expect(sessionsOf(document)[1]["endedAtUtc"]).toBe(undefined);
    expect(sessionsOf(document)[1]["executionPlan"]).toBeDefined();
    expect(sessionsOf(document)[0]["status"]).toBe("completed");
    expect(sessionsOf(document)[0]["executionPlan"]).toBe(undefined);
    expect(check(contextShard).valid).toBe(true);
  });

  test("every illegal status-field combination fails at its own pointer", () => {
    const result = check(invalidLifecycle);
    expect(at(result, "/sessions/0/endedAtUtc")).toContain("session-ended-at-required");
    expect(at(result, "/sessions/1/executionPlan")).toContain("session-plan-forbidden");
    expect(at(result, "/sessions/2/endedAtUtc")).toContain("session-ended-at-forbidden");
    expect(at(result, "/sessions/3/executionPlan")).toContain("session-plan-required");
    expect(at(result, "/sessions/4/status")).toContain("session-status-invalid");
    expect(at(result, "/sessions/6/id")).toContain("session-id-unreadable");
  });

  test("the schema gate stays the primary owner of the same row", () => {
    const errors = schema.validate("results", 1, invalidLifecycle);
    expect(errors.valid).toBe(false);
    expect(errors.code).toBe("invalid");
  });

  test("a terminal session with a plan and an end time reports only the plan (no cascade)", () => {
    const document = clone(asRecord(invalidLifecycle));
    const session = sessionsOf(document)[1];
    expect(session["endedAtUtc"]).toBeDefined();
    const result = check(document);
    expect(at(result, "/sessions/1/endedAtUtc")).toEqual([]);
    expect(at(result, "/sessions/1/executionPlan")).toContain("session-plan-forbidden");
  });
});

describe("RS-04: last-correction time and immutable persisted times", () => {
  test("a session with no `updatedAtUtc` fails at its pointer (invariant 16)", () => {
    const result = check(invalidLifecycle);
    expect(at(result, "/sessions/5/updatedAtUtc")).toContain("session-updated-at-missing");
  });

  test("a legal correction changes only results and `updatedAtUtc`", () => {
    expect(schemaValid(correctionBase)).toBe(true);
    expect(schemaValid(correctionCandidate)).toBe(true);
    const result = validateShardCorrection(correctionBase, correctionCandidate);
    expect(result.valid).toBe(true);
    expect(codes(result)).toEqual([]);
  });

  test("the base and candidate shards are each valid shards on their own (recovery)", () => {
    expect(validateResultsShard(correctionBase, workouts, exercises, "results-2026-08.json").valid).toBe(true);
    expect(validateResultsShard(correctionCandidate, workouts, exercises, "results-2026-08.json").valid).toBe(true);
  });

  test("a correction that moves `startedAtUtc` fails (Req 11.20)", () => {
    const candidate = clone(asRecord(correctionCandidate));
    sessionsOf(candidate)[0]["startedAtUtc"] = "2026-08-20T15:00:00Z";
    const result = validateShardCorrection(correctionBase, candidate);
    expect(at(result, "/sessions/0/startedAtUtc")).toContain("session-start-immutable");
    expect(codes(result)).toEqual(["session-start-immutable"]);
  });

  test("a correction that moves an existing `endedAtUtc` fails (TR-05)", () => {
    const candidate = clone(asRecord(correctionCandidate));
    sessionsOf(candidate)[0]["endedAtUtc"] = "2026-08-20T15:30:00Z";
    const result = validateShardCorrection(correctionBase, candidate);
    expect(at(result, "/sessions/0/endedAtUtc")).toContain("session-ended-at-immutable");
  });

  test("a correction that reopens a terminal session fails (Req 11.19)", () => {
    const candidate = clone(asRecord(correctionCandidate));
    sessionsOf(candidate)[0]["status"] = "in_progress";
    const result = validateShardCorrection(correctionBase, candidate);
    expect(at(result, "/sessions/0/status")).toContain("session-status-immutable");
  });

  test("a correction that changes the shard month fails (TR-08)", () => {
    const candidate = clone(asRecord(correctionCandidate));
    candidate["yearMonthUtc"] = "2026-09";
    const result = validateShardCorrection(correctionBase, candidate);
    expect(at(result, "/yearMonthUtc")).toContain("shard-year-month-immutable");
  });

  test("completing an in-progress session in the same save is a transition, not a moved status", () => {
    const candidate = clone(asRecord(correctionCandidate));
    const session = sessionsOf(candidate)[1];
    expect(session["status"]).toBe("in_progress");
    session["status"] = "completed";
    session["endedAtUtc"] = "2026-08-21T05:40:00Z";
    delete session["executionPlan"];
    const result = validateShardCorrection(correctionBase, candidate);
    expect(result.valid).toBe(true);
  });

  test("a session that appears on only one side is a creation or a deletion, not a correction", () => {
    // Creation: the candidate's third session has no base session to advance from, so its own times are
    // read as the save wrote them even though they sit before the base sessions' times.
    const created = clone(asRecord(correctionCandidate));
    sessionsOf(created)[2]["updatedAtUtc"] = "2026-08-21T00:00:00Z";
    expect(validateShardCorrection(correctionBase, created).valid).toBe(true);
    // Deletion: the candidate simply lacks one session and copies the survivor through with the time the
    // survivor already has. A deletion is its own operation (RS-15), so it corrects no session, and Req 11.21
    // gives no session a reason to move.
    const removed = clone(asRecord(correctionBase));
    sessionsOf(removed).shift();
    expect(validateShardCorrection(correctionBase, removed).valid).toBe(true);
  });

  // Req 11.21 and TR-05, both halves of RS-04 (invariant 16): each session the save corrects carries a
  // `updatedAtUtc` later than the base session's, and each session the save does not correct keeps exactly the
  // instant the base has. Every case below starts from the legal pair or from the single-session save below,
  // so the reported finding is the one the case creates.

  /**
   * The whole-shard write of a legal correction of one session: session 0 carries an edited result value and a
   * later `updatedAtUtc`, and the base's other session is copied through unchanged, time and all. A save writes
   * every session of the shard it saves, so this untouched sibling is the ordinary state of a legal save, and it
   * holds the base instant exactly, which is what the sibling rule asks of an untouched session.
   */
  function saveOfOneCorrectedSession(): Record<string, unknown> {
    const candidate = clone(asRecord(correctionBase));
    const results = sessionsOf(candidate)[0]["results"] as Record<string, unknown>[];
    results[0]["values"] = { reps: 6, weight: { value: 100, unit: "kg" } };
    sessionsOf(candidate)[0]["updatedAtUtc"] = "2026-08-26T18:10:00Z";
    return candidate;
  }
  test("a correction that leaves `updatedAtUtc` unchanged fails (Req 11.21, invariant 16)", () => {
    const candidate = clone(asRecord(correctionCandidate));
    sessionsOf(candidate)[0]["updatedAtUtc"] = "2026-08-20T14:45:00Z"; // the base session's own time
    const result = validateShardCorrection(correctionBase, candidate);
    expect(at(result, "/sessions/0/updatedAtUtc")).toEqual(["session-updated-at-not-advanced"]);
    expect(codes(result)).toEqual(["session-updated-at-not-advanced"]);
  });

  test("a correction that moves `updatedAtUtc` earlier fails (Req 11.20-11.21)", () => {
    const candidate = clone(asRecord(correctionCandidate));
    sessionsOf(candidate)[0]["updatedAtUtc"] = "2026-08-20T14:44:59Z"; // one second before the base time
    const result = validateShardCorrection(correctionBase, candidate);
    expect(at(result, "/sessions/0/updatedAtUtc")).toEqual(["session-updated-at-not-advanced"]);
    expect(codes(result)).toEqual(["session-updated-at-not-advanced"]);
  });

  test("a corrected session beside an untouched sibling is a legal save (Req 11.21, TR-05)", () => {
    const candidate = saveOfOneCorrectedSession();
    expect(schemaValid(candidate)).toBe(true);
    const result = validateShardCorrection(correctionBase, candidate);
    expect(result.valid).toBe(true);
    expect(codes(result)).toEqual([]);
    // The pass is green because the sibling kept the base time, not because the save moved it: the base and the
    // candidate hold the same instant for that session.
    const base = asRecord(clone(correctionBase));
    expect(sessionsOf(candidate)[1]["updatedAtUtc"]).toBe(sessionsOf(base)[1]["updatedAtUtc"]);
  });

  test("an untouched sibling written with its members in another order is still untouched (Req 11.21)", () => {
    // The comparison reads the document, not its serialization, so a rewrite that reorders one session's fields
    // is the same unchanged session and has nothing to advance.
    const candidate = saveOfOneCorrectedSession();
    const sessions = sessionsOf(candidate);
    const sibling = sessions[1];
    const reordered: Record<string, unknown> = {};
    const keys = Object.keys(sibling);
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      reordered[keys[i]] = sibling[keys[i]];
    }
    expect(Object.keys(reordered).length).toBe(keys.length);
    sessions[1] = reordered;
    const result = validateShardCorrection(correctionBase, candidate);
    expect(result.valid).toBe(true);
    expect(codes(result)).toEqual([]);
  });

  // Req 11.21 moves a last-correction time *after* a saved correction of that session, and Req 11.20 permits no
  // other edit to a persisted timestamp. So the untouched sibling of the two cases above is copied through
  // exactly: it keeps the base instant, and a sibling whose time moved later or rolled back earlier is a save
  // that corrected nothing and still rewrote a timestamp. The sibling half and the advancing half are the same
  // instant comparison, so the cases below read the instants this rule already reads and no new comparison.

  test("an untouched sibling whose `updatedAtUtc` moves later fails (Req 11.20-11.21, RS-04)", () => {
    // Every other fact of the sibling is copied through, so this save corrects one session and moves the time
    // of the other. The moved time is the whole finding, and it stays schema-valid, so the semantic pass is
    // the only gate that sees it.
    const candidate = saveOfOneCorrectedSession();
    sessionsOf(candidate)[1]["updatedAtUtc"] = "2026-08-21T05:05:01Z"; // one second after the sibling's own time
    expect(schemaValid(candidate)).toBe(true);
    const result = validateShardCorrection(correctionBase, candidate);
    expect(result.valid).toBe(false);
    expect(at(result, "/sessions/1/updatedAtUtc")).toEqual(["session-updated-at-changed-without-correction"]);
    expect(codes(result)).toEqual(["session-updated-at-changed-without-correction"]);
  });

  test("an untouched sibling whose `updatedAtUtc` rolls back fails the same way (Req 11.20)", () => {
    // Rolled backwards is the same defect read the other way: Req 11.20 permits no edit to a persisted
    // timestamp, so an earlier time is no more a copy than a later one.
    const candidate = saveOfOneCorrectedSession();
    sessionsOf(candidate)[1]["updatedAtUtc"] = "2026-08-21T05:04:59Z"; // one second before the sibling's time
    const result = validateShardCorrection(correctionBase, candidate);
    expect(result.valid).toBe(false);
    expect(codes(result)).toEqual(["session-updated-at-changed-without-correction"]);
  });

  test("a save that moves one session's `updatedAtUtc` and corrects nothing fails (Req 11.21)", () => {
    // The defect in its purest shape: one timestamp write and no corrected fact anywhere, which is the write
    // Req 11.21 does not license because it records a correction that was never made.
    const candidate = clone(asRecord(correctionBase));
    sessionsOf(candidate)[0]["updatedAtUtc"] = "2026-08-26T21:00:00Z";
    expect(schemaValid(candidate)).toBe(true);
    const result = validateShardCorrection(correctionBase, candidate);
    expect(at(result, "/sessions/0/updatedAtUtc")).toEqual(["session-updated-at-changed-without-correction"]);
    expect(codes(result)).toEqual(["session-updated-at-changed-without-correction"]);
  });

  test("a deletion that moves a surviving sibling's `updatedAtUtc` is reported for the survivor (Req 11.21)", () => {
    // The creation-and-deletion case above copies the survivor through; this save moves the survivor's time as
    // well, and the survivor is the one session here that no correction touches, so it carries the finding.
    const removed = clone(asRecord(correctionBase));
    sessionsOf(removed).shift();
    sessionsOf(removed)[0]["updatedAtUtc"] = "2026-08-26T21:00:00Z";
    const result = validateShardCorrection(correctionBase, removed);
    expect(result.valid).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(["/sessions/0/updatedAtUtc"]);
    expect(codes(result)).toEqual(["session-updated-at-changed-without-correction"]);
  });

  // The sibling rule is an exactness rule about the instant, so how far the sibling's time moves decides
  // nothing: each value below names an instant other than the sibling's own `2026-08-21T05:05:00Z`, and each
  // is rejected however close it sits to that instant. The case after this list writes that instant again.
  const SIBLING_OTHER_INSTANTS: readonly string[] = [
    "2026-08-21T05:05:00.001Z", // one millisecond later
    "2026-08-21T05:05:00.000000001Z", // nine digits later, and still a different instant
    "2026-08-21T05:05:00.999999999Z", // the last instant of the same second
    "2026-08-21T05:04:59.999999999Z", // one step before it
    "2026-08-21T05:04:59Z", // one second earlier
    "2026-08-21T05:05:01Z", // one second later
    "2026-09-01T00:00:00Z" // a month later, in a shard this pass never re-months
  ];

  test("any other instant on an untouched sibling is a changed timestamp, however close (Req 11.20-11.21)", () => {
    for (const time of SIBLING_OTHER_INSTANTS) {
      const candidate = saveOfOneCorrectedSession();
      sessionsOf(candidate)[1]["updatedAtUtc"] = time;
      const result = validateShardCorrection(correctionBase, candidate);
      expect(result.valid).toBe(false);
      expect(codes(result)).toEqual(["session-updated-at-changed-without-correction"]);
    }
  });

  test("an untouched sibling that keeps its instant in other text is unchanged and stays valid (Req 11.21)", () => {
    // The sibling rule reads instants exactly as the advancing rule reads them: a zero fraction and a padded
    // fraction each name the sibling's own instant, so each is the same unchanged session and neither is a
    // changed timestamp.
    for (const time of ["2026-08-21T05:05:00.000000Z", "2026-08-21T05:05:00.0Z"]) {
      const candidate = saveOfOneCorrectedSession();
      sessionsOf(candidate)[1]["updatedAtUtc"] = time;
      const result = validateShardCorrection(correctionBase, candidate);
      expect(result.valid).toBe(true);
      expect(codes(result)).toEqual([]);
    }
  });

  /**
   * The legal one-corrected-session save with the untouched sibling's last-correction time written explicitly on
   * both sides. The sibling is the half of the rule that reads an instant for exactness rather than for order, so
   * the cases below move only that one time.
   */
  function pairWithSiblingTimes(
    baseTime: string,
    candidateTime: string
  ): [Record<string, unknown>, Record<string, unknown>] {
    const base = clone(asRecord(correctionBase));
    sessionsOf(base)[1]["updatedAtUtc"] = baseTime;
    const candidate = saveOfOneCorrectedSession();
    sessionsOf(candidate)[1]["updatedAtUtc"] = candidateTime;
    return [base, candidate];
  }

  // The sibling rule is an exactness read of the same instants, so the two texts that land on one whole-second
  // count at an inserted leap second have to stay two texts there too: a session copied through as the midnight
  // after a leap second has been moved, and Req 11.20 leaves its timestamp alone.
  const SIBLING_LEAP_KEEPINGS: readonly (readonly [string, string])[] = [
    ["2016-12-31T23:59:60.25Z", "2016-12-31T23:59:60.25Z"], // copied through as written
    ["2016-12-31T23:59:60.25Z", "2016-12-31T23:59:60.250000Z"], // one instant, padded out
    ["2016-12-31T23:59:60Z", "2016-12-31T23:59:60.000000000000Z"] // no fraction and a long zero fraction
  ];

  // Each pair below is the leap second and the midnight that begins where it ends, in one order and then the
  // other. Both are instants the calendar has, and they are different instants, so the sibling moved.
  const SIBLING_LEAP_VS_MIDNIGHT: readonly (readonly [string, string])[] = [
    ["2016-12-31T23:59:60Z", "2017-01-01T00:00:00Z"],
    ["2016-12-31T23:59:60.25Z", "2017-01-01T00:00:00.25Z"], // the same fraction on both sides moves all the same
    ["2017-01-01T00:00:00Z", "2016-12-31T23:59:60.999999999999Z"], // rolled back into the leap second, by a hair
    ["1972-07-01T00:00:00Z", "1972-06-30T23:59:60.5Z"] // the first inserted second, read backwards
  ];

  test("an untouched sibling keeps a leap second, and does not slip into the midnight after it (Req 11.20)", () => {
    for (const [baseTime, candidateTime] of SIBLING_LEAP_KEEPINGS) {
      const [base, candidate] = pairWithSiblingTimes(baseTime, candidateTime);
      expect(schemaValid(candidate)).toBe(true);
      // The sibling holds its own instant in both texts, so it is untouched and this save stays legal.
      expect(codes(validateShardCorrection(base, candidate))).toEqual([]);
    }
    for (const [baseTime, candidateTime] of SIBLING_LEAP_VS_MIDNIGHT) {
      const [base, candidate] = pairWithSiblingTimes(baseTime, candidateTime);
      expect(schemaValid(candidate)).toBe(true);
      const result = validateShardCorrection(base, candidate);
      // One whole-second count is no reason for a moved timestamp to read as an unchanged one, and the move
      // reads the same way whichever side holds the leap second.
      expect(result.valid).toBe(false);
      expect(at(result, "/sessions/1/updatedAtUtc")).toEqual(["session-updated-at-changed-without-correction"]);
      expect(codes(result)).toEqual(["session-updated-at-changed-without-correction"]);
    }
  });

  test("a moved sibling time and a missing advancement are two findings, one per session (Req 11.21)", () => {
    const candidate = saveOfOneCorrectedSession();
    sessionsOf(candidate)[0]["updatedAtUtc"] = sessionsOf(asRecord(clone(correctionBase)))[0]["updatedAtUtc"];
    sessionsOf(candidate)[1]["updatedAtUtc"] = "2026-08-21T05:06:00Z";
    const result = validateShardCorrection(correctionBase, candidate);
    expect(result.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path])).toEqual([
      ["session-updated-at-changed-without-correction", "/sessions/1/updatedAtUtc"],
      ["session-updated-at-not-advanced", "/sessions/0/updatedAtUtc"]
    ]);
  });

  test("an untouched sibling whose time is unreadable on both sides reports one finding (recovery)", () => {
    // Neither side names a readable instant, so the exactness rule has nothing to compare and stays silent:
    // an unreadable last-correction time is one finding on the code that says so, never two.
    const base = clone(asRecord(correctionBase));
    const candidate = saveOfOneCorrectedSession();
    const unreadable = "2026-08-21T05:05:00"; // no `Z`, so no persisted instant on either side
    sessionsOf(base)[1]["updatedAtUtc"] = unreadable;
    sessionsOf(candidate)[1]["updatedAtUtc"] = unreadable;
    const result = validateShardCorrection(base, candidate);
    expect(result.valid).toBe(false);
    expect(at(result, "/sessions/1/updatedAtUtc")).toEqual(["session-updated-at-unreadable"]);
    expect(codes(result)).toEqual(["session-updated-at-unreadable"]);
  });

  test("a save whose corrected session does not advance reports that session alone (Req 11.21)", () => {
    // The untouched sibling of the case above stays unreported when the corrected session is the one at fault:
    // one missing advancement is one finding, and it is the corrected session's.
    const candidate = saveOfOneCorrectedSession();
    sessionsOf(candidate)[0]["updatedAtUtc"] = sessionsOf(asRecord(clone(correctionBase)))[0]["updatedAtUtc"];
    const result = validateShardCorrection(correctionBase, candidate);
    expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(["/sessions/0/updatedAtUtc"]);
    expect(codes(result)).toEqual(["session-updated-at-not-advanced"]);
  });

  test("a change deep inside one result is a relevant correction, so its session must advance (Req 11.21)", () => {
    // Three levels down a session's own results array, and no time moves anywhere in the shard: the deep change
    // is the whole save, so it is the one session it belongs to that has to advance and its sibling has not to.
    const candidate = clone(asRecord(correctionBase));
    const results = sessionsOf(candidate)[0]["results"] as Record<string, unknown>[];
    asRecord(asRecord(results[0]["values"])["weight"])["value"] = 105; // 100 kg corrected to 105 kg
    expect(schemaValid(candidate)).toBe(true);
    const result = validateShardCorrection(correctionBase, candidate);
    expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(["/sessions/0/updatedAtUtc"]);
    expect(codes(result)).toEqual(["session-updated-at-not-advanced"]);
  });

  test("a candidate identical to the base saves no correction, so nothing has to advance (Req 11.21)", () => {
    // Req 11.21 moves the last-correction time of a session a correction corrects. This candidate corrects
    // nothing, so it carries no finding: an empty write is a no-op, not a broken correction, and the rules that
    // do apply to it are the immutability rules, which it also satisfies.
    const result = validateShardCorrection(correctionBase, clone(asRecord(correctionBase)));
    expect(result.valid).toBe(true);
    expect(codes(result)).toEqual([]);
  });

  test("an untouched sibling with an unreadable `updatedAtUtc` still fails closed (recovery)", () => {
    // The advancement rule needs a correction to apply; the readable-time rule does not, because a session that
    // names no Z-suffixed instant fails closed whoever reads it.
    const candidate = saveOfOneCorrectedSession();
    sessionsOf(candidate)[1]["updatedAtUtc"] = "2026-08-21T05:05:00"; // no `Z`, so no persisted instant
    const result = validateShardCorrection(correctionBase, candidate);
    expect(result.valid).toBe(false);
    expect(at(result, "/sessions/1/updatedAtUtc")).toEqual(["session-updated-at-unreadable"]);
    expect(codes(result)).toEqual(["session-updated-at-unreadable"]);
  });

  test("an unchanged instant written with other text is still unchanged (Req 11.21)", () => {
    const candidate = clone(asRecord(correctionCandidate));
    // The same instant as the base `2026-08-20T14:45:00Z`, spelled with a zero fraction.
    sessionsOf(candidate)[0]["updatedAtUtc"] = "2026-08-20T14:45:00.000Z";
    const result = validateShardCorrection(correctionBase, candidate);
    expect(codes(result)).toEqual(["session-updated-at-not-advanced"]);
  });

  test("a later instant written with a fraction is a valid correction (Req 11.21)", () => {
    const candidate = clone(asRecord(correctionCandidate));
    sessionsOf(candidate)[0]["updatedAtUtc"] = "2026-08-26T18:10:00.500Z";
    const result = validateShardCorrection(correctionBase, candidate);
    expect(result.valid).toBe(true);
    expect(codes(result)).toEqual([]);
  });

  test("an in-progress session edited in place must advance too (Req 11.21)", () => {
    const candidate = clone(asRecord(correctionCandidate));
    sessionsOf(candidate)[1]["updatedAtUtc"] = "2026-08-21T05:05:00Z"; // the base session's own time
    const result = validateShardCorrection(correctionBase, candidate);
    expect(at(result, "/sessions/1/updatedAtUtc")).toEqual(["session-updated-at-not-advanced"]);
    expect(codes(result)).toEqual(["session-updated-at-not-advanced"]);
  });

  test("completing a session without advancing `updatedAtUtc` fails (TR-04, Req 11.21)", () => {
    const candidate = clone(asRecord(correctionCandidate));
    const session = sessionsOf(candidate)[1];
    session["status"] = "completed";
    session["endedAtUtc"] = "2026-08-21T05:40:00Z";
    delete session["executionPlan"];
    session["updatedAtUtc"] = "2026-08-21T05:05:00Z"; // the terminal transition left the time behind
    const result = validateShardCorrection(correctionBase, candidate);
    expect(codes(result)).toEqual(["session-updated-at-not-advanced"]);
  });

  test("an unreadable candidate `updatedAtUtc` fails closed (recovery)", () => {
    const absent: unknown = undefined;
    // Every value below names no readable persisted instant, so advancement cannot be proven for it.
    const unreadableTimes: unknown[] = [
      "",
      "2026-08-26T18:10:00+02:00", // numeric offset, never canonical (invariant 26)
      "2026-08-26T18:10:00z", // lowercase suffix, never canonical
      "last Thursday",
      1787237100000 // a number, not a timestamp
    ];
    for (const value of [absent].concat(unreadableTimes)) {
      const candidate = clone(asRecord(correctionCandidate));
      if (value === undefined) {
        delete sessionsOf(candidate)[0]["updatedAtUtc"];
      } else {
        sessionsOf(candidate)[0]["updatedAtUtc"] = value;
      }
      const result = validateShardCorrection(correctionBase, candidate);
      expect(result.valid).toBe(false);
      expect(at(result, "/sessions/0/updatedAtUtc")).toEqual(["session-updated-at-unreadable"]);
      expect(codes(result)).toEqual(["session-updated-at-unreadable"]);
    }
  });

  test("an unreadable base `updatedAtUtc` fails closed (no instant to advance from)", () => {
    const base = clone(asRecord(correctionBase));
    sessionsOf(base)[0]["updatedAtUtc"] = "2026-08-20T14:45:00"; // no `Z`, so no persisted instant
    const result = validateShardCorrection(base, correctionCandidate);
    expect(at(result, "/sessions/0/updatedAtUtc")).toEqual(["session-updated-at-unreadable"]);
    expect(codes(result)).toEqual(["session-updated-at-unreadable"]);
  });

  // Readable is a format fact, not whatever a date parser will accept: spec §8 invariant 26 and FF-12 give the
  // canonical `YYYY-MM-DDTHH:mm:ss[.fff]Z` text and the asserted `date-time` format the schema registry
  // registers gives the calendar. A value that rolls into a neighbouring month, day, or hour is therefore
  // unreadable here, so no advancement is ever proven or denied from a value the schema layer refuses.
  const IMPOSSIBLE_TIMES: readonly string[] = [
    "2026-02-30T00:00:00Z", // February has 28 days in a common year
    "2026-02-29T12:00:00Z", // 2026 is not a leap year, so it has no 29 February
    "2026-04-31T00:00:00Z", // April has 30 days
    "2026-13-01T00:00:00Z", // month 13 is no month
    "2026-00-10T00:00:00Z", // month 00 is no month
    "2026-01-00T00:00:00Z", // day 00 is no day
    "2026-08-20T24:00:00Z", // hour 24 is no hour of the day
    "2026-08-20T12:60:00Z", // minute 60 is no minute
    "2026-08-20T12:00:61Z" // second 61 is no second at all
  ];

  test("an impossible calendar date fails unreadable instead of reading as a rolled-forward instant (invariant 26, FF-12)", () => {
    for (const value of IMPOSSIBLE_TIMES) {
      const candidate = clone(asRecord(correctionCandidate));
      sessionsOf(candidate)[0]["updatedAtUtc"] = value;
      const result = validateShardCorrection(correctionBase, candidate);
      expect(result.valid).toBe(false);
      // Unreadable, and not merely not later: an earlier real instant and an instant no calendar has are two
      // different findings, and only the first is something the pass could compare at all.
      expect(at(result, "/sessions/0/updatedAtUtc")).toEqual(["session-updated-at-unreadable"]);
      expect(codes(result)).toEqual(["session-updated-at-unreadable"]);
      // The schema layer refuses the same text, so the semantic pass reads no instant the schema layer refuses.
      expect(schemaValid(candidate)).toBe(false);
    }
  });

  test("a correction whose two last-correction times are both impossible dates fails closed (fail-open repair)", () => {
    // Both texts sit on 30 February and the candidate's is later in the day. A reader that parses instead of
    // validating finds a February-rolling later instant on the candidate side and reports a clean save; the
    // advancement rule has no instant to advance from, which is its own finding.
    const base = clone(asRecord(correctionBase));
    const candidate = clone(asRecord(correctionCandidate));
    sessionsOf(base)[0]["updatedAtUtc"] = "2026-02-30T00:00:00Z";
    sessionsOf(candidate)[0]["updatedAtUtc"] = "2026-02-30T12:00:00Z";
    const result = validateShardCorrection(base, candidate);
    expect(result.valid).toBe(false);
    expect(at(result, "/sessions/0/updatedAtUtc")).toEqual(["session-updated-at-unreadable"]);
    expect(codes(result)).toEqual(["session-updated-at-unreadable"]);
  });

  test("an impossible date on the base side is unreadable too, whoever holds it (recovery)", () => {
    const base = clone(asRecord(correctionBase));
    sessionsOf(base)[0]["updatedAtUtc"] = "2026-08-20T24:00:00Z"; // hour 24, so no persisted instant
    const result = validateShardCorrection(base, correctionCandidate);
    expect(at(result, "/sessions/0/updatedAtUtc")).toEqual(["session-updated-at-unreadable"]);
    expect(codes(result)).toEqual(["session-updated-at-unreadable"]);
  });

  // Second `60` is the one timestamp fact this pass reads more narrowly than the registry's grammar, and the
  // narrower read is RFC 3339's own: §5.7 caps time-second at `59` and admits `60` only "based on leap second
  // calendar", and Appendix D puts that extra second at the end of a day in UTC, as `YYYY-MM-DDT23:59:60Z`.
  // Invariant 26 asks for "a valid RFC 3339 date-time", so a sixtieth second is an instant only at the end of a
  // day the leap-second calendar carries. Two facts narrow that set and each is refused below on its own: the
  // minute of the day, then the date. Each text is asserted schema-valid first, so the semantic diagnostic is
  // proven to be the only gate that refuses it rather than a duplicate of a schema rejection.

  // Every date in the list below does carry an inserted second, so each line refuses the minute of the day and
  // nothing else.
  const SECOND_60_OUTSIDE_A_DAY_END: readonly string[] = [
    "2016-12-31T12:00:60Z", // mid-afternoon of a day that ends with an extra second
    "1972-06-30T00:00:60Z", // the first minute of such a day is not its last
    "2016-12-31T23:00:60Z", // the last hour, and a minute that is not the last
    "2016-12-31T23:58:60Z", // two minutes before the extra second
    "1998-12-31T22:59:60Z", // the last minute of the hour, and the hour before the extra second
    "1983-06-30T12:59:60Z" // a June day of the table, read at a midday minute
  ];

  test("second 60 outside the end of a UTC day names no instant, whoever holds it (invariant 26, FF-12)", () => {
    for (const value of SECOND_60_OUTSIDE_A_DAY_END) {
      const [base, candidate] = pairWithTimes("2026-08-20T14:45:00Z", value);
      expect(schemaValid(candidate)).toBe(true);
      // Unreadable, and not merely not later: the pass compares no instant derived from a minute of 60 seconds.
      expect(codes(validateShardCorrection(base, candidate))).toEqual(["session-updated-at-unreadable"]);
      // The same text on the base side is unreadable too: an unreadable time is a fact of the value, never of
      // the side that carries it.
      const [unreadableBase, readableCandidate] = pairWithTimes(value, "2026-08-20T14:45:00Z");
      expect(codes(validateShardCorrection(unreadableBase, readableCandidate))).toEqual([
        "session-updated-at-unreadable"
      ]);
    }
  });

  test("a last-correction time that rolls out of a made-up 60-second minute fails closed (fail-open repair)", () => {
    // Read leniently, `14:44:60.0001` is `14:45:00.0001`: one ten-thousandth of a millisecond after the base's
    // `14:45:00Z`, so the save would look like a clean advancement. Minute `14:44` of that day has 60 seconds
    // only in the pass that invents one, so the rule reads no instant and reports the time it cannot read.
    const [base, candidate] = pairWithTimes("2026-08-20T14:45:00Z", "2026-08-20T14:44:60.0001Z");
    expect(schemaValid(candidate)).toBe(true);
    const result = validateShardCorrection(base, candidate);
    expect(result.valid).toBe(false);
    expect(at(result, "/sessions/0/updatedAtUtc")).toEqual(["session-updated-at-unreadable"]);
    expect(codes(result)).toEqual(["session-updated-at-unreadable"]);
  });

  // The second fact is the calendar itself. RFC 3339 §5.7 writes time-second as `00-60` "based on leap second
  // calendar", so a `23:59:60` on a day with no inserted second names no instant: that day has 86400 seconds and
  // the grammar alone does not know it. Every date below is a real UTC day end that the registry accepts and the
  // leap-second calendar leaves out, and each is one second the IERS never inserted.
  const SECOND_60_AT_A_DAY_END_WITH_NO_LEAP_SECOND: readonly string[] = [
    "1971-12-31T23:59:60Z", // one day before 1 January 1972, where the present scale and the table begin
    "1980-12-31T23:59:60Z", // between the 1979-12-31 insertion and the 1981-06-30 one
    "1984-06-30T23:59:60Z", // a 30 June between the 1983-06-30 and 1985-06-30 insertions
    "1991-12-31T23:59:60Z", // a December end between the 1990-12-31 and 1992-06-30 insertions
    "1996-12-31T23:59:60Z", // a December end between the 1995-12-31 and 1997-06-30 insertions
    "1999-12-31T23:59:60Z", // the year after the 1998-12-31 insertion, and nine years before the next
    "2000-06-30T23:59:60Z", // a June end of a leap year, which is not a leap second
    "2012-12-31T23:59:60Z", // the December of the 2012-06-30 insertion, which carried none
    "2015-12-31T23:59:60Z", // between the 2015-06-30 insertion and the 2016-12-31 one
    "2016-06-30T23:59:60Z", // the June of the last insertion year, which carried none
    "2017-06-30T23:59:60Z", // the first candidate after the last insertion, which carried none
    "2026-06-30T23:59:60Z", // a month end of the present era, where no second has been inserted since 2016
    "2026-12-31T23:59:60Z", // and a year end of it
    "2026-08-20T23:59:60Z", // an ordinary day, neither a June end nor a December end
    "0000-01-01T23:59:60Z", // the first day the four-digit year can name
    "9999-12-31T23:59:60Z" // the last day it can name
  ];

  test("second 60 on a day the leap-second calendar does not carry names no instant (invariant 26, FF-12)", () => {
    for (const value of SECOND_60_AT_A_DAY_END_WITH_NO_LEAP_SECOND) {
      const [base, candidate] = pairWithTimes("2026-08-20T14:45:00Z", value);
      expect(schemaValid(candidate)).toBe(true);
      // Unreadable rather than read as the next day's first second. Rolling `2026-06-30T23:59:60Z` into 1 July
      // would let a save prove an advancement from a second no UTC clock ever showed.
      expect(codes(validateShardCorrection(base, candidate))).toEqual(["session-updated-at-unreadable"]);
      // Unreadable on the base side as well: an unreadable time is a fact of the value, never of the side that
      // carries it.
      const [unreadableBase, readableCandidate] = pairWithTimes(value, "2026-08-20T14:45:00Z");
      expect(codes(validateShardCorrection(unreadableBase, readableCandidate))).toEqual([
        "session-updated-at-unreadable"
      ]);
    }
  });

  // Each pair below is `23:59:59` of one day followed by the sixtieth second of that same day, on days the
  // leap-second calendar does carry: RFC 3339 §5.7 admits second `60` only where that calendar inserts one, so
  // the 27 inserted seconds are the whole readable set and this reads the first, the last, and days between.
  const DAY_END_LEAP_SECONDS: readonly (readonly [string, string])[] = [
    ["1972-06-30T23:59:59Z", "1972-06-30T23:59:60Z"], // the first inserted second of the present scale
    ["1979-12-31T23:59:59Z", "1979-12-31T23:59:60Z"],
    ["1983-06-30T23:59:59Z", "1983-06-30T23:59:60Z"], // a June insertion
    ["1998-12-31T23:59:59Z", "1998-12-31T23:59:60Z"],
    ["2015-06-30T23:59:59Z", "2015-06-30T23:59:60Z"],
    ["2016-12-31T23:59:59Z", "2016-12-31T23:59:60Z"] // the last inserted second so far
  ];

  test("second 60 on a day the leap-second calendar carries is readable and one second later (positive control)", () => {
    for (const [baseTime, candidateTime] of DAY_END_LEAP_SECONDS) {
      const [base, candidate] = pairWithTimes(baseTime, candidateTime);
      expect(schemaValid(base)).toBe(true);
      expect(schemaValid(candidate)).toBe(true);
      // Readable, and one second later, so the inserted second is an advancement and not a finding.
      expect(codes(validateShardCorrection(base, candidate))).toEqual([]);
    }
    // The inserted second carries a fraction as any other second does, so half a second into it is still later.
    const [leapBase, leapCandidate] = pairWithTimes("2016-12-31T23:59:60Z", "2016-12-31T23:59:60.5Z");
    expect(schemaValid(leapCandidate)).toBe(true);
    expect(codes(validateShardCorrection(leapBase, leapCandidate))).toEqual([]);
  });

  // The inserted second has to sit in the order as well as be accepted. It is the extra second of its day and it
  // ends where the next day's midnight begins, so each text below is strictly earlier than the one after it. The
  // day count the pass uses adds one second per day and knows nothing about the extra one, so the inserted second
  // and that midnight land on one whole-second count, and the fraction has to keep every digit to order them:
  // `23:59:60.999999999999` is still inside the extra second and `00:00:00.000000000001` is already the next day.
  const LEAP_SECOND_ORDER: readonly (readonly [string, string])[] = [
    ["2016-12-31T23:59:59.999999Z", "2016-12-31T23:59:60Z"], // the extra second follows the second before it
    ["2016-12-31T23:59:60Z", "2016-12-31T23:59:60.000001Z"], // and holds a fraction like any other second
    ["2016-12-31T23:59:60Z", "2017-01-01T00:00:00Z"], // the next day's midnight is one second later
    ["2016-12-31T23:59:60.5Z", "2017-01-01T00:00:00Z"], // half way into the extra second is not the next day
    ["1972-06-30T23:59:60.5Z", "1972-07-01T00:00:00Z"], // the same read across a month boundary
    ["2016-12-31T23:59:60.999999999999Z", "2017-01-01T00:00:00Z"], // a long fraction, and still not the midnight
    ["2016-12-31T23:59:60.999999999999999999999999Z", "2017-01-01T00:00:00Z"], // 24 digits, still the extra second
    ["2016-12-31T23:59:60.999999999999Z", "2017-01-01T00:00:00.000000000001Z"], // one digit past the boundary
    ["1998-12-31T23:59:60.000000000001Z", "1999-01-01T00:00:00Z"] // a year end of the table
  ];

  test("the inserted second and every fraction written on it end before the next midnight (invariant 26, FF-12)", () => {
    for (const [earlier, later] of LEAP_SECOND_ORDER) {
      const [base, candidate] = pairWithTimes(earlier, later);
      expect(schemaValid(base)).toBe(true);
      expect(schemaValid(candidate)).toBe(true);
      expect(codes(validateShardCorrection(base, candidate))).toEqual([]);
      // Read the other way round the two are not later, so the order is strict in both directions and no unit
      // truncates the difference away.
      expect(codes(validateShardCorrection(candidate, base))).toEqual(["session-updated-at-not-advanced"]);
    }
  });

  // Each pair below writes one instant of the extra second in two spellings. Req 11.21 asks the time to move, and
  // a rewrite of its spelling moves nothing, so each pair fails closed whichever side is read first.
  const LEAP_SECOND_SAME_INSTANT_TEXTS: readonly (readonly [string, string])[] = [
    ["2016-12-31T23:59:60Z", "2016-12-31T23:59:60.0Z"], // no fraction and a zero fraction
    ["2016-12-31T23:59:60.25Z", "2016-12-31T23:59:60.250000000Z"], // a fraction and the same fraction padded out
    ["1972-06-30T23:59:60.5Z", "1972-06-30T23:59:60.500000000000Z"] // digits that say nothing after the last one
  ];

  test("the inserted second written with another fraction is one instant and not an advancement (Req 11.21)", () => {
    for (const [first, second] of LEAP_SECOND_SAME_INSTANT_TEXTS) {
      const [withFirst, withSecond] = pairWithTimes(first, second);
      expect(schemaValid(withFirst)).toBe(true);
      expect(schemaValid(withSecond)).toBe(true);
      expect(codes(validateShardCorrection(withFirst, withSecond))).toEqual(["session-updated-at-not-advanced"]);
      expect(codes(validateShardCorrection(withSecond, withFirst))).toEqual(["session-updated-at-not-advanced"]);
    }
  });

  /**
   * The legal one-corrected-session save with both last-correction times written explicitly: session 0 carries
   * a corrected result value, so it is the one session asked to advance, and session 1 is copied through.
   */
  function pairWithTimes(baseTime: string, candidateTime: string): [Record<string, unknown>, Record<string, unknown>] {
    const base = clone(asRecord(correctionBase));
    sessionsOf(base)[0]["updatedAtUtc"] = baseTime;
    const candidate = saveOfOneCorrectedSession();
    sessionsOf(candidate)[0]["updatedAtUtc"] = candidateTime;
    return [base, candidate];
  }

  // Every pair below is two instants the calendar has, one strictly after the other, and each straddles a
  // calendar rule the canonical grammar alone cannot state. Each is asserted schema-valid first, so the
  // semantic pass is proven to read exactly the set the schema layer accepts.
  const READABLE_PAIRS: readonly (readonly [string, string])[] = [
    ["2028-02-29T00:00:00Z", "2028-02-29T00:00:01Z"], // 2028 is a leap year
    ["2000-02-29T23:59:59Z", "2000-03-01T00:00:00Z"], // a century divisible by 400 is a leap year
    ["2100-02-28T23:59:59Z", "2100-03-01T00:00:00Z"], // 2100 is not, so 28 February ends the month
    ["2400-02-29T12:00:00Z", "2400-02-29T12:00:01Z"], // and 2400 is one as well
    ["2016-12-31T23:59:59Z", "2016-12-31T23:59:60Z"], // the leap second the calendar carries is one second later
    ["2016-12-31T23:59:60Z", "2017-01-01T00:00:00Z"], // and it ends where the next midnight begins
    ["2026-12-31T23:59:59Z", "2027-01-01T00:00:00Z"], // the year boundary of the shifted-year count
    ["2026-08-31T23:59:59Z", "2026-09-01T00:00:00Z"], // the month boundary of the day-count table
    ["2026-08-20T14:45:00.001Z", "2026-08-20T14:45:00.002Z"], // the fraction is read, not dropped
    ["0099-12-31T23:59:59Z", "0100-01-01T00:00:00Z"], // year 0099 is the 99th year, not 1999
    ["9999-12-31T23:59:58Z", "9999-12-31T23:59:59Z"] // the last year the four-digit year can name
  ];

  test("a date the calendar has is read as the instant it denotes, in either position (positive control)", () => {
    for (const [baseTime, candidateTime] of READABLE_PAIRS) {
      const [base, candidate] = pairWithTimes(baseTime, candidateTime);
      expect(schemaValid(base)).toBe(true);
      expect(schemaValid(candidate)).toBe(true);
      expect(codes(validateShardCorrection(base, candidate))).toEqual([]);
      // Written the other way round the same two instants are not later, so the rule compares instants and
      // never the text.
      expect(codes(validateShardCorrection(candidate, base))).toEqual(["session-updated-at-not-advanced"]);
    }
  });

  // The fraction of a second has no fixed length: spec §8 invariant 26 gives RFC 3339, which writes it as a
  // point and then any number of digits. So a save can advance a last-correction time by a step smaller than
  // any one unit, and the comparison has to read every digit to see it. Each pair below is one instant strictly
  // after the other, and each is asserted schema-valid first, so the semantic pass is proven to order exactly
  // the text the schema layer accepts.
  const PRECISION_PAIRS: readonly (readonly [string, string])[] = [
    ["2026-08-20T14:45:00.0000Z", "2026-08-20T14:45:00.0001Z"], // the step below the millisecond
    ["2026-08-20T14:45:00.123456Z", "2026-08-20T14:45:00.123457Z"], // six digits, still one step apart
    ["2026-08-20T14:45:00.0009Z", "2026-08-20T14:45:00.001Z"], // the shorter fraction is the later one
    ["2026-08-20T14:45:00.0001Z", "2026-08-20T14:45:00.001Z"], // one digit decides, past the millisecond
    ["2026-08-20T14:45:00.199999999Z", "2026-08-20T14:45:00.2Z"], // a leading digit outranks a longer tail
    ["2026-08-20T14:45:00.999999999Z", "2026-08-20T14:45:01Z"], // the last step before the next second
    ["2026-08-20T14:44:59.999999999999Z", "2026-08-20T14:45:00.000000000001Z"], // twelve digits across a second
    ["2026-08-20T14:45:00.0000000000000000000001Z", "2026-08-20T14:45:00.0000000000000000000002Z"] // 22 digits
  ];

  test("a last-correction time that advances by less than one millisecond advances (Req 11.21, invariant 16)", () => {
    for (const [baseTime, candidateTime] of PRECISION_PAIRS) {
      const [base, candidate] = pairWithTimes(baseTime, candidateTime);
      expect(schemaValid(base)).toBe(true);
      expect(schemaValid(candidate)).toBe(true);
      // Later means later, and no unit truncates the difference away.
      expect(codes(validateShardCorrection(base, candidate))).toEqual([]);
      // Written the other way round the same two instants are not later, so the rule still compares instants
      // and never the length or the text of a fraction.
      expect(codes(validateShardCorrection(candidate, base))).toEqual(["session-updated-at-not-advanced"]);
    }
  });

  // Two texts can name one instant with a different number of digits. Req 11.21 asks the time to move, and a
  // rewrite of its spelling moves nothing, so each pair below fails closed whichever side is read first.
  const SAME_INSTANT_TEXTS: readonly (readonly [string, string])[] = [
    ["2026-08-20T14:45:00Z", "2026-08-20T14:45:00.000000Z"], // no fraction and a zero fraction
    ["2026-08-20T14:45:00.0Z", "2026-08-20T14:45:00.0000Z"], // one zero and four zeros
    ["2026-08-20T14:45:00.5Z", "2026-08-20T14:45:00.500000Z"], // a fraction and the same fraction padded out
    ["2026-08-20T14:45:00.25Z", "2026-08-20T14:45:00.250000000Z"] // digits that say nothing after the last one
  ];

  test("two fraction spellings of one instant leave the last-correction time unchanged (Req 11.21)", () => {
    for (const [first, second] of SAME_INSTANT_TEXTS) {
      const [withFirst, withSecond] = pairWithTimes(first, second);
      expect(schemaValid(withFirst)).toBe(true);
      expect(schemaValid(withSecond)).toBe(true);
      // Neither text is later than the other, so neither is a saved correction.
      expect(codes(validateShardCorrection(withFirst, withSecond))).toEqual(["session-updated-at-not-advanced"]);
      expect(codes(validateShardCorrection(withSecond, withFirst))).toEqual(["session-updated-at-not-advanced"]);
    }
  });

  test("every digit of a long fraction is readable, and a point with no digit is not (invariant 26, recovery)", () => {
    // A long fraction is inside the persisted format, so it reads as the instant it denotes rather than as an
    // unreadable time or as the instant its first three digits denote.
    const [longBase, longCandidate] = pairWithTimes(
      "2026-08-20T14:45:00.0000000000000000000000Z",
      "2026-08-20T14:45:00.0000000000000000000001Z"
    );
    expect(schemaValid(longBase)).toBe(true);
    expect(schemaValid(longCandidate)).toBe(true);
    expect(codes(validateShardCorrection(longBase, longCandidate))).toEqual([]);
    // A point with no digit after it is outside the format, so it is unreadable on both gates rather than a
    // fraction of no value.
    const [base, candidate] = pairWithTimes("2026-08-20T14:45:00Z", "2026-08-20T14:45:00.Z");
    expect(schemaValid(candidate)).toBe(false);
    const result = validateShardCorrection(base, candidate);
    expect(result.valid).toBe(false);
    expect(at(result, "/sessions/0/updatedAtUtc")).toEqual(["session-updated-at-unreadable"]);
  });

  test("the advancement rule preserves the other correction rules (RS-04, TR-05, TR-08)", () => {
    const candidate = clone(asRecord(correctionCandidate));
    const session = sessionsOf(candidate)[0];
    session["updatedAtUtc"] = "2026-08-20T14:45:00Z"; // unchanged
    session["startedAtUtc"] = "2026-08-19T14:00:00Z"; // moved
    session["status"] = "abandoned"; // a terminal session reopened
    candidate["yearMonthUtc"] = "2026-09"; // the shard moved
    const result = validateShardCorrection(correctionBase, candidate);
    expect(at(result, "/sessions/0/startedAtUtc")).toEqual(["session-start-immutable"]);
    expect(at(result, "/sessions/0/status")).toEqual(["session-status-immutable"]);
    expect(at(result, "/sessions/0/updatedAtUtc")).toEqual(["session-updated-at-not-advanced"]);
    expect(at(result, "/yearMonthUtc")).toEqual(["shard-year-month-immutable"]);
    expect(codes(result)).toEqual([
      "session-start-immutable",
      "session-status-immutable",
      "session-updated-at-not-advanced",
      "shard-year-month-immutable"
    ]);
  });

  test("an unreadable correction input fails closed", () => {
    const result = validateShardCorrection(correctionBase, "not a document");
    expect(result.valid).toBe(false);
    expect(result.diagnostics[0].code).toBe("results-document-unstructured");
  });
});

describe("RS-05: direct workout references (invariants 3-4)", () => {
  test("an unresolvable session `workoutId` fails at its pointer", () => {
    const result = check(invalidPaths);
    expect(at(result, "/sessions/1/workoutId")).toContain("session-workout-unresolved");
  });

  test("a result whose `workoutId` differs from its session fails at its pointer", () => {
    const result = check(invalidPaths);
    expect(at(result, "/sessions/0/results/0/workoutId")).toContain("result-workout-mismatch");
  });

  test("a deprecated retained workout still resolves (invariant 24)", () => {
    const document = asRecord(contextShard);
    expect(sessionsOf(document)[4]["workoutId"]).toBe("retired-workout");
    expect(check(contextShard).valid).toBe(true);
  });

  test("a missing workouts directory disables resolution instead of inventing references", () => {
    const result = validateResultsShard(contextShard, {}, exercises, CONTEXT_NAME);
    expect(codes(result).indexOf("session-workout-unresolved")).toBe(-1);
    expect(codes(result).indexOf("result-exercise-unresolved")).toBe(-1);
    expect(result.valid).toBe(true);
  });
});

describe("RS-06: execution paths (invariant 5)", () => {
  test("nested repeated containers each contribute their own iteration segment", () => {
    const document = asRecord(contextShard);
    const nested = resultsOf(document, 1)[0]["executionPath"] as Record<string, unknown>[];
    expect(nested.map((segment) => segment["iteration"])).toEqual([undefined, 1, 1, undefined]);
    expect(check(contextShard).valid).toBe(true);
  });

  test("the paths fixture stays schema-valid so the semantic pass is the only signal", () => {
    expect(schemaValid(invalidPaths)).toBe(true);
  });

  test("a repeated container the path descends through must carry a one-based iteration", () => {
    const result = check(invalidPaths);
    expect(at(result, "/sessions/0/results/2/executionPath/1")).toContain("result-path-iteration-missing");
  });

  test("a segment of a non-repeated node must not carry an iteration", () => {
    const result = check(invalidPaths);
    expect(at(result, "/sessions/0/results/3/executionPath/2/iteration")).toContain("result-path-iteration-forbidden");
  });

  test("a plain sequence segment without an iteration stays valid", () => {
    const document = asRecord(contextShard);
    const path = resultsOf(document, 0)[3]["executionPath"] as Record<string, unknown>[];
    expect(path[1]["nodeId"]).toBe("singles");
    expect(path[1]["iteration"]).toBe(undefined);
    expect(check(contextShard).valid).toBe(true);
  });

  test("an aggregate container path names its repeated container without an iteration", () => {
    const document = asRecord(contextShard);
    const container = resultsOf(document, 0)[6];
    const path = container["executionPath"] as Record<string, unknown>[];
    expect(path[1]["nodeId"]).toBe("finisher");
    expect(path[1]["iteration"]).toBe(undefined);
    expect(check(contextShard).valid).toBe(true);
  });

  test("a repeated segment accepts any one-based integer above 1", () => {
    const document = clone(asRecord(contextShard));
    expect(repeatedSegment(document)["nodeId"]).toBe("squat-sets");
    repeatedSegment(document)["iteration"] = 3;
    const result = check(document);
    expect(codes(result)).toEqual([]);
    expect(result.valid).toBe(true);
  });

  test("an iteration of 0 on a repeated segment is reported at its own pointer", () => {
    const document = clone(asRecord(contextShard));
    repeatedSegment(document)["iteration"] = 0;
    const result = check(document);
    const pointer = "/sessions/2/results/0/executionPath/1/iteration";
    expect(at(result, pointer)).toContain("result-path-iteration-invalid");
    expect(at(result, pointer)).not.toContain("result-path-iteration-forbidden");
    // Only the value is reported: the node below the segment still resolves.
    expect(under(result, "/sessions/2/results/0/executionPath/2")).toEqual([]);
  });

  test("a fractional, string, boolean, or null iteration on a repeated segment is reported", () => {
    const malformed: [string, unknown][] = [
      ["1.5", 1.5],
      ["'1'", "1"],
      ["true", true],
      ["null", null]
    ];
    const reported: string[] = [];
    for (const entry of malformed) {
      const document = clone(asRecord(contextShard));
      repeatedSegment(document)["iteration"] = entry[1];
      const result = check(document);
      if (at(result, "/sessions/2/results/0/executionPath/1/iteration").includes("result-path-iteration-invalid")) {
        reported.push(entry[0]);
      }
    }
    expect(reported).toEqual(["1.5", "'1'", "true", "null"]);
  });

  test("the schema gate rejects the same malformed iterations (the pass is the second gate)", () => {
    for (const value of [0, 1.5, "1", true, null]) {
      const document = clone(asRecord(contextShard));
      repeatedSegment(document)["iteration"] = value;
      expect(schemaValid(document)).toBe(false);
    }
    const accepted = clone(asRecord(contextShard));
    repeatedSegment(accepted)["iteration"] = 2;
    expect(schemaValid(accepted)).toBe(true);
  });

  test("a malformed iteration on a terminal repeated segment is reported too", () => {
    // The tolerance for an aggregate container path is about absence, not value: the same segment without
    // an iteration stays valid (the test above), and one that carries a value carries a one-based one.
    const document = clone(asRecord(contextShard));
    expect(repeatedTerminalSegment(document)["nodeId"]).toBe("finisher");
    repeatedTerminalSegment(document)["iteration"] = 0;
    const result = check(document);
    expect(at(result, "/sessions/0/results/6/executionPath/1/iteration")).toContain("result-path-iteration-invalid");
  });

  test("a segment of a non-repeated node keeps reporting the forbidden code for any value", () => {
    const document = clone(asRecord(contextShard));
    expect(fixedSegment(document)["nodeId"]).toBe("singles");
    fixedSegment(document)["iteration"] = 0;
    const result = check(document);
    const pointer = "/sessions/0/results/3/executionPath/1/iteration";
    expect(at(result, pointer)).toContain("result-path-iteration-forbidden");
    expect(at(result, pointer)).not.toContain("result-path-iteration-invalid");
  });

  test("a path that skips a level or names an unknown node does not resolve", () => {
    const result = check(invalidPaths);
    expect(at(result, "/sessions/0/results/1/executionPath/1/nodeId")).toContain("result-path-node-unresolved");
    expect(at(result, "/sessions/0/results/6/executionPath/2/nodeId")).toContain("result-path-node-unresolved");
  });

  test("a path that does not start at the workout root fails at its first segment", () => {
    const result = check(invalidPaths);
    expect(at(result, "/sessions/0/results/4/executionPath/0/nodeId")).toContain("result-path-root-mismatch");
  });

  test("a terminal node whose kind differs from the result type fails", () => {
    const result = check(invalidPaths);
    expect(at(result, "/sessions/0/results/5/executionPath/2")).toContain("result-path-terminal-type-mismatch");
  });

  test("an empty path is reported once at the path pointer", () => {
    const document = clone(asRecord(invalidPaths));
    const target = resultsOf(document, 0)[9];
    target["executionPath"] = [];
    expect(schemaValid(document)).toBe(false); // the schema owns minItems; the pass owns the report
    const result = check(document);
    expect(at(result, "/sessions/0/results/9/executionPath")).toContain("result-path-unreadable");
    expect(at(result, "/sessions/0/results/9/executionPath/0/nodeId")).toEqual([]);
  });

  test("a path segment that is not an object stops resolution without throwing", () => {
    const document = clone(asRecord(invalidPaths));
    const target = resultsOf(document, 0)[9];
    target["executionPath"] = [{ "nodeId": "root" }, "not-a-segment"];
    const result = check(document);
    expect(at(result, "/sessions/0/results/9/executionPath/1")).toContain("result-path-unreadable");
  });
});

describe("RS-07: direct exercise references (invariant 6)", () => {
  test("a direct `exerciseId` that differs from the terminal node fails", () => {
    const result = check(invalidPaths);
    expect(at(result, "/sessions/0/results/7/exerciseId")).toContain("result-exercise-mismatch");
  });

  test("a direct `exerciseId` that is not retained fails", () => {
    const result = check(invalidPaths);
    expect(at(result, "/sessions/0/results/8/exerciseId")).toContain("result-exercise-unresolved");
  });

  test("a deprecated exercise still resolves for a historical result (invariant 24)", () => {
    const document = asRecord(contextShard);
    const skipped = resultsOf(document, 0)[4];
    expect(skipped["exerciseId"]).toBe("push-up");
    expect(asRecord(exercises)["exercises"]).toBeDefined();
    expect(check(contextShard).valid).toBe(true);
    expect(codes(check(contextShard)).indexOf("result-exercise-unresolved")).toBe(-1);
  });
});

describe("TR-04 / Req 6.11: an active session resolves in its frozen plan", () => {
  test("the frozen-plan fixture stays schema-valid so the lifecycle pass is the only signal", () => {
    expect(schemaValid(frozenPlanShard)).toBe(true);
  });

  test("the fixture plan differs from the retained tree, which is what the cases below turn on", () => {
    // `push-up` is deprecated, so a session that started after its deprecation freezes a plan without it
    // (TR-02) while the retained tree still carries the node (invariants 23-24).
    expect(planFinisherChildIds(sessionsOf(asRecord(frozenPlanShard))[0])).toEqual(["squat-1"]);
    expect(workoutFinisherChildIds(workouts)).toEqual(["push-1", "squat-1"]);
  });

  test("an active session resolves its ordinary path in the plan and its recorded deprecated skip in the retained tree", () => {
    // Session 0: one ordinary result inside the plan, plus the skipped `reasonCode: "deprecated"` record
    // that names the plan-omitted path (TR-02; spec §5 Frozen Execution Plan).
    const result = check(frozenPlanShard);
    expect(under(result, "/sessions/0")).toEqual([]);
  });

  test("an ordinary result at a path the frozen plan omits fails instead of inventing a historical tree", () => {
    // The same path that session 0 records as a skip; here it carries measured work, and the plan — the
    // cited root (Req 6.11, TR-04) — has no such node.
    const result = check(frozenPlanShard);
    expect(under(result, "/sessions/1")).toEqual(["result-path-node-unresolved"]);
    expect(at(result, "/sessions/1/results/0/executionPath/2/nodeId")).toContain("result-path-node-unresolved");
  });

  test("the recorded omission keeps both halves of its direct exercise reference in the retained tree (RS-07, invariant 24)", () => {
    // Session 2 records the same plan-omitted path with an `exerciseId` no retained exercise carries and the
    // retained `push-1` node does not reference either. The plan carries no `push-1` node at all, so both
    // findings come from the retained tree, where invariants 23-24 keep the node and the deprecated exercise.
    const result = check(frozenPlanShard);
    expect(under(result, "/sessions/2")).toEqual(["result-exercise-mismatch", "result-exercise-unresolved"]);
  });

  test("the same recorded skip in a terminal session resolves in the retained tree (TR-05, Req 11.17)", () => {
    const document = clone(asRecord(frozenPlanShard));
    makeTerminal(sessionsOf(document)[0]);
    const result = check(document);
    // Resolution moves to the retained tree, where the deprecated node and the deprecated exercise stay.
    expect(under(result, "/sessions/0")).toEqual([]);
  });

  test("a later bundle changes nothing about what an active session already recorded", () => {
    expect(validateResultsShard(contextShard, laterBundleWorkouts, exercises, CONTEXT_NAME).valid).toBe(true);
  });

  test("a resumed active session never adopts a node that a later bundle added (TR-04 negative)", () => {
    expect(miniChildIds(workouts)).toEqual(["row-1", "squat-1"]);
    expect(miniChildIds(laterBundleWorkouts)).toEqual(["row-1", "squat-1", "row-2"]);

    const document = clone(asRecord(contextShard));
    const session = sessionsOf(document)[1];
    expect(session["status"]).toBe("in_progress");
    resultsOf(document, 1).push(
      resultAtNode(
        "nested-workout",
        [{ nodeId: "blocks", iteration: 1 }, { nodeId: "mini", iteration: 1 }, { nodeId: "row-2" }],
        "row-meter",
        { distance: { value: 250, unit: "m" } }
      )
    );
    expect(schemaValid(document)).toBe(true);

    const result = validateResultsShard(document, laterBundleWorkouts, exercises, CONTEXT_NAME);
    expect(under(result, "/sessions/1/results/1")).toEqual(["result-path-node-unresolved"]);
  });

  test("a terminal session overlays that same path, because its root is the retained tree (TR-05)", () => {
    const document = clone(asRecord(contextShard));
    const session = sessionsOf(document)[1];
    resultsOf(document, 1).push(
      resultAtNode(
        "nested-workout",
        [{ nodeId: "blocks", iteration: 1 }, { nodeId: "mini", iteration: 1 }, { nodeId: "row-2" }],
        "row-meter",
        { distance: { value: 250, unit: "m" } }
      )
    );
    makeTerminal(session);
    const result = validateResultsShard(document, laterBundleWorkouts, exercises, CONTEXT_NAME);
    expect(under(result, "/sessions/1")).toEqual([]);
  });

  test("an active session with no readable plan resolves nothing instead of borrowing the current tree", () => {
    const document = clone(asRecord(contextShard));
    delete sessionsOf(document)[1]["executionPlan"];
    const result = check(document);
    // The plan is the cited root, so its absence is the one finding: no path is checked against a tree the
    // session never froze, and no path diagnostic is invented.
    expect(at(result, "/sessions/1/executionPlan")).toContain("session-plan-required");
    expect(under(result, "/sessions/1/results")).toEqual([]);
  });
});

/**
 * The frozen-plan omission exception, bounded. Authority: specs/rep-jot-json-schema-spec.md §5 Frozen
 * Execution Plan and Execution Path and §8 invariants 5-6; docs/contracts/user-data-contracts.md RS-06 and
 * RS-07; docs/contracts/temporal-and-omission-contracts.md TR-02; docs/REQUIREMENTS.md 6.11. Ordinary
 * active resolution stays exclusively against the frozen plan; the one record the plan omits a path for is
 * checked for its path and its direct exercise ID in the retained tree, and for nothing else.
 */
describe("frozen-plan omission exception: one record, two facts, one fallback root", () => {
  test("a fabricated path on a recorded omission is reported: absence from the plan is not absence of a check", () => {
    const document = clone(asRecord(frozenPlanShard));
    // Neither the plan nor the retained tree carries this path, so nothing about it is provable and
    // nothing is excused: the retained tree resolves it the way it resolves any other path (RS-06).
    resultsOf(document, 0)[1]["executionPath"] = [{ nodeId: "root" }, { nodeId: "nowhere" }, { nodeId: "ghost-node" }];
    const result = check(document);
    expect(under(result, "/sessions/0/results/1")).toEqual(["result-path-node-unresolved"]);
    expect(at(result, "/sessions/0/results/1/executionPath/1/nodeId")).toContain("result-path-node-unresolved");
  });

  test("a path that runs past a leaf is reported for a recorded omission too", () => {
    const document = clone(asRecord(frozenPlanShard));
    resultsOf(document, 0)[1]["executionPath"] = [
      { nodeId: "root" },
      { nodeId: "squat-sets", iteration: 1 },
      { nodeId: "set-1" },
      { nodeId: "push-1" }
    ];
    const result = check(document);
    expect(under(result, "/sessions/0/results/1")).toEqual(["result-path-node-unresolved"]);
    expect(at(result, "/sessions/0/results/1/executionPath/3/nodeId")).toContain("result-path-node-unresolved");
  });

  test("a malformed path is never rerouted to the retained tree", () => {
    const document = clone(asRecord(frozenPlanShard));
    resultsOf(document, 0)[1]["executionPath"] = [
      { nodeId: "not-the-root" },
      { nodeId: "finisher", iteration: 1 },
      { nodeId: "push-1" }
    ];
    const result = check(document);
    expect(under(result, "/sessions/0/results/1")).toEqual(["result-path-root-mismatch"]);
  });

  test("an unreadable segment on a recorded omission is reported once, not filed against two roots", () => {
    const document = clone(asRecord(frozenPlanShard));
    (resultsOf(document, 0)[1]["executionPath"] as unknown[]).push("not-a-segment");
    const result = check(document);
    expect(under(result, "/sessions/0/results/1")).toEqual(["result-path-unreadable"]);
    expect(at(result, "/sessions/0/results/1/executionPath/3")).toContain("result-path-unreadable");
  });

  test("the retained tree decides the direct exercise ID of a recorded omission (invariant 6)", () => {
    const document = clone(asRecord(frozenPlanShard));
    // `air-squat` is retained, so only a node comparison can report it — and the plan holds no `push-1`
    // node to compare with, so that comparison happens in the retained tree or nowhere.
    resultsOf(document, 0)[1]["exerciseId"] = "air-squat";
    const result = check(document);
    expect(under(result, "/sessions/0/results/1")).toEqual(["result-exercise-mismatch"]);
  });

  test("the exception needs both persisted fields: a `user_skipped` record at a plan-omitted path is reported", () => {
    const document = clone(asRecord(frozenPlanShard));
    resultsOf(document, 0)[1]["reasonCode"] = "user_skipped";
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(under(result, "/sessions/0/results/1")).toEqual(["result-path-node-unresolved"]);
    expect(at(result, "/sessions/0/results/1/executionPath/2/nodeId")).toContain("result-path-node-unresolved");
  });

  test("the exception needs both persisted fields: measured work with `deprecated` stays in the plan", () => {
    const document = clone(asRecord(frozenPlanShard));
    resultsOf(document, 0)[1]["status"] = "completed";
    resultsOf(document, 0)[1]["values"] = { reps: 15 };
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(under(result, "/sessions/0/results/1")).toEqual(["result-path-node-unresolved"]);
  });

  test("one session keeps both halves: the recorded omission is clean and measured work at that path is not", () => {
    const document = clone(asRecord(frozenPlanShard));
    const measured = resultAtNode(
      "squat-day",
      [{ nodeId: "finisher", iteration: 1 }, { nodeId: "push-1" }],
      "push-up",
      { reps: 15 }
    );
    // A second attempt keeps the RS-10 tuple distinct, so the path rule is the only signal here.
    measured["attempt"] = 2;
    resultsOf(document, 0).push(measured);
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(under(result, "/sessions/0/results/1")).toEqual([]);
    expect(under(result, "/sessions/0/results/2")).toEqual(["result-path-node-unresolved"]);
  });

  test("with no retained tree the exception cannot run, so the plan keeps its own finding", () => {
    const document = clone(asRecord(frozenPlanShard));
    sessionsOf(document)[0]["workoutId"] = "workshop-gone";
    const result = check(document);
    // RS-05 reports the unresolvable reference. The cited second root is then unavailable, so the record is
    // not excused from plan resolution and the plan's true finding — no node for that path — stands.
    expect(at(result, "/sessions/0/workoutId")).toContain("session-workout-unresolved");
    expect(under(result, "/sessions/0/results/1")).toEqual(["result-path-node-unresolved", "result-workout-mismatch"]);
    expect(at(result, "/sessions/0/results/1/exerciseId")).toEqual([]);
  });
});

/**
 * Frozen-plan identity (D3). The frozen plan is the root an active session resolves in (TR-04, Req 6.11), and
 * the copy relationship between that plan and the workout the session references is itself an authoritative
 * fact: specs/rep-jot-json-schema-spec.md §5 Frozen Execution Plan ("`executionPlan` copies the effective
 * workout root, including node IDs") and §5 Execution Path, §8 invariants 3-5 ("Each result path resolves from
 * *that workout's* root"); docs/REQUIREMENTS.md 6.11 and 6.14-6.15; docs/contracts/user-data-contracts.md
 * RS-05 and RS-06; docs/ARCHITECTURE.md §12 (published node IDs stay present, are never reused, and are never
 * reparented); specs/storage-and-lookup.md §Loading policy.
 *
 * Node identity and position are the only compared facts, so the block also proves what stays legal: a plan
 * that omits branches (TR-02, Req 6.8) and a plan whose content a start-time omission changed.
 */

/** The frozen plan of one session of a shard document. */
function planOf(document: Record<string, unknown>, sessionIndex: number): Record<string, unknown> {
  return asRecord(sessionsOf(document)[sessionIndex]["executionPlan"]);
}
/** The children list of one plan or retained-workout node. */
function planChildNodes(node: Record<string, unknown>): Record<string, unknown>[] {
  return node["children"] as Record<string, unknown>[];
}
/** The root of one retained workout, the identity every plan of that workout must carry. */
function retainedRootOf(document: unknown, workoutId: string): Record<string, unknown> {
  for (const workout of asRecord(document)["workouts"] as Record<string, unknown>[]) {
    if (workout["id"] === workoutId) {
      return asRecord(workout["root"]);
    }
  }
  throw new Error("the workouts fixture holds no workout: " + workoutId);
}
/**
 * Rewrite a plan's root identifier and every one of its result paths to start at the new identifier: one
 * self-consistent fabrication, which is the case a plan-versus-path comparison can never see.
 */
function renamePlanRoot(document: Record<string, unknown>, sessionIndex: number, newId: string): void {
  planOf(document, sessionIndex)["id"] = newId;
  for (const result of resultsOf(document, sessionIndex)) {
    (result["executionPath"] as Record<string, unknown>[])[0]["nodeId"] = newId;
  }
}
/** The first plan node below one plan node, by identifier. */
function planChild(node: Record<string, unknown>, nodeId: string): Record<string, unknown> {
  for (const child of planChildNodes(node)) {
    if (child["id"] === nodeId) {
      return child;
    }
  }
  throw new Error("the plan fixture holds no node: " + nodeId);
}
/** A copy of a node's first child, used to rename a published node or move it to another parent. */
function firstChildCopy(node: Record<string, unknown>): Record<string, unknown> {
  return clone(planChildNodes(node)[0]);
}
/** Every frozen-plan diagnostic of one session, in the deterministic output order. */
function planCodes(result: ResultSemanticResult, sessionPointer: string): string[] {
  const prefix = sessionPointer + "/executionPlan";
  return result.diagnostics.filter((diagnostic) => diagnostic.path.indexOf(prefix) === 0).map((d) => d.code);
}

describe("frozen-plan identity: the plan is the referenced workout root and its stable ancestry", () => {
  test("every active fixture plan carries the referenced workout root identifier (positive control)", () => {
    const document = clone(asRecord(contextShard));
    const session = sessionsOf(document)[1];
    expect(session["status"]).toBe("in_progress");
    expect(planOf(document, 1)["id"]).toBe(retainedRootOf(workouts, "nested-workout")["id"]);
    expect(check(document).valid).toBe(true);
  });

  test("a fabricated plan root fails even when the session's own paths are rewritten to match it", () => {
    const document = clone(asRecord(contextShard));
    // The plan and its paths are fabricated together, so a path-versus-plan comparison is self-consistent and
    // reports nothing: only the referenced workout proves that this plan is not that workout's root.
    renamePlanRoot(document, 1, "copied-root");
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(under(result, "/sessions/1")).toEqual(["session-plan-root-mismatch"]);
    expect(at(result, "/sessions/1/executionPlan/id")).toEqual(["session-plan-root-mismatch"]);
  });

  test("a plan with no readable root identifier is reported, never assumed to be the workout root", () => {
    const document = clone(asRecord(contextShard));
    planOf(document, 1)["id"] = "";
    // The schema owns the identifier shape and rejects it; the semantic pass still fails closed, because an
    // unreadable identifier proves nothing, so no identity is assumed (Arch §12).
    expect(schemaValid(document)).toBe(false);
    const result = check(document);
    expect(under(result, "/sessions/1")).toEqual(["session-plan-root-mismatch"]);
  });

  test("restoring the retained root identifier clears the session again (recovery)", () => {
    const document = clone(asRecord(contextShard));
    renamePlanRoot(document, 1, "copied-root");
    expect(check(document).valid).toBe(false);
    // Restoring the copy relationship — the plan identifier and the paths that name it — is enough: no other
    // fact of the session changes.
    renamePlanRoot(document, 1, String(retainedRootOf(workouts, "nested-workout")["id"]));
    expect(check(document).valid).toBe(true);
  });

  test("a plan branch the referenced workout does not carry is fabricated, and the measured result under it is reported", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    // A whole invented container, and the measured work that resolves inside it: the plan alone calls both
    // clean, which is exactly the gap this row closes (invariant 5, RS-06).
    const invented = clone(planChild(plan, "squat-sets"));
    invented["id"] = "invented-sets";
    planChildNodes(plan).push(invented);
    resultsOf(document, 0).push(
      resultAtNode(
        "squat-day",
        [{ nodeId: "invented-sets", iteration: 1 }, { nodeId: "set-1" }],
        "back-squat",
        { reps: 5, weight: { value: 100, unit: "kg" } }
      )
    );
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(under(result, "/sessions/0")).toEqual(["session-plan-node-unresolved"]);
    expect(at(result, "/sessions/0/executionPlan/children/3/id")).toEqual(["session-plan-node-unresolved"]);
  });

  test("a retained node identifier under a different parent is fabricated ancestry", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    // `set-1` is `squat-sets`' child in the retained workout (invariant 23, Req 6.15: a published node keeps
    // its parent), so copying it under `finisher` invents a position, not a plan omission.
    planChildNodes(planChild(plan, "finisher")).push(firstChildCopy(planChild(plan, "squat-sets")));
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(under(result, "/sessions/0")).toEqual(["session-plan-node-unresolved"]);
    expect(at(result, "/sessions/0/executionPlan/children/2/children/1/id")).toEqual(["session-plan-node-unresolved"]);
  });

  test("a plan copied from another workout fails against the workout the session references", () => {
    const document = clone(asRecord(frozenPlanShard));
    // The two roots carry the same identifier, so the root check alone cannot see this: the ancestry of each
    // plan node against `nested-workout` is what proves the plan is not that workout's copy.
    sessionsOf(document)[0]["workoutId"] = "nested-workout";
    for (const result of resultsOf(document, 0)) {
      result["workoutId"] = "nested-workout";
    }
    const checked = check(document);
    expect(planCodes(checked, "/sessions/0")).toEqual([
      "session-plan-node-unresolved",
      "session-plan-node-unresolved",
      "session-plan-node-unresolved"
    ]);
    // One finding per fabricated chain: `set-1` under the unresolved `squat-sets` adds no second finding.
    expect(at(checked, "/sessions/0/executionPlan/children/0/children/0/id")).toEqual([]);
  });

  test("omitting a whole retained branch is an omission, not a fabrication", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    // Drop one whole branch of the plan: a plan is the effective tree, so what it leaves out stays legal.
    planChildNodes(plan).splice(1, 1);
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(under(result, "/sessions/0")).toEqual([]);
  });

  test("an effective-plan content change is not an identity change", () => {
    const document = clone(asRecord(frozenPlanShard));
    const finisher = planChild(planOf(document, 0), "finisher");
    // Req 6.8 and spec §5 Frozen Execution Plan: a container affected by an omission becomes detail-only in the
    // plan, and labels and prescriptions may differ, because none of that is identity.
    asRecord(finisher["resultCapture"])["childDetail"] = "required";
    finisher["name"] = "Finisher (remaining work)";
    asRecord(planChild(finisher, "squat-1")["prescription"])["reps"] = 21;
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(under(result, "/sessions/0")).toEqual([]);
  });

  test("the recorded deprecated skip stays clean while a fabricated branch in the same plan is reported", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    const invented = clone(planChild(plan, "singles"));
    invented["id"] = "invented-singles";
    planChildNodes(plan).push(invented);
    const result = check(document);
    // Session 0's recorded `skipped` / `reasonCode: "deprecated"` result names the path the plan omits and is
    // still clean; the fabrication is reported once, at the plan.
    expect(under(result, "/sessions/0/results/1")).toEqual([]);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-node-unresolved"]);
  });

  test("an unresolved workout reference disables the plan comparison instead of guessing an identity", () => {
    const document = clone(asRecord(frozenPlanShard));
    renamePlanRoot(document, 0, "copied-root");
    sessionsOf(document)[0]["workoutId"] = "workshop-gone";
    const result = check(document);
    // Nothing is available to compare the plan with, so the plan rules say nothing and RS-05 carries the fact.
    expect(at(result, "/sessions/0/workoutId")).toEqual(["session-workout-unresolved"]);
    expect(planCodes(result, "/sessions/0")).toEqual([]);
  });

  test("a terminal session keeps the no-plan rule only, so no plan rule is applied to a terminal session", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    planChildNodes(planChild(plan, "finisher")).push(firstChildCopy(planChild(plan, "squat-sets")));
    sessionsOf(document)[0]["status"] = "completed";
    sessionsOf(document)[0]["endedAtUtc"] = "2026-09-14T07:30:00Z";
    // RS-03 keeps this row with both gates: the schema rejects a terminal session's plan, and the lifecycle
    // pass reports it once. The fabricated branch is never resolved, because no plan rule runs on a terminal
    // session (TR-05).
    expect(schemaValid(document)).toBe(false);
    const result = check(document);
    expect(under(result, "/sessions/0")).toEqual(["session-plan-forbidden"]);
  });

  test("an unstructured plan node is schema shape, not a fabricated identity", () => {
    const document = clone(asRecord(frozenPlanShard));
    (planOf(document, 0)["children"] as unknown[]).push(null);
    const result = check(document);
    // `null` in a children list is reported by the schema gate; the identity walk stops and invents nothing.
    expect(schemaValid(document)).toBe(false);
    expect(planCodes(result, "/sessions/0")).toEqual([]);
  });
});

/**
 * The last two copy facts of a frozen plan (D3). A plan can carry the referenced root identifier and a node ID
 * that resolves under each of its parents and still not be the copy spec §5 Frozen Execution Plan requires: it
 * can name one child of a parent twice, and it can point a retained exercise node at another exercise. Both
 * break the copy relationship — "`executionPlan` copies the effective workout root, including node IDs, exercise
 * references, strategies, scoring rules, and prescriptions" — and neither is visible to a path check, because a
 * path that resolves inside the plan still resolves.
 *
 * Authority: docs/REQUIREMENTS.md 6.11 and 6.14-6.15; specs/rep-jot-json-schema-spec.md §5 Frozen Execution Plan
 * and Execution Path and §8 invariants 3-6; docs/contracts/user-data-contracts.md RS-05 through RS-07 and its
 * RS-07 input fact ("the terminal node's exercise reference"); docs/ARCHITECTURE.md §12 (an ID is never reused
 * or reparented, and the prior-bundle comparison fails a build that changes a node's role); specs/storage-and-
 * lookup.md §Loading policy ("An in-progress session always resumes from its frozen plan").
 *
 * What stays legal is unchanged from the block above: an omission is an omission, content fields are never
 * compared, a plan is still the resolution root, and no plan rule runs on a terminal session.
 */

/** Name one child of one plan node twice, exactly as a copy-the-same-node-twice writer would. */
function duplicatePlanChild(parent: Record<string, unknown>): void {
  planChildNodes(parent).push(firstChildCopy(parent));
}
/** Change one plan exercise node's exercise reference in place. */
function changePlanExerciseId(node: Record<string, unknown>, exerciseId: string): void {
  node["exerciseId"] = exerciseId;
}

describe("frozen-plan identity: one copy per parent and the copied exercise reference", () => {
  test("the fixture plan names each parent's child once and copies each exercise reference (positive control)", () => {
    const plan = planOf(asRecord(frozenPlanShard), 0);
    const retained = retainedRootOf(workouts, "squat-day");
    // The plan is the retained tree minus the deprecated `push-1`, and every exercise reference it kept is the
    // retained node's reference, which is why this fixture carries no plan finding at all.
    expect(childIds(planChildNodes(planChild(plan, "finisher")))).toEqual(["squat-1"]);
    expect(childIds(planChildNodes(planChild(retained, "finisher")))).toEqual(["push-1", "squat-1"]);
    expect(planChild(planChild(plan, "squat-sets"), "set-1")["exerciseId"])
      .toBe(planChild(planChild(retained, "squat-sets"), "set-1")["exerciseId"]);
    expect(planChild(planChild(plan, "squat-sets"), "raise-1")["exerciseId"])
      .toBe(planChild(planChild(retained, "squat-sets"), "raise-1")["exerciseId"]);
    expect(planCodes(check(frozenPlanShard), "/sessions/0")).toEqual([]);
  });

  test("a plan parent that names one retained child twice is not a copy of that parent", () => {
    const document = clone(asRecord(frozenPlanShard));
    // `finisher` keeps `squat-1` and gains a second copy of it. The retained finisher holds `push-1` and
    // `squat-1`, each once (invariant 23, Req 6.14), so no reading of that parent has two `squat-1`s.
    duplicatePlanChild(planChild(planOf(document, 0), "finisher"));
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-node-duplicate"]);
    expect(at(result, "/sessions/0/executionPlan/children/2/children/1/id")).toEqual(["session-plan-node-duplicate"]);
    // The first copy is the copy: only the second names a node the workout does not have.
    expect(at(result, "/sessions/0/executionPlan/children/2/children/0/id")).toEqual([]);
  });

  test("a duplicated whole branch is one finding, and nothing below the copy adds a cascade", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    planChildNodes(plan).push(clone(planChild(plan, "singles")));
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-node-duplicate"]);
    expect(at(result, "/sessions/0/executionPlan/children/3/id")).toEqual(["session-plan-node-duplicate"]);
    // `dead-1` under the copy resolves in the retained tree, so a walk that descended into the copy would call
    // this plan legal but for one finding. It does not descend: a copy proves nothing about its subtree.
    expect(at(result, "/sessions/0/executionPlan/children/3/children/0/id")).toEqual([]);
  });

  test("a duplicate is counted per parent, so a retained ID under a second parent stays fabricated ancestry", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    // `set-1` still appears exactly once, under `squat-sets`. Moving a copy to `finisher` invents a parent
    // (Req 6.15, ARCHITECTURE §12), which the ancestry code reports, not the per-parent duplicate code.
    planChildNodes(planChild(plan, "finisher")).push(firstChildCopy(planChild(plan, "squat-sets")));
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-node-unresolved"]);
  });

  test("two copies of a node the workout does not have are two unresolved nodes, never a duplicate", () => {
    const document = clone(asRecord(frozenPlanShard));
    const ghost = { id: "ghost-sets", type: "container", strategy: "sequence", strategyConfig: {}, children: [] };
    planChildNodes(planOf(document, 0)).push(clone(ghost), clone(ghost));
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    // The duplicate rule needs a retained node to duplicate; nothing is retained here, so the existing rule for
    // a node the workout does not have stands at each position.
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-node-unresolved", "session-plan-node-unresolved"]);
  });

  test("removing the duplicated copy restores the plan (recovery)", () => {
    const document = clone(asRecord(frozenPlanShard));
    const finisher = planChild(planOf(document, 0), "finisher");
    duplicatePlanChild(finisher);
    expect(planCodes(check(document), "/sessions/0")).toEqual(["session-plan-node-duplicate"]);
    planChildNodes(finisher).pop();
    expect(planCodes(check(document), "/sessions/0")).toEqual([]);
  });

  test("a plan that points a retained exercise node at another valid exercise is not that workout's plan", () => {
    const document = clone(asRecord(frozenPlanShard));
    const raise = planChild(planChild(planOf(document, 0), "squat-sets"), "raise-1");
    expect(raise["exerciseId"]).toBe("lateral-raise");
    // `deadlift` is retained, resolves, and is a legal reference for the `dead-1` node elsewhere in the same
    // workout, so no reference-resolution rule can see this: only the copied reference can (spec §5, Req 6.15).
    // No result of this session names `raise-1`, so the plan is the only signal there is.
    changePlanExerciseId(raise, "deadlift");
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-exercise-mismatch"]);
    expect(under(result, "/sessions/0/results")).toEqual([]);
  });

  test("the changed reference does not have to resolve: the reported fact is that the plan changed it", () => {
    const document = clone(asRecord(frozenPlanShard));
    changePlanExerciseId(planChild(planChild(planOf(document, 0), "squat-sets"), "raise-1"), "ghost-exercise");
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-exercise-mismatch"]);
    expect(at(result, "/sessions/0/executionPlan/children/0/children/1/exerciseId")).toEqual([
      "session-plan-exercise-mismatch"
    ]);
  });

  test("content still varies freely: only the exercise reference is compared", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    const sets = planChild(plan, "squat-sets");
    // A start-time content change of every legal kind, plus the one change that is not legal. The single finding
    // proves the two facts stay independent and that content stays unread.
    const set1 = planChild(sets, "set-1");
    asRecord(set1["prescription"])["reps"] = 3;
    delete set1["setType"];
    planChild(plan, "finisher")["name"] = "Finisher (remaining work)";
    asRecord(planChild(plan, "finisher")["resultCapture"])["childDetail"] = "required";
    expect(planCodes(check(document), "/sessions/0")).toEqual([]);
    changePlanExerciseId(set1, "deadlift");
    expect(schemaValid(document)).toBe(true);
    expect(planCodes(check(document), "/sessions/0")).toEqual(["session-plan-exercise-mismatch"]);
  });

  test("a plan exercise node that drops its exercise reference is schema shape, not a changed reference", () => {
    const document = clone(asRecord(frozenPlanShard));
    delete planChild(planChild(planOf(document, 0), "squat-sets"), "raise-1")["exerciseId"];
    // The schema requires the field, and the semantic pass compares two named references or nothing: an absent
    // reference guesses at an identity, so it reports nothing here.
    expect(schemaValid(document)).toBe(false);
    expect(planCodes(check(document), "/sessions/0")).toEqual([]);
  });

  test("omitting the exercise node is still an omission, so it earns no exercise-reference finding", () => {
    const document = clone(asRecord(frozenPlanShard));
    const sets = planChild(planOf(document, 0), "squat-sets");
    // Drop `raise-1` from the plan instead: exactly the start-time deprecation this plan already carries for
    // `push-1` (TR-02), and legal even though the retained node references an exercise the plan never names.
    planChildNodes(sets).splice(1, 1);
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual([]);
    expect(under(result, "/sessions/0/results")).toEqual([]);
  });

  test("the plan stays the resolution root: the plan node decides the direct ID, and the plan carries its own finding", () => {
    const document = clone(asRecord(frozenPlanShard));
    changePlanExerciseId(planChild(planChild(planOf(document, 0), "squat-sets"), "set-1"), "deadlift");
    const result = check(document);
    // Session 0's first result names the retained reference. Resolution never moves to the retained tree to make
    // it pass (TR-04, Req 6.11): the plan still resolves the path, still disagrees with the direct ID, and the
    // plan's own change is reported separately at the plan.
    expect(at(result, "/sessions/0/results/0/exerciseId")).toEqual(["result-exercise-mismatch"]);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-exercise-mismatch"]);

    // A result that records what the plan says stays clean, which is the same fact read from the other side.
    resultsOf(document, 0)[0]["exerciseId"] = "deadlift";
    const second = check(document);
    expect(under(second, "/sessions/0/results/0")).toEqual([]);
    expect(planCodes(second, "/sessions/0")).toEqual(["session-plan-exercise-mismatch"]);
  });

  test("both copy facts report on their own, in the deterministic order", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    duplicatePlanChild(planChild(plan, "finisher"));
    changePlanExerciseId(planChild(planChild(plan, "squat-sets"), "set-1"), "deadlift");
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-exercise-mismatch", "session-plan-node-duplicate"]);
  });

  test("the recorded deprecated skip stays clean while a parent duplicates one of its children", () => {
    const document = clone(asRecord(frozenPlanShard));
    duplicatePlanChild(planChild(planOf(document, 0), "finisher"));
    const result = check(document);
    // Session 0's `skipped` / `reasonCode: "deprecated"` record still resolves in the retained tree and nothing
    // about the plan-level copy reaches it (TR-02): one finding, at the plan.
    expect(under(result, "/sessions/0/results/1")).toEqual([]);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-node-duplicate"]);
  });

  test("an unresolved workout reference disables both copy facts instead of guessing an identity", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    duplicatePlanChild(planChild(plan, "finisher"));
    changePlanExerciseId(planChild(planChild(plan, "squat-sets"), "set-1"), "deadlift");
    sessionsOf(document)[0]["workoutId"] = "workshop-gone";
    const result = check(document);
    expect(at(result, "/sessions/0/workoutId")).toEqual(["session-workout-unresolved"]);
    expect(planCodes(result, "/sessions/0")).toEqual([]);
  });

  test("a terminal session keeps the no-plan rule only, so neither copy fact runs on it", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    duplicatePlanChild(planChild(plan, "finisher"));
    changePlanExerciseId(planChild(planChild(plan, "squat-sets"), "set-1"), "deadlift");
    // The session goes terminal while the fabricated plan stays in the bytes, so RS-03 keeps the only plan fact
    // that applies and neither copy fact runs: no plan rule is applied to a terminal session (TR-05).
    sessionsOf(document)[0]["status"] = "completed";
    sessionsOf(document)[0]["endedAtUtc"] = "2026-09-14T07:30:00Z";
    expect(schemaValid(document)).toBe(false);
    const result = check(document);
    // And the fabricated plan is ignored rather than consulted: session 0's first result names the retained
    // `back-squat`, which is what the retained tree holds, so resolution moved there.
    expect(under(result, "/sessions/0/results")).toEqual([]);
    expect(under(result, "/sessions/0")).toEqual(["session-plan-forbidden"]);
  });

  test("the two copy checks report the same way twice and never mutate the shard", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    duplicatePlanChild(planChild(plan, "finisher"));
    changePlanExerciseId(planChild(planChild(plan, "squat-sets"), "set-1"), "deadlift");
    const before = JSON.stringify(document);
    const first = check(document);
    expect(JSON.stringify(document)).toBe(before);
    expect(check(document)).toEqual(first);
  });
});

/**
 * The two shape facts of a copied node (D3). A plan can carry the referenced root identifier, resolve every
 * node ID under its own parent, name each child once, and copy each exercise reference, and still not be the
 * copy spec §5 Frozen Execution Plan requires: it can give a published node another role, and it can give a
 * published container another strategy. Req 6.3 keeps an ID from being "repurposed for a different entity or
 * node role" and Req 6.15 keeps "node type, parent, exercise reference, container strategy" unchanged, so
 * neither fact belongs to a plan, and no path check can see either one: a path that resolves inside the plan
 * still resolves, whichever role the plan gave the node and whichever strategy it repeats.
 *
 * The strategy is read by name only. The retained half of every comparison below is the *current* bundle, and TR-04
 * states that an `in_progress` session executes its frozen plan after reload or deployment and that later static
 * corrections never change it. A corrected `strategyConfig` — a fixed `rounds` count, a corrected `interval` or
 * `duration` — is one of those later corrections, and WK-17 keeps the configuration out of its own comparison, so
 * no value of `strategyConfig` is compared here: the strategy name is the fact Req 6.15 and WK-03 preserve, and
 * WK-04 bounds each configuration shape for the schema to enforce.
 *
 * Authority: docs/REQUIREMENTS.md 6.3, 6.11, 6.14-6.16; specs/rep-jot-json-schema-spec.md §5 Frozen Execution
 * Plan ("including node IDs, exercise references, strategies") and §8 invariant 5; docs/contracts/
 * user-data-contracts.md RS-06 and its RS-06 input fact; docs/contracts/temporal-and-omission-contracts.md TR-04
 * ("later static corrections and deprecations never change it"); docs/contracts/static-data-contracts.md WK-03 and
 * WK-17 ("parent, type, exercise ref, strategy, capture, units"), WK-04 (per-strategy `strategyConfig` shapes);
 * docs/ARCHITECTURE.md §12 (the compatibility stage fails "role changes" and "scoring-contract changes") and §17
 * ("parent/type/strategy/contract changes").
 *
 * What stays legal is unchanged: an omission is an omission, a label, instruction, note, prescription, or the
 * TR-02 `childDetail` change is never compared, a retained `strategyConfig` correction of a later bundle is never
 * compared, the scoring contract is not read here (RS-12, RS-13, and the score service own it), the plan is still
 * the resolution root, and no plan rule runs on a terminal session.
 */

/** Rewrite one plan node as an exercise node of the same ID: the role change Req 6.3 forbids. */
function planNodeToExercise(node: Record<string, unknown>, exerciseId: string): void {
  node["type"] = "exercise";
  node["exerciseId"] = exerciseId;
  node["stimulus"] = "conditioning";
  node["prescription"] = { reps: 10 };
  delete node["name"];
  delete node["strategy"];
  delete node["strategyConfig"];
  delete node["resultCapture"];
  delete node["children"];
}
/** Rewrite one plan node as a sequence container of the same ID: the same change in the other direction. */
function planNodeToContainer(node: Record<string, unknown>): void {
  node["type"] = "container";
  node["strategy"] = "sequence";
  node["strategyConfig"] = {};
  node["children"] = [];
  delete node["name"];
  delete node["exerciseId"];
  delete node["stimulus"];
  delete node["setType"];
  delete node["prescription"];
}
/** Give one plan container another strategy, its own configuration included (WK-04 pairs the two fields). */
function changePlanStrategy(
  node: Record<string, unknown>,
  strategy: string,
  strategyConfig: Record<string, unknown>
): void {
  node["strategy"] = strategy;
  node["strategyConfig"] = strategyConfig;
  if (strategy !== "amrap" && strategy !== "emom" && strategy !== "complex") {
    delete node["resultCapture"]; // WK-05: only a scored strategy carries a score capture
  }
}
/** Replace one plan container's strategy configuration, keeping its strategy name. */
function changePlanStrategyConfig(node: Record<string, unknown>, strategyConfig: unknown): void {
  node["strategyConfig"] = strategyConfig;
}
/** Replace one plan node in its own parent, which is how the recovery cases below put a copy back. */
function replacePlanChild(parent: Record<string, unknown>, nodeId: string, node: Record<string, unknown>): void {
  const nodes = planChildNodes(parent);
  for (let i = 0; i < nodes.length; i += 1) {
    if (nodes[i]["id"] === nodeId) {
      nodes[i] = node;
      return;
    }
  }
  throw new Error("the plan parent holds no child: " + nodeId);
}

describe("frozen-plan identity: the copied node role and the copied container strategy", () => {
  test("the fixture plan copies each node role and each container strategy (positive control)", () => {
    const plan = planOf(asRecord(frozenPlanShard), 0);
    const retained = retainedRootOf(workouts, "squat-day");
    // The plan is the retained tree minus the deprecated `push-1`, and each node it kept is still the same kind
    // of node running the same strategy the referenced workout runs, which is why this fixture is clean.
    expect(planChild(plan, "finisher")["type"]).toBe(planChild(retained, "finisher")["type"]);
    expect(planChild(plan, "finisher")["strategy"]).toBe(planChild(retained, "finisher")["strategy"]);
    expect(planChild(plan, "squat-sets")["strategy"]).toBe(planChild(retained, "squat-sets")["strategy"]);
    expect(planCodes(check(frozenPlanShard), "/sessions/0")).toEqual([]);
  });

  test("a retained container the plan rewrote as an exercise node is a repurposed node, not an omission", () => {
    const document = clone(asRecord(frozenPlanShard));
    // The AMRAP finisher becomes one exercise. Nothing about the ID, the parent, or the exercise reference is
    // wrong, and the plan still resolves every path it carries, so Req 6.3 is the only rule that can see it.
    planNodeToExercise(planChild(planOf(document, 0), "finisher"), "air-squat");
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-node-role-mismatch"]);
    expect(at(result, "/sessions/0/executionPlan/children/2/type")).toEqual(["session-plan-node-role-mismatch"]);
    // The role, not the identifier, is the finding: the plan keeps the published `finisher` ID in its place.
    expect(at(result, "/sessions/0/executionPlan/children/2/id")).toEqual([]);
  });

  test("a retained exercise node the plan rewrote as a container is the same defect in the other direction", () => {
    const document = clone(asRecord(frozenPlanShard));
    const raise = planChild(planChild(planOf(document, 0), "squat-sets"), "raise-1");
    expect(raise["type"]).toBe("exercise");
    planNodeToContainer(raise);
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-node-role-mismatch"]);
    expect(at(result, "/sessions/0/executionPlan/children/0/children/1/type")).toEqual([
      "session-plan-node-role-mismatch"
    ]);
  });

  test("a repurposed node is one finding, and its own children add no cascade", () => {
    const document = clone(asRecord(frozenPlanShard));
    const sets = planChild(planOf(document, 0), "squat-sets");
    const set1 = planChild(sets, "set-1");
    planNodeToContainer(set1);
    // A legal child the retained `set-1` cannot have: were the walk to descend into a node of another role, it
    // would find `dead-1` missing below it and report a fabrication the writer never made.
    planChildNodes(set1).push(clone(planChild(planChild(planOf(document, 0), "singles"), "dead-1")));
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-node-role-mismatch"]);
    expect(at(result, "/sessions/0/executionPlan/children/0/children/0/children/0/id")).toEqual([]);
  });

  test("restoring the copied role clears the session (recovery)", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    const copy = clone(planChild(plan, "finisher"));
    planNodeToExercise(planChild(plan, "finisher"), "air-squat");
    expect(planCodes(check(document), "/sessions/0")).toEqual(["session-plan-node-role-mismatch"]);
    // Putting the copy back — the retained node's own role and strategy, at the same position — is enough.
    replacePlanChild(plan, "finisher", copy);
    expect(under(check(document), "/sessions/0")).toEqual([]);
  });

  test("a retained container whose strategy the plan changed is not the strategy the session started with", () => {
    const document = clone(asRecord(frozenPlanShard));
    // The finisher keeps its ID, its parent, its score capture, and its child, and stops repeating on time:
    // Req 6.15 keeps "container strategy" out of what a plan may change.
    changePlanStrategy(planChild(planOf(document, 0), "finisher"), "sequence", {});
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-strategy-mismatch"]);
    expect(at(result, "/sessions/0/executionPlan/children/2/strategy")).toEqual(["session-plan-strategy-mismatch"]);
    // Only the strategy is unproven, so the walk keeps descending: `squat-1` still resolves and reports nothing.
    expect(at(result, "/sessions/0/executionPlan/children/2/children/0/id")).toEqual([]);
  });

  test("one changed strategy is one finding, even when its configuration changed with it", () => {
    const document = clone(asRecord(frozenPlanShard));
    // A rounds container has no configuration the AMRAP's matches, so both fields differ at once. The strategy
    // name is the first fact, and the configuration of a strategy neither side names is not a second one.
    changePlanStrategy(planChild(planOf(document, 0), "finisher"), "rounds", { rounds: 3 });
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-strategy-mismatch"]);
    expect(at(result, "/sessions/0/executionPlan/children/2/strategyConfig")).toEqual([]);
  });

  test("a plan that keeps the configuration it froze reports nothing (TR-04)", () => {
    const document = clone(asRecord(frozenPlanShard));
    const sets = planChild(planOf(document, 0), "squat-sets");
    // The retained bundle runs two rounds and this plan runs three, which is the state a session is in the day
    // after the bundle's count is corrected. The plan is not compared with that value, so it stays valid.
    expect(asRecord(sets["strategyConfig"])["rounds"]).toBe(2);
    changePlanStrategyConfig(sets, { rounds: 3 });
    // WK-04 keeps `rounds >= 1`, so the shape the schema enforces is satisfied and no value is read here.
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual([]);
    expect(under(result, "/sessions/0/results")).toEqual([]);
  });

  test("a later retained strategy-configuration correction keeps every active plan valid (TR-04, Req 6.11)", () => {
    // One deployment corrects two container configurations and nothing else: `squat-day` runs three `squat-sets`
    // rounds instead of two, and its AMRAP runs 22 minutes instead of 20. Every published node keeps its ID, its
    // role, its parent, its strategy name, and its scoring contract (Req 6.15, WK-03, WK-17), so the bundle is a
    // legal later bundle and each active session keeps executing the configuration it froze (TR-04).
    const corrected = clone(asRecord(workouts));
    const retained = retainedRootOf(corrected, "squat-day");
    asRecord(planChild(retained, "squat-sets")["strategyConfig"])["rounds"] = 3;
    asRecord(asRecord(planChild(retained, "finisher")["strategyConfig"])["duration"])["value"] = 22;
    // The two sides really disagree: the current bundle holds the corrected values and each fixture plan holds its
    // own frozen ones, which is what makes this a TR-04 case rather than a case that compares equal.
    expect(asRecord(planChild(retainedRootOf(corrected, "squat-day"), "squat-sets")["strategyConfig"])["rounds"]).toBe(
      3
    );
    expect(asRecord(planChild(planOf(asRecord(frozenPlanShard), 0), "squat-sets")["strategyConfig"])["rounds"]).toBe(2);

    const before = validateResultsShard(frozenPlanShard, workouts, exercises, CONTEXT_NAME);
    const after = validateResultsShard(frozenPlanShard, corrected, exercises, CONTEXT_NAME);
    // The correction adds no finding of any kind, and no plan reports anything about its own shape.
    expect(codes(after)).toEqual(codes(before));
    expect(planCodes(after, "/sessions/0")).toEqual([]);
    expect(under(after, "/sessions/0")).toEqual([]);
  });

  test("one configuration shape is schema shape: WK-04 owns it and this pass reads no value", () => {
    const document = clone(asRecord(contextShard));
    const blocks = planChild(planOf(document, 1), "blocks");
    // The EMOM's two members may arrive in either order and are still `cycles: 2` with a one-minute interval, and a
    // member the strategy does not use is the schema's own rejection (WK-04). Neither half is a lifecycle fact,
    // because no value of a copied configuration is read here — only the strategy name is.
    changePlanStrategyConfig(blocks, { interval: { value: 1, unit: "minute" }, cycles: 2 });
    expect(schemaValid(document)).toBe(true);
    expect(check(document).valid).toBe(true);
    // The schema gate owns the added member, and the lifecycle pass still reports nothing at the plan.
    changePlanStrategyConfig(blocks, { cycles: 2, interval: { value: 1, unit: "minute" }, rounds: 1 });
    expect(schemaValid(document)).toBe(false);
    expect(planCodes(check(document), "/sessions/1")).toEqual([]);
  });

  test("the plan stays the resolution root: the changed strategy decides the path, and the plan reports its own fact", () => {
    const document = clone(asRecord(frozenPlanShard));
    // The retained `squat-sets` repeats and the plan's does not. Session 0's first result carries an iteration
    // for that segment, and resolution reads the plan (TR-04, Req 6.11), so the path fails while the retained
    // tree would have passed it. Resolution never moves to the retained tree to make the plan's finding go away.
    changePlanStrategy(planChild(planOf(document, 0), "squat-sets"), "sequence", {});
    const result = check(document);
    expect(at(result, "/sessions/0/results/0/executionPath/1/iteration")).toEqual([
      "result-path-iteration-forbidden"
    ]);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-strategy-mismatch"]);
  });

  test("a role change leaves the recorded deprecated skip clean, because the omission rule is unchanged", () => {
    const document = clone(asRecord(frozenPlanShard));
    planNodeToExercise(planChild(planOf(document, 0), "finisher"), "air-squat");
    const result = check(document);
    // Session 0's second result names `finisher`/`push-1`, a path the plan no longer holds at all, and is the
    // one record class the retained tree may still resolve (TR-02). The plan keeps its own single finding.
    expect(under(result, "/sessions/0/results/1")).toEqual([]);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-node-role-mismatch"]);
  });

  test("an omitted container's role and strategy are never compared, because an omission is an omission", () => {
    const document = clone(asRecord(frozenPlanShard));
    // Drop the whole `singles` branch, and drop the plan's own `push-1` child all over again: what a plan leaves
    // out is the effective plan, and neither new fact runs on a node the plan does not carry.
    planChildNodes(planOf(document, 0)).splice(1, 1);
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual([]);
    expect(under(result, "/sessions/0/results")).toEqual([]);
  });

  test("content and the TR-02 detail-only change stay free beside the two shape facts", () => {
    const document = clone(asRecord(frozenPlanShard));
    const finisher = planChild(planOf(document, 0), "finisher");
    // Every change Req 6.16 and TR-02 leave open, on the two containers the shape facts also read.
    finisher["name"] = "Finisher (remaining work)";
    asRecord(finisher["resultCapture"])["childDetail"] = "required";
    asRecord(planChild(finisher, "squat-1")["prescription"])["reps"] = 21;
    // A count the plan froze and a count the current bundle holds are two values, and neither is a shape fact.
    asRecord(planChild(planOf(document, 0), "squat-sets")["strategyConfig"])["rounds"] = 5;
    expect(schemaValid(document)).toBe(true);
    expect(planCodes(check(document), "/sessions/0")).toEqual([]);
    // And the scoring contract is not read here either: a plan that changes `scoreType` is RS-12's and the score
    // service's, not this row's, so no lifecycle fact appears for it.
    asRecord(finisher["resultCapture"])["scoreType"] = "cycles";
    expect(planCodes(check(document), "/sessions/0")).toEqual([]);
  });

  test("a node the workout does not have keeps the fabrication code, so the role rule reads only copies", () => {
    const document = clone(asRecord(frozenPlanShard));
    const invented = clone(planChild(planOf(document, 0), "singles"));
    invented["id"] = "invented-singles";
    planChildNodes(planOf(document, 0)).push(invented);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-node-unresolved"]);
  });

  test("an unreadable role or strategy is schema shape, reported by the schema and never guessed here", () => {
    const document = clone(asRecord(frozenPlanShard));
    const finisher = planChild(planOf(document, 0), "finisher");
    delete finisher["type"];
    expect(schemaValid(document)).toBe(false);
    expect(planCodes(check(document), "/sessions/0")).toEqual([]);
    // The same reading for the strategy: one side names none, so no strategy is assumed and none is refused.
    const second = clone(asRecord(frozenPlanShard));
    delete planChild(planOf(second, 0), "finisher")["strategy"];
    expect(schemaValid(second)).toBe(false);
    expect(planCodes(check(second), "/sessions/0")).toEqual([]);
  });

  test("the plan root is a copied node too, so its strategy is compared as well", () => {
    const document = clone(asRecord(frozenPlanShard));
    // The root keeps the referenced root's identifier, which is the only fact the root check compares, so the
    // plan *is* that root by identity while repeating in a way the referenced root does not.
    changePlanStrategy(planOf(document, 0), "rounds", { rounds: 2 });
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(planCodes(result, "/sessions/0")).toEqual(["session-plan-strategy-mismatch"]);
    expect(at(result, "/sessions/0/executionPlan/strategy")).toEqual(["session-plan-strategy-mismatch"]);
  });

  test("an unresolved workout reference disables both shape facts instead of guessing an identity", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    planNodeToExercise(planChild(plan, "finisher"), "air-squat");
    changePlanStrategy(planChild(plan, "squat-sets"), "sequence", {});
    sessionsOf(document)[0]["workoutId"] = "workshop-gone";
    const result = check(document);
    expect(at(result, "/sessions/0/workoutId")).toEqual(["session-workout-unresolved"]);
    expect(planCodes(result, "/sessions/0")).toEqual([]);
  });

  test("a terminal session keeps the no-plan rule only, so neither shape fact runs on it", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    planNodeToExercise(planChild(plan, "finisher"), "air-squat");
    changePlanStrategy(planChild(plan, "squat-sets"), "sequence", {});
    sessionsOf(document)[0]["status"] = "completed";
    sessionsOf(document)[0]["endedAtUtc"] = "2026-09-14T07:30:00Z";
    // The fabricated plan stays in the bytes while the session goes terminal, so RS-03 keeps the only plan fact
    // that applies (TR-05) and resolution moves to the retained tree, where session 0's first result is clean.
    expect(schemaValid(document)).toBe(false);
    const result = check(document);
    expect(under(result, "/sessions/0/results/0")).toEqual([]);
    expect(under(result, "/sessions/0")).toEqual(["session-plan-forbidden"]);
  });

  test("both shape facts report on their own, in the deterministic order, and never mutate the shard", () => {
    const document = clone(asRecord(frozenPlanShard));
    const plan = planOf(document, 0);
    planNodeToExercise(planChild(plan, "singles"), "deadlift");
    // Two different facts on two different nodes: the AMRAP keeps its ID, its parent, its children, and its own
    // frozen configuration, and stops being timed.
    changePlanStrategy(planChild(plan, "finisher"), "rounds", { rounds: 3 });
    expect(schemaValid(document)).toBe(true);
    const first = check(document);
    expect(planCodes(first, "/sessions/0")).toEqual([
      "session-plan-node-role-mismatch",
      "session-plan-strategy-mismatch"
    ]);
    expect(at(first, "/sessions/0/executionPlan/children/1/type")).toEqual(["session-plan-node-role-mismatch"]);
    expect(at(first, "/sessions/0/executionPlan/children/2/strategy")).toEqual(["session-plan-strategy-mismatch"]);
    const before = JSON.stringify(document);
    expect(check(document)).toEqual(first);
    expect(JSON.stringify(document)).toBe(before);
  });
});

describe("RS-08: measured values (invariants 7-8)", () => {
  test("a dimension the referenced exercise does not list fails at the value pointer", () => {
    expect(schemaValid(invalidValues)).toBe(true);
    const result = check(invalidValues);
    expect(at(result, "/sessions/0/results/1/values/distance")).toContain("result-value-dimension-unsupported");
    expect(at(result, "/sessions/1/results/0/values/reps")).toContain("result-value-dimension-unsupported");
  });

  test("a unit outside the exercise's compatible units fails at the unit pointer", () => {
    const result = check(invalidValues);
    expect(at(result, "/sessions/0/results/0/values/weight/unit")).toContain("result-value-unit-incompatible");
  });

  test("compatible units and supported dimensions stay clean", () => {
    const result = check(invalidValues);
    expect(at(result, "/sessions/0/results/2/values/weight/unit")).toEqual([]);
    expect(at(result, "/sessions/1/results/1/values/distance")).toEqual([]);
  });

  test("a zero-repetition attempt is measured data, and a skip carries no values (Req 11.2, 11.4)", () => {
    const document = asRecord(contextShard);
    const attempt = resultsOf(document, 0)[1];
    expect(asRecord(attempt["values"])["reps"]).toBe(0);
    expect(attempt["reasonCode"]).toBe("unsuccessful_attempt");
    expect(resultsOf(document, 0)[4]["values"]).toBe(undefined);
    expect(check(contextShard).valid).toBe(true);
  });
});

describe("RS-09: sides (invariant 15)", () => {
  test("the three controlled conditional failures each report at their pointer", () => {
    const result = check(invalidFields);
    expect(at(result, "/sessions/0/results/0/side")).toContain("result-side-invalid");
    expect(at(result, "/sessions/0/results/1/startingSide")).toContain("result-starting-side-forbidden");
    expect(at(result, "/sessions/0/results/2/startingSide")).toContain("result-starting-side-required");
    expect(at(result, "/sessions/0/results/3/startingSide")).toContain("result-starting-side-forbidden");
  });

  test("the schema gate stays the primary owner of the same row", () => {
    expect(schema.validate("results", 1, invalidFields).valid).toBe(false);
  });

  test("alternating with a starting side, and `both` without one, stay valid (Req 11.5-11.7)", () => {
    const document = asRecord(contextShard);
    const alternating = resultsOf(document, 0)[2];
    expect(alternating["side"]).toBe("alternating");
    expect(alternating["startingSide"]).toBe("left");
    expect(resultsOf(document, 0)[3]["side"]).toBe("both");
    expect(resultsOf(document, 0)[3]["startingSide"]).toBe(undefined);
    expect(check(contextShard).valid).toBe(true);
  });
});

describe("RS-09 / Req 11.5-11.7: a unilateral result names the side it measured", () => {
  // Req 11.5 requires a unilateral result to identify `left`, `right`, `both`, or `alternating`, and Req 11.6
  // gives each side its own meaning, so the side is part of the measurement. The referenced exercise decides
  // whether a measured result may omit it, and the schema never reads the exercise directory: every schema
  // assertion below proves the lifecycle pass is the only signal for that half of the row.
  test("each of the four controlled sides satisfies the requirement", () => {
    const sides: Array<[string, string | null]> = [
      ["left", null],
      ["right", null],
      ["both", null],
      ["alternating", "right"]
    ];
    for (const [side, startingSide] of sides) {
      const document = clone(asRecord(contextShard));
      const result = resultsOf(document, 0)[2];
      result["side"] = side;
      if (startingSide === null) {
        delete result["startingSide"];
      } else {
        result["startingSide"] = startingSide;
      }
      expect(schemaValid(document)).toBe(true);
      expect(under(check(document), "/sessions/0/results/2")).toEqual([]);
    }
  });

  test("a bilateral exercise records measured work with no side at all (Req 11.5 normal case)", () => {
    const document = asRecord(contextShard);
    expect(resultsOf(document, 0)[0]["side"]).toBe(undefined);
    expect(resultsOf(document, 0)[1]["side"]).toBe(undefined);
    expect(under(check(document), "/sessions/0/results/0")).toEqual([]);
    expect(at(check(document), "/sessions/0/results/1/side")).toEqual([]);
  });

  test("a measured unilateral result with no side fails at the side pointer with the schema silent", () => {
    const document = clone(asRecord(contextShard));
    const result = resultsOf(document, 0)[2];
    delete result["side"];
    delete result["startingSide"];
    expect(schemaValid(document)).toBe(true); // `side` is optional to the schema, which knows no laterality
    const outcome = check(document);
    expect(at(outcome, "/sessions/0/results/2/side")).toEqual(["result-unilateral-side-required"]);
    expect(under(outcome, "/sessions/0/results/2")).toEqual(["result-unilateral-side-required"]);
  });

  test("a zero-repetition unilateral attempt is measured data and still names its side (Req 11.2)", () => {
    const document = clone(asRecord(contextShard));
    const result = resultsOf(document, 0)[2];
    delete result["side"];
    delete result["startingSide"];
    result["values"] = { reps: 0 };
    expect(under(check(document), "/sessions/0/results/2")).toEqual(["result-unilateral-side-required"]);

    // The same zero on a bilateral exercise needs no side, so the report follows the referenced exercise.
    const bilateral = clone(asRecord(contextShard));
    resultsOf(bilateral, 0)[0]["values"] = { reps: 0 };
    expect(check(bilateral).valid).toBe(true);
  });

  test("a skipped unilateral result stores no values and asks for no side (Req 11.2, 11.4)", () => {
    const document = clone(asRecord(contextShard));
    const result = resultsOf(document, 0)[2];
    delete result["side"];
    delete result["startingSide"];
    delete result["values"];
    result["status"] = "skipped";
    result["reasonCode"] = "user_skipped";
    expect(schemaValid(document)).toBe(true);
    expect(check(document).valid).toBe(true);
  });

  test("a unilateral result that measures nothing records no actual and needs no side", () => {
    // The requirement follows Req 11.5's own words, "when unilateral actuals are recorded": a record that
    // holds no `values` holds no actual, so this pass asks nothing of it. Whether such a record should exist
    // at all is a value rule (RS-08) and the UI's, not this row's.
    const document = clone(asRecord(contextShard));
    const result = resultsOf(document, 0)[2];
    delete result["side"];
    delete result["startingSide"];
    delete result["values"];
    expect(schemaValid(document)).toBe(true);
    expect(under(check(document), "/sessions/0/results/2")).toEqual([]);
  });

  test("an uncontrolled side value reports once, never also as a missing side", () => {
    const document = clone(asRecord(contextShard));
    const result = resultsOf(document, 0)[2];
    delete result["startingSide"];
    result["side"] = "sideways";
    expect(under(check(document), "/sessions/0/results/2")).toEqual(["result-side-invalid"]);
  });

  test("a starting side is not a side, so one record reports both halves at their own pointers", () => {
    const outcome = check(invalidFields);
    expect(at(outcome, "/sessions/0/results/3/side")).toEqual(["result-unilateral-side-required"]);
    expect(at(outcome, "/sessions/0/results/3/startingSide")).toEqual(["result-starting-side-forbidden"]);
    expect(under(outcome, "/sessions/0/results/3").length).toBe(2);
  });

  test("the requirement reads the retained exercise's laterality and guesses nothing", () => {
    const document = clone(asRecord(contextShard));
    const result = resultsOf(document, 0)[2];
    delete result["side"];
    delete result["startingSide"];

    // The same record against a directory that states the exercise is bilateral requires no side.
    const bilateral = clone(asRecord(exercises));
    exerciseEntryOf(bilateral, "lateral-raise")["laterality"] = "bilateral";
    expect(checkWithExercises(document, bilateral).valid).toBe(true);

    // A directory entry that names no controlled laterality states no fact, so it requires nothing either.
    const unstated = clone(asRecord(exercises));
    delete exerciseEntryOf(unstated, "lateral-raise")["laterality"];
    expect(checkWithExercises(document, unstated).valid).toBe(true);

    // And the fact the entry does state is the one the pass reads.
    const outcome = checkWithExercises(document, exercises);
    expect(at(outcome, "/sessions/0/results/2/side")).toEqual(["result-unilateral-side-required"]);
  });

  test("a unilateral result inside an active session resolves and reports in its frozen plan", () => {
    // The side requirement reads the exercise through the node the session's own lifecycle selected, so the
    // retained tree that resolves a recorded omission never supplies a laterality for it.
    const document = clone(asRecord(frozenPlanShard));
    const session = sessionsOf(document)[0];
    const plan = asRecord(session["executionPlan"]);
    const squatSets = asRecord((plan["children"] as Record<string, unknown>[])[0]);
    const raise = asRecord((squatSets["children"] as Record<string, unknown>[])[1]);
    expect(raise["exerciseId"]).toBe("lateral-raise");
    const results = session["results"] as Record<string, unknown>[];
    results.push({
      type: "exercise",
      workoutId: "squat-day",
      executionPath: [{ nodeId: "root" }, { nodeId: "squat-sets", iteration: 1 }, { nodeId: "raise-1" }],
      exerciseId: "lateral-raise",
      status: "completed",
      values: { reps: 12 }
    });
    const outcome = validateResultsShard(document, workouts, exercises, CONTEXT_NAME);
    expect(at(outcome, "/sessions/0/results/2/side")).toEqual(["result-unilateral-side-required"]);
    expect(under(outcome, "/sessions/0/results/2")).toEqual(["result-unilateral-side-required"]);
  });
});

describe("RS-10: result uniqueness (invariant 14)", () => {
  test("a repeated workout, path, side, and attempt tuple fails at the second result", () => {
    expect(schemaValid(invalidDuplicates)).toBe(true);
    const result = check(invalidDuplicates);
    expect(result.diagnostics.length).toBe(2);
    expect(at(result, "/sessions/0/results/1")).toContain("result-identity-duplicate");
    expect(at(result, "/sessions/1/results/1")).toContain("result-identity-duplicate");
  });

  test("a different attempt or a different side is a different tuple", () => {
    const result = check(invalidDuplicates);
    expect(at(result, "/sessions/0/results/2")).toEqual([]);
    expect(at(result, "/sessions/0/results/3")).toEqual([]);
  });

  test("a non-one-based attempt fails at its pointer; absence defaults to 1", () => {
    const result = check(invalidFields);
    expect(at(result, "/sessions/0/results/8/attempt")).toContain("result-attempt-invalid");
    // Results 0 and 1 of the duplicates fixture collide only because an absent attempt means 1.
    expect(at(result, "/sessions/0/results/8/executionPath")).toEqual([]);
  });
});

describe("RS-11: controlled reason codes", () => {
  test("a free-text reason fails at its pointer", () => {
    const result = check(invalidFields);
    expect(at(result, "/sessions/0/results/4/reasonCode")).toContain("result-reason-code-invalid");
  });

  test("all eight controlled codes are accepted on an exercise result", () => {
    const controlled = [
      "deprecated",
      "user_skipped",
      "not_completed",
      "equipment_unavailable",
      "physical_limitation",
      "time_constraint",
      "unsuccessful_attempt",
      "other"
    ];
    for (let i = 0; i < controlled.length; i += 1) {
      const document = clone(asRecord(contextShard));
      const result = resultsOf(document, 0)[0];
      result["reasonCode"] = controlled[i];
      const outcome = check(document);
      expect(codes(outcome).indexOf("result-reason-code-invalid")).toBe(-1);
      expect(outcome.valid).toBe(true);
    }
  });
});

describe("RS-11 / Save and Omission Rules: a stored state carries its evidence", () => {
  // spec §5: "The application stores `incomplete` only when partial values, timing, a reason code, or notes
  // are relevant", and the same section forbids the file full of inferred state that this row exists to stop.
  // Any one of the four facts is enough; none of them at all is a state the application inferred.
  const INCOMPLETE = "/sessions/0/results/1";
  const CONTAINER = "/sessions/0/results/6";

  test("the context fixture stores each incomplete result with its reason (positive control)", () => {
    const document = asRecord(contextShard);
    expect(resultsOf(document, 0)[1]["status"]).toBe("incomplete");
    expect(resultsOf(document, 0)[1]["reasonCode"]).toBe("unsuccessful_attempt");
    expect(resultsOf(document, 0)[6]["status"]).toBe("incomplete");
    expect(resultsOf(document, 0)[6]["reasonCode"]).toBe("time_constraint");
    expect(check(document).valid).toBe(true);
  });

  test("any one relevant fact alone keeps an incomplete result", () => {
    const facts: Array<[string, unknown]> = [
      ["values", { reps: 3 }],
      ["startedAtUtc", "2026-09-04T10:20:00Z"],
      ["endedAtUtc", "2026-09-04T10:21:00Z"],
      ["reasonCode", "time_constraint"],
      ["notes", "Stopped at the last clean repetition."]
    ];
    for (const [field, value] of facts) {
      const document = clone(asRecord(contextShard));
      const result = resultsOf(document, 0)[1];
      stripResultEvidence(result);
      result[field] = value;
      expect(schemaValid(document)).toBe(true);
      expect(under(check(document), INCOMPLETE)).toEqual([]);
    }
  });

  test("an incomplete result with none of the four stores a state and no evidence", () => {
    const document = clone(asRecord(contextShard));
    stripResultEvidence(resultsOf(document, 0)[1]);
    expect(schemaValid(document)).toBe(true); // the schema asks an incomplete result for no field
    const outcome = check(document);
    expect(at(outcome, INCOMPLETE + "/status")).toEqual(["result-incomplete-without-evidence"]);
    expect(under(outcome, INCOMPLETE)).toEqual(["result-incomplete-without-evidence"]);
  });

  test("a placeholder field is not a relevant fact", () => {
    // `notes` is any string to the schema, so only the lifecycle pass can read relevance out of "".
    const blankNotes = clone(asRecord(contextShard));
    stripResultEvidence(resultsOf(blankNotes, 0)[1]);
    resultsOf(blankNotes, 0)[1]["notes"] = "";
    expect(schemaValid(blankNotes)).toBe(true);
    expect(at(check(blankNotes), INCOMPLETE + "/status")).toEqual(["result-incomplete-without-evidence"]);

    // An empty `values` object measures nothing, and the schema states the same rule for its own reason.
    const emptyValues = clone(asRecord(contextShard));
    stripResultEvidence(resultsOf(emptyValues, 0)[1]);
    resultsOf(emptyValues, 0)[1]["values"] = {};
    expect(schemaValid(emptyValues)).toBe(false);
    expect(at(check(emptyValues), INCOMPLETE + "/status")).toEqual(["result-incomplete-without-evidence"]);
  });

  test("an uncontrolled reason code still counts as the reason the state carries", () => {
    const document = clone(asRecord(contextShard));
    stripResultEvidence(resultsOf(document, 0)[1]);
    resultsOf(document, 0)[1]["reasonCode"] = "because_i_said_so";
    const outcome = check(document);
    // One finding for the free text, and never a second one claiming the state holds nothing.
    expect(under(outcome, INCOMPLETE)).toEqual(["result-reason-code-invalid"]);
  });

  test("a container result stores its partial score or reports, and its score stays unread (RS-12)", () => {
    const bare = clone(asRecord(contextShard));
    stripResultEvidence(resultsOf(bare, 0)[6]);
    expect(schemaValid(bare)).toBe(true);
    expect(at(check(bare), CONTAINER + "/status")).toEqual(["result-incomplete-without-evidence"]);

    const partial = clone(asRecord(contextShard));
    stripResultEvidence(resultsOf(partial, 0)[6]);
    resultsOf(partial, 0)[6]["score"] = { type: "rounds_and_reps", completedRounds: 3, additionalReps: 0 };
    // Phase 6 now validates the aggregate. This existing fixture also carries a recorded deprecated skip,
    // so a standard aggregate is forbidden by TR-12 even though the incomplete-state rule itself is satisfied.
    expect(under(check(partial), CONTAINER)).toEqual(["deprecated-omission-aggregate-forbidden"]);
  });

  test("completed and skipped states are outside this rule", () => {
    // A recorded skip needs no evidence beyond its status (RS-08 keeps `values` off it), and a completed
    // result that records nothing is a value rule, not a stored-state rule.
    const skipped = clone(asRecord(contextShard));
    stripResultEvidence(resultsOf(skipped, 0)[4]);
    expect(resultsOf(skipped, 0)[4]["status"]).toBe("skipped");
    expect(check(skipped).valid).toBe(true);

    const completed = clone(asRecord(contextShard));
    stripResultEvidence(resultsOf(completed, 0)[5]);
    expect(resultsOf(completed, 0)[5]["status"]).toBe("completed");
    expect(check(completed).valid).toBe(true);
  });
});

describe("RS-18 / WK-12: effort outcomes", () => {
  test("a malformed effort outcome fails at the outcome pointer", () => {
    const result = check(invalidFields);
    expect(at(result, "/sessions/0/results/5/effort")).toContain("result-effort-invalid");
    expect(at(result, "/sessions/0/results/6/effort")).toContain("result-effort-invalid");
  });

  test("effort recorded inside `values` is reported as a measurement-dimension violation", () => {
    const result = check(invalidFields);
    expect(at(result, "/sessions/0/results/7/values/effort")).toContain("result-values-contain-effort");
    // The dimension loop skips the effort key, so one fact yields exactly one diagnostic.
    expect(codes(result).indexOf("result-value-dimension-unsupported")).toBe(-1);
  });

  test("the three controlled outcome shapes stay clean", () => {
    for (const effort of [{ type: "rpe", value: 8 }, { type: "rir", value: 0 }, { type: "failure", achieved: false }]) {
      const document = clone(asRecord(contextShard));
      resultsOf(document, 0)[0]["effort"] = effort;
      expect(check(document).valid).toBe(true);
    }
  });
});

describe("current-document identity uniqueness (Req 11.14, Req 11.22, Arch §12)", () => {
  test("a second live session with an earlier session's ID fails at its own ID pointer", () => {
    const document = clone(asRecord(contextShard));
    sessionsOf(document)[1]["id"] = sessionsOf(document)[0]["id"];
    // The results schema states no cross-session identity rule, so the shard stays schema-valid and the
    // lifecycle diagnostic is the only signal.
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(codes(result)).toEqual(["session-id-duplicate"]);
    expect(at(result, "/sessions/1/id")).toEqual(["session-id-duplicate"]);
    // The first holder keeps the identity, and no other session is drawn into the finding.
    expect(at(result, "/sessions/0/id")).toEqual([]);
    expect(under(result, "/sessions/2")).toEqual([]);
    expect(under(result, "/sessionTombstones")).toEqual([]);
  });

  test("every holder after the first fails, and nothing is dropped or rewritten", () => {
    const document = clone(asRecord(contextShard));
    const first = sessionsOf(document)[0]["id"];
    sessionsOf(document)[1]["id"] = first;
    sessionsOf(document)[3]["id"] = first;
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(at(result, "/sessions/0/id")).toEqual([]);
    expect(at(result, "/sessions/1/id")).toEqual(["session-id-duplicate"]);
    expect(at(result, "/sessions/3/id")).toEqual(["session-id-duplicate"]);
    expect(codes(result).filter((code) => code === "session-id-duplicate")).toHaveLength(2);
    // Session 2 keeps its own ID and its clean sync-copy link: the rule reads the ID alone, and picking a
    // winner among the three holders is merge behavior (invariant 21, Phase 37), never done here.
    expect(at(result, "/sessions/2/conflictOfSessionId")).toEqual([]);
    expect(sessionsOf(document)).toHaveLength(5);
  });

  test("identity is the persisted string, so two case-variant UUIDs are two IDs", () => {
    // The schema `sessionId` pattern accepts both hex cases. Folding case before comparing would reject a
    // shard that holds two different IDs, so the comparison stays exact.
    const document = clone(asRecord(contextShard));
    const id = String(sessionsOf(document)[1]["id"]);
    const variant = id.slice(0, "session-".length) + id.slice("session-".length).toUpperCase();
    expect(variant).not.toBe(id);
    sessionsOf(document)[3]["id"] = variant;
    expect(schemaValid(document)).toBe(true);
    expect(check(document).valid).toBe(true);
  });

  test("a live session that repeats a tombstone ID is still a collision, never a live-ID duplicate", () => {
    // The existing RS-15 document-exclusivity handling is unchanged: it reports at the tombstone pointer.
    const document = clone(asRecord(invalidIdentityLinks));
    addSessionLike(document, 0, "session-aaaa0004-0004-4004-8004-000000000009");
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(at(result, "/sessionTombstones/1/sessionId")).toEqual(["tombstone-session-collision"]);
    // The added session is the last one, at index 5.
    expect(at(result, "/sessions/5/id")).toEqual([]);
    expect(codes(result).filter((code) => code === "session-id-duplicate")).toEqual([]);
  });

  test("a duplicate live ID is reported the same way every time and never repaired", () => {
    const document = clone(asRecord(contextShard));
    sessionsOf(document)[4]["id"] = sessionsOf(document)[3]["id"];
    const before = JSON.stringify(document);
    const result = check(document);
    expect(result.valid).toBe(false);
    expect(check(document)).toEqual(result);
    expect(JSON.stringify(document)).toBe(before);
  });

  test("a second tombstone for one session ID fails at its own pointer", () => {
    const document = clone(asRecord(contextShard));
    // A different `deletedAtUtc` states no new fact: one ID is deleted once, permanently (Req 11.14).
    addTombstone(document, String(tombstonesOf(document)[0]["sessionId"]), "2026-09-22T09:30:00Z");
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(codes(result)).toEqual(["tombstone-session-id-duplicate"]);
    expect(at(result, "/sessionTombstones/0/sessionId")).toEqual([]);
    expect(at(result, "/sessionTombstones/1/sessionId")).toEqual(["tombstone-session-id-duplicate"]);
  });

  test("the third and every later tombstone for one ID fails, and the first holder stands", () => {
    const document = clone(asRecord(invalidIdentityLinks));
    addTombstone(document, "session-aaaa0004-0004-4004-8004-000000000009", "2026-09-04T10:00:00Z");
    addTombstone(document, "session-aaaa0004-0004-4004-8004-000000000009", "2026-09-05T10:00:00Z");
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(at(result, "/sessionTombstones/1/sessionId")).toEqual([]);
    expect(at(result, "/sessionTombstones/2/sessionId")).toEqual(["tombstone-session-id-duplicate"]);
    expect(at(result, "/sessionTombstones/3/sessionId")).toEqual(["tombstone-session-id-duplicate"]);
    // The shard's pre-existing live/tombstone collision keeps its own single finding.
    expect(at(result, "/sessionTombstones/0/sessionId")).toEqual(["tombstone-session-collision"]);
  });

  test("a tombstone that both duplicates and collides reports each fact once", () => {
    const document = clone(asRecord(invalidIdentityLinks));
    addTombstone(document, "session-aaaa0004-0004-4004-8004-000000000001", "2026-09-06T10:00:00Z");
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    // Sorted by code then pointer, so both codes at one pointer are ordered.
    expect(at(result, "/sessionTombstones/2/sessionId")).toEqual([
      "tombstone-session-collision",
      "tombstone-session-id-duplicate"
    ]);
  });

  test("a duplicate tombstone ID is rejected with no live sessions present, and none is pruned", () => {
    const document = clone(asRecord(invalidIdentityLinks));
    document["sessions"] = [];
    addTombstone(document, "session-aaaa0004-0004-4004-8004-000000000009", "2026-09-07T10:00:00Z");
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(codes(result)).toEqual(["tombstone-session-id-duplicate"]);
    // Req 11.14: reporting the duplicate removes nothing.
    expect(tombstonesOf(document)).toHaveLength(3);
  });

  test("one tombstone per ID stays valid: permanence and uniqueness do not conflict", () => {
    const document = clone(asRecord(contextShard));
    addTombstone(document, "session-8888a888-8888-4888-8888-888888888888", "2026-09-22T09:30:00Z");
    expect(schemaValid(document)).toBe(true);
    expect(check(document).valid).toBe(true);
  });
});

describe("RS-15: tombstones as facts of the current document", () => {
  test("a live session and a tombstone sharing an ID fails at the tombstone pointer", () => {
    expect(schemaValid(invalidIdentityLinks)).toBe(true);
    const result = check(invalidIdentityLinks);
    expect(at(result, "/sessionTombstones/0/sessionId")).toContain("tombstone-session-collision");
  });

  test("a tombstone with no live session and no duplicate is the expected permanent state", () => {
    const result = check(invalidIdentityLinks);
    expect(at(result, "/sessionTombstones/1/sessionId")).toEqual([]);
  });

  test("a shard of tombstones only is valid: nothing prunes them (Req 11.14)", () => {
    const document = clone(asRecord(invalidIdentityLinks));
    document["sessions"] = [];
    const result = check(document);
    expect(result.valid).toBe(true);
    expect(asRecord(document)["sessionTombstones"]).toBeDefined();
  });
});

describe("RS-17: sync-copy links as facts of the current document", () => {
  test("a copy that references its own ID fails (invariant 22)", () => {
    const result = check(invalidIdentityLinks);
    expect(at(result, "/sessions/1/conflictOfSessionId")).toContain("sync-copy-self-reference");
  });

  test("a copy that references an ID absent from the shard fails (invariant 22)", () => {
    expect(schemaValid(invalidIdentityLinks)).toBe(true);
    const result = check(invalidIdentityLinks);
    expect(at(result, "/sessions/2/conflictOfSessionId")).toContain("sync-copy-target-missing");
  });

  test("a copy whose target survives only as a tombstone is valid: the source can be deleted later (invariant 22)", () => {
    // Session 4 names `session-…0009`, which this shard holds as a tombstone and as no live session. The link
    // records the ID of the session both sides changed, and the user can delete that session at any later
    // time while its tombstone stays forever (Req 11.14), so the tombstone names the recorded source.
    expect(schemaValid(invalidIdentityLinks)).toBe(true);
    const result = check(invalidIdentityLinks);
    expect(under(result, "/sessions/4")).toEqual([]);
    // The tombstone itself stays the permanent record of one deleted ID and carries no finding of its own.
    expect(at(result, "/sessionTombstones/1/sessionId")).toEqual([]);
  });

  test("the same copy fails once the shard holds its target in neither state (invariant 22)", () => {
    // The pair of the test above: dropping the tombstone leaves the ID absent from `sessions` and from
    // `sessionTombstones` both, which is the only target defect RS-17 names — an absent ID.
    const document = clone(asRecord(invalidIdentityLinks));
    const target = String(sessionsOf(document)[4]["conflictOfSessionId"]);
    document["sessionTombstones"] = tombstonesOf(document).filter((tombstone) => tombstone["sessionId"] !== target);
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(at(result, "/sessions/4/conflictOfSessionId")).toEqual(["sync-copy-target-missing"]);
  });

  test("a copy that references another live session in the shard is valid (Req 11.23)", () => {
    const result = check(invalidIdentityLinks);
    expect(at(result, "/sessions/3/conflictOfSessionId")).toEqual([]);
    const contextResult = check(contextShard);
    expect(contextResult.valid).toBe(true);
  });

  test("a tombstone of the target does not weaken a live link", () => {
    // Session 3 names `session-…0001`, which is live (session 0) and also tombstoned. The live session
    // proves the link, and the RS-15 collision at the tombstone is a separate fact reported once there.
    const result = check(invalidIdentityLinks);
    expect(under(result, "/sessions/3")).toEqual([]);
    expect(at(result, "/sessionTombstones/0/sessionId")).toEqual(["tombstone-session-collision"]);
  });

  test("a target that appears later in the shard is valid: identity is the ID, not its position", () => {
    const document = clone(asRecord(invalidIdentityLinks));
    // Every target ID is collected before any link is read, so a copy may name a session written after it.
    sessionsOf(document)[0]["conflictOfSessionId"] = sessionsOf(document)[3]["id"];
    const result = check(document);
    expect(at(result, "/sessions/0/conflictOfSessionId")).toEqual([]);
  });

  test("a copy naming a live session stays valid when that session is tombstoned as well", () => {
    // Both states satisfy the link at once. Tombstoning the live target of the clean link in
    // `shard.context.json` adds the RS-15 collision at the tombstone and changes nothing about the link.
    const document = clone(asRecord(contextShard));
    addTombstone(document, "session-1111a111-1111-4111-8111-111111111111", "2026-09-25T09:00:00Z");
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(under(result, "/sessions/2")).toEqual([]);
    expect(codes(result).filter((code) => code === "sync-copy-target-missing")).toEqual([]);
  });
});

describe("TR-12 and Phase 6: no omission inference with score validation", () => {
  test("S1: a recorded deprecated skip and `nonstandard` detail validate as-is", () => {
    expect(schema.validate("results", 1, acceptanceDeprecatedAtStart).valid).toBe(true);
    const result = checkAcceptance(acceptanceDeprecatedAtStart, "results-2026-08.json");
    expect(result.valid).toBe(true);
    expect(codes(result)).toEqual([]);
  });

  test("S2: an unrecorded now-deprecated leaf hides with no violation and keeps its aggregate", () => {
    const result = checkAcceptance(acceptanceUntouchedBeforeDeprecation, "results-2026-07.json");
    expect(result.valid).toBe(true);
  });

  test("S3: a later tree addition leaves the recorded paths resolving with no inference", () => {
    const result = checkAcceptance(acceptanceLaterAddition, "results-2026-08.json", true);
    expect(result.valid).toBe(true);
  });

  test("a terminal container with no descendant deprecated skip keeps its aggregate", () => {
    const result = checkAcceptance(acceptanceNestedScored, "results-2026-08.json");
    expect(result.valid).toBe(true);
  });

  test("a session that records nothing against a full tree is not an omission", () => {
    const document = clone(asRecord(contextShard));
    sessionsOf(document)[0]["results"] = [];
    expect(check(document).valid).toBe(true);
  });

  test("a mismatched aggregate score is rejected by the Phase 6 semantic pass", () => {
    const document = clone(asRecord(contextShard));
    const container = resultsOf(document, 0)[6];
    container["status"] = "completed";
    // `cycles` is not the AMRAP's configured score type. Phase 6 reports the semantic mismatch.
    container["score"] = { type: "cycles", completedCycles: 4 };
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(result.valid).toBe(false);
    expect(at(result, "/sessions/0/results/6/score/type")).toEqual(["container-score-type-mismatch"]);
  });

  test("partial child detail is rejected separately from score completeness (RS-13)", () => {
    const document = clone(asRecord(contextShard));
    // One leaf of the two-node `finisher` cycle is removed. The omission evidence remains, but the remaining
    // detail no longer covers the observed block.
    resultsOf(document, 0).splice(5, 1);
    expect(schemaValid(document)).toBe(true);
    const result = check(document);
    expect(at(result, "/sessions/0/results/5/executionPath")).toEqual(["container-detail-incomplete"]);
  });
});

describe("recovery: invalid input is reported, never repaired", () => {
  test("hostile result entries are reported and never throw", () => {
    const document = clone(asRecord(contextShard));
    const results = resultsOf(document, 0);
    results.push(null as unknown as Record<string, unknown>);
    results.push("text" as unknown as Record<string, unknown>);
    results.push({ type: "exercise" } as unknown as Record<string, unknown>);
    const result = check(document);
    // The two unstructured entries are schema-owned and skipped; the record without an execution path
    // and workout reference is reported. Nothing throws and the shard is still recognised.
    expect(result.valid).toBe(false);
    expect(at(result, "/sessions/0/results/9/executionPath")).toContain("result-path-unreadable");
    expect(at(result, "/sessions/0/results/9/workoutId")).toContain("result-workout-mismatch");
    expect(codes(result).indexOf("results-document-unstructured")).toBe(-1);
    expect(check(document)).toEqual(result);
  });

  test("a shard whose sessions are not an array is unstructured", () => {
    const document = clone(asRecord(contextShard));
    document["sessions"] = "none";
    const result = check(document);
    expect(codes(result)).toEqual(["results-document-unstructured"]);
  });

  test("an unreadable static directory disables references and never invents them", () => {
    const result = validateResultsShard(contextShard, workouts, { exercises: "none" }, CONTEXT_NAME);
    expect(result.valid).toBe(true);
  });
});
