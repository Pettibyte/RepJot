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

import type { Stimulus } from '../../domain/enums';
import type {
  CaloriesQuantity,
  ContainerNode,
  DistanceQuantity,
  DurationQuantity,
  Exercise,
  Prescription,
  Quantity,
  RepsPrescription,
  WeightQuantity,
  Workout
} from '../../domain/types';
import { resolveTree } from '../../sessions/tree-resolver';
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

/** The whole overview. */
export interface OverviewModel {
  title: string;
  notes?: string;
  nodes: OverviewNodeModel[];
}

/** The exercise directory the model needs. */
export interface OverviewExerciseIndex {
  exerciseById: Map<string, Exercise>;
}

/** Name for a container that carries none, keyed by strategy. */
const CONTAINER_FALLBACK_NAMES: Record<string, string> = {
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
function formatContainerSummary(container: ContainerNode): string {
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
function joinText(left: string, right: string): string {
  if (left === '') return right;
  if (right === '') return left;
  return `${left} · ${right}`;
}

/** The stimulus word shown beside an exercise row, such as `Strength`. */
function stimulusLabel(stimulus: Stimulus | undefined): string {
  if (stimulus === undefined) return '';
  return STIMULUS_LABELS[stimulus] ?? stimulus;
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

  const nodes: OverviewNodeModel[] = resolveTree(workout).map((resolved) => {
    const node = resolved.node;

    if (node.type !== 'exercise') {
      const baseName = node.name ?? CONTAINER_FALLBACK_NAMES[node.strategy] ?? 'Section';
      // A repeated container emits one row per iteration. The first row carries
      // the container's own name; a later row says which round it is, so the
      // page reads `Cindy`, then `Round 2`, instead of the same heading over
      // and over with nothing to tell them apart.
      const label =
        resolved.iteration !== undefined && resolved.iteration > 1
          ? `Round ${resolved.iteration}`
          : baseName;
      // The round count belongs on the heading that opens the block, not on
      // every round inside it.
      const summary =
        resolved.iteration !== undefined && resolved.iteration > 1 ? '' : formatContainerSummary(node);
      return {
        label,
        depth: resolved.level,
        prescriptionText: summary,
        isExercise: false
      };
    }

    const exercise = staticData.exerciseById.get(node.exerciseId);
    // The stimulus rides on the prescription line so a row reads as one fact:
    // what to do and what it trains. A row with no numbers shows the stimulus
    // alone rather than an empty field.
    const prescriptionText = joinText(
      formatPrescription(resolved.effectivePrescription),
      stimulusLabel(node.stimulus)
    );

    if (exercise === undefined) {
      // A missing directory entry falls back to the raw ID so the row still
      // names what it refers to.
      return {
        label: node.exerciseId,
        depth: resolved.level,
        prescriptionText,
        isExercise: true,
        unresolved: true
      };
    }

    return {
      label: exercise.name,
      depth: resolved.level,
      prescriptionText,
      isExercise: true,
      exerciseHref: formatRoute({ name: 'exercise-history', exerciseId: node.exerciseId })
    };
  });

  const model: OverviewModel = { title: workout.name, nodes };
  if (workout.notes !== undefined) model.notes = workout.notes;
  return model;
}
