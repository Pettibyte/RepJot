# Phase 54: Implement session lifecycle with local-first saves

## 1. Mission

Create, save, complete, abandon, delete, and edit sessions through repository ports.

## 2. Prerequisites and scope

The parent judge must accept Phase 53 before this phase starts.

This phase covers one task in the indexes and session domain workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P54-T01 — Implement session lifecycle with local-first saves**
  - **Objective:** Create, save, complete, abandon, delete, and edit sessions through repository ports.
  - **Inspect:** Requirements 11.9-11.24 and Architecture Workout-Session Lifecycle.
  - **Create or edit:** `src/sessions/session-service.ts`, `src/application/session-facade.ts`, and `tests/session-service.test.ts`.
  - **Steps:** Create and persist before active-route navigation. Debounce normal edit requests at facade level. Flush on blur, route change, and pagehide request. Complete with missing-work decision. Remove plan on terminal state. Abandon similarly. Delete live session and add permanent tombstone in its original shard.
  - **Edge cases:** Several active sessions, cross-month completion, back navigation, missing work, finish incomplete, storage failure, sync copy edit/delete, repeated delete, and terminal correction.
  - **Tests or fixtures:** Use fixed clocks, UUIDs, in-memory repository, and save barriers.
  - **Validation:** `bun test tests/session-service.test.ts`. Then run `bun run check`.
  - **Acceptance:** Start is durable before navigation. Back keeps `in_progress`. Terminal edit changes only results/notes and `updatedAtUtc`. Delete writes a tombstone.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Start is durable before navigation. Back keeps `in_progress`. Terminal edit changes only results/notes and `updatedAtUtc`. Delete writes a tombstone.

The planned validation is:

- `bun test tests/session-service.test.ts`. Then run `bun run check`.

Only the parent can change task `P54-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P54-T01`.
