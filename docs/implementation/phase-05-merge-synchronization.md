# Phase 5 execution plan: merge and synchronization

## 1. Mission

Build the local-first reconciliation engine for preferences and monthly result shards. Preserve all detected user intent across concurrency, retries, reloads, duplicate names, and ambiguous Drive outcomes.

The phase is complete when deterministic two-client and three-client suites converge. Tombstones dominate matching live sessions. One conflict key produces one reusable sync-copy UUID. Failed or ambiguous operations retain pending edits until a Drive read proves the outcome.

## 2. Authority and required reading

Read these sources before editing:

- `AGENTS.md`.
- `docs/REQUIREMENTS.md`, Sections 3 through 5, 11.9-11.24, 12.8-12.12, and 21.3-21.7.
- `docs/ARCHITECTURE.md`, Sections 2, 4, 6 through 12, 15 through 20, and 19 Phase 5.
- `specs/storage-and-lookup.md`, Drive Catalog, Synchronization, Local Diagnostics, User Data Deletion, and Failure and Recovery.
- `specs/schema-versioning.md`, Drive Atomicity, Safe Single-File Write-Back, Read Policy, and Failure and Recovery.
- `specs/rep-jot-json-schema-spec.md`, result tombstones, sync copies, preferences, and invariants 19-22.
- Phase 2 pipeline, Phase 3 repository ports, Phase 4 Drive interface, duplicate coordinator, and fakes.

Binding decisions:

- Save local intent before every Drive synchronization attempt.
- Compare base, local, and latest remote content at semantic key granularity.
- Apply tombstones before live sessions. Tombstones never create sync copies.
- Keep the remote changed session under its original ID. Fork the pending local version.
- Reserve a secure sync-copy UUID before candidate construction. Reuse it across reloads and retries.
- Preference same-key conflicts use pending-local arrival order.
- Keep stable Drive IDs and update in place.
- Consolidate duplicate names only when all copies are valid and stable.
- Reserve a Drive ID before create. Reuse it after ambiguous creates.
- Treat metadata preflight as race reduction, not compare-and-swap.
- Read content after known and ambiguous uploads.
- Keep pending edits when the observed remote content differs.
- Serialize one account/logical file. Permit limited reads across different shards.

Use Bun and TypeScript only. Keep Svelte/Vite, static `dist/`, ES2019, and Kindle support. Use no SQLite, WebAssembly, optional chaining, or nullish coalescing in the bundle. Use `REP JOT` in visible text.

## 3. Starting-state contract

Expected outputs:

- Phase 2 pipeline blocks invalid, unsupported, and future documents without changing source bytes.
- Phase 3 repositories preserve base/local copies, operation states, reserved IDs, receipts, and account namespaces.
- Phase 4 Drive adapter supports full catalog pages, read, metadata, generate ID, create with ID, update, delete, and about.
- Phase 4 fakes can pause preflight, update, and post-read.

Verify focused tests for all three phases. Inspect the real interfaces. Run `bun run test` before integration.

If a prerequisite lacks an operation required by the complete reconciliation algorithm, extend its port minimally and add tests in this phase. Do not bypass the port or call IndexedDB or `fetch` directly. If Phase 4 duplicate coordination has no injected content consolidator, stop and report P4-T07 incomplete.

## 4. In scope and out of scope

### In scope

- Pure results and preferences three-way merge.
- Durable conflict fingerprints and sync-copy reservation.
- Full catalog reconciliation and duplicate-content consolidation.
- Clean cache reuse and remote deletion handling.
- Stable update and reserved-ID create protocols.
- Metadata preflight, post-upload read, operation receipts, and ambiguous recovery.
- Retry classification, capped backoff, jitter source, and `Retry-After`.
- Per-account/per-file in-memory serialization.
- Structured diagnostic event service and decision events.
- Application services for raw appData export and recognized remote deletion.
- Convergence, reload, race, and failure integration tests.

