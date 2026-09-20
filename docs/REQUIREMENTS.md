# REP JOT

REP JOT is a lightweight personal fitness tracker. It emphasizes exact workout results and clear exercise history.

> **REVISED PROPOSAL (v4).** Section 6.0 and Section 13.0 are rewritten here for a much simpler
> exercise-data pipeline. Section 22.0 records every decision, including the four settled on
> 2026-09-11. Accepted changes are applied in place in Sections 3.0 through 21.0.
> No other document changed. After agreement, the `specs/` documents follow this file.

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

### Local storage façade

- **3.11** The application accesses local storage through one small key-to-value façade. The façade exposes `get(name)`, `set(name, value)`, `delete(name)`, and one transactional `setMany` operation.
- **3.12** No application-data module calls the IndexedDB API directly. Every application-data document passes through the façade.
- **3.13** The façade stores whole JSON documents keyed by logical file name. It performs no query, no index, and no partial update.
- **3.14** The transactional `setMany` write is a requirement, not a convenience. One save writes a cached document, its base copy, and its pending delta. These three writes land together or not at all. Section 22.3 lists the merge artifacts only. It does not replace this rule.
- **3.15** The façade keeps the storage engine swappable. A move from IndexedDB to another key-value store changes the façade only. No sync code changes.
- **3.16** The application does not persist derived lookup indexes. It rebuilds them at startup.

### Ordering rule

- **3.17** Never derive display order from object key iteration. JavaScript iterates integer-like keys first, in ascending numeric order, ahead of string keys. `{ "2": a, "1": b }` iterates as `1, 2`.
- **3.18** A `Record` key must never be integer-like. REP JOT IDs carry a non-numeric prefix, such as `session-`, for this reason.
- **3.19** Sort in the read model on explicit fields. Use `startedAtUtc` and `updatedAtUtc`. Do not rely on insertion order surviving a merge.
- **3.20** Prescriptive sequence lives in `workouts.json`, where arrays are correct and stay arrays. A session stores no sequence. Result order comes from `executionPath` resolved against the workout tree.

### Façade scope

- **3.21** Authentication state is outside the façade. The `sessionStorage` and `localStorage` use required by Section 2.5, Section 2.9, and Section 2.10 stays direct. The façade governs application data documents only.

## 4.0 Saving and Synchronization

REP JOT supports several devices for one account. The merge model stays. The implementation leans on `jsondiffpatch` instead of hand-written merge code.

- **4.1** The application saves edits to local storage before it synchronizes them with Google Drive.
- **4.2** The application debounces normal edits, saves on blur, and flushes pending local edits on `pagehide`.
- **4.3** The UI shows `Saving`, `Saved`, and `Sync failed` states.
- **4.4** A failed Drive synchronization must not discard local edits.
- **4.5** The client keeps a base copy of each Drive document in IndexedDB. The base copy is the content from the last successful synchronization.
- **4.6** Before upload, the client reads the latest Drive content and compares it with its base copy. This preflight is a requirement for the merge in Section 4.7.
- **4.7** The conflict unit is one top-level keyed entry. For results, the unit is one session. For preferences, the unit is one exercise-and-dimension mapping. REP JOT does not merge inside a conflicted unit.
- **4.8** A conflict exists when the local delta and the remote delta both touch any path under the same conflict unit. Two different sessions never conflict. Two different preference mappings never conflict.
- **4.9** The client merges with `jsondiffpatch`. It computes a local delta (base to local) and a remote delta (base to remote), applies the remote delta to the base, then applies the local delta.
- **4.10** The client stores sessions in a map keyed by session ID. It stores preference mappings in a map keyed by exercise ID and dimension. Keyed maps keep deltas independent of array position. REP JOT does not store sessions or preference mappings as arrays.
- **4.11** The last device to synchronize wins. On a conflict, the client replaces the merged entity with its own local version in full. It does not field-merge a conflicted session. It does not prompt.
- **4.12** A local edit beats a remote delete. When the remote removed a session that the local side still edits, the local version wins and the session returns with local content. This follows from Section 4.11 and needs no special case.
- **4.13** REP JOT creates no sync copy. A conflict does not mint a new session ID and adds no label. See Section 11.23.
- **4.14** REP JOT does not provide a separate conflict-reconciliation UI.
- **4.15** The client persists the base copy and the pending local delta. A page reload can therefore finish a merge that started before the reload.

