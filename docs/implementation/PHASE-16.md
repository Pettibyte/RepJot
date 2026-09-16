# Phase 16 — Landing, chooser, and workout overview

Build the entry screens: the anonymous landing page, the authenticated workout
chooser, and the Workout Overview with Start Workout.

## Prerequisites

- Phase 15 shell, router, and `DataError`.
- Phase 07 auth for the redirect and the remember choice.
- Phase 12 lookup for active and recent sessions.
- Phase 14 session service for `start`.

## Goals

1. Give the anonymous user a product page with sign-in and the privacy link.
2. Show in-progress sessions above recent sessions on the chooser.
3. Render a programmed workout tree read-only.
4. Create a session and enter Active Workout.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/ui/screens/LandingScreen.svelte` | Anonymous landing. |
| `src/ui/screens/WorkoutChooserScreen.svelte` | Authenticated landing. |
| `src/ui/screens/WorkoutOverviewScreen.svelte` | Programmed tree, read-only. |
| `src/ui/viewmodels/chooserModel.ts` | Pure view model for the chooser lists. |
| `src/ui/viewmodels/overviewModel.ts` | Pure view model for the overview tree. |
| `src/ui/components/SessionListItem.svelte` | One session row with status and date. |
| `src/ui/components/WorkoutTreeReadOnly.svelte` | Indented tree with prescriptions. |

### Signatures

```ts
// src/ui/viewmodels/chooserModel.ts
export interface ChooserModel {
  active: SessionListItemModel[];      // all in_progress, updatedAtUtc newest first
  recent: SessionListItemModel[];      // up to 5 completed or abandoned, newest first
  hasMore: boolean;
}
export interface SessionListItemModel {
  sessionId: string; workoutName: string; statusLabel: string;
  timeLabel: string;                   // 'Today 06:30' or '2026-08-31'
  href: string;
}
export function buildChooserModel(input: {
  active: SessionSummary[];
  recent: SessionSummary[];
  nowUtc: string;
  localTimeZone: string;
}): ChooserModel;

// src/ui/viewmodels/overviewModel.ts
export interface OverviewNodeModel {
  label: string; depth: number; prescriptionText: string; isExercise: boolean;
  exerciseHref?: string;
}
export function buildOverviewModel(workout: Workout, staticData: LoadedStaticData): {
  title: string; notes?: string; nodes: OverviewNodeModel[];
};
```

### Screen behavior

**Landing**

- Wordmark, one-line product description, and a link to the privacy policy.
- `Remember me on this device` checkbox, unchecked by default.
- `Continue with Google` primary button that calls `beginAuthorization`.
- Inline error area for `access_denied` and state failures.

**Chooser**

- Section "In progress" lists every `in_progress` session, newest `updatedAtUtc`
  first. Tapping resumes at `/#/sessions/:id/active`.
- Section "Recent" lists up to five completed or abandoned sessions.
- `Load older` appears when more history exists and extends the recent list.
- Empty state points to the workout list.

**Workout Overview**

- Renders the programmed tree with prescriptions.
- `Start Workout` calls `sessionService.start(workoutId)` then navigates.
- An unknown `workoutId` renders the not-found state.

### Component syntax

Every `.svelte` file in this phase uses Svelte 5 runes. Phase 15 set the pattern
in `src/App.svelte`, `src/ui/components/DataError.svelte`, and the screens under
`src/ui/screens/`. Follow it for the landing, chooser, and overview components.

1. Declare props with `$props()`. Never use `export let`. Svelte 5 rejects
   `export let` in a component that uses runes, so one file cannot mix the two
   styles.
2. Type the props on the `$props()` call, and give every optional prop a default.
3. Share a props type across modules through a plain `.ts` file, not through the
   component. `src/ui/components/data-error-types.ts` is the model.
4. Use `$state()` for local state, `$derived()` for a computed value, and
   `$effect()` for a side effect.
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
| REQUIREMENTS 2.1, 2.9, 2.10 | The remember checkbox drives the token store choice. |
| REQUIREMENTS 14.1 | The landing page describes REP JOT and links to the privacy policy. |
| REQUIREMENTS 15.1 | Selection, overview, and entry only. No authoring. |
| REQUIREMENTS 16.1, 16.2 | Chooser and Settings use the tab header. Overview uses the back header. |
| REQUIREMENTS 17.1–17.6 | The chooser lists active sessions with title and date, recent capped at five, and `Load older`. |
| REQUIREMENTS 18.1, 18.2 | Overview renders the tree. Start Workout creates an `in_progress` session with a start time. |
| REQUIREMENTS 8.1 | Wordmark renders `REP JOT`. |
| ARCHITECTURE §9 chooser paragraph | Active above recent, sorted by `updatedAtUtc`. |
| ARCHITECTURE §13 | Native checkbox and button, no hover-only action, no grid layout. |

