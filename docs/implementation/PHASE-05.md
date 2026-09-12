# Phase 05 — Static data pipeline and authoring

Load the bundled exercise and workout data at runtime, enforce the three static
identity checks at build time, and author the first real `workouts.json`.

## Prerequisites

- Phase 03 for the document pipeline.
- Phase 04 for `validateStaticData`.
- The seed pipeline already works: `bun run seed`, `seed:check`, `seed:bump`.

## Goals

1. Give the app one `StaticData` object loaded once at startup.
2. Make a stale or invalid static file fail the build, not the browser.
3. Author workouts that exercise every container strategy in the schema.
4. Expand the exercise allowlist to cover those workouts.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/documents/static-loader.ts` | Fetch, pipeline, and semantic-validate the two bundled files. |
| `scripts/check-static-data.ts` | Build-time gate for the three identity checks. Registered as `bun run check:static`. |
| `src/public/data/workouts.json` | Curated workout definitions. Hand-authored. |
| `scripts/exercise-allowlist.json` | Expanded so every workout node reference resolves. |
| `package.json` | Adds `check:static` and inserts it into the `build` chain. |

### Signatures

```ts
// src/documents/static-loader.ts
export interface LoadedStaticData {
  exercises: Exercise[];
  workouts: Workout[];
  exerciseById: Map<string, Exercise>;   // built here, cheap, read-only
  workoutById: Map<string, Workout>;
}
export function loadStaticData(fetchImpl?: typeof fetch): Promise<LoadedStaticData>;
  // throws AppError('invalid_document') or AppError('semantic_reference')
```

The loader reads `./data/exercises.json` and `./data/workouts.json` with relative
URLs so the bundle works under the GitHub Pages root and under `bun run dev`.

### Build gate

`scripts/check-static-data.ts` reads the two files from `src/public/data/`, runs
them through the Phase 03 pipeline and the Phase 04 `validateStaticData`, and exits
nonzero with one line per problem. `package.json` becomes:

```json
"build": "bun run check:schemas && bun run check:static && bun run seed:check && bun run check:styles && vite build"
```

### Workout authoring targets

`src/public/data/workouts.json` must contain at least these shapes so later phases
can test against real data:

| Workout | Shapes covered |
| --- | --- |
| `strength-and-cindy` | `sequence` root, `rounds` with per-iteration prescription overrides, AMRAP with `rounds_and_reps` and `childDetail: "optional"`, `benchmark` metadata. |
| `emom-conditioning` | `emom` with `cycles` and `interval`, `intervals` score, optional child detail. |
| `kb-complex` | `complex` with `cycles` and `childDetail: "none"`, `added` and `assisted` load semantics. |
| `warmup-mobility` | Nested `sequence` containers, `mobility` stimulus, warmup `setType`. |

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 3.1 | Both files ship in the static bundle under `src/public/data/`. |
| REQUIREMENTS 6.19, 6.20, 6.21, 6.22 | `check:static` runs schema, duplicate node ID, and exercise-reference checks and nothing else. |
| REQUIREMENTS 6.14, 6.15 | Selection follows the allowlist and `workouts.json`. No lifecycle flag exists. |
| REQUIREMENTS 7.1, 7.4 | Static site, JSON Schema validation before packaging. |
| REQUIREMENTS 10.1–10.11 | The four authored workouts cover the container strategies and result capture modes. |
| REQUIREMENTS 13.15, 13.22 | Only the seed writes `exercises.json`; the build gate blocks a stale file. |
| ARCHITECTURE §8 "Static exercise seed" | The three build checks and the seed boundary are enforced here. |
| ARCHITECTURE §9 startup steps 1–2 | `loadStaticData` is the startup gate that blocks normal use on failure. |

## Checklist

### Implementation

- [ ] Create `src/documents/static-loader.ts` with `loadStaticData`.
- [ ] Use relative `./data/...` URLs. Do not hard-code the origin.
- [ ] Run each file through `processDocument` with its `expectedFamily`.
- [ ] Run `validateStaticData` and throw on fatal issues.
- [ ] Build `exerciseById` and `workoutById` maps in the loader.
- [ ] Create `scripts/check-static-data.ts` and register `bun run check:static`.
- [ ] Insert `check:static` into the `build` script after `check:schemas`.
- [ ] Author `src/public/data/workouts.json` with the four workouts above.
- [ ] Expand `scripts/exercise-allowlist.json` so every node `exerciseId` resolves.
      Use object entries where the workout needs `movementPattern`, `laterality`,
      `loadSemantics`, or non-default `measurements`.
- [ ] Run `bun run seed` and commit the regenerated `src/public/data/exercises.json`.
- [ ] Add a short comment at the top of `workouts.json`'s companion doc section in
      `README.md` that points to the schema spec for prescription rules.

### Tests

- [ ] `tests/static-loader.test.ts`: a stubbed `fetch` returning valid files yields a
      `LoadedStaticData` with populated maps.
- [ ] `tests/static-loader.test.ts`: a 404 on either file throws `AppError`.
- [ ] `tests/static-loader.test.ts`: a wrong `format` throws with `reason: 'family'`.
- [ ] `tests/static-data.test.ts`: the committed `workouts.json` and
      `exercises.json` pass `validateStaticData`.
- [ ] `tests/static-data.test.ts`: every workout node `exerciseId` in the committed
      files exists in the committed exercises.
- [ ] `tests/static-data.test.ts`: the committed files contain no `deprecated` field.
- [ ] `tests/static-data.test.ts`: the four target strategies appear in the committed
      workouts, so a later phase cannot drop them silently.

### Verification

- [ ] `bun run seed:check` passes with the committed artifact.
- [ ] `bun run check:static` passes.
- [ ] `bun run check` passes.
- [ ] `bun test` passes.
- [ ] `bun run build` runs the full gate chain and produces `dist/data/*.json`.
- [ ] `bun run check:compat` passes.

## Exit criteria

The browser can obtain a validated `StaticData` object in one call, and no build can
ship a static file that fails the three identity checks.
