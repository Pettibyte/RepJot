# Phase 48: Resolve prescriptions through nested iterations

## 1. Mission

Produce effective fields for each one-based execution path.

## 2. Prerequisites and scope

The parent judge must accept Phase 47 before this phase starts.

This phase covers one task in the indexes and session domain workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P48-T01 — Resolve prescriptions through nested iterations**
  - **Objective:** Produce effective fields for each one-based execution path.
  - **Inspect:** Requirements 10.2-10.5 and Architecture ADR-021.
  - **Create or edit:** `src/sessions/prescription-resolver.ts`, `tests/prescription-resolver.test.ts`.
  - **Steps:** Start with top-level fields. Overlay only fields present in the matching nearest repeated-container iteration. Preserve absent fields. Reject duplicate numbers and finite out-of-range overrides through semantic preconditions.
  - **Edge cases:** Nested rounds, EMOM cycle, no override, override adds a field, override omits a field, `null`, duplicate number, and no finite bound.
  - **Tests or fixtures:** Use the approved 5/80, 3/100, 8/100 example plus nested cases.
  - **Validation:** `bun test tests/prescription-resolver.test.ts`. Then run `bun run check`.
  - **Acceptance:** Results are independent of iteration-array order. Omitted fields inherit. No resolver invents a value.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Results are independent of iteration-array order. Omitted fields inherit. No resolver invents a value.

The planned validation is:

- `bun test tests/prescription-resolver.test.ts`. Then run `bun run check`.

Only the parent can change task `P48-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P48-T01`.
