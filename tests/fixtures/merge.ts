// Builders for the merge tests. The shapes match the v1 results and preferences
// schemas, so a merged document stays a document a validator would accept.

import type { MergeFamily } from '../../src/sync/merge-documents';

export const RESULTS: MergeFamily = 'repjot/results';
export const PREFERENCES: MergeFamily = 'repjot/preferences';

/** One exercise result for the `squat-1` node. */
export function exerciseResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    workoutId: 'full-body',
    executionPath: [{ nodeId: 'squat-1' }],
    exerciseId: 'back-squat',
    side: 'both',
    attempt: 1,
    status: 'completed',
    values: {
      reps: { value: 5, unit: 'reps' },
      weight: { value: 100, unit: 'kg' }
    },
    ...overrides
  };
}

/** One session with one exercise result and one container result. */
export function session(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    workoutId: 'full-body',
    status: 'completed',
    startedAtUtc: '2026-08-15T07:30:00Z',
    completedAtUtc: '2026-08-15T08:00:00Z',
    updatedAtUtc: '2026-08-15T08:00:00Z',
    exerciseResults: {
      'squat-1|both|1': exerciseResult()
    },
    containerResults: {
      'root|1': {
        workoutId: 'full-body',
        executionPath: [{ nodeId: 'root' }],
        attempt: 1,
        status: 'completed',
        score: { type: 'cycles', completedCycles: 1 }
      }
    },
    ...overrides
  };
}

/** One monthly results shard holding the given sessions. */
export function resultsShard(
  sessions: Record<string, Record<string, unknown>>,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    format: 'repjot/results',
    schemaVersion: 1,
    yearMonthUtc: '2026-08',
    sessions,
    ...overrides
  };
}

/** Results shard with sessions `a` and `b`. */
export function baseShard(): Record<string, unknown> {
  return resultsShard({ a: session('a'), b: session('b') });
}

/** One preferences document. */
export function preferencesDoc(
  exerciseUnits: Record<string, Record<string, string>>,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    format: 'repjot/preferences',
    schemaVersion: 1,
    revision: 3,
    updatedAtUtc: '2026-08-15T07:30:00Z',
    exerciseUnits,
    ...overrides
  };
}

/** Preferences document with one squat mapping. */
export function basePreferences(): Record<string, unknown> {
  return preferencesDoc({ 'back-squat': { weight: 'kg' } });
}

/** Deep copy a JSON value. The same helper the merge uses. */
export { clone } from '../../src/sync/patcher';

/**
 * Every leaf path in a JSON value.
 *
 * A leaf path ends at a value that is not a plain object or an array. The merge
 * property test uses these paths to prove the merged document holds no value that
 * came from nowhere.
 */
export function leafPaths(
  value: unknown,
  prefix: string[] = [],
  out: string[][] = []
): string[][] {
  if (Array.isArray(value)) {
    // An array is one value to the merge. Its indexes are not merge paths.
    out.push(prefix);
    return out;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 0) {
      out.push(prefix);
      return out;
    }
    for (const key of keys) leafPaths(record[key], prefix.concat(key), out);
    return out;
  }
  out.push(prefix);
  return out;
}

/** True when a value exists at the path. */
export function hasAt(root: unknown, path: string[]): boolean {
  let node: unknown = root;
  for (const key of path) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) {
      return false;
    }
    if (!Object.prototype.hasOwnProperty.call(node, key)) {
      return false;
    }
    node = (node as Record<string, unknown>)[key];
  }
  return true;
}

/** Deep freeze a value so a write to it throws. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) {
      deepFreeze(inner);
    }
    Object.freeze(value);
  }
  return value;
}

/** Every object key name that appears anywhere in a JSON value. */
export function keyNames(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keyNames(item, into);
    return into;
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      into.add(key);
      keyNames(record[key], into);
    }
  }
  return into;
}
