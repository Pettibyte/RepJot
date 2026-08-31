# Phase 41: Integrate safe duplicate-content consolidation

## 1. Mission

Preserve every valid copy before redundant Drive IDs are deleted.

## 2. Prerequisites and scope

The parent judge must accept Phase 40 before this phase starts.

This phase covers one task in the merge and synchronization workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P41-T01 — Integrate safe duplicate-content consolidation**
  - **Objective:** Preserve every valid copy before redundant Drive IDs are deleted.
  - **Inspect:** Architecture duplicate algorithm steps 1-9.
  - **Create or edit:** `src/sync/duplicate-content-consolidator.ts`, coordinator integration, and `tests/duplicate-consolidation.test.ts`.
  - **Steps:** For result copies, union tombstones then sessions. Keep primary-file same-ID version under original ID. Fork each distinct secondary version with durable conflict keys. For preferences, merge mappings and use revision/updated time/file-ID tuple for duplicate-only same-key conflicts. Validate candidate before cleanup.
  - **Edge cases:** Cover three distinct same-ID versions, equal copies, tombstone conflicts, invalid copy, unsupported copy, changing redundant metadata, partial delete, new duplicate after relist, and pending local mappings.
  - **Tests or fixtures:** Add deterministic two-copy and three-copy groups with stable aliases.
  - **Validation:** `bun test tests/duplicate-consolidation.test.ts tests/drive-catalog.test.ts`. Then run `bun run check`.
  - **Acceptance:** Deletion starts only after read-back proves the primary preserves all versions. Unsafe groups remain blocked with pending edits intact.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Deletion starts only after read-back proves the primary preserves all versions. Unsafe groups remain blocked with pending edits intact.

The planned validation is:

- `bun test tests/duplicate-consolidation.test.ts tests/drive-catalog.test.ts`. Then run `bun run check`.

Only the parent can change task `P41-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P41-T01`.
