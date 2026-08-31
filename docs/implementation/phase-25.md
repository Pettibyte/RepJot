# Phase 25: Implement the bounded diagnostic ring

## 1. Mission

Store redacted support events without affecting canonical saves.

## 2. Prerequisites and scope

The parent judge must accept Phase 24 before this phase starts.

This phase covers one task in the indexeddb persistence workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P25-T01 — Implement the bounded diagnostic ring**
  - **Objective:** Store redacted support events without affecting canonical saves.
  - **Inspect:** Architecture Sections 8, 11, 15, and 17 and Requirements 12.11-12.12.
  - **Create or edit:** `src/storage/diagnostic-repository.ts`, diagnostic ports/types, and `tests/diagnostic-repository.test.ts`.
  - **Steps:** Store account-local alias salt and events. Enforce seven days, 500 events, and 256 KiB. Remove oldest events in the append transaction. Create export data without a complete user agent.
  - **Edge cases:** Cover all three limits, equal timestamps, oversized one-event input, clock rollback, append failure, and clear operation.
  - **Tests or fixtures:** Inject a fixed clock and deterministic event IDs. Seed tokens, notes, measurements, raw IDs, URLs, errors, and content into rejected context tests.
  - **Validation:** `bun test tests/diagnostic-repository.test.ts`. Then run `bun run check`.
  - **Acceptance:** Forbidden values never appear in stored or exported JSON. Diagnostic failure does not roll back a separate pending edit.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Forbidden values never appear in stored or exported JSON. Diagnostic failure does not roll back a separate pending edit.

The planned validation is:

- `bun test tests/diagnostic-repository.test.ts`. Then run `bun run check`.

Only the parent can change task `P25-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P25-T01`.
