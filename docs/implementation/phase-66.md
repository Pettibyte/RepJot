# Phase 66: Remove obsolete prototype shell only after replacement tests pass

## 1. Mission

Delete hello-world UI paths without removing proven authorization behavior.

## 2. Prerequisites and scope

The parent judge must accept Phase 65 before this phase starts.

This phase covers one task in the shell, routing, and status ui workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P66-T01 — Remove obsolete prototype shell only after replacement tests pass**
  - **Objective:** Delete hello-world UI paths without removing proven authorization behavior.
  - **Inspect:** All references to `src/google-drive.ts`, compatibility exports, and prototype copy.
  - **Create or edit:** `src/App.svelte`, obsolete prototype modules, imports, and tests.
  - **Steps:** Replace `App.svelte` with production shell composition. Remove hello-world Drive calls and prototype controls. Remove obsolete compatibility exports only if no production or test import needs them. Keep Phases 27-35 adapters and Phase 0 tests.
  - **Edge cases:** Hidden stale imports, duplicate callback consumption, unused broad Drive methods, and compatibility script scope checks.
  - **Tests or fixtures:** Add an import graph or bundle-string regression for prototype text.
  - **Validation:** `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run build`, `bun run check:compat`.
  - **Acceptance:** No hello-world behavior remains in the product shell. All replacement shell and authorization tests pass.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- No hello-world behavior remains in the product shell. All replacement shell and authorization tests pass.

The planned validation is:

- `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run build`, `bun run check:compat`.

Only the parent can change task `P66-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P66-T01`.
