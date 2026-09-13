// The value the semantic stage returns.
// ARCHITECTURE section 14, specs/rep-jot-json-schema-spec.md section 8.
//
// Two kinds of finding leave this module, and the difference matters downstream:
//
//   `ValidationIssue`  fatal. The document is malformed. The caller rejects it.
//   `UnresolvedResult` nonfatal. A stored value points at static data the current
//                      bundle no longer holds. The caller keeps the value, marks
//                      the card unresolved, and syncs normally.
//
// A message never carries a user note, a measurement, or a file body. Name the
// place and the rule; leave the content out. REQUIREMENTS 6.10.

/** One fatal fault, addressed by document path. */
export interface ValidationIssue {
  /** Stable code, for example `key_mismatch`. Codes live in `ISSUE_CODES`. */
  code: string;
  /** Document path, for example `sessions.session-1.exerciseResults.<key>`. */
  path: string;
  /** Safe text. No file body, note, or measurement dump. */
  message: string;
}

/** Why a stored reference no longer resolves. REQUIREMENTS 6.8. */
export type UnresolvedReason =
  | 'unknown_workout'
  | 'unknown_exercise'
  | 'broken_path'
  | 'path_exercise_mismatch'
  | 'unit_incompatible'
  | 'measurements_changed';

/** The reasons a preference mapping can fail. A subset of `UnresolvedReason`. */
export type UnresolvedPreferenceReason = Extract<
  UnresolvedReason,
  'unknown_exercise' | 'unit_incompatible' | 'measurements_changed'
>;

/**
 * A stored result the current bundle cannot resolve.
 *
 * The result stays in the document untouched. The UI shows the error card for this
 * entry and renders the recorded values from the result itself.
 * REQUIREMENTS 6.8, 6.10, 6.11, 6.23.
 */
export interface UnresolvedResultReference {
  kind: 'result';
  reason: UnresolvedReason;
  sessionKey: string;
  /** The composite map key the result was stored under. */
  resultKey: string;
  /** The `workoutId` recorded on the session or the result. */
  workoutId: string;
  /** The `exerciseId` recorded on the result, when the result carries one. */
  exerciseId?: string;
  /** The `executionPath` encoded as it appears inside the composite key. */
  encodedPath: string;
}

/**
 * A preferred unit the current exercise no longer accepts.
 *
 * The mapping stays in the document. The Settings screen and the unit pill show
 * the card for this entry instead of applying the unit. REQUIREMENTS 12.4.
 */
export interface UnresolvedPreferenceMapping {
  kind: 'preference';
  reason: UnresolvedPreferenceReason;
  exerciseId: string;
  dimension: string;
  unit: string;
}

/**
 * One nonfatal unresolved reference.
 *
 * A discriminated union: `kind` separates a stored result from a preference
 * mapping, because the two carry different identity fields.
 */
export type UnresolvedResult = UnresolvedResultReference | UnresolvedPreferenceMapping;

/**
 * Stable fatal issue codes.
 *
 * A code is a contract with the UI and with tests. Rename one here and update every
 * consumer in the same change; never reuse a code for a different rule.
 */
export const ISSUE_CODES = {
  /** A `sessions` map key differs from the session `id` it maps to. Spec item 17. */
  SESSION_KEY_MISMATCH: 'session_key_mismatch',
  /** A session `id` does not carry the `session-` prefix. Spec item 17. */
  SESSION_ID_PREFIX: 'session_id_prefix',
  /** Session status and `completedAtUtc` disagree. Spec item 18. */
  SESSION_STATUS_TIMESTAMP: 'session_status_timestamp',
  /** A field the contract forbids appears in the document. Spec item 19. */
  FORBIDDEN_FIELD: 'forbidden_field',
  /** A composite result key does not match the value it maps to. Spec items 14, 15. */
  KEY_MISMATCH: 'key_mismatch',
  /** A result `workoutId` differs from its session `workoutId`. Spec item 3. */
  WORKOUT_ID_MISMATCH: 'workout_id_mismatch',
  /** Two container results claim one execution path and attempt. Spec item 13. */
  DUPLICATE_CONTAINER_RESULT: 'duplicate_container_result',
  /** `startingSide` is missing on `alternating` or present on another side. Spec item 16. */
  STARTING_SIDE: 'starting_side',
  /** A result quantity names an unknown dimension or an incompatible unit. Spec item 7. */
  UNIT_UNSUPPORTED: 'unit_unsupported',
  /** A container score does not match the container `scoreType`. Spec item 10. */
  SCORE_TYPE_MISMATCH: 'score_type_mismatch',
  /** A `rounds_and_reps` container holds a non-repetition leaf. Spec item 24. */
  ROUNDS_AND_REPS_NOT_REPETITIVE: 'rounds_and_reps_not_repetitive',
  /** Child results appear under a `childDetail: "none"` container. Spec item 11. */
  CHILD_DETAIL_FORBIDDEN: 'child_detail_forbidden',
  /** Standard child detail does not derive the stored score. Spec item 12. */
  SCORE_DERIVATION_MISMATCH: 'score_derivation_mismatch',
  /** Shard month, `yearMonthUtc`, or the file name disagree. Spec item 20. */
  SHARD_MONTH_MISMATCH: 'shard_month_mismatch',
  /** A keyed-map key is all digits. Spec item 22. */
  INTEGER_LIKE_KEY: 'integer_like_key',
  /** An ID holds `/`, `|`, or `:`. Spec item 21. */
  BANNED_ID_CHARACTER: 'banned_id_character',
  /** A persisted `*Utc` value is not an RFC 3339 UTC date-time. Spec item 25. */
  TIMESTAMP_NOT_UTC: 'timestamp_not_utc',
  /** Two nodes share one ID inside one workout. REQUIREMENTS 6.20. */
  DUPLICATE_NODE_ID: 'duplicate_node_id',
  /** A workout node names an exercise the bundle does not hold. REQUIREMENTS 6.21. */
  UNKNOWN_EXERCISE: 'unknown_exercise',
  /** A prescription uses a dimension the exercise does not declare. Spec item 19. */
  PRESCRIPTION_DIMENSION_UNDECLARED: 'prescription_dimension_undeclared',
  /** One prescription repeats an iteration number. REQUIREMENTS 10.4. */
  ITERATION_DUPLICATE: 'iteration_duplicate',
  /** An iteration number is below 1 or past the container's count. REQUIREMENTS 10.5. */
  ITERATION_OUT_OF_RANGE: 'iteration_out_of_range',
  /** A non-completed result records no reason code. REQUIREMENTS 11.4. */
  REASON_CODE_MISSING: 'reason_code_missing',
  /** A completed result records a reason code. REQUIREMENTS 11.4. */
  REASON_CODE_FORBIDDEN: 'reason_code_forbidden',
  /** A skipped result carries measured values or a score. REQUIREMENTS 11.4. */
  SKIPPED_RESULT_HAS_PAYLOAD: 'skipped_result_has_payload',
  /** A collection two devices can change is an array, not a keyed map. Spec item 23. */
  KEYED_MAP_REQUIRED: 'keyed_map_required'
} as const;

/** Build a fatal issue. */
export function issue(code: string, path: string, message: string): ValidationIssue {
  return { code, path, message };
}
