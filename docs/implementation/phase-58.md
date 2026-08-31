# Phase 58: Define and test canonical routes

## 1. Mission

Parse and format every Architecture Section 13 route without a routing dependency.

## 2. Prerequisites and scope

The parent judge must accept Phase 57 before this phase starts.

This phase covers one task in the shell, routing, and status ui workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P58-T01 — Define and test canonical routes**
  - **Objective:** Parse and format every Architecture Section 13 route without a routing dependency.
  - **Inspect:** Architecture route table and navigation rules.
  - **Create or edit:** `src/routing/routes.ts`, `src/routing/hash-router.ts`, and `tests/hash-router.test.ts`.
  - **Steps:** Define root, workout overview, active session, summary, history, exercise history, and settings routes. Encode/decode one path segment per ID. Normalize empty/invalid hashes to typed results. Preserve browser back semantics.
  - **Edge cases:** Cover malformed escapes, extra segments, query-like text, empty IDs, unsafe IDs, unknown route, direct reload, and auth return routes.
  - **Tests or fixtures:** Round-trip every valid route and reject malformed variants.
  - **Validation:** `bun test tests/hash-router.test.ts`. Then run `bun run check`.
  - **Acceptance:** Formatting then parsing preserves route values. The router stores no domain object and makes no data request.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Formatting then parsing preserves route values. The router stores no domain object and makes no data request.

The planned validation is:

- `bun test tests/hash-router.test.ts`. Then run `bun run check`.

Only the parent can change task `P58-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P58-T01`.
