# Phase 70: Build the active workout hierarchy and core result controls

## 1. Mission

Render one vertical editor for nested work and all measurement types.

## 2. Prerequisites and scope

The parent judge must accept Phase 69 before this phase starts.

This phase covers one task in the product screens workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P70-T01 — Build the active workout hierarchy and core result controls**
  - **Objective:** Render one vertical editor for nested work and all measurement types.
  - **Inspect:** Requirements 19.1-19.10, design brief Active Workout, and Phases 58-66 components.
  - **Create or edit:** `src/ui/screens/ActiveWorkoutScreen.svelte`, components under `src/ui/workout/`, and tests.
  - **Steps:** Use compact Back header with no tabs. Style first three levels distinctly. Show deeper named paths. Render native labeled controls for reps, weight, duration, distance, calories, effort, reasons, attempts, EMOM, sides, and notes. Put Finish at document end.
  - **Edge cases:** Empty optional name, very deep path, keyboard input, no touch, long notes, alternating odd reps, added attempt, and control font failure.
  - **Tests or fixtures:** Assert semantic labels, input modes, keyboard use, focus order, and no custom controls.
  - **Validation:** `bun test tests/ui/active-workout-screen.test.ts`. Then run `bun run check`. Then run `bun run build`. Then run `bun run check:compat`.
  - **Acceptance:** Every schema-supported result and notes scope has a usable control. Core use does not depend on glyphs, touch, hover, Grid, or animation.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Every schema-supported result and notes scope has a usable control. Core use does not depend on glyphs, touch, hover, Grid, or animation.

The planned validation is:

- `bun test tests/ui/active-workout-screen.test.ts`. Then run `bun run check`. Then run `bun run build`. Then run `bun run check:compat`.

Only the parent can change task `P70-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P70-T01`.
