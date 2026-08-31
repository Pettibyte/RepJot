# Phase 10: Integrate contract build gates

## 1. Mission

Wire the contract commands and complete independent traceability after Phases 1 through 9 pass.

## 2. Prerequisites and scope

The parent judge must accept Phase 9 before this phase starts.

This phase owns command integration and the final contract audit. It cannot repair semantic behavior without returning the defect to its owning phase.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read the sources named in this task before editing.

## 4. Ordered task

- [ ] **P10-T01 — Integrate contract build gates**
  - **Objective:** Make schema, static, compatibility, type, test, build, and Kindle checks available as Bun scripts.
  - **Inspect:** `package.json`, `vite.config.ts`, `scripts/check-browser-compat.ts`, and Architecture Section 18.
  - **Create or edit:** `package.json`, `bun.lock`, validation scripts, and test configuration files in TypeScript only.
  - **Steps:** Add `validate:schemas`, `validate:static`, `validate:static:fixtures`, and `compare:production`. Keep `check`, `test`, `build`, and `check:compat`. Include all TypeScript scripts and tests in strict type checks. Make scripts fail closed. Do not add JavaScript source files. Make `validate:static` require canonical inputs. Make `validate:static:fixtures` require the repository fixture set.
  - **Edge cases:** A missing selected input, failed download, absent manifest, schema compile error, or incompatible fixture must return a nonzero result.
  - **Tests or fixtures:** Add command-level tests for canonical and fixture modes.
  - **Validation:** `bun install --frozen-lockfile`, `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run build`, `bun run check:compat`.
  - **Acceptance:** Section 18 gates 1-5 pass against repository fixtures. Canonical validation reports a content blocker until approved files exist. Gate 7 passes in fixture mode. Existing ES2019 and authorization gates remain active.

  - **Audit objective:** Prove that Phases 1-10 own each listed contract. Do not claim unavailable production evidence.
  - **Audit inspection:** Read Architecture Sections 17, 18, 19, and 20. Inspect the complete diff.
  - **Audit edits:** Edit tests and fixture notes only when an ownership gap exists.
  - **Audit steps:** Map each contract requirement to a passing or failing fixture. Inspect imports for architecture direction. Record external blockers.
  - **Audit edge cases:** A test of only its generated types is insufficient. A candidate is not a baseline before human approval.
  - **Audit fixtures:** Add one negative test for each uncovered invariant.
  - **Audit validation:** Run `bun run compare:production -- --fixture tests/fixtures/compatibility/compatible` with the other planned commands.
  - **Audit acceptance:** Every contract traceability row has objective evidence. Phase 0 behavior remains unchanged. External content gaps remain explicit.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- All contract commands fail closed and pass their valid repository fixtures.
- Every contract row has objective evidence.
- Missing human content and baseline evidence remains explicit.
- Phase 0 behavior remains unchanged.

The planned validation is:

- `bun install --frozen-lockfile`
- `bun run check`
- `bun run test`
- `bun run validate:schemas`
- `bun run validate:static:fixtures`
- `bun run build`
- `bun run check:compat`

Only the parent can change task `P10-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P10-T01`.
