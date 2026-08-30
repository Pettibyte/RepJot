# Phase 2 execution plan: document pipeline and migrations

## 1. Mission

Build one pure pipeline that parses, recognizes, validates, migrates, validates again, and normalizes each canonical document independently.

The phase is complete when every current v1 family loads through the same ordered stages. Invalid, unsupported-old, and future inputs remain byte-for-byte unchanged. The registry can accept future sequential migrations without changing pipeline control flow.

## 2. Authority and required reading

Read these sources before editing:

- `AGENTS.md`.
- `docs/REQUIREMENTS.md`, Sections 3, 5, 6, and 7.
- `docs/ARCHITECTURE.md`, Sections 2, 4, 6 through 8, 9, 12, 16 through 20, and 19 Phase 2.
- `specs/schema-versioning.md`, in full.
- `specs/storage-and-lookup.md`, Document Envelopes, Loading Policy, Failure and Recovery, and related migration rules.
- `specs/rep-jot-json-schema-spec.md`, Shared Rules, Reference Relationships, and Validation Invariants.
- All schemas and all Phase 1 validation code, tests, and fixtures.
- `package.json`, `tsconfig.json`, and `vite.config.ts`.

Apply Architecture Section 2 precedence. Do not infer a family or version from object shape. Do not use Drive metadata to select a migration.

Binding decisions:

- Validate source bytes against the declared historical schema before migration.
- Apply only pure, ordered `vN -> vN+1` steps.
- Validate each intermediate document and the final current document.
- Run semantic validation after schema migration with read-only validated context.
- Preserve source bytes and source objects on every error.
- Load context in this order: exercises, workouts, preferences, result shards.
- A migration never writes Drive and never invents identity.
- No released pre-v1 canonical data exists. Do not invent a legacy format or migration.

Use Bun and TypeScript only. Keep Svelte/Vite, static `dist/`, ES2019 output, and Kindle constraints. Use no SQLite or WebAssembly. Do not add optional chaining or nullish coalescing to executable output. Use `REP JOT` for visible branding.

## 3. Starting-state contract

Expected Phase 1 outputs:

- Typed current document contracts and family constants.
- A compiled schema registry and typed diagnostics.
- Static semantic validation and fixtures.
- `validate:schemas`, canonical `validate:static`, fixture `validate:static:fixtures`, and compatibility commands.

Verify these outputs. Run `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run check`, and the Phase 1 tests. Inspect exports instead of assuming their names match this plan.

If a prerequisite is incomplete, stop and report the missing Phase 1 task or acceptance criterion. Do not create a second validator or weaken a schema to continue. If exports use different paths but satisfy the contract, adapt imports and record the actual paths.

Phase 0 remains closed. Preserve all authorization tests.

## 4. In scope and out of scope

### In scope

- Exact byte preservation and strict decoding before JSON parsing.
- JSON parsing as `unknown` with no application-level byte, nesting, or node limit.
- Exact envelope and filename-family recognition.
- Version support-floor and future-version errors.
- Family-specific current-version constants and migration registries.
- Pre-migration, intermediate, post-migration, and semantic validation.
- Provenance for source bytes, source version, migration path, and validator version.
- Disposable normalization and immutable fixtures.
- Static bundle loading through an injected byte source.

Primary requirement IDs: 3.1, 3.3-3.6, 5.1-5.5, 6.17, and 7.4. This phase owns the Section 20 rows for ordered validation/migration and invalid-or-future write protection at the pipeline boundary.

### Out of scope

- IndexedDB cache policy and transactions.
- Drive reads, writes, migration write-back, or synchronization.
- Real historical migration functions before a version exists.
- Runtime indexes, session changes, or screens.
- Product-specific repair of corrupt remote files.

Introduce a `DocumentByteSource` interface for static and remote callers. It returns bytes plus safe source metadata. Introduce pipeline result types that Phase 3 can cache and Phase 5 can use to block writes.

### Resolved limit decision

Release one has unlimited application-level byte, nesting, and node limits. Do not add an arbitrary rejection threshold. Preserve exact source bytes, decode strictly, and use iterative traversals where project code controls traversal. Generate deterministic large and deep test documents instead of committing large fixtures. Phase 9 records measurements, and later on-device stress testing can support a new reviewed limit.

## 5. Required deliverables

