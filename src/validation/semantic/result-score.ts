/**
 * Pure score and child-detail validation for result shards (P6-T01).
 *
 * Authority: user-data-contracts RS-12/RS-13; temporal-and-omission-contracts TR-02/TR-12;
 * requirements 10.10-10.17; schema specification sections 3, 5, and 8; and the approved D-01
 * Option A decision. This module reads only stored results, the lifecycle-selected workout tree,
 * and recorded `deprecated` skips. It never infers an omission from an absent result.
 *
 * The helper functions are deliberately independent of browser, UI, persistence, and transport code.
 * The validator does not write or normalize input. Diagnostics contain fixed text and JSON Pointers only.
 */

import { buildWorkoutIndex, findChild, isRecord, nodeKind } from "./workout-index";
import { finalizeDiagnostics, joinPointer } from "./types";
import { makeResultDiagnostic, type ResultSemanticDiagnostic, type ResultSemanticResult } from "./result-types";

export interface CyclesScore {
  readonly type: "cycles";
  readonly completedCycles: number;
}

export interface RoundsAndRepsScore {
  readonly type: "rounds_and_reps";
  readonly completedRounds: number;
  readonly additionalReps: number;
}

export interface IntervalsScore {
  readonly type: "intervals";
  readonly completedIntervals: number;
  readonly totalIntervals: number;
}

export interface NonstandardScore {
  readonly type: "nonstandard";
}

export type Score = CyclesScore | RoundsAndRepsScore | IntervalsScore | NonstandardScore;
export type ScoreType = "cycles" | "rounds_and_reps" | "intervals";

/** Separate structural and measured-score completeness. They must not be collapsed into one boolean. */
export interface ScoreDetailCompleteness {
  readonly hasDetail: boolean;
  readonly structuralComplete: boolean;
  readonly scoreComplete: boolean;
}

/** Pure result of score derivation from complete ordered detail. */
export interface ScoreDerivation {
  readonly score: Score | null;
  readonly completeness: ScoreDetailCompleteness;
}

interface PathSegment {
  readonly nodeId: string;
  readonly iteration?: number;
}

interface DetailGroup {
  readonly results: ReadonlyMap<string, Record<string, unknown>>;
  readonly orderedResults: readonly Record<string, unknown>[];
  readonly structuralComplete: boolean;
  readonly scoreComplete: boolean;
}

interface ExpectedOccurrence {
  readonly path: readonly PathSegment[];
  readonly directChildId: string;
  readonly targetReps: number | null;
}

interface AnalyzedGroup {
  readonly detail: DetailGroup;
  readonly expected: readonly ExpectedOccurrence[];
}

interface DetailAnalysis {
  readonly detail: ScoreDetailCompleteness;
  readonly derived: Score | null;
  readonly progressionValid: boolean;
  readonly groups: readonly AnalyzedGroup[];
}

interface ContainerRecord {
  readonly result: Record<string, unknown>;
  readonly index: number;
  readonly path: readonly PathSegment[];
}

interface OmissionAncestor {
  readonly node: Record<string, unknown>;
  readonly path: readonly PathSegment[];
}

function push(list: ResultSemanticDiagnostic[], code: Parameters<typeof makeResultDiagnostic>[0], path: string): void {
  list.push(makeResultDiagnostic(code, path));
}

function readPath(value: unknown): PathSegment[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const path: PathSegment[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item["nodeId"] !== "string" || item["nodeId"].length === 0) {
      return null;
    }
    const hasIteration = Object.prototype.hasOwnProperty.call(item, "iteration");
    const iteration = item["iteration"];
    if (hasIteration && (typeof iteration !== "number" || !Number.isInteger(iteration) || iteration < 1)) {
      return null;
    }
    if (!hasOnlyKeys(item, hasIteration ? ["nodeId", "iteration"] : ["nodeId"])) {
      return null;
    }
    const segment: PathSegment = { nodeId: item["nodeId"] };
    if (typeof iteration === "number") {
      (segment as { nodeId: string; iteration: number }).iteration = iteration;
    }
    path.push(segment);
  }
  return path;
}

function pathKey(path: readonly PathSegment[]): string {
  const parts: string[] = [];
  for (const segment of path) {
    parts.push(segment.nodeId + ":" + (segment.iteration === undefined ? "*" : String(segment.iteration)));
  }
  return parts.join("\u0000");
}

/** A container path without an iteration is a wildcard for its observed execution blocks. */
function pathMatchesPrefix(parent: readonly PathSegment[], child: readonly PathSegment[]): boolean {
  if (parent.length > child.length) {
    return false;
  }
  for (let i = 0; i < parent.length; i += 1) {
    if (parent[i].nodeId !== child[i].nodeId) {
      return false;
    }
    if (parent[i].iteration !== undefined && parent[i].iteration !== child[i].iteration) {
      return false;
    }
  }
  return true;
}

function pathsEquivalent(left: readonly PathSegment[], right: readonly PathSegment[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let i = 0; i < left.length; i += 1) {
    if (left[i].nodeId !== right[i].nodeId) {
      return false;
    }
    if (left[i].iteration !== undefined && right[i].iteration !== undefined && left[i].iteration !== right[i].iteration) {
      return false;
    }
  }
  return true;
}

/** Resolve a path by node identity. Path shape and iteration diagnostics remain Phase 5's responsibility. */
function nodeAtPath(root: Record<string, unknown>, path: readonly PathSegment[]): Record<string, unknown> | null {
  if (path.length === 0 || root["id"] !== path[0].nodeId) {
    return null;
  }
  let current = root;
  for (let i = 1; i < path.length; i += 1) {
    const child = findChild(current, path[i].nodeId);
    if (child === null) {
      return null;
    }
    current = child;
  }
  return current;
}

function scoreTypeOf(node: Record<string, unknown>): ScoreType | null {
  const capture = node["resultCapture"];
  if (!isRecord(capture)) {
    return null;
  }
  const value = capture["scoreType"];
  return value === "cycles" || value === "rounds_and_reps" || value === "intervals" ? value : null;
}

function childDetailOf(node: Record<string, unknown>): string | null {
  const capture = node["resultCapture"];
  if (!isRecord(capture) || typeof capture["childDetail"] !== "string") {
    return null;
  }
  return capture["childDetail"];
}

