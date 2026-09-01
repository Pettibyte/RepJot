# Phase 44: Emit bounded, allowlisted diagnostic events

## 1. Mission

Record decision evidence without changing synchronization outcomes or leaking user data.

## 2. Prerequisites and scope

The parent judge must accept Phase 43 before this phase starts.

This phase covers one task in the merge and synchronization workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P44-T01 — Emit bounded, allowlisted diagnostic events**
  - **Objective:** Record decision evidence without changing synchronization outcomes or leaking user data.
  - **Inspect:** Architecture Diagnostic Event Capture, ADR-018, and risk R-12.
  - **Create or edit:** `src/diagnostics/diagnostic-service.ts`, event code definitions, coordinator calls, and `tests/diagnostic-service.test.ts`.
  - **Steps:** Create one correlation ID per reconciliation/cleanup. Emit catalog, validation, merge-count, preflight, retry, ambiguity, read-back, commit, and duplicate-stage events. Alias sensitive identifiers with account-local salt. Allow only typed scalar context.
  - **Edge cases:** Diagnostic append failure, alias collision test input, forbidden raw error message, token in caller input, unknown file, and partial cleanup.
  - **Tests or fixtures:** Inject tokens, raw IDs, notes, measurements, content, stack traces, and URL queries. Assert export exclusion.
  - **Validation:** `bun test tests/diagnostic-service.test.ts tests/diagnostic-repository.test.ts`. Then run `bun run check`.
  - **Acceptance:** Logging failure cannot change merge/persistence results. No forbidden value appears in stored/exported JSON.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Logging failure cannot change merge/persistence results. No forbidden value appears in stored/exported JSON.

The planned validation is:

- `bun test tests/diagnostic-service.test.ts tests/diagnostic-repository.test.ts`. Then run `bun run check`.

Only the parent can change task `P44-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P44-T01`.
