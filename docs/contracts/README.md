# REP JOT contract matrix

## Purpose

This directory gives every document rule one authoritative source, one owner, the input facts it needs, and its acceptance cases. It is the Phase 1 deliverable required by `docs/implementation/phase-01.md` task P1-T01.

Phases 2 through 91 treat a matrix row as binding only while its cited sources agree with it. If a source changes, the row changes in the same review; the matrix never overrides a higher authority.

## Authority order

Apply `docs/ARCHITECTURE.md` Section 2:

1. `AGENTS.md` and `docs/REQUIREMENTS.md`
2. `specs/rep-jot-json-schema-spec.md`, `specs/storage-and-lookup.md`, `specs/schema-versioning.md`
3. `design/DESIGN.md`
4. The four Draft 2020-12 schemas in `schemas/`
5. `specs/Day-of Workout Execution UI — Design Brief.md`
6. The mockups in `design/`
7. The current prototype source

Official Google documentation is authoritative only for Google platform behavior the repository does not define.

Documents outside this list — `docs/ARCHITECTURE.md`, `docs/implementation/GATES.md`, approved records in `docs/decisions/`, and phase files — rank below the listed sources for source-cell labeling. One becomes a row's primary citation only when no listed source defines the rule.

## Rule inventory

The matrix defines 90 binding rules: FF-01..FF-20 (20), EX-01..EX-12 (12), WK-01..WK-20 (20), PF-01..PF-07 (7), RS-01..RS-19 (19), TR-01..TR-12 (12). Every field of the four schemas in `schemas/` and every invariant 1-28 of spec Section 8 is represented by at least one rule ID.

## Row format

Each row carries: rule ID, contract statement, exactly one primary authoritative source citation — the cited source that defines the rule, chosen by the Section 2 precedence order (a cited requirement marked `context` does not define and is never primary) — followed by any additional corroborating or shape citations explicitly labeled `supporting:`; supporting citations are never co-authoritative. A cell with a single citation carries that citation as its sole primary source. The row also carries one primary owner (module or build gate from `docs/ARCHITECTURE.md` Section 7 or 18; auxiliary gates are named separately after `supporting:` and never co-own the rule), a positive case, and a negative case. Rows whose state can fail also carry a recovery case. The registry rows in `families-and-files.md` Section 1 carry canonical location, reader, and sole write path as their ownership columns.

The required input facts and persisted facts for every rule are stated in the compact "Input and persisted facts" tables keyed by rule ID in each matrix file; an entry of `none` means the rule needs no such fact. A row that needs a fact no source persists is marked `MISSING-FACT` and blocks the phase that implements it.

## Status values

| Status | Meaning |
| --- | --- |
| `RESOLVED` | Cited sources agree; one owner assigned; no new persisted field or product decision needed. |
| `PENDING-DECISION` | Sources do not choose between options, or an approval is missing. The options are recorded in `docs/decisions/`. No implementation starts on the row until the parent records an approved option. |
| `MISSING-FACT` | A required historical state cannot be proven from persisted data. Implementation that needs the fact stops until an approved contract change supplies it. |

## Files

| File | Covers |
| --- | --- |
| `families-and-files.md` | Four families, versions, filenames, envelope rules, parsing entry (BOM pointer). |
| `static-data-contracts.md` | `exercises.json` and `workouts.json` fields, units, prescriptions, compatibility, curation. |
| `user-data-contracts.md` | `preferences.json` and `results-YYYY-MM.json` fields, invariants 1-28, merge and save rules. |
| `temporal-and-omission-contracts.md` | Frozen plan, terminal editing, deprecation states, shards, timestamps, revision timing. |
| `persisted-facts.md` | Facts the contract requires and where each is persisted; facts that are not available. |

Each of the four rule files above ends with an "Input and persisted facts" table keyed by rule ID.

Independent acceptance fixtures for the edge cases named in the phase file live in `tests/fixtures/contract-acceptance/`. They are input data only; no validator exists yet, and fixture passing is development evidence, not independent acceptance.

## Decision record and open items

The product owner approved the decisions below in the parent orchestrator session (no approver name or date recorded beyond the linked documents).

| ID | Topic | Where recorded | Status |
| --- | --- | --- | --- |
| D-01 | Terminal-session omission discrimination | `docs/decisions/terminal-session-omission.md` | RESOLVED — approved Option A: recorded `reasonCode: "deprecated"` skips are the only omission evidence; missing results never prove omission; no results schema change; weaker terminal validation where historical facts are unavailable. Phases 49, 50 proceed. |
| D-02 | Byte-order mark parsing policy | `docs/decisions/document-parsing-byte-order-mark.md` | RESOLVED — approved Option BOM-2: exactly one leading UTF-8 BOM is stripped for the parsed/validated view; original bytes preserved for cache/recovery/export; no BOM ever emitted; repeated or non-leading BOMs rejected (FF-14). Phase 12 proceeds. |
| D-03 | Preference deletion representation, initial `revision`, and same-key local save order | `docs/decisions/preference-local-save-decisions.md` | RESOLVED — approved: canonical key absence is preference deletion with no tombstone and last-synchronizer-wins on same-key delete-versus-change conflicts (PF-03); a first-created document stores `revision: 0` and its first successful saved change becomes `revision: 1` (M-01, PF-04); the caller/save-coordinator queue serializes same-key local saves in enqueue/invocation order, with the latest committed save as pending `local` state surviving reload (PF-05); cross-tab/window same-account editing and cross-tab same-key ordering are unsupported in release one (PF-06). Phases 22, 38, 43, and 76 proceed on these contracts. |
| M-01 | Initial `revision` of a first-created empty `preferences.json` (0 or 1) | `docs/decisions/preference-local-save-decisions.md`; `user-data-contracts.md` row PF-04 | RESOLVED — approved: create at `revision: 0`; first successful saved change becomes `revision: 1`. Phase 38 proceeds. |

No open items remain in this matrix for the decisions above; other defect families (for example, acceptance-fixture content) are tracked separately and do not count as resolved here.
