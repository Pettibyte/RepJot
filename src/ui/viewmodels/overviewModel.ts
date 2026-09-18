// The workout overview view model.
// REQUIREMENTS section 16, PHASE-16.
//
// The overview shows the programmed tree read-only, before the user starts. The
// tree is resolved here so the screen draws a flat list of rows and knows
// nothing about containers, repetition, or overrides.
//
// `resolveTree` expands a repeated container into one node per iteration and
// applies each iteration's overrides, so an override shows as the effective
// value on that iteration's row. REQUIREMENTS 19.2.

import type { SetType, Stimulus } from '../../domain/enums';
import type {
  CaloriesQuantity,
  ContainerNode,
  DistanceQuantity,
  DurationQuantity,
  Exercise,
  ExerciseNode,
  Prescription,
  Quantity,
  RepsPrescription,
  WeightQuantity,
  Workout
} from '../../domain/types';
import { resolveTree } from '../../sessions/tree-resolver';
import { encodePath, type PathSegment } from '../../domain/execution-path';
import { unitLabel } from '../../units/format';
import { formatEditable } from '../../units/conversion';
import { formatRoute } from '../../routing/routes';

/** One row of the read-only tree. */
export interface OverviewNodeModel {
  /** Container name, or the exercise name from the directory. */
  label: string;
  /** 1 for the workout root, 2 for its children, and so on. */
  depth: number;
  /** Rendered prescription, for example `~8 reps @ 135 lb to failure`. */
  prescriptionText: string;
  isExercise: boolean;
  /** Set on an exercise row when the directory holds the exercise. */
  exerciseHref?: string;
  /**
   * True when the node names an exercise the bundle does not hold.
   *
   * The row stays and reads as a data error, so one stale reference cannot
   * hide the rest of the workout. REQUIREMENTS 15.6.
   */
  unresolved?: boolean;
}

/**
 * One read-only set row.
 *
 * `nodeId` is the programmed node's id. The matrix needs it: two nodes can
 * name the same exercise, and a line keyed by the name would merge them.
 */
export type OverviewSetRow = OverviewNodeModel & {
  setNumber: number;
  nodeId: string;
};

/** One round inside a compact read-only set list. */
export interface OverviewSetRound {
  key: string;
  /** The round divider, for example `Round 2`. Empty when nothing needs telling apart. */
  label: string;
  rows: OverviewSetRow[];
}

/** One set column in a read-only circuit matrix. */
export interface OverviewSetColumn {
  key: string;
  label: string;
  setNumber: number;
}

/** One exercise line across the read-only set columns. */
export interface OverviewSetMatrixRow {
  key: string;
  label: string;
  /** The prescription this exercise asks for, read from its first cell. */
  prescriptionText: string;
  /** Cells aligned to `OverviewSetMatrix.columns` by index. */
  cells: Array<{ key: string; prescriptionText: string }>;
}

/** The exercise-by-set grid a read-only circuit renders as. */
export interface OverviewSetMatrix {
  columns: OverviewSetColumn[];
  rows: OverviewSetMatrixRow[];
}

/**
 * One compact read-only set list.
 *
 * A single-exercise block reads as that exercise's set list. A circuit
 * block reads as a matrix: one exercise per row, one set per column, so
 * the exercise name and its prescription are stated once per row.
 */
export interface OverviewSetTable {
  key: string;
  title: string;
  sectionTitle: string;
  label: string;
  depth: number;
  /** True when each round holds more than one exercise. */
  multiExercise: boolean;
  /** The table body. The rounds are the source of truth for the rows. */
  rounds: OverviewSetRound[];
  /** Every row in draw order. Derived from `rounds`; never set apart from it. */
  rows: OverviewSetRow[];
  /** The exercise-by-set grid. Present only when `multiExercise` is true. */
  matrix?: OverviewSetMatrix;
}

/**
 * Turn round-grouped read-only rows into the exercise-by-set grid.
 *
 * Exercise order comes from the first round, so the matrix keeps the order
 * the workout programmed.
 */
function buildOverviewMatrix(rounds: OverviewSetRound[]): OverviewSetMatrix {
  const columns: OverviewSetColumn[] = rounds.map((round, index) => ({
    key: round.key,
    label: `Set ${round.rows[0]?.setNumber ?? index + 1}`,
    setNumber: round.rows[0]?.setNumber ?? index + 1
  }));

  const order: string[] = [];
  for (const row of rounds[0]?.rows ?? []) {
    if (!order.includes(row.nodeId)) order.push(row.nodeId);
  }

  const rows: OverviewSetMatrixRow[] = order.map((nodeId) => {
    const firstRound = rounds
      .flatMap((round) => round.rows)
      .find((row) => row.nodeId === nodeId);
    const base = firstRound?.prescriptionText ?? '';
    return {
      key: nodeId,
      label: firstRound?.label ?? '',
      prescriptionText: base,
      cells: rounds.map((round) => {
        const row = round.rows.find((candidate) => candidate.nodeId === nodeId);
        return {
          key: `${nodeId}@${round.key}`,
          prescriptionText: row?.prescriptionText ?? ''
        };
      })
    };
  });

  return { columns, rows };
}

