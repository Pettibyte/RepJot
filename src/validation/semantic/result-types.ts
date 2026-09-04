/**
 * Result-lifecycle diagnostic types (P5-T01).
 *
 * Authority: docs/contracts/user-data-contracts.md rows RS-01, RS-03 through RS-11, RS-15, RS-17
 * through RS-19 and its invariant ownership summary; docs/contracts/temporal-and-omission-contracts.md
 * rows TR-05, TR-08, TR-12; specs/rep-jot-json-schema-spec.md §5 and §8 invariants 3-8, 14-20, 22, 24;
 * docs/REQUIREMENTS.md Sections 11 and 12.
 *
 * Like the static semantic pass, a diagnostic carries only deterministic safe fields: a stable code,
 * one JSON Pointer, and one fixed message per code. Raw document values — notes, measurements, IDs —
 * never appear in a result.
 *
 * Row ownership is stated on every code below. Where the contract matrix lists `schema` or another
 * module as primary and `sem` as supporting, the code here is the semantic validator's own supporting
 * assertion over `unknown` input: it never replaces the primary owner and it never reorders merge
 * behavior. Phases 37-42 own merge precedence, ID reservation, retry, and convergence; the score and
 * deprecated-omission rules (RS-12, RS-13, invariant 25, invariant 28, and every omission inference
 * under TR-12) stay outside this module.
 */

