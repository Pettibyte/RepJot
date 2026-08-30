# REP JOT

REP JOT is a lightweight personal fitness tracker. It emphasizes exact workout results and clear exercise history.

## 1.0 Core Concepts

- **1.1** Exercise Directory: stable exercise facts, muscle groups, measurements, and required equipment.
- **1.2** Workout: a retained, ordered tree of containers and exercises.
- **1.3** Results: the actual work completed during a workout session.
- **1.4** User Preferences: per-user unit choices and other settings.

## 2.0 Authentication

- **2.1** The user authenticates with Google OAuth through a full-page implicit redirect in the current window.
- **2.2** REP JOT never opens an authorization popup, tab, or secondary window.
- **2.3** REP JOT requests only `https://www.googleapis.com/auth/drive.appdata`.
- **2.4** The OAuth request state is secure random data with a 30-minute lifetime.
- **2.5** The client keeps the request state in `sessionStorage` and `localStorage` for Kindle redirect continuity.
- **2.6** A successful callback must match an unexpired request state before REP JOT accepts its token.
- **2.7** A 60-second, credential-free receipt makes duplicate Silk callback execution idempotent.
- **2.8** A duplicate callback is valid only when it contains the exact access token that REP JOT already validated and stored.
- **2.9** An unchecked remember choice stores the token in `sessionStorage`.
- **2.10** A checked remember choice stores the token in `localStorage` until its exact expiry.
- **2.11** REP JOT binds every new or restored token to its Drive account before it opens private cached data.
- **2.12** Sign-out clears all token, request-state, response-receipt, and account-selection state.
- **2.13** Disconnect posts the token to Google's revocation endpoint and confirms that Drive rejects it.
- **2.14** Google Identity Services, authorization-code flows, PKCE, popups, and backend token exchange are out of scope.
- **2.15** The application has one basic user role and no elevated user roles.
- **2.16** An administrator changes global data through the source repository and static build.

## 3.0 Data Storage

- **3.1** Global `exercises.json` and `workouts.json` files ship in the static site bundle.
- **3.2** User preferences and results use the authenticated user's Google Drive `appDataFolder`.
- **3.3** User results use monthly files named `results-YYYY-MM.json`.
- **3.4** The `YYYY-MM` shard is the UTC month from `startedAtUtc`.
- **3.5** Every persisted application timestamp uses a `*Utc` field and an RFC 3339 value ending in `Z`.
- **3.6** Local dates, times, and time zones are derived for display only. They never select storage or shard identity.
- **3.7** The application caches user data locally and uses in-memory maps for lookups.
- **3.8** The application does not use SQLite or WebAssembly.
- **3.9** User-created workouts are out of scope. A future version can merge them with system workouts.
- **3.10** See `../specs/storage-and-lookup.md`.

### 4.0 Saving and Synchronization

- **4.1** The application saves edits to local storage before it synchronizes them with Google Drive.
- **4.2** The application debounces normal edits, saves on blur, and flushes pending local edits on `pagehide`.
- **4.3** The UI shows `Saving`, `Saved`, and `Sync failed` states.
- **4.4** A failed Drive synchronization must not discard local edits.
- **4.5** Before upload, the client compares its base copy with the latest Drive metadata and content.
- **4.6** The client automatically performs a three-way merge for nonconflicting changes.
- **4.7** If the same preference changed on both sides, the pending value from the client that synchronizes last wins.
- **4.8** If the same live session changed on both sides, the remote version keeps its ID and the pending local version becomes a labeled sync copy with a new UUID.
- **4.9** REP JOT does not provide a separate conflict-reconciliation UI.

## 5.0 Schema Versioning

- **5.1** Each JSON file declares its document family and integer schema version.
- **5.2** The application loads supported older versions through an ordered migration chain.
- **5.3** The application validates data before and after migration.
- **5.4** Google Drive file upgrades are independent because Drive cannot atomically update multiple files.
- **5.5** See `../specs/schema-versioning.md`.

## 6.0 Static Data Identity

