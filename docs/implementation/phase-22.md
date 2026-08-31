# Phase 22: Implement pending edits, reserved IDs, and receipts

## 1. Mission

Preserve base/local intent and retry identity through reloads.

## 2. Prerequisites and scope

The parent judge must accept Phase 21 before this phase starts.

This phase covers one task in the indexeddb persistence workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P22-T01 — Implement pending edits, reserved IDs, and receipts**
  - **Objective:** Preserve base/local intent and retry identity through reloads.
  - **Inspect:** Architecture Sections 8 and 11 transaction and ambiguous-upload rules.
  - **Create or edit:** `src/storage/pending-repository.ts`, operation receipt methods, and `tests/pending-repository.test.ts`.
  - **Steps:** Save a pending edit and required sync-copy reservations atomically. Implement state transitions `queued`, `uploading`, `ambiguous`, and `failed`. Commit known remote bytes, metadata, receipt, and pending resolution in one transaction.
  - **Edge cases:** Cover null base, repeated reservation, conflicting reservation, reload, partial commit abort, stale operation ID, and failed expected-digest match.
  - **Tests or fixtures:** Add deterministic UUID values and expected digest fixtures.
  - **Validation:** `bun test tests/pending-repository.test.ts`. Then run `bun run check`.
  - **Acceptance:** Reload returns the exact base, local model, state, and reserved ID. A transaction abort changes none of them.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Reload returns the exact base, local model, state, and reserved ID. A transaction abort changes none of them.

The planned validation is:

- `bun test tests/pending-repository.test.ts`. Then run `bun run check`.

Only the parent can change task `P22-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P22-T01`.
