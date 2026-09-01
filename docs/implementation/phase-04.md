# Phase 4: Validate static document semantics

## 1. Mission

Implement only the semantic rules for static exercises and workouts.

## 2. Prerequisites and scope

The parent judge must accept Phase 3 before this phase starts.

This phase excludes result sessions, result paths, score derivation, deprecation omissions, icons, curation, and compatibility.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read the sources named in this task before editing.

## 4. Ordered task

- [x] **P4-T01 — Validate static document semantics**
  - **Objective:** Validate static references, dimensions, units, prescriptions, and workout structure.
  - **Inspect:** The approved invariant matrix, Requirements Sections 6, 9, and 10, and the JSON specification.
  - **Create or edit:** Focused modules under `src/validation/semantic/` and static semantic tests.
  - **Steps:** Build local `Map` and `Set` indexes. Apply only matrix rows owned by static exercises or workouts. Return stable diagnostic codes and JSON Pointer paths.
  - **Edge cases:** Cover missing references, duplicate dimensions, interleaved unit systems, invalid prescriptions, nested repeats, and repeated node IDs across workouts.
  - **Tests:** Add independent contextual static fixtures. Do not reuse production curation output.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Every static semantic matrix row has focused positive and negative evidence.
- Result-session and score behavior remains absent.
- Validation stays pure and imports no browser or Svelte module.

The planned validation is:

- Focused static semantic tests
- `bun run check`
- Prior schema and Phase 0 tests

Only the parent can change task `P4-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P4-T01`.
