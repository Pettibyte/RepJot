# Phase 20: Open and upgrade the native database

## 1. Mission

Create every required store and index in one versioned upgrade path.

## 2. Prerequisites and scope

The parent judge must accept Phase 19 before this phase starts.

This phase covers one task in the indexeddb persistence workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P20-T01 — Open and upgrade the native database**
  - **Objective:** Create every required store and index in one versioned upgrade path.
  - **Inspect:** Current browser capability report and IndexedDB layout in Architecture Section 8.
  - **Create or edit:** `src/storage/idb-database.ts`, `src/storage/idb-transaction.ts`, `tests/helpers/indexeddb.ts`, and `tests/idb-database.test.ts`.
  - **Steps:** Add typed Promise wrappers around requests and transactions. Create stores and exact indexes. Handle `onblocked`, `versionchange`, abort, close, and open errors. Keep structure upgrades separate from JSON migrations.
  - **Edge cases:** Cover first open, repeat open, old version, blocked upgrade, deleted database, aborted upgrade, and unavailable IndexedDB.
  - **Tests or fixtures:** Use a deterministic IndexedDB fake. Add a synthetic older layout fixture.
  - **Validation:** `bun test tests/idb-database.test.ts`. Then run `bun run check`.
  - **Acceptance:** A fresh database has all stores/indexes. An upgrade changes structure only. Blocked upgrades return a typed recovery action.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- A fresh database has all stores/indexes. An upgrade changes structure only. Blocked upgrades return a typed recovery action.

The planned validation is:

- `bun test tests/idb-database.test.ts`. Then run `bun run check`.

Only the parent can change task `P20-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P20-T01`.
