# Phase 30: Implement revocation and disconnect service behavior

## 1. Mission

Preserve hidden-form revocation, Drive rejection confirmation, cleanup timing, and fallback.

## 2. Prerequisites and scope

The parent judge must accept Phase 29 before this phase starts.

This phase covers one task in the authentication and drive adapters workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P30-T01 — Implement revocation and disconnect service behavior**
  - **Objective:** Preserve hidden-form revocation, Drive rejection confirmation, cleanup timing, and fallback.
  - **Inspect:** Phase 0 P0-07/P0-08, Requirements 2.13 and 21.5-21.7.
  - **Create or edit:** OAuth adapter revocation code, auth service disconnect flow, and tests.
  - **Steps:** Submit the token in a transient hidden form to the exact Google endpoint. Target a hidden iframe. Poll Drive about until `401` or timeout. Clear selected local account only after confirmation. Retain local state and expose the account-connections URL on failure.
  - **Edge cases:** Cover expired token requiring reauthorization, network loss, non-401 response, submit error, timeout, repeated disconnect, and cleanup after completion.
  - **Tests or fixtures:** Add deterministic timers and DOM fakes. Assert no visible secondary window.
  - **Validation:** `bun test tests/auth-service.test.ts tests/oauth-redirect-adapter.test.ts`. Then run `bun run check:compat`.
  - **Acceptance:** Failed revocation never reports success or clears local data. Confirmed revocation clears authorization and only the selected namespace.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Failed revocation never reports success or clears local data. Confirmed revocation clears authorization and only the selected namespace.

The planned validation is:

- `bun test tests/auth-service.test.ts tests/oauth-redirect-adapter.test.ts`. Then run `bun run check:compat`.

Only the parent can change task `P30-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P30-T01`.
