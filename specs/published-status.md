# Published Workout Status

## Status

This specification adds a publication status to every workout and a hash-route query parameter
that controls draft-workout visibility. It changes the v1 `workouts.json`
contract in place. REP JOT has no customer data at v1. Therefore, the workout
document family does not increment `schemaVersion`.

This specification changes the earlier rule that workouts have no lifecycle
field. Where it conflicts with another specification, this document wins.

## Goals

The status controls whether a workout is available to start. It also lets the
workout library retain withdrawn workout definitions for historical display.

The feature has these rules:

- A live workout is visible and can be started.
- A draft workout is visible and can be started only when the hash-route query contains `showDraft=1`.
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
| `draft` | The author makes the workout available for opt-in testing. |
| `live` | The workout is generally available. |
| `deprecated` | The author withdraws the workout from selection but retains its definition. |

`publishedStatus` is required. The static-data author must set it explicitly.
The build rejects a missing or invalid value. Existing bundled workouts must be
updated to use `live` unless the author selects another status.

The status is current static metadata. It is not copied into a session or a
result. Changing a status does not change saved user data.

### Draft visibility URL

Draft visibility is controlled only by the query portion of the hash route.
For example, `/#/?showDraft=1` shows draft workouts on the Workout landing
page. `showDraft` enables draft visibility only when its value is exactly `1`.
A missing, empty, or other value hides drafts.

The parameter is intentionally an undocumented author/testing control. It is
not stored in `preferences.json`, does not synchronize between devices, and
has no Settings UI. Internal navigation that must retain draft access must
preserve the parameter in the hash route.

## Visibility and Access Rules

### Landing page

The authenticated Workout landing page is the chooser for this feature. It
builds its list from the complete validated workout library and applies these
rules before it renders:

| `publishedStatus` | Hash query has `showDraft=1` | Show on landing page | Start allowed |
| --- | ---: | ---: | ---: |
| `live` | No or yes | Yes | Yes |
| `draft` | No | No | No |
| `draft` | Yes | Yes | Yes |
| `deprecated` | No or yes | No | No |

Apply the filter before pagination and before the `Load older` decision. The
control counts only visible workouts. Hidden workouts do not create empty pages
or consume a page slot.

The query parameter does not change the order of visible workouts. The
existing sort order remains in effect.

### Start authorization

The application must enforce start permission at the start boundary. It must
not rely only on a hidden landing-page item.

Before it creates an `in_progress` session, the application loads the current
workout by ID and evaluates its status with the current hash-route query. If
the workout is missing, is draft without `showDraft=1`, or is deprecated, it
must not create a session.

The UI returns to the Workout landing page and shows a clear non-destructive
message. For a draft workout, the message states that it is not available to
start. For a deprecated workout, the message states that the workout is no
longer available to start.

This rule covers stale view state, bookmarked routes, browser history, and a
static-bundle update while a view is open.

### Existing sessions and history

Publication status never hides a saved session. History continues to list
sessions for live, draft, deprecated, and later-missing workouts.

A deprecated workout remains in the complete workout lookup. Its tree can
resolve paths, order recorded work, provide workout names, and support the
existing historical editor.

A user can resume an existing `in_progress` session for a workout that later
becomes draft or deprecated. Resuming does not create a new session. This rule
prevents a static-data update from blocking work that the user already started.

The Active Workout editor for completed or abandoned sessions also remains
available. It follows the existing rule that historical editing uses the current
retained workout tree. It does not create a new session.

If a later release removes a deprecated workout from the bundle, the existing
unresolved-result behavior applies. The application shows stored values and the
error card. This specification does not add a fallback snapshot or a migration.

REP JOT does not show a status badge or a Settings control for workout
visibility. A draft workout becomes visible only through the hash-route query.

## Validation and Read Models

The JSON Schema for `workouts.json` must add this required property to the
workout definition:

```json
"publishedStatus": {
  "enum": ["draft", "live", "deprecated"]
}
```

The TypeScript `Workout` type must contain the same required field. This
change does not alter `PreferencesDoc`, the preferences schema, or the
default-document factory.

The static-data loader keeps two views:

