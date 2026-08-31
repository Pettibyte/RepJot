# Phase 84: Harden ES2019 classic output and migrate probe sources

## 1. Mission

Complete Section 18 gate 9 and remove direct JavaScript source from the repository source tree.

## 2. Prerequisites and scope

The parent judge must accept Phase 83 before this phase starts.

This phase covers one task in the compatibility, security, and release workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P84-T01 — Harden ES2019 classic output and migrate probe sources**
  - **Objective:** Complete Section 18 gate 9 and remove direct JavaScript source from the repository source tree.
  - **Inspect:** `scripts/check-browser-compat.ts`, Vite output, inline loader, capability probe HTML/scripts, and `src/public/*.js`.
  - **Create or edit:** `scripts/test-bundle.ts`, TypeScript capability sources/build path, compatibility tests, and obsolete probe assets.
  - **Steps:** Parse every executable output as ES2019 with correct script mode. Scan for optional chaining and nullish coalescing. Assert classic loader definition/order and cache key. Convert required capability probe scripts to TypeScript-built output. Delete old direct JavaScript sources only after equivalent tests pass.
  - **Edge cases:** Inline executable script, dynamically generated chunk, module tag, deferred classic regression, duplicate `app.js`, prohibited syntax in dependency, and source map.
  - **Tests or fixtures:** Add deliberately invalid syntax fixtures and classic-loader order failures.
  - **Validation:** `bun run check:compat`. Then run `bun run test:bundle`. Then run `bun test tests/bundle.test.ts`.
  - **Acceptance:** Gate 9 passes for every executable file. Source contains no new direct JavaScript files. Generated JavaScript exists only in `dist/`.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Gate 9 passes for every executable file. Source contains no new direct JavaScript files. Generated JavaScript exists only in `dist/`.

The planned validation is:

- `bun run check:compat`. Then run `bun run test:bundle`. Then run `bun test tests/bundle.test.ts`.

Only the parent can change task `P84-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P84-T01`.
