// TypeScript model for the four REP JOT document families.
// Mirrors the v1 schemas under `schemas/` field for field.
// Spec: specs/rep-jot-json-schema-spec.md sections 1-5.
// Optional fields use `?`. A schema rule that TypeScript cannot express, such as a
// minimum on a number or a rule on a sibling field, names its schema in a comment.

import type {
  Category,
  ChildDetail,
  ContainerStrategy,
  EquipmentValue,
  Force,
  Laterality,
  Level,
  LoadSemantics,
  LoadStrategyType,
  Mechanic,
  Muscle,
  MovementPattern,
  ReasonCode,
  ResultStatus,
  ScoreType,
  SessionStatus,
  SetType,
  Side,
  StartingSide,
  Stimulus
} from './enums';
import type { PathSegment } from './execution-path';

// ---------------------------------------------------------------------------
// Quantities
// ---------------------------------------------------------------------------

/**
 * A value with its explicit unit. Requirement 11.8 keeps the unit beside the value
 * so a stored number never needs an assumed unit.
 */
export interface Quantity {
  value: number;
  unit: string;
}

/** Weight in pounds or kilograms. Mirrors `$defs.weightQuantity`. */
export interface WeightQuantity extends Quantity {
  unit: 'lb' | 'kg';
}

/** Distance in metric or imperial units. Mirrors `$defs.distanceQuantity`. */
export interface DistanceQuantity extends Quantity {
  unit: 'm' | 'km' | 'ft' | 'mi';
}

/** Duration in seconds or minutes. Mirrors `$defs.durationQuantity`. */
export interface DurationQuantity extends Quantity {
  unit: 'second' | 'minute';
}

/** Energy in kilocalories. Mirrors `$defs.caloriesQuantity`. */
export interface CaloriesQuantity extends Quantity {
  unit: 'kcal';
}

/**
 * A duration greater than zero. Mirrors `$defs.positiveDuration`.
 * The schema enforces `exclusiveMinimum: 0`; callers must keep `value` above zero.
 */
export interface PositiveDuration extends Quantity {
  unit: 'second' | 'minute';
}

/**
 * A repetition count. Mirrors `$defs.repsQuantity`.
 * The schema enforces a non-negative integer.
 */
export interface RepsQuantity extends Quantity {
  unit: 'reps';
}

// ---------------------------------------------------------------------------
// Exercise directory
// ---------------------------------------------------------------------------

/** Material Symbols icon. Mirrors `$defs.icon` first branch. */
export interface MaterialSymbolIcon {
  type: 'material_symbol';
  name: string;
}

/**
 * Bundled local SVG icon. Mirrors `$defs.icon` second branch.
 * The schema allows a relative `.svg` path only: no scheme, no leading slash, no `..`.
 */
export interface LocalSvgIcon {
  type: 'local_svg';
  path: string;
}

/** Icon shape. Mirrors `$defs.icon`. */
export type Icon = MaterialSymbolIcon | LocalSvgIcon;

/** Reps support. Mirrors `$defs.repsMeasurement`. */
export interface RepsMeasurementSupport {
  dimension: 'reps';
  compatibleUnits: Array<'reps'>;
}

/** Weight support. Mirrors `$defs.weightMeasurement`. */
export interface WeightMeasurementSupport {
  dimension: 'weight';
  compatibleUnits: Array<'lb' | 'kg'>;
}

/** Added-weight support. Mirrors `$defs.addedWeightMeasurement`. */
export interface AddedWeightMeasurementSupport {
  dimension: 'addedWeight';
  compatibleUnits: Array<'lb' | 'kg'>;
}

/** Assisted-weight support. Mirrors `$defs.assistedWeightMeasurement`. */
export interface AssistedWeightMeasurementSupport {
  dimension: 'assistedWeight';
  compatibleUnits: Array<'lb' | 'kg'>;
}

/** Distance support. Mirrors `$defs.distanceMeasurement`. */
export interface DistanceMeasurementSupport {
  dimension: 'distance';
  compatibleUnits: Array<'m' | 'km' | 'ft' | 'mi'>;
}

