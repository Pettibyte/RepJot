# Schema Versioning and Data Migration

## Status

This specification defines JSON envelopes, independent family migrations,
static-data handling, and safe Drive write-back for REP JOT.
It follows `../docs/REQUIREMENTS.md` (v4). Where the two differ, `REQUIREMENTS.md`
wins.

The migration scaffolding stays. REP JOT must keep the ability to change a schema
later and still read existing user data. Removed from the earlier revision: frozen
execution plans, session tombstones, sync copies, the `deprecated` flag, and the
prior-production-bundle comparison. See `../docs/REQUIREMENTS.md` Section 22.0.

## Scope and ownership

The static bundle owns these documents:

- `exercises.json` with format `repjot/exercises`
- `workouts.json` with format `repjot/workouts`

Google Drive `appDataFolder` owns these user documents:

- `preferences.json` with format `repjot/preferences`
- `results-YYYY-MM.json` with format `repjot/results`

The local cache contains disposable cached copies, base copies, pending deltas, and
migrated views. A cache layout version is separate from every persisted JSON schema
version.

## Document envelope

Every current JSON document declares its family and schema version:

```json
{
  "format": "repjot/results",
  "schemaVersion": 1,
  "yearMonthUtc": "2026-08",
  "sessions": {}
}
```

`schemaVersion` is a positive integer. It defines the persisted shape and semantics of
one format family. It does not identify an application release, a Drive revision, a
cache layout, or a content edit.

Every persisted application timestamp uses a `*Utc` field. Its RFC 3339 value ends in
`Z`. A migration must convert a supported legacy offset timestamp to the equivalent
UTC instant before it writes the next schema version. Local date and time values are
never migration context and are never persisted as canonical timestamps.

A family-specific loader can accept a known legacy document without `format` only
through an explicit and tested importer. A missing `schemaVersion` also requires an
explicit importer. The loader must not infer either value from casual shape checks.

## Independent family versions

Each family owns a monotonically increasing version and an ordered migration chain:

```text
repjot/exercises   v1
repjot/workouts    v1
repjot/preferences v1
repjot/results     v1
```

A change to one family does not increment another family. Every monthly result shard
migrates independently. Thus, supported shards can remain at different persisted
versions.

REP JOT does not use one application-wide persisted schema version. It never uses a
Drive `version`, checksum, modification time, or application version to select a
schema migration.

## Migration chains

Maintain one current-version constant, schema set, and migration registry for each
family. A migration registered for version 1 accepts only version 1 and produces
version 2.

### Empty chain at version one

A family at its first version registers an empty migration chain. The scaffolding
must work before any migration exists.

```ts
const resultsMigrations: Migration[] = [];   // v1 is current. Valid setup.
```

The loader runs the same code path for an empty chain and for a populated one. This
proves the scaffolding at v1, so adding the first real migration later changes data,
not architecture.

### Loader sequence

The loader follows this sequence:

1. Parse JSON as `unknown`.
2. Validate the family and version envelope.
3. Reject a future or unsupported version. See the next section.
4. Validate the declared historical schema.
5. Apply one pure migration.
6. Validate the next envelope and schema.
7. Repeat until the current version.
8. Validate the complete current document.
9. Normalize it into disposable application models.

When the input is already the current version, steps 4 through 7 do not run. When the
chain is empty and the input is v1, the loader validates and normalizes only.

Do not create a matrix of direct conversions to the current version. Retain every
migration. REP JOT has no support floor that removes an older declared version.

Every migration must:

- Accept exactly one known input version.
- Return exactly the next version.
- Produce a new object without changing its input.
- Produce the same output for the same input and context.
- Preserve meaningful user data.
- Avoid Drive, cache, network, DOM, UI, time, random, and locale operations.
- Produce output that validates against the next schema.
- Fail with a precise diagnostic when a required value cannot be derived.

A migration must not invent workout identity, exercise identity, measurements, or
history. Migration and normalization remain separate operations. Derived indexes never
cause a persisted schema-version increment.

## Newer-version rejection

The application must never accept, edit, or overwrite a document whose version is newer
than its own highest supported version for that family. Raw inspection remains available.

| Input | Required behavior |
| --- | --- |
| Missing version | Reject it unless a dedicated importer supports it. |
| Supported older version | Validate it and apply each sequential migration. |
| Older version with a missing migration step | Show the data error UI, offer **View Raw JSON**, and do not overwrite it. |
| Current version | Validate it without migration. |
| Future version | Do not edit or overwrite it. Show the data error UI and offer **View Raw JSON**. |

