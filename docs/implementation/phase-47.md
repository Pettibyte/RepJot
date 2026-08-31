# Phase 47: Implement secure session IDs and UTC shard selection

## 1. Mission

Create valid session IDs and UTC timestamps without local-calendar influence.

## 2. Prerequisites and scope

The parent judge must accept Phase 46 before this phase starts.

This phase covers one task in the indexes and session domain workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P47-T01 — Implement secure session IDs and UTC shard selection**
  - **Objective:** Create valid session IDs and UTC timestamps without local-calendar influence.
  - **Inspect:** Existing `src/random-uuid.ts`, C-10/C-11, results schema, and capability report.
  - **Create or edit:** `src/ports/clock.ts`, `src/ports/uuid-source.ts`, `src/domain/time.ts`, `src/domain/shards.ts`, and tests.
  - **Steps:** Implement RFC 4122 v4 bit layout with injected secure bytes. Prefix session IDs with `session-`. Convert clock instants to ISO `Z` strings. Select `results-YYYY-MM.json` from `startedAtUtc.slice(0, 7)` after validation.
  - **Edge cases:** Secure random unavailable, all-zero bytes, UTC month/year boundary, leap day, invalid offset input, clock before epoch, and local-zone changes.
  - **Tests or fixtures:** Fixed byte arrays and UTC boundary cases. Prove no `Math.random` session fallback.
  - **Validation:** `bun test tests/session-id.test.ts tests/shards.test.ts`. Then run `bun run check`. Then run `bun run check:compat`.
  - **Acceptance:** IDs match the schema. One instant selects one shard in every display zone. Failure creates no session.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- IDs match the schema. One instant selects one shard in every display zone. Failure creates no session.

The planned validation is:

- `bun test tests/session-id.test.ts tests/shards.test.ts`. Then run `bun run check`. Then run `bun run check:compat`.

Only the parent can change task `P47-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P47-T01`.
