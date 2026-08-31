# Decision D-01: Terminal-session omission discrimination

**Status: APPROVED — Option A.** The product owner approved Option A (no new storage; non-inferring terminal validation) in the parent orchestrator session. Approval was supplied by the product owner through the parent; no approver name or date is recorded beyond this document. Phases 49 and 50 proceed on the Option A contract below, and no implementation may infer an omission state from missing results (`docs/postmortem.md` §3.3: the prior repair's inference "is not supported by persisted data"). This record supersedes the earlier PENDING status of this document.

## 1. Question

> How does a terminal session (`completed` or `abandoned`) distinguish, without inference, (S1) an exercise that was deprecated and omitted when the session started, (S2) work that existed but remained untouched before later deprecation, and (S3) a nondeprecated node that entered the workout tree after session completion?

## 2. Persisted evidence available to a terminal validator

| Evidence | Source |
| --- | --- |
| Session `status`, `startedAtUtc`, `endedAtUtc`, `updatedAtUtc` | spec §5 Workout Session; results schema |
| Every recorded result: full `executionPath`, direct `workoutId`/`exerciseId`, `status`, `values`, `reasonCode` | spec §5 Exercise Result / Scored Container Result |
| Deprecated-at-start omissions: skipped results with `reasonCode: "deprecated"` (per omitted exercise) or a skipped container for an emptied scored/timed container | spec §5 Frozen Execution Plan ("REP JOT creates a skipped result with `reasonCode: 'deprecated'` for each omitted exercise"); Req 6.10; contract row TR-02 |
| Current static tree with deprecation flags | FF-01/FF-02 |
| NOT persisted: the tree at session start (no terminal `executionPlan`, ADR-020); any record of untouched work (spec §5 Save and Omission Rules) | spec §5; Arch ADR-020 |

## 3. What the evidence already discriminates

Under conformant v1 writers, the states map to distinct persisted signatures (contract rows TR-12 table):

- **S1** is proven by a recorded `reasonCode: "deprecated"` skip at or covering the path. This marker survives `executionPlan` removal because results persist.
- **S2** is the absence of any record at a path whose leaf is deprecated in the current tree. It must render hidden and create no completeness or score violation.
- **S3** is the absence of any record at a path whose leaf is not deprecated; it renders as a blank, editable node. S3 is byte-identical to plain untouched work (S0), and no cited source requires different behavior for the two.

The residual gaps that force a decision:

1. **Terminal scored-container classification.** After `executionPlan` removal, a container's detail-only (omission-affected) status is derivable only from descendant recorded deprecated skips. The validator must define what it may require of a terminal container with no such evidence — in particular, whether it may ever demand `nonstandard` (invariant 28) or reject an aggregate score on historical grounds.
2. **Non-conformant documents.** A hand-edited or buggy document missing an S1 skip cannot be reconciled against the tree-at-start by any design without a snapshot; first release ships no pre-v1 user data, so this is a validation-policy choice (fail-closed vs display-only), not a migration.
3. **Product need for the S3/S0 distinction.** If history must ever tell "added later" apart from "untouched", persisted evidence must be added; today nothing requires it.

## 4. Options

Each option states the persisted change (if any), the terminal validation contract, and whether all three states are then distinguishable without inference.

### Option A — No new storage; non-inferring terminal validation (postmortem §9 option 3)

- Persisted change: none. v1 schemas unchanged.
- Contract: omission evidence is exactly the recorded `reasonCode: "deprecated"` skip. S1 → identified by that record; affected containers (descendant skips present) are detail-only and may store only `nonstandard` or no score. S2 → hidden, unclassified, no violation. S3/S0 → blank, editable, unclassified. A terminal container with no descendant deprecated skip is validated as an ordinary scored container: its stored aggregate stands; the validator never requires `nonstandard` on historical data and never infers omission from missing results. Non-conformant documents (missing S1 skip) are display-only: shown per current rules, never rejected for a fact that cannot be proven.
- Discrimination: S1 vs S2 by persisted record; S3 vs S2 by the deprecation flag; S3 vs S0 not discriminated (behavior identical, no rule requires it).
- Cost: zero storage growth, zero schema increment, smallest validator. Residual: terminal validation is strictly weaker than active validation by design; historical documents can never be re-audited against the original tree.

### Option B — Persist an omission marker that survives plan removal (postmortem §9 option 1)

- Persisted change: a session-level record of omitted nodes, e.g. `omittedNodePaths: [{workoutId, executionPath}]` (or per-container flags), written at start alongside the skipped results and retained on transition. Requires a `repjot/results` v2 increment plus migration from v1 (first release ships no data, so v2 can be adopted before freeze if approved now; otherwise it is a post-freeze version bump).
- Contract: S1 proven by the marker even if skips are edited away; terminal containers are validated against the recorded omission set exactly as active plans are; S2/S3 rules as in Option A.
- Discrimination: S1 vs S2 fully (marker present/absent + deprecation flag); S3 vs S0 still not discriminated.
- Cost: duplicated evidence (skips already exist), larger terminal documents, schema increment and migration registry entry, merge must carry the field through sync copies.

### Option C — Persist a compact plan identity (postmortem §9 option 2)

- Persisted change: a deterministic digest or release identifier of the frozen effective tree at start, retained on transition. Same v2/migration consequences as Option B.
- Contract: terminal validator can detect that the current tree differs from the session's tree and classify S3 ("node absent from plan identity") versus S0/S2; omission set still derived from recorded skips or stored alongside the identity.
- Discrimination: all four of S1, S2, S3, S0 become distinguishable — the only option that does.
- Cost: largest storage and validation surface; digest must be defined canonically (serialization order, which fields count); static correction releases (allowed label/prescription edits, WK-17) would change the identity for content that is contractually invisible to history, so the digest must hash only identity-relevant fields — a new canonicalization contract in its own right.

### Option D — Keep selected execution-plan metadata for terminal scored containers (postmortem §9 option 4)

- Persisted change: on transition, retain only the affected scored containers' effective `resultCapture` (detail-only flag) instead of the full plan; requires a v2 increment as in B/C.
- Contract: container-level omission classification survives exactly where invariant 28 needs it; leaf-level S2/S3 rules as in Option A.
- Discrimination: S1 vs S2 at container granularity; leaf-level S1 still relies on recorded skips.
- Cost: smaller than C, larger than A; still a schema increment; splits the omission contract across two representations (leaf skips + container flags) that merge must both preserve.

## 5. Binding rules (in force)

1. No code may infer an omission from missing results in any session state (postmortem §3.3). Missing results never prove omission.
2. Recorded `reasonCode: "deprecated"` skips are the only persisted omission evidence; Option A adds no new storage and changes no results schema (TR-02).
3. Terminal sessions store no `executionPlan` and preserve status and UTC timestamps (RS-03/04, ADR-020).
4. Phases 49 and 50 implement the approved Option A contract: recorded deprecated skips identify S1; unrecorded deprecated leaves render hidden with no completeness or score violation (S2); unrecorded nondeprecated nodes render blank and editable (S3/S0, not discriminated). A terminal scored container with no descendant deprecated skip is validated as an ordinary scored container: its stored aggregate stands, the validator never requires `nonstandard` on historical data, and it never rejects an aggregate score on historical grounds. Non-conformant documents (missing S1 skip) are display-only: shown per current rules, never rejected for a fact that cannot be proven. Terminal validation is weaker than active validation where historical facts are unavailable; this is the approved cost of Option A.

## 6. Approval record

| Field | Value |
| --- | --- |
| Approved option | Option A — No new storage; non-inferring terminal validation |
| Product owner | Approval supplied by the product owner in the parent orchestrator session (no name recorded) |
| Date / evidence link | NOT PROVIDED / this document (`docs/decisions/terminal-session-omission.md`) |