| Deliverable | Recommended path | Architecture link | Source control |
| --- | --- | --- | --- |
| Pipeline contracts | `src/documents/pipeline-types.ts` | Sections 7, 12, and 20 | Yes |
| Byte-preserving safe parser | `src/documents/safe-json-parser.ts` | Sections 12, 15, and 17 | Yes |
| Envelope recognizer | `src/documents/envelope.ts` | Sections 7 and 12 | Yes |
| Migration registry | `src/migrations/migration-registry.ts` | Sections 7, 12, and 19 Phase 2 | Yes |
| Family registries | `src/migrations/families/*.ts` | Sections 7 and 12 | Yes |
| Document pipeline | `src/documents/document-pipeline.ts` | Sections 7, 17, and 20 | Yes |
| Static loader and bundle adapter | `src/documents/static-loader.ts`, `src/infrastructure/bundle-byte-source.ts` | Sections 7 and 9 | Yes |
| Historical fixture structure | `tests/fixtures/migrations/<family>/vN/` | Section 17 | Yes |
| Tests | `tests/document-pipeline.test.ts`, `tests/migration-registry.test.ts`, `tests/static-loader.test.ts` | Sections 17 and 19 Phase 2 | Yes |

Generated migrated views and test reports do not belong in source control. Historical input and expected-output fixtures do belong in source control after a real version transition exists.

## 6. Ordered execution tasks

- [ ] **P2-T01 — Define pipeline stages and typed errors**
  - **Objective:** Give every pipeline result an explicit stage, provenance record, and safe error category.
  - **Prerequisites:** Phase 1 complete.
  - **Inspect:** Phase 1 diagnostics, Architecture Sections 12 and 16, and schema-versioning Version Handling.
  - **Create or edit:** `src/documents/pipeline-types.ts`, `src/errors/app-error.ts`, and `tests/document-pipeline.test.ts`.
  - **Steps:** Define source identity, expected family, logical name, byte provenance, migration path, validation version, and normalized-model result. Define distinct parse, envelope, unsupported-old, future, schema, migration, and semantic errors.
  - **Edge cases:** Keep missing version separate from malformed version. Keep family mismatch separate from unknown family. Never include raw notes or content in safe messages.
  - **Tests or fixtures:** Add table tests that assert stable error kinds and safe context.
  - **Validation:** `bun test tests/document-pipeline.test.ts`; `bun run check`.
  - **Acceptance:** Callers can branch on error kind without parsing messages. Errors retain no secret or health-data payload.

- [ ] **P2-T02 — Parse exact bytes without application limits**
  - **Objective:** Reject malformed encoding or JSON while preserving source bytes and accepting documents of all application-level sizes and depths.
  - **Prerequisites:** P2-T01.
  - **Inspect:** Architecture Sections 12, 14, and 15, the resolved unlimited-limit decision, and Kindle memory facts.
  - **Create or edit:** `src/documents/safe-json-parser.ts`, generated parser fixtures, and `tests/document-pipeline.test.ts`.
  - **Steps:** Retain the input `Uint8Array` unchanged. Apply the documented byte-order mark policy. Decode UTF-8 strictly. Parse once as `unknown`. Use iterative project traversals where possible. Add no byte, nesting, or node rejection threshold.
  - **Edge cases:** Cover empty bytes, a byte-order mark, invalid UTF-8, malformed JSON, deep arrays, deep objects, huge keys, primitive roots, and platform resource failure.
  - **Tests or fixtures:** Generate deterministic large and deep documents during tests. Keep source-control fixtures small. Test malformed bytes separately from valid stress documents.
  - **Validation:** `bun test tests/document-pipeline.test.ts`; `bun run check`.
  - **Acceptance:** No valid input fails because of a project-defined size, depth, or node count. Malformed encoding and JSON fail safely. Source bytes do not change. Stress measurements are recorded without defining a limit.

- [ ] **P2-T03 — Recognize exact envelopes and logical names**
  - **Objective:** Select a family registry only from validated envelope fields and the expected logical name.
  - **Prerequisites:** P2-T02.
  - **Inspect:** Phase 1 family constants, canonical-name rules, and schema-versioning Document Envelope.
  - **Create or edit:** `src/documents/envelope.ts`, `src/documents/document-pipeline.ts`, and envelope fixtures.
  - **Steps:** Read only own `format` and `schemaVersion` fields from a plain object. Require a positive integer. Match static names and result-name patterns to exact families. Compare result filename and `yearMonthUtc` later in semantic validation.
  - **Edge cases:** Reject inherited fields, arrays, `NaN`-like values, decimal versions, unknown formats, `results-2026-00.json`, and a preferences envelope in a result filename.
  - **Tests or fixtures:** Add one fixture for each distinct error.
  - **Validation:** `bun test tests/document-pipeline.test.ts`; `bun run check`.
  - **Acceptance:** No shape heuristic or Drive metadata influences family/version selection.

