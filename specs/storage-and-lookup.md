# Storage and Lookup Architecture

## Status

This specification defines storage, synchronization, caching, and lookup for REP JOT.
It uses the latest file names and ownership decisions.

## Data ownership

REP JOT has two canonical storage locations:

| Location | Files | Authority |
| --- | --- | --- |
| Static site bundle | `exercises.json`, `workouts.json` | Published exercise and workout data |
| Google Drive `appDataFolder` | `preferences.json`, `results-YYYY-MM.json` | User preferences and workout results |

The static bundle never reads or writes `exercises.json` or `workouts.json` in Drive.
Drive contains no canonical exercise or workout file.

IndexedDB is a disposable local cache. It stores downloaded Drive documents, sync
metadata, migrated views, and pending local edits. It is not a third canonical data
store. The application can rebuild synchronized cache data from the static bundle and
Drive.

## Document envelopes

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

Published exercise, workout, and workout-node IDs have these rules:

- The build must not delete a published ID.
- The build must not reuse a published ID for a different entity or node.
- Authors can correct the content associated with a published ID.
- The build downloads the prior production bundle and compares IDs.
- It preserves node type, parent, exercise reference, container strategy, scoring contract, and previously supported measurement units.
- It does not compare complete content hashes, labels, instructions, notes, or prescriptions.

Only `deprecated` controls lifecycle state. A deprecated exercise stays resolvable for
history. Authors cannot add it to new workouts. A node absent from the prior production
bundle is new, even when its workout ID already exists. A new session from an existing
workout omits exercises already deprecated at its start.

A deprecated workout stays resolvable for history. The UI hides it from workout
selection and does not permit a new session to start from it. The build reports each
workout and scored or timed container affected by a newly deprecated exercise.

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
  "sessions": [],
  "sessionTombstones": []
}
```

A session ID is `session-` followed by a collision-resistant UUID. Identity does not
encode workout time. `startedAtUtc` is an RFC 3339 UTC timestamp that ends in `Z`.
Its UTC year and month select the shard. For example, a local start at
`2026-08-31T23:30:00-07:00` persists as `2026-09-01T06:30:00Z` in
`results-2026-09.json`.

A session remains in its UTC start-month shard if it crosses a month boundary.
Editing a historical session updates its original shard. Release one does not permit
timestamp edits. Starting a session in a new UTC month creates that month’s shard.
Local date and time conversion occurs only when the UI displays a timestamp.

Monthly shards bound write size, reduce conflict scope, and support recent-first
loading. Normal workout saves update only one shard. Several sessions can remain in
progress across the loaded shards.

### Stored result identity

Each session stores its direct `workoutId`. Completed and abandoned sessions remain
terminal while the Active Workout editor changes their results. The editor builds a
temporary plan from the current retained workout tree and overlays recorded results by
execution path. New current-tree nodes appear with blank results. A deprecated exercise
appears only when the session already records its path. Terminal sessions do not store
`executionPlan`. Editing preserves the terminal status and all session timestamps.
Release one does not provide timestamp editing.

Each exercise result also stores:

- The direct `workoutId`
- The direct `exerciseId`
- The full `executionPath`
- The actual values and units
- An optional unilateral side

The execution path identifies every repeated ancestor and the terminal workout node.
Scored containers use container results with their own `workoutId`, `executionPath`,
status, and score. Optional child detail uses separate exercise results.

Aggregate-only entry stores no child results. Expanding it creates the complete child
set from the score and workout order. Child edits then recompute the container score.
If detailed work does not follow valid score progression, the container stores a
`nonstandard` score and the UI displays `Detailed`.

Semantic validation rejects partial detail, score mismatches, duplicate container
paths, and duplicate exercise path-side-attempt tuples. `rounds_and_reps` is valid only
for deterministic sequences of repetition-based leaf exercises.

The direct IDs make common history queries independent of a workout-tree join. The
loader still validates paths and direct IDs against the retained static entities.
Supported legacy migrations can derive missing direct IDs from a matching workout and
node path. They must fail rather than guess when a reference does not resolve.

## Drive catalog

List metadata before downloading file content:

```text
GET https://www.googleapis.com/drive/v3/files
  ?spaces=appDataFolder
  &q=trashed=false
  &pageSize=1000
  &fields=nextPageToken,files(id,name,modifiedTime,md5Checksum,size,version)
