# Phase 40: Reconcile clean cache and changed remote files

## 1. Mission

Implement full catalog comparison without touching pending writes.

## 2. Prerequisites and scope

The parent judge must accept Phase 39 before this phase starts.

This phase covers one task in the merge and synchronization workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P40-T01 — Reconcile clean cache and changed remote files**
  - **Objective:** Implement full catalog comparison without touching pending writes.
  - **Inspect:** Architecture Complete Reconciliation steps 1-7 and 22.
  - **Create or edit:** `src/sync/sync-coordinator.ts`, `tests/sync-coordinator.test.ts`.
  - **Steps:** Acquire a per-account/per-logical-file mutex. List all pages. Reuse unchanged validated cache. Download missing or changed files through the pipeline. Replace clean records atomically. Remove only clean records for missing recognized remote files.
  - **Edge cases:** Empty account, stale one-hour cache, unknown files, corrupt cache, corrupt remote, future remote, remote deletion with pending edit, and one blocked logical file.
  - **Tests or fixtures:** Use two accounts, multiple shards, and unchanged/changed metadata fixtures.
  - **Validation:** `bun test tests/sync-coordinator.test.ts`. Then run `bun run check`.
  - **Acceptance:** Unaffected files remain usable when one file is blocked. No clean-cache shortcut bypasses metadata or validation rules.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Unaffected files remain usable when one file is blocked. No clean-cache shortcut bypasses metadata or validation rules.

The planned validation is:

- `bun test tests/sync-coordinator.test.ts`. Then run `bun run check`.

Only the parent can change task `P40-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P40-T01`.
