# Phase 89: Execute and record the physical Kindle smoke gate

## 1. Mission

Complete the Kindle half of Section 18 gate 14 with real device evidence.

## 2. Prerequisites and scope

The parent judge must accept Phase 88 before this phase starts.

This phase covers one task in the compatibility, security, and release workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P89-T01 — Execute and record the physical Kindle smoke gate**
  - **Objective:** Complete the Kindle half of Section 18 gate 14 with real device evidence.
  - **Inspect:** Capability report, Phase 0 proof, risk register, and `docs/release/KINDLE-SMOKE.md`.
  - **Create or edit:** Kindle checklist and evidence references only. Do not put secrets or raw identifiers in them.
  - **Steps:** Test full-page authorization, callback replay, checked/unchecked reload, account binding, IndexedDB save, programmed-default blur, pagehide/reload, offline pending edit, sync, duplicate-safe fixture if permitted, export, route reload, font glyphs, focus, numeric entry, and long workout scroll.
  - **Edge cases:** Expiry, denial, switch, sign-out, revocation fallback, storage pressure where safely testable, and network interruption.
  - **Tests or fixtures:** Record candidate digest, Kindle model, Silk version, timestamps, tester, result, and evidence reference.
  - **Validation:** `bun run verify:release-evidence`.
  - **Acceptance:** Gate 14 passes only when conventional and physical Kindle evidence both reference the exact candidate. Missing device evidence is `NOT PROVIDED`.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Gate 14 passes only when conventional and physical Kindle evidence both reference the exact candidate. Missing device evidence is `NOT PROVIDED`.

The planned validation is:

- `bun run verify:release-evidence`.

Only the parent can change task `P89-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P89-T01`.
