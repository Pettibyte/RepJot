# Phase 04 — Semantic validation

Add the checks JSON Schema cannot express: key derivation, cross-field rules, shard
placement, score agreement, and unresolved static references.

## Prerequisites

- Phase 02 for domain types, `AppError`, and the key builders.
- Phase 03 for the pipeline that calls the semantic stage last.

## Goals

1. Validate the 26 invariants from the schema spec with one module.
2. Separate fatal document faults from nonfatal unresolved-reference diagnostics.
3. Let one bad result degrade one card instead of breaking a list or the sync loop.
4. Provide the same checks to the build for static data.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/validation/semantic-validator.ts` | All cross-field and cross-document checks. |
| `src/validation/issues.ts` | `ValidationIssue`, `UnresolvedResult`, and issue codes. |

### Signatures

```ts
// src/validation/issues.ts
export interface ValidationIssue {
  code: string;              // stable code, for example 'key_mismatch'
  path: string;              // document path, for example 'sessions.session-1.exerciseResults.<key>'
  message: string;           // safe text. No file body, note, or measurement dump.
}
export type UnresolvedReason =
  | 'unknown_workout' | 'unknown_exercise'
  | 'broken_path' | 'path_exercise_mismatch'
  | 'unit_incompatible' | 'measurements_changed';
export interface UnresolvedResult {
  reason: UnresolvedReason;
  sessionKey: string;
  resultKey: string;
  workoutId: string;
  exerciseId?: string;
  encodedPath: string;
}
```

```ts
// src/validation/semantic-validator.ts
export interface SemanticReport {
  issues: ValidationIssue[];            // fatal
  unresolved: UnresolvedResult[];      // nonfatal
}
export function validateStaticData(exercises: Exercise[], workouts: Workout[]): ValidationIssue[];
export function validatePreferences(prefs: PreferencesDoc, exercises: Exercise[]): SemanticReport;
export function validateShard(shard: ResultsShard, staticData: StaticData): SemanticReport;
export function validateSession(session: Session, staticData: StaticData,
  opts: { shardYearMonthUtc: string }): SemanticReport;
