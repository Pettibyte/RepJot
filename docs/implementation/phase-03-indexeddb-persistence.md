# Phase 3 execution plan: IndexedDB persistence

## 1. Mission

Build account-scoped local persistence with native IndexedDB. Make local user saves transactional and recoverable across reloads.

The phase is complete when repository tests cover account separation, layout upgrades, rollback, quota failure, pending recovery, receipts, deletion, and diagnostic retention. A failed local transaction never produces a `Saved` state.

## 2. Authority and required reading

Read these sources before editing:

- `AGENTS.md`.
- `docs/REQUIREMENTS.md`, Sections 3, 4, 11, 12, 14.6-14.7, and 21.4-21.6.
- `docs/ARCHITECTURE.md`, Sections 2, 4, 6 through 9, 11, 15 through 20, and 19 Phase 3.
- `specs/storage-and-lookup.md`, IndexedDB Cache, Local Diagnostics, User Data Deletion, and Failure and Recovery.
- `specs/schema-versioning.md`, Scope and Ownership, Read Policy, and Failure and Recovery.
- Phase 1 domain contracts and Phase 2 pipeline/provenance contracts.
- Current `package.json`, `bun.lock`, test helpers, and source tree.

Binding decisions:

- Database name is `repjot`. The database layout has its own integer version.
- Every private record uses an opaque `accountKey` namespace.
- Private records stay closed until Drive binds the token to an account.
- Cached canonical state is disposable. Pending edits preserve unsynchronized intent.
- A pending edit stores full base and local copies plus metadata and operation state.
- A user save stores pending content and reserved conflict IDs in one transaction.
- Diagnostic writes use separate transactions and cannot roll back canonical saves.
- Sign-out retains account data but makes it inaccessible.
- Disconnect clears only the selected namespace after confirmed revocation.
- Delete All User Data clears local data only after recognized remote files are absent.

Use Bun and TypeScript only. Keep Svelte/Vite, static `dist/`, ES2019, and Kindle support. Use no SQLite, WebAssembly, optional chaining, or nullish coalescing in the bundle. Use `REP JOT` in user-facing text.

## 3. Starting-state contract

Expected prerequisite outputs:

- Phase 1 current document types and safe diagnostics.
- Phase 2 pipeline results with raw bytes, current models, provenance, and blocked future/invalid states.
- Existing Phase 0 authorization tests remain passing.

Verify with `bun run check`, `bun run test`, `bun run validate:schemas`, and Phase 2 focused tests. Inspect actual exports and avoid duplicate types.

If Phase 2 does not preserve raw bytes and provenance, stop and report the missing contract. If an IndexedDB test dependency is absent, add one reviewed development dependency and update `bun.lock`. Do not replace native production IndexedDB with a library.

## 4. In scope and out of scope

### In scope

- Database open, upgrade, blocked-upgrade, and close behavior.
- All stores and indexes from Architecture Section 8.
- Typed repository interfaces and native adapter implementations.
- Atomic document, pending-edit, sync-copy-ID, receipt, and sync-state transactions.
- Account lifecycle operations.
- Corrupt cache recovery signals and quota-safe errors.
- Bounded, redacted diagnostic ring persistence and JSON export data.
- Persistence-derived local save states for later UI use.

Primary requirement IDs: 3.7, 4.1-4.4, 11.10, 12.11-12.12, 14.6-14.7, 21.4, and 21.6 at the local-storage boundary. This phase owns the Section 20 row for account-scoped cache and pending edits. It owns local diagnostic persistence, not the Settings screen.

### Out of scope

- Drive, OAuth, revocation, synchronization, or merge algorithms.
- Svelte status components or product screens.
- Cross-tab locking claims. IndexedDB is not a distributed mutex.
- Persisted runtime indexes.
- Automatic diagnostic upload or telemetry.

Introduce storage ports for documents, pending edits, sync-copy IDs, receipts, sync state, accounts, and diagnostics. Phase 5 must depend on these ports rather than IndexedDB classes.

## 5. Required deliverables

