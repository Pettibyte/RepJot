# Phase 57: Run domain integration and memory-shape regressions

## 1. Mission

Prove end-to-end domain behavior without UI or infrastructure imports.

## 2. Prerequisites and scope

The parent judge must accept Phase 56 before this phase starts.

This phase covers one task in the indexes and session domain workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P57-T01 — Run domain integration and memory-shape regressions**
  - **Objective:** Prove end-to-end domain behavior without UI or infrastructure imports.
  - **Inspect:** Architecture Sections 17, 19 Phases 47-57, 20, and the complete diff.
  - **Create or edit:** `tests/session-domain.integration.test.ts` and fixtures.
  - **Steps:** Start several sessions, reload from repositories, apply static changes, edit terminal history, convert units, expand AMRAP, delete one copy, and query history. Inspect retained index fields for accidental full-document duplication.
  - **Edge cases:** Deep trees, detailed AMRAP, cross-month active sessions, secure-random failure, and unavailable older shard.
  - **Tests or fixtures:** Use deterministic clocks, UUIDs, storage fakes, and shard fakes.
  - **Validation:** `bun test tests/session-domain.integration.test.ts`. Then run `bun run test`. Then run `bun run check`. Then run `bun run build`. Then run `bun run check:compat`.
  - **Acceptance:** Multiple active sessions survive reload. Frozen and terminal-plan rules hold. Broad regressions pass within bounded fixture behavior.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Multiple active sessions survive reload. Frozen and terminal-plan rules hold. Broad regressions pass within bounded fixture behavior.

The planned validation is:

- `bun test tests/session-domain.integration.test.ts`. Then run `bun run test`. Then run `bun run check`. Then run `bun run build`. Then run `bun run check:compat`.

Only the parent can change task `P57-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P57-T01`.
