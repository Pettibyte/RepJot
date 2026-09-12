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
6. Preserve terminal status and immutable timestamps during historical edits.

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
  expandAggregate(sessionId: string, containerKey: string): Promise<ExerciseResultDraft[]>;
  complete(sessionId: string): Promise<void>;
  abandon(sessionId: string, reasonCode: ReasonCode): Promise<void>;
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
   path and recomputes the container score.
5. `setContainerScore` with `childDetail: 'none'` forbids child results.
6. `expandAggregate` returns drafts marked `inferred`. Nothing persists until the
   caller saves each draft.
7. After a saved child set, the children are authoritative and every later edit
   recomputes the container score.
8. Detail that breaks progression or cannot derive the exact aggregate sets
   `score: { type: 'nonstandard' }`.
9. `complete` sets `status: 'completed'` and `completedAtUtc`. `abandon` sets
   `status: 'abandoned'` and `completedAtUtc`.
10. `remove` deletes the key from the shard `sessions` map. No tombstone.
11. Any mutation on a terminal session preserves `status`, `startedAtUtc`, and
    `completedAtUtc` and sets a new `updatedAtUtc`.
12. Every mutation runs the semantic validator on the candidate before the
    coordinator writes it.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 10.2–10.5 | `resolveTree` applies top-level fields and per-iteration overrides. |
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

- [ ] Implement `resolveTree` with iteration expansion, effective prescriptions,
      `level`, and `compactPathLabel`.
- [ ] Implement `overlayResults` keyed by composite result key.
- [ ] Implement `deriveScore` for `cycles`, `rounds_and_reps`, and `intervals`, with
      the `nonstandard` fallback.
- [ ] Implement `isValidProgression` for round and interval ordering.
- [ ] Implement `isDeterministicRepsSequence` for `rounds_and_reps` validity.
- [ ] Implement `expandAggregateToDraft` with the `inferred` marker.
- [ ] Implement `start` with the shard write and the local-first save.
- [ ] Implement `saveExerciseResult` with the blank-input rule and unit capture.
- [ ] Implement `clearExerciseResult` and `addAttempt`.
- [ ] Implement `addAmrapRound` as one completed cycle plus a score recompute.
- [ ] Implement `setContainerScore` honoring `childDetail`.
- [ ] Implement `complete`, `abandon`, and `remove`.
- [ ] Implement the missing-work report used by the Finish Workout prompt.
- [ ] Route every mutation through the semantic validator before the coordinator write.
- [ ] Add the debounce and blur hooks the UI needs by reusing `src/sync/debounce.ts`.

### Tests

- [ ] `tests/tree-resolver.test.ts`: top-level fields apply to every iteration, and an
      `iterations` entry overrides only the fields it contains.
- [ ] `tests/tree-resolver.test.ts`: a nested repeated container produces a path
      segment with its own iteration.
- [ ] `tests/tree-resolver.test.ts`: `level` is 1, 2, 3 and `compactPathLabel`
      renders `Strength / Complex / Round 2` for the deep case.
- [ ] `tests/scoring.test.ts`: valid detail derives the exact `rounds_and_reps` score.
- [ ] `tests/scoring.test.ts`: detail that skips a round yields `nonstandard`.
- [ ] `tests/scoring.test.ts`: an EMOM derives `intervals` with the correct total.
- [ ] `tests/scoring.test.ts`: `rounds_and_reps` on a non-repetition sequence is
      rejected.
- [ ] `tests/session-service.test.ts`: `start` writes the UTC start-month shard and
      returns a `session-` prefixed ID.
- [ ] `tests/session-service.test.ts`: a blank draft creates no result. A zero-rep
      draft creates a completed result.
- [ ] `tests/session-service.test.ts`: `addAmrapRound` adds one cycle and recomputes
      the container score.
- [ ] `tests/session-service.test.ts`: `expandAggregate` returns inferred drafts and
      writes nothing.
- [ ] `tests/session-service.test.ts`: saving the drafts makes children authoritative
      and a later child edit recomputes the score.
- [ ] `tests/session-service.test.ts`: `complete` and `abandon` each set
      `completedAtUtc`.
- [ ] `tests/session-service.test.ts`: `remove` deletes the key and writes no
      tombstone field.
- [ ] `tests/session-service.test.ts`: editing a completed session preserves
      `status`, `startedAtUtc`, and `completedAtUtc` and changes `updatedAtUtc`.
- [ ] `tests/session-service.test.ts`: a mutation that fails semantic validation
      writes nothing.

### Verification

- [ ] `bun test` passes.
- [ ] `bun run check` passes.
- [ ] `bun run build` passes.
- [ ] `bun run check:compat` passes.

## Exit criteria

Every session behavior the screens need exists as a tested service call. No screen
mutates a session document directly.
