/**
 * Family, version, and logical-name constants plus deterministic recognition helpers for the four v1
 * document families. Authority: docs/contracts/families-and-files.md (FF-01..FF-14),
 * specs/schema-versioning.md (envelope, versions), and the four v1 schemas under schemas/.
 * Every helper accepts `unknown`, never throws, never mutates its input, and returns a discriminated
 * result. A rejection is explicit recovery state: the caller keeps the original bytes or object
 * unchanged (FF-10, FF-20). Types here do not validate runtime data; schema and semantic validation
 * own that later.
 */

// Family format identifiers (FF-01..FF-04)
export const EXERCISES_FORMAT = "repjot/exercises" as const;
export const WORKOUTS_FORMAT = "repjot/workouts" as const;
export const PREFERENCES_FORMAT = "repjot/preferences" as const;
export const RESULTS_FORMAT = "repjot/results" as const;

/** The four known document families (FF-01..FF-04). */
export type DocumentFamily = "exercises" | "workouts" | "preferences" | "results";

/** The four known `format` envelope values. Anything else is an unknown family. */
export type DocumentFormat =
  | typeof EXERCISES_FORMAT
  | typeof WORKOUTS_FORMAT
  | typeof PREFERENCES_FORMAT
  | typeof RESULTS_FORMAT;

const KNOWN_FORMATS: readonly (readonly [DocumentFormat, DocumentFamily])[] = [
  [EXERCISES_FORMAT, "exercises"],
  [WORKOUTS_FORMAT, "workouts"],
  [PREFERENCES_FORMAT, "preferences"],
  [RESULTS_FORMAT, "results"]
];

// Per-family versions: each family owns an independent monotonically increasing sequence (FF-07);
// there is no application-wide persisted version.
/** The current persisted schema version for each family. */
export const CURRENT_VERSION = {
  exercises: 1,
  workouts: 1,
  preferences: 1,
  results: 1
} as const;

/**
 * The oldest supported persisted version for each family. A positive integer below the floor is
 * unsupported-old data: report the floor, never overwrite (FF-20). Release one has no supported
 * version older than v1.
 */
export const SUPPORT_FLOOR_VERSION = {
  exercises: 1,
  workouts: 1,
  preferences: 1,
  results: 1
} as const;

// Logical names (FF-03..FF-06)
/** Static bundle filename for the exercises family (FF-01). */
export const EXERCISES_LOGICAL_NAME = "exercises.json" as const;
/** Static bundle filename for the workouts family (FF-02). */
export const WORKOUTS_LOGICAL_NAME = "workouts.json" as const;
/** The only canonical user preferences filename in Drive appDataFolder (FF-03). */
export const PREFERENCES_LOGICAL_NAME = "preferences.json" as const;

/** Exact results shard name: `results-YYYY-MM.json`, month 01..12, UTC month of the session's `startedAtUtc` (FF-04, RS-01). */
const RESULTS_SHARD_NAME_PATTERN = /^results-([0-9]{4})-(0[1-9]|1[0-2])\.json$/;

/**
 * Recognition result for a candidate logical filename (FF-06). Only `preferences.json` and
 * `results-YYYY-MM.json` are recognized canonical user names; anything else is an unknown file that
 * is never read, edited, or deleted (FF-05). A non-string input recovers to `unknown-file` with a
 * null name: explicit and deterministic, never thrown away.
 */
export type LogicalNameRecognition =
  | { readonly status: "static-exercises"; readonly name: typeof EXERCISES_LOGICAL_NAME }
  | { readonly status: "static-workouts"; readonly name: typeof WORKOUTS_LOGICAL_NAME }
  | { readonly status: "user-preferences"; readonly name: typeof PREFERENCES_LOGICAL_NAME }
  | { readonly status: "user-results-shard"; readonly name: string; readonly yearMonthUtc: string }
  | { readonly status: "unknown-file"; readonly name: string | null };

export function recognizeLogicalName(name: unknown): LogicalNameRecognition {
  if (typeof name !== "string") {
    return { status: "unknown-file", name: null };
  }
  if (name === EXERCISES_LOGICAL_NAME) {
    return { status: "static-exercises", name: EXERCISES_LOGICAL_NAME };
  }
  if (name === WORKOUTS_LOGICAL_NAME) {
    return { status: "static-workouts", name: WORKOUTS_LOGICAL_NAME };
  }
  if (name === PREFERENCES_LOGICAL_NAME) {
    return { status: "user-preferences", name: PREFERENCES_LOGICAL_NAME };
  }
  const match = RESULTS_SHARD_NAME_PATTERN.exec(name);
  if (match !== null) {
    return { status: "user-results-shard", name, yearMonthUtc: match[1] + "-" + match[2] };
  }
  return { status: "unknown-file", name };
}