- **6.1** Published exercise, workout, and workout-node IDs are never deleted or reused.
- **6.2** Corrections to labels, instructions, and prescriptions can retain the existing ID and apply to historical views.
- **6.3** An existing ID cannot be repurposed for a different entity or node role.
- **6.4** Published workout nodes cannot move to a different parent because result paths depend on their ancestry.
- **6.5** Deprecated exercises remain resolvable but cannot appear in new workouts.
- **6.6** A new session from an existing workout omits exercises that are already deprecated.
- **6.7** The build reports every workout and scored or timed container affected by a newly deprecated exercise.
- **6.8** If a new session omits a deprecated exercise from a scored container, that effective container becomes detail-only.
- **6.9** The affected container stores `nonstandard` only with complete remaining detail. It provides no aggregate score entry.
- **6.10** If no executable child remains, the affected container is skipped with `reasonCode: "deprecated"`.
- **6.11** A session freezes its effective workout plan when it starts. Later static-data changes do not alter that active session.
- **6.12** Deprecated workouts remain resolvable for history but do not appear in the chooser and cannot start.
- **6.13** The build compares the current bundle with the prior production bundle.
- **6.14** The build fails if a published ID is missing or reused in a different namespace.
- **6.15** The build preserves node type, parent, exercise reference, container strategy, scoring contract, and previously supported measurement units.
- **6.16** The build does not compare complete content hashes, labels, instructions, notes, or prescriptions.
- **6.17** Each exercise result stores its `workoutId` and direct `exerciseId`.

## 7.0 Build, Hosting, and Web Stack

- **7.1** REP JOT is a 100% static site hosted on GitHub Pages.
- **7.2** REP JOT uses Svelte, TypeScript, and Vite.
- **7.3** The build validates TypeScript and publishes to `dist/`.
- **7.4** The build validates static JSON with JSON Schema and semantic cross-file checks.
- **7.5** Bundled code supports the Kindle devices in `../docs/CAPABILITIES-kindle-scribe.md`.

## 8.0 Branding and Styling

- **8.1** The user-facing product name is always `REP JOT`.
- **8.2** The UI uses a high-contrast black, white, and middle-gray theme for e-ink displays.
- **8.3** Shared tokens and centralized CSS define the styling. The implementation does not scatter page-specific CSS.
- **8.4** Controls use zero-radius corners and no shadows, gradients, or blur.
- **8.5** Application actions use Material Symbols.
- **8.6** Fitness taxonomy can use bundled SVG icons.
- **8.7** The application uses styled native HTML controls and no control library.
- **8.8** Every icon-only control has an accessible name.
- **8.9** Interactive elements use semantic links, buttons, and form controls.
- **8.10** See `../design/DESIGN.md`.

## 9.0 Exercise Features

An exercise has:

- **9.1** A stable ID and name.
- **9.2** Instructions imported from `free-exercise-db`.
- **9.3** An optional Material Symbol or bundled SVG icon.
- **9.4** Required equipment.
- **9.5** Primary and secondary muscle groups aligned with the `free-exercise-db` vocabulary.
- **9.6** Force, mechanics, category, movement pattern, and laterality as separate concepts.
- **9.7** One or more controlled measurement dimensions and compatible units.
- **9.8** Load semantics that distinguish total load, per-implement load, added load, and assistance.
- **9.9** An optional `deprecated` lifecycle flag.

## 10.0 Workout Features

- **10.1** A workout is an ordered tree of containers and exercises.
- **10.2** Top-level prescription fields apply to every iteration.
- **10.3** An `iterations` entry overrides only the fields that it contains for its one-based iteration.
- **10.4** Each iteration number appears at most once in one prescription.
- **10.5** An override for a finite repeated container stays within that container's configured iteration count.
- **10.6** Containers support sequence, fixed rounds, AMRAP, EMOM, and scored complexes.
- **10.7** Containers can nest to represent warmup, strength, HIIT, active recovery, and deeper structures.
- **10.8** Results identify every repeated ancestor through an execution path.
- **10.9** EMOM programming uses cycles and interval duration. It does not use the ambiguous term `rounds`.
- **10.10** A complex can record one container score while its component exercises do not record separate results.
- **10.11** AMRAP and EMOM containers can record a container score and optional detailed exercise results.
- **10.12** `rounds_and_reps` is valid only for deterministic sequences of repetition-based leaf exercises.
- **10.13** Aggregate-only entry stores the container score without child results.
- **10.14** Expanding an aggregate pre-populates complete child results from the score and workout order.
- **10.15** After expansion, child results are authoritative and every edit recomputes the container score.
- **10.16** If detailed work does not follow valid round progression, the container uses a `nonstandard` score and the UI displays `Detailed`.
- **10.17** A kettlebell complex does not require a synthetic exercise for every movement combination.

