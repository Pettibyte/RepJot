# Phase 18 — Summary, history, and exercise history

Build the read-only screens: Workout Summary, Workout History, and Exercise History.

## Prerequisites

- Phase 12 lookup service and Phase 14 session service.
- Phase 15 shell with the back header and the `DataError` component.
- Phase 13 unit formatting.

## Goals

1. Show all recorded work for one session from the session's own data.
2. Page through workout history with `Load older`.
3. Page through one exercise's results, newest first.
4. Keep every screen readable when the current tree cannot resolve a path.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/ui/screens/WorkoutSummaryScreen.svelte` | One session summary. |
| `src/ui/screens/WorkoutHistoryScreen.svelte` | All sessions, paged. |
| `src/ui/screens/ExerciseHistoryScreen.svelte` | One exercise's results, paged. |
| `src/ui/components/SummaryTree.svelte` | Recorded work rendered without the tree. |
| `src/ui/components/LoadOlder.svelte` | Shared paged-load control with a busy state. |
| `src/ui/viewmodels/summaryModel.ts` | Pure summary view model. |
| `src/ui/viewmodels/historyModel.ts` | Pure history and exercise-history view models. |

### Signatures

```ts
// src/ui/viewmodels/summaryModel.ts
export interface SummaryModel {
  title: string; statusLabel: string;
  startedLabel: string; completedLabel: string;
  groups: SummaryGroup[];               // recorded work, ordered by encoded path
  unresolved: UnresolvedResult[];
  notes?: string;
}
export function buildSummaryModel(input: {
  session: Session; staticData: LoadedStaticData; localTimeZone: string;
}): SummaryModel;

// src/ui/viewmodels/historyModel.ts
export interface HistoryRow {
  sessionId: string; workoutName: string; statusLabel: string;
  dateLabel: string; href: string;
}
export function buildWorkoutHistoryModel(sessions: SessionSummary[],
  localTimeZone: string): HistoryRow[];
export function buildExerciseHistoryModel(
  occurrences: ExerciseOccurrence[], localTimeZone: string): HistoryRow[];
```

### Screen behavior

**Workout Summary**

- Renders from `session.exerciseResults` and `session.containerResults` only.
- Container scores appear with their score type label.
- A `nonstandard` score shows **Detailed**.
- Draft values never appear. Only saved work renders.
- Unresolved results render their stored values plus a `DataError` card.
- An **Edit** action opens the Active Workout editor on the terminal session.

**Workout History**

- Completed, in-progress, and abandoned sessions, newest first.
- `Load older` extends the page.
- No aggregate volume metric anywhere on the screen.

**Exercise History**

- Results for one exercise, newest first, paged.
- Each row links back to its session summary.

**Date labels**

- Current year omits the year. Any other year includes it.

### Component syntax

Every `.svelte` file in this phase uses Svelte 5 runes. Phase 15 set the pattern
in `src/App.svelte`, `src/ui/components/DataError.svelte`, and the screens under
`src/ui/screens/`. Follow it for the summary and history screens.

1. Declare props with `$props()`. Never use `export let`. Svelte 5 rejects
   `export let` in a component that uses runes, so one file cannot mix the two
   styles.
2. Type the props on the `$props()` call, and give every optional prop a default.
3. Share a props type across modules through a plain `.ts` file, not through the
   component. `src/ui/components/data-error-types.ts` is the model.
4. Use `$state()` for local state, `$derived()` for a computed value, and
   `$effect()` for a side effect. A paged list keeps its loaded rows in
   `$state` and derives the visible slice.
5. Pass content with a snippet: `{#snippet name()}` at the call site and
   `{@render name()}` inside the component. Never use `<slot>`.
6. Read an app store with the `$store` prefix. Store interop works in runes mode.
   `App.svelte` reads `startupStatus`, `saveStatus`, and `activeError` that way.
7. Handle an event with the `onclick={handler}` attribute. Never use the legacy
   `on:click` directive. The shared `Button` component takes a typed `onclick`
   prop and spreads it to the element.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 6.23 | `buildSummaryModel` reads only the session's stored results. |
| REQUIREMENTS 6.8, 6.9 | Unresolved entries render a card with **View Raw JSON** beside the stored values. |
| REQUIREMENTS 10.13, 10.18 | Aggregate-only and `nonstandard` display. |
| REQUIREMENTS 11.16 | The **Edit** action opens the Active Workout editor on a terminal session. |
| REQUIREMENTS 20.1 | History shows all three statuses with `Load older`. |
| REQUIREMENTS 20.2 | No aggregate workout-volume metric. |
| REQUIREMENTS 20.3 | Summary shows work, units, attempts, status, and container scores. |
| REQUIREMENTS 20.4 | Exercise history pages newest first. |
| REQUIREMENTS 20.5 | Date labels include the year only for a non-current year. |
| ARCHITECTURE §9 loading policy | Terminal history loads on demand through `extendHistory`. |

## Checklist

### Implementation

- [x] Implement `buildSummaryModel` with grouping by encoded path and a fallback sort
      by the encoded path string when the tree cannot resolve.
- [x] Implement `SummaryTree.svelte` that renders recorded work without requiring the
      workout tree.
- [x] Implement `LoadOlder.svelte` with a disabled state while a load runs.
- [x] Implement `buildWorkoutHistoryModel` and `buildExerciseHistoryModel`.
- [x] Implement `WorkoutSummaryScreen.svelte` with the **Edit** action.
- [x] Implement `WorkoutHistoryScreen.svelte` with paging through
      `lookup.getWorkoutHistory` and `extendHistory`.
- [x] Implement `ExerciseHistoryScreen.svelte` with paging through
      `getExerciseHistory`.
- [x] Confirm no screen computes a volume total.
- [x] Render `DataError` per unresolved result without dropping the list.
- [ ] Confirm every new `.svelte` file uses runes: `$props()` and snippets, with no
      `export let`, no `<slot>`, and no `on:click`.

### Tests

- [ ] `tests/summaryModel.test.ts`: a session with no current workout still renders
      all recorded values.
- [ ] `tests/summaryModel.test.ts`: a `nonstandard` container score renders the
      **Detailed** label.
- [ ] `tests/summaryModel.test.ts`: draft values never appear in the model.
- [ ] `tests/summaryModel.test.ts`: unresolved results appear in `unresolved` and
      keep their stored values in `groups`.
- [ ] `tests/historyModel.test.ts`: rows sort newest first with no gap across pages.
- [ ] `tests/historyModel.test.ts`: the year appears only for a non-current year.
- [ ] `tests/historyModel.test.ts`: in-progress and abandoned sessions appear
      alongside completed ones.
- [ ] `tests/historyModel.test.ts`: no row or header contains a volume total.

### Verification

- [ ] `bun test` passes.
- [ ] `bun run check` passes.
- [ ] `bun run build` passes.
- [ ] `bun run check:compat` passes.
- [ ] Manual in `bun run dev`: page through 24 months of seeded history with
      `Load older` and confirm the screen stays responsive on the Kindle.

## Exit criteria

Every recorded session and every exercise result is reachable, paged, and readable
even when the static data no longer resolves.
