# Phase 80: Enforce frozen install, type, test, schema, and static gates

## 1. Mission

Make Section 18 gates 1-4 reproducible from a clean dependency state.

## 2. Prerequisites and scope

The parent judge must accept Phase 79 before this phase starts.

This phase covers one task in the compatibility, security, and release workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P80-T01 — Enforce frozen install, type, test, schema, and static gates**
  - **Objective:** Make Section 18 gates 1-4 reproducible from a clean dependency state.
  - **Inspect:** `package.json`, `bun.lock`, all validation commands, and static source inputs.
  - **Create or edit:** Package scripts, release audit tests, and runbook.
  - **Steps:** Require frozen install. Run strict Svelte/TypeScript checks. Run all unit/integration tests. Validate every schema and repository fixture. When approved static data exists, run canonical schema/semantic validation separately. Missing approved content changes only gate 4 evidence.
  - **Edge cases:** Lock drift, unavailable local source checkout, stale generated static files, skipped test, schema warning, and missing canonical file.
  - **Tests or fixtures:** Add command orchestration tests without bypass flags. Keep fixture and canonical results distinct.
  - **Validation:** `bun install --frozen-lockfile`, `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`.
  - **Acceptance:** Gates 1-3 pass. Gate 4 passes only after `bun run validate:static` succeeds on approved canonical inputs. Otherwise gate 4 is `NOT PROVIDED` or `FAIL`, and later release-tool tasks continue.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Gates 1-3 pass. Gate 4 passes only after `bun run validate:static` succeeds on approved canonical inputs. Otherwise gate 4 is `NOT PROVIDED` or `FAIL`, and later release-tool tasks continue.

The planned validation is:

- `bun install --frozen-lockfile`, `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`.

Only the parent can change task `P80-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P80-T01`.