Primary requirement IDs: 3.2-3.4, 4.1-4.9, 5.4, 11.14, 11.23-11.24, 12.8-12.12, and 21.3-21.7 at service level. This phase owns Section 20 synchronization, stable-ID consolidation, merge, tombstone, sync-copy, preference, diagnostics, and no-reconciliation-UI service rows.

### Out of scope

- Session creation, plan freezing, score editing, runtime indexes, and screens.
- A reconciliation screen.
- Changes API.
- Claimed atomicity across Drive files or across tabs.
- Automatic diagnostic upload.

Expose narrow synchronization, account-data, and diagnostic facades for Phases 6-8. UI callers must not see Drive or IndexedDB adapters.

## 5. Required deliverables

| Deliverable | Recommended path | Architecture link | Source control |
| --- | --- | --- | --- |
| Result merge | `src/sync/merge-results.ts` | Sections 7, 11, 17, and 20 | Yes |
| Preference merge | `src/sync/merge-preferences.ts` | Sections 7, 11, 17, and 20 | Yes |
| Conflict fingerprint | `src/sync/conflict-key.ts` | Sections 11 and 20 | Yes |
| Sync state machine | `src/sync/sync-operation.ts` | Sections 11, 16, and 19 Phase 5 | Yes |
| Coordinator | `src/sync/sync-coordinator.ts` | Sections 7, 9, 11, 17, and 20 | Yes |
| Duplicate consolidator | `src/sync/duplicate-content-consolidator.ts` | Sections 11 and 20 | Yes |
| Retry policy | `src/sync/retry-policy.ts` | Sections 11 and 16 | Yes |
| Diagnostic service | `src/diagnostics/diagnostic-service.ts` | Sections 7, 11, 15, and 20 | Yes |
| Account-data service | `src/application/account-data-service.ts` | Sections 10, 15, and 20 | Yes |
| Synchronization facade | `src/application/sync-facade.ts` | Sections 7 and 20 | Yes |
| Tests | `tests/merge-results.test.ts`, `merge-preferences.test.ts`, `sync-coordinator.test.ts`, `duplicate-consolidation.test.ts`, `sync-convergence.test.ts`, `diagnostic-service.test.ts`, `account-data-service.test.ts` | Sections 17 and 19 Phase 5 | Yes |

Commit deterministic fakes and fixtures. Do not commit diagnostic exports, raw Drive downloads, tokens, or generated run logs.

## 6. Ordered execution tasks

- [ ] **P5-T01 — Define semantic diffs, canonical equality, and conflict keys**
  - **Objective:** Compare documents at mapping/session granularity without relying on object identity or unstable serialization.
  - **Prerequisites:** Phases 2-4 complete.
  - **Inspect:** Domain types, pipeline normalizers, pending records, and Architecture Result Merge Policy.
  - **Create or edit:** `src/sync/canonical-digest.ts`, `src/sync/conflict-key.ts`, and focused tests.
  - **Steps:** Define canonical serialization with stable key handling. Compare preferences by `(exerciseId, dimension)` and results by session/tombstone ID. Build conflict keys from logical shard, original ID, base digest, local digest, and first remote digest.
  - **Edge cases:** Cover key order differences, equal semantic content with different source bytes, null base, duplicate IDs already rejected, and timestamps as identity-bearing content.
  - **Tests or fixtures:** Add deterministic digest fixtures and reload reconstruction tests.
  - **Validation:** `bun test tests/sync-digests.test.ts`; `bun run check`.
  - **Acceptance:** Equivalent current models compare equal. The same conflict inputs always create the same key without exposing raw IDs in diagnostics.

