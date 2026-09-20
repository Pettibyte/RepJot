// The Active Workout view model.
// Phase 17. REQUIREMENTS 10.14-10.18, 11.1-11.8, 12.4-12.7, 19.1-19.10.
//
// The screen draws a tree of inputs. This module turns one resolved workout tree
// plus one session into the rows and groups that tree needs, so no component
// below it learns what a `strategyConfig` is or how a result key is built.
//
// Four rules shape the file.
//
// 1. One row per editable occurrence, not one row per node. A repeated
//    container resolves to one occurrence per cycle, and each occurrence
//    carries its own recorded attempts. REQUIREMENTS 10.8, 19.1.
// 2. The model reads; it never writes. A value reaches the session only through
//    `SessionService`, and only when the screen says the user touched it.
//    REQUIREMENTS 11.2, 11.9.
// 3. The display value is the stored value converted to the preferred unit and
//    rounded to the 0.1 grid. The stored value keeps its full precision, so a
//    unit tap that the user never follows up changes nothing on disk.
//    REQUIREMENTS 12.5, 12.6.
// 4. An exercise under a container that records with no child detail is shown
//    but not editable. The container score is the entry point there, so an
//    input beside it would record work the validator refuses.
//    REQUIREMENTS 10.10, 10.13.

import type {
  ChildDetail,
  ReasonCode,
  ResultStatus,
  ScoreType,
  SetType,
  Side,
  StartingSide,
  Stimulus
} from '../../domain/enums';
import {
  containerResultKey,
  defaultSideForLaterality,
  encodePath,
  exerciseResultKey,
  sameSegment,
  type PathSegment
} from '../../domain/execution-path';
import type {
  ContainerNode,
  EffortTarget,
  EffortOutcome,
  Exercise,
  ExerciseResult,
  Quantity,
  RepsPrescription,
  ResultValues,
  Score,
  Session,
  Workout
} from '../../domain/types';
import type { LoadedStaticData } from '../../documents/static-loader';
import type { LookupService } from '../../indexes/lookup-service';
import type { PreferenceService } from '../../preferences/preference-service';
import { isUnderNoChildDetail, resolveTree, type ResolvedNode } from '../../sessions/tree-resolver';
import {
  convert,
  DIMENSION_ORDER,
  formatEditable,
  nextCompatibleUnit,
  type Dimension
} from '../../units/conversion';
import { formatAlternating, formatMinuteValue, unitLabel } from '../../units/format';
import {
  CONTAINER_FALLBACK_NAMES,
  formatContainerSummary,
  formatPrescription,
  joinText,
  stimulusLabel,
  workoutSectionLabel
} from './overviewModel';

/** Display step for a repetition count. Reps are whole numbers. */
const REPS_STEP = 1;

/**
 * How many stored occurrences the Last Time scan reads.
 *
 * The scan skips the session under edit, so the badge may have to walk past
 * the newest entry to reach an earlier session. The window is wide enough
 * to cover a run of edits on one session and small enough to stay a
 * bounded read on every row.
 */
const LAST_TIME_SCAN_SIZE = 25;

/** Display step for every measured quantity. REQUIREMENTS 12.5. */
const MEASURED_STEP = 0.1;

/** Label per measurement dimension. The enum value never reaches the page raw. */
const DIMENSION_LABELS: Record<string, string> = {
  reps: 'Reps',
  weight: 'Weight',
  addedWeight: 'Added',
  assistedWeight: 'Assisted',
  distance: 'Distance',
  duration: 'Duration',
  calories: 'Calories'
};

/** Side order for the side control and for row ordering. */
const SIDE_ORDER: readonly Side[] = ['left', 'right', 'both', 'alternating'];

/** The side a row records when the user has not chosen one. */
const DEFAULT_SIDE: Side = 'both';

/**
 * Every side a side-selectable row may record.
 *
 * Reachable through `sideSelectable`, which decides which exercises get it.
 * REQUIREMENT 11.5.
 */
export const ALL_SIDES: readonly Side[] = ['left', 'right', 'both', 'alternating'];

/**
 * Whether one exercise can be recorded side by side.
 *
 * This is a capability, not a default. It answers "could this be done one
 * side at a time?", which is a different question from "how is it normally
 * performed?". The default side still comes from `laterality`; the side
 * control's visibility comes from here. REQUIREMENT 9.10, 11.5.
 */
export function sideSelectable(
  exercise: Pick<Exercise, 'laterality' | 'loadSemantics'> | undefined
): boolean {
  if (exercise === undefined) return false;
  return exercise.laterality === 'unilateral' || exercise.loadSemantics === 'per_implement';
}

/** Label per reason code. Mirrors the `$defs.reasonCode` vocabulary. */
const REASON_LABELS: Record<string, string> = {
  user_skipped: 'Skipped',
  not_completed: 'Not completed',
  equipment_unavailable: 'Equipment unavailable',
  physical_limitation: 'Physical limitation',
  time_constraint: 'Time constraint',
  unsuccessful_attempt: 'Unsuccessful attempt',
  other: 'Other'
};

/** One editable measurement inside a row. */
export interface FieldModel {
  dimension: Dimension;
  label: string;
  /** Editable display string, rounded to the field's step. Empty means blank. */
  value: string;
  unit: string;
  compatibleUnits: string[];
  inputmode: 'numeric' | 'decimal';
  /**
   * True when a saved result carries this value.
   *
   * False means the field is blank because no actual work is recorded.
   * The prescription stays on its separate guidance line.
   * REQUIREMENTS 10.16, 11.1.
   */
  stored: boolean;
  /** Step the display rounds to: 1 for reps, 0.1 for every measured quantity. */
  step: number;
}

/** The Last Time badge content. REQUIREMENTS 19.3-19.5. */
export interface LastTimeModel {
  /** `'none'` renders `No history`. */
  kind: 'value' | 'none';
  /** Recorded values with units, for example `8 reps · 185 lb`. */
  text: string;
  /** Local date of that session. Absent when there is no history. */
  dateLabel?: string;
  /** Exercise History address. Absent when the exercise is unknown. */
  href?: string;
  /**
   * The recorded values behind `text`, in the units they were stored in.
   *
   * The **Fill with last time** control writes these into a row's fields.
   * `text` cannot fill an input: it folds the unit into one display string,
   * while a field needs the number and the unit apart, and needs the unit
   * the field shows rather than the unit first recorded.
   * REQUIREMENTS 19.4, 19.11.
   */
  fill?: ResultValues;
}