An older cached application can encounter files written by a newer application. It
must not pretend to understand them. Missing versions, missing migration steps,
older versions with missing migration steps, and future versions use the same data error UI.

The data error UI is the single `DataError` component. It names the family, the
declared version, and the highest supported version. It offers **View Raw JSON** and
**Dismiss**. See `../docs/REQUIREMENTS.md` Section 22.2.10.

## Shipping a version without its migration

A release MAY ship a new schema version without the migration step for the prior
version. This is permitted. It is not a violation of the migration-chain rule.

Old data then fails the loader and shows the data error UI. The raw JSON stays readable through the export in `./storage-and-lookup.md`.
See also `../docs/REQUIREMENTS.md` Section 12.10.

The migration chain is how REP JOT closes that gap later. A migration written after
the fact still applies, because the old file keeps its declared version. A v1 file on
Drive in 2027 still says `schemaVersion: 1`, so a `v1 -> v2` step written in 2027
still loads it.

This is the reason the scaffolding exists at v1 rather than later.

## Result references

The UTC month in each result's `startedAtUtc` selects its `results-YYYY-MM.json` shard.
The file name, `yearMonthUtc`, and each session start month must agree.

Current result documents directly store these identities:

- A session stores `workoutId`.
- Each exercise result stores `workoutId` and `exerciseId`.
- Each exercise result stores its full `executionPath`, optional unilateral side,
  and all actual values with explicit units.
- Each scored-container result stores `workoutId` and `executionPath`.

The path identifies repeated ancestors and the terminal workout node. Container results
preserve observed container scores. Exercise results preserve actual values and units.

A migration must not derive a missing `exerciseId` from the current workout tree.
Static data can change, so this derivation can invent incorrect historical identity.
If a required identity or path is absent, the migration identifies the shard, session,
workout, and node, then fails.

Migrations can validate direct references after structural migration. An unresolved
current static reference is a nonfatal result diagnostic. It does not cause automatic
reference repair.

## Static bundle handling

REP JOT treats published exercise and workout data as editable facts. It is not an
immutable ledger. REP JOT has one user, who edits this data by hand.

The build does not download a prior production bundle. It does not diff IDs. It
enforces no immutability rule and no backwards-compatibility rule. Any release may
add, rename, re-parent, re-spec, or remove an exercise, a workout, or a workout node.

The build performs three checks on static identity:

1. Each file validates against its JSON Schema.
2. No duplicate node ID within one workout. Node IDs are scoped to their workout.
3. Every workout node `exerciseId` resolves in `exercises.json`.

REP JOT has no `deprecated` flag. An exercise appears in selection when the seed
allowlist lists it. A workout appears in the chooser when `workouts.json` lists it.

Static documents change through a validated application build and the seed script, not
through Drive migration. Drive migration never writes `exercises.json` or
`workouts.json`.

When a stored result references static data that no longer resolves, the loader marks
that result unresolved. The UI shows the error card with **View Raw JSON**. It also
shows the stored values and units. If the tree cannot order the result, the UI sorts
by the encoded `executionPath` string. REP JOT never auto-migrates a result, never
substitutes a similar exercise, and never rewrites a stored result to repair a reference. See `../docs/REQUIREMENTS.md`
Section 6.7 through Section 6.12.

## Versioned schemas

The UTC timestamp naming and prescription override rules are part of the first
production v1 contract. The prototype stores no canonical preference, result, or
workout document, so these corrections do not migrate released data. Freeze the v1
schemas when the first production release publishes them. Every later persisted
contract change increments its family version.

Keep a machine-readable schema for every supported version:

```text
schemas/
  exercises/v1.schema.json
  workouts/v1.schema.json
  preferences/v1.schema.json
  results/v1.schema.json
```

Add later versions beside the historical schemas. Do not rewrite a historical schema
to describe a newer contract. A correction to historical acceptance requires review
and regression fixtures.

Increment a family schema version when its canonical contract changes. Examples
include field changes, type changes, reference semantics, required status, validation
semantics, or ownership movement between families.

Do not increment a persisted schema version for UI changes, cache layout changes,
derived indexes, or TypeScript refactoring without a persisted contract change.

## Drive migration atomicity

Drive cannot atomically migrate several files. Batch requests reduce requests but do
not create a transaction. The practical write boundary is one Drive file.

Consequently, `preferences.json` and every result shard must remain independently valid
and readable. A mixed set of supported versions is valid. A migration can control its
in-memory order, but it cannot require an atomic multi-file overwrite.

If a future feature requires an all-or-none multi-file change, use immutable generation
files and one commit record. Readers must ignore incomplete generations. An
application-wide schema version is not a transaction protocol.

