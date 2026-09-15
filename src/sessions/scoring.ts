// Container score derivation from saved child detail. Phase 14.
// REQUIREMENTS 10.12, 10.13, 10.17, 10.18. ARCHITECTURE §9 "scoring".
//
// A scored container answers two different questions, and this file answers
// both:
//
//   Aggregate-only   The user typed the score. It is stored as typed and no
//                   child detail exists. REQUIREMENT 10.13.
//   Detail-authoritative   Saved child results decide the score. Every later
//                   edit recomputes it. REQUIREMENT 10.17.
//
// When the detail cannot produce the container's own score type, the score is
// `{ type: 'nonstandard' }` and the screen shows **Detailed**. REP JOT never
// rewrites the child rows to force a score. REQUIREMENT 10.18.
//
// The derivation rules match the ones `semantic-validator.ts` compares against,
// so a score built here passes the validator that runs before the write. A
// divergence between the two is a bug in this file, not a tolerated mismatch.

import type { Exercise, ContainerNode, ExerciseResult, Score } from '../domain/types';
import type { PathSegment } from '../domain/execution-path';
import { applyIterationOverrides } from './tree-resolver';

/** One exercise node under a container, with the leaves it stands for. */
type ExerciseNodeLike = Extract<import('../domain/types').WorkoutNode, { type: 'exercise' }>;

/** One child result tagged with the container slot it fills. */
interface ChildSlot {
  /** Iteration of the container this result belongs to. One-based. */
  iteration: number;
  /** Index of the container's direct child this result sits under. Zero-based. */
  childPosition: number;
  result: ExerciseResult;
}

/** Every exercise node at or below `node`, in tree order. */
export function exerciseLeaves(node: ContainerNode | ExerciseNodeLike): ExerciseNodeLike[] {
  if (node.type === 'exercise') return [node];
  const leaves: ExerciseNodeLike[] = [];
  for (const child of node.children) {
    leaves.push(...exerciseLeaves(child));
  }
  return leaves;
}

/**
 * The container slot one child result fills.
 *
 * The container is located inside the result's own path by node ID, which is
 * unique inside one workout. The iteration rides on that segment, and the
 * direct-child position is the next segment that names one of the container's
 * own children.
 *
 * Returns `null` when the result does not pass through the container, so a
 * caller never scores a stranger's work.
 */
export function childSlotFor(
  container: ContainerNode,
  result: ExerciseResult
): ChildSlot | null {
  const path = result.executionPath;
  if (!Array.isArray(path) || path.length === 0) return null;

  const index = path.findIndex((segment: PathSegment): boolean => segment.nodeId === container.id);
  if (index === -1) return null;
  if (index === path.length - 1) return null;

  const iteration = path[index].iteration ?? 1;
  if (!Number.isInteger(iteration) || iteration < 1) return null;

  const childIds = container.children.map((child) => child.id);
  let childPosition = -1;
  for (let cursor = index + 1; cursor < path.length; cursor += 1) {
    const found = childIds.indexOf(path[cursor].nodeId);
    if (found >= 0) {
      childPosition = found;
      break;
    }
  }
  if (childPosition < 0) return null;

  return { iteration, childPosition, result };
}

/** Tag every child result with its container slot and drop the ones outside it. */
function slots(container: ContainerNode, children: ExerciseResult[]): ChildSlot[] {
  const out: ChildSlot[] = [];
  for (const result of children) {
    const slot = childSlotFor(container, result);
    if (slot !== null) out.push(slot);
  }
  return out;
}

/** Length of the contiguous run 1..N in a one-based set. */
function prefixLength(set: Set<number>): number {
  let count = 0;
  while (set.has(count + 1)) count += 1;
  return count;
}

/** Length of the contiguous run 0..N-1 in a zero-based set. */
function prefixLengthZero(set: Set<number>): number {
  let count = 0;
  while (set.has(count)) count += 1;
  return count;
}

/** How many times the container runs. An AMRAP reports `Infinity`. */
function cycleCount(container: ContainerNode): number {
  switch (container.strategy) {
    case 'rounds':
      return container.strategyConfig.rounds;
    case 'emom':
    case 'complex':
      return container.strategyConfig.cycles;
    case 'amrap':
      return Infinity;
    default:
      return 1;
  }
}

/**
 * The reps a leaf should reach at one iteration.
 *
 * Reads the effective prescription, so an `iterations` override for this round
 * decides the target. A range reads its `min`, because meeting the low end is
 * meeting the prescription. An approximate target reads its target.
 */
export function prescribedReps(node: ExerciseNodeLike, iteration: number): number | undefined {
  const effective = applyIterationOverrides(node.prescription, iteration);
  const reps = effective.reps;
  if (reps === undefined) return undefined;
  if (typeof reps === 'number') return reps;
  if ('min' in reps) return reps.min;
  if ('target' in reps) return reps.target;
  return undefined;
}

/** True when the exercise records a repetition count at all. */
export function recordsReps(exercise: Exercise | undefined): boolean {
  if (exercise === undefined) return false;
  return exercise.measurements.some(
    (support) => support.dimension === 'reps' && support.compatibleUnits.includes('reps')
  );
}

/**
 * True when `rounds_and_reps` may score this container.
 *
 * REQUIREMENT 10.12 limits the score type to a deterministic sequence of
 * repetition-based leaf exercises. A container with no leaves, or with any leaf
 * that records no repetition count, cannot hold the score, because the score
 * would promise rounds of work the tree cannot count.
 *
 * An unknown exercise is treated as non-repetition-based, so a stale reference
 * rejects rather than silently passing.
 */