### Concurrency limit and retry

- **4.16** The Section 4.6 preflight reduces the race window. It does not close it. Another device can write between the preflight read and the upload.
- **4.17** The Google Drive `files.update` operation provides no conditional write. REP JOT verified that the v3 REST reference defines no `If-Match` compare-and-set for file content. REP JOT must not assume one exists.
- **4.18** After upload, the client reads the file back and confirms that the content matches what it wrote.
- **4.19** On a mismatch or an upload error, the client re-reads the remote file, re-runs the merge from a fresh base, and re-uploads. It retries at most three times.
- **4.20** After three failed attempts, the client shows `Sync failed` and keeps every pending local edit. Per Section 4.4, it discards nothing.
- **4.21** REP JOT accepts the residual race between the final read-back and a simultaneous write from another device. The last writer wins and the loser detects the mismatch on its next sync.

### Duplicate Drive files

Drive permits two files with the same name. REP JOT clears a duplicate recognized name automatically. It never ignores one and it never asks the user to choose a file.

- **4.22** A duplicate exists when the `appDataFolder` catalog holds more than one file with the same recognized name. The client treats the whole set as one duplicate group.
- **4.23** The client consolidates a group only when every copy parses, declares the correct family, uses a supported schema version, and passes semantic validation. A group that holds a corrupt, wrong-family, or unsupported copy stays blocked. The `DataError` component names the file and offers **View Raw JSON**, and pending local edits stay durable.
- **4.24** Consolidation keeps every distinct session and every distinct preference mapping found in the group. When one session ID, or one exercise-and-dimension mapping, appears in more than one copy, the client keeps the value from the copy with the greatest `(updatedAtUtc, Drive file ID)` tuple. The rule makes cleanup deterministic when Drive holds no shared base document. Normal synchronization still follows Section 4.11.
- **4.25** The client writes the consolidated document to one primary file, reads that primary back, and confirms the consolidated data. Only then does it delete the redundant files by stable Drive file ID. It lists the name again before it records one remaining file ID locally.
- **4.26** A copy that changes during cleanup blocks the group, and the client retries on the next synchronization. The client never deletes a file whose content the primary does not already hold.

## 5.0 Schema Versioning

The migration scaffolding stays. REP JOT must keep the ability to change a schema later and still read existing user data.

- **5.1** Each JSON file declares its document family and integer schema version.
- **5.2** The application keeps one migration chain per document family. Each step maps one version to the next version.
- **5.3** Version 1 registers an empty chain. The scaffolding must work before any migration exists.
- **5.4** The application validates data before and after each migration step.
- **5.5** The application rejects a version newer than its highest supported version. It shows the data error UI and offers **View Raw JSON**. It never writes to a newer-version file.
- **5.6** Migrations run in memory on read. The application writes only the current version, and only through the normal save path in Section 4.0.
- **5.7** Google Drive file upgrades are independent because Drive cannot atomically update multiple files.
- **5.8** See `../specs/schema-versioning.md`.
- **5.9** A release MAY ship a new schema version without the migration step for the prior version. This is permitted, not a violation of Section 5.2. Old data then shows the data error UI and stays readable through the export in Section 12.10.
- **5.10** The migration chain is how REP JOT closes that gap later. A migration written after the fact still applies, because the old file keeps its declared version.

## 6.0 Static Data Identity

REP JOT treats published exercise and workout data as editable facts. It is not an immutable ledger. REP JOT has one user, who edits this data by hand. See Section 13.0 for how the build produces exercise data.

### IDs

- **6.1** An exercise ID is the `id` string from `free-exercise-db`. REP JOT does not mint, register, reserve, or renumber exercise IDs.
- **6.2** A workout ID and a workout-node ID are short strings that the author writes by hand in `workouts.json`.
- **6.3** IDs are plain strings. REP JOT stores no content hash, checksum, digest, provenance record, or snapshot reference for any static entity.
- **6.4** The build does not download a prior production bundle. It does not diff IDs. It enforces no immutability rule and no backwards-compatibility rule.
- **6.5** Any release may add, rename, re-parent, re-spec, or remove an exercise, a workout, or a workout node.
- **6.6** Each exercise result stores its `workoutId`, its direct `exerciseId`, and its execution path. Those strings are the only link from a result to static data.

