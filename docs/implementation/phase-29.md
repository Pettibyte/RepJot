# Phase 29: Implement auth service lifecycle and account gate

## 1. Mission

Coordinate restored/new tokens, exact expiry, Drive binding, and selected storage namespace.

## 2. Prerequisites and scope

The parent judge must accept Phase 28 before this phase starts.

This phase covers one task in the authentication and drive adapters workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P29-T01 — Implement auth service lifecycle and account gate**
  - **Objective:** Coordinate restored/new tokens, exact expiry, Drive binding, and selected storage namespace.
  - **Inspect:** Architecture Sections 8-10 and Phases 19-26 account repository.
  - **Create or edit:** `src/auth/auth-service.ts`, `src/ports/token-store.ts`, and `tests/auth-service.test.ts`.
  - **Steps:** Bind every token with Drive about. Select the namespace only after success. Clear expired or malformed records. Enter `reauthorization_required` on expiry or authorization errors without deleting pending edits. Preserve prior hash route.
  - **Edge cases:** Cover restored token bound to another account, about failure, `401`, authorization `403`, account switch, timer limit, sign-out, and same-account reauthorization.
  - **Tests or fixtures:** Use fixed clocks, two accounts, a fake about adapter, and a spy repository gate.
  - **Validation:** `bun test tests/auth-service.test.ts`. Then run `bun run check`.
  - **Acceptance:** No private repository read occurs before successful token-to-account binding. Sign-out keeps cached data inaccessible.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- No private repository read occurs before successful token-to-account binding. Sign-out keeps cached data inaccessible.

The planned validation is:

- `bun test tests/auth-service.test.ts`. Then run `bun run check`.

Only the parent can change task `P29-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P29-T01`.
