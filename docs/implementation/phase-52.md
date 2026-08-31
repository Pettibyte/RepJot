# Phase 52: Implement result editing, omission, attempts, sides, and notes

## 1. Mission

Translate explicit user actions into minimal valid results.

## 2. Prerequisites and scope

The parent judge must accept Phase 51 before this phase starts.

This phase covers one task in the indexes and session domain workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P52-T01 — Implement result editing, omission, attempts, sides, and notes**
  - **Objective:** Translate explicit user actions into minimal valid results.
  - **Inspect:** Requirements 11.1-11.8 and result Save and Omission Rules.
  - **Create or edit:** `src/sessions/result-editor.ts`, tests, and result fixtures.
  - **Steps:** Keep programmed defaults as temporary state. Commit a displayed default on blur. Leave untouched work absent. Store zero reps. Support attempts, controlled reasons, effort, session/exercise/attempt/container notes, and unilateral side rules.
  - **Edge cases:** Blank versus zero, incomplete without relevance, skipped with values, alternating without starting side, bilateral side input, extra attempt, blur without text change, and storage failure.
  - **Tests or fixtures:** Add every result type and reason-code path with malformed negative cases.
  - **Validation:** `bun test tests/result-editor.test.ts`. Then run `bun run check`.
  - **Acceptance:** Every produced result passes schema and semantic validation. A failed repository save leaves editable form state and does not report durability.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Every produced result passes schema and semantic validation. A failed repository save leaves editable form state and does not report durability.

The planned validation is:

- `bun test tests/result-editor.test.ts`. Then run `bun run check`.

Only the parent can change task `P52-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P52-T01`.