## 11.0 Result Features

- **11.1** Results capture actual values, including all differences from prescribed values.
- **11.2** Blank input means no result. Zero repetitions means an actual unsuccessful attempt.
- **11.3** Exercise results store `workoutId`, direct `exerciseId`, and the workout-node reference.
- **11.4** Skipped and incomplete results use a controlled reason-code enum. Free text belongs in notes.
- **11.5** Unilateral results identify `left`, `right`, `both`, or `alternating` sides.
- **11.6** `left` and `right` store repetitions for that side. `both` stores simultaneous repetitions. `alternating` stores total repetitions across sides and identifies the starting side.
- **11.7** The UI shows alternating results as total and per-side values, such as `10 total / 5 each` or `9 total / 5 left / 4 right`.
- **11.8** Results store explicit units.
- **11.9** Sessions have `in_progress`, `completed`, or `abandoned` status.
- **11.10** Several sessions can be in progress at the same time.
- **11.11** Back navigation from an active workout saves it as `in_progress`.
- **11.12** The user can explicitly abandon or delete an unfinished workout.
- **11.13** Abandoned workouts remain in History until the user deletes them.
- **11.14** Session deletion writes a permanent tombstone so that stale devices cannot restore it.
- **11.15** If work is missing, Finish Workout offers `Return to workout` and `Finish as incomplete`.
- **11.16** Completed and abandoned sessions can be edited with the Active Workout editor.
- **11.17** Historical editing uses the current retained workout tree and overlays recorded results by execution path.
- **11.18** Historical editing does not persist an `executionPlan` for terminal sessions.
- **11.19** Editing preserves the session status and UTC workout timestamps while it saves result corrections.
- **11.20** Release one does not permit edits to persisted timestamps.
- **11.21** Every session has `updatedAtUtc`, which changes after each saved correction.
- **11.22** New session IDs use a collision-resistant UUID and do not encode workout time.
- **11.23** A sync copy preserves the session status and timestamps, records the original session ID, and appears in History with a `Sync copy` label.
- **11.24** The user can inspect, edit, or delete either copy with the normal session screens.

## 12.0 User Preferences

- **12.1** User preferences use a versioned `preferences.json` document.
- **12.2** Preferences store the preferred unit for each exercise.
- **12.3** The Settings screen lists the exercise-to-unit mappings.
- **12.4** Tapping an exercise unit pill switches between compatible units, converts entered values, and updates the preference.
- **12.5** Conversion uses full precision internally and rounds the editable display to the nearest `0.1` in the selected unit.
- **12.6** Display rounding does not change the full-precision saved value unless the user edits the displayed number.
- **12.7** Each saved result retains its explicit value and unit until the user edits that result.
- **12.8** Preference synchronization merges different exercise and dimension mappings automatically.
- **12.9** For a conflicting mapping, the pending value from the client that synchronizes last wins without prompting.
- **12.10** Settings provides downloads for all raw files in `appDataFolder`.
- **12.11** Settings provides a separate download of the recent local diagnostic log for support.
- **12.12** Diagnostic events never synchronize to Drive and never contain tokens, notes, measurements, or canonical document content.

## 13.0 Data Seeding

- **13.1** Source exercise data comes from the local `yuhonas/free-exercise-db` repository.
- **13.2** A transformation script and allowlist produce the curated REP JOT exercise directory.
- **13.3** REP JOT retains the source muscle vocabulary.
- **13.4** The transformation defines curated values absent from the source, including laterality, movement pattern, and measurements.
- **13.5** Source `body only` maps to no equipment. A source `null` value requires equipment curation before publication.

