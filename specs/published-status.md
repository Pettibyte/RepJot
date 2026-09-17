# Published Workout Status

## Status

This specification adds a publication status to every workout and a user setting
that controls beta-workout visibility. It changes the v1 `workouts.json` and
`preferences.json` contracts in place. REP JOT has no customer data at v1.
Therefore, neither document family increments `schemaVersion`.

This specification changes the earlier rule that workouts have no lifecycle
field. Where it conflicts with another specification, this document wins.

## Goals

The status controls whether a workout is available to start. It also lets the
workout library retain withdrawn workout definitions for historical display.

The feature has these rules:

- A live workout is visible and can be started.
- A beta workout is visible and can be started only when `showBetaWorkouts` is `true`.
- A deprecated workout is not visible on the landing page and cannot be started.
- A deprecated workout remains in `workouts.json`. It remains available to history,
  summary, and result-resolution code.

This feature applies to workouts only. Exercises have no publication status.

## Data Model

### Workout status

Every workout has a required `publishedStatus` field.

```json
{
  "id": "squat-day-a",
  "name": "Squat Day A",
  "publishedStatus": "live",
  "root": {}
}
```

The allowed values are:

| Value | Meaning |
| --- | --- |
| `beta` | The author makes the workout available for opt-in testing. |
| `live` | The workout is generally available. |
| `deprecated` | The author withdraws the workout from selection but retains its definition. |

`publishedStatus` is required. The static-data author must set it explicitly.
The build rejects a missing or invalid value. Existing bundled workouts must be
updated to use `live` unless the author selects another status.

The status is current static metadata. It is not copied into a session or a
result. Changing a status does not change saved user data.

### Preferences setting

`preferences.json` has a required top-level boolean named `showBetaWorkouts`.
It controls only landing-page visibility for beta workouts.

```json
{
  "format": "repjot/preferences",
  "schemaVersion": 1,
  "revision": 12,
  "updatedAtUtc": "2026-08-15T15:25:00Z",
  "showBetaWorkouts": false,
  "exerciseUnits": {}
}
```

A newly created preferences document sets `showBetaWorkouts` to `false`.
The setting is per user and synchronizes with `preferences.json`.

The setting is one scalar conflict unit. If two devices change it differently,
the value from the client that synchronizes later wins. This rule matches the
existing last-synchronizer-wins policy for preference conflicts.

The setting is independent of `exerciseUnits`. A merge must not lose an
exercise-unit change when another device changes `showBetaWorkouts`.

## Visibility and Access Rules

### Landing page

The authenticated Workout landing page is the chooser for this feature. It
builds its list from the complete validated workout library and applies these
rules before it renders:

| `publishedStatus` | `showBetaWorkouts` | Show on landing page | Start allowed |
| --- | ---: | ---: | ---: |
| `live` | `false` or `true` | Yes | Yes |
| `beta` | `false` | No | No |
| `beta` | `true` | Yes | Yes |
| `deprecated` | `false` or `true` | No | No |

Apply the filter before pagination and before the `Load older` decision. The
control counts only visible workouts. Hidden workouts do not create empty pages
or consume a page slot.

The setting does not change the order of visible workouts. The existing sort
order remains in effect.

### Start authorization

The application must enforce start permission at the start boundary. It must
not rely only on a hidden landing-page item.

Before it creates an `in_progress` session, the application loads the current
workout by ID and evaluates its status with the current preference value. If
the workout is missing, beta while the setting is false, or deprecated, it
must not create a session.

The UI returns to the Workout landing page and shows a clear non-destructive
message. For a beta workout, the message tells the user to enable **Show beta
workouts** in Settings. For a deprecated workout, the message states that the
workout is no longer available to start.

This rule covers stale view state, bookmarked routes, browser history, and a
static-bundle update while a view is open.

### Existing sessions and history

Publication status never hides a saved session. History continues to list
sessions for live, beta, deprecated, and later-missing workouts.

A deprecated workout remains in the complete workout lookup. Its tree can
resolve paths, order recorded work, provide workout names, and support the
existing historical editor.

