/**
 * Exact TypeScript contracts for the four v1 document families. Authority (in order):
 * docs/contracts/families-and-files.md, the user-data/static-data/temporal contract matrices,
 * specs/rep-jot-json-schema-spec.md, and the four v1 schema files under schemas/ (FF-17). The
 * results schema references the workouts schema by external $id for `executionPlan`, so both reuse
 * one `WorkoutContainerNode` definition.
 *
 * These types describe the persisted shape of a validated v1 document. They do not validate runtime
 * data: pattern/format assertions, minimum/maximum, minItems/minProperties, uniqueItems, and
 * cross-file reference rules are enforced by the schema and semantic validators in later phases.
 * Unvalidated input stays `unknown` everywhere; nothing here casts unknown into a trusted document.
 * Where a schema constraint is not expressible in TypeScript it is named in a comment next to the
 * field.
 */

import {
  EXERCISES_FORMAT,
  PREFERENCES_FORMAT,
  RESULTS_FORMAT,
  WORKOUTS_FORMAT
} from "./families";
import type { DocumentFamily } from "./families";

/** Persisted application timestamp: RFC 3339 text ending in `Z` (FF-12); the schema validator asserts the pattern. Numeric offsets are never canonical. */
export type UtcTimestamp = string;

/** A stable non-empty identifier (schema `identifier`: minLength 1). */
export type Identifier = string;

// Shared measurement units (EX-08 controlled dimension/unit table)
export type WeightUnit = "lb" | "kg";
export type DistanceUnit = "m" | "km" | "ft" | "mi";
export type DurationUnit = "second" | "minute";

/** `{value, unit}` quantity; `value >= 0` (schema minimum). */
export type WeightQuantity = { readonly value: number; readonly unit: WeightUnit };
export type DistanceQuantity = { readonly value: number; readonly unit: DistanceUnit };
export type DurationQuantity = { readonly value: number; readonly unit: DurationUnit };
export type CaloriesQuantity = { readonly value: number; readonly unit: "kcal" };

/** Positive-duration quantity; `value > 0` (schema exclusiveMinimum). */
export type PositiveDurationQuantity = { readonly value: number; readonly unit: DurationUnit };

// Exercises family (FF-01, schemas/exercises/v1.schema.json)
/** One optional discriminated icon (EX-03). `local_svg` path pattern is schema-enforced. */
export type IconReference =
  | { readonly type: "material_symbol"; readonly name: string }
  | { readonly type: "local_svg"; readonly path: string };

export type ExerciseEquipmentEntry = {
  readonly id: Identifier;
  readonly name: string;
  readonly icon?: IconReference;
};

export type ExerciseForce = "push" | "pull" | "static";
export type ExerciseMechanic = "compound" | "isolation";

/** free-exercise-db 7-value category enum (EX-05). */
export type ExerciseCategory =
  | "strength"
  | "stretching"
  | "plyometrics"
  | "strongman"
  | "powerlifting"
  | "cardio"
  | "olympic weightlifting";

/** REP JOT 13-value movement pattern enum (EX-05). */
export type MovementPattern =
  | "squat"
  | "hinge"
  | "horizontal_push"
  | "vertical_push"
  | "horizontal_pull"
  | "vertical_pull"
  | "carry"
  | "locomotion"
  | "rotation"
  | "anti_rotation"
  | "flexion"
  | "extension"
  | "other";

/** free-exercise-db 17-value muscle enum, retained unchanged (EX-06). */
export type Muscle =
  | "abdominals"
  | "abductors"
  | "adductors"
  | "biceps"
  | "calves"
  | "chest"
  | "forearms"
  | "glutes"
  | "hamstrings"
  | "lats"
  | "lower back"
  | "middle back"
  | "neck"
  | "quadriceps"
  | "shoulders"
  | "traps"
  | "triceps";

/** One measurement dimension with its compatible units (EX-08). `compatibleUnits` is non-empty and unique (schema); metric-before-imperial ordering is a semantic rule (EX-11), not expressible here. */
export type MeasurementSupport =
  | { readonly dimension: "reps"; readonly compatibleUnits: readonly ("rep")[] }
  | { readonly dimension: "weight"; readonly compatibleUnits: readonly WeightUnit[] }
  | { readonly dimension: "addedWeight"; readonly compatibleUnits: readonly WeightUnit[] }
  | { readonly dimension: "assistedWeight"; readonly compatibleUnits: readonly WeightUnit[] }
  | { readonly dimension: "distance"; readonly compatibleUnits: readonly DistanceUnit[] }
  | { readonly dimension: "duration"; readonly compatibleUnits: readonly DurationUnit[] }
  | { readonly dimension: "calories"; readonly compatibleUnits: readonly ("kcal")[] };

export type LoadSemantics = "total" | "per_implement" | "added" | "assisted";

