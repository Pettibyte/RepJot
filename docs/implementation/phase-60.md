# Phase 60: Rework bootstrap without changing OAuth callback order

## 1. Mission

Install polyfills, consume the callback, clear fragments, validate static data, and mount one shell in the correct order.

## 2. Prerequisites and scope

The parent judge must accept Phase 59 before this phase starts.

This phase covers one task in the shell, routing, and status ui workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P60-T01 — Rework bootstrap without changing OAuth callback order**
  - **Objective:** Install polyfills, consume the callback, clear fragments, validate static data, and mount one shell in the correct order.
  - **Inspect:** Existing `src/main.ts`, `src/polyfills.ts`, `src/index.html`, and call-order tests.
  - **Create or edit:** `src/bootstrap.ts`, `src/main.ts`, and bootstrap tests.
  - **Steps:** Keep required polyfills first. Consume OAuth response before mount. Make sure that the adapter removes the fragment before diagnostics or private loads. Start static validation. Mount the shell and signal the classic loader.
  - **Edge cases:** Callback error, unrelated hash route, missing app target, static-load failure, repeated callback execution, and boot timeout.
  - **Tests or fixtures:** Add a bootstrap call-order fake. Preserve all Phase 0 tests.
  - **Validation:** `bun test tests/bootstrap.test.ts tests/google-identity.test.ts`. Then run `bun run build`. Then run `bun run check:compat`.
  - **Acceptance:** One callback consumer runs. No token fragment reaches Svelte state or diagnostics. Classic loader behavior remains intact.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- One callback consumer runs. No token fragment reaches Svelte state or diagnostics. Classic loader behavior remains intact.

The planned validation is:

- `bun test tests/bootstrap.test.ts tests/google-identity.test.ts`. Then run `bun run build`. Then run `bun run check:compat`.

Only the parent can change task `P60-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P60-T01`.
