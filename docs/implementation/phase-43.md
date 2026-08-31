# Phase 43: Implement retry, authorization, and serialization policy

## 1. Mission

Retry only safe transient failures while preserving operation state.

## 2. Prerequisites and scope

The parent judge must accept Phase 42 before this phase starts.

This phase covers one task in the merge and synchronization workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P43-T01 — Implement retry, authorization, and serialization policy**
  - **Objective:** Retry only safe transient failures while preserving operation state.
  - **Inspect:** Architecture Retry Behavior and error table.
  - **Create or edit:** `src/sync/retry-policy.ts`, coordinator error paths, and retry tests.
  - **Steps:** Retry network, `429`, and retryable `5xx` with capped exponential backoff and injected jitter. Honor `Retry-After`. Convert `401` and authorization `403` to reauthorization. Do not auto-retry validation, future schema, quota, unsafe duplicates, or semantic errors. Read Drive before ambiguous retries.
  - **Edge cases:** Cover malformed `Retry-After`, max attempts, cancellation, app reload during delay, two calls for one logical file, and parallel separate shards under a small limit.
  - **Tests or fixtures:** Use fake clocks, zero-wait schedulers, fixed jitter, and barriers.
  - **Validation:** `bun test tests/sync-retry.test.ts tests/sync-coordinator.test.ts`. Then run `bun run check`.
  - **Acceptance:** One file has one active sync. Pending state and IDs survive exhaustion. Separate shard reads obey the configured concurrency limit.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- One file has one active sync. Pending state and IDs survive exhaustion. Separate shard reads obey the configured concurrency limit.

The planned validation is:

- `bun test tests/sync-retry.test.ts tests/sync-coordinator.test.ts`. Then run `bun run check`.

Only the parent can change task `P43-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P43-T01`.