/** One editable exercise occurrence. */
export interface ActiveExerciseRow {
  /**
   * Stable identity for this row across rebuilds.
   *
   * It is the `resultKey` when the row writes one, and a path-based key
   * otherwise, so a non-recordable row under two different iterations of one
   * container never shares a key with its twin.
   */
  key: string;
  /**
   * The row key without its side and attempt: `<workoutId>|<encodedPath>`.
   *
   * The side is part of the row key, so picking a different side moves the
   * row to a new key. The screen holds per-row drafts — the typed value,
   * the edited-field marks, the errors, the open state — and they have to
   * follow the row to its new key or they orphan. This is the prefix that
   * lets the screen rebuild that destination key.
   */
  keyBase: string;
  /** `<workoutId>|<nodeId>`. Matches the missing-work report. */
  nodeKey: string;
  /**
   * The `exerciseResults` map key this row writes, or `null` when the row is
   * not recordable. Built from the occurrence path plus the row's side and
   * attempt, so the row writes exactly the one result it shows.
   */
  resultKey: string | null;
  /** The occurrence path, with the iteration of each repeated ancestor. */
  path: PathSegment[];
  exerciseId: string;
  exerciseName: string;
  prescriptionText: string;
  /** One field per measurement dimension the exercise declares. */
  fields: FieldModel[];
  lastTime: LastTimeModel;
  /**
   * The side this row records.
   *
   * Always present. The row writes its result key from this value, so a
   * `left` occurrence writes a `left` result and never a `both` result.
   * REQUIREMENTS 11.5, 22.4.7.
   */
  side: Side;
  startingSide?: StartingSide;
  attempt: number;
  status: ResultStatus;
  reasonCode?: ReasonCode;
  /** True when the bundle does not hold the exercise. */
  unresolved: boolean;
  /**
   * False when the row sits under a container that records with no child
   * detail. The row shows its name and prescription and no inputs.
   * REQUIREMENTS 10.10, 10.13.
   */
  recordable: boolean;
  /** 1 for the workout root's children, and so on. */
  level: number;
  /** True past level 3, where the compact named path replaces deeper indent. */
  showCompactPath: boolean;
  /** Named path, for example `Strength / Complex / Round 2`. */
  compactPathLabel: string;
  /** True when a result for this row is already saved. */
  hasSavedResult: boolean;
  /**
   * The recorded values this row stands for, kept verbatim.
   *
   * An unresolved row builds no fields, because the exercise directory cannot
   * say what dimensions it measures. The recorded values still ride here so
   * one stale reference never hides what the user actually logged.
   * REQUIREMENTS 6.10, 11.17.
   */
  storedValues?: ResultValues;
  /**
   * True when the exercise is normally performed one side at a time.
   *
   * This drives the **default** side of a new row, not the control's
   * visibility. See `sideSelectable` for that. REQUIREMENT 9.10.
   */
  unilateral: boolean;
  /**
   * True when the row may record a side other than `both`.
   *
   * Wider than `unilateral`: a bilateral exercise loaded per implement also
   * qualifies, because its two sides can be worked apart. The side control
   * shows on this, so a bilateral exercise keeps its `both` default while
   * still letting the user switch. REQUIREMENT 11.5.
   */
  sideSelectable: boolean;
  /**
   * The effort the prescription asks for, when it asks for one.
   *
   * The effort control shows only when this is present, so a row with no
   * programmed effort asks for nothing. REQUIREMENT 19.9.
   */
  effortTarget?: EffortTarget;
  /** The effort already recorded on this row, when one exists. */
  effort?: EffortOutcome;
  /** Presentation metadata used to label one shared set editor. */
  setType?: SetType;
  stimulus?: Stimulus;
  /** The programmed set number. Attempts keep the same number. */
  setNumber?: number;
  /** Only the newest attempt for one path and side may open another attempt. */
  latestAttempt?: boolean;
}

/** One round inside a set table. A round holds one row per exercise. */
export interface ActiveSetRound {
  key: string;
  /**
   * The round divider, for example `Round 2`.
   *
   * Empty when the table needs no divider: a single-exercise table already
   * numbers its rows `Set N`, and a circuit with one round has nothing to
   * tell apart.
   */
  label: string;
  rows: ActiveExerciseRow[];
}

/** One set column in a circuit matrix. The rounds run left to right. */
export interface ActiveSetColumn {
  key: string;
  /** The column heading, `Set 1`. */
  label: string;
  setNumber: number;
}

/** One matrix cell: the rows one exercise recorded in one round. */
export interface ActiveSetCell {
  key: string;
  /**
   * Every row that lands in this cell.
   *
   * One row is the common case. More than one appears when the set holds
   * several attempts, or a unilateral exercise recorded left and right.
   */
  rows: ActiveExerciseRow[];
  /**
   * The prescription for this round, shown only when it differs from the
   * exercise heading. An `iterations` override makes one exercise ask for
   * a different target in a later round. REQUIREMENTS 10.2, 10.3.
   */
  prescriptionText?: string;
}

/** One exercise line across the set columns. */
export interface ActiveSetMatrixRow {
  /** The exercise node key. Unique inside one table. */
  key: string;
  exerciseName: string;
  /** The prescription this exercise asks for, read from its first cell. */
  prescriptionText: string;
  lastTime: LastTimeModel;
  /** Cells aligned to `ActiveSetMatrix.columns` by index. */
  cells: ActiveSetCell[];
}

/** The exercise-by-set grid a circuit renders as. */
export interface ActiveSetMatrix {
  columns: ActiveSetColumn[];
  rows: ActiveSetMatrixRow[];
}

/**
 * One repeated block shown as a set table.
 *
 * A block that repeats one exercise reads as that exercise's set list, so
 * the table carries the exercise name and one Last Time badge. A block that
 * repeats several exercises reads as a circuit, and renders as a matrix:
 * one exercise per row, one set per column. The matrix is the compact form,
 * because the exercise name and the prescription are stated once per row
 * instead of once per set. `rows` is the same rows in draw order, derived
 * from `rounds`, so a caller that does not care about rounds reads one
 * flat list.
 */
