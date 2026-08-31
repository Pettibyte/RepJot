# Phase 14: Build sequential family migration registries

## 1. Mission

Represent support floors and ordered transitions without fake legacy migrations.

## 2. Prerequisites and scope

The parent judge must accept Phase 13 before this phase starts.

This phase covers one task in the document pipeline and migrations workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P14-T01 — Build sequential family migration registries**
  - **Objective:** Represent support floors and ordered transitions without fake legacy migrations.
  - **Inspect:** `schemas/**`, schema-versioning Migration Chains, and current version constants.
  - **Create or edit:** `src/migrations/migration-registry.ts`, `src/migrations/families/*.ts`, and `tests/migration-registry.test.ts`.
  - **Steps:** Register current v1 schemas for each family. Require every real step to accept exactly version N and return N+1. Detect gaps, duplicate steps, wrong outputs, unsupported-old inputs, and future inputs.
  - **Edge cases:** A current v1 input uses zero transitions. Version 0 is malformed, not legacy. Do not add a no-op `v0 -> v1` migration.
  - **Tests or fixtures:** Use synthetic test-only registries to exercise multi-step sequencing and registry failures.
  - **Validation:** `bun test tests/migration-registry.test.ts`. Then run `bun run validate:schemas`. Then run `bun run check`.
  - **Acceptance:** Production registries contain no invented migration. Synthetic chains prove strict N-to-N+1 behavior.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Production registries contain no invented migration. Synthetic chains prove strict N-to-N+1 behavior.

The planned validation is:

- `bun test tests/migration-registry.test.ts`. Then run `bun run validate:schemas`. Then run `bun run check`.

Only the parent can change task `P14-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P14-T01`.
