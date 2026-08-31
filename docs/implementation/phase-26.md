# Phase 26: Prove reload, rollback, quota, and concurrency behavior

## 1. Mission

Complete the persistence integration matrix on fresh and reopened databases.

## 2. Prerequisites and scope

The parent judge must accept Phase 25 before this phase starts.

This phase covers one task in the indexeddb persistence workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P26-T01 — Prove reload, rollback, quota, and concurrency behavior**
  - **Objective:** Complete the persistence integration matrix on fresh and reopened databases.
  - **Inspect:** Architecture Section 17 IndexedDB coverage and Section 19 Phases 19-26 exit criteria.
  - **Create or edit:** All Phases 19-26 integration tests and test helpers.
  - **Steps:** Close and reopen between writes and reads. Inject quota and abort errors. Interleave two logical files and two accounts. Test deletion and blocked upgrades. Run all prior regression tests.
  - **Edge cases:** Cover stale handles, same-key concurrent writes, different-shard parallel writes, corrupt cache, pending remote deletion, and browser-storage clearing.
  - **Tests or fixtures:** Use deterministic clocks, UUIDs, storage fakes, and transaction barriers.
  - **Validation:** `bun test tests/idb-database.test.ts tests/account-repository.test.ts tests/pending-repository.test.ts tests/diagnostic-repository.test.ts`. Then run `bun run test`. Then run `bun run check`. Then run `bun run build`. Then run `bun run check:compat`.
  - **Acceptance:** Reload and recovery tests pass. Rollbacks are atomic. Account separation holds. Broad regressions pass.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Reload and recovery tests pass. Rollbacks are atomic. Account separation holds. Broad regressions pass.

The planned validation is:

- `bun test tests/idb-database.test.ts tests/account-repository.test.ts tests/pending-repository.test.ts tests/diagnostic-repository.test.ts`. Then run `bun run test`. Then run `bun run check`. Then run `bun run build`. Then run `bun run check:compat`.

Only the parent can change task `P26-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P26-T01`.