export interface ActiveSetTable {
  key: string;
  title: string;
  sectionTitle: string;
  label: string;
  level: number;
  /** True when each round holds more than one exercise. */
  multiExercise: boolean;
  /** The table body. The rounds are the source of truth for the rows. */
  rounds: ActiveSetRound[];
  /** Every row in draw order. Derived from `rounds`; never set apart from it. */
  rows: ActiveExerciseRow[];
  /** The exercise-by-set grid. Present only when `multiExercise` is true. */
  matrix?: ActiveSetMatrix;
  /** The Last Time for the one exercise. Absent on a circuit table. */
  lastTime?: LastTimeModel;
}

/**
 * Turn round-grouped rows into the exercise-by-set grid.
 *
 * Exercise order comes from the first round, so the matrix keeps the order
 * the workout programmed. A cell holds every row that exercise recorded in
 * that round, which is more than one row when attempts or sides exist.
 */
function buildMatrix(rounds: ActiveSetRound[]): ActiveSetMatrix {
  const columns: ActiveSetColumn[] = rounds.map((round, index) => ({
    key: round.key,
    label: `Set ${round.rows[0]?.setNumber ?? index + 1}`,
    setNumber: round.rows[0]?.setNumber ?? index + 1
  }));

  const order: string[] = [];
  for (const row of rounds[0]?.rows ?? []) {
    if (!order.includes(row.nodeKey)) order.push(row.nodeKey);
  }

  const rows: ActiveSetMatrixRow[] = order.map((nodeKey) => {
    const cells: ActiveSetCell[] = rounds.map((round, index) => ({
      key: `${nodeKey}@${round.key}`,
      rows: round.rows.filter((row) => row.nodeKey === nodeKey)
    }));
    const first = cells.find((cell) => cell.rows.length > 0)?.rows[0];
    const base = first?.prescriptionText ?? '';
    // State the prescription once on the row. A round that asks for
    // something different says so on its own cell.
    for (const cell of cells) {
      const text = cell.rows[0]?.prescriptionText ?? '';
      if (text !== '' && text !== base) cell.prescriptionText = text;
    }
    return {
      key: nodeKey,
      exerciseName: first?.exerciseName ?? '',
      prescriptionText: base,
      lastTime: first?.lastTime ?? { kind: 'none', text: '' },
      cells
    };
  });

  return { columns, rows };
}

/** One child of a group: a nested container or an exercise row. */
export type GroupChild =
  | { kind: 'group'; group: GroupModel }
  | { kind: 'row'; row: ActiveExerciseRow };

/** One container occurrence. */export interface GroupModel {
  /** `<workoutId>|<nodeId>|<iteration>`. Unique per occurrence. */
  key: string;
  /** `<workoutId>|<nodeId>`. Shared by every occurrence of one container. */
  nodeKey: string;
  containerNodeId: string;
  /**
   * The container's own path with the iteration off its own segment. This is
   * the shape `SessionService` keys a container result by and the shape
   * `addAmrapRound` takes.
   */
  storedPath: PathSegment[];
  title: string;
  level: number;
  showCompactPath: boolean;
  compactPathLabel: string;
  strategy: string;
  /** `4 rounds`, `AMRAP 20 min`, `EMOM 4 x 1 min`. */
  summaryText: string;
  scored: boolean;
  /** The score kind the container asked for. Absent when it is not scored. */
  scoreType?: ScoreType;
  childDetail?: ChildDetail;
  /** The saved container score, when one exists. */
  score?: Score;
  /** True when the saved score is `nonstandard`. REQUIREMENT 10.18. */
  detailed: boolean;
  /** True when saved exercise results sit below this occurrence. */
  hasSavedDetail: boolean;
  /** True when **Expand detail** can produce a draft set. */
  canExpand: boolean;
  isAmrap: boolean;
  isEmom: boolean;
  /** Prescribed interval count. Zero when the container is not an EMOM. */
  totalIntervals: number;
  /** Keys of the exercise rows that sit directly under this group. */
  rowKeys: string[];
  /**
   * The ids of this container's programmed exercise children, in order.
   *
   * The set-table gate reads this instead of `rowKeys`. `rowKeys` grows as
   * the user records a second side or adds an attempt, so a gate keyed on
   * it would drop a superset out of the grid halfway through the session.
   * The programmed child list never changes while the workout runs, so the
   * grid cannot vanish under the user.
   */
  programmedExerciseNodeIds: string[];
  /** True when a container sits among the container's own direct children. */
  hasNestedContainers: boolean;
  /** Stable scope after this container's own repetition is removed. */
  scopeKey: string;
  /** Repeated scored containers share a result; only one draws its editor. */
  showControls: boolean;
  /** Semantic divider label inferred from the group's direct exercise rows. */
  sectionTitle?: string;
}

/** One thing the screen draws, in order. */
export type DrawBlock =
  | { kind: 'group'; group: GroupModel }
  | { kind: 'row'; row: ActiveExerciseRow }
  | { kind: 'set-table'; table: ActiveSetTable };

/** Everything the Active Workout screen draws. */
export interface ActiveWorkoutModel {
  /** Context shown above the editable document. */
  workoutName: string;
  /** Every exercise row in prescriptive order. */
  rows: ActiveExerciseRow[];
  /** Every container group in preorder. The root group is the first entry. */
  groups: GroupModel[];
  /**
   * Groups and rows interleaved in prescriptive draw order.
   *
   * The screen renders this flat list and indents by `level`, instead of
   * recursing through a nested component. A shallow DOM tree matters on the
   * targeted browser, and a flat list keeps the row keys in one place.
   */
  blocks: DrawBlock[];
}

/** What the model reads. */
export interface ActiveWorkoutModelInput {
  workout: Workout;
  session: Session;
  staticData: LoadedStaticData;
  preferences: PreferenceService;
  lookup: LookupService;
}

/** Round a number to its step and drop a trailing `.0`. */
/**
 * Show one number on a read-only line.
 *
 * `formatEditable` keeps one decimal because an editable field must show the
 * digit the user types into. A read-only line drops the trailing `.0`, so a
 * badge reads `225 lb` and not `225.0 lb`.
 */
