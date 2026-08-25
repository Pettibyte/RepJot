# Schema Versioning and Data Migration

## Status

Proposed implementation specification for versioning and upgrading REP JOT's
JSON-backed persistent documents.

This specification applies to canonical documents stored in Google Drive, documents
read from the static bundle, and cached copies in IndexedDB. Google Drive remains the
source of truth for user data. IndexedDB and in-memory representations remain
rebuildable projections.

## Goals

- Load every explicitly supported historical document version.
- Upgrade old data deterministically to the application's current format.
- Prevent an older application from overwriting data authored by a newer application.
- Detect malformed data at the version where it became malformed.
- Keep migrations testable without Drive, IndexedDB, the DOM, or the UI.
- Preserve user data if migration, validation, synchronization, or persistence fails.
- Allow exercises, programming, preferences, and results to evolve independently.

## Core model

Each document family has its own monotonically increasing integer version and its own
ordered migration chain:

```text
loaded v1 -> migrate 1-to-2 -> migrate 2-to-3 -> validate current v3
```

Do not implement a matrix of direct conversions such as v1-to-v5, v2-to-v5, and
v3-to-v5. Each migration accepts one known version and produces exactly the next
version. The loader repeatedly applies those migrations until it reaches the current
version.

Versions always move forward. REP JOT does not downgrade persisted documents.

## Version ownership: no global schema version

REP JOT must not apply one persisted schema version to the entire application or data
set. Schema versions belong to document families:

```ts
const CURRENT_EXERCISES_SCHEMA_VERSION = 2;
const CURRENT_PROGRAMMING_SCHEMA_VERSION = 3;
const CURRENT_PREFERENCES_SCHEMA_VERSION = 1;
const CURRENT_RESULTS_SCHEMA_VERSION = 4;
```

Every individual JSON file declares the version of its own family. All result shards
share the `repjot/results` format definition, but different shards may temporarily be
stored at different versions:

```text
results-2026-06.json  repjot/results v2
results-2026-07.json  repjot/results v3
results-2026-08.json  repjot/results v4
```

The current application can load this mixed set by migrating each shard independently
in memory. A crash after writing one upgraded shard therefore does not leave the whole
data set at an undefined partial application version.

Keep these unrelated version concepts distinct:

| Value | Owner | Purpose |
| --- | --- | --- |
| `schemaVersion` | JSON document family | Defines the document's persisted shape and semantics. |
| Drive `version`, checksum, or modification time | Google Drive | Identifies a particular remote file state for synchronization. |
| `contentRevision` | Individual REP JOT document, if introduced | Tracks logical edits to one document; it is not a schema version. |
| IndexedDB cache version | Local cache implementation | Allows disposable browser cache upgrades or replacement. |
| Application/build version | Deployed code | Diagnostics and release identification only. |

Do not use application/build version, Drive version, or `contentRevision` to select a
schema migration.

If a future feature truly requires several files to change as one indivisible data-set
generation, that feature needs the explicit commit protocol described below. It must
not overload `schemaVersion` as a transaction marker.

## Document identity and envelope

Current documents should identify both their family and schema version:

```json
{
  "format": "repjot/results",
  "schemaVersion": 2,
  "sessions": []
}
```

Reserved format identifiers are:

```text
repjot/exercises
repjot/programming
repjot/preferences
repjot/results
```

Each format has an independent version sequence. A results-format change does not
require an exercises-format version increment.

`schemaVersion` describes the persisted JSON contract, not the application release,
the age of the data, or the version of an individual workout. It must be a positive
integer.

The existing version 1 documents do not contain `format`. Their family may be supplied
by the family-specific loader after it has matched a recognized filename. The first
applicable migration should add the format identifier. After that migration, a missing
or mismatched `format` is an error.

A document with no `schemaVersion` is not implicitly version 1. It may be accepted only
through a deliberately implemented and tested unversioned legacy importer.

