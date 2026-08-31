# Phase 45: Implement raw export and recognized remote deletion services

## 1. Mission

Give Settings safe services without direct Drive access.

## 2. Prerequisites and scope

The parent judge must accept Phase 44 before this phase starts.

This phase covers one task in the merge and synchronization workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P45-T01 — Implement raw export and recognized remote deletion services**
  - **Objective:** Give Settings safe services without direct Drive access.
  - **Inspect:** Architecture Sections 10 and 15 and Requirements 12.10, 21.3-21.4.
  - **Create or edit:** `src/application/account-data-service.ts`, `tests/account-data-service.test.ts`.
  - **Steps:** Export every raw appData file, including unknown names, as individual records. Sanitize local names and suffix duplicate names with a short file-ID alias. For deletion, require the exact confirmation phrase at facade boundary, reauthorize if required, delete every recognized stable ID, relist until absent, then clear local namespace. Keep grant unless disconnect is separately selected.
  - **Edge cases:** Cover unknown files, duplicate names, unsafe names, partial deletion, deletion race, expired token, empty catalog, and local clear failure after remote success.
  - **Tests or fixtures:** Use Drive fakes with unknown and duplicate files. No browser download API belongs here.
  - **Validation:** `bun test tests/account-data-service.test.ts`. Then run `bun run check`.
  - **Acceptance:** Export includes unknown files without interpretation. Delete never removes unknown files and never clears local state after partial remote deletion.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Export includes unknown files without interpretation. Delete never removes unknown files and never clears local state after partial remote deletion.

The planned validation is:

- `bun test tests/account-data-service.test.ts`. Then run `bun run check`.

Only the parent can change task `P45-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P45-T01`.