- [ ] **P5-T02 — Implement pure result three-way merge**
  - **Objective:** Preserve different-ID edits, tombstones, equal changes, and both live versions of same-ID conflicts. This task owns JSON specification invariant 21.
  - **Prerequisites:** P5-T01.
  - **Inspect:** Requirements 4.6, 4.8, 11.14, 11.23-11.24 and Architecture result policy.
  - **Create or edit:** `src/sync/merge-results.ts`, `tests/merge-results.test.ts`, and result fixtures.
  - **Steps:** Compute changes from base. Union tombstones first. Remove matching live sessions. Merge different IDs. Collapse equal live changes. For divergent same-ID changes, keep remote original and request a reserved ID for the local sync copy. Preserve status and timestamps and set `conflictOfSessionId`.
  - **Edge cases:** Cover tombstone/live on either side, both tombstones, null base, local delete plus remote edit, remote delete plus local edit, an existing sync copy, and repeated merge application.
  - **Tests or fixtures:** Add every two-side truth-table case and idempotence cases.
  - **Validation:** `bun test tests/merge-results.test.ts`; `bun run check`.
  - **Acceptance:** Invariant 21 passes in every merge order. No detected live version disappears. Tombstones create no fork. The merge function is pure and needs no storage, clock, or random API.

- [ ] **P5-T03 — Implement preference merge and final revision update**
  - **Objective:** Merge separate mappings and make the pending value win only for same-key conflicts.
  - **Prerequisites:** P5-T01.
  - **Inspect:** Requirements 4.7 and 12.8-12.9 and Architecture Preference Merge Policy.
  - **Create or edit:** `src/sync/merge-preferences.ts`, `tests/merge-preferences.test.ts`.
  - **Steps:** Compute base-local and base-remote changes by mapping. Merge different keys. Select pending local for a changed same key. Increment document revision exactly once and set `updatedAtUtc` only on the final upload candidate through an injected clock.
  - **Edge cases:** Cover mapping deletion if contract permits it, null remote, equal changes, no-op merge, remote higher revision, and repeated retries.
  - **Tests or fixtures:** Use a fixed clock and arrival-order permutations.
  - **Validation:** `bun test tests/merge-preferences.test.ts`; `bun run check`.
  - **Acceptance:** Final arrival order determines same-key value. Retries do not increment revision more than the one candidate operation.

- [ ] **P5-T04 — Reserve sync-copy and create IDs before network writes**
  - **Objective:** Persist all generated identities before candidate construction or upload.
  - **Prerequisites:** P5-T02 and Phase 3 pending repository.
  - **Inspect:** Architecture Section 11 conflict and create ambiguity rules.
  - **Create or edit:** `src/sync/sync-operation.ts`, repository port extensions if required, and `tests/sync-coordinator.test.ts`.
  - **Steps:** Ask an injected secure UUID source for a session ID only when no reservation exists. Commit conflict-key reservation with pending intent. Ask Drive for a file ID and persist it before create. Re-read both reservations after reload.
  - **Edge cases:** Secure random unavailable, reservation transaction failure, duplicate reservation race, ambiguous create, and existing file with reserved ID but different content.
  - **Tests or fixtures:** Use fixed UUIDs and Drive IDs. Simulate reload after reservation and before request.
  - **Validation:** `bun test tests/sync-coordinator.test.ts`; `bun run check`.
  - **Acceptance:** No upload starts before reservation commit. Retry and reload reuse exact IDs. Secure random failure leaves pending intent unchanged.

- [ ] **P5-T05 — Reconcile clean cache and changed remote files**
  - **Objective:** Implement full catalog comparison without touching pending writes.
  - **Prerequisites:** P5-T04 and Phase 4 catalog adapter.
  - **Inspect:** Architecture Complete Reconciliation steps 1-7 and 22.
  - **Create or edit:** `src/sync/sync-coordinator.ts`, `tests/sync-coordinator.test.ts`.
  - **Steps:** Acquire a per-account/per-logical-file mutex. List all pages. Reuse unchanged validated cache. Download missing or changed files through the pipeline. Replace clean records atomically. Remove only clean records for missing recognized remote files.
  - **Edge cases:** Empty account, stale one-hour cache, unknown files, corrupt cache, corrupt remote, future remote, remote deletion with pending edit, and one blocked logical file.
  - **Tests or fixtures:** Use two accounts, multiple shards, and unchanged/changed metadata fixtures.
  - **Validation:** `bun test tests/sync-coordinator.test.ts`; `bun run check`.
  - **Acceptance:** Unaffected files remain usable when one file is blocked. No clean-cache shortcut bypasses metadata or validation rules.