| Deliverable | Recommended path | Architecture link | Source control |
| --- | --- | --- | --- |
| Repository ports | `src/ports/account-repository.ts`, `src/ports/document-repository.ts`, `src/ports/pending-repository.ts`, `src/ports/diagnostic-repository.ts` | Sections 7 and 20 dependency direction | Yes |
| Database schema | `src/storage/idb-schema.ts` | Sections 8 and 19 Phase 3 | Yes |
| Database adapter | `src/storage/idb-database.ts` | Sections 7, 8, and 17 | Yes |
| Repositories | `src/storage/account-repository.ts`, `document-repository.ts`, `pending-repository.ts`, `diagnostic-repository.ts` | Sections 7 and 8 | Yes |
| Transaction helpers | `src/storage/idb-transaction.ts` | Sections 8 and 17 | Yes |
| Local status contract | `src/state/local-save-state.ts` or an application-neutral equivalent | Sections 16 and 20 | Yes |
| IndexedDB fake setup | `tests/helpers/indexeddb.ts` | Section 17 | Yes |
| Integration tests | `tests/idb-database.test.ts`, `tests/account-repository.test.ts`, `tests/pending-repository.test.ts`, `tests/diagnostic-repository.test.ts` | Sections 17 and 19 Phase 3 | Yes |

Do not commit database dumps, diagnostic exports, or generated test reports. Commit schema constants, migration tests, deterministic fixtures, and fakes.

## 6. Ordered execution tasks

- [ ] **P3-T01 — Define storage records and ports**
  - **Objective:** Separate application-facing repository contracts from IndexedDB request objects.
  - **Prerequisites:** Phases 1 and 2 complete.
  - **Inspect:** Architecture Section 8 store table and pending-edit sketch.
  - **Create or edit:** Files under `src/ports/`, `src/storage/idb-schema.ts`, and `tests/storage-contracts.test.ts`.
  - **Steps:** Define keys and records for all eight stores. Use explicit UTC field names. Keep raw source bytes, current model, metadata, provenance, attempts, next retry, safe error, and receipt digest fields.
  - **Edge cases:** Model a missing remote base with `null`. Keep optional Drive metadata distinct from absent files. Do not put tokens or display names in pending edits or diagnostics.
  - **Tests or fixtures:** Add compile-time and runtime key-shape tests with two accounts and two shards.
  - **Validation:** `bun test tests/storage-contracts.test.ts`; `bun run check`.
  - **Acceptance:** Ports import only domain/shared types. They expose no `IDBRequest`, `IDBTransaction`, DOM, or Svelte type.

- [ ] **P3-T02 — Open and upgrade the native database**
  - **Objective:** Create every required store and index in one versioned upgrade path.
  - **Prerequisites:** P3-T01.
  - **Inspect:** Current browser capability report and IndexedDB layout in Architecture Section 8.
  - **Create or edit:** `src/storage/idb-database.ts`, `src/storage/idb-transaction.ts`, `tests/helpers/indexeddb.ts`, and `tests/idb-database.test.ts`.
  - **Steps:** Add typed Promise wrappers around requests and transactions. Create stores and exact indexes. Handle `onblocked`, `versionchange`, abort, close, and open errors. Keep structure upgrades separate from JSON migrations.
  - **Edge cases:** Cover first open, repeat open, old version, blocked upgrade, deleted database, aborted upgrade, and unavailable IndexedDB.
  - **Tests or fixtures:** Use a deterministic IndexedDB fake. Add a synthetic older layout fixture.
  - **Validation:** `bun test tests/idb-database.test.ts`; `bun run check`.
  - **Acceptance:** A fresh database has all stores/indexes. An upgrade changes structure only. Blocked upgrades return a typed recovery action.

- [ ] **P3-T03 — Implement account and document repositories**
  - **Objective:** Read and replace account-scoped cached canonical documents atomically.
  - **Prerequisites:** P3-T02.
  - **Inspect:** Architecture Section 8 account lifecycle and successful-read transaction rules.
  - **Create or edit:** `src/storage/account-repository.ts`, `src/storage/document-repository.ts`, and matching tests.
  - **Steps:** Upsert account metadata. Read by compound key. List only one account. Replace a clean document plus sync metadata in one transaction. Remove clean records absent remotely without touching pending records.
  - **Edge cases:** Cover two accounts with identical logical names, corrupt cached bytes, missing provenance, stale metadata, remote deletion, and transaction abort.
  - **Tests or fixtures:** Add account A/B fixtures and a corrupt cache fixture.
  - **Validation:** `bun test tests/account-repository.test.ts`; `bun run check`.
  - **Acceptance:** No query can return another account's records. Corrupt cache returns a recovery signal and does not become trusted.

