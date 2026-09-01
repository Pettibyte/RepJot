# Phase 82: Record the blank first-release compatibility baseline

## 1. Mission

Complete Section 18 gate 7 for a first release with no prior canonical static files.

## 2. Prerequisites and scope

The parent judge must accept Phase 81 before this phase starts.

This phase covers one task in the compatibility, security, and release workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P82-T01 — Record the blank first-release compatibility baseline**
  - **Objective:** Complete Section 18 gate 7 for a first release with no prior canonical static files.
  - **Inspect:** Phases 1-10 blank-baseline behavior, compatibility fixtures, candidate static files if approved, and the evidence schema.
  - **Create or edit:** A first-release marker, evidence record, and the future baseline manifest after human content approval.
  - **Steps:** Run explicit first-release mode without a network request. Record that no prior canonical release exists. Run all compatible and incompatible comparison fixtures. If the human approves current production content, record its exact digests as the baseline for the next release. Do not create baseline digests from test data or an unapproved candidate.
  - **Edge cases:** An unexpected existing manifest, an accidental network request, approved-content digest drift, test data at canonical paths, and an attempt to overwrite an approved baseline.
  - **Tests or fixtures:** Keep the blank-baseline fixture and all deterministic future comparison fixtures.
  - **Validation:** `bun run compare:production -- --first-release`.
  - **Acceptance:** Gate 7 passes when the blank first-release decision and fixture suite are recorded. The future baseline remains absent until a human approves canonical content.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Gate 7 passes when the blank first-release decision and fixture suite are recorded. The future baseline remains absent until a human approves canonical content.

The planned validation is:

- `bun run compare:production -- --first-release`.

Only the parent can change task `P82-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P82-T01`.