- The complete workout lookup contains every validated workout, including deprecated workouts.
- The chooser list contains only workouts permitted by the visibility rules.

Do not filter the complete lookup. History and result resolution require
retained deprecated definitions.

## Schema Version Decision

This change alters the v1 static-workout contract. REP JOT has no customer
documents written at v1. The project will update the v1 schema, fixtures, and
bundled workout data together.

Do not create `workouts/v2.schema.json` or a migration for this change. The
version constant remains 1. Later changes after customer data exists must
follow `specs/schema-versioning.md`.

## Required Tests

Add tests for these cases:

1. Static schema validation rejects a workout without `publishedStatus`.
2. Static schema validation rejects each status value outside the enum.
3. The landing page shows live workouts with and without `showDraft=1`.
4. The landing page hides draft workouts without `showDraft=1`.
5. The landing page shows draft workouts with `/#/?showDraft=1`.
6. The landing page always hides deprecated workouts.
7. A direct or stale attempt without `showDraft=1` cannot start a draft workout.
8. A deprecated workout cannot be started with or without `showDraft=1`.
9. A session for a deprecated workout appears in History and resolves its tree.
10. An existing in-progress session for a deprecated workout can resume.

## Related Changes

Update these documents when implementation begins:

- `docs/REQUIREMENTS.md` Sections 6.0, 10.0, 12.0, 17.0, 18.0, 20.0, 21.0, and 22.0.
- `specs/rep-jot-json-schema-spec.md` sections for workouts, static identity, validation, and ownership.
- `specs/schema-versioning.md` sections that state that workouts have no publication field.
- `specs/storage-and-lookup.md` sections that state that the chooser lists every workout.

The implementation must update the workout JSON schema, bundled
`workouts.json`, hash-route handling, chooser model, and start boundary
together.

## Detailed Design

### Status data and complete lookup

Add `publishedStatus` as a required `Workout` property. Its type is the union
`'draft' | 'live' | 'deprecated'`. The schema must require the property and
limit it to those values. Set every currently bundled workout to `live`.

The static loader and all history indexes continue to hold every validated
workout. Status filtering belongs only in the chooser and new-session start
paths. In particular, do not filter `workoutById`, `StaticData.workouts`, or
the session indexes. Those complete views resolve saved sessions for draft and
deprecated workouts.

### Hash-route query model

Treat the fragment as a route path plus a URL query. The control URL is
`/#/?showDraft=1`; its fragment is `#/?showDraft=1`. `showDraft` is true only
when the first `showDraft` query value is exactly `1`. A missing value, an
empty value, or another value is false. Other query parameters are ignored and
are not emitted in canonical internal links.

Add an optional `showDraft?: true` property to route variants. `parseHash`
removes the query before it splits the route path, then adds `showDraft: true`
to the parsed route when enabled. `formatRoute` appends `?showDraft=1` when
that property is true. Consequently, a selected draft links from the chooser
to `#/workouts/<id>?showDraft=1`, and the start boundary receives the same
explicit authorization. `parentRoute` must copy the property to its returned
home route.

The optional property avoids changing every existing route literal. It also
makes links without the parameter canonical and keeps draft access out of
preferences, local storage, and synchronization. The router needs no separate
state because it already republishes a parsed route on each hash change.

### Visibility and new-session authorization

The chooser receives `showDraft` from the current home route. Before offset
and limit are applied, it creates a visible-workout list with this predicate:

```ts
workout.publishedStatus === 'live' ||
(workout.publishedStatus === 'draft' && showDraft)
```

`deprecated` is never visible because it matches neither condition. The
filtered list, not the complete list, supplies both the slice and
`workoutsHasMore`. A draft overview link retains `showDraft`; a live overview
may retain it too, which permits the user to return to the draft-enabled
chooser without a separate state store.

The overview passes the route flag to `SessionService.start(workoutId,
showDraft)`. The service reloads the workout from the complete static map and
allows a new session only for live workouts or a draft with `showDraft` true.
It rejects deprecated workouts regardless of the flag. Existing `load` and
resume paths do not call this authorization check.

