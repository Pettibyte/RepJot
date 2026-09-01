# Phase 51: Implement unit defaults, conversion, and editable rounding

## 1. Mission

Convert compatible values without avoidable drift or implicit history rewrites.

## 2. Prerequisites and scope

The parent judge must accept Phase 50 before this phase starts.

This phase covers one task in the indexes and session domain workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P51-T01 — Implement unit defaults, conversion, and editable rounding**
  - **Objective:** Convert compatible values without avoidable drift or implicit history rewrites.
  - **Inspect:** Requirements 12.2 and 12.4-12.9 and Architecture ADR-015.
  - **Create or edit:** `src/units/conversion.ts`, `src/units/editable-quantity.ts`, and `tests/unit-conversion.test.ts`.
  - **Steps:** Define exact factors for weight, distance, and duration. Keep full internal precision. Round editable display to nearest `0.1`, exact half upward. Track whether the user edited the rounded text. Default to the first metric-first compatible unit.
  - **Edge cases:** `100 kg`, `5 km`, `90 second`, small positive shown as `0.0`, repeated toggles, explicit zero, incompatible dimension, and single-unit dimensions.
  - **Tests or fixtures:** Add drift cycles and deterministic decimal boundary cases.
  - **Validation:** `bun test tests/unit-conversion.test.ts`. Then run `bun run check`.
  - **Acceptance:** Unedited toggles preserve full precision. Edited text becomes the saved number. Existing saved units remain until edit.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Unedited toggles preserve full precision. Edited text becomes the saved number. Existing saved units remain until edit.

The planned validation is:

- `bun test tests/unit-conversion.test.ts`. Then run `bun run check`.

Only the parent can change task `P51-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P51-T01`.
