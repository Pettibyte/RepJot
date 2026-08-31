# Phase 74: Implement Workout Summary

## 1. Mission

Show all actual work, scores, units, attempts, notes, and final status.

## 2. Prerequisites and scope

The parent judge must accept Phase 73 before this phase starts.

This phase covers one task in the product screens workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P74-T01 — Implement Workout Summary**
  - **Objective:** Show all actual work, scores, units, attempts, notes, and final status.
  - **Inspect:** Requirements 20.3 and summary mockup only as guidance.
  - **Create or edit:** `src/ui/screens/WorkoutSummaryScreen.svelte` and tests.
  - **Steps:** Use compact Back header. Render recorded results only, including zero, attempts, unilateral derived text, incomplete/skipped reasons, scores, `Detailed`, notes, abandoned status, and sync-copy label.
  - **Edge cases:** Sparse session, no results, aggregate-only container, detailed nonstandard, missing current node handled by typed error, and no end time for invalid input.
  - **Tests or fixtures:** Use every result fixture from Phase 67.
  - **Validation:** `bun test tests/ui/workout-summary-screen.test.ts`. Then run `bun run check`.
  - **Acceptance:** Summary shows no invented defaults and no aggregate workout-volume metric.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Summary shows no invented defaults and no aggregate workout-volume metric.

The planned validation is:

- `bun test tests/ui/workout-summary-screen.test.ts`. Then run `bun run check`.

Only the parent can change task `P74-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P74-T01`.