export function isDeterministicRepsSequence(
  container: ContainerNode,
  exerciseById?: Map<string, Exercise>
): boolean {
  const leaves = exerciseLeaves(container);
  if (leaves.length === 0) return false;
  for (const leaf of leaves) {
    const exercise = exerciseById?.get(leaf.exerciseId);
    if (exercise === undefined) {
      // Without the directory the repetition rule cannot be proven, so the
      // sequence is not deterministic. A caller that passes no map gets the
      // prescription-only answer below.
      if (exerciseById === undefined) {
        if (prescribedReps(leaf, 1) === undefined) return false;
        continue;
      }
      return false;
    }
    if (!recordsReps(exercise)) return false;
  }
  return true;
}

/**
 * Derive the container score from saved child detail.
 *
 * `children` is the exercise-result detail recorded beneath `container`, at any
 * depth. Results that do not pass through the container are ignored.
 *
 * With no usable detail the answer is the container's own declared score type at
 * zero, so an empty container reads as no completed work rather than as a
 * broken derivation.
 */
export function deriveScore(
  container: ContainerNode,
  children: ExerciseResult[],
  exerciseById?: Map<string, Exercise>
): Score {
  const scoreType = container.resultCapture?.scoreType;
  if (scoreType === undefined) return { type: 'nonstandard' };

  const filled = slots(container, children);
  if (filled.length === 0) {
    if (scoreType === 'cycles') return { type: 'cycles', completedCycles: 0 };
    if (scoreType === 'rounds_and_reps') {
      return { type: 'rounds_and_reps', completedRounds: 0, additionalReps: 0 };
    }
    const total = cycleCount(container);
    return {
      type: 'intervals',
      completedIntervals: 0,
      totalIntervals: Number.isFinite(total) ? total * container.children.length : 0
    };
  }

  if (scoreType === 'cycles') {
    const present = new Set<number>(filled.map((entry) => entry.iteration));
    if (prefixLength(present) !== present.size) return { type: 'nonstandard' };

    const completed = new Set<number>(
      filled
        .filter((entry: ChildSlot): boolean => entry.result.status === 'completed')
        .map((entry: ChildSlot): number => entry.iteration)
    );
    return { type: 'cycles', completedCycles: prefixLength(completed) };
  }

  if (scoreType === 'intervals') {
    const childCount = container.children.length;
    const cycles = cycleCount(container);
    const total = Number.isFinite(cycles)
      ? cycles * childCount
      : Math.max(...filled.map((entry: ChildSlot): number => entry.iteration)) * childCount;

    const filledSlots = new Set<number>();
    for (const entry of filled) {
      if (entry.result.status !== 'completed') continue;
      filledSlots.add((entry.iteration - 1) * childCount + entry.childPosition);
    }
    const completedIntervals = prefixLengthZero(filledSlots);
    if (filledSlots.size !== completedIntervals) return { type: 'nonstandard' };

    return { type: 'intervals', completedIntervals, totalIntervals: total };
  }

  // `rounds_and_reps`. A non-repetition tree cannot hold this score at all.
  if (!isDeterministicRepsSequence(container, exerciseById)) {
    return { type: 'nonstandard' };
  }

  const leaves = exerciseLeaves(container);
  const repsAt = (iteration: number): number[] | null => {
    const out: number[] = [];
    for (const leaf of leaves) {
      const match = filled.find(
        (entry: ChildSlot): boolean =>
          entry.iteration === iteration &&
          entry.result.status === 'completed' &&
          coversLeaf(leaf.id, entry.result.executionPath)
      );
      if (match === undefined) return null;
      const reps = match.result.values?.reps?.value;
      if (reps === undefined) return null;
      out.push(reps);
    }
    return out;
  };

  const prescribedAt = (iteration: number): number[] | null => {
    const out: number[] = [];
    for (const leaf of leaves) {
      const prescribed = prescribedReps(leaf, iteration);
      if (prescribed === undefined) return null;
      out.push(prescribed);
    }
    return out;
  };

  let rounds = 0;
  let additionalReps = 0;
  let hasPartial = false;

  for (;;) {
    const iteration = rounds + 1;
    const prescribed = prescribedAt(iteration);
    if (prescribed === null) break;

    const actual = repsAt(iteration);
    if (actual === null) break;

    if (!actual.every((reps: number, index: number): boolean => reps >= prescribed[index])) {
      additionalReps = actual.reduce((total: number, reps: number): number => total + reps, 0);
      hasPartial = true;
      break;
    }
    rounds += 1;
  }

  // Nothing may be recorded past the partial round. A gap or a later round means
  // the detail does not follow the progression. REQUIREMENT 10.18.
  const partialIteration = rounds + 1;
  const past = filled
    .map((entry: ChildSlot): number => entry.iteration)
    .filter((iteration: number): boolean => iteration > partialIteration);
  if (past.length > 0) return { type: 'nonstandard' };
  if (hasPartial && additionalReps === 0) return { type: 'nonstandard' };

  return { type: 'rounds_and_reps', completedRounds: rounds, additionalReps };
}

/** True when `path` passes through `leafId`. */
function coversLeaf(leafId: string, path: PathSegment[]): boolean {
  return path.some((segment: PathSegment): boolean => segment.nodeId === leafId);
}

/**
 * True when the child detail follows a valid progression for this container.
 *
 * The rule is the derivation rule without the score: detail is valid when it
 * produces the container's own score type instead of `nonstandard`. A caller
 * that wants the reason calls `deriveScore` and reads the type.
 */
export function isValidProgression(
  container: ContainerNode,
  children: ExerciseResult[],
  exerciseById?: Map<string, Exercise>
): boolean {
  return deriveScore(container, children, exerciseById).type !== 'nonstandard';
}


