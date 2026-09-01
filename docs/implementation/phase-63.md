# Phase 63: Build shared semantic shell controls

## 1. Mission

Create accessible headers, tabs, actions, fields, statuses, and recovery panels.

## 2. Prerequisites and scope

The parent judge must accept Phase 62 before this phase starts.

This phase covers one task in the shell, routing, and status ui workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P63-T01 — Build shared semantic shell controls**
  - **Objective:** Create accessible headers, tabs, actions, fields, statuses, and recovery panels.
  - **Inspect:** Architecture Sections 13, 14, and 16 and Requirements 8.
  - **Create or edit:** Shared Svelte components under `src/ui/components/` and component tests.
  - **Steps:** Implement `BrandHeader`, `BackHeader`, `TabNav`, `ActionButton`, `LabeledInput`, `SaveStatus`, `SyncStatus`, `ErrorPanel`, `LoadingPanel`, and simple workout-tree framing. Use props/events only. Keep names and visible labels.
  - **Edge cases:** Keyboard-only use, icon font failure, long safe error, status without color, disabled action, live-region chatter, and focus return.
  - **Tests or fixtures:** Assert roles, headings, labels, accessible names, focus order, and exact status meanings.
  - **Validation:** `bun test tests/ui/shared-components.test.ts`. Then run `bun run check`.
  - **Acceptance:** Controls use semantic HTML. No component calls `fetch`, IndexedDB, or a repository.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Controls use semantic HTML. No component calls `fetch`, IndexedDB, or a repository.

The planned validation is:

- `bun test tests/ui/shared-components.test.ts`. Then run `bun run check`.

Only the parent can change task `P63-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P63-T01`.