- [ ] **P5-T06 — Integrate safe duplicate-content consolidation**
  - **Objective:** Preserve every valid copy before redundant Drive IDs are deleted.
  - **Prerequisites:** P5-T02, P5-T03, P5-T05, and P4-T07.
  - **Inspect:** Architecture duplicate algorithm steps 1-9.
  - **Create or edit:** `src/sync/duplicate-content-consolidator.ts`, coordinator integration, and `tests/duplicate-consolidation.test.ts`.
  - **Steps:** For result copies, union tombstones then sessions. Keep primary-file same-ID version under original ID. Fork each distinct secondary version with durable conflict keys. For preferences, merge mappings and use revision/updated time/file-ID tuple for duplicate-only same-key conflicts. Validate candidate before cleanup.
  - **Edge cases:** Cover three distinct same-ID versions, equal copies, tombstone conflicts, invalid copy, unsupported copy, changing redundant metadata, partial delete, new duplicate after relist, and pending local mappings.
  - **Tests or fixtures:** Add deterministic two-copy and three-copy groups with stable aliases.
  - **Validation:** `bun test tests/duplicate-consolidation.test.ts tests/drive-catalog.test.ts`; `bun run check`.
  - **Acceptance:** Deletion starts only after read-back proves the primary preserves all versions. Unsafe groups remain blocked with pending edits intact.

- [ ] **P5-T07 — Implement pending-file merge, preflight, upload, and post-read**
  - **Objective:** Execute the complete single-file write protocol with no compare-and-swap claim.
  - **Prerequisites:** P5-T04 through P5-T06.
  - **Inspect:** Architecture synchronization sequence and Complete Reconciliation steps 7-21.
  - **Create or edit:** `src/sync/sync-coordinator.ts`, `src/sync/sync-operation.ts`, and integration tests.
  - **Steps:** Always read latest remote for pending files. Merge base/local/remote. Validate candidate. Serialize, parse, and validate again. Preflight metadata. Restart on change. Mark uploading before request. Update retained ID or create with reserved ID. Read metadata and content after every response. Commit cache, receipt, and pending resolution atomically.
  - **Edge cases:** Cover null remote, preflight race, known response with wrong content, response drop after commit, request drop before commit, post-read overwrite, remote delete, and transaction failure after remote commit.
  - **Tests or fixtures:** Pause fake Drive at every race boundary. Assert receipt and pending state after each outcome.
  - **Validation:** `bun test tests/sync-coordinator.test.ts`; `bun run check`.
  - **Acceptance:** The coordinator never claims CAS. It clears pending intent only after observed expected content and atomic local commit.

- [ ] **P5-T08 — Implement retry, authorization, and serialization policy**
  - **Objective:** Retry only safe transient failures while preserving operation state.
  - **Prerequisites:** P5-T07.
  - **Inspect:** Architecture Retry Behavior and error table.
  - **Create or edit:** `src/sync/retry-policy.ts`, coordinator error paths, and retry tests.
  - **Steps:** Retry network, `429`, and retryable `5xx` with capped exponential backoff and injected jitter. Honor `Retry-After`. Convert `401` and authorization `403` to reauthorization. Do not auto-retry validation, future schema, quota, unsafe duplicates, or semantic errors. Read Drive before ambiguous retries.
  - **Edge cases:** Cover malformed `Retry-After`, max attempts, cancellation, app reload during delay, two calls for one logical file, and parallel separate shards under a small limit.
  - **Tests or fixtures:** Use fake clocks, zero-wait schedulers, fixed jitter, and barriers.
  - **Validation:** `bun test tests/sync-retry.test.ts tests/sync-coordinator.test.ts`; `bun run check`.
  - **Acceptance:** One file has one active sync. Pending state and IDs survive exhaustion. Separate shard reads obey the configured concurrency limit.

