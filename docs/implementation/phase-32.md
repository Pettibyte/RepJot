# Phase 32: Implement Drive REST transport and pagination

## 1. Mission

Implement exact appDataFolder requests and complete page traversal.

## 2. Prerequisites and scope

The parent judge must accept Phase 31 before this phase starts.

This phase covers one task in the authentication and drive adapters workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P32-T01 — Implement Drive REST transport and pagination**
  - **Objective:** Implement exact appDataFolder requests and complete page traversal.
  - **Inspect:** Existing `src/google-drive.ts`, Architecture Section 11, and storage spec Drive Catalog.
  - **Create or edit:** `src/drive/drive-rest-adapter.ts`, `tests/drive-rest-adapter.test.ts`, and fetch fixtures.
  - **Steps:** Send bearer tokens only in HTTPS headers. Use exact catalog fields, `spaces=appDataFolder`, `trashed=false`, and page size 1000. Implement content, metadata, generate-ID, create-with-ID, update-in-place, delete, and about requests.
  - **Edge cases:** Cover multiple pages, empty pages with token, token loops, malformed JSON, `204`, `404`, `401`, authorization `403`, quota `403`, `429`, retryable `5xx`, timeout, and unreadable response.
  - **Tests or fixtures:** Use a request-recording fetch fake. Assert no token enters URL, error, or diagnostics.
  - **Validation:** `bun test tests/drive-rest-adapter.test.ts`. Then run `bun run check`. Then run `bun run check:compat`.
  - **Acceptance:** Every page is followed once. Normal updates retain file IDs. Creates accept a reserved generated ID.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Every page is followed once. Normal updates retain file IDs. Creates accept a reserved generated ID.

The planned validation is:

- `bun test tests/drive-rest-adapter.test.ts`. Then run `bun run check`. Then run `bun run check:compat`.

Only the parent can change task `P32-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P32-T01`.