export type ExerciseEntry = {
  readonly id: Identifier;
  readonly name: string;
  /** Ordered free-text instructions; may be empty (EX-02). */
  readonly instructions: readonly string[];
  readonly icon?: IconReference;
  /** Unique retained equipment IDs; empty means no equipment (EX-04). */
  readonly equipmentIds: readonly Identifier[];
  readonly force: ExerciseForce | null;
  readonly mechanic: ExerciseMechanic | null;
  readonly category: ExerciseCategory;
  readonly movementPattern: MovementPattern;
  /** Non-empty (schema minItems 1), unique. Not expressible in the type. */
  readonly primaryMuscles: readonly Muscle[];
  /** Unique; may be empty. */
  readonly secondaryMuscles: readonly Muscle[];
  readonly laterality: "bilateral" | "unilateral";
  /** Non-empty, one entry per dimension (schema minItems 1 + uniqueItems). */
  readonly measurements: readonly MeasurementSupport[];
  /** Conditionally required by the schema when a load dimension exists (EX-09); optionally present otherwise. The type keeps it optional and the schema enforces the conditional requirement. */
  readonly loadSemantics?: LoadSemantics;
  readonly deprecated?: boolean;
};

export type ExercisesDocument = {
  readonly format: typeof EXERCISES_FORMAT;
  readonly schemaVersion: 1;
  readonly equipment: readonly ExerciseEquipmentEntry[];
  readonly exercises: readonly ExerciseEntry[];
};

// Workouts family (FF-02, schemas/workouts/v1.schema.json)
export type ScoreType = "rounds_and_reps" | "intervals" | "cycles";
export type ChildDetailRule = "none" | "optional" | "required";

/** Named benchmark metadata; `name` non-empty, no other keys (WK-08). */
export type Benchmark = { readonly name: string; readonly organization?: string };

/** Reps prescription in its three exact forms (WK-11): exact integer >= 0, approximate target, or inclusive range. `number` must be a non-negative integer (schema); not expressible in the type. */
export type RepsPrescription =
  | number
  | { readonly target: number; readonly qualifier: "approximate" }
  | { readonly min: number; readonly max: number };

/** Effort target (WK-12). `rir` target >= 0; `rpe` target 1..10 (schema). */
export type EffortTarget =
  | { readonly type: "failure" }
  | { readonly type: "rir"; readonly target: number }
  | { readonly type: "rpe"; readonly target: number };

/** Load strategy (WK-13); optional constants are schema-enforced literals. */
export type LoadStrategy = {
  readonly type: "fixed" | "ascending" | "descending" | "self_selected";
  readonly firstIteration?: "maximal_for_prescription";
  readonly adjustment?: "decrease_to_repeat_effort";
};

/** Quantity fields shared by top-level prescriptions and iteration overrides. */
export type PrescriptionQuantities = {
  readonly reps?: RepsPrescription;
  readonly weight?: WeightQuantity;
  readonly addedWeight?: WeightQuantity;
  readonly assistedWeight?: WeightQuantity;
  readonly distance?: DistanceQuantity;
  readonly duration?: DurationQuantity;
  readonly calories?: CaloriesQuantity;
  readonly effort?: EffortTarget;
  readonly loadStrategy?: LoadStrategy;
};

/** One-based iteration override (WK-14/WK-15). `iteration >= 1` and at least one overriding field besides `iteration` (schema minProperties 2) are schema-enforced. Inheritance is derived, never persisted per iteration. */
export type IterationPrescription = PrescriptionQuantities & {
  readonly iteration: number;
};

/** Top-level prescription fields default every iteration (WK-14). At least one field required (schema minProperties 1); `null` cannot remove an inherited field. */
export type Prescription = PrescriptionQuantities & {
  readonly iterations?: readonly IterationPrescription[];
};

export type ExerciseStimulus = "strength" | "hypertrophy" | "power" | "conditioning" | "mobility";

export type ExerciseNode = {
  readonly id: Identifier;
  readonly type: "exercise";
  readonly exerciseId: Identifier;
  readonly stimulus: ExerciseStimulus;
  readonly setType?: "warmup" | "working";
  readonly prescription: Prescription;
  readonly notes?: string;
};

/** Container shared fields. Node IDs are unique within a workout (WK-02). */
type ContainerNodeBase = {
  readonly id: Identifier;
  readonly type: "container";
  /** Direct display field only (WK-08). */
  readonly name?: string;
  readonly benchmark?: Benchmark;
  readonly children: readonly WorkoutNode[];
};

export type SequenceContainerNode = ContainerNodeBase & {
  readonly strategy: "sequence";
  /** Exactly `{}` (schema additionalProperties false); sequence carries no resultCapture (WK-05). */
  readonly strategyConfig: Record<string, never>;
};