function finiteCount(node: Record<string, unknown>, scoreType: ScoreType): number | null {
  const config = node["strategyConfig"];
  if (!isRecord(config)) {
    return null;
  }
  const key = scoreType === "cycles" || scoreType === "intervals" ? "cycles" : "rounds";
  const value = config[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/** Collect every leaf ID below a scored ancestor without recursion. */
function leafIds(root: Record<string, unknown>): string[] {
  const result: string[] = [];
  const pending: Record<string, unknown>[] = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) {
      break;
    }
    const kind = nodeKind(node);
    if (kind === "exercise") {
      if (typeof node["id"] === "string" && node["id"].length > 0) {
        result.push(node["id"]);
      }
      continue;
    }
    if (kind !== "container" || !Array.isArray(node["children"])) {
      continue;
    }
    const children = node["children"];
    for (let i = children.length - 1; i >= 0; i -= 1) {
      if (isRecord(children[i])) {
        pending.push(children[i]);
      }
    }
  }
  return result;
}

function readReps(result: Record<string, unknown>): number | null {
  const values = result["values"];
  if (!isRecord(values)) {
    return null;
  }
  const reps = values["reps"];
  return typeof reps === "number" && Number.isInteger(reps) && reps >= 0 ? reps : null;
}

function repeatedCount(node: Record<string, unknown>): number | null {
  const strategy = node["strategy"];
  const config = node["strategyConfig"];
  if (typeof strategy !== "string" || !isRecord(config)) {
    return null;
  }
  const field = strategy === "rounds" ? "rounds" : strategy === "emom" || strategy === "complex" ? "cycles" : null;
  if (field === null) {
    return null;
  }
  const value = config[field];
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

/** Read the exact repetition prescription for the nearest repeated occurrence. */
function prescribedReps(node: Record<string, unknown>, iteration: number): number | null {
  const prescription = node["prescription"];
  if (!isRecord(prescription)) {
    return null;
  }
  let value = prescription["reps"];
  const overrides = prescription["iterations"];
  if (Array.isArray(overrides)) {
    for (const item of overrides) {
      if (isRecord(item) && item["iteration"] === iteration && item["reps"] !== undefined) {
        value = item["reps"];
      }
    }
  }
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function exactPathPrefix(parent: readonly PathSegment[], child: readonly PathSegment[]): boolean {
  if (parent.length > child.length) {
    return false;
  }
  for (let i = 0; i < parent.length; i += 1) {
    if (parent[i].nodeId !== child[i].nodeId || (parent[i].iteration !== undefined && parent[i].iteration !== child[i].iteration)) {
      return false;
    }
  }
  return true;
}

function observedIterations(
  nodePath: readonly PathSegment[],
  paths: readonly (readonly PathSegment[])[]
): number[] {
  const values: number[] = [];
  for (const path of paths) {
    if (!exactPathPrefix(nodePath, path)) {
      continue;
    }
    const segment = path[nodePath.length - 1];
    if (segment !== undefined && segment.nodeId === nodePath[nodePath.length - 1].nodeId && segment.iteration !== undefined && values.indexOf(segment.iteration) === -1) {
      values.push(segment.iteration);
    }
  }
  return values.sort((left, right) => left - right);
}

function contiguousFromOne(values: readonly number[]): boolean {
  if (values.length === 0) {
    return false;
  }
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] !== i + 1) {
      return false;
    }
  }
  return true;
}

/**
 * Flatten one container occurrence into its leaf occurrences without recursion.
 *
 * Detail is the only source of unbounded AMRAP cardinality. For configured finite
 * repetition, stop after one more leaf than the observed detail can contain. That
 * streamed cardinality check proves incompleteness without materializing a large
 * configured execution plan.
 */
function flattenOccurrences(
  node: Record<string, unknown>,
  nodePath: readonly PathSegment[],
  nearestIteration: number,
  observedPaths: readonly (readonly PathSegment[])[],
  directChildId: string,
  output: ExpectedOccurrence[]
): boolean {
  interface NodeTask {
    readonly kind: "node";
    readonly node: Record<string, unknown>;
    readonly nodePath: readonly PathSegment[];
    readonly nearestIteration: number;
    readonly directChildId: string;
  }
  interface RepeatedTask {
    readonly kind: "repeated";
    readonly node: Record<string, unknown>;
    readonly nodePath: readonly PathSegment[];
    readonly nearestIteration: number;
    readonly directChildId: string;
    readonly count: number;
    readonly iteration: number;
  }
  type Task = NodeTask | RepeatedTask;

  const pending: Task[] = [{ kind: "node", node, nodePath, nearestIteration, directChildId }];
  const outputLimit = observedPaths.length + 1;
  let valid = true;
  while (pending.length > 0) {
    const task = pending.pop() as Task;
    if (task.kind === "repeated") {
      if (task.iteration > task.count) {
        continue;
      }
      pending.push({
        kind: "repeated",
        node: task.node,
        nodePath: task.nodePath,
        nearestIteration: task.nearestIteration,
        directChildId: task.directChildId,
        count: task.count,
        iteration: task.iteration + 1
      });
      const children = task.node["children"];
      if (!Array.isArray(children) || children.length === 0) {
        valid = false;
        continue;
      }
      const iterationPath = task.nodePath.slice(0, task.nodePath.length - 1).concat([{ nodeId: task.node["id"] as string, iteration: task.iteration }]);
      for (let i = children.length - 1; i >= 0; i -= 1) {
        const child = children[i];
        if (!isRecord(child) || typeof child["id"] !== "string") {
          valid = false;
          continue;
        }
        pending.push({
          kind: "node",
          node: child,
          nodePath: iterationPath.concat([{ nodeId: child["id"] }]),
          nearestIteration: task.iteration,
          directChildId: task.directChildId
        });
      }
      continue;
    }

    const kind = nodeKind(task.node);
    if (kind === "exercise") {
      output.push({ path: task.nodePath, directChildId: task.directChildId, targetReps: prescribedReps(task.node, task.nearestIteration) });
      if (output.length >= outputLimit) {
        return false;
      }
      continue;
    }
    if (kind !== "container" || !Array.isArray(task.node["children"])) {
      valid = false;
      continue;
    }
    const children = task.node["children"];
    const strategy = task.node["strategy"];
    if (strategy === "sequence") {
      for (let i = children.length - 1; i >= 0; i -= 1) {
        const child = children[i];
        if (!isRecord(child) || typeof child["id"] !== "string") {
          valid = false;
          continue;
        }
        pending.push({
          kind: "node",
          node: child,
          nodePath: task.nodePath.concat([{ nodeId: child["id"] }]),
          nearestIteration: task.nearestIteration,
          directChildId: task.directChildId
        });
      }
      continue;
    }

    const count = repeatedCount(task.node);
    if (count !== null) {
      pending.push({
        kind: "repeated",
        node: task.node,
        nodePath: task.nodePath,
        nearestIteration: task.nearestIteration,
        directChildId: task.directChildId,
        count,
        iteration: 1
      });
      continue;
    }

    if (strategy === "amrap") {
      const iterations = observedIterations(task.nodePath, observedPaths);
      if (!contiguousFromOne(iterations)) {
        valid = false;
        continue;
      }
      for (let i = iterations.length - 1; i >= 0; i -= 1) {
        const iteration = iterations[i];
        const iterationPath = task.nodePath.slice(0, task.nodePath.length - 1).concat([{ nodeId: task.node["id"] as string, iteration }]);
        for (let j = children.length - 1; j >= 0; j -= 1) {
          const child = children[j];
          if (!isRecord(child) || typeof child["id"] !== "string") {
            valid = false;
            continue;
          }
          pending.push({
            kind: "node",
            node: child,
            nodePath: iterationPath.concat([{ nodeId: child["id"] }]),
            nearestIteration: iteration,
            directChildId: task.directChildId
          });
        }
      }
      continue;
    }
    valid = false;
  }
  return valid;
}

