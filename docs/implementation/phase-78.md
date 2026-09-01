# Phase 78: Run complete product-flow and accessibility regression

## 1. Mission

Exercise all screens as one route sequence with reloads and failures.

## 2. Prerequisites and scope

The parent judge must accept Phase 77 before this phase starts.

This phase covers one task in the product screens workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P78-T01 — Run complete product-flow and accessibility regression**
  - **Objective:** Exercise all screens as one route sequence with reloads and failures.
  - **Inspect:** Architecture Sections 17, 19 Phases 67-78, 20, and full diff.
  - **Create or edit:** `tests/ui/product-flow.integration.test.ts` and accessibility tests.
  - **Steps:** Choose, start, enter every type, blur-save, reload active, finish incomplete, edit terminal, view summary/history, export, inspect sync copy, delete, and disconnect. Repeat keyboard-only. Inject storage and sync failures.
  - **Edge cases:** Direct route reload, offline warm cache, account expiry, long deep workout, multiple active sessions, and icon/font failure.
  - **Tests or fixtures:** Deterministic facades, clocks, UUIDs, Drive/storage fakes, and local asset failure modes.
  - **Validation:** `bun test tests/ui/product-flow.integration.test.ts`, `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run build`, `bun run check:compat`.
  - **Acceptance:** Every required screen and destructive flow has automated acceptance evidence. Broad regressions pass.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Every required screen and destructive flow has automated acceptance evidence. Broad regressions pass.

The planned validation is:

- `bun test tests/ui/product-flow.integration.test.ts`, `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run build`, `bun run check:compat`.

Only the parent can change task `P78-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P78-T01`.