## Versioned schemas

Retain a machine-readable schema for every supported input and output version. The
intended organization is:

```text
schemas/
  exercises/
    v1.schema.json
    v2.schema.json
  programming/
    v1.schema.json
    v2.schema.json
  preferences/
    v1.schema.json
  results/
    v1.schema.json
    v2.schema.json
    v3.schema.json
```

The existing single-version schema files can move into this structure when the first
format revision is introduced. Historical schemas must not be edited to describe a
newer format. Corrections that change which historical documents are accepted require
careful review and new regression fixtures.

The application must treat parsed JSON as `unknown`. It must never cast an old document
directly to the current TypeScript interface.

## Migration registry

Maintain one registry and current-version constant per document family:

```ts
interface MigrationContext {
  exerciseById: ReadonlyMap<string, Exercise>;
  programmedExerciseByNode: ReadonlyMap<string, ProgrammedExerciseLookup>;
}

type Migration = (document: unknown, context: MigrationContext) => unknown;

const resultsMigrations = new Map<number, Migration>([
  [1, migrateResultsV1ToV2],
  [2, migrateResultsV2ToV3]
]);

const CURRENT_RESULTS_VERSION = 3;
```

The registry key is the migration's input version. A migration registered under `1`
must accept version 1 and produce version 2.

A family loader follows this algorithm:

```ts
function migrateResults(
  rawDocument: unknown,
  context: MigrationContext
): ResultsDocument {
  let document: unknown = rawDocument;
  let version = readAndValidateEnvelope(document, 'repjot/results');

  if (version > CURRENT_RESULTS_VERSION) {
    throw new FutureSchemaVersionError(
      'repjot/results',
      version,
      CURRENT_RESULTS_VERSION
    );
  }

  while (version < CURRENT_RESULTS_VERSION) {
    validateResultsVersion(version, document);

    const migration = resultsMigrations.get(version);
    if (migration === undefined) {
      throw new MissingMigrationError('repjot/results', version, version + 1);
    }

    const migrated = migration(document, context);
    const nextVersion = readAndValidateEnvelope(migrated, 'repjot/results');

    if (nextVersion !== version + 1) {
      throw new InvalidMigrationOutputError(
        'repjot/results',
        version,
        version + 1,
        nextVersion
      );
    }

    validateResultsVersion(nextVersion, migrated);
    document = migrated;
    version = nextVersion;
  }

  return validateCurrentResultsDocument(document);
}
```

The concrete error types are illustrative, but callers must be able to distinguish a
future version, a missing migration, invalid source data, invalid migration output,
and an unsupported legacy version.

## Migration rules

Every migration must:

- accept exactly one known input version;
- return exactly the next version;
- be deterministic for the same document and context;
- create a new document rather than mutate its input;
- preserve all meaningful user data;
- contain no Drive, IndexedDB, network, DOM, or UI operations;
- avoid current time, randomness, and locale-dependent behavior;
- produce output that validates against the next version's schema;
- remain in the codebase while its input version is supported.

If a new required value cannot be derived honestly, migration must fail with a precise
diagnostic or use an explicitly specified neutral representation. It must never invent
fitness history.

Migration functions need not be idempotent because the dispatcher runs each migration
only for its declared input version. The complete loader must be stable for a current
document: loading current data performs validation but no transformation.

## Validation pipeline

The complete loading sequence is:

```text
JSON.parse
    |
    v
validate family and version envelope
    |
    v
validate declared historical schema
    |
    v
run one pure migration
    |
    v
validate next-version schema
    |
    v
repeat until current
    |
    v
validate complete current schema
    |
    v
normalize into in-memory Maps and read models
```

Validating every intermediate version prevents malformed v1 data from surfacing as an
unexplained failure in a later v4 migration.

Keep migration separate from normalization:

