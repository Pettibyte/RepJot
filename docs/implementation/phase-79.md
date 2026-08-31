# Phase 79: Audit prerequisite ownership and full traceability

## 1. Mission

Map every Section 20 row and every requirement to implemented code and evidence.

## 2. Prerequisites and scope

The parent judge must accept Phase 78 before this phase starts.

This phase covers one task in the compatibility, security, and release workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P79-T01 — Audit prerequisite ownership and full traceability**
  - **Objective:** Map every Section 20 row and every requirement to implemented code and evidence.
  - **Inspect:** Architecture Sections 18-20, all completion reports, actual tests, and the full diff.
  - **Create or edit:** `release/release-evidence.json`, `tests/release-gates.test.ts`, and missing traceability notes.
  - **Steps:** Parse every numbered requirement ID from `docs/REQUIREMENTS.md`. Give each ID a primary phase/task, implementation path, automated evidence, manual evidence if required, and state. Also map every Section 20 row and every Section 18 gate. Mark absent evidence `NOT PROVIDED`.
  - **Edge cases:** A passing unit test cannot replace a physical/device/legal gate. A file path without a passing test is not evidence. Requirement 14.11 must be marked as an explicit later-release permission, not silently omitted.
  - **Tests or fixtures:** Validate evidence schema, allowed states, required owner, nonempty command references, and exact requirement-ID set equality with `docs/REQUIREMENTS.md`.
  - **Validation:** `bun test tests/release-gates.test.ts`, `bun run check`.
  - **Acceptance:** Every numbered requirement, traceability row, and build gate is mapped. No unavailable evidence is marked passed.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Every numbered requirement, traceability row, and build gate is mapped. No unavailable evidence is marked passed.

The planned validation is:

- `bun test tests/release-gates.test.ts`, `bun run check`.

Only the parent can change task `P79-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P79-T01`.
