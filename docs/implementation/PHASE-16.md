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

- [ ] Implement `buildChooserModel` with the date label rule: today shows the time,
      an earlier day shows the date, and a non-current year includes the year.
- [ ] Implement `buildOverviewModel` walking `resolveTree` output.
- [ ] Implement `SessionListItem.svelte` with a status badge and a link.
- [ ] Implement `WorkoutTreeReadOnly.svelte` with indentation by depth using
      `--space-*` tokens only.
- [ ] Implement `LandingScreen.svelte` with the checkbox and the sign-in button.
- [ ] Implement `WorkoutChooserScreen.svelte` with the two sections and `Load older`.
- [ ] Implement `WorkoutOverviewScreen.svelte` with the `Start Workout` action and a
      pending state while the session write resolves.
- [ ] Wire all three into the Phase 15 route outlet.
- [ ] Show `DataError` for an unresolved workout reference inside the chooser list
      without dropping the other rows.

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
