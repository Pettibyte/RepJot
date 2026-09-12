# Storage and Lookup Architecture

## Status

This specification defines storage, synchronization, caching, and lookup for REP JOT.
It follows `../docs/REQUIREMENTS.md` (v4). Where the two differ, `REQUIREMENTS.md` wins.

Removed from the earlier revision: frozen execution plans, session tombstones, sync
copies, and prior-production-bundle comparison. See `../docs/REQUIREMENTS.md` Section
22.0 for why.

## Data ownership

REP JOT has two canonical storage locations:

| Location | Files | Authority |
| --- | --- | --- |
| Static site bundle | `exercises.json`, `workouts.json` | Published exercise and workout data |
| Google Drive `appDataFolder` | `preferences.json`, `results-YYYY-MM.json` | User preferences and workout results |

The static bundle never reads or writes `exercises.json` or `workouts.json` in Drive.
Drive contains no canonical exercise or workout file.

IndexedDB is a disposable local cache. It stores downloaded Drive documents, base
copies, pending deltas, and pending local edits. It is not a third canonical data
store. The application can rebuild synchronized cache data from the static bundle and
Drive.

## Document envelope

Every current document starts with a family and schema-version envelope:

```json
{
  "format": "repjot/results",
  "schemaVersion": 1
}
```

The format families are:

```text
repjot/exercises
repjot/workouts
repjot/preferences
repjot/results
```

Each family has an independent schema-version sequence. All monthly result shards use
`repjot/results`, but different shards can temporarily use different supported schema
versions.

All persisted application timestamps use field names ending in `Utc`. Their RFC 3339
values must end in `Z`. The application derives local dates and times for display only.
Drive-owned metadata fields retain the names and timestamp forms defined by Drive.

## Static bundle rules

`exercises.json` and `workouts.json` ship with the application. The build validates
their JSON schemas and cross-file references.

REP JOT treats published exercise and workout data as editable facts. It is not an
immutable ledger. Any release may add, rename, re-parent, re-spec, or remove an
exercise, a workout, or a workout node. See `../docs/REQUIREMENTS.md` Section 6.0.

The build performs three checks on static identity:

1. Each file validates against its JSON Schema.
2. No duplicate node ID within one workout.
3. Every workout node `exerciseId` resolves in `exercises.json`.

The build does not download a prior production bundle. It does not diff IDs. It
enforces no immutability rule and no backwards-compatibility rule.

REP JOT has no `deprecated` flag. An exercise appears in selection when the seed
allowlist lists it. A workout appears in the chooser when `workouts.json` lists it.

When a stored result references data that no longer resolves, the UI shows an error
card with a **View Raw JSON** action. See `../docs/REQUIREMENTS.md` Section 6.8.

## Canonical Drive files

Use a flat set of recognized files in `appDataFolder`:

```text
preferences.json
results-2026-07.json
results-2026-08.json
results-2026-09.json
```

Actual Drive folders are not necessary. A separate Drive `index.json` is not
canonical. `files.list` with `spaces=appDataFolder` supplies the file catalog.

### Monthly result shards

A result shard has this top-level shape:

```json
{
  "format": "repjot/results",
  "schemaVersion": 1,
  "yearMonthUtc": "2026-08",
  "sessions": {}
}
```

A session ID is `session-` followed by a UUID v4. Identity does not encode workout
time. `startedAtUtc` is an RFC 3339 UTC timestamp that ends in `Z`. Its UTC year and
month select the shard. For example, a local start at `2026-08-31T23:30:00-07:00`
persists as `2026-09-01T06:30:00Z` in `results-2026-09.json`.

A session remains in its UTC start-month shard if it crosses a month boundary.
Editing a historical session updates its original shard. Release one does not permit
timestamp edits. Starting a session in a new UTC month creates that month's shard.
Local date and time conversion occurs only when the UI displays a timestamp.

Monthly shards bound write size, reduce conflict scope, and support recent-first
loading. Normal workout saves update only one shard. Several sessions can remain in
progress across the loaded shards.

### Keyed maps, not arrays

Every collection that two devices can change must be a keyed map. `jsondiffpatch`
diffs arrays by index. A concurrent insert or delete shifts indexes, so an
index-based delta can land on the wrong element after a merge. Keyed maps produce
deltas that are independent of position.

