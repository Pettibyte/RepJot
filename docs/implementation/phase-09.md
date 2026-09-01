# Phase 9: Compare static-data compatibility

## 1. Mission

Implement implement blank-baseline and future compatibility comparison as one isolated contract boundary.

## 2. Prerequisites and scope

The parent judge must accept Phase 8 before this phase starts.

This phase covers one isolated contract boundary. It cannot wire broad build commands or audit unrelated contract families.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read the sources named in this task before editing.

## 4. Ordered task

- [ ] **P9-T01 — Compare static-data compatibility**
  - **Objective:** Support a blank first release and detect forbidden identity changes after the first approved baseline exists.
  - **Inspect:** Requirements 6.1-6.17, Architecture Section 18, and schema-versioning Static Bundle Compatibility.
  - **Create or edit:** `src/compatibility/compare-static-data.ts`, `scripts/compare-production.ts`, `tests/compatibility.test.ts`, and `tests/fixtures/compatibility/**`.
  - **Steps:** Add an explicit first-release mode that requires no prior files and writes no baseline by itself. Add a future-release comparison mode for equipment, exercise, workout, and node namespaces. Preserve parent, role, exercise reference, strategy, score contract, dimensions, and old units. Report newly deprecated impact. Permit labels, instructions, notes, and prescriptions to change. Require a human approval record before a separate command records first-release digests.
  - **Edge cases:** Cover an absent baseline, an unexpected existing baseline, ID deletion, namespace reuse, node movement, role change, unit removal, node addition, deprecation, reordered arrays, and an attempt to record unapproved digests.
  - **Tests or fixtures:** Add a blank-baseline fixture and one fixture pair per permitted and forbidden future change.
  - **Validation:** `bun test tests/compatibility.test.ts`, `bun scripts/compare-production.ts --fixture tests/fixtures/compatibility/compatible`.
  - **Acceptance:** Blank-baseline mode passes without a network request or fabricated digest. Every forbidden future fixture fails for its expected stable code. Only a human-approved first release can establish the baseline.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Blank-baseline mode passes without a network request or fabricated digest. Every forbidden future fixture fails for its expected stable code. Only a human-approved first release can establish the baseline.

The planned validation is:

- `bun test tests/compatibility.test.ts`, `bun scripts/compare-production.ts --fixture tests/fixtures/compatibility/compatible`.

Only the parent can change task `P9-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P9-T01`.
