# Phase 53: Implement aggregate expansion and score recomputation

## 1. Mission

Keep aggregate-only and detailed container results consistent.

## 2. Prerequisites and scope

The parent judge must accept Phase 52 before this phase starts.

This phase covers one task in the indexes and session domain workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P53-T01 — Implement aggregate expansion and score recomputation**
  - **Objective:** Keep aggregate-only and detailed container results consistent.
  - **Inspect:** Requirements 10.10-10.17, Architecture scoring cases, and Phases 1-10 semantic score helpers.
  - **Create or edit:** `src/sessions/score-service.ts`, shared pure score helpers only when necessary, and `tests/score-service.test.ts`.
  - **Steps:** Reuse the Phases 1-10 score derivation rules. Support cycles, rounds-and-reps, intervals, and nonstandard. Expand optional detail into complete ordered children from score and plan. Recompute after every child edit. Mark invalid progression `nonstandard` and display-model label `Detailed`.
  - **Edge cases:** Partial round, AMRAP `+` round, nested children, zero rounds, extra reps at sequence length, incomplete child, detail-only deprecated ancestor, and childDetail `none`.
  - **Tests or fixtures:** Add aggregate-only, valid expansion, partial, invalid progression, nested, and deprecated cases.
  - **Validation:** `bun test tests/score-service.test.ts`. Then run `bun run check`.
  - **Acceptance:** Partial detail cannot persist. Child edits are authoritative after expansion. Semantic recomputation matches stored score.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Partial detail cannot persist. Child edits are authoritative after expansion. Semantic recomputation matches stored score.

The planned validation is:

- `bun test tests/score-service.test.ts`. Then run `bun run check`.

Only the parent can change task `P53-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P53-T01`.