A user can resume an existing `in_progress` session for a workout that later
becomes beta or deprecated. Resuming does not create a new session. This rule
prevents a static-data update from blocking work that the user already started.

The Active Workout editor for completed or abandoned sessions also remains
available. It follows the existing rule that historical editing uses the current
retained workout tree. It does not create a new session.

If a later release removes a deprecated workout from the bundle, the existing
unresolved-result behavior applies. The application shows stored values and the
error card. This specification does not add a fallback snapshot or a migration.

## Settings UI

Add a **Workout visibility** section to Settings. Place it before **Exercise
Units** and after the data-management sections.

The section contains one labeled checkbox:

```text
Show beta workouts
```

Supporting text states: `Show workouts that are still in beta on the Workout page.`

The checkbox reflects `showBetaWorkouts`. It is unchecked when the setting is
false. A user change saves through the normal local-first preferences path and
uses the normal `Saving`, `Saved`, and `Sync failed` states.

The control is unavailable while preferences cannot load or save. The UI must
not use a temporary default to overwrite an unavailable preferences document.

Changing the setting updates the Workout landing page during the same running
application session. The application must reapply the filter when the user
returns to that page.

REP JOT does not show a status badge on the landing page in this change. A beta
workout becomes visible only after the user requests it. Deprecated workouts
have no Settings control.

## Validation and Read Models

The JSON Schema for `workouts.json` must add this required property to the
workout definition:

```json
"publishedStatus": {
  "enum": ["beta", "live", "deprecated"]
}
```

The JSON Schema for `preferences.json` must add this required property:

```json
"showBetaWorkouts": {
  "type": "boolean"
}
```

The TypeScript `Workout` and `PreferencesDoc` types must contain the same
required fields. The default-document factory must write
`showBetaWorkouts: false`.

The static-data loader keeps two views:

- The complete workout lookup contains every validated workout, including deprecated workouts.
- The chooser list contains only workouts permitted by the visibility rules.

Do not filter the complete lookup. History and result resolution require
retained deprecated definitions.

The preference merge implementation must treat `showBetaWorkouts` as its own
preference mapping. It must include the field in delta detection, conflict
detection, consolidation, and merged output. The informational `revision` and
`updatedAtUtc` rules remain unchanged.

## Schema Version Decision

This change alters the v1 static-workout and user-preference contracts. REP JOT
has no customer documents written at v1. The project will update the v1 schemas,
fixtures, default documents, and bundled workout data together.

Do not create `workouts/v2.schema.json`, `preferences/v2.schema.json`, or a
migration for this change. The version constants remain 1. Later changes after
customer data exists must follow `specs/schema-versioning.md`.

## Required Tests

Add tests for these cases:

1. Static schema validation rejects a workout without `publishedStatus`.
2. Static schema validation rejects each status value outside the enum.
3. Preferences schema validation rejects a missing or non-boolean `showBetaWorkouts`.
4. A new preferences document writes `showBetaWorkouts: false`.
5. The landing page shows live workouts for both preference values.
6. The landing page hides beta workouts when the setting is false.
7. The landing page shows beta workouts when the setting is true.
8. The landing page always hides deprecated workouts.
9. A direct or stale attempt cannot start a hidden beta or deprecated workout.
10. A session for a deprecated workout appears in History and resolves its tree.
11. An existing in-progress session for a deprecated workout can resume.
12. A concurrent unit preference edit and beta-setting edit both survive merge.
13. Two conflicting beta-setting edits use the later synchronizer value.
14. Duplicate-preferences consolidation keeps the `showBetaWorkouts` value from the winning document tuple.

## Related Changes

Update these documents when implementation begins:

- `docs/REQUIREMENTS.md` Sections 6.0, 10.0, 12.0, 17.0, 18.0, 20.0, 21.0, and 22.0.
- `specs/rep-jot-json-schema-spec.md` sections for workouts, preferences, static identity, validation, and ownership.
- `specs/schema-versioning.md` sections that state that workouts have no publication field.
- `specs/storage-and-lookup.md` sections that state that the chooser lists every workout.

The implementation must update the JSON schemas, bundled `workouts.json`,
preferences factory, merge code, settings screen, chooser model, and start
boundary together.
