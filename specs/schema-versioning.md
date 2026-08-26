# Schema Versioning and Data Migration

## Status

This specification defines JSON envelopes, independent family migrations, static-data
compatibility, and safe Drive write-back for REP JOT.

## Scope and ownership

The static bundle owns these documents:

- `exercises.json` with format `repjot/exercises`
- `workouts.json` with format `repjot/workouts`

Google Drive `appDataFolder` owns these user documents:

- `preferences.json` with format `repjot/preferences`
- `results-YYYY-MM.json` with format `repjot/results`

IndexedDB contains disposable cached copies and migrated views. An IndexedDB layout
version is separate from every persisted JSON schema version.

## Document envelope

Every current JSON document declares its family and schema version:

```json
{
  "format": "repjot/results",
  "schemaVersion": 2,
  "yearMonth": "2026-08",
  "sessions": [],
  "sessionTombstones": []
}
```

`schemaVersion` is a positive integer. It defines the persisted shape and semantics of
one format family. It does not identify an application release, a Drive revision, a
cache layout, or a content edit.

A family-specific loader can accept a known legacy document without `format` only
through an explicit and tested importer. A missing `schemaVersion` also requires an
explicit importer. The loader must not infer either value from casual shape checks.

## Independent family versions

Each family owns a monotonically increasing version and an ordered migration chain:

```text
repjot/exercises   v1 -> v2
repjot/workouts    v1 -> v2 -> v3
repjot/preferences v1
repjot/results     v1 -> v2 -> v3
```

A change to one family does not increment another family. Every monthly result shard
migrates independently. Thus, supported shards can remain at different persisted
versions.

REP JOT does not use one application-wide persisted schema version. It never uses a
Drive `version`, checksum, modification time, or application version to select a schema
migration.

## Migration chains

Maintain one current-version constant, schema set, and migration registry for each
family. A migration registered for version 2 accepts only version 2 and produces version
3.

The loader follows this sequence:

1. Parse JSON as `unknown`.
2. Validate the family and version envelope.
3. Reject a future or unsupported version.
4. Validate the declared historical schema.
5. Apply one pure migration.
6. Validate the next envelope and schema.
7. Repeat until the current version.
8. Validate the complete current document.
9. Normalize it into disposable application models.

Do not create a matrix of direct conversions to the current version. Retain each
migration while its input version remains supported.

Every migration must:

- Accept exactly one known input version.
- Return exactly the next version.
- Produce a new object without changing its input.
- Produce the same output for the same input and context.
- Preserve meaningful user data.
- Avoid Drive, IndexedDB, network, DOM, UI, time, random, and locale operations.
- Produce output that validates against the next schema.
- Fail with a precise diagnostic when a required value cannot be derived.

A migration must not invent workout identity, exercise identity, measurements, or
history. Migration and normalization remain separate operations. Derived indexes never
cause a persisted schema-version increment.

## Result migrations and references

Current result documents directly store these identities:

- A session stores `workoutId`.
- Each exercise result stores `workoutId` and `exerciseId`.
- Each exercise result stores its full `executionPath`, optional unilateral side, explicit unit, and load value.
- Each scored-container result stores `workoutId` and `executionPath`.
- Each shard stores permanent session-deletion tombstones.

The path identifies repeated ancestors and the terminal workout node. Container results
preserve observed container scores. Exercise results preserve actual values and units.

A supported legacy migration can derive a missing `exerciseId` from the result
`workoutId` and terminal node. It can derive an old flat iteration only when the old
shape maps unambiguously to an execution path. If a reference is missing or ambiguous,
the migration must identify the shard, session, workout, and node, then fail.

Migrate and validate reference families in this order when context is necessary:

```text
exercises -> workouts -> preferences -> result shards
```

Only current, validated static references enter a read-only migration context. New
formats must retain direct historical identity when current static content cannot
reconstruct it reliably.

## Static bundle compatibility

Published exercise, workout, and workout-node IDs are permanent namespace entries.
The build must prevent deletion and reuse of these IDs. Authors can make content
corrections without creating a new ID.