/** Duration support. Mirrors `$defs.durationMeasurement`. */
export interface DurationMeasurementSupport {
  dimension: 'duration';
  compatibleUnits: Array<'second' | 'minute'>;
}

/** Calories support. Mirrors `$defs.caloriesMeasurement`. */
export interface CaloriesMeasurementSupport {
  dimension: 'calories';
  compatibleUnits: Array<'kcal'>;
}

/** One supported measurement dimension and its units. Mirrors `$defs.measurementSupport`. */
export type MeasurementSupport =
  | RepsMeasurementSupport
  | WeightMeasurementSupport
  | AddedWeightMeasurementSupport
  | AssistedWeightMeasurementSupport
  | DistanceMeasurementSupport
  | DurationMeasurementSupport
  | CaloriesMeasurementSupport;

/**
 * One exercise in the directory. Mirrors `$defs.exercise`.
 * The schema adds cross-field rules: a `weight` dimension forces `loadSemantics` to
 * `'total'` or `'per_implement'`; `addedWeight` forces `'added'`; `assistedWeight`
 * forces `'assisted'`. Phase 03 enforces them.
 */
export interface Exercise {
  id: string;
  name: string;
  instructions: string[];
  icon?: Icon;
  /** Required equipment. `null` means body weight only. */
  equipment: EquipmentValue | null;
  force: Force | null;
  mechanic: Mechanic | null;
  category: Category;
  level: Level;
  movementPattern: MovementPattern;
  /** At least one entry, unique. */
  primaryMuscles: Muscle[];
  /** Unique entries; the array MAY be empty. */
  secondaryMuscles: Muscle[];
  laterality: Laterality;
  /** At least one entry, one per dimension. */
  measurements: MeasurementSupport[];
  loadSemantics: LoadSemantics;
}

/** Envelope of `src/public/data/exercises.json`. Mirrors the exercises schema root. */
export interface ExercisesDoc {
  format: 'repjot/exercises';
  schemaVersion: number;
  exercises: Exercise[];
}

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

/** `strategyConfig` for `strategy: 'sequence'`. Empty object. */
export interface SequenceStrategyConfig {
  [key: string]: never;
}

/** `strategyConfig` for `strategy: 'rounds'`. */
export interface RoundsStrategyConfig {
  rounds: number;
}

/** `strategyConfig` for `strategy: 'amrap'`. */
export interface AmrapStrategyConfig {
  duration: PositiveDuration;
}

/** `strategyConfig` for `strategy: 'emom'`. */
export interface EmomStrategyConfig {
  cycles: number;
  interval: PositiveDuration;
}

/** `strategyConfig` for `strategy: 'complex'`. */
export interface ComplexStrategyConfig {
  cycles: number;
}

/** Maps a container strategy to its `strategyConfig` shape. */
export type StrategyConfigFor<S extends ContainerStrategy> = S extends 'sequence'
  ? SequenceStrategyConfig
  : S extends 'rounds'
    ? RoundsStrategyConfig
    : S extends 'amrap'
      ? AmrapStrategyConfig
      : S extends 'emom'
        ? EmomStrategyConfig
        : ComplexStrategyConfig;

/** Any `strategyConfig` shape. */
export type StrategyConfig = StrategyConfigFor<ContainerStrategy>;

/** Score and child-detail rules. Mirrors `$defs.resultCapture`. */
export interface ResultCapture {
  mode: 'scored';
  scoreType: ScoreType;
  childDetail: ChildDetail;
}

/** Named benchmark a container records against. Mirrors `$defs.benchmark`. */
export interface Benchmark {
  name: string;
  organization?: string;
}

/** A container node under one strategy. Mirrors `$defs.containerNode` for one `strategy`. */
export interface ContainerNodeFor<S extends ContainerStrategy> {
  id: string;
  type: 'container';
  name?: string;
  strategy: S;
  strategyConfig: StrategyConfigFor<S>;
  resultCapture?: ResultCapture;
  benchmark?: Benchmark;
  children: WorkoutNode[];
}

