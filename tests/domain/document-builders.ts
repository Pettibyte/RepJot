/**
 * Deterministic builders for focused Phase 2 document-contract tests. Every value is a fixed
 * constant: no clock reads, no randomness, no locale or environment access. Each builder returns a
 * fresh object on every call so tests can prove determinism by deep-comparing two calls and
 * immutability by comparing input snapshots before and after recognition. The valid builders return
 * the exact v1 domain types from `src/domain/documents.ts`; the malformed builders return plain
 * objects typed as `unknown` so they exercise the unvalidated-input path without ever being cast
 * into a trusted document type.
 */

import type {
  ExercisesDocument,
  PreferencesDocument,
  ResultsShardDocument,
  WorkoutsDocument
} from "../../src/domain/documents";

// Fixed constants (no clock, no randomness)
export const FIXED_SHARD_NAME = "results-2026-09.json";
export const FIXED_YEAR_MONTH_UTC = "2026-09";
/** Canonical Z-suffixed UTC timestamps (FF-12). */
export const FIXED_STARTED_AT_UTC = "2026-09-01T06:30:00Z";
export const FIXED_ENDED_AT_UTC = "2026-09-01T07:15:00Z";
export const FIXED_UPDATED_AT_UTC = "2026-09-01T07:15:00Z";
export const FIXED_PREFERENCES_UPDATED_AT_UTC = "2026-08-15T15:25:00Z";
/** `session-` plus a fixed RFC 4122 version-4 UUID (RS-02). */
export const FIXED_SESSION_ID = "session-550e8400-e29b-41d4-a716-446655440000";
export const FIXED_TOMBSTONE_SESSION_ID = "session-6ba7b810-9dad-41d1-80b4-00c04fd430c8";
export const FIXED_WORKOUT_ID = "strength-and-cindy";
export const FIXED_EXERCISE_ID = "back-squat";

// One minimal valid document per family
/** Minimal valid exercises v1 document (FF-01). */
export function buildMinimalExercisesDocument(): ExercisesDocument {
  return {
    format: "repjot/exercises",
    schemaVersion: 1,
    equipment: [{ id: "barbell", name: "Barbell" }],
    exercises: [
      {
        id: FIXED_EXERCISE_ID,
        name: "Back Squat",
        instructions: ["Set the bar on the upper back.", "Squat to depth."],
        equipmentIds: ["barbell"],
        force: "push",
        mechanic: "compound",
        category: "strength",
        movementPattern: "squat",
        primaryMuscles: ["quadriceps"],
        secondaryMuscles: ["glutes"],
        laterality: "bilateral",
        measurements: [
          { dimension: "reps", compatibleUnits: ["rep"] },
          { dimension: "weight", compatibleUnits: ["kg", "lb"] }
        ],
        loadSemantics: "total"
      }
    ]
  };
}

/** Minimal valid workouts v1 document (FF-02). */
export function buildMinimalWorkoutsDocument(): WorkoutsDocument {
  return {
    format: "repjot/workouts",
    schemaVersion: 1,
    workouts: [
      {
        id: FIXED_WORKOUT_ID,
        name: "Squat Focus",
        root: {
          id: "root",
          type: "container",
          strategy: "sequence",
          strategyConfig: {},
          children: [
            {
              id: "squat-set",
              type: "exercise",
              exerciseId: FIXED_EXERCISE_ID,
              stimulus: "strength",
              setType: "working",
              prescription: { reps: 5, weight: { value: 80, unit: "kg" } }
            }
          ]
        }
      }
    ]
  };
}

/** Minimal valid preferences v1 document (FF-03). */
export function buildMinimalPreferencesDocument(): PreferencesDocument {
  return {
    format: "repjot/preferences",
    schemaVersion: 1,
    revision: 1,
    updatedAtUtc: FIXED_PREFERENCES_UPDATED_AT_UTC,
    exerciseUnits: { [FIXED_EXERCISE_ID]: { weight: "kg" } }
  };
}

/** Minimal valid results v1 shard document (FF-04). */
export function buildMinimalResultsShardDocument(): ResultsShardDocument {
  return {
    format: "repjot/results",
    schemaVersion: 1,
    yearMonthUtc: FIXED_YEAR_MONTH_UTC,
    sessions: [
      {
        id: FIXED_SESSION_ID,
        workoutId: FIXED_WORKOUT_ID,
        status: "completed",
        startedAtUtc: FIXED_STARTED_AT_UTC,
        endedAtUtc: FIXED_ENDED_AT_UTC,
        updatedAtUtc: FIXED_UPDATED_AT_UTC,
        results: [
          {
            type: "exercise",
            workoutId: FIXED_WORKOUT_ID,
            executionPath: [{ nodeId: "root" }, { nodeId: "squat-set" }],
            exerciseId: FIXED_EXERCISE_ID,
            status: "completed",
            values: { reps: 5, weight: { value: 80, unit: "kg" } },
            effort: { type: "rpe", value: 8 }
          }
        ]
      }
    ],
    sessionTombstones: [
      { sessionId: FIXED_TOMBSTONE_SESSION_ID, deletedAtUtc: FIXED_ENDED_AT_UTC }
    ]
  };
}

