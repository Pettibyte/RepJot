# Phase 16: Record provenance and normalize disposable models

## 1. Mission

Let caches distinguish canonical source bytes from migrated current models.

## 2. Prerequisites and scope

The parent judge must accept Phase 15 before this phase starts.

This phase covers one task in the document pipeline and migrations workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P16-T01 — Record provenance and normalize disposable models**
  - **Objective:** Let caches distinguish canonical source bytes from migrated current models.
  - **Inspect:** Architecture Section 8 state layers and schema-versioning Read and Migration Policy.
  - **Create or edit:** `src/documents/normalizers.ts`, pipeline types, and normalization tests.
  - **Steps:** Record source family/version, current version, validator version, migration step IDs, logical name, and source digest through an injected digest service. Keep normalized models read-only and omit no canonical user data.
  - **Edge cases:** Two byte encodings of equivalent JSON can have different source digests. Normalization must not alter persisted quantities, timestamps, ordering, or IDs.
  - **Tests or fixtures:** Add deep-equality tests for all v1 families and immutable source assertions.
  - **Validation:** `bun test tests/document-pipeline.test.ts`. Then run `bun run check`.
  - **Acceptance:** A caller can retain raw bytes and use a separate current model. Normalization never implies write-back.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- A caller can retain raw bytes and use a separate current model. Normalization never implies write-back.

The planned validation is:

- `bun test tests/document-pipeline.test.ts`. Then run `bun run check`.

Only the parent can change task `P16-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P16-T01`.
