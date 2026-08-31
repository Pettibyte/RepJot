# Phase 18: Complete migration and recovery regression coverage

## 1. Mission

Prove independent family loading, reload-safe determinism, and non-overwrite behavior.

## 2. Prerequisites and scope

The parent judge must accept Phase 17 before this phase starts.

This phase covers one task in the document pipeline and migrations workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P18-T01 — Complete migration and recovery regression coverage**
  - **Objective:** Prove independent family loading, reload-safe determinism, and non-overwrite behavior.
  - **Inspect:** Architecture Sections 17, 19 Phases 11-18, and 20.
  - **Create or edit:** Phases 11-18 tests and `tests/fixtures/migrations/README.md` if fixture conventions need documentation.
  - **Steps:** Run each family independently and in context order. Re-run failed and successful inputs. Compare original bytes before and after. Test unsupported-old and future errors separately. Preserve all Phases 1-10 and Phase 0 tests.
  - **Edge cases:** Cover a result shard whose static context is absent, a future preferences file, invalid cached normalized data, and serialization round trips.
  - **Tests or fixtures:** Add current-version pass-through fixtures and synthetic historical fixtures only for test registries.
  - **Validation:** `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run build`, `bun run check:compat`.
  - **Acceptance:** Every family loads independently. Invalid and future source bytes remain unchanged. No fake production migration exists.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Every family loads independently. Invalid and future source bytes remain unchanged. No fake production migration exists.

The planned validation is:

- `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run build`, `bun run check:compat`.

Only the parent can change task `P18-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P18-T01`.