/** Ordered container of nodes. Mirrors `$defs.containerNode`. */
export type ContainerNode = { [S in ContainerStrategy]: ContainerNodeFor<S> }[ContainerStrategy];

/** Reps target: a plain integer, an approximate target, or a range. Mirrors `$defs.repsPrescription`. */
export type RepsPrescription =
  | number
  | { target: number; qualifier: 'approximate' }
  | { min: number; max: number };

/** Effort goal. Mirrors `$defs.effortTarget`. */
export type EffortTarget =
  | { type: 'failure' }
  | { type: 'rir'; target: number }
  | { type: 'rpe'; target: number };

/**
 * Load selection across iterations. Mirrors `$defs.loadStrategy`.
 * `firstIteration` and `adjustment` are optional constants the schema fixes to
 * `'maximal_for_prescription'` and `'decrease_to_repeat_effort'`.
 */
export interface LoadStrategy {
  type: LoadStrategyType;
  firstIteration?: 'maximal_for_prescription';
  adjustment?: 'decrease_to_repeat_effort';
}

/**
 * One-based override for the nearest repeated container. Mirrors `$defs.iterationPrescription`.
 * Overrides only the fields it contains. The schema requires at least two properties.
 */
export interface IterationPrescription {
  iteration: number;
  reps?: RepsPrescription;
  weight?: WeightQuantity;
  addedWeight?: WeightQuantity;
  assistedWeight?: WeightQuantity;
  distance?: DistanceQuantity;
  duration?: DurationQuantity;
  calories?: CaloriesQuantity;
  effort?: EffortTarget;
  loadStrategy?: LoadStrategy;
}

/**
 * Programmed work for an exercise node. Mirrors `$defs.prescription`.
 * Top-level fields apply to every iteration; `iterations` overrides per iteration.
 * The schema requires at least one property.
 */
export interface Prescription {
  reps?: RepsPrescription;
  weight?: WeightQuantity;
  addedWeight?: WeightQuantity;
  assistedWeight?: WeightQuantity;
  distance?: DistanceQuantity;
  duration?: DurationQuantity;
  calories?: CaloriesQuantity;
  effort?: EffortTarget;
  iterations?: IterationPrescription[];
}

/** Exercise node. Mirrors `$defs.exerciseNode`. */
export interface ExerciseNode {
  id: string;
  type: 'exercise';
  exerciseId: string;
  stimulus: Stimulus;
  setType?: SetType;
  prescription: Prescription;
  notes?: string;
}

/** Any node in a workout tree. Mirrors `$defs.node`. */
export type WorkoutNode = ContainerNode | ExerciseNode;

/** One workout definition. Mirrors `$defs.workout`. */
export interface Workout {
  id: string;
  name: string;
  notes?: string;
  root: ContainerNode;
}

/** Envelope of `src/public/data/workouts.json`. Mirrors the workouts schema root. */
export interface WorkoutsDoc {
  format: 'repjot/workouts';
  schemaVersion: number;
  workouts: Workout[];
}