| Collection | Shape | Key |
| --- | --- | --- |
| Shard sessions | `Record<sessionId, Session>` | Session ID |
| Session exercise results | `Record<string, ExerciseResult>` | Composite key, below |
| Session container results | `Record<string, ContainerResult>` | Composite key, below |
| Preference unit map | `Record<exerciseId, Record<dimension, unit>>` | Exercise ID, then dimension |

REP JOT does not store any of these as an array. Do not add array `matchBy`
workarounds. Keyed maps remove the problem instead of patching it.

Arrays remain correct in `workouts.json`. Prescriptive sequence is a property of the
workout definition, and only the author changes it, at build time.

### Composite result key

A session stores its results in two maps, one per result kind.

```text
exerciseResults  key = <path>|<side>|<attempt>
containerResults key = <path>|<attempt>
```

Path encoding inside a key:

```text
root/squat-sets:3/back-squat-set
```

- Segments join with `/`.
- A repeated-container segment carries `:<iteration>`, one-based.
- The field separator is `|`.
- `side` defaults to `both`. `attempt` defaults to `1`.
- The application always writes both fields into the key, even at their defaults, so a
  key never changes shape later.

ID segments must not contain `/`, `|`, or `:`. The JSON Schemas enforce this rule on every
exercise, workout, node, and non-null equipment value.

The result value keeps its structured `executionPath` array. The key is derived from
that array. Loader and build validation reject a key that does not match the value it
maps to. The structured path stays in the document because the user reads raw JSON to
debug, and `root/squat-sets:3/back-squat-set` is easier to read than a re-derived
string.

Example:

```json
{
  "exerciseResults": {
    "root/squat-sets:3/back-squat-set|both|1": {
      "workoutId": "strength-and-cindy",
      "exerciseId": "Barbell_Squat",
      "executionPath": [
        { "nodeId": "root" },
        { "nodeId": "squat-sets", "iteration": 3 },
        { "nodeId": "back-squat-set" }
      ],
      "side": "both",
      "attempt": 1,
      "status": "completed",
      "values": { "reps": { "value": 5, "unit": "reps" }, "weight": { "value": 225, "unit": "lb" } }
    }
  }
}
```

### Stored result identity

Each session stores its direct `workoutId`. The Active Workout editor builds a
temporary view from the current workout tree and overlays recorded results by
execution path. New current-tree nodes appear with blank results. Terminal sessions
store no plan. Editing preserves the terminal status, `startedAtUtc`, and
`completedAtUtc`. Each saved edit sets a new `updatedAtUtc`.

Each exercise result also stores:

- The direct `workoutId`
- The direct `exerciseId`
- The full `executionPath`
- The actual values and units
- An optional unilateral side

The execution path identifies every repeated ancestor and the terminal workout node.
Scored containers use container results with their own `workoutId`, `executionPath`,
status, and score. Optional child detail uses separate exercise results.

Aggregate-only entry stores no child results. Expanding it produces a **draft** child
set inferred from the score and the workout prescription. A draft value is not
recorded actual work. It becomes recorded work only when the user saves it. See
`../docs/REQUIREMENTS.md` Section 10.14 through Section 10.17.

A saved child set can be partial while the user enters detail. If partial detail
follows valid progression and derives the aggregate exactly, the standard score stays.
Otherwise, the container uses a `nonstandard` score and the UI shows `Detailed`.
Semantic validation rejects standard score mismatches, duplicate container paths, and
duplicate exercise path-side-attempt tuples. `rounds_and_reps` is valid only for deterministic sequences
of repetition-based leaf exercises.

The direct IDs make common history queries independent of a workout-tree join. The
loader validates paths and direct IDs against the current static entities. When a
reference does not resolve, the loader marks that result unresolved and shows the
error card. It never guesses.

## Drive catalog

List metadata before downloading file content:

```text
GET https://www.googleapis.com/drive/v3/files
  ?spaces=appDataFolder
  &q=trashed=false
  &pageSize=1000
  &fields=nextPageToken,files(id,name,modifiedTime,md5Checksum,size,version)
```

