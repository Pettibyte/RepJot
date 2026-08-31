import { describe, expect, test } from "bun:test";

import type { DocumentFamily } from "../../src/domain/families";
import {
  CURRENT_VERSION, EXERCISES_FORMAT, EXERCISES_LOGICAL_NAME, PREFERENCES_FORMAT, PREFERENCES_LOGICAL_NAME,
  RESULTS_FORMAT, SUPPORT_FLOOR_VERSION, WORKOUTS_FORMAT, WORKOUTS_LOGICAL_NAME, hasCanonicalUtcTimestampShape,
  recognizeEnvelope, recognizeLogicalName, sessionStartAgreesWithShard, shardNameAgreesWithDocument,
  utcYearMonthOfTimestamp
} from "../../src/domain/families";
import {
  DISAGREEING_SHARD_PAIRS, FIXED_PREFERENCES_UPDATED_AT_UTC, FIXED_SESSION_ID, FIXED_SHARD_NAME,
  FIXED_STARTED_AT_UTC, FIXED_YEAR_MONTH_UTC, MALFORMED_RESULTS_NAMES, MALFORMED_UTC_TIMESTAMPS,
  OUT_OF_SHARD_STARTED_ATS, buildMinimalExercisesDocument, buildMinimalPreferencesDocument,
  buildMinimalResultsShardDocument, buildMinimalWorkoutsDocument, inheritedFormatEnvelope,
  inheritedVersionEnvelope, malformedEnvelopeFractionalVersion, malformedEnvelopeFutureVersion,
  malformedEnvelopeMissingFormat, malformedEnvelopeMissingVersion, malformedEnvelopeNegativeVersion,
  malformedEnvelopeNotAnObject, malformedEnvelopeNullVersion, malformedEnvelopeStringVersion,
  malformedEnvelopeUnknownFamily, malformedEnvelopeWrongFamilyForName, malformedEnvelopeZeroVersion
} from "./document-builders";

