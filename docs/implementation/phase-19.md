# Phase 19: Define storage records and ports

## 1. Mission

Separate application-facing repository contracts from IndexedDB request objects.

## 2. Prerequisites and scope

The parent judge must accept Phase 18 before this phase starts.

This phase covers one task in the indexeddb persistence workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P19-T01 — Define storage records and ports**
  - **Objective:** Separate application-facing repository contracts from IndexedDB request objects.
  - **Inspect:** Architecture Section 8 store table and pending-edit sketch.
  - **Create or edit:** Files under `src/ports/`, `src/storage/idb-schema.ts`, and `tests/storage-contracts.test.ts`.
  - **Steps:** Define keys and records for all eight stores. Use explicit UTC field names. Keep raw source bytes, current model, metadata, provenance, attempts, next retry, safe error, and receipt digest fields.
  - **Edge cases:** Model a missing remote base with `null`. Keep optional Drive metadata distinct from absent files. Do not put tokens or display names in pending edits or diagnostics.
  - **Tests or fixtures:** Add compile-time and runtime key-shape tests with two accounts and two shards.
  - **Validation:** `bun test tests/storage-contracts.test.ts`. Then run `bun run check`.
  - **Acceptance:** Ports import only domain/shared types. They expose no `IDBRequest`, `IDBTransaction`, DOM, or Svelte type.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Ports import only domain/shared types. They expose no `IDBRequest`, `IDBTransaction`, DOM, or Svelte type.

The planned validation is:

- `bun test tests/storage-contracts.test.ts`. Then run `bun run check`.

Only the parent can change task `P19-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P19-T01`.