Follow every `nextPageToken`. Drive permits duplicate names. The client never ignores
a duplicate recognized name and never asks the user to choose a file. It consolidates
the group automatically. See the consolidation steps below and
`../docs/REQUIREMENTS.md` Section 4.22 through Section 4.26.

Retain each discovered Drive file ID for reads and updates. Process only
`preferences.json` and valid monthly result names. Leave unknown Drive files unchanged
and report them in diagnostics.

## Local storage façade

All application-data persistence passes through one small façade. No other module
calls the IndexedDB API directly.

```ts
interface LocalStore {
  get(name: string): Promise<unknown | undefined>;
  set(name: string, value: unknown): Promise<void>;
  delete(name: string): Promise<void>;
  setMany(entries: Array<{ name: string; value: unknown }>): Promise<void>;
}
```

- The façade stores whole JSON documents keyed by logical file name. It performs no
  query, no index, and no partial update.
- `setMany` is a requirement, not a convenience. One save writes a cached document,
  its base copy, and its pending delta. These three writes land together or not at
  all.
- The façade keeps the storage engine swappable. A move from IndexedDB to another
  key-value store changes the façade only. No sync code changes.
- Keep the façade under about 50 lines. It is a thin adapter, not a storage framework.

Authentication state is outside the façade. The `sessionStorage` and `localStorage`
use required by `../docs/REQUIREMENTS.md` Section 2.5, Section 2.9, and Section 2.10
stays direct.

Bind each new or restored token to its Drive account before private cache access.
Namespace all façade records by that account. Changing accounts must select a separate
namespace or clear the previous cache before loading data.

A cached document record holds its logical name, Drive file ID, remote metadata,
parsed content, and cache time. A base record holds the content from the last
successful synchronization. A pending record holds the unsynced local delta.

Do not persist derived lookup indexes. Rebuilding them at startup prevents
unnecessary cache-format migrations.

### Local diagnostics

The application keeps a bounded in-memory diagnostic log. Diagnostic events are
support data, not canonical fitness data. REP JOT never uploads them to Drive or
another service.

Each event records `recordedAtUtc`, severity, a stable event code, and short context.
The application keeps at most 200 events and drops the oldest. The log never contains
an OAuth token or an authorization header.

The log is not persisted. It applies no salting, no aliasing, and no per-account
retention schedule. Settings provides **Download diagnostic log** as one JSON file.
Export is always user-initiated and no automatic telemetry exists.

### Raw data export

Settings lists every file in `appDataFolder` and lets the user download each file
without migration or interpretation. The export includes recognized REP JOT files,
unknown files, corrupt files, and files with newer schema versions. It preserves the
exact downloaded bytes and the Drive file name.

The application reads all catalog pages before it builds the export list. Duplicate
file names remain separate downloads and include their Drive file IDs in the UI.
A failed download does not prevent downloads of other files.

The diagnostic-log download is a separate action. It never becomes part of a Drive
file export.

## Synchronization

REP JOT supports several devices for one account. The merge model uses
`jsondiffpatch`.

### Duplicate file consolidation

Drive permits duplicate names, so a recognized logical file can exist twice. The client
clears the duplicate automatically. `../docs/REQUIREMENTS.md` Section 4.22 through
Section 4.26 governs the rule; the steps below state the mechanism.

The client consolidates a duplicate group only when every copy parses, declares the
correct family, uses a supported schema version, and passes semantic validation. For
such a group:

1. Download every copy and retain its Drive file ID and metadata.
2. Select the lexicographically smallest Drive file ID as the primary.
3. For a result shard, union the different session IDs. For one session ID that appears
   in more than one copy, keep the version with the greatest
   `(updatedAtUtc, Drive file ID)` tuple.
4. For preferences, merge the different mappings. For one mapping that appears in more
   than one copy, keep the value from the file with the greatest
   `(updatedAtUtc, Drive file ID)` tuple.
5. Validate the consolidated document.
6. Recheck the metadata of every copy in the group.
7. Update the primary file and read it back.
8. Delete the redundant files only after the primary holds the consolidated data.
9. List the name again before the local cache records one remaining Drive file ID.

The tuple rule gives cleanup a deterministic result when Drive holds no shared base
document. Normal synchronization still uses the last-synchronizer-wins rule in the next
section. An edit beats a conflicting delete. Consolidation creates no tombstone and no
sync copy.