- **Migration** converts an old persisted shape to the current persisted shape.
- **Normalization** converts a valid current document into lookup maps, sorted lists,
  UI models, and other disposable projections.

Derived indexes are not part of the persisted schema and do not cause schema-version
increments.

## Cross-document migrations

Prefer migrations that transform one document independently. Cross-document
migrations are harder to make reproducible because their result depends on the exact
reference data supplied as context.

When context is unavoidable, migrate and validate document families in this order:

```text
exercises -> programming -> preferences -> result shards
```

Only current, validated reference documents may be exposed through a read-only
`MigrationContext`.

For example, a results migration that adds `exerciseId` may derive it from the current
`(workoutId, nodeId)` programming lookup. If the programmed node cannot be resolved,
the migration must identify the shard, session, workout, and node that failed. It must
not guess an exercise ID.

If a future migration cannot be made deterministic from current reference documents,
the data model must instead retain the required historical identity or snapshot before
that migration becomes necessary.

Cross-document dependencies may control migration order in memory, but they must not
require several Drive files to be overwritten atomically. Old and new persisted
versions must remain independently readable. If an invariant cannot tolerate a mixed
set of file versions, redesign the format or use a data-set generation commit rather
than an ordinary schema migration.

## Drive atomicity and safe write-back

### Atomicity boundary

The practical atomicity boundary is one Drive file update. A successful
`files.update` replaces one file's content and returns the resulting file resource. A
failed request must be treated as though the intended write did not commit until a
subsequent read proves otherwise.

Google Drive batch requests reduce network round trips; they are not a transaction
across independent files. REP JOT must not assume that uploading exercises,
programming, preferences, and result shards in one batch makes those writes all-or-none.

Consequently, normal REP JOT operations are designed to commit one logical document:

- completing or editing a workout updates one monthly result shard;
- changing preferences updates only `preferences.json`;
- editing programming updates only `programming.json`;
- schema migration writes each independently valid document separately.

This is atomic enough for interruption safety: after a crash, each Drive file is either
the older valid document or the newer valid document, and the loader understands both
schema versions. It is not, by itself, a serializable multi-device transaction.

### Safe single-document update

Use the following procedure for every canonical write, including migration write-back:

1. Read the file content and record its Drive file ID, `version`, checksum, and
   modification time.
2. Parse and validate the exact source document.
3. Apply the user's edit or pure migration to a new in-memory object.
4. Validate the complete output against its declared schema.
5. Serialize it, parse the serialized bytes again, and validate again. This catches
   accidental non-JSON values and serialization changes before upload.
6. Immediately re-fetch remote metadata. Abort and reconcile if it differs from the
   metadata recorded in step 1.
7. Update that one Drive file by ID. Never implement an update by deleting the old file
   and creating another with the same name.
8. Treat an ambiguous network failure as an unknown outcome. Re-read the file rather
   than blindly retrying an edit that might not be idempotent.
9. Read back or otherwise verify the committed Drive metadata and content checksum.
   Confirm that the persisted document has the expected family, schema version, and
   logical content.
10. Only after verification, replace the corresponding IndexedDB cache record and
    update in-memory indexes.

The old valid IndexedDB record should remain available until the remote commit is
verified. The cache may then be replaced in a single IndexedDB transaction.

### Optimistic concurrency limitation

The metadata comparison above detects most stale writes but does not eliminate the
race between the final metadata read and `files.update`. The current Drive v3 file
resource does not expose the v2 `etag` field, and this design must not assume a
compare-and-swap `If-Match` media upload without a separately verified and documented
Drive guarantee.

Therefore monthly shards initially support one active writer with stale-write
detection, not unrestricted simultaneous editing from multiple devices. Before saving,
the application should re-read the latest shard, merge sessions by stable session ID,
and stop for user-visible reconciliation when the same session changed in both copies.

If simultaneous append-heavy use becomes important, prefer one immutable file per
completed session or an append-only commit design. Those approaches avoid multiple
devices rewriting the same monthly JSON blob.

