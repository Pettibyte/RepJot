# Phase 03 — Schema validation and document pipeline

Build the read path that turns bytes into a trusted current-version document: parse,
recognize the envelope, reject future versions, validate, migrate, revalidate.

## Prerequisites

- Phase 02 for `AppError`, `AppErrorKind`, and the domain types.
- The four v1 schemas in `schemas/` and `bun run check:schemas` passing.

## Goals

1. Compile every family-and-version validator once with Ajv Draft 2020-12 and format
   assertion.
2. Register one migration chain per family, empty at v1, and prove the empty chain
   works.
3. Run one pipeline for every document from every source: Drive, cache, or bundle.
4. Make a future-version document impossible to edit or overwrite.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/validation/schema-validator.ts` | Compiles and caches one validator per `(family, version)`. |
| `src/migrations/migration-registry.ts` | Ordered pure migrations per family. |
| `src/documents/document-pipeline.ts` | The staged read path from bytes to typed document. |
| `src/documents/limits.ts` | Parse size and nesting limits. |

### Signatures

```ts
// src/validation/schema-validator.ts
export type DocFamily =
  | 'repjot/exercises' | 'repjot/workouts'
  | 'repjot/preferences' | 'repjot/results';

export function highestSupportedVersion(family: DocFamily): number;
export function isSupported(family: DocFamily, version: number): boolean;
export function validateAgainst(family: DocFamily, version: number, data: unknown): void;
  // throws AppError('invalid_document') with detail { family, version, issues }
export function validateEnvelope(data: unknown): { family: DocFamily; schemaVersion: number };
  // throws AppError('invalid_document') when format or schemaVersion is missing or malformed
```

```ts
// src/migrations/migration-registry.ts
export interface Migration {
  readonly family: DocFamily;
  readonly fromVersion: number;
  readonly toVersion: number;
  migrate(input: unknown): unknown;   // pure: no Drive, cache, DOM, time, random, or locale
}
export function registerMigration(step: Migration): void;
export function getChain(family: DocFamily): Migration[];      // ordered by fromVersion
export function findStep(family: DocFamily, from: number): Migration | undefined;
```

```ts
// src/documents/document-pipeline.ts
export interface PipelineResult<T> {
  document: T;
  family: DocFamily;
  sourceVersion: number;
  migrated: boolean;
}
export function processDocument<T = unknown>(
  text: string, expectedFamily?: DocFamily): PipelineResult<T>;
export function processJson<T = unknown>(
  raw: unknown, expectedFamily?: DocFamily): PipelineResult<T>;