- [ ] **P3-T04 — Implement pending edits, reserved IDs, and receipts**
  - **Objective:** Preserve base/local intent and retry identity through reloads.
  - **Prerequisites:** P3-T03.
  - **Inspect:** Architecture Sections 8 and 11 transaction and ambiguous-upload rules.
  - **Create or edit:** `src/storage/pending-repository.ts`, operation receipt methods, and `tests/pending-repository.test.ts`.
  - **Steps:** Save a pending edit and required sync-copy reservations atomically. Implement state transitions `queued`, `uploading`, `ambiguous`, and `failed`. Commit known remote bytes, metadata, receipt, and pending resolution in one transaction.
  - **Edge cases:** Cover null base, repeated reservation, conflicting reservation, reload, partial commit abort, stale operation ID, and failed expected-digest match.
  - **Tests or fixtures:** Add deterministic UUID values and expected digest fixtures.
  - **Validation:** `bun test tests/pending-repository.test.ts`; `bun run check`.
  - **Acceptance:** Reload returns the exact base, local model, state, and reserved ID. A transaction abort changes none of them.

- [ ] **P3-T05 — Expose truthful local save outcomes**
  - **Objective:** Let application services distinguish in-progress, durable, and failed local commits.
  - **Prerequisites:** P3-T04.
  - **Inspect:** Requirements 4.1-4.4 and Architecture Section 16 exact status meanings.
  - **Create or edit:** `src/state/local-save-state.ts`, repository result types, and status contract tests.
  - **Steps:** Emit `Saving` before a local transaction. Emit `Saved` only after `transaction.oncomplete`. Return a typed storage error on abort or quota failure. Keep form input outside persistence until commit succeeds.
  - **Edge cases:** Cover request success followed by transaction abort, quota error, database close, retry success, and concurrent saves to one key.
  - **Tests or fixtures:** Add a transaction fake that pauses and aborts after request success.
  - **Validation:** `bun test tests/pending-repository.test.ts tests/storage-contracts.test.ts`; `bun run check`.
  - **Acceptance:** No failed or incomplete transaction reports `Saved`. A retry can persist the same pending intent.

- [ ] **P3-T06 — Implement account lifecycle cleanup**
  - **Objective:** Retain, isolate, or clear account records according to the selected account action.
  - **Prerequisites:** P3-T03 through P3-T05.
  - **Inspect:** Architecture Sections 8, 10, and 15 and Requirements 2.12, 21.4, and 21.6.
  - **Create or edit:** Account repository lifecycle methods and `tests/account-repository.test.ts`.
  - **Steps:** Implement select, deselect, and clear-one-account operations. Make clear-one-account remove records from all eight stores in one transaction. Keep all other namespaces. Do not expose cached private data before selection.
  - **Edge cases:** Cover sign-out retention, account switch, disconnect cleanup request, delete-all cleanup request, partial transaction abort, and a second account.
  - **Tests or fixtures:** Add a full store population for accounts A and B.
  - **Validation:** `bun test tests/account-repository.test.ts`; `bun run check`.
  - **Acceptance:** Sign-out leaves bytes but denies access. Clear account A removes all A records and leaves all B records unchanged.

- [ ] **P3-T07 — Implement the bounded diagnostic ring**
  - **Objective:** Store redacted support events without affecting canonical saves.
  - **Prerequisites:** P3-T02 and P3-T06.
  - **Inspect:** Architecture Sections 8, 11, 15, and 17 and Requirements 12.11-12.12.
  - **Create or edit:** `src/storage/diagnostic-repository.ts`, diagnostic ports/types, and `tests/diagnostic-repository.test.ts`.
  - **Steps:** Store account-local alias salt and events. Enforce seven days, 500 events, and 256 KiB. Remove oldest events in the append transaction. Create export data without a complete user agent.
  - **Edge cases:** Cover all three limits, equal timestamps, oversized one-event input, clock rollback, append failure, and clear operation.
  - **Tests or fixtures:** Inject a fixed clock and deterministic event IDs. Seed tokens, notes, measurements, raw IDs, URLs, errors, and content into rejected context tests.
  - **Validation:** `bun test tests/diagnostic-repository.test.ts`; `bun run check`.
  - **Acceptance:** Forbidden values never appear in stored or exported JSON. Diagnostic failure does not roll back a separate pending edit.