The build downloads the prior production bundle and compares it with the current
bundle. It preserves exercise, workout, and node IDs. It also preserves node type,
parent, exercise reference, container strategy, result-capture contract, and previously
supported measurement dimensions and units.

The build does not compare complete content hashes, labels, instructions, notes, or
prescriptions.

Only `deprecated` represents lifecycle state. A deprecated entity remains in the
bundle and remains resolvable.

A deprecated exercise cannot appear in a new workout. A node absent from the prior
production bundle is new, even when its workout ID already exists. A new session from
an existing workout filters exercises already deprecated at its start and records each
omission with the `deprecated` reason code.

An in-progress session uses its frozen `executionPlan`, so later deprecations do not
change it. Historical results continue to resolve the exercise and workout node. The
build reports workouts and scored or timed containers affected by new deprecations.

A deprecated workout remains available for historical resolution. The UI hides it and
does not permit new sessions from it.

These lifecycle rules are semantic validation rules. Changing lifecycle state does not
permit ID deletion or reuse.

## Versioned schemas

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

Static documents change through a validated application build, not through Drive
migration. Drive migration never writes `exercises.json` or `workouts.json`.

If a future feature requires an all-or-none multi-file change, use immutable generation
files and one commit record. Readers must ignore incomplete generations. An
application-wide schema version is not a transaction protocol.

## Safe single-file write-back

Use this sequence for a preference file or result shard:

1. Read the source bytes and retain the Drive file ID and metadata.
2. Parse and validate the exact source document.
3. Apply the edit or pure migration to a new object.
4. Validate the complete output.
5. Serialize, parse, and validate the output again.
6. Recheck remote metadata immediately before upload.
7. If remote state changed, repeat the read and automatic merge.
8. Update the retained file ID without deleting and recreating the file.
9. Read Drive after an ambiguous response or before retrying.
10. Update IndexedDB only after the remote outcome is known.

Keep the old valid cache record until the remote commit is known. A metadata recheck
reduces stale writes but does not make `files.update` a compare-and-swap transaction.

Before write-back, compare the cached base, local edit, and latest remote content. Apply
permanent tombstones first, then merge live sessions by stable session ID. Changes to
different sessions merge automatically. A tombstone wins over a stale session with the
same ID. If both copies changed the same live session, retain the remote version and
save the pending local version as a labeled sync copy with a new UUID. Persist that UUID
before upload and reuse it on retries.

Merge preferences by exercise and dimension. If both sides changed the same mapping,
the pending local value wins because this client performs the later synchronization.
Neither policy requires a reconciliation UI.

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

## Version handling

| Input | Required behavior |
| --- | --- |
| Missing version | Reject it unless a dedicated importer supports it. |
| Supported older version | Validate it and apply each sequential migration. |
| Unsupported older version | Report the support floor and do not overwrite it. |
| Current version | Validate it without migration. |
| Future version | Do not edit or overwrite it. Report that newer code is required. |

An older cached application can encounter files written by a newer application. It
must not pretend to understand them.

## Tests

Keep input and expected-output fixtures for every supported migration. Tests must cover:

- Every supported version reaches the current version.
- Every migration produces exactly the next valid version.
- Source objects remain unchanged.
- IDs, conflict-copy relationships, paths, execution plans, sides, starting sides, load semantics, measurements, timestamps, tombstones, reason codes, notes, and scores survive.
- Invalid historical input fails before migration.
- Missing links and future versions have distinct errors.
- Current documents pass without transformation.
- Cross-family lookup errors identify the failed reference.
- Serialization and parsing preserve validity.
- Monthly shards migrate independently.
- Static compatibility comparison downloads the prior production bundle.
- ID deletion, reuse, or incompatible identity-field changes fail the build.
- Label, instruction, note, and prescription corrections remain permitted.
- Deprecation behavior matches execution, frozen-plan, and selection rules.
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

## Related specification

See [Storage and Lookup Architecture](./storage-and-lookup.md) for file ownership,
monthly shards, synchronization, caching, and indexes.
