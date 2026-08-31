# Phase 13: Recognize exact envelopes and logical names

## 1. Mission

Select a family registry only from validated envelope fields and the expected logical name.

## 2. Prerequisites and scope

The parent judge must accept Phase 12 before this phase starts.

This phase covers one task in the document pipeline and migrations workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P13-T01 — Recognize exact envelopes and logical names**
  - **Objective:** Select a family registry only from validated envelope fields and the expected logical name.
  - **Inspect:** Phases 1-10 family constants, canonical-name rules, and schema-versioning Document Envelope.
  - **Create or edit:** `src/documents/envelope.ts`, `src/documents/document-pipeline.ts`, and envelope fixtures.
  - **Steps:** Read only own `format` and `schemaVersion` fields from a plain object. Require a positive integer. Match static names and result-name patterns to exact families. Compare result filename and `yearMonthUtc` later in semantic validation.
  - **Edge cases:** Reject inherited fields, arrays, `NaN`-like values, decimal versions, unknown formats, `results-2026-00.json`, and a preferences envelope in a result filename.
  - **Tests or fixtures:** Add one fixture for each distinct error.
  - **Validation:** `bun test tests/document-pipeline.test.ts`. Then run `bun run check`.
  - **Acceptance:** No shape heuristic or Drive metadata influences family/version selection.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- No shape heuristic or Drive metadata influences family/version selection.

The planned validation is:

- `bun test tests/document-pipeline.test.ts`. Then run `bun run check`.

Only the parent can change task `P13-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P13-T01`.