## Safe single-file write-back

Use this sequence for a preference file or result shard:

1. Apply the user edit to a new object in memory.
2. Validate the complete output.
3. Persist the working document, base copy, and pending delta in one local transaction.
4. Read the latest Drive content and retain the Drive file ID and metadata.
5. Parse and validate the exact remote document.
6. Compare its content with the cached base and run the keyed-map merge.
7. Validate the merged output.
8. Serialize, parse, and validate the output again.
9. Update the retained file ID without deleting and recreating the file.
10. Read Drive after upload and after an ambiguous response.

Only the normal save path writes a migrated document. A read-only migration stays in
memory. Keep the working document and pending delta until the remote commit is known.

### Merge policy on write-back

Before write-back, compute the local delta from base to local and the remote delta
from base to remote. Apply the remote delta to a copy of the base. Then apply the
local delta by keyed entry. The conflict unit is one session, or one
exercise-and-dimension preference mapping.

A conflict exists when both deltas touch a path under the same conflict unit. The
client does not field-merge that unit.

The last device to synchronize wins. On a conflict, the client replaces the merged
entry with its own local version in full. An edit beats a delete regardless of which
side contains the edit. Thus, a local edit beats a remote delete, and a remote edit
beats a local delete.

REP JOT creates no sync copy. It mints no new session ID and adds no label.

Merge preferences by exercise and dimension. If both sides changed the same mapping,
the pending local value wins because this client performs the later synchronization.
Neither policy requires a reconciliation UI.

### No compare-and-swap

A metadata recheck reduces stale writes but does not make `files.update` a
compare-and-swap transaction. The Google Drive v3 REST reference defines no
`If-Match` conditional write for file content. REP JOT must not assume one exists.

Instead, verify after upload:

1. Upload the merged document.
2. Read the file back and confirm that the content matches what the client wrote.
3. On a mismatch or an upload error, re-read the remote file, re-run the merge from a
   fresh base, and re-upload.
4. Retry at most three times.
5. After three failed attempts, show `Sync failed` and keep every pending local edit.

After a successful read-back, one local transaction stores the confirmed merged
content as both the working document and the new base. The same transaction clears
the acknowledged pending delta.

REP JOT accepts the residual race between the final read-back and a simultaneous
write from another device. The last writer wins and the loser detects the mismatch on
its next sync.

## Read and migration policy

Migration occurs in memory before canonical data changes. The application can use a
validated current representation without immediately rewriting its source.

For monthly results:

- Migrate a shard when the application reads it.
- Cache the current representation with its source metadata and schema provenance.
- Write the current shard after successful reconciliation when an edit requires it.
- Write an older shard when a later user edit requires it.
- Do not download or rewrite all history during normal startup.

The migrated cache is reusable only when its account, file ID, remote metadata, current
schema version, and cached validation still match. Otherwise, discard it and rebuild
it from Drive.

## Tests

Keep input and expected-output fixtures for every supported migration. Tests must cover:

- An empty chain at v1 loads, validates, and normalizes without error.
- Every supported version reaches the current version.
- Every migration produces exactly the next valid version.
- Source objects remain unchanged.
- IDs, keyed-map entries, composite result keys, paths, execution paths, sides,
  starting sides, load semantics, measurements, timestamps, reason codes, notes, and
  scores survive.
- Invalid historical input fails before migration.
- A structurally missing required identity and a future version have distinct errors.
- A future-version document is never edited or overwritten by older code.
- Current documents pass without transformation.
- An unresolved current static reference produces a nonfatal diagnostic that identifies the reference.
- Serialization and parsing preserve validity.
- Monthly shards migrate independently.
- A keyed map round-trips without index drift after a simulated concurrent merge.
- A composite result key that does not match its value fails validation.
- Nonstandard detailed scores and result uniqueness rules remain valid.

Each production migration defect requires a regression fixture.

## Failure and recovery

- Migration failure never modifies a Drive document.
- Validation errors identify the document, version, and path when available.
- A future-version document is never rewritten by older code.
- A bad migrated cache record is discarded and rebuilt.
- Partial multi-file upgrades remain readable because families and shards migrate independently.
- Ambiguous uploads require a Drive read before retry.
- Migrations preserve schema-permitted user data.
- Automatic recovery never invents IDs or workout results.
- An unresolved static reference shows the error card. It never blocks the app.

## Related specification

See [Storage and Lookup Architecture](./storage-and-lookup.md) for file ownership,
monthly shards, the keyed-map shapes, the local storage façade, synchronization, and
indexes.
