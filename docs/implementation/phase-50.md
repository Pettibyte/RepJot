# Phase 50: Reconstruct terminal edit plans from the current tree

## 1. Mission

Overlay historical results without storing a terminal snapshot.

## 2. Prerequisites and scope

The parent judge must accept Phase 49 before this phase starts.

This phase covers one task in the indexes and session domain workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P50-T01 — Reconstruct terminal edit plans from the current tree**
  - **Objective:** Overlay historical results without storing a terminal snapshot.
  - **Inspect:** Requirements 11.16-11.20 and Architecture ADR-020.
  - **Create or edit:** Terminal-plan functions in `src/sessions/execution-plan.ts` and tests.
  - **Steps:** Start from the current retained workout tree. Overlay results by complete execution path. Show new nodes blank. Retain a deprecated path only when recorded. Hide unrecorded deprecated leaves. Return a temporary editor model only.
  - **Edge cases:** Added node, renamed content, moved node blocked by compatibility, recorded deprecated node, missing retained reference, sync copy, and abandoned session.
  - **Tests or fixtures:** Use the approved A/B plus added C example and nested path cases.
  - **Validation:** `bun test tests/execution-plan.test.ts`. Then run `bun run check`.
  - **Acceptance:** Saving a terminal edit persists no `executionPlan`. The editor preserves terminal status and all workout timestamps.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Saving a terminal edit persists no `executionPlan`. The editor preserves terminal status and all workout timestamps.

The planned validation is:

- `bun test tests/execution-plan.test.ts`. Then run `bun run check`.

Only the parent can change task `P50-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P50-T01`.
