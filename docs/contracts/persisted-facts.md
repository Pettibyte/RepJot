# Required persisted facts

This file lists every historical fact the contract rules need and where it is persisted. A fact with no persisted location blocks the rule that requires it (status `MISSING-FACT`). Sources: abbreviations from `docs/contracts/README.md`.

## 1. Facts that are persisted

| Fact | Persisted as | Created by | Survives | Consumed by |
| --- | --- | --- | --- | --- |
| Session start instant and shard | `startedAtUtc` (Z) + filename `results-YYYY-MM.json` + `yearMonthUtc` | TR-01 | Always; release one forbids edits (RS-04) | Shard selection, invariant 19, history ordering |
| Session terminal state and time | `status`, `endedAtUtc` | TR-04/TR-07 | Always after transition | Invariants 17/18, History statuses (Req 20.1) |
| Last correction time | `updatedAtUtc` | Every saved change (RS-04) | Always | Recency ordering (Req 17.3-17.4), merge diagnostics |
| Active-session effective tree | `executionPlan` | TR-02 | Only while `in_progress`; removed on transition (TR-04, RS-03) | Resume of active sessions (TR-04) |
| Deprecated-at-start omission | Skipped result with `reasonCode: "deprecated"` at the omitted path, or a skipped container for an emptied scored/timed container | TR-02 | After `executionPlan` removal (results persist) | Terminal omission discrimination S1 (TR-12), invariant 28, build report WK-18 context |
| Performed work and units | Exercise/container results with `workoutId`, `executionPath`, direct `exerciseId`, `values` with explicit units, optional `effort` outcome, optional result-level `startedAtUtc`/`endedAtUtc`, `attempt`, `side`, `startingSide` | TR-06 | Always until session deletion | Display, scores (RS-12/13), Last Time (Req 19.4) |
| Container score authority | Container result `score` in its exact type shape; child detail absent-or-complete | TR-06 / expansion (RS-13) | Always | Invariants 10-13, `Detailed` display |
| Session deletion | Tombstone `{sessionId, deletedAtUtc}` in the original shard | RS-15 | Permanently (shard lifetime) | Merge precedence (RS-16), invariant 20 |
| Sync-copy provenance | New session ID + `conflictOfSessionId` + preserved status/timestamps; reserved UUID in pending edit and `syncCopyIds` store | RS-17 | Always for the copy's life | Invariant 22, History `Sync copy` label (Req 11.23) |
| Preference choice | `exerciseUnits[exerciseId][dimension]` unit + document `revision`/`updatedAtUtc` | PF-02/PF-04 | Until key removal or account deletion | Default resolution (PF-03), invariant 9, merge (PF-07) |
| Static identity history | Prior production bundle digests in a pinned release manifest; current bundle IDs/nodes | WK-16 | Build time | Compatibility gate (WK-16/17), deprecation report (WK-18) |
| Change indicators for remote files | Drive `md5Checksum`, `version`, `modifiedTime` in cached metadata | Sync reads | Cache lifetime | Reconciliation triggers only (FF-11) |

## 2. Facts that are NOT available from persisted data

| Fact | Why unavailable | Rules affected | Disposition |
| --- | --- | --- | --- |
| The workout tree as it existed at session start (for terminal sessions) | `executionPlan` is removed on transition by design (RS-03, ADR-020); no other snapshot is persisted. | TR-12 discrimination; invariant 28 for terminal containers | D-01 approved Option A: no contract change supplies this fact. Terminal validation uses recorded `reasonCode: "deprecated"` skips as the only omission evidence and never assumes tree state at start; where historical facts are unavailable, terminal validation is weaker than active validation by design. |
| Whether a specific unrecorded nondeprecated leaf was present at session start (S3 vs S0) | Untouched work stores no result by contract (spec §5 Save and Omission Rules); later additions are indistinguishable from it in bytes. | TR-12 blank-node display | No cited source requires different behavior for S3 and S0; both are blank, editable nodes under approved Option A. If the product owner later requires the distinction, a new approved contract change must supply the fact. |
| Whether an unrecorded currently-deprecated leaf was deprecated before or after session start — beyond the recorded-skip test | A conformant writer leaves a `reasonCode: "deprecated"` skip for pre-start deprecation (TR-02); absence of that record plus current deprecation is S2. Hand-edited or non-conformant documents could violate this, but no design can verify it without a snapshot. | TR-12 hidden-leaf rule; invariant 28 | Approved Option A policy: display-only — such documents are shown per current rules and never rejected for a fact that cannot be proven. |
| Which client performed a historical preference change | Only the converged value and document `revision` persist; per-client intent is not stored. | PF-04/PF-07 convergence auditing | Not required by any rule: last-synchronizer-wins needs no attribution (Req 12.9). Diagnostic events are local-only, bounded, and never canonical (Arch §11). |
| Exact moment of a remote write between two readers | Drive provides no compare-and-swap or write log to the client (R-01). | Merge race handling | Accepted risk R-01: preflight + post-read + receipts; never an inferred fact. |

## 3. Blocking summary

- D-01 (`docs/decisions/terminal-session-omission.md`) is RESOLVED — approved Option A: Phases 49 and 50 proceed on the recorded-skip-only terminal validation contract; no code may infer omission from missing results.
- D-02 (`docs/decisions/document-parsing-byte-order-mark.md`) is RESOLVED — approved Option BOM-2: Phase 12's parsing stage proceeds with the single-leading-BOM strip policy (contract FF-14).
- M-01 (PF-04) is RESOLVED — a first-created preferences document starts at `revision: 0`; its first successful saved change becomes `revision: 1`. Phase 38 proceeds on this row.

No rule in this matrix currently requires a fact beyond Section 1.
