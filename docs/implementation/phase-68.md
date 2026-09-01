# Phase 68: Implement Choose Workout

## 1. Mission

Show available workouts, all active sessions, and five recent terminal sessions.

## 2. Prerequisites and scope

The parent judge must accept Phase 67 before this phase starts.

This phase covers one task in the product screens workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P68-T01 — Implement Choose Workout**
  - **Objective:** Show available workouts, all active sessions, and five recent terminal sessions.
  - **Inspect:** Requirements 17 and authoritative navigation rules.
  - **Create or edit:** `src/ui/screens/ChooseWorkoutScreen.svelte` and focused tests.
  - **Steps:** Use the tab-root shell. List nondeprecated workouts with title and latest completion date. Put all in-progress sessions above Recent, newest `updatedAtUtc` first. Show today time or prior date. Resume active entries. Add five through `Load older` where applicable.
  - **Edge cases:** No workouts, deprecated workout, no history, several active shards, equal timestamps, abandoned recent, and unavailable older data.
  - **Tests or fixtures:** Assert ordering, labels, target semantics, and five-record increments.
  - **Validation:** `bun test tests/ui/choose-workout-screen.test.ts`. Then run `bun run check`.
  - **Acceptance:** Every active session appears. Deprecated workouts cannot start. The screen uses no mockup thumbnails or remote assets.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Every active session appears. Deprecated workouts cannot start. The screen uses no mockup thumbnails or remote assets.

The planned validation is:

- `bun test tests/ui/choose-workout-screen.test.ts`. Then run `bun run check`.

Only the parent can change task `P68-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P68-T01`.