### Unresolved references

- **6.7** Static data can change under a stored result. REP JOT handles that case in the UI and stops there.
- **6.8** The UI shows an error card in its place for each of these cases. The card names the unresolved reference.
  - A stored result references an unknown exercise ID.
  - A stored result references an unknown workout ID.
  - A stored result has a broken execution path. Any ancestor node in the path is missing from the current workout tree.
  - A stored result has a path that resolves to a node whose exercise differs from the `exerciseId` recorded on the result.
- **6.9** The error card provides a **View Raw JSON** action. It opens the stored result JSON with no interpretation.
- **6.10** One unresolved reference must not break its page, its list, the sync loop, or any other result.
- **6.11** REP JOT never auto-migrates a result, never substitutes a similar exercise, and never rewrites a stored result to repair a reference.
- **6.12** The user resolves an unresolved reference by editing the result, or by restoring the ID to the static data.
- **6.23** Recorded work renders from the session's own stored data. Each result carries its `exerciseId`, `executionPath`, values, and units. The app does not need the current workout tree to *display* recorded work. It needs the tree only to order and edit it. When the tree cannot resolve a path, the view falls back to the recorded values and sorts by the `executionPath` string. See Section 20.3.

### Workout publication status

- **6.13** Every workout has a required `publishedStatus` field with the value `live` or `deprecated`. Exercises have no publication-status field.
- **6.14** An exercise appears in selection when the allowlist lists it. Removing it from the allowlist removes it from selection.
- **6.15** The workout chooser hides only workouts whose `publishedStatus` is `deprecated`. It shows every `live` workout.
- **6.16** The complete workout lookup retains `deprecated` workouts for session resolution, history, summary, and historical editing. Publication status does not change session or result data.
- **6.17** Publication status adds no start authorization, routing, Settings, or preferences behavior. REP JOT performs no deprecation report, affected-container analysis, or `nonstandard` fallback for a removed exercise. No session stores an `executionPlan`. An in-progress session resolves its tree from the current bundle on each load.
- **6.18** A deploy during an active workout can change that workout. The user restarts the session or edits the result afterward. REP JOT accepts this risk.

### Build validation

- **6.19** The build validates `exercises.json` and `workouts.json` against their JSON Schemas.
- **6.20** The build rejects a duplicate node ID within one workout. Node IDs are scoped to their workout. The same node ID MAY appear in two different workouts.
- **6.21** The build rejects a workout node whose `exerciseId` is missing from `exercises.json`.
- **6.22** The build performs no other cross-file or cross-release check on static identity.

## 7.0 Build, Hosting, and Web Stack

- **7.1** REP JOT is a 100% static site hosted on GitHub Pages.
- **7.2** REP JOT uses Svelte, TypeScript, and Vite.
- **7.3** The build validates TypeScript and publishes to `dist/`.
- **7.4** The build validates static JSON with JSON Schema and the three checks in Section 6.19, Section 6.20, and Section 6.21. It performs no other semantic lint pass.
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
- **9.9** Exercises have no lifecycle flag. Presence in the allowlist controls selection.
- **9.10** A new result defaults its side from the exercise's `laterality`: `alternating` for a unilateral exercise, `both` for a bilateral exercise. This does not change prescription or stored-result semantics.
- **9.11** Side choice is a capability, not a consequence of the default. The side control is reachable when the exercise is unilateral **or** when it loads per implement, because either shape lets the sides be worked apart. A bilateral exercise with one shared load -- a barbell, a bodyweight hold, a rowing machine -- records `both` only and shows no side control.

## 10.0 Workout Features

- **10.1** A workout is an ordered tree of containers and exercises with a required `publishedStatus` of `live` or `deprecated`. See Section 6.13.
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
- **10.14** Expanding an aggregate produces a **draft** child set. The app derives each draft value from the container score and the workout prescription.
- **10.15** A derived draft value is not recorded actual work. A rounds-and-reps score cannot establish actual load, unit, side, or deviation from prescription. The UI labels every draft value `Inferred` before the user saves.
- **10.16** A draft value becomes recorded actual work only when the user saves it. The saved value carries the explicit value and unit that the user saw, per Section 11.8.
- **10.17** After expansion and save, child results are authoritative and every edit recomputes the container score.
- **10.18** If detailed work does not follow valid round progression, the container uses a `nonstandard` score and the UI displays `Detailed`.
- **10.19** A kettlebell complex does not require a synthetic exercise for every movement combination.

