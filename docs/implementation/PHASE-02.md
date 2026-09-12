# Phase 02 — Domain contracts and pure helpers

Define the TypeScript model for the four document families and the pure functions
that every other layer reuses: IDs, UTC handling, shards, and composite keys.

## Prerequisites

- Phase 01 for the shared styling, if any UI appears. No UI appears in this phase.
- The v1 schemas under `schemas/` already match the v4 contract.

## Goals

1. Give the codebase one typed model for exercises, workouts, preferences, and results.
2. Make the composite result key one function that nobody reimplements.
3. Make UTC-only persistence and shard selection one function.
4. Remove the `Math.random()` UUID fallback.
5. Define the typed error vocabulary once.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/domain/types.ts` | Types for all four families and their nested shapes. |
| `src/domain/enums.ts` | Controlled vocabularies mirrored from the schemas. |
| `src/domain/errors.ts` | `AppErrorKind` and the `AppError` class. |
| `src/domain/ids.ts` | Secure UUID creation and the ID character rule. |
| `src/domain/time.ts` | UTC formatting, parsing, and shard naming. |
| `src/domain/execution-path.ts` | Path encoding and composite key builders. |
| `src/random-uuid.ts` | Deleted. Callers move to `src/domain/ids.ts`. |

### Types

The sketch below shows the top-level shapes. `src/domain/types.ts` mirrors the four
v1 schemas in full, including the nested shapes the sketch omits: `Icon`,
`MeasurementSupport`, `ContainerNode`, `ExerciseNode`, `Prescription`,
`IterationPrescription`, `ResultValues`, `EffortOutcome`, and `Score`.
```ts
// src/domain/types.ts
export interface Exercise {
  id: string; name: string; instructions: string[]; icon?: Icon;
  equipment: EquipmentValue | null;
  force: Force | null; mechanic: Mechanic | null; category: Category; level: Level;
  movementPattern: MovementPattern;
  primaryMuscles: Muscle[]; secondaryMuscles: Muscle[];
  laterality: Laterality;
  measurements: MeasurementSupport[];
  loadSemantics: LoadSemantics;
}

export interface Workout { id: string; name: string; notes?: string; root: ContainerNode; }
export type WorkoutNode = ContainerNode | ExerciseNode;

export interface Session {
  id: string; workoutId: string; status: SessionStatus;
  startedAtUtc: string; completedAtUtc?: string; updatedAtUtc: string;
  exerciseResults: Record<string, ExerciseResult>;
  containerResults: Record<string, ContainerResult>;
  notes?: string;
}

export interface ExerciseResult {
  workoutId: string; executionPath: PathSegment[]; exerciseId: string;
  side?: Side; attempt?: number; startingSide?: StartingSide;
  status: ResultStatus; values?: ResultValues; effort?: EffortOutcome;
  startedAtUtc?: string; endedAtUtc?: string; reasonCode?: ReasonCode; notes?: string;
}

export interface ContainerResult {
  workoutId: string; executionPath: PathSegment[]; attempt?: number;
  status: ResultStatus; score?: Score;
  startedAtUtc?: string; endedAtUtc?: string; reasonCode?: ReasonCode; notes?: string;
}

export interface Quantity { value: number; unit: string; }
export interface PreferencesDoc {
  format: 'repjot/preferences'; schemaVersion: number;
  revision: number; updatedAtUtc: string;
  exerciseUnits: Record<string, Record<string, string>>;
}
export interface ResultsShard {
  format: 'repjot/results'; schemaVersion: number;
  yearMonthUtc: string; sessions: Record<string, Session>;
}
export interface StaticData { exercises: Exercise[]; workouts: Workout[]; }
```

```ts
// src/domain/errors.ts
export type AppErrorKind =
  | 'authentication' | 'authorization' | 'network' | 'drive_rate_limit'
  | 'drive_quota' | 'duplicate_drive_file' | 'unsupported_schema'
  | 'invalid_document' | 'migration' | 'semantic_reference'
  | 'storage' | 'ambiguous_upload' | 'insecure_environment';

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly detail: Record<string, string | number>;  // never a token, header, or file body
  constructor(kind: AppErrorKind, detail?: Record<string, string | number>, message?: string);
}
```

```ts
// src/domain/ids.ts
export const SESSION_ID_PREFIX = 'session-';
export function secureUuid(): string;                       // throws AppError('insecure_environment')
export function createSessionId(): string;                  // `session-` + secureUuid()
export function assertIdSafe(id: string, what: string): void; // bans '/', '|', ':'
export function isIntegerLikeKey(key: string): boolean;
```

```ts
// src/domain/time.ts
export function nowUtc(): string;                    // RFC 3339, whole seconds, ends in 'Z'
export function toUtcIso(input: Date): string;
export function parseUtc(value: string): Date;       // rejects a value that does not end in 'Z'
export function yearMonthUtc(startedAtUtc: string): string;   // '2026-09'
export function shardName(startedAtUtc: string): string;      // 'results-2026-09.json'
export function isSameUtcMonth(a: string, b: string): boolean;
```

```ts
// src/domain/execution-path.ts
export interface PathSegment { nodeId: string; iteration?: number; }
export const FIELD_SEPARATOR = '|';
export function encodePath(segments: PathSegment[]): string;      // 'root/squat-sets:3/back-squat-set'
export function decodePath(encoded: string): PathSegment[];
export function exerciseResultKey(
  path: PathSegment[], side: Side = 'both', attempt = 1): string; // '<path>|both|1'
