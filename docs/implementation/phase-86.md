# Phase 86: Measure bundle size and file count without thresholds

## 1. Mission

Complete Section 18 gate 11 under the approved unlimited budget decision.

## 2. Prerequisites and scope

The parent judge must accept Phase 85 before this phase starts.

This phase covers one task in the compatibility, security, and release workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P86-T01 — Measure bundle size and file count without thresholds**
  - **Objective:** Complete Section 18 gate 11 under the approved unlimited budget decision.
  - **Inspect:** `dist/`, font assets, duplicate chunks, and Architecture risk R-04.
  - **Create or edit:** Size and file-count report code, release audit tests, and evidence.
  - **Steps:** Measure each output file, each major asset class, total uncompressed bytes, total compressed bytes where deterministic, and file count. Compare against the current candidate and any later baseline for information only. Do not reject output because of byte size or file count. Keep failures for forbidden files, duplicate chunks, source maps, and other independent gates.
  - **Edge cases:** Compression ambiguity, font growth, duplicate app chunks, source maps, a missing baseline, zero-byte assets, and nondeterministic output.
  - **Tests or fixtures:** Add deterministic report-shape, duplicate-file, forbidden-file, and zero-byte tests. Do not add one-byte-over budget tests.
  - **Validation:** `bun run audit:release`. Then run `bun run test:bundle`.
  - **Acceptance:** Gate 11 passes when measurements are complete and reproducible. The report states `unlimited` for size and file-count thresholds. It makes no Kindle memory claim.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Gate 11 passes when measurements are complete and reproducible. The report states `unlimited` for size and file-count thresholds. It makes no Kindle memory claim.

The planned validation is:

- `bun run audit:release`. Then run `bun run test:bundle`.

Only the parent can change task `P86-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P86-T01`.