On a rejected start, the overview reports the caught safe `AppError` through
`reportError`, then navigates to the home route. The existing shell banner
shows the non-destructive message on that page. The returned home route
retains `showDraft` when it was present. The error text must not disclose the
hidden URL or offer a Settings control.

### Code changes

The line references below are the current locations. They identify each code
change that implements visibility or preserves required historical access.

| Location | Change |
| --- | --- |
| `schemas/workouts/v1.schema.json:66-73` | Add required `publishedStatus` and its three-value enum to `$defs.workout`. |
| `src/domain/types.ts:333-338` | Add the status union and required `Workout.publishedStatus`. |
| `src/public/data/workouts.json:6,208,409,610,814,1015` | Add an explicit status to each bundled top-level workout; use `live` unless an author intentionally selects another value. |
| `src/routing/routes.ts:16-26,95-151,155-197` | Parse and format the hash query, carry `showDraft`, and preserve it in parent routes. Without this change, `#/?showDraft=1` is a not-found route. |
| `src/App.svelte:81-92,141-145,211-214` | Preserve the route query in Back and Workout-tab links; pass `current.showDraft` to the chooser and overview screens. |
| `src/ui/screens/WorkoutChooserScreen.svelte:60-98` | Pass the current route flag to the chooser model while continuing to supply the complete static workout collection. |
| `src/ui/viewmodels/chooserModel.ts:81-103,273-296` | Add `showDraft` input; filter draft and deprecated workouts before pagination; retain the flag in overview hrefs. |
| `src/ui/screens/WorkoutOverviewScreen.svelte:29-52,67-90` | Accept `showDraft`, pass it to `start`, preserve it in the back link, report a rejected start to the shell banner, and return home without creating a session. |
| `src/state/app-state.ts:61-65`; `src/App.svelte:190-203` | Reuse `reportError` and the existing banner for the returned-home rejection message; do not add persistent notice storage. |
| `src/sessions/session-service.ts:93-95,559-599` | Extend `start` with explicit draft authorization and reject a missing, unauthorized draft, or deprecated workout before it creates a shard edit. Do not apply this check to `load` or resume methods. |
| `src/auth/oauth-redirect-adapter.ts:90-95,141-148,351,391-397` | Allow the safe return-route validator to retain the approved hash query so an OAuth round trip does not drop draft visibility. |
| `src/ui/screens/ActiveWorkoutScreen.svelte:1000,1042`; `src/ui/screens/SettingsScreen.svelte:56-61`; `src/ui/screens/NotFoundScreen.svelte:27` | Replace or deliberately retain literal `#/` writers. Normal Workout returns should use `formatRoute({ name: 'home', showDraft: true })` when their originating route has the flag; sign-out may deliberately reset it. |

The following locations are deliberate non-filtering boundaries. Review them
while implementing, but do not remove draft or deprecated definitions there:

| Location | Required behavior |
| --- | --- |
| `src/documents/static-loader.ts:52-60,184-194` | Keep `workouts` and `workoutById` complete. |
| `src/indexes/types.ts:157`; `src/indexes/index-builder.ts:507-519,546-547`; `src/indexes/lookup-service.ts:145` | Keep the complete workout lookup available to History and result resolution. |
| `src/ui/screens/ActiveWorkoutScreen.svelte:121-130` | Continue resolving an existing session through the complete lookup, including a session whose workout is now deprecated. |
| `src/ui/viewmodels/historyModel.ts:221-304`; `src/ui/viewmodels/summaryModel.ts:831` | Continue resolving historical names and trees without status filtering. |

### Tests and fixtures

Add or update the following tests with the status property in every typed
`Workout` fixture:

| Location | Coverage |
| --- | --- |
| `tests/hash-router.test.ts:40-126,188-235` | Parse, format, and navigate `#/?showDraft=1`; verify a route without it remains canonical. |
| `tests/chooserModel.test.ts:40-51,269-333` | Cover live visibility, hidden drafts, enabled drafts, always-hidden deprecated workouts, and filtering before pagination. |
| `tests/phase16-screens.test.ts:207-328` | Cover chooser rendering and a rejected overview start. |
| `tests/session-service.test.ts:102-119,216-240,1070-1120` | Verify draft-without-flag and deprecated starts create no session, an enabled draft starts, and an existing deprecated session remains resumable. |
| `tests/schema-validator.test.ts:19-56`; `tests/fixtures/documents.ts:37-65`; `tests/static-loader.test.ts:18-34,81-104` | Cover missing and invalid status values and keep loaded fixtures schema-valid. |
| `tests/fixtures/semantic.ts:168-303`; `tests/activeWorkoutModel.test.ts:79,387,765,869`; `tests/phase17-round-trip.test.ts:214,466`; `tests/session-service.test.ts:1070,1099`; `tests/tree-resolver.test.ts:16,56`; `tests/overviewModel.test.ts:114,171,323,386` | Add `publishedStatus` to typed workout literals. Review casts in `tests/activeWorkoutModel.test.ts:908,1008,1026,1219` so they do not conceal an invalid fixture. |

Do not hand-edit generated `dist/data/workouts.json` or bundled application
assets. Regenerate them with the normal Bun build after source changes.

## Detailed Design for Live/Deprecated Variant

Yes. The draft variant adds most of the implementation risk and test surface:
query-aware routing, preservation of the query through internal links and OAuth,
and authorization that varies with the current route. If REP JOT needs only
`live` and `deprecated`, remove the draft status and the `showDraft` query
entirely. The feature becomes static metadata with one consistent rule: only
live workouts appear in the Workout chooser.

### Rules

- `publishedStatus` is required and is either `live` or `deprecated`.
- The chooser shows only live workouts. It filters before pagination and before
  the `Show more workouts` decision.
- This variant does not authorize or reject starts. A direct overview route and
  its existing Start Workout action remain unchanged for either status.
- A deprecated workout remains in the complete static lookup. It remains in
  existing sessions, History, summaries, result resolution, and resume paths.
- There is no draft visibility URL, Settings control, preference, OAuth return
  route exception, or query-preservation behavior.

### Implementation

| Location | Change for this variant |
| --- | --- |
| `schemas/workouts/v1.schema.json:66-73` | Require `publishedStatus` with enum `['live', 'deprecated']`. |
| `src/domain/types.ts:333-338` | Add `Workout.publishedStatus: 'live' | 'deprecated'`. |
| `src/public/data/workouts.json:6,208,409,610,814,1015` | Set each bundled workout explicitly to `live` or `deprecated`. |
| `src/ui/screens/WorkoutChooserScreen.svelte:78-92` | Continue passing the complete static collection to the chooser model. No route state is required. |
| `src/ui/viewmodels/chooserModel.ts:81-103,273-296` | Filter `input.workouts` to `publishedStatus === 'live'` before slicing. Use that filtered list for `workouts` and `workoutsHasMore`. Overview hrefs remain the existing canonical routes. |

Do not modify `src/sessions/session-service.ts`,
`src/ui/screens/WorkoutOverviewScreen.svelte`, `src/state/app-state.ts`,
`src/App.svelte`, `src/routing/routes.ts`, `src/routing/hash-router.ts`,
`src/auth/oauth-redirect-adapter.ts`, Settings, preferences, or merge code for
this variant. Start behavior, routing, and error presentation are unchanged.

Keep the complete-lookup boundaries unchanged:
`src/documents/static-loader.ts:52-60,184-194`,
`src/indexes/index-builder.ts:507-519,546-547`,
`src/indexes/lookup-service.ts:145`, and
`src/ui/screens/ActiveWorkoutScreen.svelte:121-130`.

### Tests

Replace the draft-query tests with these focused cases:

1. Schema validation rejects a missing status and values other than `live` or
   `deprecated` (`tests/schema-validator.test.ts:19-56`,
   `tests/fixtures/documents.ts:37-65`).
2. The chooser shows live workouts, hides deprecated workouts, and calculates
   pagination after filtering (`tests/chooserModel.test.ts:40-51,269-333`;
   `tests/phase16-screens.test.ts:207-300`).
3. Add `publishedStatus` to the typed workout fixtures listed in the preceding
   detailed design.

This variant removes the need for hash-router, OAuth, query-retention,
draft-authorization, and start-rejection tests.