## 11.0 Result Features

- **11.1** Results capture actual values, including all differences from prescribed values.
- **11.2** Blank input means no result. Zero repetitions means an actual unsuccessful attempt.
- **11.3** Exercise results store `workoutId`, direct `exerciseId`, and the workout-node reference.
- **11.4** Skipped and incomplete results use a controlled reason-code enum. Free text belongs in notes.
- **11.5** A side-selectable result identifies `left`, `right`, `both`, or `alternating` sides. See Section 9.11 for which exercises are side-selectable.
- **11.6** `left` and `right` store repetitions for that side. `both` stores simultaneous repetitions. `alternating` stores total repetitions across sides and identifies the starting side.
- **11.7** The UI shows alternating results as total and per-side values, such as `10 total / 5 each` or `9 total / 5 left / 4 right`.
- **11.8** Results store explicit units.
- **11.9** Sessions have `in_progress`, `completed`, or `abandoned` status.
- **11.10** Several sessions can be in progress at the same time.
- **11.11** Back navigation from an active workout saves it as `in_progress`.
- **11.12** The user can explicitly abandon or delete an unfinished workout.
- **11.13** Abandoned workouts remain in History until the user deletes them.
- **11.14** Session deletion removes the session from its shard. REP JOT writes no tombstone. A stale device that synchronizes later can restore a deleted session, and the user deletes it again.
- **11.15** If work is missing, Finish Workout offers `Return to workout` and `Finish as incomplete`.
- **11.16** Completed and abandoned sessions can be edited with the Active Workout editor.
- **11.17** Historical editing uses the current retained workout tree and overlays recorded results by execution path.
- **11.18** No session stores an `executionPlan`, in progress or terminal. Every view resolves the tree from the current bundle. See Section 6.17.
- **11.19** Editing preserves the session status and UTC workout timestamps while it saves result corrections.
- **11.20** Workout timestamps are immutable in release one. `startedAtUtc` and `completedAtUtc` never change after they are written.
- **11.21** `updatedAtUtc` is system-managed and is not covered by Section 11.20. The application sets it on every saved write. The user cannot edit it.
- **11.22** New session IDs use the prefix `session-` followed by a collision-resistant UUID v4. The prefix is required by Section 3.18. The ID does not encode workout time.
- **11.23** REP JOT creates no sync copy. A merge conflict resolves under Section 4.9 without a new session ID and without a label.
- **11.24** History shows one entry per session ID. No entry carries a `conflictOfSessionId` field.

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
- **12.12** Diagnostic events never synchronize to Drive. The log never contains an OAuth token or an authorization header. REP JOT keeps at most 200 events in memory and drops the oldest. REP JOT applies no salting, no aliasing, no per-account retention schedule, and no persistence for the log.

## 13.0 Data Seeding

One list drives everything. The list says which exercises to copy. The script copies, trims, and adds curated fields. It makes no other promise.

- **13.1** Source data is `dist/exercises.json` from `yuhonas/free-exercise-db`: one flat array of 876 exercise objects. Each object has a stable string `id`, such as `Barbell_Bench_Press`.
- **13.2** One input drives generation: `scripts/exercise-allowlist.json`. It lists the source exercise IDs that REP JOT publishes.
- **13.3** `bun run seed` reads the source, keeps allowlisted entries, and writes `src/public/data/exercises.json`.
- **13.4** The script copies these source fields verbatim: `id`, `name`, `instructions`, `category`, `force`, `mechanic`, `level`, `primaryMuscles`, and `secondaryMuscles`. The script treats `equipment` as a copied *default*, not as a verbatim field. See Section 13.16.
- **13.5** The script drops every other source field, including `images`.
- **13.6** The script adds the curated fields that the source lacks: `movementPattern`, `laterality`, `measurements`, `loadSemantics`, and `icon`.
- **13.7** A bare allowlist entry copies the exercise and applies the defaults in Section 13.16.
- **13.16** Curated defaults. A bare entry gets all of these. Any of them may be replaced by an object entry.
  - `laterality`: `bilateral`
  - `movementPattern`: `none`
  - `loadSemantics`: `total`
  - `measurements`: one dimension, `reps`, with unit `reps`
  - `icon`: none
  - `equipment`: the source value, normalized under Section 13.19, with `body only` mapped to no equipment