// Envelope recognition (FF-09, FF-10)
/**
 * Distinct envelope rejection and acceptance kinds. Each error kind from FF-10 has its own arm; the
 * loader never infers `format` or `schemaVersion` from shape. Recovery is the result value itself:
 * callers branch on `status` and preserve the original input bytes in every rejection case.
 */
export type EnvelopeRecognition =
  | {
      readonly status: "recognized";
      readonly family: DocumentFamily;
      readonly format: DocumentFormat;
      readonly schemaVersion: number;
    }
  | { readonly status: "not-an-object" }
  | { readonly status: "missing-format" }
  | { readonly status: "unknown-format" }
  | { readonly status: "wrong-family"; readonly family: DocumentFamily; readonly expectedFamily: DocumentFamily }
  | { readonly status: "missing-version" }
  | { readonly status: "non-number-version" }
  | { readonly status: "non-integer-version" }
  | { readonly status: "non-positive-version" }
  | {
      readonly status: "unsupported-old-version";
      readonly schemaVersion: number;
      readonly supportFloor: number;
    }
  | {
      readonly status: "future-version";
      readonly schemaVersion: number;
      readonly currentVersion: number;
    };

/**
 * Recognize a parsed (still untrusted, `unknown`) document envelope. Only own properties are read:
 * a `format` or `schemaVersion` that exists only on the prototype chain is absent and rejected as
 * missing, never inferred (FF-10). A present null value is a present non-number, not missing.
 * `expectedFamily` is the family implied by the logical filename when one is known; pass `null` for
 * filenames that imply no family. A known format that disagrees with it is `wrong-family`. Version
 * checks follow FF-09: positive integer, then floor and current bounds. No mutation, no exceptions,
 * deterministic output.
 */
export function recognizeEnvelope(
  input: unknown,
  expectedFamily: DocumentFamily | null
): EnvelopeRecognition {
  if (typeof input !== "object" || input === null) {
    return { status: "not-an-object" };
  }
  const record = input as Record<string, unknown>;
  // No own `format`: absent (inherited) or missing both reject here.
  if (!Object.prototype.hasOwnProperty.call(input, "format")) {
    return { status: "missing-format" };
  }
  const format = record["format"];
  if (typeof format !== "string") {
    return { status: "missing-format" };
  }
  let matched: readonly [DocumentFormat, DocumentFamily] | null = null;
  for (let i = 0; i < KNOWN_FORMATS.length; i++) {
    if (KNOWN_FORMATS[i][0] === format) {
      matched = KNOWN_FORMATS[i];
      break;
    }
  }
  if (matched === null) {
    return { status: "unknown-format" };
  }
  if (expectedFamily !== null && matched[1] !== expectedFamily) {
    return { status: "wrong-family", family: matched[1], expectedFamily };
  }
  // No own `schemaVersion`: absent (inherited) or missing both reject here.
  if (!Object.prototype.hasOwnProperty.call(input, "schemaVersion")) {
    return { status: "missing-version" };
  }
  const version = record["schemaVersion"];
  // Present but null, undefined, or non-number is a non-number version, not a missing one.
  if (typeof version !== "number") {
    return { status: "non-number-version" };
  }
  if (!Number.isInteger(version)) {
    return { status: "non-integer-version" };
  }
  if (version < 1) {
    return { status: "non-positive-version" };
  }
  if (version > CURRENT_VERSION[matched[1]]) {
    return {
      status: "future-version",
      schemaVersion: version,
      currentVersion: CURRENT_VERSION[matched[1]]
    };
  }
  if (version < SUPPORT_FLOOR_VERSION[matched[1]]) {
    return {
      status: "unsupported-old-version",
      schemaVersion: version,
      supportFloor: SUPPORT_FLOOR_VERSION[matched[1]]
    };
  }
  return {
    status: "recognized",
    family: matched[1],
    format: matched[0],
    schemaVersion: version
  };
}

