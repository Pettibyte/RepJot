# Phase 2: Define canonical document types

## 1. Mission

Define exact TypeScript contracts for the four v1 document families and their logical filenames.

## 2. Prerequisites and scope

The parent judge must accept Phase 1 before this phase starts.

This phase owns domain document types, family constants, filename recognition types, and deterministic test builders. It does not own schema compilation.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read the sources named in this task before editing.

## 4. Ordered task

- [x] **P2-T01 — Define canonical document types**
  - **Objective:** Implement the document shapes that Phase 1 approved.
  - **Inspect:** The approved contract matrix, every file under `schemas/`, and the three data specifications.
  - **Create or edit:** `src/domain/documents.ts`, focused domain type files, and deterministic test builders.
  - **Steps:** Define discriminated types for exercises, workouts, preferences, and monthly results. Define family, version, and logical-name constants. Keep unvalidated input typed as `unknown`.
  - **Edge cases:** Cover unknown families, nonpositive versions, malformed result names, offset timestamps, and shard-name disagreement.
  - **Tests:** Add one minimal valid object for each family and malformed envelope variants.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Types match the approved matrix and v1 schemas.
- No runtime assertion makes unvalidated input trusted.
- Existing Phase 0 behavior remains unchanged.

The planned validation is:

- `bun install --frozen-lockfile`
- `bun run check`
- `bun test tests/google-identity.test.ts`
- Focused document-contract tests

Only the parent can change task `P2-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P2-T01`.