- **13.8** An object allowlist entry copies the exercise and applies the listed curated overrides. All curated data lives in the allowlist, keyed by source ID.
- **13.9** The script is deterministic. The same source commit and the same allowlist produce identical output.
- **13.10** The script does not hash its output. It does not diff against a prior bundle. It does not preserve removed entries. It makes no backwards-compatibility promise.
- **13.11** The script fails when an allowlist ID is absent from the source. It also fails when an object entry sets a curated field to an invalid value. Every curated field has a default under Section 13.16, so no curated field is required in a bare entry. The script fails loudly at build time.
- **13.12** The script pins the source by git commit, so a re-run reads the same input.
- **13.13** Source `body only` maps to no equipment. A source `null` equipment value fails the build unless the allowlist supplies an override.
- **13.14** REP JOT keeps the source muscle vocabulary. It does not remap muscle names.
- **13.15** To change published exercise data, edit the allowlist and re-run the seed script. No other path writes `exercises.json`.
- **13.17** `bun run seed:bump` advances the pinned source commit and rewrites `exercises.json`. The allowlist stays unchanged. A bump that breaks a curated override fails the build and reports the offending ID. The command resolves the new commit, fetches the source, and validates the whole generated document before it writes anything. A failed bump changes neither the pinned commit nor `exercises.json`.
- **13.22** The production build validates static data before it packages the site. `bun run build` runs the schema check and `seed:check` first. A stale or invalid `exercises.json` fails the build instead of reaching `dist/`. This satisfies Section 6.19 and Section 7.4 for exercise data.
- **13.23** A measurement list holds one entry per dimension. The schema `uniqueItems` check rejects an identical repeated entry. The seed rejects a repeated dimension name that carries different unit lists.
- **13.18** The pinned commit lives in the seed script configuration. The author reviews the diff before commit. REP JOT never auto-updates the source.
- **13.19** The equipment vocabulary is closed. `$defs.equipmentValue` in `schemas/exercises/v1.schema.json` owns the list. Every value in the list is lower case and singular. The script reads the list from the schema, so the validator and the seed cannot drift apart.
- **13.20** The script normalizes every equipment value before it writes, whether the value came from the source or from an override. It trims the value, collapses inner whitespace to one space, forces lower case, and takes the singular form. It then matches the result against the vocabulary. `Kettlebells`, `KETTLEBELLS`, and `kettlebells` all write `kettlebell`. `bands` writes `band`.
- **13.21** The script fails when a normalized equipment value falls outside the vocabulary. The error names the raw value, the normalized value, and the schema field to edit. The script also fails when the vocabulary itself holds a value that is not lower case and singular, or lists `body only`.

Example allowlist shape:

```json
[
  "Barbell_Bench_Press",
  "Barbell_Squat",
  {
    "id": "Weighted_Pull_Up",
    "laterality": "bilateral",
    "movementPattern": "vertical_pull",
    "loadSemantics": "added",
    "measurements": [{ "dimension": "weight", "units": ["kg", "lb"] }]
  }
]
```

## 14.0 Production Readiness

- **14.1** The public home page describes REP JOT and links to its privacy policy.
- **14.2** REP JOT uses one Google OAuth project for development and production. Test traffic appears in the production project.
- **14.3** Production OAuth uses owned, verified domains and secure HTTPS origins.
- **14.4** REP JOT requests only the non-sensitive `drive.appdata` scope.
- **14.5** The privacy policy explains how REP JOT accesses, stores, uses, exports, and deletes Google user data.
- **14.6** REP JOT uses local browser storage only for authentication, user-requested features, and the local data cache.
- **14.7** The privacy policy discloses required local storage. Nonessential storage requires consent before use.
- **14.8** REP JOT provides a secure process for data-access and deletion requests.
- **14.9** A formal consumer-health legal review and a formal breach-response procedure are out of scope. All REP JOT data stays in the user's own Google Drive `appDataFolder`, so REP JOT is not a data controller for third-party health data.
- **14.10** A later release can add screenshots and feature callouts.

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
- **19.11** A Last Time badge carries a control that copies the values it shows into the sets it covers. A badge on one row fills that row. A badge over an exercise fills every set of that exercise. The control does not appear when the exercise has no history.

