# Phase 75: Implement Workout History and Exercise History

## 1. Mission

Provide bounded chronological lists and normal routes for every session copy.

## 2. Prerequisites and scope

The parent judge must accept Phase 74 before this phase starts.

This phase covers one task in the product screens workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P75-T01 — Implement Workout History and Exercise History**
  - **Objective:** Provide bounded chronological lists and normal routes for every session copy.
  - **Inspect:** Requirements 20.1-20.5 and Architecture loading rules.
  - **Create or edit:** Both history screens and tests.
  - **Steps:** Workout History uses tab-root shell and includes completed, in-progress, and abandoned labels. Exercise History uses compact Back header and actual values. Sort newest first. Add five per `Load older`. Include year outside current year. Label sync copies.
  - **Edge cases:** Empty history, sparse months, offline older load, equal timestamps, cross-year dates, tombstoned session, and blocked older shard.
  - **Tests or fixtures:** Use fake clocks for year formatting and delayed history facade pages.
  - **Validation:** `bun test tests/ui/workout-history-screen.test.ts tests/ui/exercise-history-screen.test.ts`. Then run `bun run check`.
  - **Acceptance:** Lists remain bounded and accessible. No chart, analytics, volume, or reconciliation UI appears.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Lists remain bounded and accessible. No chart, analytics, volume, or reconciliation UI appears.

The planned validation is:

- `bun test tests/ui/workout-history-screen.test.ts tests/ui/exercise-history-screen.test.ts`. Then run `bun run check`.

Only the parent can change task `P75-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P75-T01`.