```

### Pipeline stages

| Stage | Action | Failure |
| --- | --- | --- |
| 1 Parse | `JSON.parse` with the byte limit and nesting depth limit from `limits.ts`. | `AppError('invalid_document')`, detail `reason: 'parse'`. |
| 2 Envelope | Read `format` and positive integer `schemaVersion`. | `AppError('invalid_document')`, detail `reason: 'envelope'`. |
| 3 Family check | When `expectedFamily` is set, it must equal `format`. | `AppError('invalid_document')`, detail `reason: 'family'`. |
| 4 Version gate | Reject `schemaVersion > highestSupportedVersion(family)`. | `AppError('unsupported_schema')`, detail `{ family, declaredVersion, maxSupportedVersion }`. |
| 5 Historical schema | Validate the declared version when it is older than current. | `AppError('invalid_document')` before any migration runs. |
| 6 Migrate | Apply `vN -> vN+1` steps in order. | `AppError('migration')`, detail `{ family, fromVersion, missingStep }`. |
| 7 Current schema | Validate each step output and the final document. | `AppError('invalid_document')` with the migrated view discarded. |
| 8 Normalize | Return the typed current-version document. | — |

### Migration author rules

Encode these as a checklist comment in `migration-registry.ts` and enforce them in
tests for every registered step:

- Accept exactly one known input version and return exactly the next version.
- Return a new object. Never mutate the input.
- Same input produces the same output.
- Touch no Drive, cache, network, DOM, UI, time, random, or locale API.
- Never invent exercise identity, workout identity, measurements, or history.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 5.1 | `validateEnvelope` requires `format` and integer `schemaVersion`. |
| REQUIREMENTS 5.2, 5.3 | One chain per family; all four chains are empty at v1 and load cleanly. |
| REQUIREMENTS 5.4 | Stage 5 validates before migration and stage 7 validates after each step. |
| REQUIREMENTS 5.5 | Stage 4 rejects a newer version and never writes it. |
| REQUIREMENTS 5.6 | The pipeline is read-only. It returns an in-memory view and writes nothing. |
| REQUIREMENTS 5.9, 5.10 | A missing step yields `AppError('migration')`, not silent repair. |
| ARCHITECTURE ADR-005 | Ajv Draft 2020-12 with `assertion: true` on formats. |
| ARCHITECTURE §12 | The eight-stage table above is the architecture table. |
| SPEC schema-versioning "Loader sequence" | Stages 1–8 follow the nine loader steps. |
| SPEC schema-versioning "Newer-version rejection" | Stage 4 error carries family, declared, and max version for `DataError`. |

## Checklist

### Implementation

- [ ] Create `src/documents/limits.ts` with `MAX_DOCUMENT_BYTES` and
      `MAX_NESTING_DEPTH` and a comment that ties them to the Kindle memory budget.
- [ ] Create `src/validation/schema-validator.ts`. Import the four v1 schema JSON
      files statically. Build one Ajv 2020 instance with
      `{ strict: true, discriminator: true }` and `addFormats(ajv, { assertion: true })`.
- [ ] Cache compiled validators in a `Map<string, ValidateFunction>` keyed
      `family@version`.
- [ ] Add a `FAMILY_MAX_VERSION` map so `highestSupportedVersion` needs no schema scan.
- [ ] Create `src/migrations/migration-registry.ts` with the `Migration` interface,
      `registerMigration`, `getChain`, and `findStep`. Register an empty chain for
      all four families.
- [ ] Create `src/documents/document-pipeline.ts` implementing the eight stages.
- [ ] Make every thrown `AppError` carry the document identity in `detail` so the
      `DataError` component can name family, declared version, and max version.
- [ ] Add a note in `schema-validator.ts` about bundle size: if the Ajv cost breaks
      the Phase 20 budget, move schema loading to a runtime `fetch` of bundled
      `data/schemas/*.json` without changing any call site.

### Tests

- [ ] `tests/schema-validator.test.ts`: each family and v1 compiles and validates a
      known-good fixture.
- [ ] `tests/schema-validator.test.ts`: format assertion rejects a `*Utc` field with
      a numeric offset such as `2026-08-15T07:30:00-07:00`.
- [ ] `tests/schema-validator.test.ts`: `validateEnvelope` rejects a missing
      `format`, a missing `schemaVersion`, and a non-integer `schemaVersion`.
- [ ] `tests/document-pipeline.test.ts`: an empty chain at v1 loads, validates, and
      normalizes with `migrated: false`.
- [ ] `tests/document-pipeline.test.ts`: a future `schemaVersion` yields
      `AppError('unsupported_schema')` carrying `declaredVersion` and
      `maxSupportedVersion`.
- [ ] `tests/document-pipeline.test.ts`: a test-only registered `v1 -> v2` step runs,
      and its output validates against a test-only v2 schema.
- [ ] `tests/document-pipeline.test.ts`: a registered step whose input fails stage 5
      never executes the step. Assert with a spy.
- [ ] `tests/document-pipeline.test.ts`: a missing middle step yields
      `AppError('migration')` naming the missing version, and the input object is
      unchanged.
- [ ] `tests/document-pipeline.test.ts`: every registered step is pure. Deep-freeze
      the input and assert no throw and a new object identity on output.
- [ ] `tests/document-pipeline.test.ts`: a document over `MAX_DOCUMENT_BYTES` and a
      document over `MAX_NESTING_DEPTH` fail at stage 1.
- [ ] `tests/document-pipeline.test.ts`: `expectedFamily` mismatch fails with
      `reason: 'family'`.

### Verification

- [ ] `bun run check` passes.
- [ ] `bun test` passes.
- [ ] `bun run check:schemas` passes.
- [ ] `bun run build` passes and the bundle still parses as ES2019.
- [ ] `bun run check:compat` passes.

## Exit criteria

Any byte string in the system reaches a typed document or a typed error through one
function. No caller parses, version-checks, or migrates on its own.
