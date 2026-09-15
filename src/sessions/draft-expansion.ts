// Turn an aggregate-only container score into a draft child set. Phase 14.
// REQUIREMENTS 10.14, 10.15, 10.16.
//
// The user recorded one number for a whole container. **Expand detail** asks
// for the child rows behind it. This module builds those rows as drafts:
//
//   value = the current prescription for that leaf at that iteration
//   inferred = true
//
// A draft is a starting point the screen labels `Inferred`, never a recorded
// actual. The score cannot establish load, unit, side, or deviation from
// prescription, so nothing here invents them. REQUIREMENT 10.15.
//
// Nothing persists in this file. The caller saves each draft, and only then
// does the child set become authoritative. REQUIREMENTS 10.16, 10.17.

import type { Exercise, ContainerNode, Score } from '../domain/types';
import type { LoadedStaticData } from '../documents/static-loader';
import type { PathSegment } from '../domain/execution-path';
import { applyIterationOverrides } from './tree-resolver';
import type { ExerciseResultDraft } from './drafts';

/** One inferred draft child, tagged so the screen renders the `Inferred` label. */
export interface DraftChild {
  draft: ExerciseResultDraft;
  /** Always `true`. A draft from this module is never a recorded actual. */
  inferred: true;
}

/** The prescription fields a draft may carry. */
const VALUE_FIELDS = [
  'weight',
  'addedWeight',
  'assistedWeight',
  'distance',
  'duration',
  'calories'
] as const;

type ExerciseNodeLike = Extract<import('../domain/types').WorkoutNode, { type: 'exercise' }>;

/** The reps target for one leaf at one iteration, as a whole number. */
function repsValue(node: ExerciseNodeLike, iteration: number): number | undefined {
  const reps = applyIterationOverrides(node.prescription, iteration).reps;
  if (reps === undefined) return undefined;
  if (typeof reps === 'number') return reps;
  if ('target' in reps) return reps.target;
  if ('min' in reps) return reps.min;
  return undefined;
}

/**
 * Build one draft for one leaf at one iteration.
 *
 * The draft carries the prescribed values with their prescribed units. A
 * dimension the exercise does not measure is skipped, because the exercise
 * directory, not the prescription, decides what can be recorded.
 */
function draftForLeaf(
  container: ContainerNode,
  leaf: ExerciseNodeLike,
  path: PathSegment[],
  iteration: number,
  reps: number | undefined,
  staticData: LoadedStaticData
): ExerciseResultDraft | null {
  const exercise: Exercise | undefined = staticData.exerciseById.get(leaf.exerciseId);
  if (exercise === undefined) return null;

  const measured = new Set<string>(exercise.measurements.map((support) => support.dimension));
  const effective = applyIterationOverrides(leaf.prescription, iteration);

  const values: Record<string, { value: number; unit: string }> = {};
  if (reps !== undefined && measured.has('reps')) {
    values.reps = { value: reps, unit: 'reps' };
  }
  for (const field of VALUE_FIELDS) {
    if (!measured.has(field)) continue;
    const quantity = effective[field];
    if (quantity === undefined) continue;
    values[field] = { value: quantity.value, unit: quantity.unit };
  }

  // A draft with no value at all is not a draft. The screen would render an
  // empty inferred row, which reads as a bug rather than as missing work.
  if (Object.keys(values).length === 0) return null;

  return {
    workoutId: '',
    exerciseId: leaf.exerciseId,
    executionPath: path,
    attempt: 1,
    status: 'completed',
    values: values as ExerciseResultDraft['values']
  };
}

/** Every exercise leaf under a container's direct child, in tree order. */
function leavesOf(node: ContainerNode | ExerciseNodeLike): ExerciseNodeLike[] {
  if (node.type === 'exercise') return [node];
  const out: ExerciseNodeLike[] = [];
  for (const child of node.children) out.push(...leavesOf(child));
  return out;
}

