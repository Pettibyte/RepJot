// Three-way merge of one REP JOT logical document. Pure function: no I/O, no
// clock, no network, no shared state. REQUIREMENTS 4.9, ARCHITECTURE ADR-011.
//
// The merge takes the three copies the coordinator keeps and returns one document:
//
//   base   content at the last successful sync
//   local  this device's working document, pending edits included
//   remote latest content read from Drive
//
// The merge works on conflict units, never on raw fields. One conflict unit is one
// session for results, and one `(exerciseId, dimension)` mapping for preferences.
// REQUIREMENTS 4.7.
//
// The merge applies the remote delta to a copy of the base, then applies the local
// changes one conflict unit at a time. Unit-granular application matters: a local
// change that replaces one exercise's whole unit map must not wipe a remote edit to
// a different dimension of that exercise, because two different mappings never
// conflict. REQUIREMENTS 4.8. ARCHITECTURE section 11 states the same order:
// "It then applies local changes by conflict unit."
//
// Inside a conflicted unit the local version wins in full, because this client
// synchronizes last. No field merge, no prompt, no copy, and no new session ID.
// REQUIREMENTS 4.11, 4.13, 11.23.

import { logDiagnostic } from '../diagnostics/diagnostic-log';
import { clone, patcher } from './patcher';

/** The two document families this merge handles. */
export type MergeFamily = 'repjot/preferences' | 'repjot/results';

/** The three copies one merge needs. */
export interface MergeInput {
  family: MergeFamily;
  /** Content at last successful sync. */
  base: unknown;
  /** This device's working document. */
  local: unknown;
  /** Latest content read from Drive. */
  remote: unknown;
}

/** What one merge returns. */
export interface MergeResult {
  /** The merged document. A new value; no input is shared with it. */
  merged: unknown;
  /** False only when the local side has no delta. REQUIREMENTS 4.9 rule 6. */
  needsUpload: boolean;
  /**
   * Units both sides touched, sorted. Session IDs, or `exerciseId/dimension`.
   *
   * With no shared document base, every unit either side holds is listed. The
   * local document replaces all of them, so each one needs a record. See
   * `wholeLocalResult`.
   */
  conflictedUnits: string[];
}

/** One conflicted unit, as reported to the observer. */
export interface MergeConflictEvent {
  family: MergeFamily;
  unit: string;
}

/** Observer called once per conflicted unit. */
export type ConflictObserver = (event: MergeConflictEvent) => void;

/** Default observer: one event per conflict in the in-memory diagnostic ring. */
const recordConflict: ConflictObserver = (event) => {
  logDiagnostic({
    severity: 'info',
    code: 'sync_merge_conflict',
    context: { family: event.family, unit: event.unit }
  });
};

/** A JSON object with unknown values. */
type PlainObject = Record<string, unknown>;

/** True for a JSON object. Arrays and `null` are values, not maps. */
function isPlainObject(value: unknown): value is PlainObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Build the preferences unit key for one exercise and dimension. */
function preferenceUnit(exerciseId: string, dimension: string): string {
  return `${exerciseId}/${dimension}`;
}

/** Split a preferences unit key on the last `/`. */
function splitPreferenceUnit(unit: string): { exerciseId: string; dimension: string } {
  // The dimension is the last segment and never contains `/`, so `lastIndexOf`
  // round-trips even for an exercise ID that breaks the ID rule. REQUIREMENTS 22.4.6.
  const separator = unit.lastIndexOf('/');
  return {
    exerciseId: unit.slice(0, separator),
    dimension: unit.slice(separator + 1)
  };
}

/** Unique units, sorted, so output and diagnostics are stable. */
function sortedUnits(units: string[]): string[] {
  return Array.from(new Set(units)).sort();
}

/**
 * Result for a merge with no shared document base.
 *
 * No field-by-field merge exists, so the local document wins as the last
 * synchronizer. Every unit either side holds counts as conflicted, so the
 * diagnostic names each unit the local side replaces. A missing base is abnormal:
 * REQUIREMENTS 22.3 keeps the base copy in IndexedDB. This path never loses a
 * document without a record of it.
 */
function wholeLocalResult(
  family: MergeFamily,
  local: unknown,
  remote: unknown,
  observer: ConflictObserver
): MergeResult {
  const conflictedUnits = sortedUnits([
    ...conflictUnitsFor(family, local),
    ...conflictUnitsFor(family, remote)
  ]);
  for (const unit of conflictedUnits) {
    observer({ family, unit });
  }
  return { merged: clone(local), needsUpload: true, conflictedUnits };
}