// Malformed envelope variants (unvalidated input stays unknown; FF-09/FF-10 negatives)
/** Envelope with a format outside the four known families. */
export function malformedEnvelopeUnknownFamily(): unknown {
  return { format: "repjot/legacy", schemaVersion: 1 };
}

/** Document without any `format` field (missing, not inherited-from-shape). */
export function malformedEnvelopeMissingFormat(): unknown {
  return { schemaVersion: 1 };
}

/** `schemaVersion` persisted as the string `"1"` (FF-09 negative). */
export function malformedEnvelopeStringVersion(): unknown {
  return { format: "repjot/results", schemaVersion: "1" };
}

/** Fractional version (FF-09 negative). */
export function malformedEnvelopeFractionalVersion(): unknown {
  return { format: "repjot/results", schemaVersion: 1.5 };
}

/** Zero version (FF-09 negative). */
export function malformedEnvelopeZeroVersion(): unknown {
  return { format: "repjot/preferences", schemaVersion: 0 };
}

/** Negative version (FF-09 negative). */
export function malformedEnvelopeNegativeVersion(): unknown {
  return { format: "repjot/workouts", schemaVersion: -1 };
}

/** Version beyond the current family version. */
export function malformedEnvelopeFutureVersion(): unknown {
  return { format: "repjot/exercises", schemaVersion: 2 };
}

/** Envelope with `format` but no own `schemaVersion`. */
export function malformedEnvelopeMissingVersion(): unknown {
  return { format: "repjot/results" };
}

/** Present-but-null `schemaVersion`: a present non-number, not missing (FF-09). */
export function malformedEnvelopeNullVersion(): unknown {
  return { format: "repjot/results", schemaVersion: null };
}

/** Known results envelope presented where the filename expects exercises. */
export function malformedEnvelopeWrongFamilyForName(): unknown {
  return { format: "repjot/results", schemaVersion: 1 };
}

/** Parsed value that is not an object at all. */
export function malformedEnvelopeNotAnObject(): unknown {
  return "not a document";
}

/** `format` exists only on the prototype (inherited, not own); FF-10 rejects it as absent. Returns input and prototype so tests can prove neither changes. */
export function inheritedFormatEnvelope(): {
  readonly input: unknown;
  readonly prototype: Record<string, unknown>;
} {
  const prototype: Record<string, unknown> = { format: "repjot/results", schemaVersion: 1 };
  return { input: Object.create(prototype), prototype };
}

/** Own `format` with `schemaVersion` only on the prototype (inherited, not own); FF-10 rejects it as missing. Returns input and prototype so tests can prove neither changes. */
export function inheritedVersionEnvelope(): {
  readonly input: unknown;
  readonly prototype: Record<string, unknown>;
} {
  const prototype: Record<string, unknown> = { schemaVersion: 1 };
  const input = Object.create(prototype);
  (input as Record<string, unknown>)["format"] = "repjot/results";
  return { input, prototype };
}

// Malformed name, timestamp, and shard variants
/** Results shard names that must be unrecognized (FF-06 negatives). */
export const MALFORMED_RESULTS_NAMES: readonly string[] = [
  "results-2026-13.json", // month 13 does not exist
  "Results-2026-09.json", // case-sensitive recognition
  "results-202609.json", // missing dash
  "results-26-09.json", // two-digit year
  "index.json" // not a results name
];

/** Timestamps that are not canonical Z-suffixed UTC (FF-12 negatives). */
export const MALFORMED_UTC_TIMESTAMPS: readonly unknown[] = [
  "2026-08-31T23:30:00-07:00", // numeric offset is not canonical
  "2026-09-01T06:30:00z", // lowercase z rejected
  "2026-09-01 06:30:00Z", // space separator rejected
  "2026-09-01T06:30:00", // missing zone designator
  1785600000, // non-string
  null
];

/** `(shard name, yearMonthUtc)` pairs that must disagree (RS-01 negatives). */
export const DISAGREEING_SHARD_PAIRS: readonly (readonly [string, string])[] = [
  ["results-2026-09.json", "2026-10"], // document month after the shard month
  ["results-2026-12.json", "2027-01"] // year boundary disagreement
];

/** `startedAtUtc` values whose UTC month disagrees with a 2026-09 shard. */
export const OUT_OF_SHARD_STARTED_ATS: readonly string[] = [
  "2026-08-31T23:59:59Z", // previous UTC month
  "2026-10-01T00:00:00Z" // next UTC month
];
