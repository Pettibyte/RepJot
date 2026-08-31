# Phase 71: Connect local save timing and truthful status

## 1. Mission

Debounce normal edits and save immediately at durability boundaries.

## 2. Prerequisites and scope

The parent judge must accept Phase 70 before this phase starts.

This phase covers one task in the product screens workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P71-T01 — Connect local save timing and truthful status**
  - **Objective:** Debounce normal edits and save immediately at durability boundaries.
  - **Inspect:** Requirements 4.1-4.4, Architecture exact status meanings, and Phases 47-57 save facade.
  - **Create or edit:** `src/ui/controllers/edit-save-controller.ts`, Active screen integration, and tests.
  - **Steps:** Keep temporary text until a save action. Debounce normal updates. Save on blur and before route changes. Start the permitted local flush on pagehide without promising completion. Show `Saving`, `Saved`, sync pending detail, and `Sync failed` accurately.
  - **Edge cases:** Rapid input, blur during debounce, route during save, storage quota, sync error after local success, pagehide, and retry.
  - **Tests or fixtures:** Use fake clocks and save barriers. Assert no `Saved` before local transaction completion.
  - **Validation:** `bun test tests/ui/edit-save-controller.test.ts tests/ui/active-workout-screen.test.ts`. Then run `bun run check`.
  - **Acceptance:** Local failure keeps text and shows recovery. Drive failure never discards locally durable edits.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Local failure keeps text and shows recovery. Drive failure never discards locally durable edits.

The planned validation is:

- `bun test tests/ui/edit-save-controller.test.ts tests/ui/active-workout-screen.test.ts`. Then run `bun run check`.

Only the parent can change task `P71-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P71-T01`.