A group that holds a corrupt, wrong-family, or unsupported copy stays blocked. The
`DataError` component names the file and offers **View Raw JSON**, and pending local
edits stay durable. A copy that changes during cleanup also blocks the group, and the
client retries on the next synchronization. The client never deletes a file whose
content the primary does not already hold.

### Merge model

The conflict unit is one top-level keyed entry. For results, the unit is one session.
For preferences, the unit is one exercise-and-dimension mapping. REP JOT does not
merge inside a conflicted unit.

A conflict exists when the local delta and the remote delta both touch any path under
the same conflict unit. Two different sessions never conflict. Two different
preference mappings never conflict.

```ts
const localDelta  = patcher.diff(base, localDoc);
const remoteDelta = patcher.diff(base, remoteDoc);
const merged = patcher.patch(clone(base), remoteDelta);
const result = mergeWithLocalWins(merged, localDelta, conflictedKeys);
```

The last device to synchronize wins. On a conflict, the client replaces the merged
entity with its own local version in full. It does not field-merge a conflicted
session. It does not prompt.

An edit beats a delete regardless of which side contains the edit. When the remote
removed a session that the local side still edits, the session returns with local
content. When the local side deleted a session that the remote side edited, the
session returns with remote content. This delete rule overrides the general local-wins
rule for a conflicted unit.

REP JOT creates no sync copy. A conflict does not mint a new session ID and adds no
label.

### Full reconciliation

1. List every Drive catalog page.
2. Detect duplicate recognized names and consolidate them before any normal write. Validate recognized names, envelopes, and versions.
3. Compare remote metadata with the account-scoped cache records.
4. Download files that are absent or changed locally.
5. Remove synchronized cache records for remote files that no longer exist.
6. Reconcile pending local edits before replacing their cached content.
7. Rebuild affected in-memory indexes.

Use `md5Checksum` when Drive supplies it. Otherwise, use Drive `version` or
`modifiedTime`. These values detect remote file changes. They do not select schema
migrations.

A later implementation can use the Drive Changes API. Persist a new changes token only
after all pages apply successfully. Fall back to full reconciliation when Drive
rejects the token or local state is inconsistent.

### Writes, preflight, and retry

Save each edit to local storage before Drive synchronization. Debounce normal edits,
save on blur, and flush pending local edits on `pagehide`. The UI shows `Saving` while
a local save runs. It shows `Saved` after the local save succeeds.

One transactional `setMany` call writes the working document, its base copy, and its
pending delta. A Drive error does not remove these local records.

Before a canonical write, load the latest remote file and retain its Drive metadata.
Compare the cached base, local edit, and latest remote content. If remote still equals
the base, upload the local edit. Otherwise, perform the merge above.

The preflight reduces the race window. It does not close it. Another device can write
between the preflight read and the upload.

The Google Drive `files.update` operation provides no conditional write. The v3 REST
reference defines no `If-Match` compare-and-set for file content. REP JOT must not
assume one exists.

Instead:

1. Upload the merged document.
2. Read the file back and confirm that the content matches what the client wrote.
3. On a mismatch or an upload error, re-read the remote file, re-run the merge from a
   fresh base, and re-upload.
4. Retry at most three times.
5. After three failed attempts, show `Sync failed` and keep every pending local edit.
   Discard nothing.

REP JOT accepts the residual race between the final read-back and a simultaneous
write from another device. The last writer wins and the loser detects the mismatch on
its next sync.

Preferences merge by exercise and dimension. For the same mapping changed on both
sides, the pending local value wins because this client performs the later
synchronization. REP JOT does not prompt for preference conflicts.

Validate the edited document before upload.

Deleting one session removes it from the `sessions` map in its shard. REP JOT writes
no tombstone. A stale device that synchronizes later can restore a deleted session,
and the user deletes it again.

After upload, read enough remote state to determine the outcome. If the upload
succeeds, one local transaction writes the merged document as both the working cache
and the base, then clears its pending delta. Keep the prior working document and
pending edits after an error. If the network result is ambiguous, read Drive before
retrying.

Drive cannot migrate or update several files atomically. Batch requests are not
transactions. Each preference file and each monthly shard must remain valid and
readable independently.

## In-memory read model

Use native `Map`, `Set`, and sorted arrays:

