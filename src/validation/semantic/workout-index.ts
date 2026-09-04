/**
 * Read-only index of the retained workouts directory plus the node helpers the result path resolver
 * needs (P5-T01).
 *
 * Authority: docs/contracts/user-data-contracts.md rows RS-05 (invariants 3-4), RS-06 (invariant 5),
 * RS-07 (invariant 6); docs/contracts/user-data-contracts.md invariant ownership summary
 * ("Invariants 23-24: compatibility gate and semantic resolver (Phases 9, 5)");
 * specs/rep-jot-json-schema-spec.md §3, §5 (Execution Path), §8.
 *
 * The index holds the retained workouts directory and the node helpers one path resolver needs. It never
 * picks the tree a path resolves in: `result-session` hands the resolver the retained workout root for a
 * terminal session (TR-05) or the session's own frozen plan root for an `in_progress` one (TR-04, Req 6.11),
 * and both roots are trees of the same node shape. Deprecated entities stay in this index and stay
 * resolvable (invariant 23 keeps published IDs present, invariant 24 keeps deprecated entities available).
 *
 * Pure and read-only: the `unknown` input is never mutated, no clock or randomness is read, and no
 * Svelte, DOM, OAuth, Drive, or IndexedDB module is imported. Duplicate workout IDs are not reported
 * here — that identity rule is WK-01, owned by the accepted static pass — so the first entry wins.
 * Deprecated workouts stay in the index: invariant 24 keeps them resolvable for historical results,
 * and no Phase 5 rule may reject a reference because a workout or exercise was later deprecated.
 */

import { REPEATED_STRATEGIES } from "./result-types";

/** One retained workout and its root node, as far as result validation needs them. */
export interface WorkoutIndexEntry {
  readonly id: string;
  /** Deprecated workouts stay resolvable for historical sessions (invariant 24). */
  readonly deprecated: boolean;
  readonly root: Record<string, unknown>;
}

/** The index of one workouts directory, plus whether the directory could be read at all. */
export interface WorkoutsSemanticIndex {
  /** False disables reference resolution rather than guessing at references. */
  readonly available: boolean;
  readonly workouts: ReadonlyMap<string, WorkoutIndexEntry>;
}

/** Whether a node repeats its children, which decides the one-based path iteration rule (RS-06). */
export type RepeatedState = "repeated" | "fixed" | "unknown";

/** The two node kinds of a workout tree plus the unreadable case. */
export type NodeKind = "container" | "exercise" | "unknown";

/** Local record test; arrays and null are not records. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read the `type` of a node; anything other than the two node types is unknown. */
export function nodeKind(node: Record<string, unknown>): NodeKind {
  const type = node["type"];
  if (type === "container") {
    return "container";
  }
  if (type === "exercise") {
    return "exercise";
  }
  return "unknown";
}

/**
 * Whether a node is a repeated container. A sequence container is `fixed`; a container whose strategy
 * cannot be read is `unknown`, so the iteration rule is not guessed for unvalidated input.
 */
export function repeatedState(node: Record<string, unknown>, kind: NodeKind): RepeatedState {
  if (kind === "exercise") {
    return "fixed";
  }
  if (kind !== "container") {
    return "unknown";
  }
  const strategy = node["strategy"];
  if (typeof strategy !== "string") {
    return "unknown";
  }
  return repeatedStateForStrategy(strategy);
}

/** Map one readable strategy to its repeat behavior; the strategy table lives in result-types. */
function repeatedStateForStrategy(strategy: string): RepeatedState {
  let i = 0;
  while (i < REPEATED_STRATEGIES.length) {
    if (REPEATED_STRATEGIES[i] === strategy) {
      return "repeated";
    }
    i += 1;
  }
  // A container with a readable strategy that never repeats is a sequence container.
  return strategy === "sequence" ? "fixed" : "unknown";
}

/** The children array of a container node, or null when it cannot be read. */
function childNodes(node: Record<string, unknown>): readonly unknown[] | null {
  const children = node["children"];
  return Array.isArray(children) ? children : null;
}

/** The first child whose `id` matches, or null. Duplicate node IDs are WK-01, reported by the static pass. */
export function findChild(node: Record<string, unknown>, nodeId: string): Record<string, unknown> | null {
  const children = childNodes(node);
  if (children === null) {
    return null;
  }
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i];
    if (isRecord(child) && child["id"] === nodeId) {
      return child;
    }
  }
  return null;
}

/** Index the retained workouts directory for result reference resolution (pure). */
export function buildWorkoutIndex(workoutsDocument: unknown): WorkoutsSemanticIndex {
  const workouts = new Map<string, WorkoutIndexEntry>();
  if (!isRecord(workoutsDocument) || !Array.isArray(workoutsDocument["workouts"])) {
    return { available: false, workouts };
  }

  const list = workoutsDocument["workouts"];
  for (let i = 0; i < list.length; i += 1) {
    const workout = list[i];
    if (!isRecord(workout) || typeof workout["id"] !== "string" || workout["id"].length === 0) {
      continue; // unstructured entries are schema- and WK-owned
    }
    const root = workout["root"];
    if (!isRecord(root)) {
      continue; // a workout without a readable root cannot resolve any path
    }
    if (workouts.has(workout["id"])) {
      continue; // first entry wins; WK-01 reports the duplicate
    }
    workouts.set(workout["id"], {
      id: workout["id"],
      deprecated: workout["deprecated"] === true,
      root
    });
  }

  return { available: true, workouts };
}