/**
 * Every conflict unit a document holds.
 *
 * For results, the keys of the sessions map. For preferences, one key per
 * `exerciseId` and `dimension` pair. A document without the map yields no units,
 * so a caller may pass an unvalidated value.
 */
export function conflictUnitsFor(family: MergeFamily, doc: unknown): string[] {
  if (!isPlainObject(doc)) {
    return [];
  }
  if (family === 'repjot/results') {
    return isPlainObject(doc.sessions) ? Object.keys(doc.sessions) : [];
  }
  const units: string[] = [];
  if (!isPlainObject(doc.exerciseUnits)) {
    return units;
  }
  for (const exerciseId of Object.keys(doc.exerciseUnits)) {
    const dimensions = doc.exerciseUnits[exerciseId];
    if (!isPlainObject(dimensions)) {
      continue;
    }
    for (const dimension of Object.keys(dimensions)) {
      units.push(preferenceUnit(exerciseId, dimension));
    }
  }
  return units;
}

/**
 * What one delta path means for the conflict-unit namespace.
 *
 * - `unit` the path sits inside one unit, named by the path.
 * - `expand` the path names a whole map, so the units come from the map values
 *   the delta carries. A delete carries the removed map, an add carries the new
 *   map, and a replace carries both.
 * - `loose` the path sits outside the unit namespace, such as a top-level field.
 */
type UnitScope =
  | { kind: 'unit'; unit: string }
  | { kind: 'expand'; unitsIn: (value: unknown) => string[] }
  | { kind: 'loose' };

/** Session map keys. */
function sessionKeysIn(value: unknown): string[] {
  return isPlainObject(value) ? Object.keys(value) : [];
}

/** `exerciseId/dimension` pairs in one preferences map. */
function preferencePairsIn(value: unknown): string[] {
  const units: string[] = [];
  if (!isPlainObject(value)) {
    return units;
  }
  for (const exerciseId of Object.keys(value)) {
    const dimensions = value[exerciseId];
    if (!isPlainObject(dimensions)) {
      continue;
    }
    for (const dimension of Object.keys(dimensions)) {
      units.push(preferenceUnit(exerciseId, dimension));
    }
  }
  return units;
}

/** Map a delta path to its scope for one family. */
function scopeFor(family: MergeFamily, path: string[]): UnitScope {
  if (family === 'repjot/results') {
    if (path[0] !== 'sessions') {
      return { kind: 'loose' };
    }
    if (path.length >= 2) {
      return { kind: 'unit', unit: path[1] };
    }
    return { kind: 'expand', unitsIn: sessionKeysIn };
  }

  if (path[0] !== 'exerciseUnits') {
    return { kind: 'loose' };
  }
  if (path.length >= 3) {
    return { kind: 'unit', unit: preferenceUnit(path[1], path[2]) };
  }
  if (path.length === 2) {
    const exerciseId = path[1];
    return {
      kind: 'expand',
      unitsIn: (value: unknown): string[] =>
        isPlainObject(value) ? Object.keys(value).map((d) => preferenceUnit(exerciseId, d)) : []
    };
  }
  return { kind: 'expand', unitsIn: preferencePairsIn };
}

/** One delta walk: the units it touches and the paths outside the unit namespace. */
interface DeltaWalk {
  units: Set<string>;
  loosePaths: string[][];
}

/**
 * Walk a delta and classify every change.
 *
 * A delta node that is an array is one operation on the property above it, so the
 * walk stops there and classifies that property path. A delta node that is a plain
 * object is a nested object delta, so the walk descends. The `__t` marker belongs
 * to the text differ, which REP JOT does not use, and is skipped.
 */
function walkDelta(family: MergeFamily, delta: unknown): DeltaWalk {
  const walk: DeltaWalk = { units: new Set<string>(), loosePaths: [] };

  const step = (node: unknown, path: string[]): void => {
    if (Array.isArray(node)) {
      const scope = scopeFor(family, path);
      if (scope.kind === 'unit') {
        walk.units.add(scope.unit);
      } else if (scope.kind === 'expand') {
        for (const value of node) {
          for (const unit of scope.unitsIn(value)) {
            walk.units.add(unit);
          }
        }
      } else {
        walk.loosePaths.push(path);
      }
      return;
    }
    if (isPlainObject(node)) {
      for (const key of Object.keys(node)) {
        if (key === '__t') {
          continue;
        }
        step(node[key], path.concat(key));
      }
    }
  };

  step(delta, []);
  return walk;
}

