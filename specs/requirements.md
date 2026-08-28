# REP JOT

REP JOT is a lightweight personal fitness tracker. It emphasizes exact workout results and clear exercise history.

## Core Concepts

- Exercise Directory: stable exercise facts, muscle groups, measurements, and required equipment.
- Workout: a retained, ordered tree of containers and exercises.
- Results: the actual work completed during a workout session.
- User Preferences: per-user unit choices and other settings.

## Authentication

- The user authenticates with Google OAuth.
- The application has one basic user role and no elevated user roles.
- An administrator changes global data through the source repository and static build.

## Data Storage

- Global `exercises.json` and `workouts.json` files ship in the static site bundle.
- User preferences and results use the authenticated user's Google Drive `appDataFolder`.
- User results use monthly files named `results-YYYY-MM.json`.
- The `YYYY-MM` shard is the UTC month from `startedAtUtc`.
- Every persisted application timestamp uses a `*Utc` field and an RFC 3339 value ending in `Z`.
- Local dates, times, and time zones are derived for display only. They never select storage or shard identity.
- The application caches user data locally and uses in-memory maps for lookups.
- The application does not use SQLite or WebAssembly.
- User-created workouts are out of scope. A future version can merge them with system workouts.
- See `storage-and-lookup.md`.

### Saving and Synchronization

- The application saves edits to local storage before it synchronizes them with Google Drive.
- The application debounces normal edits, saves on blur, and flushes pending local edits on `pagehide`.
- The UI shows `Saving`, `Saved`, and `Sync failed` states.
- A failed Drive synchronization must not discard local edits.
- Before upload, the client compares its base copy with the latest Drive metadata and content.
- The client automatically performs a three-way merge for nonconflicting changes.
- If the same preference changed on both sides, the pending value from the client that synchronizes last wins.
- If the same live session changed on both sides, the remote version keeps its ID and the pending local version becomes a labeled sync copy with a new UUID.
- REP JOT does not provide a separate conflict-reconciliation UI.

## Schema Versioning

- Each JSON file declares its document family and integer schema version.
- The application loads supported older versions through an ordered migration chain.
- The application validates data before and after migration.
- Google Drive file upgrades are independent because Drive cannot atomically update multiple files.
- See `schema-versioning.md`.

## Static Data Identity

- Published exercise, workout, and workout-node IDs are never deleted or reused.
- Corrections to labels, instructions, and prescriptions can retain the existing ID and apply to historical views.
- An existing ID cannot be repurposed for a different entity or node role.
- Published workout nodes cannot move to a different parent because result paths depend on their ancestry.
- Deprecated exercises remain resolvable but cannot appear in new workouts.
- A new session from an existing workout omits exercises that are already deprecated.
- The build reports every workout and scored or timed container affected by a newly deprecated exercise.
- If a new session omits a deprecated exercise from a scored container, that effective container becomes detail-only.
- The affected container stores `nonstandard` only with complete remaining detail. It provides no aggregate score entry.
- If no executable child remains, the affected container is skipped with `reasonCode: "deprecated"`.
- A session freezes its effective workout plan when it starts. Later static-data changes do not alter that active session.
- Deprecated workouts remain resolvable for history but do not appear in the chooser and cannot start.
- The build compares the current bundle with the prior production bundle.
- The build fails if a published ID is missing or reused in a different namespace.
- The build preserves node type, parent, exercise reference, container strategy, scoring contract, and previously supported measurement units.
- The build does not compare complete content hashes, labels, instructions, notes, or prescriptions.
- Each exercise result stores its `workoutId` and direct `exerciseId`.

## Build, Hosting, and Web Stack

- REP JOT is a 100% static site hosted on GitHub Pages.
- REP JOT uses Svelte, TypeScript, and Vite.
- The build validates TypeScript and publishes to `dist/`.
- The build validates static JSON with JSON Schema and semantic cross-file checks.
- Bundled code supports the Kindle devices in `../docs/CAPABILITIES-kindle-scribe.md`.

## Branding and Styling

