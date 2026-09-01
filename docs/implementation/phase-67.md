# Phase 67: Define screen view contracts and product acceptance fixtures

## 1. Mission

Cover every result type, status, route, and destructive flow before screen implementation.

## 2. Prerequisites and scope

The parent judge must accept Phase 66 before this phase starts.

This phase covers one task in the product screens workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P67-T01 — Define screen view contracts and product acceptance fixtures**
  - **Objective:** Cover every result type, status, route, and destructive flow before screen implementation.
  - **Inspect:** Facade exports, route table, schemas, and all product requirement IDs.
  - **Create or edit:** `tests/fixtures/product/`, `tests/ui/product-screens.test.ts`, and screen view-model types if needed.
  - **Steps:** Build sanitized fixtures for nested workouts, prescriptions, all measurements, effort, attempts, unilateral results, AMRAP, EMOM, complex scores, notes, skips, incomplete work, three session statuses, tombstones, and sync copies.
  - **Edge cases:** Deep tree, no history, deprecated omission, current-tree terminal addition, missing optional data, and future-file blocked state.
  - **Tests or fixtures:** Use deterministic dates, clocks, UUIDs, and facades. No real user data.
  - **Validation:** `bun test tests/ui/product-screens.test.ts`. Then run `bun run check`.
  - **Acceptance:** A traceability table in test names or fixtures reaches every Phases 67-78 requirement. Fixtures pass schema and semantic validation.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- A traceability table in test names or fixtures reaches every Phases 67-78 requirement. Fixtures pass schema and semantic validation.

The planned validation is:

- `bun test tests/ui/product-screens.test.ts`. Then run `bun run check`.

Only the parent can change task `P67-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P67-T01`.
