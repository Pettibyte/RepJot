# Phase 73: Implement finish, incomplete, abandon, delete, and terminal editing

## 1. Mission

Complete every session lifecycle action with explicit destructive choices.

## 2. Prerequisites and scope

The parent judge must accept Phase 72 before this phase starts.

This phase covers one task in the product screens workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P73-T01 — Implement finish, incomplete, abandon, delete, and terminal editing**
  - **Objective:** Complete every session lifecycle action with explicit destructive choices.
  - **Inspect:** Requirements 11.9-11.24 and Architecture Workout-Session Lifecycle.
  - **Create or edit:** Active screen action panels/dialog alternatives, confirmation components, and tests.
  - **Steps:** On missing work, offer exact `Return to workout` and `Finish as incomplete` actions. Finish or abandon through the facade. Keep Back as `in_progress`. Confirm deletion, then tombstone. For terminal routes, reuse the editor, label state, preserve status/timestamps, and show current-tree blank additions.
  - **Edge cases:** No missing work, storage failure, repeated action, sync copy, abandoned edit, delete either copy, recorded deprecated path, and route after deletion.
  - **Tests or fixtures:** Add all lifecycle transitions and negative confirmations.
  - **Validation:** `bun test tests/ui/session-lifecycle-screen.test.ts`. Then run `bun run check`.
  - **Acceptance:** No timestamp edit control exists. Terminal saves do not change status or persisted workout times. Delete uses the normal path for original and sync-copy IDs.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- No timestamp edit control exists. Terminal saves do not change status or persisted workout times. Delete uses the normal path for original and sync-copy IDs.

The planned validation is:

- `bun test tests/ui/session-lifecycle-screen.test.ts`. Then run `bun run check`.

Only the parent can change task `P73-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P73-T01`.
