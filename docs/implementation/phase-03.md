# Phase 3: Build the schema registry

## 1. Mission

Compile every v1 schema under Draft 2020-12 and return stable diagnostics.

## 2. Prerequisites and scope

The parent judge must accept Phase 2 before this phase starts.

This phase owns the schema registry, format assertions, schema command, and focused tests. It does not own semantic validation.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read the sources named in this task before editing.

## 4. Ordered task

- [x] **P3-T01 — Build the schema registry**
  - **Objective:** Register and compile every supported schema once.
  - **Inspect:** The approved contract matrix, all schemas, and JSON Schema external-reference rules.
  - **Create or edit:** `src/validation/schema-registry.ts`, `src/validation/schema-validator.ts`, `scripts/validate-schemas.ts`, and focused tests.
  - **Steps:** Register exact `$id` values, families, and versions. Enable asserted `date-time` formats. Normalize errors into stable safe fields.
  - **Edge cases:** Cover unresolved references, duplicate IDs, invalid schemas, offsets, invalid dates, and unknown versions.
  - **Tests:** Include valid `Z` timestamps and invalid offset and calendar values.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- All repository schemas compile.
- Each negative fixture reports the expected path and keyword.
- Format validation is an assertion, not an annotation.

The planned validation is:

- `bun run validate:schemas`
- Focused schema-validator tests
- `bun run check`

Only the parent can change task `P3-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P3-T01`.
