# Phase 14 — Session service

Implement every session mutation: create, edit, complete, abandon, delete, terminal
editing, container scoring, and aggregate expansion.

## Prerequisites

- Phase 02 for IDs, paths, keys, and UTC helpers.
- Phase 04 for semantic validation of each mutation candidate.
- Phase 10 for the coordinator that persists each mutation.
- Phase 13 for unit handling inside entered values.

## Goals

1. Create a session only from a current workout, in the correct UTC shard.
2. Keep blank input empty and zero reps recorded.
3. Resolve the session tree from the current bundle on every load.
4. Compute container scores from saved child detail, with a `nonstandard` fallback.
5. Produce inferred drafts from an aggregate-only container that become real only on save.
6. Preserve terminal status and immutable timestamps during historical edits, while allowing completed and abandoned sessions to be reclassified.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/sessions/session-service.ts` | Public session mutation API. |
| `src/sessions/tree-resolver.ts` | Resolve a workout tree into an ordered editable view. |
| `src/sessions/scoring.ts` | Container score derivation and validation. |
| `src/sessions/draft-expansion.ts` | Aggregate-only container to draft child set. |

### Signatures

```ts
// src/sessions/session-service.ts
export interface SessionService {
  start(workoutId: string): Promise<Session>;
  load(sessionId: string): Promise<Session>;
  saveExerciseResult(sessionId: string, r: ExerciseResultDraft): Promise<void>;
  clearExerciseResult(sessionId: string, key: string): Promise<void>;
  addAttempt(sessionId: string, fromKey: string): Promise<string>;
  addAmrapRound(sessionId: string, containerPath: PathSegment[]): Promise<void>;
  setContainerScore(sessionId: string, c: ContainerResultDraft): Promise<void>;
  // Returns the `DraftChild` wrapper, not the bare draft, so the `inferred`
  // marker reaches the caller. Phase 17 reads `entry.inferred` to render the
  // `Inferred` label that REQUIREMENTS 10.15 requires.
  expandAggregate(sessionId: string, containerKey: string): Promise<DraftChild[]>;
  complete(sessionId: string): Promise<void>;
  abandon(sessionId: string, reasonCode: ReasonCode): Promise<void>;
  setTerminalStatus(sessionId: string, status: TerminalSessionStatus): Promise<void>;
  remove(sessionId: string): Promise<void>;
}
export function createSessionService(deps: {
  coordinator: Coordinator;
  staticData: LoadedStaticData;
  preferences: PreferenceService;
}): SessionService;
```

```ts
// src/sessions/tree-resolver.ts
export interface ResolvedNode {
  node: WorkoutNode;
  path: PathSegment[];
  iteration?: number;
  effectivePrescription: Prescription;   // top-level fields plus this iteration's overrides
  level: number;                         // 1, 2, 3 for the styling depth rule
  compactPathLabel: string;              // 'Strength / Complex / Round 2'
}
export function resolveTree(workout: Workout): ResolvedNode[];
export function overlayResults(nodes: ResolvedNode[], session: Session): Map<string, ExerciseResult>;
```

```ts
// src/sessions/scoring.ts
export function deriveScore(container: ContainerNode,
  children: ExerciseResult[]): Score;      // standard score, or { type: 'nonstandard' }
export function isValidProgression(container: ContainerNode, children: ExerciseResult[]): boolean;
export function isDeterministicRepsSequence(container: ContainerNode): boolean;
```

```ts
// src/sessions/draft-expansion.ts
export interface DraftChild {
  draft: ExerciseResultDraft;
  inferred: true;                        // renders with the 'Inferred' label
}
export function expandAggregateToDraft(
  container: ContainerNode, score: Score, staticData: LoadedStaticData): DraftChild[];
