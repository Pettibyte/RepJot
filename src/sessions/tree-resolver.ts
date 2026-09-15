// Resolve a workout tree into the ordered, editable view a session needs.
// Phase 14. REQUIREMENTS 10.2, 10.3, 10.8, 11.17, 11.18, 19.1, 19.2.
//
// A session stores no plan. Every load walks the current bundle and lays the
// recorded results over that walk, so a deploy that changes the workout changes
// what the editor shows. REP JOT accepts that risk. ARCHITECTURE §9.
//
// Three rules shape this file.
//
// 1. One node per execution occurrence. A repeated container expands into one
//    entry per iteration, and each entry carries the iteration on its own path
//    segment. A child of round 2 of an outer round therefore reads
//    `root/outer:2/inner:1/...`, which is the shape the composite result key
//    already encodes. REQUIREMENT 10.8.
// 2. The effective prescription is the top-level fields plus this iteration's
//    overrides, and an override replaces only the field it names.
//    REQUIREMENTS 10.2, 10.3.
// 3. An AMRAP has no fixed cycle count, so the walk emits its first cycle only.
//    Later cycles come from saved results and from `addAmrapRound`, which
//    extends the occurrence list at save time.
//
// The walk is preorder, so the returned order is the prescriptive order the
// editor renders. No sort runs after it. REQUIREMENT 3.20.

import type {
  ContainerNode,
  ExerciseNode,
  IterationPrescription,
  Prescription,
  Session,
  ExerciseResult,
  Workout,
  WorkoutNode
} from '../domain/types';
import { encodePath, type PathSegment } from '../domain/execution-path';

/** One editable occurrence of one workout node. */
export interface ResolvedNode {
  node: WorkoutNode;
  /** Path from the workout root through this occurrence, inclusive. */
  path: PathSegment[];
  /** Iteration of this occurrence. `undefined` for a non-repeated container. */
  iteration?: number;
  /** Top-level fields plus this iteration's overrides. */
  effectivePrescription: Prescription;
  /** 1 for the root, 2 for its children, and so on. Styling depth. */
  level: number;
  /**
   * Named path to this occurrence, for example `Strength / Complex / Round 2`.
   *
   * A container contributes its name, and a repeated container contributes
   * `Round <iteration>` right after it. An exercise node contributes nothing
   * of its own, so the label reads as the path the row sits under.
   * REQUIREMENT 19.2.
   */
  compactPathLabel: string;
}

/** Strategies that repeat their children. A sequence runs once. */
function isRepeated(container: ContainerNode): boolean {
  return container.strategy !== 'sequence';
}