- [ ] **P3-T08 — Prove reload, rollback, quota, and concurrency behavior**
  - **Objective:** Complete the persistence integration matrix on fresh and reopened databases.
  - **Prerequisites:** P3-T01 through P3-T07.
  - **Inspect:** Architecture Section 17 IndexedDB coverage and Section 19 Phase 3 exit criteria.
  - **Create or edit:** All Phase 3 integration tests and test helpers.
  - **Steps:** Close and reopen between writes and reads. Inject quota and abort errors. Interleave two logical files and two accounts. Test deletion and blocked upgrades. Run all prior regression tests.
  - **Edge cases:** Cover stale handles, same-key concurrent writes, different-shard parallel writes, corrupt cache, pending remote deletion, and browser-storage clearing.
  - **Tests or fixtures:** Use deterministic clocks, UUIDs, storage fakes, and transaction barriers.
  - **Validation:** `bun test tests/idb-database.test.ts tests/account-repository.test.ts tests/pending-repository.test.ts tests/diagnostic-repository.test.ts`; `bun run test`; `bun run check`; `bun run build`; `bun run check:compat`.
  - **Acceptance:** Reload and recovery tests pass. Rollbacks are atomic. Account separation holds. Broad regressions pass.

## 7. Testing matrix

| Requirement or invariant | Level | Cases |
| --- | --- | --- |
| Account-scoped keys | Integration | Same names in A/B, switch, sign-out, clear A |
| Layout upgrades | Integration | Fresh, old version, blocked, aborted, versionchange |
| Local-first save | Integration | Saving, commit, reload, blur caller contract |
| Failed save truth | Negative integration | Quota, abort-after-request, close, retry |
| Pending recovery | Reload integration | Queued, uploading, ambiguous, failed, null base |
| Receipt atomicity | Integration | Known commit, abort, stale digest |
| Remote deletion cache rule | Integration | Clean removed, pending retained |
| Diagnostic ring | Unit/integration | Age, count, bytes, clear, export, append failure |
| Redaction | Negative | Tokens, notes, values, raw IDs, stack, URL query |
| Concurrency | Barrier integration | Same key serialized by caller contract, separate keys isolated |
| Kindle implication | Deferred physical | Open/write, pressure, pagehide/reload, blocked upgrade messaging |

Every test uses deterministic clocks and IDs. Storage tests use a fresh fake database name or full cleanup. No test depends on execution order.

## 8. Commands and gates

```text
bun install --frozen-lockfile
bun run check
bun test tests/idb-database.test.ts tests/account-repository.test.ts tests/pending-repository.test.ts tests/diagnostic-repository.test.ts
bun run test
bun run validate:schemas
bun run validate:static:fixtures
bun run build
bun run check:compat
```

All commands must succeed. Quota and rollback tests must fail the operation without losing prior state. The bundle must remain ES2019-compatible.

## 9. Judge checklist

- Inspect the diff for direct IndexedDB use outside `src/storage/` infrastructure.
- Confirm that repository ports expose no browser types.
- Confirm all compound keys begin with `accountKey` where applicable.
- Inspect upgrade code. It must change structure only, not canonical JSON meaning.
- Review negative tests for request-success/transaction-abort, quota, blocked upgrades, and corrupt cache.
- Confirm that local `Saved` follows transaction completion only.
- Confirm that diagnostics use a separate transaction and never synchronize.
- Confirm that account A cleanup cannot touch account B.
- Run Phase 0-2 regressions and compatibility checks.
- Treat physical Kindle storage pressure as unavailable external evidence.
- Treat cross-account reads, lost pending edits, false `Saved`, or leaked diagnostics as implementation defects.
- Confirm Section 18 gates 1, 2, and 9 remain active.
- Confirm Section 20 account-cache and diagnostic rows have primary evidence.

## 10. Completion report format

```text
Phase 3 completion report
Completed task IDs:
Files changed:
Commands run and results:
Acceptance criteria satisfied:
Remaining risks or blockers:
Manual evidence still required:
```

Include database version, store/index names, and tested upgrade origins. Separate simulated quota evidence from physical Kindle evidence.

## 11. External and manual gates

Do not fabricate physical Kindle IndexedDB behavior, storage-pressure limits, browser cleanup, Google account behavior, Drive outcomes, or deployment evidence.

Physical open/write, quota-pressure, pagehide, and reload tests remain Phase 9 gates. OAuth consent, privacy, legal, production-domain, and deployment approvals also remain external gates.
