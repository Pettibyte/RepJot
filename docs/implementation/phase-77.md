# Phase 77: Implement Delete All User Data and disconnect UI

## 1. Mission

Present separate, accurate destructive flows with safe partial-failure behavior.

## 2. Prerequisites and scope

The parent judge must accept Phase 76 before this phase starts.

This phase covers one task in the product screens workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P77-T01 — Implement Delete All User Data and disconnect UI**
  - **Objective:** Present separate, accurate destructive flows with safe partial-failure behavior.
  - **Inspect:** Requirements 21.3-21.7 and Architecture Section 10.
  - **Create or edit:** Settings destructive components and `tests/ui/settings-destructive.test.ts`.
  - **Steps:** Require exact typed phrase before delete. Reauthorize if facade requests it. Show progress and partial deletion without clearing UI state. Keep OAuth grant unless separately disconnected. Expose tested sign-out and account-switch actions through the auth facade. For disconnect, explain scope, call revocation facade, clear after confirmation, and show Google Account connections fallback on failure.
  - **Edge cases:** Wrong phrase, expired token, partial remote delete, unknown files, local clear failure, offline revocation, timeout, repeated action, and account switch during flow.
  - **Tests or fixtures:** Use account-data and auth fakes with every failure stage.
  - **Validation:** `bun test tests/ui/settings-destructive.test.ts`. Then run `bun run check`.
  - **Acceptance:** Delete and disconnect remain separate. Neither flow claims success early. Unknown appData files survive delete.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Delete and disconnect remain separate. Neither flow claims success early. Unknown appData files survive delete.

The planned validation is:

- `bun test tests/ui/settings-destructive.test.ts`. Then run `bun run check`.

Only the parent can change task `P77-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P77-T01`.