/** How many times a container runs. An AMRAP has no fixed ceiling. */
export function iterationCount(container: ContainerNode): number {
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
 * Top-level prescription fields plus this iteration's overrides.
 *
 * The override object replaces only the keys it carries. `iterations` never
 * survives into the effective prescription, because it is the override table
 * itself, not a programmed value. REQUIREMENTS 10.2, 10.3.
 */
export function applyIterationOverrides(
  prescription: Prescription,
  iteration: number
): Prescription {
  const effective: Prescription = { ...prescription };
  delete effective.iterations;

  const override: IterationPrescription | undefined = prescription.iterations?.find(
    (entry: IterationPrescription): boolean => entry.iteration === iteration
  );
  if (override === undefined) return effective;

  for (const [field, value] of Object.entries(override)) {
    if (field === 'iteration') continue;
    if (value === undefined) continue;
    (effective as Record<string, unknown>)[field] = value;
  }
  return effective;
}

/** The name a container contributes to the compact path label. */
function containerLabel(container: ContainerNode): string {
  return container.name ?? container.id;
}

/**
 * Build the compact path label for one occurrence.
 *
 * `labelParts` carries the parts already produced by the ancestors. The
 * occurrence adds its own container name and, when repeated, its round marker.
 * An exercise node adds nothing, so its label is the path above it.
 */
function buildLabel(labelParts: string[], node: WorkoutNode, iteration: number | undefined): string {
  const parts = [...labelParts];
  if (node.type === 'container') {
    parts.push(containerLabel(node));
    if (isRepeated(node) && iteration !== undefined) {
      parts.push(`Round ${iteration}`);
    }
  }
  return parts.join(' / ');
}

/** The occurrences a container runs. An AMRAP yields its first cycle only. */
function occurrences(container: ContainerNode): number[] {
  const total = iterationCount(container);
  if (!Number.isFinite(total)) return [1];
  const safeTotal = total < 1 ? 1 : total;
  const list: number[] = [];
  for (let index = 1; index <= safeTotal; index += 1) list.push(index);
  return list;
}

/**
 * Walk the workout tree into the ordered editable view.
 *
 * Preorder, so a container appears before its children and the list reads top
 * to bottom the way the screen renders it.
 */
export function resolveTree(workout: Workout): ResolvedNode[] {
  const nodes: ResolvedNode[] = [];

  const walk = (
    node: WorkoutNode,
    path: PathSegment[],
    labelParts: string[],
    level: number,
    iteration: number | undefined,
    overrideIteration: number
  ): void => {
    const label = buildLabel(labelParts, node, iteration);
    const effective =
      node.type === 'exercise'
        ? applyIterationOverrides(node.prescription, overrideIteration)
        : {};

    nodes.push({
      node,
      path,
      iteration,
      effectivePrescription: effective,
      level,
      compactPathLabel: label
    });

    if (node.type === 'exercise') return;

    const nextLabelParts = label.split(' / ').filter((part: string): boolean => part.length > 0);
    for (const child of node.children) {
      if (child.type === 'container' && isRepeated(child)) {
        for (const childIteration of occurrences(child)) {
          walk(
            child,
            [...path, { nodeId: child.id, iteration: childIteration }],
            nextLabelParts,
            level + 1,
            childIteration,
            childIteration
          );
        }
        continue;
      }
      // A child that does not repeat inherits the iteration of the nearest
      // repeated ancestor, because that is the iteration its own `iterations`
      // overrides select against. Passing `undefined` here would resolve every
      // occurrence of a repeated container to the first cycle's prescription.
      walk(child, [...path, { nodeId: child.id }], nextLabelParts, level + 1, undefined, overrideIteration);
    }
  };

  /**
   * Seed the walk with one occurrence of the root.
   *
   * A repeated root expands the same way a repeated child does: one walk per
   * cycle, with the cycle number on the root's own path segment. Without this
   * the root resolves once with no iteration, so a workout whose root is `emom`
   * or `complex` shows one cycle instead of the cycles it prescribes, and the
   * `iterations` overrides below it never select. The shipped bundle holds two
   * such workouts, `emom-conditioning` and `kb-complex`.
   * REQUIREMENTS 10.2, 10.3, 10.8.
   */
  const root = workout.root;
  if (root.type === 'container' && isRepeated(root)) {
    for (const rootIteration of occurrences(root)) {
      walk(root, [{ nodeId: root.id, iteration: rootIteration }], [], 1, rootIteration, rootIteration);
    }
    return nodes;
  }

  walk(workout.root, [{ nodeId: workout.root.id }], [], 1, undefined, 1);
  return nodes;
}

/**
 * Lay the session's recorded results over the resolved tree.
 *
 * Keys are the composite `exerciseResults` map keys, so a caller reads the
 * overlay with the same key builder the store uses. REQUIREMENT 22.4.9.
 *
 * `nodes` sets the order, not the content. Results that match a resolved node
 * come first in tree order, and results whose path no longer resolves come last
 * instead of disappearing. One bad reference never drops recorded work.
 * REQUIREMENTS 6.10, 11.17.
 */
export function overlayResults(
  nodes: ResolvedNode[],
  session: Session
): Map<string, ExerciseResult> {
  const entries = Object.entries(session.exerciseResults);

  // Bucket the recorded results by their encoded path, so a tree walk can pick
  // up the results that sit on each resolved node without rescanning the map.
  const byEncodedPath = new Map<string, Array<[string, ExerciseResult]>>();
  for (const entry of entries) {
    const result = entry[1];
    if (!Array.isArray(result.executionPath)) continue;
    const encoded = encodePath(result.executionPath);
    const bucket = byEncodedPath.get(encoded);
    if (bucket === undefined) {
      byEncodedPath.set(encoded, [entry]);
      continue;
    }
    bucket.push(entry);
  }

  const overlay = new Map<string, ExerciseResult>();
  const claimed = new Set<string>();

  const take = (encoded: string): void => {
    const bucket = byEncodedPath.get(encoded);
    if (bucket === undefined) return;
    for (const [key, result] of bucket) {
      if (claimed.has(key)) continue;
      claimed.add(key);
      overlay.set(key, result);
    }
  };

  for (const node of nodes) {
    take(encodePath(node.path));
  }

  // Anything the tree no longer reaches keeps its stored order at the tail.
  for (const [key, result] of entries) {
    if (claimed.has(key)) continue;
    claimed.add(key);
    overlay.set(key, result);
  }

  return overlay;
}

/**
 * True when some scored container above `path` records its score with no child
 * detail. The exercises under it record no separate result, so a view that
 * counts recorded work must skip them. REQUIREMENTS 10.10, 10.13.
 */
export function isUnderNoChildDetail(workout: Workout, path: PathSegment[]): boolean {
  for (let depth = 1; depth < path.length; depth += 1) {
    let current: WorkoutNode = workout.root;
    let ok = true;
    for (let index = 1; index < depth; index += 1) {
      if (current.type !== 'container') {
        ok = false;
        break;
      }
      const found: WorkoutNode | undefined = current.children.find(
        (candidate: WorkoutNode): boolean => candidate.id === path[index]?.nodeId
      );
      if (found === undefined) {
        ok = false;
        break;
      }
      current = found;
    }
    if (!ok) continue;
    if (current.type === 'container' && current.resultCapture?.childDetail === 'none') return true;
  }
  return false;
}

