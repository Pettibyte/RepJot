# Storage and Lookup Architecture

## Status

Proposed implementation plan for REP JOT workout-history storage, synchronization,
caching, and lookup.

This specification refines the current three-document JSON model. Exercise and
programming data remain ordinary JSON documents. The growing results document is split
into monthly JSON shards. Google Drive remains the source of truth; browser storage and
in-memory indexes are disposable projections of that data.

## Goals

- Work in the Kindle Scribe browser without WebAssembly.
- Keep the canonical data portable, inspectable JSON.
- Avoid downloading unchanged history on every launch.
- Make recent exercise and muscle-group queries effectively immediate.
- Keep normal workout saves limited to the current month's data.
- Recover completely if the browser cache is cleared or corrupted.
- Avoid maintaining a second authoritative manifest that can disagree with Drive.

## Non-goals

- Implementing a general-purpose relational database or SQL interpreter.
- Supporting arbitrary joins or ad hoc query syntax.
- Treating IndexedDB as durable or authoritative storage.
- Synchronizing an unbounded number of concurrent writers without conflict detection.

## Storage layers

```text
Google Drive appDataFolder       Authoritative JSON documents
             |
             v
IndexedDB                       Rebuildable file-content and metadata cache
             |
             v
In-memory Map and sorted arrays Rebuildable query-oriented read model
             |
             v
REP JOT UI                      Workout entry, recent history, and analytics
```

The layers have one-way authority. Cached or indexed data may always be discarded and
rebuilt from Drive.

## Canonical Drive files

Use a flat set of files in the application's private `appDataFolder`:

```text
exercises.json
programming.json
preferences.json
results-2026-07.json
results-2026-08.json
results-2026-09.json
```

Actual Drive folders are unnecessary. `files.list` with
`spaces=appDataFolder` provides the complete application file catalog, so a separate
Drive-hosted `index.json` is not authoritative and should not be required.

### Monthly result shards

Each `results-YYYY-MM.json` document uses the existing results-document shape:

```json
{
  "schemaVersion": 1,
  "sessions": []
}
```

A session belongs to the shard matching the calendar year and month expressed by its
`startedAt` value, using the offset present in that timestamp. Editing a historical
session updates its original shard. Crossing into a new month creates a new shard.

Monthly shards are preferred over yearly shards because they:

- bound the data rewritten after a normal workout;
- make recent-first lazy loading natural;
- reduce conflict scope between devices;
- remain large enough to avoid creating excessive Drive files.

### Result identity

Exercise results should eventually record `exerciseId` directly as well as `nodeId`:

```json
{
  "nodeId": "back-squat-working-set",
  "exerciseId": "back-squat",
  "iteration": 1,
  "values": {
    "reps": 5,
    "weight": { "value": 225, "unit": "lb" }
  }
}
```

`nodeId` identifies the programmed occurrence. `exerciseId` identifies the exercise
that was actually performed. Storing both removes the most common history join and
preserves historical meaning if a workout definition is later edited.

When reading older results without `exerciseId`, derive it from `(workoutId, nodeId)`.
When writing a new result, verify that the direct `exerciseId` agrees with the current
programmed node.

## Drive catalog

List file metadata without downloading content:

```text
GET https://www.googleapis.com/drive/v3/files
  ?spaces=appDataFolder
  &q=trashed=false
  &pageSize=1000
  &fields=nextPageToken,files(id,name,modifiedTime,md5Checksum,size,version)
```

Follow every `nextPageToken`; never assume the first page is complete. The catalog is
the equivalent of `ls -r` for REP JOT's flat application-data space.

Drive permits duplicate filenames. A complete catalog operation must detect duplicate
logical names such as two `results-2026-08.json` files and surface a synchronization
error. It must not silently select the first match. Once a file is discovered or
created, retain its Drive file ID for subsequent reads and updates.

Only recognized filenames and supported schema versions participate in the data model.
Unknown files should be left untouched and reported diagnostically.

## IndexedDB cache

Use IndexedDB rather than `localStorage` for cached documents. IndexedDB passed the
Kindle capability probe and avoids localStorage's synchronous string-only API and
typically small quota.

A conceptual cached record is:

```ts
interface CachedDriveDocument {
  accountKey: string;
  fileId: string;
  name: string;
  modifiedTime: string;
  md5Checksum?: string;
  version?: string;
  content: unknown;
  cachedAt: string;
}
```

The cache should contain at least two object stores:

- `documents`, keyed by `(accountKey, name)`, for Drive metadata and parsed content;
- `syncState`, keyed by `accountKey`, for synchronization cursors and format version.

Cache records must be namespaced by Google account. Resolve a stable account key from
Drive account metadata when authentication completes. Until account separation is
implemented, changing accounts must clear the existing cache before loading data.

Do not require persisted in-memory indexes initially. Rebuilding the maps from cached
JSON is simple and prevents index-format migrations. Persist a derived index only if
measurement on the Kindle demonstrates a startup problem.

## Synchronization

### Initial or full reconciliation

1. Obtain a Drive changes start-page token if incremental change tracking is enabled.
2. List every page of metadata in `appDataFolder`.
3. Validate recognized filenames, schema versions, and filename uniqueness.
4. Compare remote metadata with the IndexedDB manifest.
5. Download documents that are absent locally or whose checksum/version changed.
6. Remove cached documents that no longer exist remotely.
7. If a start-page token was captured before the listing, consume changes since that
   token to cover writes that occurred during reconciliation.
8. Persist the final changes token only after all changes have been applied locally.
9. Rebuild the affected in-memory indexes.

Prefer `md5Checksum` for content comparison when Drive supplies it. Fall back to
`version` or `modifiedTime` when necessary.

### Incremental synchronization

