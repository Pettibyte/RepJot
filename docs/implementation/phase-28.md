# Phase 28: Extract browser ports and the OAuth redirect adapter

## 1. Mission

Preserve behavior while isolating location, history, storage, form, iframe, timer, and crypto APIs.

## 2. Prerequisites and scope

The parent judge must accept Phase 27 before this phase starts.

This phase covers one task in the authentication and drive adapters workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P28-T01 — Extract browser ports and the OAuth redirect adapter**
  - **Objective:** Preserve behavior while isolating location, history, storage, form, iframe, timer, and crypto APIs.
  - **Inspect:** `src/google-identity.ts`, `src/main.ts`, and Architecture Section 10.
  - **Create or edit:** `src/ports/oauth.ts`, `src/auth/oauth-redirect-adapter.ts`, and auth tests.
  - **Steps:** Move pure parsing and state rules behind injected browser ports. Keep `location.replace`. Keep dual-store pending state. Remove the fragment before returning accepted authorization. Retain receipt semantics exactly.
  - **Edge cases:** Cover `history.replaceState` absence, storage exceptions, repeated callback document execution, malformed fragment encoding, and a fragment unrelated to OAuth.
  - **Tests or fixtures:** Add call-order assertions for fragment cleanup, token save, account bind request, and UI mount handoff.
  - **Validation:** `bun test tests/oauth-redirect-adapter.test.ts`. Then run `bun run check`. Then run `bun run check:compat`.
  - **Acceptance:** The adapter never calls `window.open`. The request URL has one exact scope and `response_type=token`.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- The adapter never calls `window.open`. The request URL has one exact scope and `response_type=token`.

The planned validation is:

- `bun test tests/oauth-redirect-adapter.test.ts`. Then run `bun run check`. Then run `bun run check:compat`.

Only the parent can change task `P28-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P28-T01`.