### Multi-file all-or-none changes

Drive does not provide a transaction that atomically replaces several arbitrary files.
If REP JOT ever requires a true all-or-none data-set change, use immutable generations:

1. Generate a unique generation ID.
2. Upload every new document under unique immutable file IDs and include its checksum
   in a proposed generation record.
3. Download and validate every uploaded file.
4. Publish one small commit record that references the complete generation only after
   all files exist and validate.
5. Readers ignore uncommitted generation files and continue using the preceding valid
   generation.
6. If two commits claim the same parent generation, report concurrent branches and
   reconcile them; never choose one silently.

The commit record makes publication logically atomic because an incomplete generation
is unreachable. It adds catalog, retention, garbage-collection, and concurrency
complexity and is not required for the current independently versioned document model.
An application-wide schema version is not a substitute for this commit record.

## Read, migrate, and persist lifecycle

Migration happens entirely in memory before any canonical data is changed:

1. Read the remote or cached bytes and retain their Drive metadata.
2. Parse the JSON as `unknown`.
3. Validate and migrate into new objects.
4. Validate the complete current document.
5. Make the validated document available to the application.
6. Build disposable lookup indexes.
7. Only then consider persisting the upgraded form.

Never overwrite the only remote copy while migration is still underway. A failure at
any step leaves the original Drive file unchanged.

Before writing a migrated document to Drive, follow the safe single-document update
procedure above and the synchronization rules in `storage-and-lookup.md`. A failed or
ambiguous upload must not update cached remote metadata until Drive has been read back
and the committed outcome is known.

## Monthly shard migration policy

Each `results-YYYY-MM.json` shard is independently versioned and migratable.

To avoid rewriting years of history after an application upgrade:

- migrate a shard in memory when it is read;
- cache its validated current representation in IndexedDB together with the source
  Drive checksum/version and original schema version;
- persist the current month's upgraded shard after successful reconciliation;
- persist an older upgraded shard when the user next edits it;
- optionally provide an explicit storage-maintenance operation to upgrade all shards.

Normal startup must not download or rewrite every historical shard solely to update its
schema. Lazy history loading and lazy migration use the same shard traversal described
in `storage-and-lookup.md`.

## Cache behavior

IndexedDB may cache a migrated current representation while Drive still contains an
older version. The cache record must retain enough provenance to prove what remote
document produced it:

```ts
interface MigratedDocumentCacheRecord {
  accountKey: string;
  fileId: string;
  name: string;
  remoteModifiedTime: string;
  remoteChecksum?: string;
  remoteVersion?: string;
  sourceSchemaVersion: number;
  currentSchemaVersion: number;
  content: unknown;
}
```

The migrated cache is reusable only when:

- its account and Drive file ID still match;
- its remote metadata still matches the Drive catalog;
- its `currentSchemaVersion` equals the running application's current version;
- its cached content still validates.

Otherwise, discard or replace it. Clearing all IndexedDB data must never lose canonical
user data.

## Version handling rules

### Missing version

Reject the document unless a dedicated unversioned importer exists for that document
family. Do not infer a version through casual shape checks.

### Older supported version

Validate it and walk the sequential migration chain to current.

### Older unsupported version

Report the oldest supported version and require a dedicated legacy importer or an
older REP JOT release. Do not partially migrate or overwrite it.

### Current version

Validate it without migration.

### Future version

Refuse to open it for editing and never overwrite it. Explain that the data was written
by a newer REP JOT format. Read-only raw export may be offered, but the old application
must not pretend to understand the document.

This rule is particularly important for cached static deployments: a browser may run
an older application bundle against files already upgraded by another device.

## Schema-version increments

Increment a document family's schema version whenever its canonical persisted contract
changes, including:

