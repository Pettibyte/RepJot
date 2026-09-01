# Phase 37: Implement pure result three-way merge

## 1. Mission

Preserve different-ID edits, tombstones, equal changes, and both live versions of same-ID conflicts. This task owns JSON specification invariant 21.

## 2. Prerequisites and scope

The parent judge must accept Phase 36 before this phase starts.

This phase covers one task in the merge and synchronization workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P37-T01 — Implement pure result three-way merge**
  - **Objective:** Preserve different-ID edits, tombstones, equal changes, and both live versions of same-ID conflicts. This task owns JSON specification invariant 21.
  - **Inspect:** Requirements 4.6, 4.8, 11.14, 11.23-11.24 and Architecture result policy.
  - **Create or edit:** `src/sync/merge-results.ts`, `tests/merge-results.test.ts`, and result fixtures.
  - **Steps:** Compute changes from base. Union tombstones first. Remove matching live sessions. Merge different IDs. Collapse equal live changes. For divergent same-ID changes, keep remote original and request a reserved ID for the local sync copy. Preserve status and timestamps and set `conflictOfSessionId`.
  - **Edge cases:** Cover tombstone/live on either side, both tombstones, null base, local delete plus remote edit, remote delete plus local edit, an existing sync copy, and repeated merge application.
  - **Tests or fixtures:** Add every two-side truth-table case and idempotence cases.
  - **Validation:** `bun test tests/merge-results.test.ts`. Then run `bun run check`.
  - **Acceptance:** Invariant 21 passes in every merge order. No detected live version disappears. Tombstones create no fork. The merge function is pure and needs no storage, clock, or random API.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Invariant 21 passes in every merge order. No detected live version disappears. Tombstones create no fork. The merge function is pure and needs no storage, clock, or random API.

The planned validation is:

- `bun test tests/merge-results.test.ts`. Then run `bun run check`.

Only the parent can change task `P37-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P37-T01`.