export function formatStep(value: number, step: number): string {
  const text = formatEditable({ value, unit: '' }, step);
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

/** The step one dimension displays at. Reps are whole; the rest read to 0.1. */
function stepFor(dimension: Dimension): number {
  return dimension === 'reps' ? REPS_STEP : MEASURED_STEP;
}

/** The `inputmode` for one dimension. Reps take the integer pad. */
function inputModeFor(dimension: Dimension): 'numeric' | 'decimal' {
  return dimension === 'reps' ? 'numeric' : 'decimal';
}

/**
 * The reps a prescription asks for, as one number.
 *
 * `RepsPrescription` is a union of three shapes, not a `Quantity`, so it
 * cannot go through `convert`. Each shape is read explicitly, with the same
 * rule `sessions/scoring.prescribedReps` uses: a plain number is the
 * target, a range reads its low end because meeting the low end is meeting
 * the prescription, and an approximate target reads its target.
 */
export function prescribedRepsValue(reps: RepsPrescription | undefined): number | undefined {
  if (reps === undefined) return undefined;
  if (typeof reps === 'number') return Number.isFinite(reps) ? reps : undefined;
  if ('min' in reps) return Number.isFinite(reps.min) ? reps.min : undefined;
  if ('target' in reps) return Number.isFinite(reps.target) ? reps.target : undefined;
  return undefined;
}

/** Format one field value in the unit it will display. */
function formatFieldValue(value: number, unit: string, step: number): string {
  return unit === 'minute' ? formatMinuteValue(value) : formatStep(value, step);
}

/** The stored value for one dimension, as the display string in the preferred unit. */
function storedText(
  values: ResultValues | undefined,
  dimension: Dimension,
  preferredUnit: string | undefined,
  step: number
): string {
  const quantity = values?.[dimension];
  if (quantity === undefined || preferredUnit === undefined) return '';
  try {
    const converted = convert(quantity, preferredUnit);
    return formatFieldValue(converted.value, preferredUnit, step);
  } catch {
    return '';
  }
}

/**
 * Build the fields for one exercise occurrence.
 *
 * One field per dimension the exercise declares, in the fixed dimension order,
 * so the input order never follows a JSON key order. REQUIREMENTS 3.17, 19.9.
 *
 * A field starts with the recorded value when one exists and stays blank
 * otherwise. The prescription is shown separately above the inputs. It must
 * never look like recorded actual work or become recorded merely because the
 * user focused and blurred a control.
 */
function buildFields(
  exercise: Exercise,
  values: ResultValues | undefined,
  preferences: PreferenceService
): FieldModel[] {
  const fields: FieldModel[] = [];
  for (const dimension of DIMENSION_ORDER) {
    const support = exercise.measurements.find(
      (candidate) => candidate.dimension === dimension
    );
    if (support === undefined) continue;
    const preferred = preferences.getUnit(exercise.id, dimension);
    const step = stepFor(dimension);
    const stored = values?.[dimension] !== undefined;
    const shown = stored ? storedText(values, dimension, preferred, step) : '';

    fields.push({
      dimension,
      label: DIMENSION_LABELS[dimension] ?? dimension,
      value: shown,
      unit: preferred ?? support.compatibleUnits[0] ?? '',
      compatibleUnits: [...support.compatibleUnits],
      inputmode: inputModeFor(dimension),
      stored,
      step
    });
  }
  return fields;
}

/**
 * The Last Time badge for one exercise.
 *
 * The badge shows the latest completed set from an **earlier** session. The
 * session under edit is skipped by id, not by status, because REQUIREMENT
 * 11.16 opens a completed or abandoned session in this same editor. A
 * `getLastTime` call alone skips only `in_progress` sessions, so editing a
 * finished session would show the very set being edited.
 * REQUIREMENTS 19.4, 11.16.
 */
function buildLastTime(
  exerciseId: string,
  lookup: LookupService,
  excludeSessionId: string
): LastTimeModel {
  const href = `#/exercises/${encodeURIComponent(exerciseId)}/history`;
  const page = lookup.getExerciseHistory(exerciseId, { offset: 0, limit: LAST_TIME_SCAN_SIZE });

  for (const occurrence of page.items) {
    if (occurrence.status !== 'completed') continue;
    if (occurrence.sessionId === excludeSessionId) continue;

    const parts: string[] = [];
    for (const dimension of DIMENSION_ORDER) {
      const quantity = occurrence.values?.[dimension];
      if (quantity === undefined) continue;
      // A read-only line drops the trailing `.0`. `formatEditable` keeps one
      // decimal because an editable field must show the digit the user types
      // into; a badge is not a field. `225 lb`, not `225.0 lb`.
      parts.push(`${formatFieldValue(quantity.value, quantity.unit, stepFor(dimension))} ${unitLabel(quantity.unit)}`);
    }
    if (parts.length === 0) break;

    return {
      kind: 'value',
      text: parts.join(' · '),
      // The same values the badge just read, kept whole so a fill tap does
      // not have to parse its own display string back apart.
      fill: { ...(occurrence.values ?? {}) },
      dateLabel: occurrence.completedAtUtc.slice(0, 10),
      href
    };
  }

  return { kind: 'none', text: 'No history', href };
}

/**
 * Drop the iteration from the last segment of a path.
 *
 * A container result is keyed by the container's own node path with no
 * iteration, while the children below it carry the iteration on that same
 * segment. This mirrors the private helper in `session-service.ts`, so the
 * key the screen reads is the key the service wrote.
 */
function withoutIteration(path: PathSegment[]): PathSegment[] {
  const copy = path.map((segment: PathSegment): PathSegment => ({ ...segment }));
  const last = copy[copy.length - 1];
  if (last !== undefined) delete last.iteration;
  return copy;
}

/**
 * Index the session's exercise results by their encoded path.
 *
 * The screen reads a row's recorded results by occurrence path, which is the
 * same lookup `overlayResults` performs, but the Active Workout screen also
 * needs the per-side and per-attempt grouping the overlay flattens away.
 */
function indexByPath(session: Session): Map<string, ExerciseResult[]> {
  const byPath = new Map<string, ExerciseResult[]>();
  for (const result of Object.values(session.exerciseResults)) {
    if (!Array.isArray(result.executionPath) || result.executionPath.length === 0) continue;
    const encoded = encodePath(result.executionPath);
    const bucket = byPath.get(encoded);
    if (bucket === undefined) byPath.set(encoded, [result]);
    else bucket.push(result);
  }
  return byPath;
}

/** True when at least one exercise result sits strictly below `storedPath`. */
function hasDetailBelow(session: Session, storedPath: PathSegment[]): boolean {
  const depth = storedPath.length - 1;
  if (depth < 0) return false;
  const containerId = storedPath[depth]?.nodeId;
  if (containerId === undefined) return false;

  for (const result of Object.values(session.exerciseResults)) {
    const path = result.executionPath;
    if (!Array.isArray(path) || path.length <= storedPath.length) continue;
    if (path[depth]?.nodeId !== containerId) continue;
    let matches = true;
    for (let index = 0; index < depth; index += 1) {
      if (!sameSegment(path[index], storedPath[index])) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

/** The innermost programmed iteration is the set number shown to the user. */
function setNumberFor(path: PathSegment[]): number {
  for (let index = path.length - 1; index >= 0; index -= 1) {
    const iteration = path[index]?.iteration;
    if (iteration !== undefined) return iteration;
  }
  return 1;
}

/** Sort recorded results by attempt, then by the fixed side order. */
function byAttemptThenSide(a: ExerciseResult, b: ExerciseResult): number {
  const attemptA = a.attempt ?? 1;
  const attemptB = b.attempt ?? 1;
  if (attemptA !== attemptB) return attemptA < attemptB ? -1 : 1;
  const sideA = SIDE_ORDER.indexOf(a.side ?? 'both');
  const sideB = SIDE_ORDER.indexOf(b.side ?? 'both');
  if (sideA !== sideB) return sideA < sideB ? -1 : 1;
  return 0;
}

/** The title one container occurrence draws. */
function groupTitle(resolved: ResolvedNode): string {
  const container = resolved.node as ContainerNode;
  const base = container.name ?? CONTAINER_FALLBACK_NAMES[container.strategy] ?? 'Section';
  // A repeated container emits one row per cycle. The first reads as the
  // container's own name; a later one says which round it is, so the page
  // never shows the same heading with nothing to tell the copies apart.
  return resolved.iteration !== undefined && resolved.iteration > 1
    ? `Round ${resolved.iteration}`
    : base;
}

/** The prescribed interval count for one EMOM occurrence. */
function totalIntervalsFor(container: ContainerNode): number {
  if (container.strategy !== 'emom') return 0;
  const cycles = container.strategyConfig.cycles;
  return Number.isFinite(cycles) ? cycles * container.children.length : 0;
}

/**
 * Collapse a repeated `rounds` container into one set table.
 *
 * A container that repeats one exercise becomes that exercise's set list.
 * A container that repeats several exercises — a superset or a circuit —
 * becomes one table whose rows are grouped by round, so the programmed
 * round order stays readable and the container keeps one heading instead
 * of one heading per round.
 *
 * Three checks decide whether a container collapses:
 *
 * 1. Every direct child must be an exercise. A container that also holds a
 *    nested container would split that round across two renderers.
 * 2. The container must not be scored. A scored container owns a score
 *    editor and an expand control, and those belong on the container
 *    heading, not inside a set table. REQUIREMENTS 10.10, 10.13.
 * 3. The container must carry rows at all.
 *
 * Nothing here reads the recorded row count. A round that gained a second
 * side or an extra attempt still repeats the same programmed exercises, so
 * the grid survives recording. The extra rows stack inside the cell, which
 * is why a cell holds an array of rows rather than one row.
 */
function buildDisplayBlocks(
  source: Array<{ kind: 'group'; group: GroupModel } | { kind: 'row'; row: ActiveExerciseRow }>,
  groups: GroupModel[],
  rowsByKey: Map<string, ActiveExerciseRow>
): DrawBlock[] {
  const byScope = new Map<string, GroupModel[]>();
  for (const group of groups) {
    if (group.strategy !== 'rounds' || group.rowKeys.length === 0) continue;
    const bucket = byScope.get(group.scopeKey);
    if (bucket === undefined) byScope.set(group.scopeKey, [group]);
    else bucket.push(group);
  }

  const tables = new Map<string, ActiveSetTable>();
  const hiddenRows = new Set<string>();
  for (const [scopeKey, occurrences] of byScope) {
    if (occurrences.some((group) => group.scored)) continue;
    if (occurrences.some((group) => group.hasNestedContainers)) continue;

    const rounds: ActiveSetRound[] = occurrences.map((group, index) => ({
      key: `${scopeKey}#round-${index + 1}`,
      label: `Round ${index + 1}`,
      rows: group.rowKeys
        .map((key) => rowsByKey.get(key))
        .filter((row): row is ActiveExerciseRow => row !== undefined)
    }));
    const tableRows = rounds.flatMap((round) => round.rows);
    if (tableRows.length === 0) continue;

    // No shape check goes here. Every group under one `scopeKey` is the
    // same container node across its own iterations, so the programmed
    // children are identical by construction and a comparison would never
    // fire. What must never gate the grid is the *recorded* shape: that
    // changes while the user records, and a grid that vanishes mid-set is
    // worse than any layout the gate could have prevented.
    const first = tableRows[0];
    // The programmed count decides, not the recorded one. A round that holds
    // two extra rows because the user recorded both sides still repeats the
    // same two exercises.
    const exercisesPerRound = occurrences[0]?.programmedExerciseNodeIds.length ?? 0;
    const multiExercise = exercisesPerRound > 1;
    // A divider only earns its place inside a circuit that has rounds to
    // tell apart. A single-exercise table already orders its rows with
    // `Set N`, and one round has nothing to separate.
    if (!multiExercise || rounds.length === 1) {
      rounds.forEach((round) => (round.label = ''));
    }

    tables.set(scopeKey, {
      key: `sets-${scopeKey}`,
      title: multiExercise ? occurrences[0]?.title ?? first.exerciseName : first.exerciseName,
      sectionTitle: workoutSectionLabel(first.setType, first.stimulus),
      label: first.setType === 'warmup' ? 'Warmup sets' : 'Working sets',
      level: Math.max(1, occurrences[0]?.level ?? first.level),
      multiExercise,
      rounds,
      rows: tableRows,
      // A circuit renders as the exercise-by-set grid.
      ...(multiExercise ? { matrix: buildMatrix(rounds) } : {}),
      // A circuit names several exercises, so one exercise's Last Time
      // would read as the whole table's. The badge rides each row instead.
      ...(multiExercise ? {} : { lastTime: first.lastTime })
    });
    for (const row of tableRows) hiddenRows.add(row.key);
  }

  const emittedTables = new Set<string>();
  const output: DrawBlock[] = [];
  for (const block of source) {
    if (block.kind === 'group') {
      const table = tables.get(block.group.scopeKey);
      if (table !== undefined) {
        if (!emittedTables.has(table.key)) {
          emittedTables.add(table.key);
          output.push({ kind: 'set-table', table });
        }
        continue;
      }
      const isGenericRoot =
        block.group.level === 1 &&
        block.group.title === (CONTAINER_FALLBACK_NAMES.sequence ?? 'Sequence') &&
        !block.group.scored;
      if (!isGenericRoot) output.push(block);
      continue;
    }
    if (!hiddenRows.has(block.row.key)) output.push(block);
  }
  return output;
}

/**
 * Build the Active Workout model.
 *
 * The tree is resolved from the current bundle and the session's recorded
 * results are laid over it, so a deploy that changes the workout changes what
 * the editor shows. That is the accepted trade in ARCHITECTURE section 9.
 */
export function buildActiveWorkoutModel(
  input: ActiveWorkoutModelInput
): ActiveWorkoutModel {
  const { workout, session, staticData, preferences, lookup } = input;
  const resolved = resolveTree(workout);
  const resultsByPath = indexByPath(session);

  const rows: ActiveExerciseRow[] = [];
  const groups: GroupModel[] = [];
  const sourceBlocks: Array<
    { kind: 'group'; group: GroupModel } | { kind: 'row'; row: ActiveExerciseRow }
  > = [];
  const stack: Array<{ level: number; group: GroupModel }> = [];
  const controlScopes = new Set<string>();

  for (const node of resolved) {
    // Unwind the stack to this node's parent. Preorder plus a level is a
    // complete tree, so no parent pointer is needed on the resolved node.
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1].group : null;

    if (node.node.type === 'container') {
      const container = node.node;
      const storedPath = withoutIteration(node.path);
      const score = session.containerResults[containerResultKey(storedPath)]?.score;
      const childDetail = container.resultCapture?.childDetail;
      const savedDetail = hasDetailBelow(session, storedPath);
      const scopeKey = `${workout.id}|${encodePath(storedPath)}`;
      const group: GroupModel = {
        key: `${workout.id}|${encodePath(node.path)}`,
        nodeKey: `${workout.id}|${container.id}`,
        containerNodeId: container.id,
        storedPath,
        title: groupTitle(node),
        level: node.level,
        showCompactPath: node.level > 3,
        compactPathLabel: node.compactPathLabel,
        strategy: container.strategy,
        summaryText: formatContainerSummary(container),
        scored: container.resultCapture !== undefined,
        detailed: false,
        hasSavedDetail: savedDetail,
        canExpand: false,
        isAmrap: container.strategy === 'amrap',
        isEmom: container.strategy === 'emom',
        totalIntervals: totalIntervalsFor(container),
        rowKeys: [],
        programmedExerciseNodeIds: container.children
          .filter((child) => child.type === 'exercise')
          .map((child) => child.id),
        hasNestedContainers: container.children.some(
          (child) => child.type === 'container'
        ),
        scopeKey,
        showControls: !controlScopes.has(scopeKey)
      };
      controlScopes.add(scopeKey);
      if (container.resultCapture !== undefined) group.scoreType = container.resultCapture.scoreType;
      if (childDetail !== undefined) group.childDetail = childDetail;
      if (score !== undefined) group.score = score;
      // **Detailed** reads straight off the score discriminator, so a stored
      // `nonstandard` score always shows the marker. REQUIREMENT 10.18.
      group.detailed = score?.type === 'nonstandard';
      // Expansion needs a score to spread across the children, and a container
      // that keeps no child detail never offers it. A container that already
      // holds saved detail does not need it either.
      group.canExpand =
        group.scored && childDetail !== 'none' && score !== undefined && !savedDetail;

      groups.push(group);
      sourceBlocks.push({ kind: 'group', group });
      stack.push({ level: node.level, group });
      continue;
    }

    const exerciseNode = node.node;
    const exercise = staticData.exerciseById.get(exerciseNode.exerciseId);
    const recordable = !isUnderNoChildDetail(workout, node.path);
    const recorded = (resultsByPath.get(encodePath(node.path)) ?? []).slice().sort(byAttemptThenSide);

    // One row per recorded side-and-attempt group, plus one live row when
    // nothing is recorded yet. A second attempt is a separate row because it
    // writes a separate result key.
    const groupsByKey = new Map<string, ExerciseResult>();
    for (const result of recorded) {
      const key = exerciseResultKey(result.executionPath, result.side ?? 'both', result.attempt ?? 1);
      if (!groupsByKey.has(key)) groupsByKey.set(key, result);
    }
    const occurrences: Array<ExerciseResult | null> =
      groupsByKey.size > 0 ? [...groupsByKey.values()] : [null];

    for (const result of occurrences) {
      // A saved result is authoritative. An empty unilateral row starts as
      // alternating; bilateral and unresolved rows start as both.
      const side = result?.side ?? defaultSideForLaterality(exercise?.laterality);
      const attempt = result?.attempt ?? 1;
      const values = result?.values;
      // A recorded result carries its own `exerciseId`, read from the result
      // and never derived from the tree. When the bundle no longer holds the
      // exercise the result names, the row is a stale reference even though
      // the tree node itself resolves. REQUIREMENTS 6.23, 11.17.
      const resultExerciseMissing =
        result !== null && staticData.exerciseById.get(result.exerciseId) === undefined;
      const row: ActiveExerciseRow = {
        key: `${workout.id}|${encodePath(node.path)}|${side}|${attempt}`,
        keyBase: `${workout.id}|${encodePath(node.path)}`,
        nodeKey: `${workout.id}|${exerciseNode.id}`,
        resultKey: recordable ? exerciseResultKey(node.path, side, attempt) : null,
        path: node.path,
        exerciseId: exerciseNode.exerciseId,
        exerciseName: exercise?.name ?? exerciseNode.exerciseId,
        prescriptionText:
          exercise === undefined
            ? ''
            : joinText(
                formatPrescription(node.effectivePrescription),
                stimulusLabel(exerciseNode.stimulus)
              ),
        fields:
          exercise === undefined
            ? []
            : buildFields(exercise, values, preferences),
        lastTime: buildLastTime(exerciseNode.exerciseId, lookup, session.id),
        side,
        attempt,
        status: result?.status ?? 'completed',
        unresolved: exercise === undefined || resultExerciseMissing,
        recordable,
        level: node.level,
        showCompactPath: node.level > 3,
        compactPathLabel: node.compactPathLabel,
        hasSavedResult: result !== null,
        unilateral: exercise?.laterality === 'unilateral',
        sideSelectable: sideSelectable(exercise),
        setNumber: setNumberFor(node.path),
        latestAttempt: true
      };
      if (exerciseNode.setType !== undefined) row.setType = exerciseNode.setType;
      if (exerciseNode.stimulus !== undefined) row.stimulus = exerciseNode.stimulus;
      // The effort target rides from the effective prescription, so an
      // `iterations` override decides which round asks for effort. The
      // recorded effort rides from the result, so the control opens showing
      // what the user already gave. REQUIREMENT 19.9.
      if (exercise !== undefined && node.effectivePrescription.effort !== undefined) {
        row.effortTarget = node.effectivePrescription.effort;
      }
      if (result?.effort !== undefined) row.effort = result.effort;
      if (result?.startingSide !== undefined) row.startingSide = result.startingSide;
      // Alternating rows need a starting side before their first save. This
      // remains a UI default rather than exercise reference data.
      else if (result === null && side === 'alternating') row.startingSide = 'left';
      if (result?.reasonCode !== undefined) row.reasonCode = result.reasonCode;
      if (values !== undefined) row.storedValues = values;

      rows.push(row);
      sourceBlocks.push({ kind: 'row', row });
      if (parent !== null) {
        parent.rowKeys.push(row.key);
      }
    }
  }

  for (const group of groups) {
    const directRows = group.rowKeys
      .map((key) => rows.find((row) => row.key === key))
      .filter((row): row is ActiveExerciseRow => row !== undefined);
    if (directRows.length === 0) continue;
    const first = directRows[0];
    const sectionTitle = workoutSectionLabel(first?.setType, first?.stimulus);
    if (sectionTitle.toLowerCase() !== group.title.toLowerCase()) group.sectionTitle = sectionTitle;
  }

  // Attempts are ordered per path and side. Only the newest one offers the
  // action, while the service independently guards against key collisions.
  const latestByOccurrence = new Map<string, number>();
  for (const row of rows) {
    const identity = `${encodePath(row.path)}|${row.side}`;
    latestByOccurrence.set(identity, Math.max(latestByOccurrence.get(identity) ?? 0, row.attempt));
  }
  for (const row of rows) {
    row.latestAttempt = row.attempt === latestByOccurrence.get(`${encodePath(row.path)}|${row.side}`);
  }

  const rowsByKey = new Map(rows.map((row) => [row.key, row]));
  const blocks = buildDisplayBlocks(sourceBlocks, groups, rowsByKey);
  return { workoutName: workout.name, rows, groups, blocks };
}

/** The label for one reason code. */
export function reasonLabel(code: ReasonCode | string): string {
  return REASON_LABELS[code] ?? code;
}

/**
 * The alternating split line for one row.
 *
 * An alternating set stores one total across both sides, so the screen must
 * say what each side got. REQUIREMENT 11.7 asks for `10 total / 5 each` or
 * `9 total / 5 left / 4 right`.
 *
 * The line reads the reps the row currently shows, so it follows what the
 * user typed rather than what was last saved. It returns the empty string
 * when the row is not alternating, carries no reps, or has no starting side,
 * because a split without a starting side would invent which side got the
 * odd rep.
 */
export function alternatingLine(
  row: Pick<ActiveExerciseRow, 'side' | 'startingSide'>,
  fields: FieldModel[],
  overrides: Record<string, string> | undefined
): string {
  if (row.side !== 'alternating') return '';
  if (row.startingSide === undefined) return '';
  const reps = fields.find((field) => field.dimension === 'reps');
  if (reps === undefined) return '';
  const quantity = parseFieldValue(reps, fieldDisplay(reps, overrides));
  if (quantity === null) return '';
  return formatAlternating(quantity.value, row.startingSide);
}

/**
 * The line that says what the number in the reps field means.
 *
 * The same typed `8` means three different things depending on the side,
 * and nobody should have to hold that in their head while counting. This
 * states it beside the field. REQUIREMENT 11.5.
 *
 * `alternating` is left to `alternatingLine`, which already spells out the
 * per-side split. Two lines saying almost the same thing would read worse
 * than one, so this returns empty for that side.
 */
export function repsMeaning(
  row: Pick<ActiveExerciseRow, 'side' | 'startingSide'>,
  fields: FieldModel[],
  overrides: Record<string, string> | undefined
): string {
  const reps = fields.find((field) => field.dimension === 'reps');
  if (reps === undefined) return '';
  // An alternating set already has the split the user needs, and it reads
  // better beside the field it explains than buried in the options panel.
  if (row.side === 'alternating') {
    return alternatingLine(row, fields, overrides);
  }
  const quantity = parseFieldValue(reps, fieldDisplay(reps, overrides));
  if (quantity === null) return '';
  const shown = formatStep(quantity.value, REPS_STEP);
  if (row.side === 'both') return `Both sides together · ${shown} for the set`;
  const side = row.side === 'left' ? 'Left' : 'Right';
  return `${side} side only · ${shown} per side`;
}

/**
 * The reps total across every row one matrix cell holds.
 *
 * A cell that holds one row needs no total: the field already shows it. A
 * cell that holds several — five left and four right, say — gains a real
 * total the individual fields cannot show. Returns empty when no row in
 * the cell carries a readable reps value.
 */
export function cellRepsTotal(
  rows: ActiveExerciseRow[],
  overridesFor: (rowKey: string) => Record<string, string>
): string {
  if (rows.length < 2) return '';
  let total = 0;
  let counted = 0;
  for (const row of rows) {
    const reps = row.fields.find((field) => field.dimension === 'reps');
    if (reps === undefined) continue;
    const quantity = parseFieldValue(reps, fieldDisplay(reps, overridesFor(row.key)));
    if (quantity === null) continue;
    total += quantity.value;
    counted += 1;
  }
  if (counted === 0) return '';
  return `${formatStep(total, REPS_STEP)} total`;
}

/**
 * The sides one row may record.
 *
 * A side-selectable row offers every side. Any other row records `both` only,
 * so the control never offers a side the exercise cannot perform.
 * REQUIREMENT 11.5.
 */
export function sidesForRow(row: Pick<ActiveExerciseRow, 'sideSelectable'>): Side[] {
  return row.sideSelectable ? [...ALL_SIDES] : [DEFAULT_SIDE];
}

/** The label for one unit. Re-exported so a row needs only one import. */
export { unitLabel };

/**
 * The text one field shows, with the screen's draft override applied.
 *
 * The model holds saved state and prescription defaults. The screen holds what
 * the user has typed since. This is the one place the two meet, so a field can
 * never show one thing and save another.
 */
export function fieldDisplay(
  field: FieldModel,
  overrides: Record<string, string> | undefined
): string {
  if (overrides === undefined) return field.value;
  if (!Object.prototype.hasOwnProperty.call(overrides, field.dimension)) return field.value;
  return overrides[field.dimension] ?? '';
}

/**
 * Turn one field's display text into a stored quantity.
 *
 * Blank text returns `null`, which is how a blank input creates no result.
 * A value is stored in the unit the field shows, so the number the user read
 * is the number recorded. REQUIREMENTS 11.2, 11.8, 12.7.
 */
/**
 * Read a clock string as a whole number of seconds.
 *
 * Accepts `m:ss` and `h:mm:ss`, so `2:15` reads as two minutes and fifteen
 * seconds instead of the two point two five a typed decimal would give.
 * A plain number is not a clock string and returns `undefined`, so the
 * caller falls back to the decimal read the field already does and both
 * forms stay valid.
 *
 * Only the parts after the first are bounded to 0-59. `2:75` is not a
 * clock, and reading it as 195 seconds would silently invent time.
 */
export function parseClockSeconds(text: string): number | undefined {
  const parts = text.trim().split(':');
  if (parts.length < 2 || parts.length > 3) return undefined;
  if (!parts.every((part) => /^\d+$/.test(part))) return undefined;
  const nums = parts.map(Number);
  if (nums.slice(1).some((part) => part > 59)) return undefined;
  if (parts.length === 2) return nums[0] * 60 + nums[1];
  return nums[0] * 3600 + nums[1] * 60 + nums[2];
}

/** True when this field can take a `mm:ss` entry. Duration only. */
function isClockField(field: FieldModel): boolean {
  return field.dimension === 'duration';
}

/** The field's error text, with the clock form accepted for duration. */
export function fieldInputError(field: FieldModel, display: string): string | undefined {
  const trimmed = display.trim();
  if (trimmed === '') return undefined;
  // `2:15` is valid on a duration field even though Number() rejects it.
  if (isClockField(field) && parseClockSeconds(trimmed) !== undefined) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return field.dimension === 'reps'
      ? 'Enter a whole number of 0 or more.'
      : 'Enter a number of 0 or more.';
  }
  if (field.dimension === 'reps' && !Number.isInteger(parsed)) {
    return 'Enter a whole number of 0 or more.';
  }
  return undefined;
}

export function parseFieldValue(field: FieldModel, display: string): Quantity | null {
  const trimmed = display.trim();
  if (trimmed === '' || fieldInputError(field, display) !== undefined) return null;
  // A clock entry is read in seconds, then converted into the unit the field
  // shows, so the number the user read is still the number recorded.
  if (isClockField(field)) {
    const seconds = parseClockSeconds(trimmed);
    if (seconds !== undefined) {
      try {
        return convert({ value: seconds, unit: 'second' }, field.unit);
      } catch {
        return null;
      }
    }
  }
  return { value: Number(trimmed), unit: field.unit };
}

/** Collect one row's non-blank fields into `ResultValues`. */
export function draftRowValues(
  fields: FieldModel[],
  overrides: Record<string, string> | undefined
): ResultValues {
  const values: ResultValues = {};
  for (const field of fields) {
    const quantity = parseFieldValue(field, fieldDisplay(field, overrides));
    if (quantity === null) continue;
    (values as Record<string, Quantity>)[field.dimension] = quantity;
  }
  return values;
}

/** What a unit-pill tap produced. */
export interface UnitTapResult {
  /** The unit now selected, or `null` when there was nowhere to go. */
  nextUnit: string | null;
  /** The field text re-rendered in the new unit. */
  display: string;
}

/**
 * Run one unit-pill tap: pick the next unit, save the preference, and re-render
 * the field text.
 *
 * The pill's tap does two things the user expects to happen together, so they
 * live in one function a test can call directly. The preference write goes
 * through `PreferenceService`, which means a tap that the exercise would reject
 * writes nothing and reports no unit change. The displayed value converts at
 * full precision and rounds to the field step; the stored result is not
 * touched, so an unedited rounded value keeps its full precision.
 * REQUIREMENTS 12.4, 12.5, 12.6, 12.7.
 */
export async function tapUnitPill(input: {
  exercise: Exercise | undefined;
  dimension: Dimension;
  currentUnit: string;
  display: string;
  preferences: PreferenceService;
}): Promise<UnitTapResult> {
  const next = nextCompatibleUnit(input.exercise, input.dimension, input.currentUnit);
  if (next === undefined || next === input.currentUnit) {
    return { nextUnit: null, display: input.display };
  }
  try {
    await input.preferences.setUnit(input.exercise?.id ?? '', input.dimension, next);
  } catch {
    // A rejected preference write must not move the display, or the field would
    // read in a unit the service refused to save.
    return { nextUnit: null, display: input.display };
  }
  return {
    nextUnit: next,
    display: convertFieldDisplay(
      {
        dimension: input.dimension,
        label: '',
        value: input.display,
        unit: input.currentUnit,
        compatibleUnits: [],
        inputmode: 'decimal',
        stored: false,
        step: stepFor(input.dimension)
      },
      input.display,
      next
    )
  };
}

/**
 * The text one field shows after a unit change, at full precision.
 *
 * The value the field currently displays is converted out of its old unit and
 * into the new one, then rounded to the field's step. The stored value is not
 * touched here; only the display moves. REQUIREMENTS 12.4, 12.5, 12.6.
 */
export function convertFieldDisplay(
  field: FieldModel,
  display: string,
  targetUnit: string
): string {
  const parsed = parseFieldValue(field, display);
  if (parsed === null) return '';
  try {
    const converted = convert(parsed, targetUnit);
    return formatFieldValue(converted.value, targetUnit, field.step);
  } catch {
    // A unit the table cannot read leaves the text alone. The pill never
    // invents a number.
    return display;
  }
}

