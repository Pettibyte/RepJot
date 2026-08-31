# Phase 31: Define the complete Drive adapter contract

## 1. Mission

Give application services stable typed operations without exposing `fetch`.

## 2. Prerequisites and scope

The parent judge must accept Phase 30 before this phase starts.

This phase covers one task in the authentication and drive adapters workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P31-T01 — Define the complete Drive adapter contract**
  - **Objective:** Give application services stable typed operations without exposing `fetch`.
  - **Inspect:** Architecture Section 11 requests and metadata fields.
  - **Create or edit:** `src/drive/drive-interface.ts`, `src/drive/drive-errors.ts`, and contract tests.
  - **Steps:** Define list pages, read bytes, metadata read, generated IDs, create with supplied ID, update, delete, and about. Include response metadata and retry headers. Classify authentication, rate, quota, retryable server, network, timeout, malformed, and ambiguous errors.
  - **Edge cases:** Keep missing file distinct from malformed response. Preserve optional checksum/version/size fields. Never expose raw response bodies in safe errors.
  - **Tests or fixtures:** Add type-level fixtures and redaction assertions.
  - **Validation:** `bun test tests/drive-rest-adapter.test.ts`. Then run `bun run check`.
  - **Acceptance:** Application and domain code can use the interface without importing Fetch or DOM types.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Application and domain code can use the interface without importing Fetch or DOM types.

The planned validation is:

- `bun test tests/drive-rest-adapter.test.ts`. Then run `bun run check`.

Only the parent can change task `P31-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P31-T01`.
