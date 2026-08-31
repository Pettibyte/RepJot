# Phase 46: Prove convergence and ambiguous recovery

## 1. Mission

Exercise two and three clients in all relevant synchronization orders.

## 2. Prerequisites and scope

The parent judge must accept Phase 45 before this phase starts.

This phase covers one task in the merge and synchronization workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P46-T01 — Prove convergence and ambiguous recovery**
  - **Objective:** Exercise two and three clients in all relevant synchronization orders.
  - **Inspect:** Architecture Section 17 merge property tests and Phases 36-46 exit criteria.
  - **Create or edit:** `tests/sync-convergence.test.ts`, property generators in TypeScript, and integration fixtures.
  - **Steps:** Generate different-ID, same-ID, equal, tombstone, and preference edits. Run each order until no pending work remains. Inject reload, known failure, ambiguous-before-commit, ambiguous-after-commit, and final-write races.
  - **Edge cases:** Cover three distinct versions of one session, repeated retries, post-read overwrite, account separation, and duplicate cleanup during pending work.
  - **Tests or fixtures:** Use deterministic seeds, clocks, UUIDs, Drive fakes, storage fakes, and barriers.
  - **Validation:** `bun test tests/sync-convergence.test.ts tests/sync-coordinator.test.ts tests/duplicate-consolidation.test.ts`. Then run `bun run test`. Then run `bun run check`. Then run `bun run build`. Then run `bun run check:compat`.
  - **Acceptance:** No detected live version disappears. Tombstones dominate. One key creates one fork. Reapplication is idempotent. Clients converge after edits stop.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- No detected live version disappears. Tombstones dominate. One key creates one fork. Reapplication is idempotent. Clients converge after edits stop.

The planned validation is:

- `bun test tests/sync-convergence.test.ts tests/sync-coordinator.test.ts tests/duplicate-consolidation.test.ts`. Then run `bun run test`. Then run `bun run check`. Then run `bun run build`. Then run `bun run check:compat`.

Only the parent can change task `P46-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P46-T01`.
