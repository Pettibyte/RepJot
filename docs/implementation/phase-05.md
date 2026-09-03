# Phase 5: Validate result lifecycle semantics

## 1. Mission

Implement result lifecycle semantics without score or omission inference.

## 2. Prerequisites and scope

The parent judge must accept Phase 4 before this phase starts.

This phase owns result identity, paths, direct IDs, uniqueness, side rules, lifecycle, shard agreement, UTC fields, and sync-copy links.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read the sources named in this task before editing.

## 4. Ordered task

- [ ] **P5-T01 — Validate result lifecycle semantics**
  - **Objective:** Apply only the result lifecycle rows from the approved invariant matrix.
  - **Inspect:** Requirements Sections 11 and 12, the JSON specification, and the approved matrix.
  - **Create or edit:** Focused result semantic modules and result lifecycle tests.
  - **Steps:** Validate paths, direct IDs, uniqueness, sides, status fields, shard identity, timestamps, tombstones, and sync-copy links. For tombstones and sync copies, validate only the current document state. Phases 37-42 own merge precedence, ID reservation, retry, and convergence. Keep score and deprecated-omission logic outside this phase.
  - **Edge cases:** Cover duplicate paths, wrong direct IDs, live/tombstone collisions, wrong shards, invalid links, and terminal timestamp changes.
  - **Tests:** Add positive, malformed, and recovery fixtures for each owned row.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Every lifecycle matrix row has one primary owner and focused evidence.
- No score or omission rule enters this phase.
- Invalid input remains unchanged.

The planned validation is:

- Focused result lifecycle tests
- `bun run check`
- Prior contract regression tests

Only the parent can change task `P5-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P5-T01`.