## 14.0 Production Readiness

- **14.1** The public home page describes REP JOT and links to its privacy policy.
- **14.2** The application uses separate Google OAuth projects for testing and production.
- **14.3** Production OAuth uses owned, verified domains and secure HTTPS origins.
- **14.4** REP JOT requests only the non-sensitive `drive.appdata` scope.
- **14.5** The privacy policy explains how REP JOT accesses, stores, uses, exports, and deletes Google user data.
- **14.6** REP JOT uses local browser storage only for authentication, user-requested features, and the local data cache.
- **14.7** The privacy policy discloses required local storage. Nonessential storage requires consent before use.
- **14.8** REP JOT provides a secure process for data-access and deletion requests.
- **14.9** REP JOT maintains security and breach-response procedures for consumer health data.
- **14.10** Launch readiness includes a legal review of consumer-health privacy and breach-notification duties.
- **14.11** A later release can add screenshots and feature callouts.

## 15.0 UI

- **15.1** The application UI supports workout selection, execution, history, preferences, and data export. Workout and exercise authoring remain development-time tasks.
- **15.2** Mockup screenshots and HTML in `../design/**` are guidance only. `../design/DESIGN.md` and this document are authoritative.

### 16.0 Authenticated Navigation

- **16.1** Tab-root screens use the REP JOT header and the Workout, History, and Settings tabs.
- **16.2** Detail and task screens use a compact Back header without the tab bar.
- **16.3** Active Workout uses the compact Back header to reduce accidental navigation.

### 17.0 Choose Workout

- **17.1** The authenticated landing screen shows active workouts with title and last completion date.
- **17.2** A `Load older` control loads more workouts when necessary.
- **17.3** Recent shows up to five completed or abandoned sessions, newest first.
- **17.4** All in-progress sessions appear above Recent, sorted by `updatedAtUtc`, newest first.
- **17.5** An in-progress entry shows its start time today or its date on an earlier day.
- **17.6** Tapping an in-progress entry resumes it.

### 18.0 Workout Overview

- **18.1** Workout Overview renders the programmed tree and prescriptions.
- **18.2** Start Workout creates an `in_progress` session and records its start time.

### 19.0 Active Workout

- **19.1** Active Workout renders the programmed tree with clear styling for its first three levels.
- **19.2** Deeper content shows a compact named path, such as `Strength / Complex / Round 2`.
- **19.3** Each exercise has a tappable Last Time badge linked to Exercise History.
- **19.4** Last Time uses the latest completed session, shows actual values and units, and ignores the active session.
- **19.5** The UI shows `No history` when an exercise has no completed result.
- **19.6** A unit pill displays the exercise unit and updates its preference when tapped.
- **19.7** AMRAP provides a large `+` control to add one completed round quickly.
- **19.8** The UI also supports partial rounds and optional exercise details.
- **19.9** The UI provides appropriate controls for repetitions, weight, duration, distance, calories, EMOM, effort, and extra attempts.
- **19.10** Finish Workout appears at the end of the workout.

### 20.0 History and Summary

- **20.1** Workout History uses `Load older` and shows completed, in-progress, and abandoned states.
- **20.2** Workout History does not show an aggregate workout-volume metric.
- **20.3** Workout Summary shows all recorded work, units, attempts, status, and container scores.
- **20.4** Exercise History uses `Load older` and sorts results newest first.
- **20.5** History dates include the year when the event is not in the current year.

### 21.0 Settings

- **21.1** Settings contains Data Export and Exercise Units sections.
- **21.2** Settings contains text "For non-commercial use only. For commercial licensing, Contact Pettibyte LLC."
- **21.3** Settings provides a confirmed, irreversible `Delete All User Data` action.
- **21.4** Delete All User Data removes recognized files from `appDataFolder` and clears the account's local cache and pending edits.
- **21.5** Settings provides a separate `Disconnect Google Account` action.
- **21.6** Disconnect revokes the Google OAuth grant, signs out of REP JOT, and clears the local account cache.
- **21.7** If in-app revocation cannot complete, REP JOT links to Google Account connections.