### 20.0 History and Summary

- **20.1** Workout History uses `Load older` and shows completed, in-progress, and abandoned states.
- **20.2** Workout History does not show an aggregate workout-volume metric.
- **20.3** Workout Summary shows all recorded work, units, attempts, status, and container scores. The Summary renders from the session's own stored results and does not require the current workout tree. See Section 6.23.
- **20.4** Exercise History uses `Load older` and sorts results newest first.
- **20.5** History dates include the year when the event is not in the current year.

### 21.0 Settings

- **21.1** Settings contains Data Export and Exercise Units sections.
- **21.2** Settings contains text "For non-commercial use only. For commercial licensing, Contact Pettibyte LLC."
- **21.3** Settings provides a confirmed `Delete All User Data` action. The action deletes every recognized REP JOT file from `appDataFolder` and clears this device's local cache and pending edits.
- **21.4** The UI does not claim the deletion is irreversible. It warns that another device with pending edits can re-create files on its next sync, and that the user must not sync other devices afterward. REP JOT has no way to reach a stale device's cache.
- **21.5** Settings provides a separate `Disconnect Google Account` action.
- **21.6** Disconnect revokes the Google OAuth grant, signs out of REP JOT, and clears the local account cache.
- **21.7** If in-app revocation cannot complete, REP JOT links to Google Account connections.

## 22.0 Simplification Decision Record

REP JOT is a single-user hobby tool. The decisions below remove machinery that protects against cases REP JOT does not have: many users, untrusted data edits, and third-party consumers of the data. Multi-device support is **not** one of those cases, so the merge model stays.

### 22.1 Applied in Section 6.0 and Section 13.0

| Decision | Removes |
| --- | --- |
| Exercise ID equals the `free-exercise-db` source ID | ID registry, ID minting, ID collision policy |
| Allowlist-driven seed script | Ad-hoc exercise authoring, second write path for `exercises.json` |
| No prior-bundle diff | Bundle download step, ID diff, immutability gate |
| No hashes or provenance | Checksum fields, provenance records, content digests |
| Workout `publishedStatus` is limited to chooser visibility | Deprecation reports, affected-container analysis, `nonstandard` fallback for removals |
| No `executionPlan` freeze | Plan snapshot per session, plan cleanup on completion |
| Unresolved ID shows an error card | Per-case recovery logic, substitution heuristics |

### 22.2 Decisions on further simplifications

| Item | Decision | Where applied |
| --- | --- | --- |
| 22.2.1 Drop schema migration chains | **Rejected.** Scaffolding stays. Version 1 registers an empty chain. | Section 5.0 rewritten |
| 22.2.2 Drop three-way merge | **Rejected.** Multi-device support stays. `jsondiffpatch` implements the merge. | Section 4.5–4.9 |
| 22.2.3 Drop sync copies | **Accepted.** A three-way merge does not need them. | Section 4.10, Section 11.23, Section 11.24 |
| 22.2.4 Drop session tombstones | **Accepted.** | Section 11.14 |
| 22.2.5 Drop the Drive metadata preflight | **Rejected.** The preflight feeds the merge. | Section 4.6 |
| 22.2.6 Drop the diagnostic ring buffer spec | **Accepted.** Bounded in-memory log only. | Section 12.12 |
| 22.2.7 Drop separate test and production OAuth projects | **Accepted.** One project. | Section 14.2 |
| 22.2.8 Downgrade the legal review | **Accepted.** | Section 14.9 |
| 22.2.9 Reduce cross-file build checks | **Accepted.** Three checks only. | Section 7.4 |
| 22.2.10 One error UI for all data problems | **Accepted.** One `DataError` component. | Section 6.8–6.9, Section 5.5 |

### 22.2a Decisions settled 2026-09-11

