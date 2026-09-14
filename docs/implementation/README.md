# REP JOT Implementation Plan

Twenty phases build the product from the approved v4 architecture. Each phase is one
document. Each document lists its prerequisites, goals, interfaces, requirements
traceability, and a work checklist.

Read `docs/REQUIREMENTS.md`, `docs/ARCHITECTURE.md`, and `specs/` before any phase.
This plan does not restate them.

## Rules that hold for every phase

1. Use `bun` only. Never `node` or `npm`.
2. The repository must build and pass tests at the end of each phase.
3. New modules land with their tests in the same phase.
4. Styling is centralized. Screens use the shared tokens and components from Phase 01.
   Screens add no hex colors, no shadows, no gradients, and no page-specific CSS.
5. UI code calls no `fetch` and no IndexedDB API. It calls services.
6. Domain modules import no Svelte, DOM, OAuth, Drive, or IndexedDB.
7. Final verification for every phase is the repo command set:

   ```sh
   bun ci
   bun run check
   bun test
   bun run check:schemas
   bun run seed:check
   bun run build
   bun run check:compat
   ```

## Phase order

| Phase | Title | Main files |
| --- | --- | --- |
| [01](PHASE-01.md) | Styling foundation and design tokens | `src/ui/styles/*`, `src/ui/components/*`, `scripts/check-styles.ts` |
| [02](PHASE-02.md) | Domain contracts and pure helpers | `src/domain/*` |
| [03](PHASE-03.md) | Schema validation and document pipeline | `src/validation/schema-validator.ts`, `src/migrations/*`, `src/documents/document-pipeline.ts` |
| [04](PHASE-04.md) | Semantic validation | `src/validation/semantic-validator.ts` |
| [05](PHASE-05.md) | Static data pipeline and authoring | `src/documents/static-loader.ts`, `scripts/check-static-data.ts`, `src/public/data/workouts.json` |
| [06](PHASE-06.md) | Local persistence, diagnostics, and status | `src/storage/*`, `src/diagnostics/*`, `src/state/app-state.ts` |
| [07](PHASE-07.md) | Authentication service and redirect adapter | `src/auth/*` |
| [08](PHASE-08.md) | Drive interface and REST adapter | `src/drive/*` |
| [09](PHASE-09.md) | Keyed-map merge engine | `src/sync/merge-documents.ts` |
| [10](PHASE-10.md) | Sync coordinator | `src/sync/sync-coordinator.ts` |
| [11](PHASE-11.md) | Duplicate Drive file consolidation | `src/sync/consolidate-duplicates.ts` |
| [12](PHASE-12.md) | Index builder and lookup service | `src/indexes/*` |
| [13](PHASE-13.md) | Unit conversion and preferences | `src/units/conversion.ts`, `src/preferences/preference-service.ts` |
| [14](PHASE-14.md) | Session service | `src/sessions/session-service.ts` |
| [15](PHASE-15.md) | Router, shell, bootstrap, and `DataError` | `src/routing/hash-router.ts`, `src/bootstrap.ts`, `src/App.svelte` |
| [16](PHASE-16.md) | Landing, chooser, and workout overview | `src/ui/screens/{Landing,WorkoutChooser,WorkoutOverview}*.svelte` |
| [17](PHASE-17.md) | Active Workout execution screen | `src/ui/screens/ActiveWorkoutScreen.svelte` |
| [18](PHASE-18.md) | Summary, history, and exercise history | `src/ui/screens/*History*.svelte` |
| [19](PHASE-19.md) | Settings, export, deletion, and disconnect | `src/ui/screens/SettingsScreen.svelte`, `src/export/*`, `src/data/*` |
| [20](PHASE-20.md) | Release hardening and deployment | `scripts/check-browser-compat.ts`, `index.html`, `dist/` |

## Dependency shape

```text
01 styling ─────────────────────────────┐
02 domain ─┬─ 03 pipeline ─ 04 semantic ─┼─ 05 static data
           │                             │
           └─ 06 local store ─┬─ 07 auth ─┴─ 08 drive ─┬─ 09 merge ─ 10 sync ─ 11 duplicates
                             │                         │
                             └─ 12 indexes ─ 13 units ─┴─ 14 sessions
                                                            │
                              15 shell/router ─ 16 ─ 17 ─ 18 ─┴─ 19 settings ─ 20 release
```

Phases 01 through 14 add library code and tests. The existing Phase 0 prototype page
keeps the build green during those phases. Phase 15 replaces it with the real shell.

## Bundle budget

Phase 20 owns the release gate for bundle size. This section records what a phase
adds, so the next phase sees the cost before it depends on a library.

Run `bun run check:merge-compat` to reprint the merge figures. The script builds
each item with Vite at `target: 'es2019'`, minified, and gzips at level 9. Each
row is a direct measurement of that build. Gzip is not additive, so the combined
row is smaller than the sum of its parts.

| Item                                                    | Minified     | Gzipped      |
| ------------------------------------------------------- | ------------ | ------------ |
| `dist/app.js` before Phase 09                            | 84,131 bytes | 30,649 bytes |
| `jsondiffpatch` 0.7.6 alone                              | 16,084 bytes | 5,082 bytes  |
| `src/sync/merge-documents.ts` alone, library external   | 6,650 bytes  | 2,807 bytes  |
| `src/sync/merge-documents.ts` with `jsondiffpatch`       | 22,649 bytes | 7,615 bytes  |

Phase 09 adds no import to the app entry point, so `dist/app.js` keeps its size.
When Phase 10 imports `mergeDocuments`, expect `dist/app.js` to grow by about
7.6 KB gzipped, to about 38 KB gzipped.

The merge bundle parses as ES2019. `jsondiffpatch` 0.7.6 ships ES2019-safe
output: no optional chaining, no nullish coalescing, and no post-ES2019 runtime
API. The text differ stays out of the bundle because nothing imports
`jsondiffpatch/with-text-diffs`, and `check:merge-compat` fails if it ever
appears. `package.json` pins `jsondiffpatch` to the exact version 0.7.6, because
the ES2019 claim and the size figures above hold for that version.

If the Phase 10 growth breaks the Phase 20 budget, drop `jsondiffpatch` and write
the keyed-map merge by hand. The merge needs only `diff` and `patch` from the
library, and it uses them on keyed maps only.