```

Follow every `nextPageToken`. Drive permits duplicate names. Report duplicate
recognized names as sync conflicts, and never select one silently.

Retain each discovered Drive file ID for reads and updates. Process only
`preferences.json` and valid monthly result names. Leave unknown Drive files unchanged
and report them in diagnostics.

## IndexedDB cache

Use IndexedDB instead of `localStorage`. Namespace all records by Google account.
Changing accounts must select a separate namespace or clear the previous cache before
loading data.

A cached document records its logical name, Drive file ID, remote metadata, parsed
content, schema provenance, and cache time. Pending edits retain the unchanged base
content and metadata needed for a three-way merge. A sync-state record stores a changes token
when incremental sync is enabled.

Pending local edits use the same account and logical-file namespace. Save edits to
IndexedDB before Drive synchronization. Unit toggles convert entered values with full
internal precision before saving the new explicit unit. The editable display rounds to
the nearest `0.1`. Keep the full converted value when the user does not edit that display;
otherwise, save the number that the user enters. Debounce normal edits, save on blur, and
flush pending local edits on `pagehide` when possible.

A failed Drive sync keeps pending edits and shows `Sync failed`. The UI uses `Saving`,
`Saved`, and `Sync failed` states. Clearing IndexedDB discards the cache, so the next
launch performs a full reconciliation.

Do not persist derived lookup indexes unless Kindle measurements show a startup
problem. Rebuilding indexes prevents unnecessary cache-format migrations.

### Local diagnostics

IndexedDB stores a bounded, account-scoped diagnostic event ring. Diagnostic events are
support data, not canonical fitness data. REP JOT never uploads them to Drive or another
service.

Each event records `recordedAtUtc`, severity, a stable event code, operation and
correlation IDs, application build, and redacted context. Merge events record counts and
decisions. Duplicate cleanup events record file aliases, metadata changes, the selected
primary alias, preserved conflict counts, upload confirmation, and deletion outcomes.

Events never contain OAuth tokens, account names, raw Drive file IDs, canonical file
content, workout or exercise names, notes, measurements, or session IDs. A random local
salt creates stable diagnostic aliases for account, file, document, and session IDs.

Keep events for seven days, with maximums of 500 events and 256 KiB per account. Remove
the oldest event when one limit is exceeded. Settings provides **Download diagnostic log**
as one JSON file and **Clear diagnostic log**. Export is always user-initiated and no
automatic telemetry exists.

## Synchronization

### Full reconciliation

1. List every Drive catalog page.
2. Validate recognized names, envelopes, versions, and filename uniqueness.
3. Compare remote metadata with the account-scoped IndexedDB records.
4. Download files that are absent or changed locally.
5. Remove synchronized cache records for remote files that no longer exist.
6. Reconcile pending local edits before replacing their cached content.
7. Rebuild affected in-memory indexes.

Use `md5Checksum` when Drive supplies it. Otherwise, use Drive `version` or
`modifiedTime`. These values detect remote file changes. They do not select schema
migrations.

A later implementation can use the Drive Changes API. Persist a new changes token only
after all pages apply successfully. Fall back to full reconciliation when Drive rejects
the token or local state is inconsistent.

### Writes and conflicts

Deleting one session removes it from `sessions` and adds a permanent entry to
`sessionTombstones` in the same shard. A tombstone wins over a stale session with that
ID. Automatic synchronization does not remove tombstones.

Before a canonical write, load the latest remote file and retain its Drive metadata.
Compare the cached base, local edit, and latest remote content. If remote still equals
the base, upload the local edit. Otherwise, perform a three-way merge.

For monthly results, apply tombstones first and merge sessions by stable ID. Changes to
different sessions merge automatically. If the same live session changed locally and
remotely, keep the remote version under its original ID. Save the pending local version
as a sync copy with a new `session-` prefixed UUID and `conflictOfSessionId` set to the
original ID. Preserve its status and timestamps.

Store the generated copy ID in the pending edit before upload. Every retry reuses it so
one detected conflict cannot create repeated copies. Tombstones win without creating a
sync copy.

Preferences merge by exercise and dimension. For the same mapping changed on both
sides, the pending local value wins because this client performs the later
synchronization. REP JOT does not prompt for preference conflicts.

Validate the edited document before upload. Recheck remote metadata immediately before
updating the retained Drive file ID. If the metadata changed, stop and reconcile.

Drive `version`, `md5Checksum`, and `modifiedTime` detect changes, but the documented
`files.update` operation does not provide REP JOT with a guaranteed compare-and-swap
transaction. A metadata preflight therefore reduces but does not remove the final race.
REP JOT never silently discards a detected session version.

History labels sessions with `conflictOfSessionId` as `Sync copy`. These sessions use
the normal view, edit, and delete actions; REP JOT has no separate reconciliation UI.

After upload, read enough remote state to determine the outcome. Update IndexedDB and
the in-memory index only after the remote commit is known. If the network result is
ambiguous, read Drive before retrying.

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
}
```