The first implementation may repeat the lightweight metadata listing on each launch.
With monthly shards, this remains inexpensive and is much simpler than downloading all
file bodies.

The later optimization is the Drive Changes API:

1. Store the account's `newStartPageToken` in IndexedDB.
2. On the next launch, call `changes.list` with that token and
   `spaces=appDataFolder`.
3. Follow `nextPageToken` through every page.
4. Download new or modified recognized files and remove deleted ones from the cache.
5. Persist `newStartPageToken` only after the final page has been applied.
6. Fall back to full reconciliation if the cursor is rejected or local state is
   inconsistent.

### Writes

Normal workout completion modifies only the relevant monthly shard:

1. Ensure the cached shard is current before editing it.
2. Create the shard if it does not exist.
3. Add or update the session in memory.
4. Upload the entire shard using its retained Drive file ID.
5. Store the returned or freshly requested remote metadata and the new content in
   IndexedDB.
6. Update the affected in-memory indexes.

If remote metadata changed after the shard was loaded, stop and reconcile rather than
silently overwriting it. Drive does not provide an atomic transaction across these
files, and metadata preflight alone does not eliminate a concurrent-write race. Follow
the single-document write-back protocol in `schema-versioning.md`. Multi-device editing
is not complete until conflicts in the same monthly shard can be detected and
reconciled.

## In-memory read model

Use native `Map`, `Set`, and arrays, all of which are supported by the target browser.
The conceptual index is:

```ts
interface DataIndex {
  exerciseById: Map<string, Exercise>;
  workoutById: Map<string, Workout>;
  programmedExerciseByNode: Map<string, ProgrammedExerciseLookup>;
  exerciseIdsByMuscleGroup: Map<MuscleGroup, Set<string>>;
  recentByExerciseId: Map<string, ExerciseOccurrence[]>;
  recentByMuscleGroup: Map<MuscleGroup, ExerciseOccurrence[]>;
  recentSessions: SessionSummary[];
}
```

Use an unambiguous composite node key:

```ts
function nodeKey(workoutId: string, nodeId: string): string {
  return `${workoutId}\u0000${nodeId}`;
}
```

An exercise occurrence should contain enough joined context for rendering without
repeating lookups:

```ts
interface ExerciseOccurrence {
  sessionId: string;
  sessionStartedAt: string;
  workoutId: string;
  nodeId: string;
  exerciseId: string;
  iteration?: number;
  attempt?: number;
  values: ResultValues;
  effort?: EffortOutcome;
}
```

### Building the index

1. Insert every exercise into `exerciseById` and populate
   `exerciseIdsByMuscleGroup` from primary and secondary muscle groups.
2. Insert every workout into `workoutById`.
3. Walk every programming tree once. Map `(workoutId, nodeId)` to its exercise ID,
   stimulus, set role, and other useful programmed context.
4. Traverse loaded sessions newest-first.
5. Resolve each result's exercise directly or through `programmedExerciseByNode` for
   legacy records.
6. Append a joined occurrence to `recentByExerciseId` and each applicable
   `recentByMuscleGroup` list.
7. Build a compact session summary containing its exercise-ID and muscle-group sets.

This is a one-time linear hash join after loading, not a join during every render.

Recent lists should initially be bounded, for example to the newest 20 occurrences per
exercise and muscle group. Full historical analytics can scan hydrated shards or build
an unbounded index on demand.

### Common queries

Recent history for one exercise is a direct lookup:

```ts
index.recentByExerciseId.get('back-squat')?.slice(0, 5);
```

An exercise's muscle groups come directly from `exerciseById`; no historical
intersection is needed. To find sessions containing both a particular exercise and any
exercise for a muscle group, scan `recentSessions` newest-first and test its two sets
until enough matches have been found.

## Loading policy

The day-of-workout UI does not need all history before it becomes usable:

1. Load `exercises.json` and `programming.json`.
2. Load the current month's result shard from IndexedDB or Drive.
3. Determine the exercise IDs required by the selected workout.
4. Walk cached or remote shards backward by filename until enough recent occurrences
   are available for those exercises.
5. Render the workout as soon as its required recent history is ready.
6. Hydrate older shards in the background or when the user opens full history and
   analytics screens.

An explicit full-history operation may download every missing shard, but normal startup
must not require it. Unchanged shards should be served from IndexedDB.

## Failure and recovery rules

- A cleared IndexedDB cache triggers a full Drive reconciliation without data loss.
- Corrupt cached JSON is discarded and downloaded again.
- Corrupt remote JSON or an unsupported schema version is reported and never
  overwritten automatically.
- Duplicate logical filenames are treated as conflicts.
- Failed network synchronization leaves the last valid cache readable, clearly marked
  as potentially stale.
- A failed upload must not update the cached remote metadata.
- Unknown Drive files are never deleted automatically.

## Implementation sequence

1. Add paginated Drive catalog, metadata, download, create, and update primitives.
2. Introduce monthly result filenames and shard validation.
3. Add `exerciseId` to new exercise results with legacy derivation on read.
4. Implement account-scoped IndexedDB document caching.
5. Implement full metadata reconciliation and changed-file downloads.
6. Build the in-memory lookup maps and bounded recent-history lists.
7. Load recent shards lazily for the active workout.
8. Add Drive Changes API synchronization after the simpler approach is proven.
9. Add conflict handling suitable for multiple devices.

## References

- [Store application-specific data in Google Drive](https://developers.google.com/workspace/drive/api/guides/appdata)
- [Drive `files.list`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list)
- [Retrieve Drive changes](https://developers.google.com/workspace/drive/api/guides/manage-changes)
- [Drive `changes.list`](https://developers.google.com/workspace/drive/api/reference/rest/v3/changes/list)