| Question | Decision | Where applied |
| --- | --- | --- |
| Same session changed on two devices: who wins? | **Last syncer wins.** The local pending version replaces the merged entity in full. | Section 4.7–4.11 |
| One device deletes, another holds an unsynced edit? | **Edit wins.** The session returns with local content. | Section 4.12, Section 22.5 |
| Seed strictness on a bare allowlist entry? | **Permissive.** Concrete defaults defined for every curated field. | Section 13.7, Section 13.16, Section 13.11 |
| What does `Delete All User Data` promise? | **Weakened.** No irreversibility claim. Warns about other devices. | Section 21.3, Section 21.4 |

### 22.3 Why sync copies are not needed

A sync copy solves a problem REP JOT no longer has: two live versions of one session that both must survive. Under the Section 4.9 rule, the local pending change wins and the session keeps one ID and one version. The merge still needs three things in memory, and only two of them persist:

| Copy | Purpose | Persisted? |
| --- | --- | --- |
| Base | Content at last successful sync | Yes, IndexedDB |
| Local pending delta | Unsynced local edits | Yes, IndexedDB, as a `jsondiffpatch` delta |
| Remote | Latest content read from Drive | No, in memory only |

This table lists the three merge inputs only. It excludes the working cached document. Section 3.14 governs persistence and still requires the cached document, the base copy, and the pending delta to land in one atomic write.

The remote copy is transient. REP JOT never stores a second session document, never mints a `Sync copy` UUID, and never renders a `Sync copy` label.

### 22.4 Keyed maps are a hard requirement for the merge

`jsondiffpatch` diffs arrays by index. A concurrent insert or delete shifts indexes, so an index-based delta can land on the wrong element after a merge. Verified against the library: keyed-object maps produce deltas that are independent of position.

- **22.4.1** Store sessions as `Record<sessionId, Session>`, not as an array.
- **22.4.2** Store preference mappings as `Record<exerciseId, Record<dimension, unit>>`, not as an array.
- **22.4.3** Do not use array `matchBy` workarounds. Keyed maps remove the problem instead of patching it.
- **22.4.4** Exercise results inside a session use a composite key, not an array. The key is `executionPath` + `|` + `side` + `|` + `attempt`. Container results use `executionPath` + `|` + `attempt`. An earlier draft allowed arrays here on the assumption that one device owns a session at a time. That assumption is false: the user can edit a completed session on any device, and `jsondiffpatch` diffs inside the session object too. Index drift reaches a nested array exactly as it reaches a top-level array.
- **22.4.6** Composite key encoding. Path segments join with `/`. A repeated-container segment carries `:<iteration>`, one-based. The field separator is `|`. Example: `root/squat-sets:3/back-squat-set|both|1`. An ID segment must not contain `/`, `|`, or `:`. The build enforces this rule on every equipment, exercise, workout, and node ID.
- **22.4.9** A session uses two result maps, one per kind: `exerciseResults` keyed `<path>|<side>|<attempt>`, and `containerResults` keyed `<path>|<attempt>`. Two maps beat one mixed map because the key shapes stay unambiguous and no `type` discriminator is needed. The result value keeps its structured `executionPath` array, and the key derives from it. Loader and build validation reject a key that does not match its value. The structured path stays in the document because the user reads raw JSON to debug.
- **22.4.7** Composite key defaults. `side` defaults to `both`. `attempt` defaults to `1`. The app always writes both parts into the key, even at their defaults, so a key never changes shape later.
- **22.4.8** Composite keys are strings. They never become integer-like, so Section 3.17 and Section 3.18 hold for them too.
- **22.4.5** Apply the ordering rule in Section 3.17 through Section 3.20 to every keyed map. Keyed maps remove index drift; they do not preserve order. Order comes from the workout tree and from explicit timestamps.

### 22.5 Accepted failure modes

- A stored result can reference a removed exercise ID, a removed node, a broken path, or a path that now points to a different exercise. The UI shows an error card and the raw JSON.
- A deploy during an active workout can change that workout.
- A local delete plus a remote edit resolves to the edit. The session returns. The user deletes it again on the device that still shows it.
- The last device to synchronize wins a same-session conflict. The other device's newer edit is discarded without a prompt or a copy.
- A residual write race exists between the final read-back and a simultaneous write. The loser detects it on its next sync.
- A schema bump can make old data unreadable in-app until a migration step exists. The raw JSON stays readable through the export in Section 12.10. Section 5.9 permits this.
- `Delete All User Data` does not reach other devices. A stale device can re-create files. Section 21.4 warns about this instead of promising irreversibility.