/**
 * Expand an aggregate score into the draft child set.
 *
 * `containerPath` is the container's own path, with no iteration on its last
 * segment, which is how a container result is keyed. Each draft, however,
 * carries the iteration on that same segment, because that is how a child of a
 * repeated container is stored: `root/cindy:2/pushups`. REQUIREMENT 10.8.
 *
 * A `nonstandard` score has no derivation to expand, so the answer is an empty
 * list. The screen keeps showing **Detailed** instead.
 */
export function expandAggregateToDraft(
  container: ContainerNode,
  score: Score,
  staticData: LoadedStaticData,
  containerPath: PathSegment[] = [{ nodeId: container.id }]
): DraftChild[] {
  if (score.type === 'nonstandard') return [];

  const above = containerPath.slice(0, -1);

  /**
   * The path of one child at one iteration.
   *
   * The container segment carries the iteration, and the child's own position
   * below it is appended unchanged.
   */
  const pathFor = (child: ContainerNode | ExerciseNodeLike, iteration: number): PathSegment[] => [
    ...above,
    { nodeId: container.id, iteration },
    { nodeId: child.id }
  ];

  const drafts: ExerciseResultDraft[] = [];

  if (score.type === 'cycles') {
    for (let iteration = 1; iteration <= score.completedCycles; iteration += 1) {
      for (const child of container.children) {
        const childPath = pathFor(child, iteration);
        for (const leaf of leavesOf(child)) {
          const leafPath = child.id === leaf.id ? childPath : [...childPath, { nodeId: leaf.id }];
          const draft = draftForLeaf(
            container,
            leaf,
            leafPath,
            iteration,
            repsValue(leaf, iteration),
            staticData
          );
          if (draft !== null) drafts.push(draft);
        }
      }
    }
    return drafts.map((draft) => ({ draft, inferred: true as const }));
  }

  if (score.type === 'intervals') {
    const childCount = Math.max(container.children.length, 1);
    for (let index = 0; index < score.completedIntervals; index += 1) {
      const iteration = Math.floor(index / childCount) + 1;
      const position = index % childCount;
      const child = container.children[position];
      if (child === undefined) continue;
      const childPath = pathFor(child, iteration);
      for (const leaf of leavesOf(child)) {
        const leafPath = child.id === leaf.id ? childPath : [...childPath, { nodeId: leaf.id }];
        const draft = draftForLeaf(
          container,
          leaf,
          leafPath,
          iteration,
          repsValue(leaf, iteration),
          staticData
        );
        if (draft !== null) drafts.push(draft);
      }
    }
    return drafts.map((draft) => ({ draft, inferred: true as const }));
  }

  // `rounds_and_reps`: full rounds at prescription, then the partial round.
  for (let iteration = 1; iteration <= score.completedRounds; iteration += 1) {
    for (const child of container.children) {
      const childPath = pathFor(child, iteration);
      for (const leaf of leavesOf(child)) {
        const leafPath = child.id === leaf.id ? childPath : [...childPath, { nodeId: leaf.id }];
        const draft = draftForLeaf(
          container,
          leaf,
          leafPath,
          iteration,
          repsValue(leaf, iteration),
          staticData
        );
        if (draft !== null) drafts.push(draft);
      }
    }
  }

  if (score.additionalReps > 0 && container.children.length > 0) {
    const iteration = score.completedRounds + 1;
    let remaining = score.additionalReps;
    for (const child of container.children) {
      if (remaining <= 0) continue;
      const childPath = pathFor(child, iteration);
      for (const leaf of leavesOf(child)) {
        if (remaining <= 0) continue;
        const prescribed = repsValue(leaf, iteration);
        const take = prescribed === undefined ? remaining : Math.min(remaining, prescribed);
        const leafPath = child.id === leaf.id ? childPath : [...childPath, { nodeId: leaf.id }];
        const draft = draftForLeaf(container, leaf, leafPath, iteration, take, staticData);
        if (draft !== null) {
          drafts.push(draft);
          remaining -= take;
        }
      }
    }
  }

  return drafts.map((draft) => ({ draft, inferred: true as const }));
}