Use an unambiguous composite node key:

```ts
function nodeKey(workoutId: string, nodeId: string): string {
  return `${workoutId}\u0000${nodeId}`;
}
```

Build static lookup maps from the bundle. Then traverse loaded result shards from
newest to oldest. Index exercise results by their direct IDs and retain the execution
path for display and validation.

Index container results separately when summary or analytics views need container
scores. Keep recent lists bounded for normal screens. Full-history views can load older
shards and extend the indexes on demand.

## Loading policy

1. Load and validate bundled `exercises.json` and `workouts.json`.
2. Load `preferences.json` from IndexedDB or Drive.
3. Load the current result shard.
4. Load older cached or remote shards until the active workout has enough history.
5. Render as soon as the required recent history is ready.
6. Load more history when the user requests it.

Normal startup does not download or rewrite all history. Unchanged shards come from
IndexedDB.

At session start, copy the effective workout tree into the session `executionPlan`.
Filter exercises already deprecated, and create skipped results with
`reasonCode: "deprecated"`. The frozen plan includes the remaining nodes, strategies,
scoring rules, and prescriptions.

A scored container affected by an omission becomes detail-only in the effective plan.
Set its `childDetail` to `required`, remove aggregate entry from the UI, and store a
`nonstandard` score only when complete remaining detail exists. Complete detail covers
all remaining leaves in each observed cycle or block, not future possible cycles.
Structurally complete detail with incomplete results can leave the score absent. If no
executable child remains, store a skipped container with `reasonCode: "deprecated"` and
no score.

An in-progress session always resumes from its frozen plan. Later bundle corrections or
deprecations do not change it. Remove the plan when the session becomes completed or
abandoned. Retained static IDs and recorded results support historical display.

## User data deletion

Delete All User Data requires explicit confirmation. It deletes every recognized REP
JOT file from `appDataFolder`, then clears the account's IndexedDB documents, pending
edits, sync state, and in-memory indexes. A partial remote deletion is reported and can
be retried. REP JOT does not report success while recognized remote files remain.

Disconnect Google Account is separate. With a valid access token, REP JOT revokes the
OAuth grant, signs out of REP JOT, and clears the account cache. If revocation cannot complete, the
UI links to Google Account connections so the user can remove access there.

## Failure and recovery

- A missing or corrupt cache triggers a Drive reconciliation.
- Corrupt cached JSON is discarded and downloaded again.
- Corrupt remote JSON is reported and never overwritten automatically.
- A future schema version is not opened for editing or overwritten.
- Duplicate recognized Drive names are conflicts.
- A failed sync keeps the last valid cache and all pending local edits.
- A failed upload does not update cached remote metadata.
- Unknown Drive files are never deleted automatically.
- Static bundle validation failure blocks the build or application load.

## Related specification

See [Schema Versioning and Data Migration](./schema-versioning.md) for envelopes,
migration chains, and safe write-back.