/** One visual block in the semantic overview document. */
export type OverviewBlock =
  | { kind: 'group'; node: OverviewNodeModel; sectionTitle?: string }
  | { kind: 'exercise'; node: OverviewNodeModel }
  | { kind: 'set-table'; table: OverviewSetTable };

/** The whole overview. */
export interface OverviewModel {
  title: string;
  notes?: string;
  /** Kept as the complete resolved tree for callers that inspect its shape. */
  nodes: OverviewNodeModel[];
  /** Semantic presentation with repeated sets collapsed. */
  blocks: OverviewBlock[];
}

/** The exercise directory the model needs. */
export interface OverviewExerciseIndex {
  exerciseById: Map<string, Exercise>;
}

/** Name for a container that carries none, keyed by strategy. */
export const CONTAINER_FALLBACK_NAMES: Record<string, string> = {
  sequence: 'Sequence',
  rounds: 'Rounds',
  amrap: 'AMRAP',
  emom: 'EMOM',
  complex: 'Complex'
};

/** Display word for a stimulus, so the enum value never reaches the page raw. */
const STIMULUS_LABELS: Record<string, string> = {
  strength: 'Strength',
  hypertrophy: 'Hypertrophy',
  power: 'Power',
  conditioning: 'Conditioning',
  mobility: 'Mobility'
};

/**
 * A quantity on a read-only line.
 *
 * `formatQuantity` keeps one decimal because an editable field must show the
 * digit the user types into. A programmed prescription is never edited here, so
 * a whole number drops its trailing `.0`: `225 lb`, not `225.0 lb`.
 */
function formatReadQuantity(q: Quantity): string {
  const text = formatEditable(q);
  const trimmed = text.endsWith('.0') ? text.slice(0, -2) : text;
  return `${trimmed} ${unitLabel(q.unit)}`;
}

/** `8`, `~8`, or `5-8`. */
function formatReps(reps: RepsPrescription): string {
  if (typeof reps === 'number') return `${reps}`;
  if ('target' in reps) return `~${reps.target}`;
  return `${reps.min}-${reps.max}`;
}

