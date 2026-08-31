# Phase 1: Resolve document contracts and terminal omission

## 1. Mission

Create an approved contract matrix before production implementation starts. Resolve the terminal-session omission gap without guessing historical state.

## 2. Prerequisites and scope

The Phase 0 baseline at commit `433e3a061e690e6ae3943ba9e1480511c8a26d5f` is the prerequisite.

This phase can edit contract and architecture documents only. It can add independent acceptance fixtures. It cannot implement production validators, schemas, persistence, or UI.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read the sources named in this task before editing.

## 4. Ordered task

- [x] **P1-T01 — Resolve document contracts and terminal omission**
  - **Objective:** Give every document rule one source, owner, input fact, and acceptance case.
  - **Inspect:** All schemas, all three specifications, Requirements Sections 5-13, and Architecture Sections 7-13 and 20.
  - **Create or edit:** A contract matrix under `docs/contracts/` and an architecture decision under `docs/decisions/`.
  - **Steps:** List every family, version, filename, field, semantic invariant, and temporal rule. Record required persisted facts. Define exact positive, negative, and recovery cases. Present terminal-omission options to the product owner. Record only the approved option.
  - **Stop:** Stop before approval when sources conflict or data cannot distinguish a required historical state.
  - **Edge cases:** Include repeated node IDs, interleaved unit systems, nested scored ancestors, later tree additions, untouched work, and later deprecation.
  - **Additional decisions:** Resolve preference deletion, same-key save serialization, same-key save order, and the byte-order mark policy.
  - **Evidence:** The parent creates additional acceptance cases that are not part of the worker fixture set.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Every rule has one authoritative source and one owner.
- The omission decision uses persisted evidence or defines an approved contract change.
- No production implementation changed.
- The parent and product owner approve the matrix and decision.

The planned validation is:

- `bun run check`
- Existing Phase 0 tests
- Contract matrix review against every named authority

Only the parent can change task `P1-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P1-T01`.
