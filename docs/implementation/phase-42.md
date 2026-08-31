# Phase 42: Implement pending-file merge, preflight, upload, and post-read

## 1. Mission

Execute the complete single-file write protocol with no compare-and-swap claim.

## 2. Prerequisites and scope

The parent judge must accept Phase 41 before this phase starts.

This phase covers one task in the merge and synchronization workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P42-T01 — Implement pending-file merge, preflight, upload, and post-read**
  - **Objective:** Execute the complete single-file write protocol with no compare-and-swap claim.
  - **Inspect:** Architecture synchronization sequence and Complete Reconciliation steps 7-21.
  - **Create or edit:** `src/sync/sync-coordinator.ts`, `src/sync/sync-operation.ts`, and integration tests.
  - **Steps:** Always read latest remote for pending files. Merge base/local/remote. Validate candidate. Serialize, parse, and validate again. Preflight metadata. Restart on change. Mark uploading before request. Update retained ID or create with reserved ID. Read metadata and content after every response. Commit cache, receipt, and pending resolution atomically.
  - **Edge cases:** Cover null remote, preflight race, known response with wrong content, response drop after commit, request drop before commit, post-read overwrite, remote delete, and transaction failure after remote commit.
  - **Tests or fixtures:** Pause fake Drive at every race boundary. Assert receipt and pending state after each outcome.
  - **Validation:** `bun test tests/sync-coordinator.test.ts`. Then run `bun run check`.
  - **Acceptance:** The coordinator never claims CAS. It clears pending intent only after observed expected content and atomic local commit.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- The coordinator never claims CAS. It clears pending intent only after observed expected content and atomic local commit.

The planned validation is:

- `bun test tests/sync-coordinator.test.ts`. Then run `bun run check`.

Only the parent can change task `P42-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P42-T01`.