- The user-facing product name is always `REP JOT`.
- The UI uses a high-contrast black, white, and middle-gray theme for e-ink displays.
- Shared tokens and centralized CSS define the styling. The implementation does not scatter page-specific CSS.
- Controls use zero-radius corners and no shadows, gradients, or blur.
- Application actions use Material Symbols.
- Fitness taxonomy can use bundled SVG icons.
- The application uses styled native HTML controls and no control library.
- Every icon-only control has an accessible name.
- Interactive elements use semantic links, buttons, and form controls.
- See `../design/DESIGN.md`.

## Exercise Features

An exercise has:

- A stable ID and name.
- Instructions imported from `free-exercise-db`.
- An optional Material Symbol or bundled SVG icon.
- Required equipment.
- Primary and secondary muscle groups aligned with the `free-exercise-db` vocabulary.
- Force, mechanics, category, movement pattern, and laterality as separate concepts.
- One or more controlled measurement dimensions and compatible units.
- Load semantics that distinguish total load, per-implement load, added load, and assistance.
- An optional `deprecated` lifecycle flag.

## Workout Features

- A workout is an ordered tree of containers and exercises.
- Top-level prescription fields apply to every iteration.
- An `iterations` entry overrides only the fields that it contains for its one-based iteration.
- Each iteration number appears at most once in one prescription.
- An override for a finite repeated container stays within that container's configured iteration count.
- Containers support sequence, fixed rounds, AMRAP, EMOM, and scored complexes.
- Containers can nest to represent warmup, strength, HIIT, active recovery, and deeper structures.
- Results identify every repeated ancestor through an execution path.
- EMOM programming uses cycles and interval duration. It does not use the ambiguous term `rounds`.
- A complex can record one container score while its component exercises do not record separate results.
- AMRAP and EMOM containers can record a container score and optional detailed exercise results.
- `rounds_and_reps` is valid only for deterministic sequences of repetition-based leaf exercises.
- Aggregate-only entry stores the container score without child results.
- Expanding an aggregate pre-populates complete child results from the score and workout order.
- After expansion, child results are authoritative and every edit recomputes the container score.
- If detailed work does not follow valid round progression, the container uses a `nonstandard` score and the UI displays `Detailed`.
- A kettlebell complex does not require a synthetic exercise for every movement combination.

## Result Features

- Results capture actual values, including all differences from prescribed values.
- Blank input means no result. Zero repetitions means an actual unsuccessful attempt.
- Exercise results store `workoutId`, direct `exerciseId`, and the workout-node reference.
- Skipped and incomplete results use a controlled reason-code enum. Free text belongs in notes.
- Unilateral results identify `left`, `right`, `both`, or `alternating` sides.
- `left` and `right` store repetitions for that side. `both` stores simultaneous repetitions. `alternating` stores total repetitions across sides and identifies the starting side.
- The UI shows alternating results as total and per-side values, such as `10 total / 5 each` or `9 total / 5 left / 4 right`.
- Results store explicit units.
- Sessions have `in_progress`, `completed`, or `abandoned` status.
- Several sessions can be in progress at the same time.
- Back navigation from an active workout saves it as `in_progress`.
- The user can explicitly abandon or delete an unfinished workout.
- Abandoned workouts remain in History until the user deletes them.
- Session deletion writes a permanent tombstone so that stale devices cannot restore it.
- If work is missing, Finish Workout offers `Return to workout` and `Finish as incomplete`.
- Completed and abandoned sessions can be edited with the Active Workout editor.
- Historical editing uses the current retained workout tree and overlays recorded results by execution path.
- Historical editing does not persist an `executionPlan` for terminal sessions.
- Editing preserves the session status and UTC workout timestamps while it saves result corrections.
- Release one does not permit edits to persisted timestamps.
- Every session has `updatedAtUtc`, which changes after each saved correction.
- New session IDs use a collision-resistant UUID and do not encode workout time.
- A sync copy preserves the session status and timestamps, records the original session ID, and appears in History with a `Sync copy` label.
- The user can inspect, edit, or delete either copy with the normal session screens.

## User Preferences