export type RoundsContainerNode = ContainerNodeBase & {
  readonly strategy: "rounds";
  /** `rounds` is an integer >= 1 (schema). */
  readonly strategyConfig: { readonly rounds: number };
};

export type AmrapContainerNode = ContainerNodeBase & {
  readonly strategy: "amrap";
  readonly strategyConfig: { readonly duration: PositiveDurationQuantity };
  /** Fixed capture for amrap (WK-05); optional in the v1 schema. */
  readonly resultCapture?: {
    readonly mode: "scored";
    readonly scoreType: "rounds_and_reps";
    readonly childDetail: ChildDetailRule;
  };
};

export type EmomContainerNode = ContainerNodeBase & {
  readonly strategy: "emom";
  /** EMOM uses `cycles` and `interval`, never `rounds` (WK-04). */
  readonly strategyConfig: { readonly cycles: number; readonly interval: PositiveDurationQuantity };
  readonly resultCapture?: {
    readonly mode: "scored";
    readonly scoreType: "intervals";
    readonly childDetail: ChildDetailRule;
  };
};

export type ComplexContainerNode = ContainerNodeBase & {
  readonly strategy: "complex";
  readonly strategyConfig: { readonly cycles: number };
  readonly resultCapture?: {
    readonly mode: "scored";
    readonly scoreType: "cycles";
    readonly childDetail: ChildDetailRule;
  };
};

export type WorkoutContainerNode =
  | SequenceContainerNode
  | RoundsContainerNode
  | AmrapContainerNode
  | EmomContainerNode
  | ComplexContainerNode;

export type WorkoutNode = WorkoutContainerNode | ExerciseNode;

export type Workout = {
  readonly id: Identifier;
  readonly name: string;
  readonly notes?: string;
  readonly root: WorkoutContainerNode;
  readonly deprecated?: boolean;
};

export type WorkoutsDocument = {
  readonly format: typeof WORKOUTS_FORMAT;
  readonly schemaVersion: 1;
  readonly workouts: readonly Workout[];
};

// Preferences family (FF-03, schemas/preferences/v1.schema.json)
/** Preferred units for one exercise (PF-02). At least one dimension present (schema minProperties 1); a compatible unit per the exercise's dimensions is semantic (invariant 9). Canonical key absence represents deletion (D-03.1); no tombstone field exists. */
export type ExerciseUnitPreferences = {
  readonly reps?: "rep";
  readonly weight?: WeightUnit;
  readonly addedWeight?: WeightUnit;
  readonly assistedWeight?: WeightUnit;
  readonly distance?: DistanceUnit;
  readonly duration?: DurationUnit;
  readonly calories?: "kcal";
};

export type PreferencesDocument = {
  readonly format: typeof PREFERENCES_FORMAT;
  readonly schemaVersion: 1;
  /** Integer >= 0 (schema). First-created document starts at 0 (D-03.2). */
  readonly revision: number;
  readonly updatedAtUtc: UtcTimestamp;
  readonly exerciseUnits: { readonly [exerciseId: string]: ExerciseUnitPreferences };
};

// Results family (FF-04, schemas/results/v1.schema.json)
/** `session-` plus RFC 4122 version-4 UUID (RS-02); pattern is schema-enforced. */
export type SessionId = string;

export type SessionStatus = "in_progress" | "completed" | "abandoned";
export type ResultStatus = "completed" | "incomplete" | "skipped";

/** The eight controlled reason codes (RS-11). Free text belongs in notes. */
export type ReasonCode =
  | "deprecated"
  | "user_skipped"
  | "not_completed"
  | "equipment_unavailable"
  | "physical_limitation"
  | "time_constraint"
  | "unsuccessful_attempt"
  | "other";

/** One execution-path segment; `iteration` one-based (RS-06). */
export type PathSegment = {
  readonly nodeId: Identifier;
  readonly iteration?: number;
};

/** Non-empty segment list from the workout root to its terminal node (schema minItems 1). */
export type ExecutionPath = readonly PathSegment[];

/** Observed effort outcome (RS-18). `rir` value >= 0; `rpe` value 1..10 (schema). */
export type EffortOutcome =
  | { readonly type: "failure"; readonly achieved: boolean }
  | { readonly type: "rir"; readonly value: number }
  | { readonly type: "rpe"; readonly value: number };

/** Measured values with explicit units (RS-08). At least one entry (schema minProperties 1); `reps` a non-negative integer. Only supported dimensions with compatible units (invariants 7, 8) is semantic. Effort never appears here (WK-12). */
export type ResultValues = {
  readonly reps?: number;
  readonly weight?: WeightQuantity;
  readonly addedWeight?: WeightQuantity;
  readonly assistedWeight?: WeightQuantity;
  readonly distance?: DistanceQuantity;
  readonly duration?: DurationQuantity;
  readonly calories?: CaloriesQuantity;
};

