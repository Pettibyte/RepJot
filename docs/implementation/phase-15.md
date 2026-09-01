# Phase 15: Enforce validation before and after every migration

## 1. Mission

Make stage ordering impossible to bypass through normal pipeline use.

## 2. Prerequisites and scope

The parent judge must accept Phase 14 before this phase starts.

This phase covers one task in the document pipeline and migrations workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P15-T01 — Enforce validation before and after every migration**
  - **Objective:** Make stage ordering impossible to bypass through normal pipeline use.
  - **Inspect:** Phases 1-10 schema/semantic APIs and Architecture Section 12 stage table.
  - **Create or edit:** `src/documents/document-pipeline.ts`, `tests/document-pipeline.test.ts`, and migration fixtures.
  - **Steps:** Validate the declared schema first. Clone or pass read-only validated input to each migration. Validate each next-version output. Run complete current schema validation and semantic validation. Normalize only after success.
  - **Edge cases:** Cover invalid historical input, a migration that mutates input, wrong next version, invalid intermediate output, missing reference context, and invalid final semantics.
  - **Tests or fixtures:** Add synthetic migration spies that prove call order and immutability.
  - **Validation:** `bun test tests/document-pipeline.test.ts tests/migration-registry.test.ts`. Then run `bun run check`.
  - **Acceptance:** The call trace is parse, recognize, historical schema, migration, next schema, final semantic, normalize. Failed inputs remain byte-identical.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- The call trace is parse, recognize, historical schema, migration, next schema, final semantic, normalize. Failed inputs remain byte-identical.

The planned validation is:

- `bun test tests/document-pipeline.test.ts tests/migration-registry.test.ts`. Then run `bun run check`.

Only the parent can change task `P15-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P15-T01`.