- User preferences use a versioned `preferences.json` document.
- Preferences store the preferred unit for each exercise.
- The Settings screen lists the exercise-to-unit mappings.
- Tapping an exercise unit pill switches between compatible units, converts entered values, and updates the preference.
- Conversion uses full precision internally and rounds the editable display to the nearest `0.1` in the selected unit.
- Display rounding does not change the full-precision saved value unless the user edits the displayed number.
- Each saved result retains its explicit value and unit until the user edits that result.
- Preference synchronization merges different exercise and dimension mappings automatically.
- For a conflicting mapping, the pending value from the client that synchronizes last wins without prompting.
- Settings provides downloads for all raw files in `appDataFolder`.
- Settings provides a separate download of the recent local diagnostic log for support.
- Diagnostic events never synchronize to Drive and never contain tokens, notes, measurements, or canonical document content.

## Data Seeding

- Source exercise data comes from the local `yuhonas/free-exercise-db` repository.
- A transformation script and allowlist produce the curated REP JOT exercise directory.
- REP JOT retains the source muscle vocabulary.
- The transformation defines curated values absent from the source, including laterality, movement pattern, and measurements.
- Source `body only` maps to no equipment. A source `null` value requires equipment curation before publication.

## Production Readiness

- The public home page describes REP JOT and links to its privacy policy.
- The application uses separate Google OAuth projects for testing and production.
- Production OAuth uses owned, verified domains and secure HTTPS origins.
- REP JOT requests only the non-sensitive `drive.appdata` scope.
- The privacy policy explains how REP JOT accesses, stores, uses, exports, and deletes Google user data.
- REP JOT uses local browser storage only for authentication, user-requested features, and the local data cache.
- The privacy policy discloses required local storage. Nonessential storage requires consent before use.
- REP JOT provides a secure process for data-access and deletion requests.
- REP JOT maintains security and breach-response procedures for consumer health data.
- Launch readiness includes a legal review of consumer-health privacy and breach-notification duties.
- A later release can add screenshots and feature callouts.

## UI

The application UI supports workout selection, execution, history, preferences, and data export. Workout and exercise authoring remain development-time tasks.

Mockup screenshots and HTML in `../design/**` are guidance only. `../design/DESIGN.md` and this document are authoritative.

### Authenticated Navigation

- Tab-root screens use the REP JOT header and the Workout, History, and Settings tabs.
- Detail and task screens use a compact Back header without the tab bar.
- Active Workout uses the compact Back header to reduce accidental navigation.

### Choose Workout

- The authenticated landing screen shows active workouts with title and last completion date.
- A `Load older` control loads more workouts when necessary.
- Recent shows up to five completed or abandoned sessions, newest first.
- All in-progress sessions appear above Recent, sorted by `updatedAtUtc`, newest first.
- An in-progress entry shows its start time today or its date on an earlier day.
- Tapping an in-progress entry resumes it.

### Workout Overview

- Workout Overview renders the programmed tree and prescriptions.
- Start Workout creates an `in_progress` session and records its start time.

### Active Workout

- Active Workout renders the programmed tree with clear styling for its first three levels.
- Deeper content shows a compact named path, such as `Strength / Complex / Round 2`.
- Each exercise has a tappable Last Time badge linked to Exercise History.
- Last Time uses the latest completed session, shows actual values and units, and ignores the active session.
- The UI shows `No history` when an exercise has no completed result.
- A unit pill displays the exercise unit and updates its preference when tapped.
- AMRAP provides a large `+` control to add one completed round quickly.
- The UI also supports partial rounds and optional exercise details.
- The UI provides appropriate controls for repetitions, weight, duration, distance, calories, EMOM, effort, and extra attempts.
- Finish Workout appears at the end of the workout.

### History and Summary

- Workout History uses `Load older` and shows completed, in-progress, and abandoned states.
- Workout History does not show an aggregate workout-volume metric.
- Workout Summary shows all recorded work, units, attempts, status, and container scores.
- Exercise History uses `Load older` and sorts results newest first.
- History dates include the year when the event is not in the current year.

### Settings

- Settings contains Data Export and Exercise Units sections.
- Settings provides a confirmed, irreversible `Delete All User Data` action.
- Delete All User Data removes recognized files from `appDataFolder` and clears the account's local cache and pending edits.
- Settings provides a separate `Disconnect Google Account` action.
- Disconnect revokes the Google OAuth grant, signs out of REP JOT, and clears the local account cache.
- If in-app revocation cannot complete, REP JOT links to Google Account connections.