/** Every stable diagnostic code emitted by result lifecycle validation. */
export type ResultSemanticCode =
  // Shard identity — RS-01 (sem primary, invariant 19), TR-08 (shard stability). The logical
  // `results-YYYY-MM.json` name is a required RS-01 input fact, so the name code below also covers a name
  // a caller never supplied: absent, non-string, or unreadable all fail closed.
  | "results-document-unstructured"
  | "shard-year-month-unreadable"
  | "shard-file-name-month-unreadable"
  | "shard-year-month-name-mismatch"
  | "shard-start-month-mismatch"
  | "session-start-month-unreadable"
  // Session status fields — RS-03 (schema primary, sem supporting; invariants 17-18), TR-05 (no terminal plan)
  | "session-status-invalid"
  | "session-ended-at-required"
  | "session-ended-at-forbidden"
  | "session-plan-required"
  | "session-plan-forbidden"
  // Session correction time and identity — RS-04 (session primary, sem supporting; invariant 16)
  | "session-updated-at-missing"
  | "session-id-unreadable"
  // Session identity uniqueness — Req 11.22 and docs/ARCHITECTURE.md §12 ("UUID uniqueness"); spec §5
  // Workout Session `id` ("Globally stable `session-` prefixed UUID"); RS-02 (session primary, sem current-
  // document uniqueness check). The first holder of an ID keeps it; only the second and later are reported.
  | "session-id-duplicate"
  // Correction immutability — RS-04 (sem supporting), TR-05, TR-08; Req 11.19-11.21
  | "session-start-immutable"
  | "session-ended-at-immutable"
  | "session-status-immutable"
  | "shard-year-month-immutable"
  // Correction advancement — RS-04 (sem supporting; invariant 16), TR-05; Req 11.21. A session a correction
  // edits in place must carry a last-correction time later than the base session's, so Req 11.21's
  // "changes after each saved correction" is proven on the document, not only claimed by the write path.
  | "session-updated-at-not-advanced"
  // Sibling integrity — RS-04 (sem supporting; invariant 16), TR-05; Req 11.20-11.21. The other half of the
  // same rule: Req 11.21 moves a session's last-correction time *after* that session is corrected, so a session
  // the save leaves otherwise unchanged has to keep the base session's time. A save that moves a session's time
  // with no correction in that session changes a persisted timestamp of a session it did not correct, forward
  // or rolled back, which Req 11.20 forbids and Req 11.21 does not license.
  | "session-updated-at-changed-without-correction"
  | "session-updated-at-unreadable"
  // Direct workout reference — RS-05 (sem primary; invariants 3-4), invariant 24 (deprecated still resolves)
  | "session-workout-unresolved"
  | "result-workout-mismatch"
  // Frozen-plan identity — RS-05 and RS-06 (sem supporting; Req 6.11, spec §5 Frozen Execution Plan and
  // Execution Path, §8 invariants 3-5, ARCHITECTURE §12 stable IDs). The plan is the active session's own root
  // (TR-04); these are the facts that make it a copy of the referenced workout rather than a tree of the
  // document's own invention. A plan may still omit nodes and may differ in any content field (Req 6.16:
  // labels, instructions, notes, prescriptions), and in the one scoring fact a start-time omission changes
  // (`childDetail`, TR-02).
  | "session-plan-root-mismatch"
  | "session-plan-node-unresolved"
  // Frozen-plan copy of a node role — RS-06 (sem supporting; Req 6.3 "An existing ID cannot be repurposed for a
  // different entity or node role", Req 6.11 and 6.15, spec §5 Frozen Execution Plan "copies the effective workout
  // root, including node IDs", ARCHITECTURE §12 "role changes" and §17 "parent/type/strategy/contract changes").
  // Reported where the plan and the referenced workout both name a role for the same node at the same position.
  | "session-plan-node-role-mismatch"
  // Frozen-plan copy of a container strategy name — RS-06 (sem supporting; Req 6.11 and 6.15 "container strategy",
  // spec §5 Frozen Execution Plan lists "strategies" among the copied facts, contracts WK-03 and WK-17 preserve
  // "parent, type, exercise ref, strategy, capture, units"). The strategy *name* is the compared fact: the retained
  // half of the comparison is the current tree, and TR-04 states that a later static correction never changes an
  // active session's plan, so a later valid `strategyConfig` correction in the retained bundle keeps a plan that
  // carries the configuration its session started with. Reported once per container, at `strategy`.
  | "session-plan-strategy-mismatch"
  // Frozen-plan copy of one parent's children — RS-05 and RS-06 (sem supporting; spec §5 Frozen Execution Plan
  // "copies the effective workout root, including node IDs", §8 invariant 5, Req 6.14, invariant 23, ARCHITECTURE
  // §12). The retained parent holds each child once, so a plan parent that names one retained child twice carries
  // a node the referenced workout does not have. Counted per parent; the same ID under another parent is the
  // fabricated-ancestry code above.
  | "session-plan-node-duplicate"
  // Frozen-plan copy of an exercise reference — RS-07 (sem supporting; spec §5 Frozen Execution Plan lists
  // "exercise references" among the copied facts and §8 invariant 6 compares a result's direct ID with the plan
  // node, Req 6.15 keeps a published node's exercise reference unchanged). Reported whether or not the different
  // reference resolves, because the fact is that the plan changed it.
  | "session-plan-exercise-mismatch"
  // Execution path — RS-06 (sem primary, invariant 5). Resolution root is the session's frozen plan for
  // `in_progress` and the retained workout tree for a terminal session (TR-04, TR-05); the codes below are
  // the same structural report for either root.
  | "result-path-unreadable"
  | "result-path-root-mismatch"
  | "result-path-node-unresolved"
  | "result-path-iteration-missing"
  | "result-path-iteration-invalid"
  | "result-path-iteration-forbidden"
  | "result-path-terminal-type-mismatch"
  // Direct exercise reference — RS-07 (sem primary, invariant 6), invariant 24. The terminal node the
  // direct ID is compared with is read from the same lifecycle-selected root as the path.
  | "result-exercise-unresolved"
  | "result-exercise-mismatch"
  // Measured values — RS-08 (sem primary, invariants 7-8), EX-08 (sem supporting for result values)
  | "result-value-dimension-unsupported"
  | "result-value-unit-incompatible"
  // Sides — RS-09 (schema primary, sem supporting; invariant 15; Req 11.5-11.7). The unilateral half of the
  // row is invisible to the schema, which cannot read the referenced exercise's laterality.
  | "result-side-invalid"
  | "result-starting-side-required"
  | "result-starting-side-forbidden"
  | "result-unilateral-side-required"
  // A stored result state carries its own evidence — RS-11 (sem primary); spec §5 Save and Omission Rules
  | "result-incomplete-without-evidence"
  // Result uniqueness — RS-10 (sem primary, invariant 14; stated for exercise results, and one
  // container result per path is invariant 13, owned with the score service)
  | "result-attempt-invalid"
  | "result-identity-duplicate"
  // Controlled reason codes — RS-11 (sem primary, schema supporting)
  | "result-reason-code-invalid"
  // Effort outcome — RS-18 (sem primary), WK-12 (sem supporting)
  | "result-effort-invalid"
  | "result-values-contain-effort"
  // Tombstones — RS-15 (merge-r primary, sem document-exclusivity check; invariant 20 document half)
  | "tombstone-session-collision"
  // Tombstone identity uniqueness — Req 11.14 and docs/ARCHITECTURE.md §12 ("tombstone uniqueness");
  // spec §5 Session Tombstone (one permanent record per deleted session ID). RS-15 stays the row; no merge
  // precedence is implied (invariant 21 belongs to Phase 37).
  | "tombstone-session-id-duplicate"
  // Sync copies — RS-17 (merge-r primary, sem document-link check; invariant 22 document half). The target
  // must be an ID another session carries here, live or tombstoned: a copy forks the session both sides
  // changed, and that session may be deleted afterwards (spec §5 "Session Sync Copy", Req 11.14).
  | "sync-copy-self-reference"
  | "sync-copy-target-missing";

