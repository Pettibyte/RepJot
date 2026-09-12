// Controlled vocabularies mirrored from the v1 JSON schemas.
// Each list matches its schema `enum` exactly. A schema change requires a change here.

/** Exercise force. Mirrors `exercises/v1.schema.json` `exercise.force`. */
export type Force = 'push' | 'pull' | 'static';

/** Exercise mechanic. Mirrors `exercises/v1.schema.json` `exercise.mechanic`. */
export type Mechanic = 'compound' | 'isolation';

/** Exercise category. Mirrors `exercises/v1.schema.json` `exercise.category`. */
export type Category =
  | 'strength'
  | 'stretching'
  | 'plyometrics'
  | 'strongman'
  | 'powerlifting'
  | 'cardio'
  | 'olympic weightlifting';

/** Exercise difficulty. Mirrors `exercises/v1.schema.json` `exercise.level`. */
export type Level = 'beginner' | 'intermediate' | 'expert';

/** Movement pattern. Mirrors `exercises/v1.schema.json` `exercise.movementPattern`. */
export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'horizontal_push'
  | 'vertical_push'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'carry'
  | 'locomotion'
  | 'rotation'
  | 'anti_rotation'
  | 'flexion'
  | 'extension'
  | 'other'
  | 'none';

/** Muscle name. 17 values. Mirrors `exercises/v1.schema.json` `$defs.muscle`. */
export type Muscle =
  | 'abdominals'
  | 'abductors'
  | 'adductors'
  | 'biceps'
  | 'calves'
  | 'chest'
  | 'forearms'
  | 'glutes'
  | 'hamstrings'
  | 'lats'
  | 'lower back'
  | 'middle back'
  | 'neck'
  | 'quadriceps'
  | 'shoulders'
  | 'traps'
  | 'triceps';

/** Body-side pattern of an exercise. Mirrors `exercise.laterality`. */
export type Laterality = 'bilateral' | 'unilateral';

/** Closed equipment vocabulary. 11 values. Mirrors `$defs.equipmentValue`. */
export type EquipmentValue =
  | 'band'
  | 'barbell'
  | 'cable'
  | 'dumbbell'
  | 'e-z curl bar'
  | 'exercise ball'
  | 'foam roll'
  | 'kettlebell'
  | 'machine'
  | 'medicine ball'
  | 'other';

/** How a recorded weight relates to the implement. Mirrors `exercise.loadSemantics`. */
export type LoadSemantics = 'total' | 'per_implement' | 'added' | 'assisted';

/** Side performed. Mirrors `results/v1.schema.json` `exerciseResult.side`. */
export type Side = 'left' | 'right' | 'both' | 'alternating';

/** Side an alternating set starts on. Mirrors `exerciseResult.startingSide`. */
export type StartingSide = 'left' | 'right';

/** Outcome of one result. Mirrors `results/v1.schema.json` `$defs.resultStatus`. */
export type ResultStatus = 'completed' | 'incomplete' | 'skipped';

/** Session lifecycle. Mirrors `results/v1.schema.json` `session.status`. */
export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';

/** Why a result is not completed. Mirrors `results/v1.schema.json` `$defs.reasonCode`. */
export type ReasonCode =
  | 'user_skipped'
  | 'not_completed'
  | 'equipment_unavailable'
  | 'physical_limitation'
  | 'time_constraint'
  | 'unsuccessful_attempt'
  | 'other';

/**
 * Score kind a scored container may capture. Mirrors `workouts/v1.schema.json`
 * `resultCapture.scoreType`. A recorded `Score` may also carry the `'nonstandard'`
 * discriminator; see `Score` in `types.ts`.
 */
export type ScoreType = 'cycles' | 'rounds_and_reps' | 'intervals';

/** Training goal of an exercise node. Mirrors `exerciseNode.stimulus`. */
export type Stimulus = 'strength' | 'hypertrophy' | 'power' | 'conditioning' | 'mobility';

/** Role of a set inside a session. Mirrors `exerciseNode.setType`. */
export type SetType = 'warmup' | 'working';

/** Container execution model. Mirrors `containerNode.strategy`. */
export type ContainerStrategy = 'sequence' | 'rounds' | 'amrap' | 'emom' | 'complex';

/** How much child detail a scored container keeps. Mirrors `resultCapture.childDetail`. */
export type ChildDetail = 'none' | 'optional';

/** Load selection across iterations. Mirrors `$defs.loadStrategy.type`. */
export type LoadStrategyType = 'fixed' | 'ascending' | 'descending' | 'self_selected';

/** Effort measurement kind. Shared by `$defs.effortTarget` and `$defs.effortOutcome`. */
export type EffortKind = 'failure' | 'rir' | 'rpe';

/** Measurement dimension. Mirrors the `dimension` const of each measurement support. */
export type MeasurementDimension =
  | 'reps'
  | 'weight'
  | 'addedWeight'
  | 'assistedWeight'
  | 'distance'
  | 'duration'
  | 'calories';

/** Every unit string any v1 schema permits. Requirement 11.8. */
export type Unit =
  | 'reps'
  | 'lb'
  | 'kg'
  | 'm'
  | 'km'
  | 'ft'
  | 'mi'
  | 'second'
  | 'minute'
  | 'kcal';
