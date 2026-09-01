# Phase 27: Characterize and freeze Phase 0 behavior

## 1. Mission

Convert every Phase 0 behavior into deterministic regression cases before moving code.

## 2. Prerequisites and scope

The parent judge must accept Phase 26 before this phase starts.

This phase covers one task in the authentication and drive adapters workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P27-T01 — Characterize and freeze Phase 0 behavior**
  - **Objective:** Convert every Phase 0 behavior into deterministic regression cases before moving code.
  - **Inspect:** Phase 0 proof, `src/google-identity.ts`, existing tests, and callback bootstrap order.
  - **Create or edit:** `tests/oauth-redirect-adapter.test.ts`, `tests/fakes/fake-browser.ts`, and existing auth tests.
  - **Steps:** Cover checked and unchecked continuity, lost session state, expiry, denial, invalid state, exact-token replay, replay expiry, account switch, sign-out, revocation, and fallback. Assert fragment removal order.
  - **Edge cases:** Cover a different replay token, malformed stored token, missing returned denial state, unsupported token type, missing scope, unavailable secure random, and invalid return route.
  - **Tests or fixtures:** Use fixed clocks and deterministic secure bytes. Do not weaken secure-random production behavior.
  - **Validation:** `bun test tests/google-identity.test.ts tests/oauth-redirect-adapter.test.ts`. Then run `bun run check:compat`.
  - **Acceptance:** Every P0-01 through P0-08 behavior has an automated regression. No test opens a secondary browsing context.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Every P0-01 through P0-08 behavior has an automated regression. No test opens a secondary browsing context.

The planned validation is:

- `bun test tests/google-identity.test.ts tests/oauth-redirect-adapter.test.ts`. Then run `bun run check:compat`.

Only the parent can change task `P27-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P27-T01`.
