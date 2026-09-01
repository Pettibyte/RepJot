# Phase 88: Run conventional browser release-candidate tests

## 1. Mission

Complete the conventional-browser part of Section 18 gate 14.

## 2. Prerequisites and scope

The parent judge must accept Phase 87 before this phase starts.

This phase covers one task in the compatibility, security, and release workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P88-T01 — Run conventional browser release-candidate tests**
  - **Objective:** Complete the conventional-browser part of Section 18 gate 14.
  - **Inspect:** Product flow tests, release candidate, and launch routes.
  - **Create or edit:** Browser smoke harness in TypeScript and `docs/RELEASE.md`.
  - **Steps:** Serve the exact release candidate with a Bun-driven test harness. Exercise anonymous landing, route reloads, fake-auth account gates where automation permits, local save/reload, histories, exports, and accessibility smoke. Record browser/version and artifact digest.
  - **Edge cases:** Direct hash URL, offline warm state, storage denial, font failure, long workout, object URL cleanup, and no service worker.
  - **Tests or fixtures:** Keep network/account operations fake unless an approved test project is used.
  - **Validation:** `bun run test:browser`. Then run `bun run test:bundle`.
  - **Acceptance:** Automated conventional-browser smoke passes against the exact candidate digest. It does not satisfy the Kindle half of gate 14.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Automated conventional-browser smoke passes against the exact candidate digest. It does not satisfy the Kindle half of gate 14.

The planned validation is:

- `bun run test:browser`. Then run `bun run test:bundle`.

Only the parent can change task `P88-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P88-T01`.
