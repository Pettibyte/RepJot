# Contract acceptance fixtures (Phase 1)

Input data only. No validator exists yet; these files are the shared fixture set referenced by `docs/contracts/` rows and by later phase plans. Passing against them is development evidence, not independent acceptance (the parent keeps separate judge cases per `docs/implementation/README.md` Section 4).

## Documents

| File | Role |
| --- | --- |
| `exercises.min.json` | Shared exercise directory. Includes a deprecated exercise (`push-up`), metric-first unit lists, and interleaved metric/imperial dimensions across exercises (weight `kg`,`lb`; addedWeight `kg`,`lb`; reps-only entries). |
| `preferences.min.json` | Interleaved preference units: imperial `lb` for `back-squat`, metric `kg` for `pull-up`. Also encodes the PF-03 absence case: no mapping exists for `air-squat`, so its default is the first `compatibleUnits` entry. |
| `workouts.scenario.json` | Three workouts: `cindy-omission` (AMRAP over pull-up / push-up / air-squat), `squat-day` (rounds container, node ID `set-1`), `nested-scored` (EMOM scored container containing an AMRAP scored container). Node ID `set-1` is deliberately repeated across two workouts (WK-02 positive case; composite key `workoutId + "\u0000" + nodeId`). |
| `workouts.later-addition.json` | Superset of `workouts.scenario.json`: adds node `cindy-pull-ups-2` to `cindy-omission` and node `extra-set` to `squat-day`. Models a later bundle after published nodes were retained (WK-03). |
| `workouts.invalid-duplicate-iteration.json` | Negative fixture: two `iterations` entries with `iteration: 2` (WK-15, invariant 27). Must be rejected by semantic validation, not schema alone. |
| `results.deprecated-at-start.json` | State S1 (TR-05 table): completed Cindy session where `push-up` was deprecated at start. The persisted evidence is the skipped result with `reasonCode: "deprecated"` plus complete remaining child detail for one observed cycle and a `nonstandard` container score. The container result and its child exercise results are separate sibling entries in the session's `results` array (the schema has no nested `results`). Paired with `workouts.scenario.json`. |
| `results.untouched-before-deprecation.json` | State S2: completed Cindy session in shard `2026-07` (filename scenario, `yearMonthUtc`, and every `startedAtUtc` UTC month agree per RS-01) with an aggregate `rounds_and_reps` score and no record at the `push-up` path; `push-up` is deprecated in the current directory. Terminal view must hide the leaf, keep the aggregate score, and create no violation — it must not infer an omission (approved D-01 Option A, S2 rule). Paired with `workouts.scenario.json`. |
| `results.later-addition.json` | State S3: completed `squat-day` session recording only node `set-1`; paired with `workouts.later-addition.json`, where the added node `extra-set` must appear as a blank, editable historical node with no inference about when it was added. |
| `results.nested-scored.json` | Completed `nested-scored` session: outer EMOM container result with an `intervals` score (2/2) and one inner AMRAP container result per observed cycle, each with its own `rounds_and_reps` score (RS-12). No leaf exercise detail is recorded, so each aggregate stands authoritative (`childDetail: "optional"`); no descendant deprecated skip exists, so under approved D-01 Option A both containers validate as ordinary scored containers. Paired with `workouts.scenario.json`. |

## Scenario expectations

| Scenario | Positive expectation | Negative expectation (must fail closed) |
| --- | --- | --- |
| Repeated node IDs across workouts | Both `set-1` nodes validate; lookups keyed by composite key never collide. | Any validator or index that treats bare `nodeId` as globally unique. |
| Interleaved unit systems | Metric-first lists validate; defaults resolve per exercise independently (PF-03, EX-11). | A directory entry listing `lb` before `kg` (EX-11 negative). |
| Nested scored ancestors | EMOM `intervals` score and inner AMRAP `rounds_and_reps` score each match their own container contract (`results.nested-scored.json`); omission of a leaf inside the inner container affects both scored ancestors in an active plan (TR-02, invariant 28 for active sessions). | One aggregate applied to the outer container while the inner stores nonstandard detail. |
| Later tree additions | Added nodes render blank in terminal sessions and accept historical corrections; recorded paths still resolve (TR-05). | Rejecting an old session because its tree is smaller than the current one, or inferring S3 vs S0. |
| Untouched work before later deprecation | Hidden leaf, no completeness or score violation (S2 row). | Requiring `nonstandard` on the historical aggregate; showing the unrecorded deprecated leaf. |
| Duplicate iteration numbers | — | `workouts.invalid-duplicate-iteration.json` rejected with a duplicate-iteration diagnostic naming the number. |

## Not yet expressible as fixtures

- D-02 (byte-order mark): Option BOM-2 is approved (`docs/decisions/document-parsing-byte-order-mark.md`). No input BOM fixture is committed in Phase 1: a leading `EF BB BF` cannot be represented truthfully as a checked-in text document here (editors and tools may add, strip, or duplicate the bytes), so baking parser behavior into these shared text fixtures would not be faithful. The later parsing stage (Phase 12, contract row FF-14) covers the approved acceptance cases: exactly one leading UTF-8 BOM (`EF BB BF`) is accepted for the parsed/validated view only; cache, recovery, and export preserve the exact original bytes including any BOM; a repeated BOM or any BOM not at offset 0 is invalid at the parsing stage with a distinct diagnostic; and REP JOT writers never emit a BOM.
- Recovery cases for Drive/IndexedDB states belong to Phases 18/26/46 and build on these documents.
