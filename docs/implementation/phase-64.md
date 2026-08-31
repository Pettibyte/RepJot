# Phase 64: Implement anonymous and authenticated shells

## 1. Mission

Compose auth, startup, navigation, status, and route outlets.

## 2. Prerequisites and scope

The parent judge must accept Phase 63 before this phase starts.

This phase covers one task in the shell, routing, and status ui workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P64-T01 — Implement anonymous and authenticated shells**
  - **Objective:** Compose auth, startup, navigation, status, and route outlets.
  - **Inspect:** Requirements 14.1 and 16 and Architecture startup states.
  - **Create or edit:** `src/ui/shell/AnonymousShell.svelte`, `AuthenticatedShell.svelte`, route outlet files, and shell tests.
  - **Steps:** Show a public REP JOT description, a link to `/privacy.html`, remember choice, and Google action. Show account-gated tab roots and compact detail headers. Render loading and recovery actions from state. Restore prior route after reauthorization.
  - **Edge cases:** Unconfigured client ID in development, denial, offline warm/empty state, invalid route, account switch, and expired token on detail route.
  - **Tests or fixtures:** Test each startup-state row and each header/tab rule.
  - **Validation:** `bun test tests/ui/shell.test.ts`. Then run `bun run check`. Then run `bun run build`. Then run `bun run check:compat`.
  - **Acceptance:** Branding is always `REP JOT`. No private content leaks anonymously. Active/detail routes never show tabs.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Branding is always `REP JOT`. No private content leaks anonymously. Active/detail routes never show tabs.

The planned validation is:

- `bun test tests/ui/shell.test.ts`. Then run `bun run check`. Then run `bun run build`. Then run `bun run check:compat`.

Only the parent can change task `P64-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P64-T01`.