function flattenContainerChildren(
  container: Record<string, unknown>,
  basePath: readonly PathSegment[],
  nearestIteration: number,
  observedPaths: readonly (readonly PathSegment[])[]
): { readonly occurrences: readonly ExpectedOccurrence[]; readonly valid: boolean } {
  const output: ExpectedOccurrence[] = [];
  const children = container["children"];
  if (!Array.isArray(children)) {
    return { occurrences: output, valid: false };
  }
  let valid = true;
  for (const child of children) {
    if (!isRecord(child) || typeof child["id"] !== "string") {
      valid = false;
      continue;
    }
    valid = flattenOccurrences(child, basePath.concat([{ nodeId: child["id"] }]), nearestIteration, observedPaths, child["id"], output) && valid;
  }
  return { occurrences: output, valid };
}

function makeAnalyzedGroup(
  entries: readonly { readonly result: Record<string, unknown>; readonly path: readonly PathSegment[] }[],
  occurrences: readonly ExpectedOccurrence[],
  flattenedValid: boolean,
  rejectUnexpectedPaths: boolean
): AnalyzedGroup {
  const byPath = new Map<string, Record<string, unknown>>();
  let duplicate = false;
  for (const entry of entries) {
    const keyForPath = pathKey(entry.path);
    if (byPath.has(keyForPath)) {
      duplicate = true;
    } else {
      byPath.set(keyForPath, entry.result);
    }
  }
  let complete = flattenedValid && occurrences.length > 0 && !duplicate;
  const expectedPaths = new Set<string>();
  for (const occurrence of occurrences) {
    const key = pathKey(occurrence.path);
    expectedPaths.add(key);
    if (!byPath.has(key)) {
      complete = false;
    }
  }
  const expectedLeafIds = new Set<string>();
  for (const occurrence of occurrences) {
    expectedLeafIds.add(occurrence.path[occurrence.path.length - 1].nodeId);
  }
  for (const [key, result] of byPath) {
    if (expectedPaths.has(key)) {
      continue;
    }
    const path = readPath(result["executionPath"]);
    if (rejectUnexpectedPaths || (path !== null && expectedLeafIds.has(path[path.length - 1].nodeId))) {
      complete = false;
    }
  }
  let allCompleted = complete;
  for (const occurrence of occurrences) {
    const result = byPath.get(pathKey(occurrence.path));
    if (result === undefined || result["status"] !== "completed") {
      allCompleted = false;
    }
  }
  return {
    detail: { results: byPath, orderedResults: [], structuralComplete: complete, scoreComplete: allCompleted },
    expected: occurrences
  };
}

/**
 * Derive the standard score from ordered child detail. A partial final rounds-and-reps block contributes its
 * observed repetitions; a partial block after another partial block is not valid ordered progression.
 */
export function deriveScoreFromDetail(
  scoreType: ScoreType,
  groups: readonly (readonly Record<string, unknown>[])[],
  expectedLeafIds: readonly string[],
  configuredTotal: number | null
): ScoreDerivation {
  const detailGroups: DetailGroup[] = [];
  let anyDetail = groups.length > 0;
  let structuralComplete = true;
  let scoreComplete = true;
  for (let i = 0; i < groups.length; i += 1) {
    const source = groups[i];
    const byPath = new Map<string, Record<string, unknown>>();
    const byLeaf = new Map<string, { readonly key: string; readonly result: Record<string, unknown> }[]>();
    let duplicatePath = false;
    for (const result of source) {
      const path = readPath(result["executionPath"]);
      if (path === null) {
        continue;
      }
      const key = pathKey(path);
      if (byPath.has(key)) {
        duplicatePath = true;
        continue;
      }
      byPath.set(key, result);
      const leaf = path[path.length - 1].nodeId;
      const matches = byLeaf.get(leaf);
      if (matches === undefined) {
        byLeaf.set(leaf, [{ key, result }]);
      } else {
        matches.push({ key, result });
      }
    }
    let groupStructural = !duplicatePath;
    let groupScore = true;
    const orderedResults: Record<string, unknown>[] = [];
    const usedPaths = new Set<string>();
    for (const leafId of expectedLeafIds) {
      const matches = byLeaf.get(leafId);
      let match: { readonly key: string; readonly result: Record<string, unknown> } | undefined;
      if (matches !== undefined) {
        for (const candidate of matches) {
          if (!usedPaths.has(candidate.key)) {
            match = candidate;
            break;
          }
        }
      }
      if (match === undefined) {
        groupStructural = false;
        groupScore = false;
        continue;
      }
      usedPaths.add(match.key);
      orderedResults.push(match.result);
      if (match.result["status"] !== "completed") {
        groupScore = false;
      }
      if (scoreType === "rounds_and_reps" && readReps(match.result) === null) {
        groupScore = false;
      }
    }
    for (const [key, result] of byPath) {
      if (usedPaths.has(key)) {
        continue;
      }
      const path = readPath(result["executionPath"]);
      if (path !== null && expectedLeafIds.indexOf(path[path.length - 1].nodeId) !== -1) {
        groupStructural = false;
      }
    }
    if (!groupStructural) {
      structuralComplete = false;
    }
    if (!groupScore) {
      scoreComplete = false;
    }
    detailGroups.push({ results: byPath, orderedResults, structuralComplete: groupStructural, scoreComplete: groupScore });
  }

  const completeness: ScoreDetailCompleteness = { hasDetail: anyDetail, structuralComplete, scoreComplete };
  if (!anyDetail || !structuralComplete) {
    return { score: null, completeness };
  }

  if (scoreType === "rounds_and_reps") {
    let completedRounds = 0;
    let additionalReps = 0;
    let partialSeen = false;
    for (const group of detailGroups) {
      if (group.scoreComplete && !partialSeen) {
        completedRounds += 1;
        continue;
      }
      if (partialSeen) {
        return { score: null, completeness };
      }
      partialSeen = true;
      for (const result of group.orderedResults) {
        const reps = readReps(result);
        if (reps === null || result["status"] === "skipped") {
          return { score: null, completeness };
        }
        additionalReps += reps;
      }
    }
    return { score: { type: "rounds_and_reps", completedRounds, additionalReps }, completeness };
  }

  let completed = 0;
  for (const group of detailGroups) {
    if (!group.scoreComplete) {
      return { score: null, completeness };
    }
    completed += 1;
  }
  if (scoreType === "cycles") {
    return { score: { type: "cycles", completedCycles: completed }, completeness };
  }
  if (configuredTotal === null) {
    return { score: null, completeness };
  }
  return { score: { type: "intervals", completedIntervals: completed, totalIntervals: configuredTotal }, completeness };
}

