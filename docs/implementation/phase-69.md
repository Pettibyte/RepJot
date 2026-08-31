# Phase 69: Implement Workout Overview and durable start

## 1. Mission

Show the programmed tree and start one locally durable session.

## 2. Prerequisites and scope

The parent judge must accept Phase 68 before this phase starts.

This phase covers one task in the product screens workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P69-T01 — Implement Workout Overview and durable start**
  - **Objective:** Show the programmed tree and start one locally durable session.
  - **Inspect:** Requirements 18 and Phases 47-57 session facade.
  - **Create or edit:** `src/ui/screens/WorkoutOverviewScreen.svelte`, shared read-only tree components, and tests.
  - **Steps:** Use compact Back header. Render structure, strategies, prescriptions, notes, and scored rules read-only. On Start, call the facade once, wait for local commit, then navigate to active route.
  - **Edge cases:** Deprecated workout, secure-random failure, storage failure, repeated activation, slow save, and deep tree.
  - **Tests or fixtures:** Add save barrier and double-action prevention tests.
  - **Validation:** `bun test tests/ui/workout-overview-screen.test.ts`. Then run `bun run check`.
  - **Acceptance:** Navigation cannot occur before durable creation. Failure keeps the overview and shows a safe recovery action.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Navigation cannot occur before durable creation. Failure keeps the overview and shows a safe recovery action.

The planned validation is:

- `bun test tests/ui/workout-overview-screen.test.ts`. Then run `bun run check`.

Only the parent can change task `P69-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P69-T01`.