### 22.6 Kept unchanged

Monthly result shards (Section 3.3, Section 3.4), UTC-only persisted timestamps (Section 3.5, Section 3.6), Google OAuth with the `drive.appdata` scope (Section 2.0), explicit units on every stored result (Section 11.8, Section 12.5–12.7), execution paths on results (Section 11.3), and local-first save with `Saving` / `Saved` / `Sync failed` (Section 4.1–4.4).

### 22.7 Follow-up work after agreement

1. ~~Rewrite `specs/storage-and-lookup.md`.~~ Done. Plan freezing, tombstones, and the prior-bundle comparison are gone. The merge and the keyed-map shapes from Section 22.4 are specified.
2. ~~Update `specs/schema-versioning.md`.~~ Done. The chain stays, with the empty-chain-at-v1 rule and the newer-version rejection rule.
3. ~~Update `specs/rep-jot-json-schema-spec.md`.~~ Done. Sessions, preferences, and both result kinds are keyed maps on the composite keys in Section 22.4.4 and Section 22.4.9. `executionPlan`, `sessionTombstones`, and `conflictOfSessionId` are gone.
4. ~~Add `scripts/seed-exercises.ts` and `scripts/exercise-allowlist.json`.~~ Done. `bun run seed`, `bun run seed:check`, and `bun run seed:bump` implement `specs/exercise-seeding.md`. The pinned source commit lives in `scripts/seed-config.json`. The allowlist entry schema is `schemas/seed-allowlist/v1.schema.json`.
5. Remove the obsolete `deprecated` field from the exercise schema and every reference to it in code and mockups. Workout `publishedStatus` remains required under Section 6.13.
6. Add the `DataError` component and the **View Raw JSON** screen.
7. Add `jsondiffpatch` as a dependency and confirm its bundle size against the Kindle budget in `docs/CAPABILITIES-kindle-scribe.md`.
8. Implement the local storage façade from Section 3.11 through Section 3.16. Keep it under about 50 lines and keep IndexedDB behind it.
9. ~~Rewrite `schemas/exercises/v1.schema.json`, `schemas/workouts/v1.schema.json`, `schemas/preferences/v1.schema.json`, and `schemas/results/v1.schema.json` to match the v4 contract in `specs/rep-jot-json-schema-spec.md`.~~ Done. The pre-v4 model is gone: `sessions` is a keyed map, `sessionTombstones`, `executionPlan`, `conflictOfSessionId`, and the `deprecated` result reason code are removed. The `identifier` pattern bans `/`, `|`, and `:` per Section 22.4.6. `bun run check:schemas` now reads these files with `ajv`.
10. ~~Add the `movementPattern` value `none` and the `level` field to `schemas/exercises/v1.schema.json` when item 9 runs.~~ Done with item 9. The exercise schema also drops the top-level equipment registry and `equipmentIds` for the single `equipment` string or `null` field in Section 13.16, and uses the `reps` unit spelling from the spec.
11. ~~Write the seed specification for Section 13.0. No spec covers the pinned source commit, the seed defaults in Section 13.16, the strictness rules in Section 13.11, the `seed:bump` command in Section 13.18, or the output path `src/public/data/exercises.json`. Item 4 cannot be built correctly until this exists.~~ Done. `specs/exercise-seeding.md` covers all of it, and item 4 is built against that spec.
12. Specify the raw-file export in Section 12.10. `specs/schema-versioning.md` cites it as the user-facing escape hatch but never defines it. Only the diagnostic-log download is specified today.

### 22.8 Notes on the spec update

- `preferences.json` keeps its `revision` field. Under delta merge it is informational only. It never selects a migration and never resolves a conflict. REP JOT keeps it for diagnostics rather than pretend it protects anything. Object the writer if you want it gone.
- The exercise result `type` and container result `type` discriminators are gone. The map name carries the kind.
- `startingSide` is not part of the composite key. One alternating result exists per path, side, and attempt.
- Node ID uniqueness is scoped per workout, per Section 6.20. The same node ID MAY appear in two workouts. The composite key stays unique because a key always lives inside one session, and one session has one workout.
