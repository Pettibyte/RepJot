# Phase 83: Build with production public configuration and exclude secrets

## 1. Mission

Complete Section 18 gate 8 without placing a client secret in source, environment output, or `dist/`.

## 2. Prerequisites and scope

The parent judge must accept Phase 82 before this phase starts.

This phase covers one task in the compatibility, security, and release workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P83-T01 — Build with production public configuration and exclude secrets**
  - **Objective:** Complete Section 18 gate 8 without placing a client secret in source, environment output, or `dist/`.
  - **Inspect:** Vite environment handling, `.env.example`, production client-ID source, and build output.
  - **Create or edit:** Typed environment validation, `vite.config.ts`, build tests, and runbook.
  - **Steps:** Require a syntactically valid public production web client ID. Refuse placeholder values. Keep test and production project IDs separate. Replace time-based build identifiers with an injected deterministic release ID. Add a release-fixture build mode with a fake public ID for tooling tests. Build relative static assets to `dist/`. Scan all output for secret-like config keys and known test IDs.
  - **Edge cases:** Missing ID, test ID in production mode, client secret variable, environment dump, time-based cache key, absolute development URL, and source map.
  - **Tests or fixtures:** Use fake public IDs only in explicit fixture mode. Never commit a secret.
  - **Validation:** `bun run build:release-fixture`, `bun test tests/bundle.test.ts`.
  - **Acceptance:** Build tooling completes without external credentials. Gate 8 is `NOT PROVIDED` until the real production public ID builds successfully. Repeated fixture and production builds from identical inputs are byte-identical. No secret or environment dump enters output.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Build tooling completes without external credentials. Gate 8 is `NOT PROVIDED` until the real production public ID builds successfully. Repeated fixture and production builds from identical inputs are byte-identical. No secret or environment dump enters output.

The planned validation is:

- `bun run build:release-fixture`, `bun test tests/bundle.test.ts`.

Only the parent can change task `P83-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P83-T01`.