```

### Mutation rules

1. `start` creates `session-<uuid>`, sets `startedAtUtc` from `nowUtc()`, sets
   `status: 'in_progress'`, and writes the UTC start-month shard.
2. `saveExerciseResult` creates no record when the draft is blank. A zero `reps`
   value creates a completed record.
3. A value entered in a display unit is stored with its explicit unit.
4. `addAmrapRound` appends one completed cycle of child results for the container
   path and recomputes the container score. Rounds already on file keep their
   recorded values. The seed score describes the whole container, so the service
   filters the expansion down to the new round before it writes.
5. `setContainerScore` with `childDetail: 'none'` forbids child results.
6. `expandAggregate` returns `DraftChild` entries marked `inferred`. Nothing
   persists until the caller saves each draft.
7. After a saved child set, the children are authoritative and every later edit
   recomputes the container score. Clearing the last child deletes no container
   result, because the service cannot tell a derived aggregate from a hand-typed
   one.
8. Detail that breaks progression or cannot derive the exact aggregate sets
   `score: { type: 'nonstandard' }`.
9. `complete` sets `status: 'completed'` and `completedAtUtc`. `abandon` sets
   `status: 'abandoned'` and `completedAtUtc`. `setTerminalStatus` changes a
   completed session to abandoned or an abandoned session to completed; these
   are the only status reclassifications. `completedAtUtc` is written once and
   preserved when the terminal status changes. A call that repeats the status
   already held writes nothing.
10. `remove` deletes the key from the shard `sessions` map. No tombstone. The
    call loads the shard first, and refuses with `session_not_found` when the
    shard does not hold the session.
11. Ordinary mutations on a terminal session preserve `status`, `startedAtUtc`,
    and `completedAtUtc` and set a new `updatedAtUtc`. `setTerminalStatus` is
    the one exception: it changes only `status` and still preserves both workout
    timestamps.
12. Every mutation runs the semantic validator on the candidate before the
    coordinator writes it.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 10.2–10.5 | `resolveTree` applies top-level fields and per-iteration overrides. A repeated root expands the same way a repeated child does. |
| REQUIREMENTS 10.8, 10.12, 10.13 | `sameSegment` in `execution-path.ts` is the one ancestor-match rule. `childrenBelow` in the service and `collectChildResults` in the validator both call it, so the two cannot drift apart. |
| REQUIREMENTS 10.13–10.18 | `draft-expansion.ts` and `scoring.ts` implement aggregate entry, inferred drafts, authoritative children, and `nonstandard`. |
| REQUIREMENTS 11.1, 11.2 | Rule 2 keeps blank empty and zero recorded. |
| REQUIREMENTS 11.3, 11.8 | Drafts carry `workoutId`, `exerciseId`, `executionPath`, and explicit units. |
| REQUIREMENTS 11.9–11.11 | `start`, `complete`, `abandon`, and the Phase 15 back-navigation save. |
| REQUIREMENTS 11.12–11.14 | `abandon` and `remove` with no tombstone. |
| REQUIREMENTS 11.15 | `complete` reports missing work so the UI can offer **Finish as incomplete**. |
| REQUIREMENTS 11.16–11.19 | Rule 11 preserves terminal fields during historical edits. |
| REQUIREMENTS 11.20, 11.21 | Timestamp immutability with a system-managed `updatedAtUtc`. |
| REQUIREMENTS 11.22 | `start` uses `createSessionId()`. |
| REQUIREMENTS 6.17, 11.17, 11.18 | `resolveTree` reads the current bundle. No plan is stored. |
| ARCHITECTURE §9 "Workout-session lifecycle" | The nine lifecycle steps map to rules 1–12. |
| ARCHITECTURE §9 prescription and scoring paragraphs | `resolveTree` and `scoring.ts` implement them. |

## Checklist

### Implementation

- [x] Implement `resolveTree` with iteration expansion, effective prescriptions,
      `level`, and `compactPathLabel`.
- [x] Implement `overlayResults` keyed by composite result key.
- [x] Implement `deriveScore` for `cycles`, `rounds_and_reps`, and `intervals`, with
      the `nonstandard` fallback.
- [x] Implement `isValidProgression` for round and interval ordering.
- [x] Implement `isDeterministicRepsSequence` for `rounds_and_reps` validity.
- [x] Implement `expandAggregateToDraft` with the `inferred` marker.
- [x] Implement `start` with the shard write and the local-first save.
- [x] Implement `saveExerciseResult` with the blank-input rule and unit capture.
- [x] Implement `clearExerciseResult` and `addAttempt`.
- [x] Implement `addAmrapRound` as one completed cycle plus a score recompute.
- [x] Implement `setContainerScore` honoring `childDetail`.
- [x] Implement `complete`, `abandon`, and `remove`.
- [x] Implement the missing-work report used by the Finish Workout prompt.
- [x] Route every mutation through the semantic validator before the coordinator write.
- [x] Add the debounce and blur hooks the UI needs by reusing `src/sync/debounce.ts`.

### Tests

- [x] `tests/tree-resolver.test.ts`: top-level fields apply to every iteration, and an
      `iterations` entry overrides only the fields it contains.
- [x] `tests/tree-resolver.test.ts`: a nested repeated container produces a path
      segment with its own iteration.
- [x] `tests/tree-resolver.test.ts`: `level` is 1, 2, 3 and `compactPathLabel`
      renders `Strength / Complex / Round 2` for the deep case.
- [x] `tests/scoring.test.ts`: valid detail derives the exact `rounds_and_reps` score.
- [x] `tests/scoring.test.ts`: detail that skips a round yields `nonstandard`.
- [x] `tests/scoring.test.ts`: an EMOM derives `intervals` with the correct total.
- [x] `tests/scoring.test.ts`: `rounds_and_reps` on a non-repetition sequence is
      rejected.
- [x] `tests/session-service.test.ts`: `start` writes the UTC start-month shard and
      returns a `session-` prefixed ID.
- [x] `tests/session-service.test.ts`: a blank draft creates no result. A zero-rep
      draft creates a completed result.
- [x] `tests/session-service.test.ts`: `addAmrapRound` adds one cycle and recomputes
      the container score.
- [x] `tests/session-service.test.ts`: `expandAggregate` returns inferred drafts and
      writes nothing.
- [x] `tests/session-service.test.ts`: saving the drafts makes children authoritative
      and a later child edit recomputes the score.
- [x] `tests/session-service.test.ts`: `complete` and `abandon` each set
      `completedAtUtc`.
- [x] `tests/session-service.test.ts`: `remove` deletes the key and writes no
      tombstone field.
- [x] `tests/session-service.test.ts`: editing a completed session preserves
      `status`, `startedAtUtc`, and `completedAtUtc` and changes `updatedAtUtc`.
- [x] `tests/session-service.test.ts`: a mutation that fails semantic validation
      writes nothing.
- [x] `tests/session-service.test.ts`: `addAmrapRound` leaves the recorded values
      of earlier rounds untouched, for `rounds_and_reps` and for `intervals`.
- [x] `tests/session-service.test.ts`: a child under a second outer round records
      without a validation failure, and an added inner round starts at that outer
      round rather than a sibling's highest round.
- [x] `tests/session-service.test.ts`: `complete` and `abandon` cannot move a
      written `completedAtUtc`, and a terminal-to-terminal call is refused.
- [x] `tests/session-service.test.ts`: `remove` lands on Drive when the shard was
      never loaded, and refuses when the shard does not hold the session.
- [x] `tests/session-service.test.ts`: clearing the last child keeps the container
      result.
- [x] `tests/tree-resolver.test.ts`: a repeated workout root expands one
      occurrence per cycle, carries the root iteration on every child path, and
      applies each cycle's `iterations` override.
- [x] `tests/tree-resolver.test.ts`: the shipped `workouts.json` is read directly,
      so a future bundle with a repeated root cannot slip past the resolver.

### Verification

- [x] `bun test` passes.
- [x] `bun run check` passes.
- [x] `bun run build` passes.
- [x] `bun run check:compat` passes.

## Exit criteria

Every session behavior the screens need exists as a tested service call. No screen
mutates a session document directly.
