# Workout Chooser Visibility Filter

## Status

This specification adds an in-memory visibility filter to the authenticated
Workout chooser. It replaces the chooser's fixed live-only filter.

The filter has no saved state. It does not change routing, start permission,
Settings, preferences, synchronization, sessions, results, History, or the
complete static workout lookup.

## Goals

- Let a user show any combination of live, draft, and deprecated workouts in
  the Workout chooser.
- Keep the control hidden until the user requests it.
- Preserve the current initial experience: show live workouts only.
- Keep all workout statuses selectable in the chooser only. A status does not
  authorize or block a direct overview route or a new session.

## Workout Status Data

Every workout has a required `publishedStatus` property. Its allowed values
are:

| Value | Meaning |
| --- | --- |
| `live` | The normal published workout. |
| `draft` | A workout under development. |
| `deprecated` | A retained workout that is normally hidden. |

The `workouts.json` schema enum and the TypeScript `PublishedStatus` union must
include all three values. Every bundled workout must explicitly declare one.

Status remains current static metadata. It is not copied into sessions or
results. The complete static-data lookup continues to include all three
statuses, so saved sessions, History, summaries, and historical editing remain
unchanged.

## User Interface

### Initial state

When the authenticated Workout chooser mounts:

- The applied filter contains only `live`.
- The filter controls are hidden.
- The chooser shows only live workouts.
- The filter state exists only in the mounted screen. Leaving the screen,
  reloading, or opening the application again resets it to live only.

### Filter control

Place an icon-only button in the Workout section header, after the `Workouts`
heading. The button uses the Material Symbol `tune`.

The button has the accessible name `Filter workouts`. It has `aria-expanded`
that reflects whether the controls are visible and `aria-controls` that names
the controls container. The icon is decorative because the button has the
accessible name.

Tapping the button shows the controls directly below the Workout section
header. It does not navigate, open Settings, or write data. The controls use a
native `<fieldset>` and `<legend>` so the message and checkbox group have one
accessible label:

```text
Select workout visibility
[ ] Live
[ ] Draft
[ ] Deprecated
Apply
```

The visual labels are `Live`, `Draft`, and `Deprecated`. When the controls
open, their checkbox values copy the currently applied filter. This permits a
user to make several changes and apply them together.

`Apply` commits the checkbox values to the in-memory applied filter, resets
the workout-list offset to zero, and hides the controls. When the controls are
open, tapping the `tune` button again closes and cancels them. It discards
un-applied checkbox changes and leaves the applied filter unchanged. There is
no separate Cancel control.

An empty selection is valid. It shows no workout rows and displays `No workouts
match the selected visibility.` The active-session and Recent sections do not
change.

## Filtering Behavior

The chooser model receives the applied statuses as a
`ReadonlySet<PublishedStatus>`. It derives the visible workout list with:

```ts
const visible = (input.workouts ?? []).filter((workout) =>
  input.visibleStatuses.has(workout.publishedStatus)
);
```

It applies the filter before `workoutOffset`, `workoutLimit`, and
`workoutsHasMore`. Therefore, an excluded workout never consumes a row or
causes a misleading `Show more workouts` control.

The filter changes only the Workout chooser list. Do not filter:

- `StaticData.workouts` or `workoutById`.
- The static-data loader.
- Session indexes, Active Workout, History, summary, or result resolution.
- The overview screen or `SessionService.start`.

A draft or deprecated workout may still be reached by an existing direct
overview URL and started by the existing start path. This is intentional: the
filter is a display control, not publication authorization.

## Implementation Plan

| Location | Required change |
| --- | --- |
| `schemas/workouts/v1.schema.json:73-78` | Extend the required `publishedStatus` enum to include `draft`. |
| `src/domain/types.ts:333-342` | Extend `PublishedStatus` to `'live' | 'draft' | 'deprecated'`. |
| `src/public/data/workouts.json` | Keep an explicit status on every top-level workout. Authors can set a workout to `draft` when needed. |
| `scripts/build-icon-manifest.ts:53-60` | Add `tune` to `REVIEWED_GLYPHS`, then run `bun run icons:build` to regenerate `src/ui/icons/manifest.json`. |
| `src/ui/viewmodels/chooserModel.ts:81-103,273-298` | Replace the fixed live-only predicate with a required or defaulted `visibleStatuses` input. Filter before pagination and calculate `workoutsHasMore` from the filtered list. Expose enough model state for the empty-selection message. |
| `src/ui/screens/WorkoutChooserScreen.svelte:31-102,121-145` | Hold the applied and pending checkbox state, render the `tune` control and hidden fieldset, pass the applied set to the model, reset `workoutOffset` on Apply, and render the distinct empty-filter message. |
| `src/ui/styles/components.css` | Add the chooser header, icon-button, and fieldset styles. Use existing tokens and native checkbox controls; do not add inline styles. |
| `docs/REQUIREMENTS.md:150-158,203-222,343-385` | Replace live-only visibility wording with the ephemeral three-status chooser filter. State that it does not authorize starts or persist. |
| `docs/ARCHITECTURE.md:146,314-345,362-370` | Replace the fixed live-only chooser rule with the ephemeral applied-status filter and retain the complete lookup rule. |

No changes are permitted in Settings, preferences schemas or factories, merge
code, route parsing or formatting, OAuth return handling, or session-start
authorization.

## Required Tests

1. The workouts schema rejects a missing `publishedStatus` and a value outside
   `live`, `draft`, and `deprecated`.
2. The static-data loader accepts all three status values.
3. The chooser defaults to a visible-status set containing only `live`.
4. The chooser model shows each status only when its status is selected.
5. The chooser model filters before pagination and computes `workoutsHasMore`
   from the filtered list.
6. An empty selected set produces no rows and no `Show more workouts` control.
7. The screen initially hides the controls and renders the accessible `tune`
   button.
8. Tapping the button renders `Select workout visibility`, all three labeled
   checkboxes, and Apply.
9. Checkbox changes do not change rows until Apply.
10. Apply updates the rows, resets the page offset, and hides the controls.
11. Tapping `tune` while controls are open hides them, discards pending changes,
    and leaves the applied filter unchanged.
12. A remounted chooser resets to live-only visibility.
13. Draft and deprecated workouts remain in the complete static lookup and can
    still resolve existing sessions.
14. No preferences document, route, or start-authorization test changes for
    this feature.
