# Result lifecycle fixtures (Phase 5)

Input data only, used by `tests/validation/semantic/results-semantics.test.ts` and
`tests/validation/semantic/results-lifecycle-safety.test.ts`. Passing against them is development
evidence, not independent acceptance (`docs/implementation/README.md` Section 6). Each file states the
contract rows it carries from `docs/contracts/user-data-contracts.md` and
`docs/contracts/temporal-and-omission-contracts.md`.

Every session ID here is a fixed `session-` + version-4 UUID literal. No file reads a clock, and no
value is generated at test time.

## Documents

| File | Role |
| --- | --- |
| `exercises.context.json` | Static directory for the shard fixtures. `back-squat` lists `kg` and `lb` for `weight`; `deadlift` lists `kg` only, so a `lb` result is schema-valid and exercise-incompatible (RS-08, invariants 7-8). `push-up` is deprecated, so a historical reference must still resolve (RS-07, invariant 24). `row-meter` has no `reps` dimension, and `lateral-raise` is the unilateral node used for side cases (RS-09). |
| `workouts.context.json` | Static tree for the shard fixtures: `squat-day` (rounds container, a plain sequence, an AMRAP over a deprecated leaf), `interval-workout` (EMOM), `nested-workout` (EMOM over AMRAP, so nested repeated containers each contribute one path segment — RS-06), and `retired-workout`, a deprecated workout that a historical session still references (invariant 24). Node ID `row-1` and `squat-1` repeat across workouts on purpose; node IDs are unique within one workout only (WK-02). |
| `workouts.later-bundle.json` | Same directory as `workouts.context.json` after one bundle change: `nested-workout` gains node `row-2` inside `mini`, and every published node is retained (WK-03, invariant 23). It is the tree an `in_progress` session must not adopt and a terminal session must use (TR-04, TR-05). |
| `shard.context.json` | Positive shard for `results-2026-09.json`. One completed session with attempts 1 and 2, an alternating result, a `both` result, a deprecated-exercise skip, and an incomplete container aggregate without a score; one `in_progress` session that keeps its frozen `executionPlan` and no end time (RS-03); a sync copy that links to a live session in the same shard (RS-17); a session started 2026-09-30T23:00Z and ended 2026-10-01T00:20Z that stays in the September shard (TR-08) with result interval times in October that never select a shard (RS-19); an abandoned session on the deprecated workout; and one tombstone with no live session (RS-15). Session 0 `updatedAtUtc` is later than `endedAtUtc`, which is the only field a saved correction may move (RS-04). |
| `shard.correction-base.json` + `shard.correction-candidate.json` | One legal correction: the same two session IDs keep `status`, `startedAtUtc`, and `endedAtUtc`, only result data and `updatedAtUtc` change, and one new session appears (a creation, not a correction). Illegal variants, and the legal single-session save that corrects one session and copies its sibling through with the sibling's own `updatedAtUtc` held exactly, are built in the tests by mutation: a sibling whose time moves later or rolls back is a variant, not a second fixture. Rows: RS-04, TR-05, TR-08; Req 11.19-11.21. |

## Negative fixtures

Every negative file states whether it stays schema-valid, which decides which gate owns the finding.

| File | Schema | Carries |
| --- | --- | --- |
| `shard.invalid-shard.json` | valid | Two sessions whose `startedAtUtc` UTC month differs from `yearMonthUtc`, plus one in-month session that records result interval times in October: only the two start months are reported (RS-01, TR-08, RS-19, FF-04). |
| `shard.invalid-paths.json` | valid | A result that points at another workout (RS-05); a path that skips a level and a path that names an unknown node; a traversed repeated container with no iteration; an iteration on a leaf; a path that does not start at the workout root; a container result whose terminal node is an exercise; a direct `exerciseId` that differs from the terminal node and one that is not retained (RS-06, RS-07); a session whose `workoutId` does not resolve. The last result is a clean control: a measured unilateral result that names its side (RS-09). |
| `shard.invalid-duplicates.json` | valid | One session where an explicit `attempt: 1` repeats, and one where an absent attempt means 1 and therefore repeats. A different attempt or a different side is a different tuple (RS-10, invariant 14). |
| `shard.invalid-identity-links.json` | valid | A live session and a tombstone sharing one ID (RS-15, invariant 20 document half); a sync copy that names its own ID; a sync copy that names an ID absent from the shard (RS-17, invariant 22 document half). Controls: the sync copy that names another live session, which is tombstoned as well, and the sync copy that names an ID present only as a tombstone. A target in either state satisfies the link, because the user can delete the source session later, and only a self-reference or an absent ID fails. The extra tombstone on a live target is the RS-15 finding, not an RS-17 one. |
| `shard.invalid-values.json` | valid | A `weight` unit the exercise does not list, a `distance` dimension the exercise does not have, and `reps` on a row exercise, with two clean controls (RS-08, invariants 7-8). |
| `shard.invalid-fields.json` | invalid | The semantic validator's supporting assertions over input it did not receive from the schema gate: an unknown `side`, `startingSide` used without `alternating`, omitted with it, and used in place of a `side` on a measured unilateral result, a free-text `reasonCode`, a `failure` outcome without `achieved`, an rpe of 11, `effort` inside `values`, and attempt `0` (RS-09, RS-11, RS-18, RS-10). The effort and attempt records name `side: "left"`, so each record carries the one defect it is named for. |
| `shard.invalid-lifecycle.json` | invalid | The same for the lifecycle status fields: a terminal session with no end time, a terminal session that persists an `executionPlan`, an in-progress session with an end time and one with no plan, a status outside the enum, a session with no `updatedAtUtc`, a session with no `id`, and a session whose start is not a Z-suffixed instant (RS-03, RS-04, TR-05). |
| `shard.frozen-plan.json` | valid | Three `in_progress` sessions on `squat-day`, each freezing a plan that omits `push-1` exactly as a start-time omission does (TR-02) while the retained tree keeps the node. Session 0 is the clean control: an ordinary path inside the plan plus the recorded `skipped` / `reasonCode: "deprecated"` result naming the plan-omitted path. Session 1 records measured work at that same path, which the plan cannot resolve (RS-06, TR-04). Session 2 records the same path with an `exerciseId` no retained exercise carries (RS-07). |

## Not in these fixtures

- Scores and child detail (RS-12, RS-13, invariants 10-13, 25, 28) belong to Phase 6 and Phase 53, and
  merge precedence, ID reservation, retry, and convergence belong to Phases 37-42. The tests assert the
  boundary instead: a container result that stores a score type its container does not configure, and a
  container whose detail is partial, both produce no lifecycle diagnostic. The stored-state rule reads one score fact only: whether a container
  result stores a `score` at all (RS-11 evidence).
- Terminal omission states are not duplicated here. The approved Phase 1 fixtures in
  `tests/fixtures/contract-acceptance/` carry them: `results.deprecated-at-start.json` (S1),
  `results.untouched-before-deprecation.json` (S2), `results.later-addition.json` (S3, paired with
  `workouts.later-addition.json`), and `results.nested-scored.json`. Under approved D-01 Option A
  (TR-12) all four validate with no omission inference and no `nonstandard` requirement.
- Filename recognition (`results-2026-13.json`, `Results-2026-09.json`, `index.json`) belongs to the
  catalog stage (FF-06, Phase 13). The lifecycle pass only compares the month a supplied name carries
  with `yearMonthUtc`, and reports a name whose month it cannot read.
