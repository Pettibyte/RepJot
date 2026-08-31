# Phase 55: Build bounded native indexes

## 1. Mission

Build compact read models without persisting duplicate data.

## 2. Prerequisites and scope

The parent judge must accept Phase 54 before this phase starts.

This phase covers one task in the indexes and session domain workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P55-T01 — Build bounded native indexes**
  - **Objective:** Build compact read models without persisting duplicate data.
  - **Inspect:** Storage spec In-Memory Read Model and Architecture ADR-011/ADR-016.
  - **Create or edit:** `src/indexes/index-builder.ts`, `tests/index-builder.test.ts`.
  - **Steps:** Build exercise/workout/node maps, muscle sets, active summaries, recent session summaries, exercise occurrences, and container summaries. Use `workoutId + NUL + nodeId` keys. Sort UTC timestamps deterministically with ID tie-breakers.
  - **Edge cases:** Duplicate paths already rejected, equal timestamps, sync copies, abandoned sessions, unloaded older shards, deprecated entities, and account reset.
  - **Tests or fixtures:** Add deep-tree, multiple-shard, equal-time, and bounded-list fixtures.
  - **Validation:** `bun test tests/index-builder.test.ts`. Then run `bun run check`.
  - **Acceptance:** Indexes use native structures and compact summaries. No index enters IndexedDB. Rebuild affects only changed shard data.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Indexes use native structures and compact summaries. No index enters IndexedDB. Rebuild affects only changed shard data.

The planned validation is:

- `bun test tests/index-builder.test.ts`. Then run `bun run check`.

Only the parent can change task `P55-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P55-T01`.