/** Static bundle the app ships: the exercise directory and the workout definitions. */
export interface StaticData {
  exercises: Exercise[];
  workouts: Workout[];
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Actual measured values with explicit units. Mirrors `$defs.resultValues`. */
export interface ResultValues {
  reps?: RepsQuantity;
  weight?: WeightQuantity;
  addedWeight?: WeightQuantity;
  assistedWeight?: WeightQuantity;
  distance?: DistanceQuantity;
  duration?: DurationQuantity;
  calories?: CaloriesQuantity;
}

/** Reached or missed muscular failure. Mirrors `$defs.effortOutcome` first branch. */
export interface FailureOutcome {
  type: 'failure';
  achieved: boolean;
}

/** Reps in reserve. Mirrors `$defs.effortOutcome` second branch. */
export interface RirOutcome {
  type: 'rir';
  value: number;
}

/**
 * Rate of perceived exertion. Mirrors `$defs.effortOutcome` third branch.
 * The schema enforces `value` between 1 and 10.
 */
export interface RpeOutcome {
  type: 'rpe';
  value: number;
}

/** Recorded effort. Mirrors `$defs.effortOutcome`. */
export type EffortOutcome = FailureOutcome | RirOutcome | RpeOutcome;

/** Cycle score. Mirrors `$defs.score` first branch. */
export interface CyclesScore {
  type: 'cycles';
  completedCycles: number;
}

/** Rounds-and-reps score. Mirrors `$defs.score` second branch. */
export interface RoundsAndRepsScore {
  type: 'rounds_and_reps';
  completedRounds: number;
  additionalReps: number;
}

/** Interval score. Mirrors `$defs.score` third branch. */
export interface IntervalsScore {
  type: 'intervals';
  completedIntervals: number;
  totalIntervals: number;
}

/** Score the app cannot express in a captured form. Mirrors `$defs.score` fourth branch. */
export interface NonstandardScore {
  type: 'nonstandard';
}

/**
 * Recorded container score. Mirrors `$defs.score`.
 * `'nonstandard'` exists here but not in `ScoreType`, which lists only what an author
 * may capture.
 */
export type Score = CyclesScore | RoundsAndRepsScore | IntervalsScore | NonstandardScore;

/**
 * One exercise result. Mirrors `$defs.exerciseResult`.
 * Schema rules the type cannot express: `startingSide` is present only when
 * `side === 'alternating'`; a `'completed'` result carries `values`, `effort`,
 * `startedAtUtc`, or `endedAtUtc` and no `reasonCode`; a non-completed result
 * requires `reasonCode`; a `'skipped'` result carries no `values`.
 */
export interface ExerciseResult {
  workoutId: string;
  executionPath: PathSegment[];
  exerciseId: string;
  side?: Side;
  attempt?: number;
  startingSide?: StartingSide;
  status: ResultStatus;
  values?: ResultValues;
  effort?: EffortOutcome;
  startedAtUtc?: string;
  endedAtUtc?: string;
  reasonCode?: ReasonCode;
  notes?: string;
}

/**
 * One scored-container result. Mirrors `$defs.containerResult`.
 * Schema rules the type cannot express: a `'completed'` result requires `score` and
 * forbids `reasonCode`; a non-completed result requires `reasonCode`; a `'skipped'`
 * result carries no `score`.
 */
export interface ContainerResult {
  workoutId: string;
  executionPath: PathSegment[];
  attempt?: number;
  status: ResultStatus;
  score?: Score;
  startedAtUtc?: string;
  endedAtUtc?: string;
  reasonCode?: ReasonCode;
  notes?: string;
}

/**
 * One workout session. Mirrors `$defs.session`.
 * Schema rules the type cannot express: `id` must equal the `sessions` map key;
 * `'in_progress'` forbids `completedAtUtc`; a terminal status requires it.
 */
export interface Session {
  id: string;
  workoutId: string;
  status: SessionStatus;
  startedAtUtc: string;
  completedAtUtc?: string;
  updatedAtUtc: string;
  exerciseResults: Record<string, ExerciseResult>;
  containerResults: Record<string, ContainerResult>;
  notes?: string;
}

/** One UTC month of sessions. Mirrors the results schema root. */
export interface ResultsShard {
  format: 'repjot/results';
  schemaVersion: number;
  /** `'2026-09'`. See `yearMonthUtc()` in `time.ts`. */
  yearMonthUtc: string;
  sessions: Record<string, Session>;
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/**
 * Per-user unit choices. Mirrors the preferences schema root.
 * `exerciseUnits[exerciseId][dimension]` is the chosen unit for that dimension.
 * Requirement 22.4.2 keeps both levels as keyed maps.
 * `revision` is informational only. It never selects a migration and never resolves
 * a conflict.
 */
export interface PreferencesDoc {
  format: 'repjot/preferences';
  schemaVersion: number;
  revision: number;
  updatedAtUtc: string;
  exerciseUnits: Record<string, Record<string, string>>;
}
