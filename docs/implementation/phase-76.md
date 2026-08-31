# Phase 76: Implement Settings units, exports, and diagnostics

## 1. Mission

Expose preference mappings and user-controlled downloads through facades.

## 2. Prerequisites and scope

The parent judge must accept Phase 75 before this phase starts.

This phase covers one task in the product screens workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P76-T01 — Implement Settings units, exports, and diagnostics**
  - **Objective:** Expose preference mappings and user-controlled downloads through facades.
  - **Inspect:** Requirements 12.3, 12.10-12.12, 21.1-21.2 and Architecture export rules.
  - **Create or edit:** `src/ui/screens/SettingsScreen.svelte`, `src/ui/adapters/browser-download-adapter.ts`, settings components, and tests.
  - **Steps:** List exercise-to-unit mappings. Add raw appData export, diagnostic privacy notice/download, and clear action. Use Blob, object URL, and download attribute. Revoke object URLs. Show exact non-commercial licensing text.
  - **Edge cases:** Duplicate raw names, unsafe names already sanitized by facade, unknown file bytes, partial export failure, no diagnostics, download API error, and object URL cleanup.
  - **Tests or fixtures:** Assert raw export and diagnostics remain separate. Assert no network call for diagnostic download.
  - **Validation:** `bun test tests/ui/settings-screen.test.ts tests/ui/browser-download-adapter.test.ts`. Then run `bun run check`. Then run `bun run check:compat`.
  - **Acceptance:** Settings shows both required sections and exact licensing text. Diagnostics never enter Drive export or a network request.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Settings shows both required sections and exact licensing text. Diagnostics never enter Drive export or a network request.

The planned validation is:

- `bun test tests/ui/settings-screen.test.ts tests/ui/browser-download-adapter.test.ts`. Then run `bun run check`. Then run `bun run check:compat`.

Only the parent can change task `P76-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P76-T01`.