/** Compare only the fields belonging to a recognized score shape. */
export function deriveRoundsAndRepsScore(
  groups: readonly (readonly Record<string, unknown>[])[],
  expectedLeafIds: readonly string[]
): RoundsAndRepsScore | null {
  const result = deriveScoreFromDetail("rounds_and_reps", groups, expectedLeafIds, null);
  return result.score !== null && result.score.type === "rounds_and_reps" ? result.score : null;
}

export function deriveCyclesScore(
  groups: readonly (readonly Record<string, unknown>[])[],
  expectedLeafIds: readonly string[]
): CyclesScore | null {
  const result = deriveScoreFromDetail("cycles", groups, expectedLeafIds, null);
  return result.score !== null && result.score.type === "cycles" ? result.score : null;
}

export function deriveIntervalsScore(
  groups: readonly (readonly Record<string, unknown>[])[],
  expectedLeafIds: readonly string[],
  totalIntervals: number
): IntervalsScore | null {
  const result = deriveScoreFromDetail("intervals", groups, expectedLeafIds, totalIntervals);
  return result.score !== null && result.score.type === "intervals" ? result.score : null;
}

export function scoresEqual(left: Score, right: Score): boolean {
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === "nonstandard" && right.type === "nonstandard") {
    return true;
  }
  if (left.type === "cycles" && right.type === "cycles") {
    return left.completedCycles === right.completedCycles;
  }
  if (left.type === "rounds_and_reps" && right.type === "rounds_and_reps") {
    return left.completedRounds === right.completedRounds && left.additionalReps === right.additionalReps;
  }
  if (left.type === "intervals" && right.type === "intervals") {
    return left.completedIntervals === right.completedIntervals && left.totalIntervals === right.totalIntervals;
  }
  return false;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const present = Object.keys(value);
  if (present.length !== keys.length) {
    return false;
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      return false;
    }
  }
  return true;
}

/** Read only a schema-shaped score. Schema-invalid score facts are not semantic evidence. */
function readScore(value: unknown): Score | null {
  if (!isRecord(value) || typeof value["type"] !== "string") {
    return null;
  }
  const type = value["type"];
  if (type === "nonstandard" && hasOnlyKeys(value, ["type"])) {
    return { type: "nonstandard" };
  }
  if (type === "cycles" && hasOnlyKeys(value, ["type", "completedCycles"]) &&
    typeof value["completedCycles"] === "number" && Number.isInteger(value["completedCycles"]) && value["completedCycles"] >= 0) {
    return { type: "cycles", completedCycles: value["completedCycles"] };
  }
  if (type === "rounds_and_reps" && hasOnlyKeys(value, ["type", "completedRounds", "additionalReps"]) &&
    typeof value["completedRounds"] === "number" && Number.isInteger(value["completedRounds"]) && value["completedRounds"] >= 0 &&
    typeof value["additionalReps"] === "number" && Number.isInteger(value["additionalReps"]) && value["additionalReps"] >= 0) {
    return { type: "rounds_and_reps", completedRounds: value["completedRounds"], additionalReps: value["additionalReps"] };
  }
  if (type === "intervals" && hasOnlyKeys(value, ["type", "completedIntervals", "totalIntervals"]) &&
    typeof value["completedIntervals"] === "number" && Number.isInteger(value["completedIntervals"]) && value["completedIntervals"] >= 0 &&
    typeof value["totalIntervals"] === "number" && Number.isInteger(value["totalIntervals"]) && value["totalIntervals"] >= 1) {
    return { type: "intervals", completedIntervals: value["completedIntervals"], totalIntervals: value["totalIntervals"] };
  }
  return null;
}

