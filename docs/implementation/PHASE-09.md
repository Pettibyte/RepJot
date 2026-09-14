# Phase 09 — Keyed-map merge engine

Add `jsondiffpatch` and implement the three-way merge with conflict units, local-wins,
and edit-beats-delete. This phase is pure logic with no I/O.

## Prerequisites

- Phase 02 for the domain types and the keyed-map shapes.
- Phase 03 for the pipeline that produces comparable current-version documents.
- Phase 04 for validation of the merge candidate.

## Goals

1. Merge two divergent versions of one logical document without array drift.
2. Define the conflict unit: one session, or one `(exerciseId, dimension)` mapping.
3. Resolve a conflicted unit as last synchronizer wins.
4. Make an edit beat a delete in both directions.
5. Measure the library cost against the Kindle budget before the sync layer depends on it.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/sync/merge-documents.ts` | The merge entry point and the conflict-unit logic. |
| `src/sync/patcher.ts` | One configured `jsondiffpatch` instance and clone helper. |
| `scripts/check-merge-compat.ts` | Proves the merge bundle parses as ES2019 and prints its size. |
| `package.json` | Adds the `jsondiffpatch` dependency, pinned to the exact version. |

### Signatures

```ts
// src/sync/merge-documents.ts
export type MergeFamily = 'repjot/preferences' | 'repjot/results';

export interface MergeInput {
  family: MergeFamily;
  base: unknown;      // content at last successful sync
  local: unknown;     // this device's working document
  remote: unknown;    // latest content read from Drive
}
export interface MergeResult {
  merged: unknown;             // a clone; shares no node with base, local, or remote
  needsUpload: boolean;
  conflictedUnits: string[];   // session ids, or 'exerciseId/dimension'
}

export interface MergeConflictEvent {
  family: MergeFamily;
  unit: string;
}
export type ConflictObserver = (event: MergeConflictEvent) => void;

// `onConflict` is optional. The default observer writes one event per conflicted
// unit to the in-memory diagnostic ring.
export function mergeDocuments(input: MergeInput, onConflict?: ConflictObserver): MergeResult;
export function conflictUnitsFor(family: MergeFamily, doc: unknown): string[];
export function unitsTouchedBy(family: MergeFamily, delta: unknown): Set<string>;
```

### Merge algorithm

```ts
const localDelta  = patcher.diff(base, local);
const remoteDelta = patcher.diff(base, remote);
if (!localDelta) return { merged: clone(remote), needsUpload: false, conflictedUnits: [] };
if (!remoteDelta) return { merged: clone(local), needsUpload: true, conflictedUnits: [] };

const merged = patcher.patch(clone(base), remoteDelta);
const localUnits  = unitsTouchedBy(family, localDelta);
const remoteUnits = unitsTouchedBy(family, remoteDelta);
const conflicted  = intersection(localUnits, remoteUnits);

