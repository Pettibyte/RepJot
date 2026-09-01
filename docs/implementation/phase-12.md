# Phase 12: Parse exact bytes without application limits

## 1. Mission

Reject malformed encoding or JSON while preserving source bytes and accepting documents of all application-level sizes and depths.

## 2. Prerequisites and scope

The parent judge must accept Phase 11 before this phase starts.

This phase covers one task in the document pipeline and migrations workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P12-T01 — Parse exact bytes without application limits**
  - **Objective:** Reject malformed encoding or JSON while preserving source bytes and accepting documents of all application-level sizes and depths.
  - **Inspect:** Architecture Sections 12, 14, and 15, the resolved unlimited-limit decision, and Kindle memory facts.
  - **Create or edit:** `src/documents/safe-json-parser.ts`, generated parser fixtures, and `tests/document-pipeline.test.ts`.
  - **Steps:** Retain the input `Uint8Array` unchanged. Apply the documented byte-order mark policy. Decode UTF-8 strictly. Parse once as `unknown`. Use iterative project traversals where possible. Add no byte, nesting, or node rejection threshold.
  - **Edge cases:** Cover empty bytes, a byte-order mark, invalid UTF-8, malformed JSON, deep arrays, deep objects, huge keys, primitive roots, and platform resource failure.
  - **Tests or fixtures:** Generate deterministic large and deep documents during tests. Keep source-control fixtures small. Test malformed bytes separately from valid stress documents.
  - **Validation:** `bun test tests/document-pipeline.test.ts`. Then run `bun run check`.
  - **Acceptance:** No valid input fails because of a project-defined size, depth, or node count. Malformed encoding and JSON fail safely. Source bytes do not change. Stress measurements are recorded without defining a limit.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- No valid input fails because of a project-defined size, depth, or node count. Malformed encoding and JSON fail safely. Source bytes do not change. Stress measurements are recorded without defining a limit.

The planned validation is:

- `bun test tests/document-pipeline.test.ts`. Then run `bun run check`.

Only the parent can change task `P12-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P12-T01`.
