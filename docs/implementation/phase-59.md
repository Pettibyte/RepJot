# Phase 59: Build startup and account-gated application state

## 1. Mission

Model anonymous, loading, warm, stale, offline, blocked-file, and fatal-static states.

## 2. Prerequisites and scope

The parent judge must accept Phase 58 before this phase starts.

This phase covers one task in the shell, routing, and status ui workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P59-T01 — Build startup and account-gated application state**
  - **Objective:** Model anonymous, loading, warm, stale, offline, blocked-file, and fatal-static states.
  - **Inspect:** Architecture Section 9 startup table and Phases 27-57 facade states.
  - **Create or edit:** `src/state/app-state.ts`, `src/state/app-context.ts`, and `tests/app-state.test.ts`.
  - **Steps:** Compose static-loader, auth, account gate, cache, and sync states. Permit warm/stale local use. Block empty-cache workout starts until reconciliation. Keep unrelated files usable after one blocked document.
  - **Edge cases:** Invalid static bundle, expired token, account-binding failure, warm offline cache, empty offline cache, future shard, corrupt remote, and account switch.
  - **Tests or fixtures:** Use facade fakes with deterministic transition order.
  - **Validation:** `bun test tests/app-state.test.ts`. Then run `bun run check`.
  - **Acceptance:** Private state never appears before account binding. Every startup table row maps to one visible model and allowed-action set.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Private state never appears before account binding. Every startup table row maps to one visible model and allowed-action set.

The planned validation is:

- `bun test tests/app-state.test.ts`. Then run `bun run check`.

Only the parent can change task `P59-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P59-T01`.