/** One stable lifecycle diagnostic at one JSON Pointer location. */
export interface ResultSemanticDiagnostic {
  /** Stable rule code; never contains document data. */
  readonly code: ResultSemanticCode;
  /** JSON Pointer (RFC 6901) into the shard document; empty string at the document root. */
  readonly path: string;
  /** Fixed safe text for the code; never contains document data. */
  readonly message: string;
}

/** The stable result of one result lifecycle validation. */
export interface ResultSemanticResult {
  readonly valid: boolean;
  /** Sorted and deduplicated for determinism; empty exactly when `valid` is true. */
  readonly diagnostics: readonly ResultSemanticDiagnostic[];
}

/** One fixed message per code so results never carry raw document values. */
export const RESULT_SEMANTIC_MESSAGES: Readonly<Record<ResultSemanticCode, string>> = {
  "results-document-unstructured": "the document is not a structured results shard",
  "shard-year-month-unreadable": "the shard UTC month cannot be read, so shard agreement is not proven",
  "shard-file-name-month-unreadable": "the required shard file name is absent or carries no readable month, so shard agreement is not proven",
  "shard-year-month-name-mismatch": "the shard UTC month and the shard file name disagree",
  "shard-start-month-mismatch": "the session UTC start month disagrees with the shard UTC month",
  "session-start-month-unreadable": "the session start time is not a Z-suffixed UTC instant, so its shard is unknown",
  "session-status-invalid": "the session status is not one of the three controlled statuses",
  "session-ended-at-required": "a terminal session has no end time",
  "session-ended-at-forbidden": "an in-progress session carries an end time",
  "session-plan-required": "an in-progress session has no readable frozen execution plan",
  "session-plan-forbidden": "a terminal session persists an execution plan",
  "session-updated-at-missing": "a session has no last-correction time",
  "session-id-unreadable": "a session has no readable identifier, so identity rules cannot be proven",
  "session-id-duplicate": "a session identifier names more than one live session in this shard",
  "session-start-immutable": "a saved correction changed the immutable session start time",
  "session-ended-at-immutable": "a saved correction changed an existing session end time",
  "session-status-immutable": "a saved correction changed the status of a terminal session",
  "shard-year-month-immutable": "a saved correction changed the shard UTC month",
  "session-updated-at-not-advanced": "a saved correction did not set the session last-correction time to a later UTC instant",
  "session-updated-at-changed-without-correction": "a saved correction changed the last-correction time of a session whose other persisted facts it copied unchanged",
  "session-updated-at-unreadable": "the session last-correction time is not a readable Z-suffixed UTC instant, so no later time is proven",
  "session-workout-unresolved": "the session workout reference does not resolve to a retained workout",
  "result-workout-mismatch": "the result workout reference differs from its session workout",
  "session-plan-root-mismatch": "the frozen plan does not carry the referenced workout root identifier",
  "session-plan-node-unresolved": "the frozen plan carries a node that the referenced workout does not have at that position",
  "session-plan-node-duplicate": "the frozen plan names one node of a parent more than once under that parent",
  "session-plan-node-role-mismatch": "the frozen plan gives a node of the referenced workout a different node type",
  "session-plan-strategy-mismatch": "the frozen plan names a container strategy other than the one the referenced workout has at that position",
  "session-plan-exercise-mismatch": "the frozen plan changes the exercise reference of a node the referenced workout has at that position",
  "result-path-unreadable": "the execution path is not a readable non-empty segment list",
  "result-path-root-mismatch": "the execution path does not start at the workout root",
  "result-path-node-unresolved": "an execution path segment does not resolve to a node below its parent segment",
  "result-path-iteration-missing": "a repeated container segment of the execution path has no one-based iteration",
  "result-path-iteration-invalid": "an execution path segment carries an iteration that is not a one-based integer",
  "result-path-iteration-forbidden": "an execution path segment carries an iteration for a non-repeated node",
  "result-path-terminal-type-mismatch": "the execution path terminal node type does not match the result type",
  "result-exercise-unresolved": "the direct exercise reference does not resolve to a retained exercise",
  "result-exercise-mismatch": "the direct exercise reference differs from the terminal workout node",
  "result-value-dimension-unsupported": "a result value uses a dimension the referenced exercise does not support",
  "result-value-unit-incompatible": "a result value unit is not compatible with the dimension for the referenced exercise",
  "result-side-invalid": "the result side is not one of the four controlled sides",
  "result-starting-side-required": "an alternating result has no left or right starting side",
  "result-starting-side-forbidden": "a non-alternating result carries a starting side",
  "result-unilateral-side-required": "a measured unilateral result names no side",
  "result-incomplete-without-evidence": "an incomplete result stores no partial values, time, reason code, or notes",
  "result-attempt-invalid": "the attempt number is not a one-based integer",
  "result-identity-duplicate": "a workout, execution path, side, and attempt tuple appears more than once in one session",
  "result-reason-code-invalid": "the reason code is not one of the eight controlled reason codes",
  "result-effort-invalid": "the effort outcome does not match one of the three controlled shapes",
  "result-values-contain-effort": "effort is recorded inside measured values, where it is not a measurement dimension",
  "tombstone-session-collision": "a live session and a tombstone share one session identifier in this shard",
  "tombstone-session-id-duplicate": "a tombstone session identifier appears more than once in this shard",
  "sync-copy-self-reference": "a sync copy references its own session identifier",
  "sync-copy-target-missing": "a sync copy references a session identifier that no session in this shard carries"
};

/** The eight controlled reason codes (RS-11); free text belongs in notes. */
export const REASON_CODES: readonly string[] = [
  "deprecated",
  "user_skipped",
  "not_completed",
  "equipment_unavailable",
  "physical_limitation",
  "time_constraint",
  "unsuccessful_attempt",
  "other"
];

/** The four controlled sides (RS-09). */
export const RESULT_SIDES: readonly string[] = ["left", "right", "both", "alternating"];

/** Container strategies that repeat their children and therefore contribute one-based path iterations (RS-06). */
export const REPEATED_STRATEGIES: readonly string[] = ["rounds", "amrap", "emom", "complex"];

/** Build one diagnostic from a code and pointer using the fixed message table. */
export function makeResultDiagnostic(code: ResultSemanticCode, path: string): ResultSemanticDiagnostic {
  return { code, path, message: RESULT_SEMANTIC_MESSAGES[code] };
}