/** A duration in seconds, read as whole minutes when it divides cleanly. */
function formatDurationValue(seconds: number): string {
  if (seconds >= 60 && seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds} s`;
}

/** A duration quantity, in seconds or minutes as it was written. */
function formatDuration(duration: DurationQuantity): string {
  if (duration.unit === 'second' && Number.isInteger(duration.value)) {
    return formatDurationValue(duration.value);
  }
  return formatReadQuantity(duration);
}

/**
 * The prescription for one exercise occurrence, as one line of text.
 *
 * The order is the order a user reads a set: the work, then the load, then the
 * effort. Each part is present only when the prescription carries it, so a body
 * weight row reads `~15 reps` and a weighted row reads `5 reps @ 225 lb RIR 2`.
 */
export function formatPrescription(prescription: Prescription): string {
  const parts: string[] = [];

  if (prescription.reps !== undefined) parts.push(`${formatReps(prescription.reps)} reps`);
  if (prescription.distance !== undefined) {
    parts.push(formatReadQuantity(prescription.distance as DistanceQuantity));
  }
  if (prescription.duration !== undefined) {
    parts.push(formatDuration(prescription.duration));
  }
  if (prescription.calories !== undefined) {
    parts.push(formatReadQuantity(prescription.calories as CaloriesQuantity));
  }
  if (prescription.assistedWeight !== undefined) {
    // Assistance is written as the amount removed, so the word reads as help
    // rather than as a load the user lifts.
    parts.push(`assist ${formatReadQuantity(prescription.assistedWeight as WeightQuantity)}`);
  } else if (prescription.addedWeight !== undefined) {
    parts.push(`+${formatReadQuantity(prescription.addedWeight as WeightQuantity)}`);
  } else if (prescription.weight !== undefined) {
    parts.push(`@ ${formatReadQuantity(prescription.weight as WeightQuantity)}`);
  }

  const effort = prescription.effort;
  if (effort !== undefined) {
    if (effort.type === 'failure') parts.push('to failure');
    else if (effort.type === 'rir') parts.push(`RIR ${effort.target}`);
    else parts.push(`RPE ${effort.target}`);
  }

  // A prescription that carries only a load strategy has no visible work. The
  // empty string is correct: the row shows its label and no numbers.
  return parts.join(' ');
}

/** The container's own summary, such as `4 rounds` or `AMRAP 20 min`. */
export function formatContainerSummary(container: ContainerNode): string {
  const config = container.strategyConfig as Record<string, unknown>;

  switch (container.strategy) {
    case 'sequence':
      return '';
    case 'rounds':
      return typeof config.rounds === 'number' ? `${config.rounds} rounds` : '';
    case 'amrap': {
      const duration = config.duration;
      return isDuration(duration) ? `AMRAP ${formatDuration(duration)}` : 'AMRAP';
    }
    case 'emom': {
      const cycles = config.cycles;
      const interval = config.interval;
      const text = isDuration(interval) ? formatDuration(interval) : '';
      return typeof cycles === 'number' && text !== '' ? `EMOM ${cycles} x ${text}` : 'EMOM';
    }
    case 'complex':
      return typeof config.cycles === 'number' ? `${config.cycles} cycles` : '';
    default:
      return '';
  }
}

/** Narrow an unknown `strategyConfig` member to a duration quantity. */
function isDuration(value: unknown): value is DurationQuantity {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Quantity).value === 'number' &&
    ((value as DurationQuantity).unit === 'second' || (value as DurationQuantity).unit === 'minute')
  );
}

/** Join two text parts without leaving a leading or trailing space. */
export function joinText(left: string, right: string): string {
  if (left === '') return right;
  if (right === '') return left;
  return `${left} · ${right}`;
}

/** The stimulus word shown beside an exercise row, such as `Strength`. */
export function stimulusLabel(stimulus: Stimulus | undefined): string {
  if (stimulus === undefined) return '';
  return STIMULUS_LABELS[stimulus] ?? stimulus;
}

/** Shared semantic section names for Active Workout and Workout Overview. */
export function workoutSectionLabel(
  setType: SetType | undefined,
  stimulus: Stimulus | undefined
): string {
  if (setType === 'warmup' || stimulus === 'mobility') return 'Warmup';
  if (stimulus === 'conditioning') return 'Conditioning';
  return 'Strength';
}

function withoutLastIteration(path: PathSegment[]): PathSegment[] {
  const copy = path.map((segment) => ({ ...segment }));
  const last = copy[copy.length - 1];
  if (last !== undefined) delete last.iteration;
  return copy;
}

/**
 * Build the overview model.
 *
 * Returns null when the workout is absent, so the caller shows a not-found
 * state instead of an empty screen. The caller resolves the ID; this function
 * only shapes what it is given.
 */
export function buildOverviewModel(
  workout: Workout | undefined | null,
  staticData: OverviewExerciseIndex
): OverviewModel | null {
  if (workout === undefined || workout === null) return null;

  const nodeById = new Map<string, ContainerNode | ExerciseNode>();
  const indexNode = (node: ContainerNode | ExerciseNode): void => {
    nodeById.set(node.id, node);
    if (node.type === 'container') {
      for (const child of node.children) indexNode(child);
    }
  };
  indexNode(workout.root);

  interface RawOverviewNode {
    model: OverviewNodeModel;
    path: PathSegment[];
    source: ContainerNode | ExerciseNode;
    setScope?: string;
    setNumber?: number;
  }

  const raw: RawOverviewNode[] = resolveTree(workout).map((resolved): RawOverviewNode => {
    const node = resolved.node;
    if (node.type !== 'exercise') {
      const baseName = node.name ?? CONTAINER_FALLBACK_NAMES[node.strategy] ?? 'Section';
      const label =
        resolved.iteration !== undefined && resolved.iteration > 1
          ? `Round ${resolved.iteration}`
          : baseName;
      const summary =
        resolved.iteration !== undefined && resolved.iteration > 1 ? '' : formatContainerSummary(node);
      return {
        model: { label, depth: resolved.level, prescriptionText: summary, isExercise: false },
        path: resolved.path,
        source: node
      };
    }

    const exercise = staticData.exerciseById.get(node.exerciseId);
    const prescriptionText = joinText(
      formatPrescription(resolved.effectivePrescription),
      stimulusLabel(node.stimulus)
    );
    const model: OverviewNodeModel = exercise === undefined
      ? {
          label: node.exerciseId,
          depth: resolved.level,
          prescriptionText,
          isExercise: true,
          unresolved: true
        }
      : {
          label: exercise.name,
          depth: resolved.level,
          prescriptionText,
          isExercise: true,
          exerciseHref: formatRoute({ name: 'exercise-history', exerciseId: node.exerciseId })
        };

    const parentSegment = resolved.path[resolved.path.length - 2];
    const parent = parentSegment === undefined ? undefined : nodeById.get(parentSegment.nodeId);
    // A repeated block collapses when the parent repeats its children and
    // every direct child is an exercise. A parent that also holds a nested
    // container would split that round across two renderers, and a scored
    // parent owns a score that belongs on its own heading.
    const repeatedRound =
      parent?.type === 'container' &&
      parent.strategy === 'rounds' &&
      parent.resultCapture === undefined &&
      parent.children.length > 0 &&
      parent.children.every((child) => child.type === 'exercise');
    if (!repeatedRound) return { model, path: resolved.path, source: node };

    const parentPath = resolved.path.slice(0, -1);
    return {
      model,
      path: resolved.path,
      source: node,
      setScope: encodePath(withoutLastIteration(parentPath)),
      setNumber: parentSegment?.iteration ?? 1
    };
  });

  const nodes = raw.map((entry) => entry.model);
  const tableRows = new Map<string, RawOverviewNode[]>();
  for (const entry of raw) {
    if (entry.setScope === undefined) continue;
    const bucket = tableRows.get(entry.setScope);
    if (bucket === undefined) tableRows.set(entry.setScope, [entry]);
    else bucket.push(entry);
  }

  const blocks: OverviewBlock[] = [];
  const emittedTables = new Set<string>();
  for (const entry of raw) {
    if (entry.source.type === 'container') {
      const scope = encodePath(withoutLastIteration(entry.path));
      const rows = tableRows.get(scope);
      if (rows !== undefined) {
        if (!emittedTables.has(scope)) {
          emittedTables.add(scope);
          const first = rows[0];
          const exercise = first?.source.type === 'exercise' ? first.source : undefined;
          // The set number is the round number, so one round per distinct
          // set number keeps the programmed order.
          const byRound = new Map<number, RawOverviewNode[]>();
          for (const row of rows) {
            const set = row.setNumber ?? 1;
            const bucket = byRound.get(set);
            if (bucket === undefined) byRound.set(set, [row]);
            else bucket.push(row);
          }
          const rounds: OverviewSetRound[] = [...byRound.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([set, roundRows], index) => ({
              key: `${scope}#round-${index + 1}`,
              label: `Round ${set}`,
              rows: roundRows.map((row) => ({
                ...row.model,
                setNumber: row.setNumber ?? set,
                nodeId: row.source.id
              }))
            }));
          const tableRowsFlat = rounds.flatMap((round) => round.rows);
          const multiExercise = (rounds[0]?.rows.length ?? 0) > 1;
          // A divider only earns its place inside a circuit that has rounds
          // to tell apart. A single-exercise table already orders its rows
          // with `Set N`, and one round has nothing to separate.
          if (!multiExercise || rounds.length === 1) {
            rounds.forEach((round) => (round.label = ''));
          }
          const containerName =
            entry.source.name ?? CONTAINER_FALLBACK_NAMES[entry.source.strategy] ?? 'Section';

          if (first !== undefined && exercise !== undefined) {
            blocks.push({
              kind: 'set-table',
              table: {
                key: scope,
                title: multiExercise ? containerName : first.model.label,
                sectionTitle: workoutSectionLabel(exercise.setType, exercise.stimulus),
                label: exercise.setType === 'warmup' ? 'Warmup sets' : 'Working sets',
                depth: entry.model.depth,
                multiExercise,
                rounds,
                rows: tableRowsFlat,
                ...(multiExercise ? { matrix: buildOverviewMatrix(rounds) } : {})
              }
            });
          }
        }
        continue;
      }

      const isGenericRoot =
        entry.model.depth === 1 &&
        entry.source.strategy === 'sequence' &&
        entry.source.name === undefined;
      if (isGenericRoot) continue;

      const parentPath = encodePath(entry.path);
      const directExercises = raw.filter((candidate) =>
        candidate.source.type === 'exercise' &&
        encodePath(candidate.path.slice(0, -1)) === parentPath
      );
      const firstExercise = directExercises[0]?.source;
      const sectionTitle = firstExercise?.type === 'exercise'
        ? workoutSectionLabel(firstExercise.setType, firstExercise.stimulus)
        : undefined;
      blocks.push({
        kind: 'group',
        node: entry.model,
        sectionTitle:
          sectionTitle !== undefined && sectionTitle.toLowerCase() !== entry.model.label.toLowerCase()
            ? sectionTitle
            : undefined
      });
      continue;
    }

    if (entry.setScope === undefined) blocks.push({ kind: 'exercise', node: entry.model });
  }

  const model: OverviewModel = { title: workout.name, nodes, blocks };
  if (workout.notes !== undefined) model.notes = workout.notes;
  return model;
}