function roundRepetitionTotal(node: Record<string, unknown>, iteration: number): number | null {
  if (!Array.isArray(node["children"])) {
    return null;
  }
  const maximum = Number.MAX_SAFE_INTEGER;
  interface RepsProfile {
    readonly base: number;
    readonly overrides: ReadonlyMap<number, number>;
    readonly leaves: number;
  }
  interface ProfileTask {
    readonly node: Record<string, unknown>;
    readonly expanded: boolean;
  }
  function add(left: number, right: number): number | null {
    const value = left + right;
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  function multiply(left: number, right: number): number | null {
    if (left < 0 || right < 0 || left > Math.floor(maximum / Math.max(1, right))) {
      return null;
    }
    return left * right;
  }
  function valueAt(profile: RepsProfile, iteration: number): number {
    const override = profile.overrides.get(iteration);
    return override === undefined ? profile.base : override;
  }
  function combine(left: RepsProfile, right: RepsProfile): RepsProfile | null {
    const base = add(left.base, right.base);
    const leaves = add(left.leaves, right.leaves);
    if (base === null || leaves === null) {
      return null;
    }
    const keys = new Set<number>();
    for (const key of left.overrides.keys()) {
      keys.add(key);
    }
    for (const key of right.overrides.keys()) {
      keys.add(key);
    }
    const overrides = new Map<number, number>();
    for (const key of keys) {
      const value = add(valueAt(left, key), valueAt(right, key));
      if (value === null) {
        return null;
      }
      if (value !== base) {
        overrides.set(key, value);
      }
    }
    return { base, overrides, leaves };
  }
  function emptyProfile(): RepsProfile {
    return { base: 0, overrides: new Map<number, number>(), leaves: 0 };
  }

  const profiles = new Map<Record<string, unknown>, RepsProfile>();
  const pending: ProfileTask[] = [{ node, expanded: false }];
  while (pending.length > 0) {
    const task = pending.pop() as ProfileTask;
    const kind = nodeKind(task.node);
    if (!task.expanded) {
      if (kind === "exercise") {
        const prescription = task.node["prescription"];
        const reps = prescribedReps(task.node, 1);
        if (reps === null) {
          return null;
        }
        const overrides = new Map<number, number>();
        if (isRecord(prescription) && prescription["iterations"] !== undefined) {
          if (!Array.isArray(prescription["iterations"])) {
            return null;
          }
          for (const item of prescription["iterations"]) {
            if (!isRecord(item) || typeof item["iteration"] !== "number" || !Number.isInteger(item["iteration"]) || item["iteration"] < 1) {
              return null;
            }
            const override = item["reps"];
            if (override !== undefined) {
              if (typeof override !== "number" || !Number.isInteger(override) || override < 0) {
                return null;
              }
              overrides.set(item["iteration"] as number, override);
            }
          }
        }
        profiles.set(task.node, { base: reps, overrides, leaves: 1 });
        continue;
      }
      if (kind !== "container" || !Array.isArray(task.node["children"])) {
        return null;
      }
      pending.push({ node: task.node, expanded: true });
      const children = task.node["children"];
      for (let i = children.length - 1; i >= 0; i -= 1) {
        if (!isRecord(children[i])) {
          return null;
        }
        pending.push({ node: children[i], expanded: false });
      }
      continue;
    }

    const children = task.node["children"] as unknown[];
    let profile = emptyProfile();
    for (const child of children) {
      const childProfile = profiles.get(child as Record<string, unknown>);
      if (childProfile === undefined) {
        return null;
      }
      const combined = combine(profile, childProfile);
      if (combined === null) {
        return null;
      }
      profile = combined;
    }
    const strategy = task.node === node ? "sequence" : task.node["strategy"];
    if (strategy === "sequence") {
      profiles.set(task.node, profile);
      continue;
    }
    const count = repeatedCount(task.node);
    if (count === null || profile.leaves === 0) {
      return null;
    }
    const leaves = multiply(profile.leaves, count);
    const baseline = multiply(profile.base, count);
    if (leaves === null || baseline === null) {
      return null;
    }
    let total = baseline;
    for (const [iteration, value] of profile.overrides) {
      if (iteration > count) {
        continue;
      }
      const delta = value - profile.base;
      const updated = add(total, delta);
      if (updated === null) {
        return null;
      }
      total = updated;
    }
    profiles.set(task.node, { base: total, overrides: new Map<number, number>(), leaves });
  }
  const result = profiles.get(node);
  // The additional-repetition bound applies to the next round, whose prescription can
  // differ from earlier rounds through iteration overrides.
  return result === undefined || result.leaves === 0 ? null : valueAt(result, iteration);
}

function intervalTotal(node: Record<string, unknown>): number | null {
  if (node["strategy"] !== "emom" || !Array.isArray(node["children"])) {
    return null;
  }
  const cycles = repeatedCount(node);
  if (cycles === null || node["children"].length === 0 || cycles > Math.floor(Number.MAX_SAFE_INTEGER / node["children"].length)) {
    return null;
  }
  return cycles * node["children"].length;
}

function scoreBoundsValid(score: Score, node: Record<string, unknown>, configured: ScoreType): boolean {
  if (score.type !== configured) {
    return true;
  }
  if (score.type === "cycles") {
    const count = finiteCount(node, score.type);
    return Number.isInteger(score.completedCycles) && score.completedCycles >= 0 && (count === null || score.completedCycles <= count);
  }
  if (score.type === "rounds_and_reps") {
    if (!Number.isInteger(score.completedRounds) || score.completedRounds < 0 || !Number.isInteger(score.additionalReps) || score.additionalReps < 0) {
      return false;
    }
    const total = roundRepetitionTotal(node, score.completedRounds + 1);
    return total === null || (total === 0 ? score.additionalReps === 0 : score.additionalReps < total);
  }
  const total = intervalTotal(node);
  return Number.isInteger(score.completedIntervals) && score.completedIntervals >= 0 && Number.isInteger(score.totalIntervals) && score.totalIntervals >= 1 &&
    score.completedIntervals <= score.totalIntervals && (total === null || score.totalIntervals === total);
}

function sortGroupKeys(keys: readonly string[]): string[] {
  return keys.slice().sort((left, right) => {
    if (left === right) {
      return 0;
    }
    if (left === "*") {
      return -1;
    }
    if (right === "*") {
      return 1;
    }
    return Number(left) - Number(right);
  });
}

function outerProgressionIsValid(keys: readonly string[], repeated: boolean): boolean {
  if (!repeated) {
    return keys.length === 1 && keys[0] === "*";
  }
  if (keys.length === 0 || keys.indexOf("*") !== -1) {
    return false;
  }
  for (let i = 0; i < keys.length; i += 1) {
    if (Number(keys[i]) !== i + 1) {
      return false;
    }
  }
  return true;
}

function deriveAnalyzedScore(
  scoreType: ScoreType,
  groups: readonly AnalyzedGroup[],
  configuredTotal: number | null
): Score | null {
  if (groups.length === 0) {
    return null;
  }
  for (const group of groups) {
    if (!group.detail.structuralComplete) {
      return null;
    }
  }

  if (scoreType === "rounds_and_reps") {
    let completedRounds = 0;
    let additionalReps = 0;
    let partialSeen = false;
    let partialRoundTotal: number | null = null;
    for (const group of groups) {
      let groupComplete = true;
      let groupTotal = 0;
      let groupObservedReps = 0;
      for (const occurrence of group.expected) {
        if (occurrence.targetReps === null) {
          return null;
        }
        groupTotal += occurrence.targetReps;
        const result = group.detail.results.get(pathKey(occurrence.path));
        if (result === undefined) {
          return null;
        }
        const reps = readReps(result);
        if (result["status"] === "completed" && reps === occurrence.targetReps) {
          if (partialSeen) {
            return null;
          }
          groupObservedReps += reps;
          continue;
        }
        groupComplete = false;
        if (partialSeen || result["status"] === "skipped" || reps === null || reps >= occurrence.targetReps) {
          return null;
        }
        partialSeen = true;
        groupObservedReps += reps;
      }
      if (groupComplete) {
        completedRounds += 1;
      } else {
        // A partial round includes its valid completed prefix and its partial result.
        additionalReps = groupObservedReps;
        partialRoundTotal = groupTotal;
      }
    }
    // Keep the persisted representation normalized against the effective prescription of the
    // partial round, not the prescription of the first round.
    if (partialRoundTotal !== null && partialRoundTotal > 0 && additionalReps >= partialRoundTotal) {
      completedRounds += Math.floor(additionalReps / partialRoundTotal);
      additionalReps %= partialRoundTotal;
    }
    return { type: "rounds_and_reps", completedRounds, additionalReps };
  }

  if (scoreType === "cycles") {
    let completedCycles = 0;
    for (const group of groups) {
      if (!group.detail.scoreComplete) {
        return null;
      }
      completedCycles += 1;
    }
    return { type: "cycles", completedCycles };
  }

  let completedIntervals = 0;
  for (const group of groups) {
    const directChildren = new Set<string>();
    for (const occurrence of group.expected) {
      directChildren.add(occurrence.directChildId);
    }
    for (const childId of directChildren) {
      let complete = true;
      for (const occurrence of group.expected) {
        if (occurrence.directChildId !== childId) {
          continue;
        }
        const result = group.detail.results.get(pathKey(occurrence.path));
        if (result === undefined || result["status"] !== "completed") {
          complete = false;
        }
      }
      if (complete) {
        completedIntervals += 1;
      }
    }
  }
  if (configuredTotal === null) {
    return null;
  }
  return { type: "intervals", completedIntervals, totalIntervals: configuredTotal };
}

function analyzeDetail(
  containerPath: readonly PathSegment[],
  containerNode: Record<string, unknown>,
  exerciseResults: readonly Record<string, unknown>[],
  scoreType: ScoreType
): DetailAnalysis {
  const grouped = new Map<string, { readonly result: Record<string, unknown>; readonly path: readonly PathSegment[] }[]>();
  const observedPaths: (readonly PathSegment[])[] = [];
  const repeated = containerNode["strategy"] !== "sequence";
  let hasDetail = false;
  let hasDeprecatedOmission = false;
  for (const result of exerciseResults) {
    const path = readPath(result["executionPath"]);
    if (path === null || path.length <= containerPath.length || !pathMatchesPrefix(containerPath, path)) {
      continue;
    }
    hasDetail = true;
    if (result["reasonCode"] === "deprecated") {
      hasDeprecatedOmission = true;
    }
    observedPaths.push(path);
    const segment = path[containerPath.length - 1];
    const key = segment !== undefined && segment.nodeId === containerNode["id"] && segment.iteration !== undefined ? String(segment.iteration) : "*";
    const list = grouped.get(key);
    if (list === undefined) {
      grouped.set(key, [{ result, path }]);
    } else {
      list.push({ result, path });
    }
  }

  const orderedKeys = sortGroupKeys(Array.from(grouped.keys()));
  const analyzed: AnalyzedGroup[] = [];
  let structuralComplete = true;
  let scoreComplete = true;
  for (const key of orderedKeys) {
    const entries = grouped.get(key) as { readonly result: Record<string, unknown>; readonly path: readonly PathSegment[] }[];
    const paths = entries.map((entry) => entry.path);
    const nearestIteration = key === "*" ? 1 : Number(key);
    const basePath = key === "*" ? containerPath : containerPath.slice(0, containerPath.length - 1).concat([{ nodeId: containerNode["id"] as string, iteration: nearestIteration }]);

    if (containerNode["strategy"] === "emom") {
      const children = containerNode["children"];
      let cycleValid = Array.isArray(children) && children.length > 0;
      const matchedEntries = new Set<number>();
      let missingChildSeen = false;
      let observedChildCount = 0;
      if (Array.isArray(children)) {
        for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
          const child = children[childIndex];
          if (!isRecord(child) || typeof child["id"] !== "string") {
            cycleValid = false;
            continue;
          }
          const childEntries: { readonly result: Record<string, unknown>; readonly path: readonly PathSegment[] }[] = [];
          for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
            const entry = entries[entryIndex];
            const segment = entry.path[containerPath.length];
            if (segment !== undefined && segment.nodeId === child["id"]) {
              childEntries.push(entry);
              matchedEntries.add(entryIndex);
            }
          }
          if (childEntries.length === 0) {
            missingChildSeen = true;
            continue;
          }
          observedChildCount += 1;
          if (missingChildSeen) {
            // A cycle may contain only the observed ordered prefix, never a later child
            // after an omitted earlier child.
            cycleValid = false;
          }
          const childPath = basePath.concat([{ nodeId: child["id"] }]);
          const childOccurrences: ExpectedOccurrence[] = [];
          const childValid = flattenOccurrences(child, childPath, nearestIteration, childEntries.map((entry) => entry.path), child["id"], childOccurrences);
          const group = makeAnalyzedGroup(childEntries, childOccurrences, childValid, false);
          analyzed.push(group);
          if (!group.detail.structuralComplete) {
            cycleValid = false;
          }
        }
        if (observedChildCount < children.length && key !== orderedKeys[orderedKeys.length - 1]) {
          // A partial cycle is valid only when it is the final observed cycle.
          cycleValid = false;
        }
      }
      if (matchedEntries.size !== entries.length) {
        cycleValid = false;
      }
      if (!cycleValid) {
        structuralComplete = false;
        scoreComplete = false;
      }
      continue;
    }

    const flattened = flattenContainerChildren(containerNode, basePath, nearestIteration, paths);
    const group = makeAnalyzedGroup(entries, flattened.occurrences, flattened.valid, false);
    if (!group.detail.structuralComplete) {
      structuralComplete = false;
      scoreComplete = false;
    } else if (!group.detail.scoreComplete) {
      scoreComplete = false;
    }
    analyzed.push(group);
  }

  const structuralProgression = outerProgressionIsValid(orderedKeys, repeated) && analyzed.length > 0 && analyzed.every((group) => group.detail.structuralComplete);
  const configuredTotal = scoreType === "intervals" ? intervalTotal(containerNode) : null;
  const derived = structuralProgression ? deriveAnalyzedScore(scoreType, analyzed, configuredTotal) : null;
  // A deprecated skip is an approved detail-only representation. Its failure to produce a normal
  // score is handled by TR-12, not reported again as a score mismatch here.
  const progressionValid = structuralProgression && (derived !== null || hasDeprecatedOmission);
  const detail: ScoreDetailCompleteness = { hasDetail, structuralComplete: structuralComplete && hasDetail, scoreComplete: scoreComplete && hasDetail };
  return {
    detail,
    derived,
    progressionValid,
    groups: analyzed
  };
}

