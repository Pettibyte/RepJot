# Phase 21: Implement account and document repositories

## 1. Mission

Read and replace account-scoped cached canonical documents atomically.

## 2. Prerequisites and scope

The parent judge must accept Phase 20 before this phase starts.

This phase covers one task in the indexeddb persistence workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P21-T01 — Implement account and document repositories**
  - **Objective:** Read and replace account-scoped cached canonical documents atomically.
  - **Inspect:** Architecture Section 8 account lifecycle and successful-read transaction rules.
  - **Create or edit:** `src/storage/account-repository.ts`, `src/storage/document-repository.ts`, and matching tests.
  - **Steps:** Upsert account metadata. Read by compound key. List only one account. Replace a clean document plus sync metadata in one transaction. Remove clean records absent remotely without touching pending records.
  - **Edge cases:** Cover two accounts with identical logical names, corrupt cached bytes, missing provenance, stale metadata, remote deletion, and transaction abort.
  - **Tests or fixtures:** Add account A/B fixtures and a corrupt cache fixture.
  - **Validation:** `bun test tests/account-repository.test.ts`. Then run `bun run check`.
  - **Acceptance:** No query can return another account's records. Corrupt cache returns a recovery signal and does not become trusted.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- No query can return another account's records. Corrupt cache returns a recovery signal and does not become trusted.

The planned validation is:

- `bun test tests/account-repository.test.ts`. Then run `bun run check`.

Only the parent can change task `P21-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P21-T01`.