- [ ] **P5-T09 — Emit bounded, allowlisted diagnostic events**
  - **Objective:** Record decision evidence without changing synchronization outcomes or leaking user data.
  - **Prerequisites:** P5-T06 through P5-T08 and Phase 3 diagnostic repository.
  - **Inspect:** Architecture Diagnostic Event Capture, ADR-018, and risk R-12.
  - **Create or edit:** `src/diagnostics/diagnostic-service.ts`, event code definitions, coordinator calls, and `tests/diagnostic-service.test.ts`.
  - **Steps:** Create one correlation ID per reconciliation/cleanup. Emit catalog, validation, merge-count, preflight, retry, ambiguity, read-back, commit, and duplicate-stage events. Alias sensitive identifiers with account-local salt. Allow only typed scalar context.
  - **Edge cases:** Diagnostic append failure, alias collision test input, forbidden raw error message, token in caller input, unknown file, and partial cleanup.
  - **Tests or fixtures:** Inject tokens, raw IDs, notes, measurements, content, stack traces, and URL queries. Assert export exclusion.
  - **Validation:** `bun test tests/diagnostic-service.test.ts tests/diagnostic-repository.test.ts`; `bun run check`.
  - **Acceptance:** Logging failure cannot change merge/persistence results. No forbidden value appears in stored/exported JSON.

- [ ] **P5-T10 — Implement raw export and recognized remote deletion services**
  - **Objective:** Give Settings safe services without direct Drive access.
  - **Prerequisites:** P5-T05, P5-T07, and P5-T09.
  - **Inspect:** Architecture Sections 10 and 15 and Requirements 12.10, 21.3-21.4.
  - **Create or edit:** `src/application/account-data-service.ts`, `tests/account-data-service.test.ts`.
  - **Steps:** Export every raw appData file, including unknown names, as individual records. Sanitize local names and suffix duplicate names with a short file-ID alias. For deletion, require the exact confirmation phrase at facade boundary, reauthorize if required, delete every recognized stable ID, relist until absent, then clear local namespace. Keep grant unless disconnect is separately selected.
  - **Edge cases:** Cover unknown files, duplicate names, unsafe names, partial deletion, deletion race, expired token, empty catalog, and local clear failure after remote success.
  - **Tests or fixtures:** Use Drive fakes with unknown and duplicate files. No browser download API belongs here.
  - **Validation:** `bun test tests/account-data-service.test.ts`; `bun run check`.
  - **Acceptance:** Export includes unknown files without interpretation. Delete never removes unknown files and never clears local state after partial remote deletion.

- [ ] **P5-T11 — Prove convergence and ambiguous recovery**
  - **Objective:** Exercise two and three clients in all relevant synchronization orders.
  - **Prerequisites:** P5-T01 through P5-T10.
  - **Inspect:** Architecture Section 17 merge property tests and Phase 5 exit criteria.
  - **Create or edit:** `tests/sync-convergence.test.ts`, property generators in TypeScript, and integration fixtures.
  - **Steps:** Generate different-ID, same-ID, equal, tombstone, and preference edits. Run each order until no pending work remains. Inject reload, known failure, ambiguous-before-commit, ambiguous-after-commit, and final-write races.
  - **Edge cases:** Cover three distinct versions of one session, repeated retries, post-read overwrite, account separation, and duplicate cleanup during pending work.
  - **Tests or fixtures:** Use deterministic seeds, clocks, UUIDs, Drive fakes, storage fakes, and barriers.
  - **Validation:** `bun test tests/sync-convergence.test.ts tests/sync-coordinator.test.ts tests/duplicate-consolidation.test.ts`; `bun run test`; `bun run check`; `bun run build`; `bun run check:compat`.
  - **Acceptance:** No detected live version disappears. Tombstones dominate. One key creates one fork. Reapplication is idempotent. Clients converge after edits stop.