```

### Check list

Fatal for a document:

1. Every `sessions` key equals the mapped session `id`, and every `id` uses the
   `session-` prefix.
2. An `in_progress` session has no `completedAtUtc`. A `completed` or `abandoned`
   session has one.
3. No session contains an `executionPlan` field in any status.
4. Every exercise result key equals `exerciseResultKey(executionPath, side, attempt)`.
5. Every container result key equals `containerResultKey(executionPath, attempt)`.
6. Every result `workoutId` equals its containing session `workoutId`.
7. At most one container result per execution path and attempt.
8. An alternating exercise result has `startingSide`. Other results do not.
9. Every result quantity uses a recognized dimension and a unit compatible with it.
10. A container `score.type` matches the container `resultCapture.scoreType`, or is
    `nonstandard`.
11. `rounds_and_reps` containers resolve only to deterministic repetition-based
    leaf sequences.
12. Child detail obeys the container `childDetail` rule.
13. Standard child detail derives exactly the stored container score and follows
    valid progression.
14. A monthly file name, `yearMonthUtc`, and each session `startedAtUtc` UTC month
    agree.
15. No key in a synchronized document is integer-like.
16. No `Record` key or ID contains `/`, `|`, or `:`.
17. Every persisted `*Utc` value ends in `Z`.
18. A preferred unit is compatible with its current exercise and dimension.
19. A prescription uses only dimensions the referenced exercise declares.
20. Each iteration number appears at most once in one prescription, is one-based, and
    stays within the nearest repeated container's iteration count.

Nonfatal for stored results, reported as `UnresolvedResult`:

- The session `workoutId` is absent from the current bundle.
- The result `exerciseId` is absent from the current bundle.
- The `executionPath` does not resolve from the current workout root.
- The path resolves to a node whose `exerciseId` differs from the recorded one.
- Current exercise measurements no longer cover a stored result dimension.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 6.7, 6.8 | The four unresolved cases map to `UnresolvedReason` values. |
| REQUIREMENTS 6.10, 6.11 | Unresolved entries are data, not throws. Nothing is rewritten or substituted. |
| REQUIREMENTS 6.19–6.22 | `validateStaticData` runs exactly the three required identity checks. |
| REQUIREMENTS 10.4, 10.5 | Checks 20 enforces unique, one-based, in-range iteration numbers. |
| REQUIREMENTS 10.12, 10.13, 10.18 | Checks 10–13 govern `rounds_and_reps`, aggregate-only entry, and `nonstandard`. |
| REQUIREMENTS 11.4 | Reason-code presence is checked with status. |
| REQUIREMENTS 11.5, 11.6 | Check 8 enforces `startingSide` only for `alternating`. |
| REQUIREMENTS 22.4.4, 22.4.9 | Checks 4 and 5 tie every key to its value. |
| SPEC rep-jot-json-schema-spec §8 | Items 1–26 map to the fatal and nonfatal lists above. |
| SPEC schema-versioning "Result references" | A migration never repairs a reference; this module only reports. |

## Checklist

### Implementation

- [ ] Create `src/validation/issues.ts` with `ValidationIssue`, `UnresolvedReason`,
      and `UnresolvedResult`.
- [ ] Implement `validateStaticData`: schema already ran, so check duplicate node ID
      within one workout and that each node `exerciseId` resolves.
- [ ] Implement `validateSession` covering fatal checks 1–8 and 14–17.
- [ ] Implement result-level checks 4–6, 8–9 inside the session walk.
- [ ] Implement container checks 7, 10–13 using the current workout tree.
- [ ] Implement `validateShard` and the shard-month agreement check.
- [ ] Implement `validatePreferences` for unit compatibility against current exercise
      measurements.
- [ ] Implement the unresolved-reference pass that produces `UnresolvedResult`
      entries instead of issues.
- [ ] Wire the semantic stage into `document-pipeline.ts` as an optional callback so
      callers that hold `StaticData` pass it.
- [ ] Keep issue messages free of user note text, measurements, and file bodies.

### Tests

- [ ] `tests/semantic-static.test.ts`: duplicate node ID in one workout fails; the
      same node ID in two workouts passes.
- [ ] `tests/semantic-static.test.ts`: an unresolvable node `exerciseId` fails.
- [ ] `tests/semantic-results.test.ts`: a key that does not match its value fails
      with code `key_mismatch`.
- [ ] `tests/semantic-results.test.ts`: an `in_progress` session with
      `completedAtUtc` fails, and a `completed` session without it fails.
- [ ] `tests/semantic-results.test.ts`: a session carrying `executionPlan` fails.
- [ ] `tests/semantic-results.test.ts`: a shard whose `yearMonthUtc` disagrees with a
      session start month fails.
- [ ] `tests/semantic-results.test.ts`: an alternating result without
      `startingSide` fails, and a `both` result with one fails.
- [ ] `tests/semantic-results.test.ts`: a score type that mismatches the container
      `scoreType` fails, and `nonstandard` passes.
- [ ] `tests/semantic-results.test.ts`: child detail under a `childDetail: "none"`
      container fails.
- [ ] `tests/semantic-results.test.ts`: standard detail that derives a different
      aggregate fails; matching detail passes.
- [ ] `tests/semantic-unresolved.test.ts`: unknown workout, unknown exercise, broken
      path, and path-exercise mismatch each produce one `UnresolvedResult` and zero
      fatal issues.
- [ ] `tests/semantic-unresolved.test.ts`: one unresolved result leaves every other
      result in the same shard valid.
- [ ] `tests/fixtures/semantic/` holds one valid shard plus one fixture per failing
      case, loaded by the tests above.

### Verification

- [ ] `bun run check` passes.
- [ ] `bun test` passes.
- [ ] `bun run check:schemas` passes.
- [ ] `bun run build` passes.
- [ ] `bun run check:compat` passes.

## Exit criteria

The pipeline can mark a stored result unresolved without failing, and can reject a
malformed document with a path-addressed issue. No later layer re-implements these
checks.
