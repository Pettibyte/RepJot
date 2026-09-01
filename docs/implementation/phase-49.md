# Phase 49: Freeze active plans and apply deprecated omission

## 1. Mission

Build an effective immutable tree for each new active session.

## 2. Prerequisites and scope

The parent judge must accept Phase 48 before this phase starts.

This phase covers one task in the indexes and session domain workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P49-T01 — Freeze active plans and apply deprecated omission**
  - **Objective:** Build an effective immutable tree for each new active session.
  - **Inspect:** Requirements 6.5-6.12, Architecture ADR-019, and resolved deprecated-container case.
  - **Create or edit:** `src/sessions/execution-plan.ts`, `tests/execution-plan.test.ts`, and fixtures.
  - **Steps:** Reject deprecated workouts. Deep-copy the current tree. Omit already deprecated exercise leaves. Record relevant skipped results. Convert each affected scored ancestor to required detail and disable aggregate entry. Skip empty affected containers.
  - **Edge cases:** Nested affected ancestors, one remaining leaf, no remaining child, unscored parent, deprecated leaf in a new node, and static changes after creation.
  - **Tests or fixtures:** Add partial, complete, nested, empty, and resume-after-static-change cases.
  - **Validation:** `bun test tests/execution-plan.test.ts`. Then run `bun run check`.
  - **Acceptance:** Active resume uses only the frozen plan. Complete remaining detail permits only `nonstandard`. Empty affected containers have deprecated skips and no score.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Active resume uses only the frozen plan. Complete remaining detail permits only `nonstandard`. Empty affected containers have deprecated skips and no score.

The planned validation is:

- `bun test tests/execution-plan.test.ts`. Then run `bun run check`.

Only the parent can change task `P49-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P49-T01`.