## Checklist

### Implementation

- [x] Implement `buildChooserModel` with the date label rule: today shows the time,
      an earlier day shows the date, and a non-current year includes the year.
- [x] Implement `buildOverviewModel` walking `resolveTree` output.
- [x] Implement `SessionListItem.svelte` with a status badge and a link.
- [x] Implement `WorkoutTreeReadOnly.svelte` with indentation by depth using
      `--space-*` tokens only.
- [x] Implement `LandingScreen.svelte` with the checkbox and the sign-in button.
- [x] Implement `WorkoutChooserScreen.svelte` with the two sections and `Load older`.
- [x] Implement `WorkoutOverviewScreen.svelte` with the `Start Workout` action and a
      pending state while the session write resolves.
- [x] Wire all three into the Phase 15 route outlet.
- [x] Show `DataError` for an unresolved workout reference inside the chooser list
      without dropping the other rows.
- [ ] Confirm every new `.svelte` file uses runes: `$props()` and snippets, with no
      `export let`, no `<slot>`, and no `on:click`.

### Tests

- [ ] `tests/chooserModel.test.ts`: active sessions appear before recent sessions.
- [ ] `tests/chooserModel.test.ts`: recent is capped at five and excludes
      `in_progress`.
- [ ] `tests/chooserModel.test.ts`: `timeLabel` shows a time for today, a date for an
      earlier day, and includes the year for a prior year.
- [ ] `tests/chooserModel.test.ts`: `hasMore` is true when more history exists.
- [ ] `tests/overviewModel.test.ts`: every node carries a depth and a prescription
      string.
- [ ] `tests/overviewModel.test.ts`: an iteration override shows the effective value
      for each iteration.
- [ ] `tests/overviewModel.test.ts`: an unknown workout produces no model and the
      caller shows not-found.

### Verification

- [ ] `bun test` passes.
- [ ] `bun run check` passes.
- [ ] `bun run build` passes.
- [ ] `bun run check:compat` passes.
- [ ] Manual in `bun run dev`: sign in, confirm the chooser lists an in-progress
      session, start a workout from Overview, and confirm the session appears in the
      chooser after a reload.

## Exit criteria

A user can sign in, see their in-progress work, read a programmed workout, and start
a session.

## Build decisions

Four points in this plan needed a call before the code. The user chose each one.

1. **Screens read services from a registry.** `src/services/registry.ts` holds a
   Svelte store with `lookup`, `sessionService`, `preferences`, `coordinator`,
   and `staticData`. Bootstrap publishes them; screens read `$services`. This
   mirrors `src/routing/router-registry.ts` and adds a store because the warm
   fills the index after the first paint, so a screen must re-render when a
   service grows. `publishServices()` re-publishes after each shard lands.
2. **Bootstrap warms the result shards.** Step 6 now loads preferences and then
   every result shard the Drive catalog lists, current month first, one at a
   time. The catalog carries no session status, so the only way to find an
   in-progress session is to read the shards that could hold one. Each shard
   reaches the index as it arrives, so the chooser fills progressively. See
   `src/sync/warm-result-shards.ts`.
3. **The chooser lists every workout in the bundle.** The plan's `ChooserModel`
   had `active`, `recent`, and `hasMore` only. A signed-in user with no history
   would then have had no path to the overview. The model gained `workouts` and
   `workoutsHasMore`, paginated at ten, with a **Show more workouts** control.
   Each workout row carries a `Last: YYYY-MM-DD` label when a loaded session
   covers it.
4. **The privacy link points at `./privacy.html`.** Phase 20 owns that file. The
   link 404s until Phase 20 ships it.

Three smaller notes:

- `timeLabel` uses `Today HH:MM` for the current local day and `YYYY-MM-DD` for
  any earlier day, which matches the plan's `'Today 06:30' or '2026-08-31'`
  contract. A prior year carries the year inside the date.
- The overview renders a repeated container once per iteration. The first row
  carries the container's own name and its round count; a later row reads
  `Round N` with no count, so the rows differ at a glance and each shows the
  prescription that applies to it.
- `HomeScreen.svelte` is deleted. `LandingScreen.svelte` replaces the anonymous
  half and `WorkoutChooserScreen.svelte` replaces the signed-in half. The
  `.home__*` styles were replaced by `.landing__*`, `.chooser__*`,
  `.session-row`, `.workout-row`, `.overview__*`, and `.tree-row` rules.