// For each conflicted unit, replace the merged entry with the local entry in full.
// An edit beats a delete: a unit present in one side and absent in the other keeps
// the side that holds content.
```

The implementation applies the local side one conflict unit at a time. It does not
patch the whole local delta onto the remote-applied document. A local operation that
replaces one exercise's whole unit map would then wipe a remote edit to a different
dimension of that exercise, and two different mappings never conflict.
REQUIREMENTS 4.8. Paths outside the unit namespace, such as a top-level field, take
the local value.

Rules the implementation must encode:

1. Never field-merge inside a conflicted unit.
2. Never mint a new session ID and never add a label.
3. A local delete plus a remote edit resolves to the remote content.
4. A local edit plus a remote delete resolves to the local content.
5. A unit deleted on both sides stays deleted.
6. `needsUpload` is false only when the local side has no delta.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 4.7, 4.8 | The conflict unit and the both-deltas-touch rule are `unitsTouchedBy`. |
| REQUIREMENTS 4.9 | `mergeDocuments` follows the base, remote-delta, local-delta order. |
| REQUIREMENTS 4.10 | Keyed maps only. No array `matchBy` workaround exists. |
| REQUIREMENTS 4.11, 22.2a | Conflicted units take the full local version with no prompt. |
| REQUIREMENTS 4.12 | Rule 3 and rule 4 implement edit-beats-delete both ways. |
| REQUIREMENTS 4.13, 11.23, 11.24 | No copy, no new ID, no `conflictOfSessionId`. |
| REQUIREMENTS 12.8, 12.9 | Preference mappings merge by exercise and dimension with local-wins. |
| REQUIREMENTS 22.3 | Base and pending delta persist. The remote copy stays in memory. |
| REQUIREMENTS 22.4.1–22.4.5 | Keyed maps, no `matchBy`, ordering handled elsewhere. |
| ARCHITECTURE ADR-011, ADR-012 | `jsondiffpatch` merge with last-synchronizer-wins. |
| ARCHITECTURE §11 "Merge policy" | The family and conflict-unit table matches. |
| ARCHITECTURE §16 "Merge tests" | The five required merge properties are the test list below. |

## Checklist

### Implementation

- [x] Add `jsondiffpatch` with `bun add jsondiffpatch`.
- [x] Create `src/sync/patcher.ts` exporting one configured instance and a
      structured `clone` helper.
- [x] Implement `conflictUnitsFor` for results: the keys of `shard.sessions`.
- [x] Implement `conflictUnitsFor` for preferences: each `exerciseId/dimension` pair.
- [x] Implement `unitsTouchedBy` by walking delta paths and mapping each path to its
      owning unit.
- [x] Implement `mergeDocuments` with the algorithm above.
- [x] Implement the delete-versus-edit resolution as an explicit branch, not as an
      accident of delta shape.
- [x] Record one diagnostic per conflicted unit with the unit key and the family.
- [x] Add `scripts/check-merge-compat.ts` and wire it into `check:compat`, so the
      ES2019 claim has a gate that covers the merge module itself.
- [x] Measure the gzipped bundle contribution and record the number in
      `docs/implementation/README.md` under a "Bundle budget" heading.

### Tests

- [x] `tests/merge-results.test.ts`: two devices add different sessions. Both
      survive and no session content shifts.
- [x] `tests/merge-results.test.ts`: the same session changed on both sides. The
      local full session wins and the merged entry equals the local entry.
- [x] `tests/merge-results.test.ts`: a local edit against a remote delete restores the
      session with local content.
- [x] `tests/merge-results.test.ts`: a local delete against a remote edit restores the
      session with remote content.
- [x] `tests/merge-results.test.ts`: a session deleted on both sides stays deleted.
- [x] `tests/merge-results.test.ts`: no merge produces a new session ID or any
      `conflictOf*` field.
- [x] `tests/merge-results.test.ts`: a merge inside a session's `exerciseResults`
      map keeps unrelated results intact.
- [x] `tests/merge-preferences.test.ts`: different exercise and dimension mappings
      merge cleanly.
- [x] `tests/merge-preferences.test.ts`: the same mapping changed on both sides
      resolves to the local value.
- [x] `tests/merge-properties.test.ts`: array-drift guard. Build a base with three
      sessions, delete the first on one side and append on the other, and assert no
      surviving session changed its fields.
- [x] `tests/merge-properties.test.ts`: convergence. Apply the merge twice from the
      same inputs and get identical output.
- [x] `tests/merge-properties.test.ts`: `needsUpload` is false when the local side
      has no delta.

### Verification

- [x] `bun test` passes.
- [x] `bun run check` passes.
- [x] `bun run build` passes with the new dependency.
- [x] `bun run check:compat` passes. It now runs `check:merge-compat`, which
      builds the merge module at `target: 'es2019'` and parses it with acorn at
      `ecmaVersion: 2019`.
- [x] Record the bundle size delta. If it breaks the Phase 20 budget, stop and
      resolve before Phase 10 starts.

## Exit criteria

Two divergent documents become one correct document by pure function, with the
conflict rules proven by tests and no I/O involved.
