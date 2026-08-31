# Phase 56: Implement lookups and recent-first history loading

## 1. Mission

Answer chooser, active, recent, Last Time, workout history, and exercise history queries.

## 2. Prerequisites and scope

The parent judge must accept Phase 55 before this phase starts.

This phase covers one task in the indexes and session domain workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P56-T01 — Implement lookups and recent-first history loading**
  - **Objective:** Answer chooser, active, recent, Last Time, workout history, and exercise history queries.
  - **Inspect:** Requirements 17, 19.3-19.5, 20 and Architecture loading policy.
  - **Create or edit:** `src/indexes/lookup-service.ts`, `src/application/history-loader.ts`, query facades, and tests.
  - **Steps:** Return all active sessions sorted by `updatedAtUtc`. Return five recent terminal sessions. Compute latest completion per workout. Compute Last Time from latest completed exercise occurrence only. Add five per `Load older`. Read older shards newest first on demand.
  - **Edge cases:** No history, active-only history, abandoned latest, sync copy, event outside current year, sparse months, first empty-cache all-shard scan, and offline cached older shard.
  - **Tests or fixtures:** Use a fake shard source with request recording and bounded summaries.
  - **Validation:** `bun test tests/lookup-service.test.ts tests/history-loader.test.ts`. Then run `bun run check`.
  - **Acceptance:** Active session never appears as Last Time. Every load action adds at most five visible records. First reconciliation can find all active sessions one shard at a time.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Active session never appears as Last Time. Every load action adds at most five visible records. First reconciliation can find all active sessions one shard at a time.

The planned validation is:

- `bun test tests/lookup-service.test.ts tests/history-loader.test.ts`. Then run `bun run check`.

Only the parent can change task `P56-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P56-T01`.
