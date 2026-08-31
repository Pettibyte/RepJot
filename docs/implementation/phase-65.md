# Phase 65: Implement route readiness, not-found, and save-before-back

## 1. Mission

Resolve IDs after required data loads and make navigation preserve local intent.

## 2. Prerequisites and scope

The parent judge must accept Phase 64 before this phase starts.

This phase covers one task in the shell, routing, and status ui workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P65-T01 — Implement route readiness, not-found, and save-before-back**
  - **Objective:** Resolve IDs after required data loads and make navigation preserve local intent.
  - **Inspect:** Phases 47-57 query/session facades and Architecture Navigation Rules.
  - **Create or edit:** Route controller modules, route outlet components, and tests.
  - **Steps:** Wait for account binding and required shard load. Resolve IDs through query facades. Show typed not-found with safe tab-root action. Before Back, request local flush and await commit. For active sessions, keep `in_progress`.
  - **Edge cases:** Direct reload, missing workout, missing session shard, blocked future shard, flush failure, browser back, and stale route after account switch.
  - **Tests or fixtures:** Use delayed facade fakes and save barriers.
  - **Validation:** `bun test tests/ui/routing.integration.test.ts tests/hash-router.test.ts`. Then run `bun run check`.
  - **Acceptance:** Every canonical route reloads from root HTML. Navigation never loses a committed or pending form save silently.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Every canonical route reloads from root HTML. Navigation never loses a committed or pending form save silently.

The planned validation is:

- `bun test tests/ui/routing.integration.test.ts tests/hash-router.test.ts`. Then run `bun run check`.

Only the parent can change task `P65-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P65-T01`.
