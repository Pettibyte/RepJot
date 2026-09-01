# Phase 23: Expose truthful local save outcomes

## 1. Mission

Let application services distinguish in-progress, durable, and failed local commits.

## 2. Prerequisites and scope

The parent judge must accept Phase 22 before this phase starts.

This phase covers one task in the indexeddb persistence workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P23-T01 — Expose truthful local save outcomes**
  - **Objective:** Let application services distinguish in-progress, durable, and failed local commits.
  - **Inspect:** Requirements 4.1-4.4 and Architecture Section 16 exact status meanings.
  - **Create or edit:** `src/state/local-save-state.ts`, repository result types, and status contract tests.
  - **Steps:** Emit `Saving` before a local transaction. Emit `Saved` only after `transaction.oncomplete`. Return a typed storage error on abort or quota failure. Keep form input outside persistence until commit succeeds.
  - **Edge cases:** Cover request success followed by transaction abort, quota error, database close, retry success, and concurrent saves to one key.
  - **Tests or fixtures:** Add a transaction fake that pauses and aborts after request success.
  - **Validation:** `bun test tests/pending-repository.test.ts tests/storage-contracts.test.ts`. Then run `bun run check`.
  - **Acceptance:** No failed or incomplete transaction reports `Saved`. A retry can persist the same pending intent.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- No failed or incomplete transaction reports `Saved`. A retry can persist the same pending intent.

The planned validation is:

- `bun test tests/pending-repository.test.ts tests/storage-contracts.test.ts`. Then run `bun run check`.

Only the parent can change task `P23-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P23-T01`.