/**
 * Every conflict unit a delta touches.
 *
 * A delta that changes one field of a session touches that session only. Two
 * deltas that touch different sessions have no unit in common, so they never
 * conflict. REQUIREMENTS 4.8.
 */
export function unitsTouchedBy(family: MergeFamily, delta: unknown): Set<string> {
  return walkDelta(family, delta).units;
}

/** Read a value at a path. `undefined` when any step is missing. */
function getIn(root: unknown, path: string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (!isPlainObject(node)) {
      return undefined;
    }
    node = node[key];
  }
  return node;
}

/** Write a value at a path, creating missing objects on the way down. */
function setIn(root: PlainObject, path: string[], value: unknown): void {
  let node = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    if (!isPlainObject(node[key])) {
      node[key] = {};
    }
    node = node[key] as PlainObject;
  }
  node[path[path.length - 1]] = value;
}

/** Delete the value at a path. A missing step is a no-op. */
function deleteIn(root: PlainObject, path: string[]): void {
  let node = root;
  for (let index = 0; index < path.length - 1; index += 1) {
    const next = node[path[index]];
    if (!isPlainObject(next)) {
      return;
    }
    node = next;
  }
  delete node[path[path.length - 1]];
}

/** How one family reads, writes, and removes one conflict unit in a document. */
interface UnitStore {
  /** Every unit the document holds, keyed the same way as the merge unit keys. */
  contents(doc: unknown): Map<string, unknown>;
  put(root: PlainObject, unit: string, value: unknown): void;
  remove(root: PlainObject, unit: string): void;
}

/** The results store: one unit is one entry of `sessions`. */
const resultsStore: UnitStore = {
  contents(doc: unknown): Map<string, unknown> {
    const sessions = isPlainObject(doc) ? doc.sessions : undefined;
    return isPlainObject(sessions) ? new Map(Object.entries(sessions)) : new Map();
  },
  put(root: PlainObject, unit: string, value: unknown): void {
    if (!isPlainObject(root.sessions)) {
      root.sessions = {};
    }
    (root.sessions as PlainObject)[unit] = value;
  },
  remove(root: PlainObject, unit: string): void {
    if (isPlainObject(root.sessions)) {
      delete (root.sessions as PlainObject)[unit];
    }
  }
};

/** The preferences store: one unit is one `exerciseId` and `dimension` pair. */
const preferenceStore: UnitStore = {
  contents(doc: unknown): Map<string, unknown> {
    const units = new Map<string, unknown>();
    const maps = isPlainObject(doc) ? doc.exerciseUnits : undefined;
    if (!isPlainObject(maps)) {
      return units;
    }
    for (const exerciseId of Object.keys(maps)) {
      const dimensions = maps[exerciseId];
      if (!isPlainObject(dimensions)) {
        continue;
      }
      for (const dimension of Object.keys(dimensions)) {
        units.set(preferenceUnit(exerciseId, dimension), dimensions[dimension]);
      }
    }
    return units;
  },
  put(root: PlainObject, unit: string, value: unknown): void {
    const { exerciseId, dimension } = splitPreferenceUnit(unit);
    if (!isPlainObject(root.exerciseUnits)) {
      root.exerciseUnits = {};
    }
    const maps = root.exerciseUnits as PlainObject;
    if (!isPlainObject(maps[exerciseId])) {
      maps[exerciseId] = {};
    }
    (maps[exerciseId] as PlainObject)[dimension] = value;
  },
  remove(root: PlainObject, unit: string): void {
    const { exerciseId, dimension } = splitPreferenceUnit(unit);
    if (!isPlainObject(root.exerciseUnits)) {
      return;
    }
    const maps = root.exerciseUnits as PlainObject;
    const dimensions = maps[exerciseId];
    if (!isPlainObject(dimensions)) {
      return;
    }
    delete dimensions[dimension];
    // An exercise with no dimension left holds nothing, so it leaves the map too.
    if (Object.keys(dimensions).length === 0) {
      delete maps[exerciseId];
    }
  }
};

/** The store for one family. */
function storeFor(family: MergeFamily): UnitStore {
  return family === 'repjot/results' ? resultsStore : preferenceStore;
}

