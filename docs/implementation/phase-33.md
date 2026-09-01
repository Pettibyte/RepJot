# Phase 33: Group recognized names and coordinate duplicate cleanup

## 1. Mission

Own catalog classification and safe cleanup mechanics while deferring content merge policy to Phases 36-46.

## 2. Prerequisites and scope

The parent judge must accept Phase 32 before this phase starts.

This phase covers one task in the authentication and drive adapters workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P33-T01 — Group recognized names and coordinate duplicate cleanup**
  - **Objective:** Own catalog classification and safe cleanup mechanics while deferring content merge policy to Phases 36-46.
  - **Inspect:** Architecture Section 11 Duplicate Consolidation and conflict requirements.
  - **Create or edit:** `src/drive/drive-catalog.ts`, `src/drive/duplicate-coordinator.ts`, `src/ports/duplicate-content-consolidator.ts`, and `tests/drive-catalog.test.ts`.
  - **Steps:** Recognize exact canonical names. Preserve unknown entries. Group duplicates. Select the lexicographically smallest file ID only as primary. Download and validate every copy through the pipeline. Invoke an injected consolidator. Preflight every metadata record. Update/read primary, delete unchanged redundant IDs, then relist.
  - **Edge cases:** Block corrupt, unsupported, family-mismatched, repeatedly changing, or deletion-raced groups. Never delete an unknown file. Never treat primary selection as content selection.
  - **Tests or fixtures:** Use a fake consolidator that proves all valid inputs reach it. Add metadata-change barriers and partial-delete cases.
  - **Validation:** `bun test tests/drive-catalog.test.ts tests/drive-rest-adapter.test.ts`. Then run `bun run check`.
  - **Acceptance:** Catalog mechanics preserve every input until a validated consolidated primary exists. Unsafe groups return `DuplicateDriveFileError`.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Catalog mechanics preserve every input until a validated consolidated primary exists. Unsafe groups return `DuplicateDriveFileError`.

The planned validation is:

- `bun test tests/drive-catalog.test.ts tests/drive-rest-adapter.test.ts`. Then run `bun run check`.

Only the parent can change task `P33-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P33-T01`.