```ts
interface DataIndex {
  exerciseById: Map<string, Exercise>;
  workoutById: Map<string, Workout>;
  nodeByWorkoutAndId: Map<string, WorkoutNodeLookup>;
  exerciseIdsByMuscleGroup: Map<MuscleGroup, Set<string>>;
  recentByExerciseId: Map<string, ExerciseOccurrence[]>;
  recentByMuscleGroup: Map<MuscleGroup, ExerciseOccurrence[]>;
  recentSessions: SessionSummary[];
  activeSessionsByUpdatedAtUtc: SessionSummary[];
  unresolvedResults: UnresolvedResult[];
}
```

Use an unambiguous composite node key. The `|` separator is safe because the ID character rule in `../docs/REQUIREMENTS.md` Section 22.4.6 forbids `|` in any ID.

```ts
function nodeKey(workoutId: string, nodeId: string): string {
  return `${workoutId}|${nodeId}`;
}
```

Build static lookup maps from the bundle. Then traverse loaded result shards from
newest to oldest. Index exercise results by their direct IDs and retain the execution
path for display and validation.

Index container results separately when summary or analytics views need container
scores. Keep recent lists bounded for normal screens. Full-history views can load
older shards and extend the indexes on demand.

Never derive display order from object key iteration. JavaScript iterates
integer-like keys first, in ascending numeric order, ahead of string keys. No `Record`
key can be integer-like. Sort in the read model on explicit `startedAtUtc` and
`updatedAtUtc` fields.

## Loading policy

1. Load and validate bundled `exercises.json` and `workouts.json`.
2. Load `preferences.json` from the local cache or Drive.
3. Load the current result shard.
4. Load all shards that can contain an `in_progress` session.
5. Load older cached or remote shards until the active workout has enough history.
6. Render after all in-progress sessions and the required recent history are ready.
7. Load more terminal history when the user requests it.

The Drive catalog does not contain session status. Thus, the application must read
all result shards at least once per account namespace. Later starts can use valid
account-scoped cache records for unchanged shards.

The first account load reads all result shards because the Drive catalog has no session
status. Later normal starts do not download or rewrite all history. Unchanged shards
come from the local cache.

An in-progress session resolves its tree from the current bundle on each load. No
session stores a plan. A deploy during an active workout can change that workout. The
user restarts the session or edits the result. REP JOT accepts this risk.

Recorded work renders from the session's own stored data. Each result carries its
`exerciseId`, `executionPath`, values, and units. The app does not need the current
workout tree to display recorded work. It needs the tree only to order and edit it.
When the tree cannot resolve a path, the view falls back to the recorded values and
sorts by the `executionPath` string.

## User data deletion

Delete All User Data requires explicit confirmation. It deletes every recognized REP
JOT file from `appDataFolder`, then clears the account's cached documents, pending
edits, sync state, and in-memory indexes. A partial remote deletion is reported and
can be retried. REP JOT does not report success while recognized remote files remain.

The UI does not claim the deletion is irreversible. It warns that another device with
pending edits can re-create files on its next sync, and that the user must not sync
other devices afterward. REP JOT has no way to reach a stale device's cache.

Disconnect Google Account is separate. With a valid access token, REP JOT revokes the
OAuth grant and confirms that Drive rejects the token. Then it signs out of REP JOT
and clears the account cache. If revocation cannot complete, the UI links to Google
Account connections so the user can remove access there.

## Failure and recovery

- A missing or corrupt cache triggers a Drive reconciliation.
- Corrupt cached JSON is discarded and downloaded again.
- Corrupt remote JSON is reported and never overwritten automatically.
- A future schema version is not opened for editing or overwritten.
- Duplicate recognized Drive names consolidate automatically when every copy is valid. A corrupt, unsupported, or changing copy blocks that logical file and shows the error card.
- A failed sync keeps the last valid cache and all pending local edits.
- A failed upload does not update cached remote metadata.
- Unknown Drive files are never deleted automatically.
- Static bundle validation failure blocks the build or application load.
- An unresolved result reference shows the error card. It never breaks its page, list, the sync loop, or another result.

## Related specification

See [Schema Versioning and Data Migration](./schema-versioning.md) for envelopes,
migration chains, and safe write-back.