## 7. Testing matrix

| Requirement or invariant | Level | Success, failure, recovery, and concurrency cases |
| --- | --- | --- |
| Different IDs merge | Pure and property | Two/three clients, every order, idempotence |
| Same live ID conflict | Pure/integration | Remote original, local fork, status/timestamps preserved |
| Tombstones | Pure/property | Either side, both sides, stale live, no fork |
| Preference arrival order | Pure/property | Different keys, same key, retries, revision once |
| Stable file IDs | Adapter/integration | Update in place, reserved create, ambiguous create reload |
| Duplicate names | Integration | Valid copies, three versions, corrupt, future, metadata race, partial delete |
| Preflight/post-read | Barrier integration | Change before upload, response drop, overwrite after read |
| Pending recovery | Reload integration | queued, uploading, ambiguous, failed, known remote commit |
| Retry | Fake-clock integration | network, `429`, `5xx`, `Retry-After`, `401`, quota, exhaustion |
| Diagnostics | Unit/integration | Every decision stage, redaction, ring failure, no network |
| Export/delete | Service integration | Unknown export, duplicate suffix, partial delete, relist |
| Kindle implication | Deferred physical | Long sync, offline save, reload, ambiguous recovery |

All concurrency tests use deterministic fake Drive barriers. All generated identities, clocks, jitter, and schedulers are injectable. Keep seeds in failure output.

## 8. Commands and gates

```text
bun install --frozen-lockfile
bun test tests/merge-results.test.ts tests/merge-preferences.test.ts
bun test tests/sync-coordinator.test.ts tests/duplicate-consolidation.test.ts tests/sync-convergence.test.ts
bun test tests/diagnostic-service.test.ts tests/account-data-service.test.ts
bun run check
bun run test
bun run validate:schemas
bun run validate:static:fixtures
bun run build
bun run check:compat
```

All commands must succeed. Negative suites must prove that blocked data is never overwritten and pending edits survive. The bundle must retain Phase 0 and ES2019 gates.

## 9. Judge checklist

- Inspect the diff for direct `fetch` or IndexedDB calls outside adapters.
- Confirm dependency direction from application services to ports to infrastructure.
- Confirm merge modules are pure and import no browser APIs.
- Review every result truth-table case and property invariant.
- Confirm tombstones run before live merge and never create sync copies.
- Confirm reserved IDs commit before candidate construction and survive reload.
- Confirm create uses a reserved Drive ID and update retains the discovered ID.
- Confirm metadata preflight and post-read are present without a CAS claim.
- Review duplicate cleanup ordering and negative metadata-race tests.
- Confirm invalid/future data remains blocked and unchanged.
- Confirm export includes unknown files while delete excludes them.
- Confirm diagnostics contain no tokens, raw IDs, notes, measurements, content, raw errors, or query strings.
- Run all earlier regressions.
- Treat final-write race elimination as unavailable platform capability, not an implementation requirement.
- Treat lost intent, duplicate forks, unsafe delete, false commit, or diagnostic leaks as implementation defects.
- Confirm Section 18 gates 1, 2, 4, and 9 remain active.
- Confirm all Section 20 sync, merge, tombstone, fork, preference, diagnostic, and no-reconciliation rows have evidence.

## 10. Completion report format

```text
Phase 5 completion report
Completed task IDs:
Files changed:
Commands run and results:
Acceptance criteria satisfied:
Remaining risks or blockers:
Manual evidence still required:
```

Report deterministic seeds for any failure. State final-write race risk R-01 explicitly. Do not describe it as solved.

## 11. External and manual gates

Do not fabricate live Drive race behavior, Google quota behavior, network ambiguity, production account data, physical Kindle sync evidence, or deployment evidence.

Deterministic fakes are valid implementation evidence. Physical Kindle, Google Cloud, OAuth consent, privacy, legal, production-domain, security-response, and deployment approvals remain Phase 9 external gates.