- [ ] **P2-T04 — Build sequential family migration registries**
  - **Objective:** Represent support floors and ordered transitions without fake legacy migrations.
  - **Prerequisites:** P2-T03.
  - **Inspect:** `schemas/**`, schema-versioning Migration Chains, and current version constants.
  - **Create or edit:** `src/migrations/migration-registry.ts`, `src/migrations/families/*.ts`, and `tests/migration-registry.test.ts`.
  - **Steps:** Register current v1 schemas for each family. Require every real step to accept exactly version N and return N+1. Detect gaps, duplicate steps, wrong outputs, unsupported-old inputs, and future inputs.
  - **Edge cases:** A current v1 input uses zero transitions. Version 0 is malformed, not legacy. Do not add a no-op `v0 -> v1` migration.
  - **Tests or fixtures:** Use synthetic test-only registries to exercise multi-step sequencing and registry failures.
  - **Validation:** `bun test tests/migration-registry.test.ts`; `bun run validate:schemas`; `bun run check`.
  - **Acceptance:** Production registries contain no invented migration. Synthetic chains prove strict N-to-N+1 behavior.

- [ ] **P2-T05 — Enforce validation before and after every migration**
  - **Objective:** Make stage ordering impossible to bypass through normal pipeline use.
  - **Prerequisites:** P2-T04.
  - **Inspect:** Phase 1 schema/semantic APIs and Architecture Section 12 stage table.
  - **Create or edit:** `src/documents/document-pipeline.ts`, `tests/document-pipeline.test.ts`, and migration fixtures.
  - **Steps:** Validate the declared schema first. Clone or pass read-only validated input to each migration. Validate each next-version output. Run complete current schema validation and semantic validation. Normalize only after success.
  - **Edge cases:** Cover invalid historical input, a migration that mutates input, wrong next version, invalid intermediate output, missing reference context, and invalid final semantics.
  - **Tests or fixtures:** Add synthetic migration spies that prove call order and immutability.
  - **Validation:** `bun test tests/document-pipeline.test.ts tests/migration-registry.test.ts`; `bun run check`.
  - **Acceptance:** The call trace is parse, recognize, historical schema, migration, next schema, final semantic, normalize. Failed inputs remain byte-identical.

- [ ] **P2-T06 — Record provenance and normalize disposable models**
  - **Objective:** Let caches distinguish canonical source bytes from migrated current models.
  - **Prerequisites:** P2-T05.
  - **Inspect:** Architecture Section 8 state layers and schema-versioning Read and Migration Policy.
  - **Create or edit:** `src/documents/normalizers.ts`, pipeline types, and normalization tests.
  - **Steps:** Record source family/version, current version, validator version, migration step IDs, logical name, and source digest through an injected digest service. Keep normalized models read-only and omit no canonical user data.
  - **Edge cases:** Two byte encodings of equivalent JSON can have different source digests. Normalization must not alter persisted quantities, timestamps, ordering, or IDs.
  - **Tests or fixtures:** Add deep-equality tests for all v1 families and immutable source assertions.
  - **Validation:** `bun test tests/document-pipeline.test.ts`; `bun run check`.
  - **Acceptance:** A caller can retain raw bytes and use a separate current model. Normalization never implies write-back.

- [ ] **P2-T07 — Load static families in dependency order**
  - **Objective:** Fetch or read `exercises.json` before `workouts.json` through an injected text source.
  - **Prerequisites:** P2-T06.
  - **Inspect:** Architecture Section 9 startup sequence and Phase 1 static fixtures.
  - **Create or edit:** `src/documents/static-loader.ts`, `src/ports/document-byte-source.ts`, `src/infrastructure/bundle-byte-source.ts`, and `tests/static-loader.test.ts`.
  - **Steps:** Define a byte-source interface and a browser Fetch implementation outside domain code. Fetch an `ArrayBuffer` and preserve its exact `Uint8Array` before strict decoding. Load exact bundle-relative names. Pass validated exercises as read-only semantic context for workouts. Return a blocking startup error if either static family fails.
  - **Edge cases:** Cover missing file, network error from fake source, wrong content type if exposed, valid exercises plus invalid workouts, and repeated calls.
  - **Tests or fixtures:** Use an in-memory source fake with request-order recording.
  - **Validation:** `bun test tests/static-loader.test.ts`, `bun run check`, `bun run validate:static:fixtures`.
  - **Acceptance:** Tests prove exercises load before workouts. Only the infrastructure bundle adapter calls `fetch`. Phase 7 has a concrete static source to inject.

