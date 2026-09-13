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

- [x] Create `src/documents/static-loader.ts` with `loadStaticData`.
- [x] Use relative `./data/...` URLs. Do not hard-code the origin.
- [x] Run each file through `processDocument` with its `expectedFamily`.
- [x] Run `validateStaticData` and throw on fatal issues.
- [x] Build `exerciseById` and `workoutById` maps in the loader.
- [x] Create `scripts/check-static-data.ts` and register `bun run check:static`.
- [x] Insert `check:static` into the `build` script after `check:schemas`.
- [x] Author `src/public/data/workouts.json` with the four workouts above.
- [x] Expand `scripts/exercise-allowlist.json` so every node `exerciseId` resolves.
      Use object entries where the workout needs `movementPattern`, `laterality`,
      `loadSemantics`, or non-default `measurements`.
- [x] Run `bun run seed` and commit the regenerated `src/public/data/exercises.json`.
- [x] Add a short comment at the top of `workouts.json`'s companion doc section in
      `README.md` that points to the schema spec for prescription rules.

### Tests

- [x] `tests/static-loader.test.ts`: a stubbed `fetch` returning valid files yields a
      `LoadedStaticData` with populated maps.
- [x] `tests/static-loader.test.ts`: a 404 on either file throws `AppError`.
- [x] `tests/static-loader.test.ts`: a wrong `format` throws with `reason: 'family'`.
- [x] `tests/static-data.test.ts`: the committed `workouts.json` and
      `exercises.json` pass `validateStaticData`.
- [x] `tests/static-data.test.ts`: every workout node `exerciseId` in the committed
      files exists in the committed exercises.
- [x] `tests/static-data.test.ts`: the committed files contain no `deprecated` field.
- [x] `tests/static-data.test.ts`: the four target strategies appear in the committed
      workouts, so a later phase cannot drop them silently.

### Verification

- [x] `bun run seed:check` passes with the committed artifact.
- [x] `bun run check:static` passes.
- [x] `bun run check` passes.
- [x] `bun test` passes.
- [x] `bun run build` runs the full gate chain and produces `dist/data/*.json`.
- [x] `bun run check:compat` passes.

## Exit criteria

The browser can obtain a validated `StaticData` object in one call, and no build can
ship a static file that fails the three identity checks.

## Notes from implementation

1. **The loader raises four error kinds, not two.** The plan named
   `invalid_document` and `semantic_reference`. A bundled file also fails at the
   transport layer and at the version gate, so the loader maps those to
   `network` and `unsupported_schema` and documents all four in its header. A
   raw `TypeError` from a dropped connection never escapes the loader; a test
   pins that.

2. **An HTTP error status is `invalid_document`, not `network`.** A bundled file
   that returns 404 means the build shipped an incomplete bundle. That is a
   document fault. The status code stays in `detail.status` so a screen can tell
   the two apart.

3. **`requestFile` keeps two call branches on purpose.** A caller-supplied stub
   is a plain function and is called directly. The host `fetch` is a method and
   must keep its `globalThis` receiver; called detached, the browser rejects it
   with "Illegal invocation". The two shapes need two call expressions.

4. **Both files load in parallel.** `Promise.all` removes one serial round trip
   on a slow Kindle connection. Only the first rejection surfaces, so when both
   files are broken the run reports one of them. That is acceptable: each error
   names its own file in `detail.file`, and the second broken file fails the
   same way on the next run.

5. **The gate runs `validateStaticData` only.** REQUIREMENTS 6.22 pins the
   build to the three identity checks, so the gate does not call
   `validateWorkoutSemantics`. Prescription rules such as iteration bounds stay
   a runtime concern. The authored data passes both passes anyway, which the
   committed-data tests confirm.

6. **The gate stops before the pair check when a file cannot be read.** A
   missing or unparsable `exercises.json` would otherwise bury the real cause
   under one unknown-exercise line per workout node.

7. **`tests/seed-exercises.test.ts` changed with the allowlist.** The
   "three barbell lifts" test asserted the whole published ID list, which the
   Phase 05 expansion breaks. It now scopes its assertions to the three lifts
   and checks that each one is present.

8. **The allowlist holds 22 entries.** The added and assisted load semantics
   the plan asks for come from `Weighted_Pull_Ups` and `Band_Assisted_Pull-Up`
   inside `kb-complex`. Bodyweight movements carry those semantics; a pure
   kettlebell circuit carries `per_implement`.

9. **The loader is not wired into `main.ts` in this phase.** This phase ships
   the module, the build gate, and the data. The startup screen that blocks
   normal use on a static-data failure belongs to the UI phases.

10. **This change ships no generated output.** Refreshing and committing
    `dist/` is a separate deployment step, owned by the README "Deploy to
    GitHub Pages" procedure, which builds and commits `dist/` and pushes it to
    the `gh-pages` branch. The build was run here only to prove the gate chain
    and the Kindle compat check, and the generated output was restored. Run the
    README deploy procedure to publish this phase's data.
