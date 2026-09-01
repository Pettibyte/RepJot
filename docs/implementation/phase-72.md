# Phase 72: Add Last Time, units, and scored-container interactions

## 1. Mission

Integrate compact history, unit conversion, and AMRAP/EMOM/complex entry.

## 2. Prerequisites and scope

The parent judge must accept Phase 71 before this phase starts.

This phase covers one task in the product screens workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P72-T01 — Add Last Time, units, and scored-container interactions**
  - **Objective:** Integrate compact history, unit conversion, and AMRAP/EMOM/complex entry.
  - **Inspect:** Requirements 12.4-12.7 and 19.3-19.9.
  - **Create or edit:** Active components for Last Time, unit pills, score controls, and tests.
  - **Steps:** Show latest completed values/units or `No history`. Link badge to Exercise History. Toggle only compatible units and persist preference. Keep full precision through the facade. Add a large AMRAP `+` round control, partial rounds, optional detail expansion, EMOM intervals, and complex cycles.
  - **Edge cases:** Active latest occurrence, abandoned latest, no completed history, small conversion shown `0.0`, score expansion, invalid progression, detail-only deprecated container, and sync failure.
  - **Tests or fixtures:** Assert completed-only lookup, link route, conversion drift behavior, score recomputation, and `Detailed` label.
  - **Validation:** `bun test tests/ui/active-workout-score.test.ts tests/ui/active-workout-history.test.ts`. Then run `bun run check`.
  - **Acceptance:** Last Time ignores the active session. Unit and score interactions produce validated local saves through facades.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Last Time ignores the active session. Unit and score interactions produce validated local saves through facades.

The planned validation is:

- `bun test tests/ui/active-workout-score.test.ts tests/ui/active-workout-history.test.ts`. Then run `bun run check`.

Only the parent can change task `P72-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P72-T01`.
