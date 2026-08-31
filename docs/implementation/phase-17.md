# Phase 17: Load static families in dependency order

## 1. Mission

Fetch or read `exercises.json` before `workouts.json` through an injected text source.

## 2. Prerequisites and scope

The parent judge must accept Phase 16 before this phase starts.

This phase covers one task in the document pipeline and migrations workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P17-T01 — Load static families in dependency order**
  - **Objective:** Fetch or read `exercises.json` before `workouts.json` through an injected text source.
  - **Inspect:** Architecture Section 9 startup sequence and Phases 1-10 static fixtures.
  - **Create or edit:** `src/documents/static-loader.ts`, `src/ports/document-byte-source.ts`, `src/infrastructure/bundle-byte-source.ts`, and `tests/static-loader.test.ts`.
  - **Steps:** Define a byte-source interface and a browser Fetch implementation outside domain code. Fetch an `ArrayBuffer` and preserve its exact `Uint8Array` before strict decoding. Load exact bundle-relative names. Pass validated exercises as read-only semantic context for workouts. Return a blocking startup error if either static family fails.
  - **Edge cases:** Cover missing file, network error from fake source, wrong content type if exposed, valid exercises plus invalid workouts, and repeated calls.
  - **Tests or fixtures:** Use an in-memory source fake with request-order recording.
  - **Validation:** `bun test tests/static-loader.test.ts`, `bun run check`, `bun run validate:static:fixtures`.
  - **Acceptance:** Tests prove exercises load before workouts. Only the infrastructure bundle adapter calls `fetch`. Phases 58-66 have a concrete static source to inject.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Tests prove exercises load before workouts. Only the infrastructure bundle adapter calls `fetch`. Phases 58-66 have a concrete static source to inject.

The planned validation is:

- `bun test tests/static-loader.test.ts`, `bun run check`, `bun run validate:static:fixtures`.

Only the parent can change task `P17-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P17-T01`.
