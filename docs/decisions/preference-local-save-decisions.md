# Decision D-03: Preference deletion representation, initial revision, and same-key local save order

**Status: APPROVED.** The product owner approved the four choices below in the parent orchestrator session; no approver name or date is recorded beyond this document. This record is the primary source for the approved portions of contract rows PF-03, PF-04, PF-05, and PF-06 (`docs/contracts/user-data-contracts.md`); the preexisting authorities cited per choice remain binding where they define behavior.

## 1. Scope

The Phase 1 matrix required four product choices that no listed authority defines: how a deleted preference mapping is represented in a merged document; what revision number a first-created preferences document carries; how concurrent local saves for one logical file are ordered (GATES §4 Concurrency row requires same-key serialization "by caller contract" but does not define enqueue order); and whether cross-tab same-account editing is supported in release one.

## 2. Approved contract

### D-03.1 — Deletion is canonical key absence (row PF-03)

- Absence of an `(exerciseId, dimension)` mapping is a valid state: with no saved preference, the first `compatibleUnits` entry is the default (spec §4).
- In three-way merge, base-to-local absence of a mapping key is a deletion on that merge key; different-key changes still auto-merge.
- A same-key delete-versus-change conflict follows the last-synchronizer-wins rule with no prompt: whichever client synchronizes later wins (Arch §11 Preference merge policy).
- No canonical tombstone and no new persisted field exist or are needed for preference deletion.
- Release one defines no user-facing delete action, so Settings performs no explicit preference deletion in release one (Req 12.8-12.9 context).

### D-03.2 — First-created preferences document starts at revision 0 (row PF-04; M-01)

- A newly created `preferences.json` stores `revision: 0`.
- Its first successful saved change becomes `revision: 1`; thereafter the coordinator increments the revision exactly once on the final preference candidate per synchronization and sets document `updatedAtUtc` there (Arch §11 step 11).

### D-03.3 — Same-key local saves serialize in enqueue/invocation order (row PF-05)

- Concurrent local saves for one `(accountKey, logicalName)` are serialized by the application caller/save-coordinator queue in enqueue/invocation order. This record supplies the enqueue order that GATES §4 leaves to caller contract.
- Each later save three-way merges against the previously committed local document; the latest successfully committed save becomes the pending `local` state and survives reload (Arch §8 State layers; PF-06).
- Local saves commit the pending edit and reserved conflict IDs in one read-write transaction (Arch §8 Transaction boundaries). The sync coordinator's in-memory per-account, per-logical-file mutex (Arch §11 step 1) serializes synchronization separately and does not order local saves.

### D-03.4 — Cross-tab same-account editing is unsupported in release one (row PF-06)

- IndexedDB provides no cross-tab locking and none is claimed (Arch §8; Arch §11 step 1).
- Cross-tab/window same-account editing and cross-tab same-key ordering are explicitly unsupported in release one; no cross-tab winner is claimed. This is a documented limitation approved above, not a defect to fix silently.

## 3. Preexisting authorities supporting each choice

| Choice | Row | Supporting sources (as cited in the row) |
| --- | --- | --- |
| D-03.1 | PF-03 | Req 12.8-12.9; spec §4 ("If an exercise has no saved preference, the first compatibleUnits entry is the default"); Arch §11 Preference merge policy; storage §Writes and conflicts |
| D-03.2 | PF-04 | spec §4; Arch §11 step 11; preferences schema `minimum: 0` |
| D-03.3 | PF-05 | GATES §4 Concurrency row ("Same key serialized by caller contract"); Arch §8 Transaction boundaries; Arch §11 step 1 + Retry behavior ("Serialize synchronization for one logical file") |
| D-03.4 | PF-06 | Req 4.1-4.3; Arch §8 State layers ("Authoritative for this client's unsynchronized user intent"); GATES §4 |

## 4. Approval record

| Field | Value |
| --- | --- |
| Approved choices | D-03.1 through D-03.4 above |
| Product owner | Approval supplied by the product owner in the parent orchestrator session (no name recorded) |
| Date / evidence link | NOT PROVIDED / this document (`docs/decisions/preference-local-save-decisions.md`) |
