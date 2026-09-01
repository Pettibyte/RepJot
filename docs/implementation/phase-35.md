# Phase 35: Integrate adapter boundaries and preserve prototype compatibility

## 1. Mission

Export production services without forcing Phases 27-35 to implement product screens.

## 2. Prerequisites and scope

The parent judge must accept Phase 34 before this phase starts.

This phase covers one task in the authentication and drive adapters workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P35-T01 — Integrate adapter boundaries and preserve prototype compatibility**
  - **Objective:** Export production services without forcing Phases 27-35 to implement product screens.
  - **Inspect:** All imports of `google-identity` and `google-drive`, plus the full diff.
  - **Create or edit:** Thin compatibility exports only where current prototype compilation requires them. Do not extend hello-world behavior.
  - **Steps:** Route tested auth behavior to new modules. Keep the prototype compiling until Phase 66 replaces `App.svelte`. Mark prototype Drive functions obsolete in source comments if necessary. Do not delete them while imported.
  - **Edge cases:** Avoid two token stores or two callback consumers. Bootstrap must call exactly one callback path.
  - **Tests or fixtures:** Run old and new authorization tests together. Add an import-boundary test.
  - **Validation:** `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run build`, `bun run check:compat`.
  - **Acceptance:** Broad checks pass. One auth implementation owns storage. Product code has typed Drive ports ready for Phases 36-46.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Broad checks pass. One auth implementation owns storage. Product code has typed Drive ports ready for Phases 36-46.

The planned validation is:

- `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run build`, `bun run check:compat`.

Only the parent can change task `P35-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P35-T01`.
