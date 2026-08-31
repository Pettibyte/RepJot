# Phase 39: Reserve sync-copy and create IDs before network writes

## 1. Mission

Persist all generated identities before candidate construction or upload.

## 2. Prerequisites and scope

The parent judge must accept Phase 38 before this phase starts.

This phase covers one task in the merge and synchronization workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P39-T01 — Reserve sync-copy and create IDs before network writes**
  - **Objective:** Persist all generated identities before candidate construction or upload.
  - **Inspect:** Architecture Section 11 conflict and create ambiguity rules.
  - **Create or edit:** `src/sync/sync-operation.ts`, repository port extensions if required, and `tests/sync-coordinator.test.ts`.
  - **Steps:** Ask an injected secure UUID source for a session ID only when no reservation exists. Commit conflict-key reservation with pending intent. Ask Drive for a file ID and persist it before create. Re-read both reservations after reload.
  - **Edge cases:** Secure random unavailable, reservation transaction failure, duplicate reservation race, ambiguous create, and existing file with reserved ID but different content.
  - **Tests or fixtures:** Use fixed UUIDs and Drive IDs. Simulate reload after reservation and before request.
  - **Validation:** `bun test tests/sync-coordinator.test.ts`. Then run `bun run check`.
  - **Acceptance:** No upload starts before reservation commit. Retry and reload reuse exact IDs. Secure random failure leaves pending intent unchanged.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- No upload starts before reservation commit. Retry and reload reuse exact IDs. Secure random failure leaves pending intent unchanged.

The planned validation is:

- `bun test tests/sync-coordinator.test.ts`. Then run `bun run check`.

Only the parent can change task `P39-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P39-T01`.
