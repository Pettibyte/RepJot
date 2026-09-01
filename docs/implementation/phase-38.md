# Phase 38: Implement preference merge and final revision update

## 1. Mission

Merge separate mappings and make the pending value win only for same-key conflicts.

## 2. Prerequisites and scope

The parent judge must accept Phase 37 before this phase starts.

This phase covers one task in the merge and synchronization workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P38-T01 — Implement preference merge and final revision update**
  - **Objective:** Merge separate mappings and make the pending value win only for same-key conflicts.
  - **Inspect:** Requirements 4.7 and 12.8-12.9 and Architecture Preference Merge Policy.
  - **Create or edit:** `src/sync/merge-preferences.ts`, `tests/merge-preferences.test.ts`.
  - **Steps:** Compute base-local and base-remote changes by mapping. Merge different keys. Select pending local for a changed same key. Increment document revision exactly once and set `updatedAtUtc` only on the final upload candidate through an injected clock.
  - **Edge cases:** Cover mapping deletion if contract permits it, null remote, equal changes, no-op merge, remote higher revision, and repeated retries.
  - **Tests or fixtures:** Use a fixed clock and arrival-order permutations.
  - **Validation:** `bun test tests/merge-preferences.test.ts`. Then run `bun run check`.
  - **Acceptance:** Final arrival order determines same-key value. Retries do not increment revision more than the one candidate operation.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Final arrival order determines same-key value. Retries do not increment revision more than the one candidate operation.

The planned validation is:

- `bun test tests/merge-preferences.test.ts`. Then run `bun run check`.

Only the parent can change task `P38-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P38-T01`.
