# Phase 12 — Index builder and lookup service

Turn validated documents into the in-memory read model that every screen queries.
Rebuild indexes at startup. Never persist them.

## Prerequisites

- Phase 02 for the domain types and the ordering rules.
- Phase 05 for `LoadedStaticData`.
- Phase 10 for loaded shards and preferences.

## Goals

1. Build the `DataIndex` from static data plus loaded shards.
2. Answer every screen query without a document scan.
3. Keep recent lists bounded for the Kindle memory budget.
4. Sort on explicit timestamps only.
5. Expose unresolved results as first-class data.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/indexes/index-builder.ts` | Builds the index from documents. |
| `src/indexes/lookup-service.ts` | Query API over the index. |
| `src/indexes/types.ts` | `DataIndex`, `SessionSummary`, `ExerciseOccurrence`. |

### Signatures

```ts
// src/indexes/types.ts
export interface SessionSummary {
  id: string; workoutId: string; workoutName: string; status: SessionStatus;
  startedAtUtc: string; updatedAtUtc: string;
  shardName: string;
}
export interface ExerciseOccurrence {
  sessionId: string; exerciseId: string; resultKey: string;
  encodedPath: string; side?: Side; attempt: number;
  status: ResultStatus; values?: ResultValues; completedAtUtc: string;
}

// src/indexes/index-builder.ts
export interface DataIndex {
  exerciseById: Map<string, Exercise>;
  workoutById: Map<string, Workout>;
  nodeByWorkoutAndId: Map<string, WorkoutNodeLookup>;   // key: '<workoutId>|<nodeId>'
  exerciseIdsByMuscleGroup: Map<Muscle, Set<string>>;
  recentByExerciseId: Map<string, ExerciseOccurrence[]>;
  recentByMuscleGroup: Map<Muscle, ExerciseOccurrence[]>;
  recentSessions: SessionSummary[];
  activeSessionsByUpdatedAtUtc: SessionSummary[];
  unresolvedResults: UnresolvedResult[];
}
export function buildIndex(input: {
  staticData: LoadedStaticData;
  shards: ResultsShard[];
  unresolved: UnresolvedResult[];
  recentLimit?: number;      // default 50 per exercise
}): DataIndex;
```

```ts
// src/indexes/lookup-service.ts
export interface LookupService {
  getWorkout(id: string): Workout | undefined;
  getExercise(id: string): Exercise | undefined;
  getNode(workoutId: string, nodeId: string): WorkoutNodeLookup | undefined;
  listActiveSessions(): SessionSummary[];                 // updatedAtUtc newest first
  listRecentSessions(limit?: number): SessionSummary[];   // default 5
  getWorkoutHistory(workoutId: string, page: Page): PageResult<SessionSummary>;
  getExerciseHistory(exerciseId: string, page: Page): PageResult<ExerciseOccurrence>;
  getLastTime(exerciseId: string): ExerciseOccurrence | null;
  getUnresolved(): UnresolvedResult[];
  extendHistory(newShards: ResultsShard[]): void;         // Load older
}
export function createLookupService(input: {
  staticData: LoadedStaticData;
}): LookupService;
```

### Ordering rules

1. Active sessions sort by `updatedAtUtc` newest first.
2. Recent sessions sort by `startedAtUtc` newest first, capped at five, completed and
   abandoned only.
3. History pages sort by `startedAtUtc` newest first with an offset and page size.
4. Exercise occurrences sort by the session `startedAtUtc` newest first.
5. When the tree cannot order a result, fall back to the encoded `executionPath`
   string.
6. Never use `Object.keys` order. Never use insertion order.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 3.7 | In-memory maps back every lookup. |
| REQUIREMENTS 3.16 | The index is rebuilt at startup and never persisted. |
| REQUIREMENTS 3.17, 3.19, 3.20 | Every sort names an explicit field. Prescriptive order comes from the workout tree. |
| REQUIREMENTS 6.23 | Recorded work indexes from the result's own stored values, not from the tree. |
| REQUIREMENTS 17.3, 17.4 | `listRecentSessions` caps at five and excludes in-progress. `listActiveSessions` is separate. |
| REQUIREMENTS 17.6 | Resume uses the session summary `id` and `shardName`. |
| REQUIREMENTS 19.3, 19.4, 19.5 | `getLastTime` reads the latest completed session only and ignores the active session. |
| REQUIREMENTS 20.1, 20.4 | `getWorkoutHistory` and `getExerciseHistory` page newest first. `extendHistory` serves `Load older`. |
| REQUIREMENTS 6.10 | Unresolved results are a list, so one bad entry breaks nothing. |
| ARCHITECTURE ADR-013 | Rebuild in memory. Do not persist derived indexes. |
| ARCHITECTURE §9 loading policy | Bounded recent lists and on-demand extension. |
| SPEC storage-and-lookup "In-memory read model" | The `DataIndex` shape and `nodeKey` match the spec. |

## Checklist

### Implementation

- [ ] Create `src/indexes/types.ts` with `DataIndex`, `SessionSummary`, and
      `ExerciseOccurrence`.
- [ ] Build `exerciseById`, `workoutById`, and `nodeByWorkoutAndId` from static data.
- [ ] Build `exerciseIdsByMuscleGroup` from primary and secondary muscles.
- [ ] Traverse loaded shards newest month first and index exercise results by direct
      `exerciseId`.
- [ ] Index container results separately for summary views.
- [ ] Build `recentSessions` and `activeSessionsByUpdatedAtUtc` with explicit sorts.
- [ ] Cap per-exercise occurrence lists at `recentLimit`.
- [ ] Copy `unresolved` into the index without sorting it away.
- [ ] Implement `createLookupService` with paging helpers `Page` and `PageResult`.
- [ ] Implement `getLastTime` to skip sessions whose status is `in_progress`.
- [ ] Implement `extendHistory` to merge new shards into the existing index without a
      full rebuild.
- [ ] Implement the encoded-path fallback ordering for unresolved entries.

### Tests

- [ ] `tests/index-builder.test.ts`: sessions across three shards produce
      `activeSessionsByUpdatedAtUtc` sorted newest first.
- [ ] `tests/index-builder.test.ts`: `recentSessions` returns at most five and
      excludes `in_progress`.
- [ ] `tests/index-builder.test.ts`: `nodeByWorkoutAndId` keeps the same node ID in
      two workouts as two distinct entries.
- [ ] `tests/index-builder.test.ts`: `exerciseIdsByMuscleGroup` includes secondary
      muscles.
- [ ] `tests/index-builder.test.ts`: an integer-like key in a fixture does not affect
      the sorted output.
- [ ] `tests/lookup-service.test.ts`: `getLastTime` returns the newest completed
      occurrence and ignores a newer `in_progress` occurrence.
- [ ] `tests/lookup-service.test.ts`: `getLastTime` returns `null` for an exercise
      with no completed result.
- [ ] `tests/lookup-service.test.ts`: `getExerciseHistory` pages newest first with no
      gap and no duplicate across page boundaries.
- [ ] `tests/lookup-service.test.ts`: `extendHistory` adds older entries and keeps
      the ordering invariant.
- [ ] `tests/lookup-service.test.ts`: unresolved entries appear from
      `getUnresolved` and sort by encoded path.

### Verification

- [ ] `bun test` passes.
- [ ] `bun run check` passes.
- [ ] `bun run build` passes.
- [ ] `bun run check:compat` passes.
- [ ] Manual: build an index from a seeded account with 24 months of shards and record
      the build time and entry count in `docs/implementation/README.md`.

## Exit criteria

Every screen question has one lookup call with a bounded, explicitly sorted answer.