/**
 * Merge base, local, and remote into one document.
 *
 * Order of work:
 *
 * 1. Diff base to local and base to remote.
 * 2. When one side has no delta, the other side is the answer. No merge is needed.
 * 3. When the three copies share no document base, the local document wins whole
 *    and every unit either side holds reports as conflicted.
 * 4. Apply the remote delta to a copy of the base.
 * 5. Apply the local changes one conflict unit at a time.
 * 6. Apply the local value for each path outside the unit namespace.
 *
 * Conflict rules the steps encode. REQUIREMENTS 4.11, 4.12, ARCHITECTURE ADR-012.
 *
 * - A unit the local side holds replaces the merged entry in full. A local edit
 *   beats a remote delete, and a same-unit conflict takes the local version.
 * - A unit the local side deleted stays deleted unless the remote side touched it.
 *   A remote edit beats a local delete, so the remote content already applied in
 *   step 3 stands.
 * - A unit deleted on both sides stays deleted, because step 3 removed it and
 *   step 4 has no local content to restore.
 *
 * The function never mints a session ID, never adds a label, and never copies a
 * unit under a new key. REQUIREMENTS 4.13, 11.23, 11.24.
 *
 * Every return path clones its result. `merged` never shares a node with `base`,
 * `local`, or `remote`, so a caller may write to it, and Phase 10 does: it sets
 * `revision` and `updatedAtUtc` on the upload candidate.
 * ARCHITECTURE section 11.
 *
 * A `patch` failure propagates as the library throws. The coordinator catches it,
 * keeps the pending delta, and retries. ARCHITECTURE section 11 "Reconciliation
 * and writes".
 */
export function mergeDocuments(input: MergeInput, onConflict?: ConflictObserver): MergeResult {
  const { family, base, local, remote } = input;
  const observer = onConflict ?? recordConflict;
  const localDelta = patcher.diff(base, local);
  const remoteDelta = patcher.diff(base, remote);

  // No local change means nothing to push. The remote document is the answer.
  if (!localDelta) {
    return { merged: clone(remote), needsUpload: false, conflictedUnits: [] };
  }
  // Remote unchanged since the base means the local document already includes it.
  if (!remoteDelta) {
    return { merged: clone(local), needsUpload: true, conflictedUnits: [] };
  }

  if (!isPlainObject(base) || !isPlainObject(local) || !isPlainObject(remote)) {
    return wholeLocalResult(family, local, remote, observer);
  }

  const localWalk = walkDelta(family, localDelta);
  const remoteUnits = unitsTouchedBy(family, remoteDelta);
  const conflictedSet = new Set<string>();
  for (const unit of localWalk.units) {
    if (remoteUnits.has(unit)) {
      conflictedSet.add(unit);
    }
  }
  const conflictedUnits = sortedUnits(Array.from(conflictedSet));

  // Step 3. The clone keeps the merged document free of references into the
  // caller's base, local, or remote values.
  const patched = clone(patcher.patch(clone(base), remoteDelta));
  if (!isPlainObject(patched)) {
    return wholeLocalResult(family, local, remote, observer);
  }
  const merged = patched;
  const store = storeFor(family);

  // Step 4. Sorted so the merged document and the diagnostics read the same way
  // for the same inputs.
  const localContents = store.contents(local);
  for (const unit of Array.from(localWalk.units).sort()) {
    if (localContents.has(unit)) {
      store.put(merged, unit, clone(localContents.get(unit)));
      continue;
    }
    if (!conflictedSet.has(unit)) {
      store.remove(merged, unit);
    }
    // Conflicted and absent locally: the local side deleted the unit and the remote
    // side edited it. The remote content applied in step 3 stands. REQUIREMENTS 4.12.
  }

  // Step 5. Fields outside the unit namespace, such as a top-level field, take the
  // local value because this client synchronizes last.
  for (const path of localWalk.loosePaths) {
    // A root-level replacement cannot appear here: both sides are documents, so a
    // delta always names a property below the root.
    if (path.length === 0) {
      continue;
    }
    const value = getIn(local, path);
    if (value === undefined) {
      deleteIn(merged, path);
    } else {
      setIn(merged, path, clone(value));
    }
  }

  for (const unit of conflictedUnits) {
    observer({ family, unit });
  }

  return { merged, needsUpload: true, conflictedUnits };
}
