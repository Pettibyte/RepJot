# Phase 7: Validate trusted local icons

## 1. Mission

Implement validate trusted local icon contracts as one isolated contract boundary.

## 2. Prerequisites and scope

The parent judge must accept Phase 6 before this phase starts.

This phase covers one isolated contract boundary. It cannot wire broad build commands or audit unrelated contract families.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read the sources named in this task before editing.

## 4. Ordered task

- [ ] **P7-T01 — Validate trusted local icons**
  - **Objective:** Prevent remote, traversal, missing, and unsafe SVG references before build output.
  - **Inspect:** Requirements 8.5-8.9, schema icon patterns, Architecture Sections 14 and 15, and current assets.
  - **Create or edit:** `src/validation/semantic/icon-validation.ts`, `scripts/validate-static.ts`, icon fixtures, and SVG sanitizer tests.
  - **Steps:** Validate material ligature names against an injectable manifest. Resolve local SVG paths inside the static root. Parse and sanitize trusted SVG files at build time. Do not insert SVG source at runtime.
  - **Edge cases:** Reject schemes, absolute paths, traversal, symlinks outside the root, scripts, event attributes, external references, and missing files.
  - **Tests or fixtures:** Add safe and hostile local SVG fixtures. Keep hostile fixtures outside publishable assets.
  - **Validation:** `bun test tests/semantic-validator.test.ts`, `bun scripts/validate-static.ts --fixture tests/fixtures/static/valid`.
  - **Acceptance:** Gate 5 passes for valid fixtures and fails for every hostile fixture reason.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Gate 5 passes for valid fixtures and fails for every hostile fixture reason.

The planned validation is:

- `bun test tests/semantic-validator.test.ts`, `bun scripts/validate-static.ts --fixture tests/fixtures/static/valid`.

Only the parent can change task `P7-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P7-T01`.
