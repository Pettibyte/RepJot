# Phase 6: Validate scores and deprecated omissions

## 1. Mission

Implement score, structural detail, and deprecated-omission semantics from the approved contract decision.

## 2. Prerequisites and scope

The parent judge must accept Phase 5 before this phase starts.

This phase cannot infer past state from missing results. It must use only the persisted facts that Phase 1 approved.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read the sources named in this task before editing.

## 4. Ordered task

- [ ] **P6-T01 — Validate scores and deprecated omissions**
  - **Objective:** Validate aggregate scores, detailed results, and deprecated omissions.
  - **Inspect:** The approved terminal-omission decision, score rules, Requirements 10.10-10.17 and 11.16-11.24, and Architecture Section 13.
  - **Create or edit:** Focused score and omission validators, pure score helpers, and focused tests.
  - **Steps:** Report every affected scored or timed ancestor. Separate score completeness from structural detail completeness. Preserve historical skipped and deprecated results. Apply terminal behavior only from persisted evidence.
  - **Edge cases:** Cover nested scored ancestors, timed ancestors, partial detail, aggregate-only results, untouched work, later deprecation, later node addition, and recorded omissions.
  - **Stop:** Stop if the approved documents still cannot distinguish an omission from untouched or later-added work.
  - **Tests:** Use explicit input and expected-diagnostic fixtures for each temporal state.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Score recomputation matches every approved contract vector.
- Every affected ancestor appears in deterministic diagnostics.
- Terminal omission behavior uses no unsupported inference.
- Structural and score completeness remain distinct.

The planned validation is:

- Focused score and omission tests
- `bun run check`
- All semantic regression tests

Only the parent can change task `P6-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P6-T01`.