function resultPathPointer(sessionIndex: number, resultIndex: number, field: string): string {
  return joinPointer("/sessions", sessionIndex, "results", resultIndex, field);
}

function isResultStatus(value: unknown): boolean {
  return value === "completed" || value === "incomplete" || value === "skipped";
}

/** Container records are usable here only when their schema-owned identity and lifecycle are readable. */
function containerRecords(results: readonly unknown[]): ContainerRecord[] {
  const records: ContainerRecord[] = [];
  for (let i = 0; i < results.length; i += 1) {
    const value = results[i];
    if (!isRecord(value) || value["type"] !== "container" || typeof value["workoutId"] !== "string" || value["workoutId"].length === 0 ||
      !isResultStatus(value["status"])) {
      continue;
    }
    const path = readPath(value["executionPath"]);
    if (path !== null) {
      records.push({ result: value, index: i, path });
    }
  }
  return records;
}

function isNonNegativeFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isQuantityShape(value: unknown, units: readonly string[]): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ["value", "unit"]) || !isNonNegativeFiniteNumber(value["value"]) || typeof value["unit"] !== "string") {
    return false;
  }
  return units.indexOf(value["unit"]) !== -1;
}

/** Values used by detail are read only when their schema-owned quantity shape is readable. */
function isReadableValues(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return false;
  }
  for (const key of keys) {
    const item = value[key];
    if (key === "reps") {
      if (typeof item !== "number" || !Number.isInteger(item) || item < 0) {
        return false;
      }
    } else if (key === "weight" || key === "addedWeight" || key === "assistedWeight") {
      if (!isQuantityShape(item, ["lb", "kg"])) {
        return false;
      }
    } else if (key === "distance") {
      if (!isQuantityShape(item, ["m", "km", "ft", "mi"])) {
        return false;
      }
    } else if (key === "duration") {
      if (!isQuantityShape(item, ["second", "minute"])) {
        return false;
      }
    } else if (key === "calories") {
      if (!isQuantityShape(item, ["kcal"])) {
        return false;
      }
    } else {
      return false;
    }
  }
  return true;
}