- adding, removing, or renaming persisted fields;
- changing a field's type, allowed values, default semantics, or required status;
- changing identifier or reference semantics;
- changing how a value must be interpreted even if its JSON shape is unchanged;
- changing validation in a way that makes previously valid documents invalid;
- moving ownership of persisted data between document families.

Do not increment a persisted schema version for:

- UI-only changes;
- in-memory indexes or lookup structures;
- cache-layout changes that can be discarded and rebuilt;
- TypeScript refactoring with no persisted semantic change.

An additive optional field may technically remain backward-compatible, but REP JOT
should still increment the version when the field is part of the canonical contract.
An explicit identity migration is easier to reason about than implicit mixed formats.

## Testing strategy

Retain input and expected-output fixtures for every supported migration:

```text
fixtures/
  migrations/
    results/
      v1-input.json
      v2-expected.json
      v2-input.json
      v3-expected.json
      v1-to-current.expected.json
```

Tests must verify:

- every supported version reaches the current version;
- every individual migration accepts its valid input fixture;
- every migration produces output valid for exactly the next version;
- the complete migration matches the expected current golden file;
- source objects and fixtures are not mutated;
- identifiers, measurements, timestamps, notes, and other meaningful values survive;
- malformed input is rejected before migration;
- missing migration links fail clearly;
- missing, unsupported-old, and future versions fail with distinct diagnostics;
- current documents pass through without transformation;
- cross-document lookup failures identify the offending reference;
- migration followed by serialization and parsing remains valid;
- monthly shards migrate independently.

Each bug discovered in production migration behavior must add a regression fixture
before the fix is accepted.

## Chain retention and compaction

A chain of ten or twenty small migrations is normally inexpensive compared with Drive
access and JSON parsing. Prefer retaining the understandable sequential history.

If long-term maintenance eventually becomes burdensome, establish and document a
support floor:

```text
v1 -> audited legacy importer -> v8 -> v9 -> v10 -> current
```

This is a deliberate chain compaction, not a collection of arbitrary direct-to-current
migrations. The legacy importer requires the same fixtures, validation, and preservation
guarantees as an ordinary migration.

Never remove an old migration merely because most known data has already been upgraded.
Offline devices, backups, and previously untouched result shards may retain historical
versions indefinitely.

## Failure and recovery rules

- Migration failure never modifies the remote Drive document.
- Validation failure reports the document name, declared version, and failing path when
  available.
- Future-version documents are never rewritten by an older application.
- A bad cached migration result is discarded and rebuilt from Drive.
- A partially completed multi-document upgrade is safe because every document remains
  independently readable and versioned.
- A batch of Drive requests is never treated as an atomic multi-file migration.
- An ambiguous upload result is resolved by reading Drive before retrying.
- Unknown fields are preserved only when the applicable historical schema permits them;
  migrations must not silently discard permitted user data.
- No automatic recovery may invent exercise identity, measurements, or workout results.

## Implementation sequence

1. Introduce family-specific loaders that parse JSON as `unknown`.
2. Preserve the existing schemas as explicit version 1 schemas.
3. Add format identifiers in the first new schema versions and migrations.
4. Add version-specific runtime validation and structured errors.
5. Add migration registries and dispatchers for each document family.
6. Add golden fixtures and tests before making the first persisted format change.
7. Store migration provenance in the IndexedDB cache.
8. Implement and integration-test verified single-document Drive write-back.
9. Add stale-write detection and session-level reconciliation before supporting a
   second active device.
10. Add explicit all-storage migration tooling only if operationally useful.

## Related specification

See [Storage and Lookup Architecture](./storage-and-lookup.md) for Drive sharding,
IndexedDB caching, synchronization, and in-memory indexing.

## Drive references

- [Drive `files.update`](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update)
- [Drive API v2 and v3 comparison](https://developers.google.com/workspace/drive/api/guides/v2-to-v3-reference)
- [Drive batch request performance](https://developers.google.com/workspace/drive/api/guides/performance#batch-requests)