export function containerResultKey(path: PathSegment[], attempt = 1): string;
export function nodeKey(workoutId: string, nodeId: string): string; // '<workoutId>|<nodeId>'
```

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 3.5, 3.6 | `time.ts` persists only `*Utc` RFC 3339 `Z` values; local conversion lives in the UI layer only. |
| REQUIREMENTS 3.17, 3.18 | `isIntegerLikeKey` exists so loaders and tests can reject integer-like keys. |
| REQUIREMENTS 6.1, 6.2, 6.3 | Types carry plain string IDs. No hash, digest, or provenance field exists. |
| REQUIREMENTS 11.8 | `Quantity` stores value and explicit unit together. |
| REQUIREMENTS 11.22 | `createSessionId()` returns `session-` plus UUID v4 and encodes no time. |
| REQUIREMENTS 22.4.6 | `assertIdSafe` bans `/`, `\|`, and `:` in every ID. |
| REQUIREMENTS 22.4.7 | Key builders always write `side` and `attempt`, including defaults. |
| REQUIREMENTS 22.4.9 | Two key builders, one per result kind. |
| ARCHITECTURE C-09 | `secureUuid()` throws when `crypto.getRandomValues` is absent. No `Math.random()` path exists. |
| ARCHITECTURE C-10, C-11 | `parseUtc` rejects offsets; `shardName` reads the UTC month from `startedAtUtc`. |
| ARCHITECTURE §15 | `AppErrorKind` matches the architecture list. |
| SPEC rep-jot-json-schema-spec §1–§5 | Types mirror the v1 schemas field for field. |

## Checklist

### Implementation

- [x] Create `src/domain/enums.ts` with `Force`, `Mechanic`, `Category`, `Level`,
      `MovementPattern`, `Muscle` (17 values), `Laterality`, `EquipmentValue`
      (11 values), `LoadSemantics`, `Side`, `StartingSide`, `ResultStatus`,
      `SessionStatus`, `ReasonCode`, `ScoreType`, `Stimulus`, `SetType`.
- [x] Create `src/domain/types.ts` with the document and entity types above.
- [x] Create `src/domain/errors.ts` with `AppErrorKind` and `AppError`.
- [x] Create `src/domain/ids.ts`. `secureUuid()` reads 16 bytes from
      `crypto.getRandomValues`, sets the RFC 4122 v4 and variant bits, and throws
      `AppError('insecure_environment')` when the API is missing.
- [x] Create `src/domain/time.ts`. `nowUtc()` emits whole-second precision.
- [x] Create `src/domain/execution-path.ts` with encode, decode, and both key builders.
- [x] Delete `src/random-uuid.ts`. Update `src/polyfills.ts` and `src/google-drive.ts`
      to import from `src/domain/ids.ts`. Keep the `crypto.randomUUID` polyfill, but
      back it with `secureUuid()` so no `Math.random()` path remains.
- [x] Add a short doc comment above each exported function that names the requirement
      section it implements.

### Tests

- [x] `tests/domain-ids.test.ts`: `createSessionId()` starts with `session-`, matches
      the UUID v4 pattern, and two calls differ.
- [x] `tests/domain-ids.test.ts`: `secureUuid()` throws `AppError` with kind
      `insecure_environment` when `crypto.getRandomValues` is stubbed out.
- [x] `tests/domain-ids.test.ts`: `assertIdSafe` rejects `a/b`, `a|b`, `a:b` and
      accepts `back-squat-set`.
- [x] `tests/domain-ids.test.ts`: `isIntegerLikeKey` is true for an all-digit key,
      such as `'12'`, `'0'`, and `'007'`, and false for `'1e2'`, `'session-x'`, and
      composite keys. The rule matches the schema pattern `^(?![0-9]+$)` exactly,
      because only an all-digit key reorders in JavaScript.
- [x] `tests/domain-time.test.ts`: `shardName('2026-09-01T06:30:00Z')` returns
      `'results-2026-09.json'`.
- [x] `tests/domain-time.test.ts`: `nowUtc()` ends in `Z` and holds no millisecond part.
- [x] `tests/domain-time.test.ts`: `parseUtc` rejects `'2026-08-15T07:30:00-07:00'`.
- [x] `tests/execution-path.test.ts`: `encodePath` produces
      `root/squat-sets:3/back-squat-set` for the spec example.
- [x] `tests/execution-path.test.ts`: `exerciseResultKey` always emits both `side`
      and `attempt`, including the defaults, and matches
      `root/squat-sets:3/back-squat-set|both|1`.
- [x] `tests/execution-path.test.ts`: `decodePath(encodePath(x))` equals `x` for
      nested repeated containers.
- [x] `tests/execution-path.test.ts`: `nodeKey('w', 'n')` equals `'w|n'`.

### Verification

- [x] `bun run check` passes.
- [x] `bun test` passes, including the existing Phase 0 tests after the UUID move.
- [x] `bun run build` passes.
- [x] `bun run check:compat` passes.
- [x] `grep -rn "Math.random" src/` returns nothing.

## Notes on this build

Deviations from the plan, and why.

1. **`types.ts` mirrors the full schema, not only the sketched types.** The plan
   sketch lists the top-level shapes. The file also defines `Icon`, the seven
   `MeasurementSupport` variants, `ContainerNode`, `ExerciseNode`, `Prescription`,
   `IterationPrescription`, `ResultValues`, `EffortOutcome`, `Score`, the five
   `strategyConfig` shapes, and the `ExercisesDoc` and `WorkoutsDoc` envelopes.
   Phases 03 through 05 need them, so no later phase adds a type.
2. **`ScoreType` holds the three capture types only.** `resultCapture.scoreType`
   allows `cycles`, `rounds_and_reps`, and `intervals`. The recorded `Score` union
   adds the `'nonstandard'` discriminator. One name does not cover both sets, so the
   enum follows the author-facing field and `Score` carries the wider set.
3. **`isIntegerLikeKey` matches the schema rule exactly.** It returns true for an
   all-digit key, the pattern `^(?![0-9]+$)`. The plan test asked for `'1e2'` to be
   true. JavaScript treats `'1e2'` as an ordinary string key, so it cannot reorder.
   A wider rule would reject documents the schema accepts. The plan test was updated
   to the exact rule.
4. **`insecure_environment` was added to `docs/ARCHITECTURE.md` section 15.** The
   plan lists 13 `AppErrorKind` values and says the list matches the architecture,
   which held 12. The architecture now lists 13 and carries a UI row for the new
   kind.
5. **`ContainerNode` is a discriminated union over `strategy`.** `strategyConfig`
   shape depends on the sibling `strategy` field, which a plain interface cannot
   express. `ContainerNodeFor<S>` plus `StrategyConfigFor<S>` let TypeScript narrow
   `strategyConfig` after a `strategy` check. The schema still owns validation.
6. **Domain modules import no DOM types.** `ids.ts` reads `globalThis.crypto`
   through a local `RandomSource` interface, so `src/domain/` holds no DOM,
   Svelte, OAuth, Drive, or IndexedDB import. Plan rule 6.
7. **The `crypto.randomUUID` installer lives in `src/polyfills.ts`.**
   `src/random-uuid.ts` is deleted. The installer now calls `secureUuid()` from
   `src/domain/ids.ts`, so the polyfill and the domain share one random path.
   `src/google-drive.ts` calls `secureUuid()` for its multipart boundary.
8. **`AppError` sets its prototype in the constructor.** `Object.setPrototypeOf`
   keeps `instanceof AppError` correct when a bundler down-levels the class. An
   `isAppError()` guard is exported with the class.

## Exit criteria

Every later module imports IDs, timestamps, shard names, and composite keys from
`src/domain/`. No module builds a key or a shard name by string concatenation.