- [ ] **P2-T08 — Complete migration and recovery regression coverage**
  - **Objective:** Prove independent family loading, reload-safe determinism, and non-overwrite behavior.
  - **Prerequisites:** P2-T01 through P2-T07.
  - **Inspect:** Architecture Sections 17, 19 Phase 2, and 20.
  - **Create or edit:** Phase 2 tests and `tests/fixtures/migrations/README.md` if fixture conventions need documentation.
  - **Steps:** Run each family independently and in context order. Re-run failed and successful inputs. Compare original bytes before and after. Test unsupported-old and future errors separately. Preserve all Phase 1 and Phase 0 tests.
  - **Edge cases:** Cover a result shard whose static context is absent, a future preferences file, invalid cached normalized data, and serialization round trips.
  - **Tests or fixtures:** Add current-version pass-through fixtures and synthetic historical fixtures only for test registries.
  - **Validation:** `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run build`, `bun run check:compat`.
  - **Acceptance:** Every family loads independently. Invalid and future source bytes remain unchanged. No fake production migration exists.

## 7. Testing matrix

| Requirement or invariant | Level | Cases |
| --- | --- | --- |
| Unlimited parsing policy | Unit and stress | Malformed encoding/JSON fail; generated large/deep valid inputs have no project-threshold rejection |
| Exact envelope | Unit | Missing, inherited, wrong family, noninteger, unsupported, future |
| Ordered migration | Unit | Zero-step current, synthetic multi-step, gap, wrong next version |
| Validation-before-migration | Spy and fixture | Invalid source never invokes migration |
| Validation-after-migration | Spy and fixture | Invalid intermediate and final outputs stop |
| Immutability | Unit | Frozen object, byte snapshot, repeated load |
| Context order | Integration with fake source | Exercises, workouts, preferences, newest result first |
| Recovery | Integration | Bad cache model rebuild signal, source retained, unaffected family usable |
| Serialization | Unit | Serialize, parse, schema, semantic revalidation |
| Kindle and ES2019 | Bundle | Broad compatibility command, no new syntax or large eager fixture import |

Use deterministic digest fakes and immutable fixtures. No clock or UUID is required for migrations. If provenance timestamps exist, inject a deterministic clock and keep them outside canonical models.

## 8. Commands and gates

```text
bun install --frozen-lockfile
bun run check
bun test tests/document-pipeline.test.ts tests/migration-registry.test.ts tests/static-loader.test.ts
bun run test
bun run validate:schemas
bun run validate:static:fixtures
bun run build
bun run check:compat
```

All commands must succeed. Negative tests must prove distinct failure kinds and unchanged source bytes. The blank first-release and future compatibility gate remains a Phase 1/9 responsibility and must not be weakened.

## 9. Judge checklist

- Inspect the diff for a second schema validator, shape inference, or migration write-back.
- Confirm that every migration path is pure and imports no DOM, clock, locale, random, Svelte, Drive, or IndexedDB module.
- Confirm that schema validation occurs before migration and after every transition.
- Confirm that semantic validation occurs before normalization succeeds.
- Inspect malformed, unsupported-old, future, mutation, and recovery tests.
- Confirm that no real `v0` or speculative legacy migration was invented.
- Confirm that static loading uses an interface and that only a later infrastructure adapter can call `fetch`.
- Run all Phase 0 and Phase 1 regression checks.
- Treat missing approved historical versions as unavailable external evidence, not a defect.
- Treat changed source bytes, bypassed stages, unsafe errors, or inferred identity as implementation defects.
- Confirm Section 18 gates 1-4 and 9 still pass.
- Confirm Section 20 rows for four families, UTC contracts, ordered migration, and future-data protection have tests.

## 10. Completion report format

```text
Phase 2 completion report
Completed task IDs:
Files changed:
Commands run and results:
Acceptance criteria satisfied:
Remaining risks or blockers:
Manual evidence still required:
```

Report actual family registries and versions. State explicitly that no released historical migration exists unless the repository gains authoritative evidence.

## 11. External and manual gates

Do not fabricate historical production documents, migration defects, prior-release bytes, physical Kindle results, Drive behavior, or deployment evidence. Do not convert desktop stress results into a Kindle limit.

This phase needs no Google Cloud or legal approval. Phase 9 records later physical Kindle stress evidence. Privacy, OAuth consent, production-domain, security, and deployment gates remain external.
