# Phase 11: Define pipeline stages and typed errors

## 1. Mission

Give every pipeline result an explicit stage, provenance record, and safe error category.

## 2. Prerequisites and scope

The parent judge must accept Phase 10 before this phase starts.

This phase covers one task in the document pipeline and migrations workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P11-T01 — Define pipeline stages and typed errors**
  - **Objective:** Give every pipeline result an explicit stage, provenance record, and safe error category.
  - **Inspect:** Phases 1-10 diagnostics, Architecture Sections 12 and 16, and schema-versioning Version Handling.
  - **Create or edit:** `src/documents/pipeline-types.ts`, `src/errors/app-error.ts`, and `tests/document-pipeline.test.ts`.
  - **Steps:** Define source identity, expected family, logical name, byte provenance, migration path, validation version, and normalized-model result. Define distinct parse, envelope, unsupported-old, future, schema, migration, and semantic errors.
  - **Edge cases:** Keep missing version separate from malformed version. Keep family mismatch separate from unknown family. Never include raw notes or content in safe messages.
  - **Tests or fixtures:** Add table tests that assert stable error kinds and safe context.
  - **Validation:** `bun test tests/document-pipeline.test.ts`. Then run `bun run check`.
  - **Acceptance:** Callers can branch on error kind without parsing messages. Errors retain no secret or health-data payload.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Callers can branch on error kind without parsing messages. Errors retain no secret or health-data payload.

The planned validation is:

- `bun test tests/document-pipeline.test.ts`. Then run `bun run check`.

Only the parent can change task `P11-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P11-T01`.
