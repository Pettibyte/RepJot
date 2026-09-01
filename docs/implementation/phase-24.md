# Phase 24: Implement account lifecycle cleanup

## 1. Mission

Retain, isolate, or clear account records according to the selected account action.

## 2. Prerequisites and scope

The parent judge must accept Phase 23 before this phase starts.

This phase covers one task in the indexeddb persistence workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P24-T01 — Implement account lifecycle cleanup**
  - **Objective:** Retain, isolate, or clear account records according to the selected account action.
  - **Inspect:** Architecture Sections 8, 10, and 15 and Requirements 2.12, 21.4, and 21.6.
  - **Create or edit:** Account repository lifecycle methods and `tests/account-repository.test.ts`.
  - **Steps:** Implement select, deselect, and clear-one-account operations. Make clear-one-account remove records from all eight stores in one transaction. Keep all other namespaces. Do not expose cached private data before selection.
  - **Edge cases:** Cover sign-out retention, account switch, disconnect cleanup request, delete-all cleanup request, partial transaction abort, and a second account.
  - **Tests or fixtures:** Add a full store population for accounts A and B.
  - **Validation:** `bun test tests/account-repository.test.ts`. Then run `bun run check`.
  - **Acceptance:** Sign-out leaves bytes but denies access. Clear account A removes all A records and leaves all B records unchanged.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Sign-out leaves bytes but denies access. Clear account A removes all A records and leaves all B records unchanged.

The planned validation is:

- `bun test tests/account-repository.test.ts`. Then run `bun run check`.

Only the parent can change task `P24-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P24-T01`.