/** Exercise detail with an unreadable discriminator, identity, path, lifecycle, or values is schema-owned input. */
function isReadableExerciseRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && value["type"] === "exercise" && typeof value["workoutId"] === "string" && value["workoutId"].length > 0 &&
    typeof value["exerciseId"] === "string" && value["exerciseId"].length > 0 && isResultStatus(value["status"]) &&
    (value["status"] !== "skipped" || value["values"] === undefined) && isReadableValues(value["values"]) && readPath(value["executionPath"]) !== null;
}

function exerciseRecords(results: readonly unknown[]): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  for (const value of results) {
    if (isReadableExerciseRecord(value)) {
      records.push(value);
    }
  }
  return records;
}

/**
 * An exercise result is detail for every scored ancestor on its path, even when no result was
 * recorded for that ancestor. Keep the existing container-level check for ancestors that do have
 * a result; this pass covers the missing-result case without producing a second diagnostic for the
 * same persisted detail.
 */
function validateUnrepresentedAncestorDetail(
  root: Record<string, unknown>,
  sessionIndex: number,
  results: readonly unknown[],
  containers: readonly ContainerRecord[],
  diagnostics: ResultSemanticDiagnostic[]
): void {
  for (let i = 0; i < results.length; i += 1) {
    const value = results[i];
    if (!isReadableExerciseRecord(value)) {
      continue;
    }
    const path = readPath(value["executionPath"]);
    if (path === null) {
      continue;
    }
    const ancestors = omissionAncestors(root, path, false);
    for (const ancestor of ancestors) {
      if (scoreTypeOf(ancestor.node) === null || childDetailOf(ancestor.node) !== "none") {
        continue;
      }
      const represented = containers.some((entry) => pathsEquivalent(entry.path, ancestor.path));
      if (!represented) {
        push(diagnostics, "container-detail-forbidden", resultPathPointer(sessionIndex, i, "executionPath"));
      }
    }
  }
}

function isTimedOrScored(node: Record<string, unknown>): boolean {
  return scoreTypeOf(node) !== null || node["strategy"] === "amrap" || node["strategy"] === "emom";
}

function omissionAncestors(
  root: Record<string, unknown>,
  path: readonly PathSegment[],
  includeTerminal: boolean
): OmissionAncestor[] {
  if (path.length < 2 || root["id"] !== path[0].nodeId) {
    return [];
  }
  const lastIndex = includeTerminal ? path.length - 1 : path.length - 2;
  const ancestors: OmissionAncestor[] = [{ node: root, path: path.slice(0, 1) }];
  let current = root;
  for (let i = 1; i <= lastIndex; i += 1) {
    const child = findChild(current, path[i].nodeId);
    if (child === null) {
      return [];
    }
    current = child;
    if (nodeKind(current) === "container") {
      ancestors.push({ node: current, path: path.slice(0, i + 1) });
    }
  }
  return ancestors;
}

function hasExecutableChild(node: Record<string, unknown>): boolean {
  const pending: Record<string, unknown>[] = [];
  if (Array.isArray(node["children"])) {
    for (const child of node["children"]) {
      if (isRecord(child)) {
        pending.push(child);
      }
    }
  }
  while (pending.length > 0) {
    const item = pending.pop();
    if (item === undefined) {
      break;
    }
    if (nodeKind(item) === "exercise") {
      return true;
    }
    if (Array.isArray(item["children"])) {
      for (const child of item["children"]) {
        if (isRecord(child)) {
          pending.push(child);
        }
      }
    }
  }
  return false;
}

function isDeprecatedEmptyContainerSkip(
  session: Record<string, unknown>,
  result: Record<string, unknown>,
  node: Record<string, unknown>,
  detail: DetailAnalysis
): boolean {
  return session["status"] === "in_progress" &&
    isRecord(session["executionPlan"]) &&
    result["status"] === "skipped" &&
    result["reasonCode"] === "deprecated" &&
    result["score"] === undefined &&
    !detail.detail.hasDetail &&
    childDetailOf(node) === "required" &&
    isTimedOrScored(node) &&
    Array.isArray(node["children"]) &&
    !hasExecutableChild(node);
}

