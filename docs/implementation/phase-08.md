# Phase 8: Build the curation contract

## 1. Mission

Implement implement the curated static-data transform contract as one isolated contract boundary.

## 2. Prerequisites and scope

The parent judge must accept Phase 7 before this phase starts.

This phase covers one isolated contract boundary. It cannot wire broad build commands or audit unrelated contract families.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read the sources named in this task before editing.

## 4. Ordered task

- [ ] **P8-T01 — Build the curation contract**
  - **Objective:** Produce deterministic REP JOT exercise data from approved local source data and explicit curation.
  - **Inspect:** Requirements 13.1-13.5, exercise schema classifications, and the source checkout at `../free-exercise-db`.
  - **Create or edit:** `scripts/build-static-data.ts`, typed files under `src/curation/`, process templates under `data/curation/`, and `tests/static-transform.test.ts`. Do not create production `src/public/exercises.json` or `src/public/workouts.json` in this phase without recorded human approval.
  - **Steps:** Default the source path to `../free-exercise-db` and permit an explicit test override. Map source fields without network fetches. Treat `body only` as no equipment. Require explicit curation for `null` equipment, laterality, movement pattern, measurements, and unresolved values. Produce review reports and candidate output in an ignored staging location. Sort output deterministically. Add a separate human-approval input before canonical output can be written.
  - **Edge cases:** Reject a missing source checkout, duplicate source IDs, missing allowlist entries, unknown muscle values, unresolved `null` equipment, absent approval, and unstable output order.
  - **Tests or fixtures:** Use small repository-owned synthetic fixtures. Do not copy fixture data into production static files. Do not treat generated candidates as approved curation.
  - **Validation:** `bun test tests/static-transform.test.ts`, `bun scripts/validate-static.ts --fixture tests/fixtures/static/valid`, `bun run check`.
  - **Acceptance:** The same inputs produce byte-identical candidate JSON and a deterministic review report. Missing curation fails with an actionable ID. Production paths remain unchanged until a human records approval.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- The same inputs produce byte-identical candidate JSON and a deterministic review report. Missing curation fails with an actionable ID. Production paths remain unchanged until a human records approval.

The planned validation is:

- `bun test tests/static-transform.test.ts`, `bun scripts/validate-static.ts --fixture tests/fixtures/static/valid`, `bun run check`.

Only the parent can change task `P8-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P8-T01`.