type ExerciseResultBase = {
  readonly type: "exercise";
  readonly workoutId: Identifier;
  readonly executionPath: ExecutionPath;
  readonly exerciseId: Identifier;
  /** One-based attempt, defaulting to 1 (RS-10); schema integer >= 1. */
  readonly attempt?: number;
  readonly startedAtUtc?: UtcTimestamp;
  readonly endedAtUtc?: UtcTimestamp;
  readonly reasonCode?: ReasonCode;
  readonly notes?: string;
};

/** Side data (RS-09): `startingSide` is present exactly when `side` is `alternating`; the conditional presence/absence is expressible and kept exact here. */
export type ExerciseResult = ExerciseResultBase &
  (
    | { readonly side?: "left" | "right" | "both"; readonly startingSide?: never }
    | { readonly side: "alternating"; readonly startingSide: "left" | "right" }
  ) &
  (
    | {
        readonly status: "completed" | "incomplete";
        readonly values?: ResultValues;
        readonly effort?: EffortOutcome;
      }
    | { readonly status: "skipped"; readonly values?: never; readonly effort?: EffortOutcome }
  );

/** Score object in the exact shape of its type (RS-12); bounds are schema-enforced. */
export type ContainerScore =
  | { readonly type: "cycles"; readonly completedCycles: number }
  | { readonly type: "rounds_and_reps"; readonly completedRounds: number; readonly additionalReps: number }
  | { readonly type: "intervals"; readonly completedIntervals: number; readonly totalIntervals: number }
  | { readonly type: "nonstandard" };

export type ContainerResult = {
  readonly type: "container";
  readonly workoutId: Identifier;
  readonly executionPath: ExecutionPath;
  readonly startedAtUtc?: UtcTimestamp;
  readonly endedAtUtc?: UtcTimestamp;
  readonly reasonCode?: ReasonCode;
  readonly notes?: string;
} & (
  | { readonly status: "completed"; readonly score: ContainerScore }
  | { readonly status: "incomplete"; readonly score?: ContainerScore }
  | { readonly status: "skipped"; readonly score?: never }
);

export type Result = ExerciseResult | ContainerResult;

type SessionBase = {
  readonly id: SessionId;
  readonly workoutId: Identifier;
  /** Immutable once created (RS-04). Selects the shard's UTC month (RS-01). */
  readonly startedAtUtc: UtcTimestamp;
  /** Changes after each saved correction (RS-04). */
  readonly updatedAtUtc: UtcTimestamp;
  /** Set on a sync copy to the original session ID (RS-17); pattern schema-enforced. */
  readonly conflictOfSessionId?: SessionId;
  readonly results: readonly Result[];
  readonly notes?: string;
};

/** `in_progress` sessions carry exactly their frozen plan and no end time (RS-03). */
export type InProgressWorkoutSession = SessionBase & {
  readonly status: "in_progress";
  /** Required for in_progress; removed on the terminal transition (TR-04, RS-03). */
  readonly executionPlan: WorkoutContainerNode;
  /** Forbidden while in_progress; required exactly for terminal sessions (RS-03). */
  readonly endedAtUtc?: never;
};

/** Terminal sessions carry exactly an end time and no plan (RS-03, ADR-020). */
export type TerminalWorkoutSession = SessionBase & {
  readonly status: "completed" | "abandoned";
  readonly endedAtUtc: UtcTimestamp;
  /** No terminal `executionPlan` is persisted (TR-05). */
  readonly executionPlan?: never;
};

export type WorkoutSession = InProgressWorkoutSession | TerminalWorkoutSession;

/** Permanent session-deletion tombstone in the original shard (RS-15). Never auto-removed. */
export type SessionTombstone = {
  readonly sessionId: SessionId;
  readonly deletedAtUtc: UtcTimestamp;
};

export type ResultsShardDocument = {
  readonly format: typeof RESULTS_FORMAT;
  readonly schemaVersion: 1;
  /** `YYYY-MM` pattern, month 01..12 (schema); must equal the filename month (RS-01). */
  readonly yearMonthUtc: string;
  readonly sessions: readonly WorkoutSession[];
  readonly sessionTombstones: readonly SessionTombstone[];
};

// Canonical document union and family mapping (FF-01..FF-04)
/** The four v1 document shapes, discriminated by their `format` envelope value. */
export type V1Document =
  | ExercisesDocument
  | WorkoutsDocument
  | PreferencesDocument
  | ResultsShardDocument;

/** The v1 document shape for one family, consuming the four families as a set. */
export type DocumentForFamily<F extends DocumentFamily> = F extends "exercises"
  ? ExercisesDocument
  : F extends "workouts"
    ? WorkoutsDocument
    : F extends "preferences"
      ? PreferencesDocument
      : ResultsShardDocument;