function validateOmissions(
  session: Record<string, unknown>,
  sessionIndex: number,
  root: Record<string, unknown>,
  results: readonly unknown[],
  diagnostics: ResultSemanticDiagnostic[]
): void {
  const containers = containerRecords(results);
  for (let i = 0; i < results.length; i += 1) {
    const omission = results[i];
    const readableOmission = (isReadableExerciseRecord(omission) && omission["status"] === "skipped" && omission["values"] === undefined) ||
      (isRecord(omission) && omission["type"] === "container" && typeof omission["workoutId"] === "string" && omission["workoutId"].length > 0 &&
        omission["status"] === "skipped" && omission["score"] === undefined && readPath(omission["executionPath"]) !== null);
    if (!readableOmission || !isRecord(omission) || omission["status"] !== "skipped" || omission["reasonCode"] !== "deprecated") {
      continue;
    }
    const omissionPath = readPath(omission["executionPath"]);
    if (omissionPath === null) {
      continue;
    }
    // TR-02 writers normally retain one exercise skip per omitted leaf. An emptied scored/timed
    // container may instead be represented by its persisted skipped container result, which is also
    // approved omission evidence in D-01. The terminal container itself is included only for that form.
    const ancestors = omissionAncestors(root, omissionPath, omission["type"] === "container");
    for (const ancestor of ancestors) {
      if (!isTimedOrScored(ancestor.node)) {
        continue;
      }
      const matching = containers.filter((entry) => pathsEquivalent(entry.path, ancestor.path));
      const scoreType = scoreTypeOf(ancestor.node);
      for (const entry of matching) {
        if (scoreType !== null && entry.result["score"] !== undefined) {
          const score = readScore(entry.result["score"]);
          if (score !== null && score.type !== "nonstandard") {
            push(diagnostics, "deprecated-omission-aggregate-forbidden", resultPathPointer(sessionIndex, entry.index, "score"));
          }
        }
      }
      // Only an active plan can prove that an affected container became empty. A terminal current tree is
      // intentionally not used to infer what existed at its historical start (D-01 Option A).
      if (session["status"] === "in_progress" && !hasExecutableChild(ancestor.node)) {
        let validSkippedContainer = false;
        for (const entry of matching) {
          if (entry.result["status"] === "skipped" && entry.result["reasonCode"] === "deprecated" && entry.result["score"] === undefined) {
            validSkippedContainer = true;
          }
        }
        if (!validSkippedContainer) {
          push(diagnostics, "deprecated-omission-empty-container-required", joinPointer("/sessions", sessionIndex, "results"));
        }
      }
    }
  }
}

/** Validate score contracts and detail completeness for one result shard. */
export function validateResultScores(shardDocument: unknown, workoutsDocument: unknown): ResultSemanticResult {
  const diagnostics: ResultSemanticDiagnostic[] = [];
  if (!isRecord(shardDocument) || !Array.isArray(shardDocument["sessions"])) {
    const diagnostic = makeResultDiagnostic("results-document-unstructured", "");
    return { valid: false, diagnostics: [diagnostic] };
  }
  const workoutIndex = buildWorkoutIndex(workoutsDocument);
  if (!workoutIndex.available) {
    return { valid: true, diagnostics: [] };
  }
  const sessions = shardDocument["sessions"];
  for (let s = 0; s < sessions.length; s += 1) {
    const session = sessions[s];
    if (!isRecord(session) || !Array.isArray(session["results"])) {
      continue;
    }
    const status = session["status"];
    if (status !== "in_progress" && status !== "completed" && status !== "abandoned") {
      // Lifecycle status is schema-owned. Do not let an unknown lifecycle select a tree or produce score facts.
      continue;
    }
    if (status === "in_progress" && !isRecord(session["executionPlan"])) {
      // TR-04 names the frozen plan as the only active-session root. A missing or non-object plan is not
      // permission to borrow the retained tree, even though Phase 5 reports the lifecycle defect separately.
      continue;
    }
    const workoutId = session["workoutId"];
    const entry = typeof workoutId === "string" ? workoutIndex.workouts.get(workoutId) : undefined;
    if (entry === undefined) {
      continue;
    }
    const root = status === "in_progress" ? session["executionPlan"] as Record<string, unknown> : entry.root;
    const results = session["results"];
    const records = containerRecords(results);
    const exerciseResults = exerciseRecords(results);
    validateUnrepresentedAncestorDetail(root, s, results, records, diagnostics);
    const seen = new Set<string>();
    for (const record of records) {
      const scoreValue = record.result["score"];
      const stored = readScore(scoreValue);
      const status = record.result["status"];
      const scoreReadable = scoreValue === undefined || stored !== null;
      // A present malformed score, or a missing score required by the container-result schema, belongs
      // to the schema gate. Neither shape failure may drive any Phase 6 score or detail fact.
      if (!scoreReadable || (status === "completed" && scoreValue === undefined)) {
        continue;
      }
      const pointer = resultPathPointer(s, record.index, "executionPath");
      const key = pathKey(record.path);
      if (seen.has(key)) {
        push(diagnostics, "container-result-duplicate", pointer);
      } else {
        seen.add(key);
      }
      const node = nodeAtPath(root, record.path);
      if (node === null) {
        continue;
      }
      const configured = scoreTypeOf(node);
      if (configured === null) {
        if (scoreValue !== undefined) {
          // A score is meaningful only when this container owns a result-capture contract. Use the
          // existing type-mismatch diagnostic because there is no configured score type to match.
          push(diagnostics, "container-score-type-mismatch", joinPointer("/sessions", s, "results", record.index, "score", "type"));
        }
        continue;
      }
      if (stored !== null && stored.type !== "nonstandard" && stored.type !== configured) {
        push(diagnostics, "container-score-type-mismatch", joinPointer("/sessions", s, "results", record.index, "score", "type"));
      } else if (stored !== null && stored.type !== "nonstandard" && !scoreBoundsValid(stored, node, configured)) {
        push(diagnostics, "container-score-bounds-invalid", resultPathPointer(s, record.index, "score"));
      }

      // Detail completeness is independent of score presence. An incomplete result may carry no score,
      // while a complete detail set still has its own structural requirement.
      const detail = analyzeDetail(record.path, node, exerciseResults, configured);
      const deprecatedEmptyContainerSkip = isDeprecatedEmptyContainerSkip(session, record.result, node, detail);
      const childDetail = childDetailOf(node);
      if (childDetail === "none" && detail.detail.hasDetail) {
        push(diagnostics, "container-detail-forbidden", pointer);
      }
      if (!deprecatedEmptyContainerSkip && childDetail === "required" && !detail.detail.hasDetail) {
        push(diagnostics, "container-detail-required", pointer);
      }
      if (detail.detail.hasDetail && !detail.detail.structuralComplete) {
        push(diagnostics, "container-detail-incomplete", pointer);
      }
      if (!deprecatedEmptyContainerSkip && stored !== null && stored.type === "nonstandard" && !detail.detail.hasDetail) {
        push(diagnostics, "container-detail-required", pointer);
      }
      if (stored !== null && stored.type === "nonstandard" && detail.detail.structuralComplete && detail.progressionValid && detail.derived !== null) {
        push(diagnostics, "container-score-mismatch", resultPathPointer(s, record.index, "score"));
      }
      if (stored !== null && stored.type !== "nonstandard" && detail.detail.structuralComplete &&
        (!detail.progressionValid || (detail.derived !== null && !scoresEqual(stored, detail.derived)))) {
        push(diagnostics, "container-score-mismatch", resultPathPointer(s, record.index, "score"));
      }
    }
    validateOmissions(session, s, root, results, diagnostics);
  }
  const finalized = finalizeDiagnostics(diagnostics);
  return { valid: finalized.length === 0, diagnostics: finalized };
}

/** Alias used by callers that name this pass after its semantic responsibility. */
export const validateScoresAndDeprecatedOmissions = validateResultScores;
