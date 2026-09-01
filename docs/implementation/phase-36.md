# Phase 36: Define semantic diffs, canonical equality, and conflict keys

## 1. Mission

Compare documents at mapping/session granularity without relying on object identity or unstable serialization.

## 2. Prerequisites and scope

The parent judge must accept Phase 35 before this phase starts.

This phase covers one task in the merge and synchronization workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P36-T01 — Define semantic diffs, canonical equality, and conflict keys**
  - **Objective:** Compare documents at mapping/session granularity without relying on object identity or unstable serialization.
  - **Inspect:** Domain types, pipeline normalizers, pending records, and Architecture Result Merge Policy.
  - **Create or edit:** `src/sync/canonical-digest.ts`, `src/sync/conflict-key.ts`, and focused tests.
  - **Steps:** Define canonical serialization with stable key handling. Compare preferences by `(exerciseId, dimension)` and results by session/tombstone ID. Build conflict keys from logical shard, original ID, base digest, local digest, and first remote digest.
  - **Edge cases:** Cover key order differences, equal semantic content with different source bytes, null base, duplicate IDs already rejected, and timestamps as identity-bearing content.
  - **Tests or fixtures:** Add deterministic digest fixtures and reload reconstruction tests.
  - **Validation:** `bun test tests/sync-digests.test.ts`. Then run `bun run check`.
  - **Acceptance:** Equivalent current models compare equal. The same conflict inputs always create the same key without exposing raw IDs in diagnostics.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Equivalent current models compare equal. The same conflict inputs always create the same key without exposing raw IDs in diagnostics.

The planned validation is:

- `bun test tests/sync-digests.test.ts`. Then run `bun run check`.

Only the parent can change task `P36-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P36-T01`.
