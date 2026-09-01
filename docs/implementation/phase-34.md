# Phase 34: Provide deterministic Drive and browser fakes

## 1. Mission

Give Phases 36-46 controllable concurrency, ambiguity, and reload behavior.

## 2. Prerequisites and scope

The parent judge must accept Phase 33 before this phase starts.

This phase covers one task in the authentication and drive adapters workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P34-T01 — Provide deterministic Drive and browser fakes**
  - **Objective:** Give Phases 36-46 controllable concurrency, ambiguity, and reload behavior.
  - **Inspect:** Architecture Section 17 fake Drive requirements.
  - **Create or edit:** `tests/fakes/fake-drive.ts`, fake browser/token store files, and fake self-tests.
  - **Steps:** Model stable IDs, duplicate names, pages, metadata versions, request barriers, response drops before and after commit, and account about results. Record requests without tokens.
  - **Edge cases:** Cover create ambiguity, update ambiguity, post-read overwrite, metadata races, pagination, and unknown files.
  - **Tests or fixtures:** Add fake contract tests so Phases 36-46 do not rely on fake bugs.
  - **Validation:** `bun test tests/fakes/fake-drive.test.ts`. Then run `bun run check`.
  - **Acceptance:** Tests can pause preflight, update, and post-read independently. The same fake state survives a simulated application reload.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Tests can pause preflight, update, and post-read independently. The same fake state survives a simulated application reload.

The planned validation is:

- `bun test tests/fakes/fake-drive.test.ts`. Then run `bun run check`.

Only the parent can change task `P34-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P34-T01`.