// Canonical UTC timestamps (FF-12, FF-13)
/**
 * Structural shape check for a Z-suffixed UTC timestamp string (FF-12): four-digit year, month
 * 01..12, day 01..31, `T` separator, hours up to 23, minutes and seconds 00..59, optional fractional
 * seconds, terminal uppercase `Z`. It does NOT prove full RFC 3339 or calendar validity: an
 * impossible date such as `2026-02-31T00:00:00Z` passes the shape check. Numeric offsets and
 * lowercase `z` are not canonical and are rejected here. Format validation of persisted values is
 * asserted by the schema validator; a pass of this check is never trust that a timestamp is valid.
 */
export const CANONICAL_UTC_TIMESTAMP_PATTERN =
  /^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](\.[0-9]+)?Z$/;

export function hasCanonicalUtcTimestampShape(value: unknown): boolean {
  return typeof value === "string" && CANONICAL_UTC_TIMESTAMP_PATTERN.test(value);
}

/**
 * The `YYYY-MM` UTC month of a structurally Z-suffixed UTC timestamp string, or null when the value
 * lacks that shape (FF-13). Derived display data only: local dates and zones never select shards.
 */
export function utcYearMonthOfTimestamp(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  if (!hasCanonicalUtcTimestampShape(value)) {
    return null;
  }
  return value.slice(0, 7);
}

// Shard name agreement (RS-01, invariant 19)
/**
 * Agreement between a results shard filename and the document's `yearMonthUtc` field. Distinct
 * disagreement kinds keep recovery explicit: the caller reports which fact failed instead of
 * inferring one from the other.
 */
export type ShardAgreement =
  | { readonly status: "agrees"; readonly yearMonthUtc: string }
  | { readonly status: "not-a-results-shard-name" }
  | { readonly status: "invalid-year-month"; readonly documentYearMonthUtc: unknown }
  | {
      readonly status: "month-mismatch";
      readonly shardYearMonthUtc: string;
      readonly documentYearMonthUtc: unknown;
    };

/** `yearMonthUtc` must match `YYYY-MM` with month 01..12 (RS-01). */
const YEAR_MONTH_PATTERN = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

export function shardNameAgreesWithDocument(
  name: unknown,
  yearMonthUtc: unknown
): ShardAgreement {
  const recognized = recognizeLogicalName(name);
  if (recognized.status !== "user-results-shard") {
    return { status: "not-a-results-shard-name" };
  }
  if (typeof yearMonthUtc !== "string" || !YEAR_MONTH_PATTERN.test(yearMonthUtc)) {
    return { status: "invalid-year-month", documentYearMonthUtc: yearMonthUtc };
  }
  if (recognized.yearMonthUtc !== yearMonthUtc) {
    return {
      status: "month-mismatch",
      shardYearMonthUtc: recognized.yearMonthUtc,
      documentYearMonthUtc: yearMonthUtc
    };
  }
  return { status: "agrees", yearMonthUtc };
}

/**
 * Agreement between a session's `startedAtUtc` and the shard it is stored in. An offset (non-Z)
 * timestamp is invalid, never converted here: conversion is the writer's job at creation time
 * (TR-01), and recognition must not infer a canonical value from a non-canonical one.
 */
export type SessionShardAgreement =
  | { readonly status: "agrees"; readonly yearMonthUtc: string }
  | { readonly status: "invalid-started-at" }
  | { readonly status: "invalid-shard-month"; readonly shardYearMonthUtc: unknown }
  | {
      readonly status: "month-mismatch";
      readonly startedAtYearMonthUtc: string;
      readonly shardYearMonthUtc: string;
    };

export function sessionStartAgreesWithShard(
  startedAtUtc: unknown,
  shardYearMonthUtc: unknown
): SessionShardAgreement {
  const startedAtMonth = utcYearMonthOfTimestamp(startedAtUtc);
  if (startedAtMonth === null) {
    return { status: "invalid-started-at" };
  }
  if (typeof shardYearMonthUtc !== "string" || !YEAR_MONTH_PATTERN.test(shardYearMonthUtc)) {
    // A bad shard month is its own diagnostic, never mislabeled as a bad `startedAtUtc`.
    return { status: "invalid-shard-month", shardYearMonthUtc };
  }
  if (startedAtMonth !== shardYearMonthUtc) {
    return {
      status: "month-mismatch",
      startedAtYearMonthUtc: startedAtMonth,
      shardYearMonthUtc
    };
  }
  return { status: "agrees", yearMonthUtc: startedAtMonth };
}