/** Deep snapshot for proving recognition never mutates its input. */
function snapshot(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

const FORMAT_FOR_FAMILY: Record<DocumentFamily, string> = {
  exercises: EXERCISES_FORMAT,
  workouts: WORKOUTS_FORMAT,
  preferences: PREFERENCES_FORMAT,
  results: RESULTS_FORMAT
};

const VALID_DOCUMENT_CASES: readonly (readonly [DocumentFamily, () => unknown])[] = [
  ["exercises", buildMinimalExercisesDocument],
  ["workouts", buildMinimalWorkoutsDocument],
  ["preferences", buildMinimalPreferencesDocument],
  ["results", buildMinimalResultsShardDocument]
];

describe("valid minimal documents per family", () => {
  for (const [family, build] of VALID_DOCUMENT_CASES) {
    test(`${family}: builder is deterministic and recognizes as current v1`, () => {
      const first = build();
      const second = build();
      expect(first).toEqual(second);

      const recognition = recognizeEnvelope(first, family);
      expect(recognition.status).toBe("recognized");
      if (recognition.status === "recognized") {
        expect(recognition.family).toBe(family);
        expect(recognition.schemaVersion).toBe(1);
        expect(recognition.format).toBe(FORMAT_FOR_FAMILY[family]);
      }
    });

    test(`${family}: builder does not share state between calls`, () => {
      expect(build() !== build()).toBe(true);
    });
  }
});

describe("family and version constants", () => {
  test("current and support-floor versions are v1 for all four families", () => {
    for (const family of ["exercises", "workouts", "preferences", "results"] as const) {
      expect(CURRENT_VERSION[family]).toBe(1);
      expect(SUPPORT_FLOOR_VERSION[family]).toBe(1);
    }
  });

  test("format constants match the v1 schema format values", () => {
    expect(EXERCISES_FORMAT).toBe("repjot/exercises");
    expect(WORKOUTS_FORMAT).toBe("repjot/workouts");
    expect(PREFERENCES_FORMAT).toBe("repjot/preferences");
    expect(RESULTS_FORMAT).toBe("repjot/results");
  });
});

describe("logical name recognition", () => {
  const CANONICAL_NAME_CASES: readonly (readonly [unknown, unknown])[] = [
    [EXERCISES_LOGICAL_NAME, { status: "static-exercises", name: "exercises.json" }],
    [WORKOUTS_LOGICAL_NAME, { status: "static-workouts", name: "workouts.json" }],
    [PREFERENCES_LOGICAL_NAME, { status: "user-preferences", name: "preferences.json" }],
    [FIXED_SHARD_NAME, { status: "user-results-shard", name: FIXED_SHARD_NAME, yearMonthUtc: FIXED_YEAR_MONTH_UTC }]
  ];

  test("recognizes the five canonical names", () => {
    for (const [name, expected] of CANONICAL_NAME_CASES) {
      expect(recognizeLogicalName(name)).toEqual(expected);
    }
  });

  test("malformed results names are unknown files, never recognized", () => {
    for (const name of MALFORMED_RESULTS_NAMES) {
      expect(recognizeLogicalName(name).status).toBe("unknown-file");
    }
  });

  test("non-string input recovers to an explicit unknown file with null name", () => {
    expect(recognizeLogicalName(42)).toEqual({ status: "unknown-file", name: null });
    expect(recognizeLogicalName(null)).toEqual({ status: "unknown-file", name: null });
  });

  test("recognition is deterministic and does not mutate string input", () => {
    const name = FIXED_SHARD_NAME;
    const first = recognizeLogicalName(name);
    const second = recognizeLogicalName(name);
    expect(first).toEqual(second);
    expect(name).toBe(FIXED_SHARD_NAME);
  });
});

describe("envelope recognition rejections", () => {
  const SINGLE_REJECTION_CASES: readonly (readonly [string, () => unknown, DocumentFamily | null, unknown])[] = [
    ["unknown family format is rejected distinctly", malformedEnvelopeUnknownFamily, null, { status: "unknown-format" }],
    ["missing format is rejected distinctly", malformedEnvelopeMissingFormat, "results", { status: "missing-format" }],
    ["non-object input is rejected distinctly and not thrown away", malformedEnvelopeNotAnObject, "exercises", { status: "not-an-object" }],
    [
      "known format under the wrong filename family is wrong-family",
      malformedEnvelopeWrongFamilyForName,
      "exercises",
      { status: "wrong-family", family: "results", expectedFamily: "exercises" }
    ],
    ["missing version is rejected distinctly", malformedEnvelopeMissingVersion, "results", { status: "missing-version" }]
  ];

  for (const [label, build, family, expected] of SINGLE_REJECTION_CASES) {
    test(label, () => {
      expect(recognizeEnvelope(build(), family)).toEqual(expected);
    });
  }

  test("present-but-null schemaVersion is a non-number, not missing (FF-09)", () => {
    expect(recognizeEnvelope(malformedEnvelopeNullVersion(), "results")).toEqual({
      status: "non-number-version"
    });
  });

  const INHERITED_ENVELOPE_CASES: readonly (readonly [string, () => { readonly input: unknown; readonly prototype: Record<string, unknown> }, string])[] = [
    ["format", inheritedFormatEnvelope, "missing-format"],
    ["schemaVersion", inheritedVersionEnvelope, "missing-version"]
  ];

  for (const [label, build, status] of INHERITED_ENVELOPE_CASES) {
    test(`inherited ${label} on the prototype is rejected as absent, input and prototype unchanged (FF-10)`, () => {
      const { input, prototype } = build();
      const inputBefore = snapshot(input);
      const prototypeBefore = snapshot(prototype);
      expect(recognizeEnvelope(input, "results")).toEqual({ status });
      expect(input).toEqual(inputBefore);
      expect(prototype).toEqual(prototypeBefore);
    });
  }

  const VERSION_REJECTION_CASES: readonly (readonly [() => unknown, DocumentFamily, string])[] = [
    [malformedEnvelopeStringVersion, "results", "non-number-version"],
    [malformedEnvelopeNullVersion, "results", "non-number-version"],
    [malformedEnvelopeFractionalVersion, "results", "non-integer-version"],
    [malformedEnvelopeZeroVersion, "preferences", "non-positive-version"],
    [malformedEnvelopeNegativeVersion, "workouts", "non-positive-version"]
  ];

  test("string, fractional, null, zero, and negative versions are distinct rejections", () => {
    for (const [build, family, status] of VERSION_REJECTION_CASES) {
      expect(recognizeEnvelope(build(), family)).toEqual({ status });
    }
  });

  test("future version reports the current version", () => {
    const input = malformedEnvelopeFutureVersion();
    expect(recognizeEnvelope(input, "exercises")).toEqual({
      status: "future-version",
      schemaVersion: 2,
      currentVersion: CURRENT_VERSION.exercises
    });
  });

  test("every rejection preserves its input object unchanged (recovery keeps bytes)", () => {
    const cases = [
      malformedEnvelopeUnknownFamily(),
      malformedEnvelopeMissingFormat(),
      malformedEnvelopeStringVersion(),
      malformedEnvelopeFractionalVersion(),
      malformedEnvelopeZeroVersion(),
      malformedEnvelopeNegativeVersion(),
      malformedEnvelopeFutureVersion(),
      malformedEnvelopeMissingVersion(),
      malformedEnvelopeNullVersion()
    ];
    for (const input of cases) {
      const before = snapshot(input);
      recognizeEnvelope(input, "exercises");
      expect(input).toEqual(before);
    }
  });

  test("rejection results are deterministic across repeated calls", () => {
    const input = malformedEnvelopeStringVersion();
    const first = recognizeEnvelope(input, "results");
    const second = recognizeEnvelope(snapshot(input), "results");
    expect(first).toEqual(second);
  });
});

describe("structural Z-suffix UTC timestamp shape check (FF-12)", () => {
  test("Z-suffixed UTC values have the canonical shape", () => {
    expect(hasCanonicalUtcTimestampShape(FIXED_STARTED_AT_UTC)).toBe(true);
    expect(hasCanonicalUtcTimestampShape(FIXED_PREFERENCES_UPDATED_AT_UTC)).toBe(true);
    expect(utcYearMonthOfTimestamp(FIXED_STARTED_AT_UTC)).toBe("2026-09");
  });

  test("offset and malformed timestamps do not have the canonical shape", () => {
    for (const value of MALFORMED_UTC_TIMESTAMPS) {
      expect(hasCanonicalUtcTimestampShape(value)).toBe(false);
      expect(utcYearMonthOfTimestamp(value)).toBe(null);
    }
  });

  test("the check is structural only: an impossible calendar date still passes (shape, not trust)", () => {
    expect(hasCanonicalUtcTimestampShape("2026-02-31T00:00:00Z")).toBe(true);
  });
});

describe("shard name agreement (RS-01, invariant 19)", () => {
  test("matching shard name and yearMonthUtc agree", () => {
    expect(shardNameAgreesWithDocument(FIXED_SHARD_NAME, FIXED_YEAR_MONTH_UTC)).toEqual({
      status: "agrees",
      yearMonthUtc: FIXED_YEAR_MONTH_UTC
    });
  });

  test("month disagreement is reported with both facts", () => {
    for (const [name, yearMonth] of DISAGREEING_SHARD_PAIRS) {
      expect(shardNameAgreesWithDocument(name, yearMonth)).toEqual({
        status: "month-mismatch",
        shardYearMonthUtc: name.slice(8, 15),
        documentYearMonthUtc: yearMonth
      });
    }
  });

  test("invalid yearMonthUtc is reported distinctly", () => {
    expect(shardNameAgreesWithDocument(FIXED_SHARD_NAME, "2026-13")).toEqual({
      status: "invalid-year-month",
      documentYearMonthUtc: "2026-13"
    });
    expect(shardNameAgreesWithDocument(FIXED_SHARD_NAME, null)).toEqual({
      status: "invalid-year-month",
      documentYearMonthUtc: null
    });
  });

  test("a non-results filename cannot agree with any shard month", () => {
    expect(shardNameAgreesWithDocument(PREFERENCES_LOGICAL_NAME, FIXED_YEAR_MONTH_UTC)).toEqual({
      status: "not-a-results-shard-name"
    });
  });

  test("session startedAtUtc in its own UTC month agrees with the shard", () => {
    expect(sessionStartAgreesWithShard(FIXED_STARTED_AT_UTC, FIXED_YEAR_MONTH_UTC)).toEqual({
      status: "agrees",
      yearMonthUtc: FIXED_YEAR_MONTH_UTC
    });
  });

  test("session startedAtUtc outside the shard month is a distinct mismatch", () => {
    for (const startedAt of OUT_OF_SHARD_STARTED_ATS) {
      expect(sessionStartAgreesWithShard(startedAt, FIXED_YEAR_MONTH_UTC)).toEqual({
        status: "month-mismatch",
        startedAtYearMonthUtc: startedAt.slice(0, 7),
        shardYearMonthUtc: FIXED_YEAR_MONTH_UTC
      });
    }
  });

  test("an offset startedAtUtc is invalid, never converted or inferred", () => {
    expect(sessionStartAgreesWithShard("2026-08-31T23:30:00-07:00", FIXED_YEAR_MONTH_UTC)).toEqual({
      status: "invalid-started-at"
    });
  });

  test("an invalid shard month is a distinct diagnostic, not mislabeled as an invalid startedAtUtc", () => {
    expect(sessionStartAgreesWithShard(FIXED_STARTED_AT_UTC, "2026-13")).toEqual({
      status: "invalid-shard-month",
      shardYearMonthUtc: "2026-13"
    });
    expect(sessionStartAgreesWithShard(FIXED_STARTED_AT_UTC, null)).toEqual({
      status: "invalid-shard-month",
      shardYearMonthUtc: null
    });
  });
});

describe("valid builder documents carry the persisted envelope facts", () => {
  test("results shard document carries format, schemaVersion, and yearMonthUtc", () => {
    const doc = buildMinimalResultsShardDocument();
    expect(doc.format).toBe(RESULTS_FORMAT);
    expect(doc.schemaVersion).toBe(1);
    expect(doc.yearMonthUtc).toBe(FIXED_YEAR_MONTH_UTC);
    expect(doc.sessions[0].id).toBe(FIXED_SESSION_ID);
  });

  test("preferences document carries revision and Z-suffixed updatedAtUtc", () => {
    const doc = buildMinimalPreferencesDocument();
    expect(doc.revision).toBe(1);
    expect(hasCanonicalUtcTimestampShape(doc.updatedAtUtc)).toBe(true);
  });
});
