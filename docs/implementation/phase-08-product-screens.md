# Phase 8 execution plan: product screens

## 1. Mission

Implement every required REP JOT product screen with the Phase 7 shell and Phase 6 facades. Complete all normal and destructive user flows without adding mockup-only behavior.

The phase is complete when acceptance fixtures cover workout selection, overview, active execution, summary, both histories, Settings, every result type and status, sync copies, export, diagnostics, deletion, and disconnect.

## 2. Authority and required reading

Read these sources before editing:

- `AGENTS.md`.
- `docs/REQUIREMENTS.md`, Sections 8 through 12 and 15 through 21.
- `docs/ARCHITECTURE.md`, Sections 2, 4, 6 through 17, 19 Phase 8, and 20.
- `specs/rep-jot-json-schema-spec.md`, workouts, preferences, results, and all invariants.
- `specs/storage-and-lookup.md`, Stored Result Identity, Loading Policy, User Data Deletion, and Failure and Recovery.
- `specs/Day-of Workout Execution UI — Design Brief.md`, in full, as lower-authority interaction guidance.
- `design/DESIGN.md`, in full.
- All HTML/PNG mockups under `design/`, as guidance only.
- Phase 7 shared components/routes and Phase 6/5 application facades.

Apply Architecture Section 2 precedence. Requirements and architecture override all mockup conflicts. Do not add `Forge`, workout volume, global active-workout tabs, similar-workout Last Time, remote assets, effects, or hover-only actions.

Binding decisions:

- UI code calls application facades only. It never calls `fetch`, Drive, repositories, or IndexedDB.
- Use one vertical document for active execution.
- Show the first three tree levels clearly. Show deeper levels as a compact named path.
- Last Time is the latest completed session for that exercise. Ignore the active session.
- Programmed defaults remain temporary until blur.
- Save normal edits with debounce, on blur, before route change, and on pagehide request.
- `Saved` means durable in IndexedDB. It does not mean synchronized to Drive.
- Finish with missing work offers `Return to workout` and `Finish as incomplete`.
- Active Back preserves `in_progress`. Abandon and delete are explicit.
- Completed and abandoned sessions use the same editor but preserve terminal state.
- No reconciliation screen exists. Sync copies use normal screens and a `Sync copy` label.
- History includes completed, in-progress, and abandoned sessions. It shows no aggregate workout volume.
- Raw export includes unknown appData files. Diagnostics export is separate.
- Delete All User Data requires exact typed text `DELETE ALL USER DATA`.
- Disconnect is separate from data deletion and keeps fallback behavior.

Use Bun and TypeScript only. Keep Svelte/Vite, static `dist/`, ES2019, Kindle constraints, local assets, and hash routes. Use no SQLite, WebAssembly, optional chaining, or nullish coalescing in the bundle. Use `REP JOT` in all user-facing branding.

## 3. Starting-state contract

Expected outputs:

- Phase 7 provides tested route outlets, headers, tabs, controls, status, errors, tokens, and local icons/fonts.
- Phase 6 provides immutable screen view models and session/history facades.
- Phase 5 provides sync, export, delete, diagnostics, and account-data services.
- Phase 4 provides auth actions and revocation fallback through facades.

Run all prior tests. For each screen, inspect the facade contract before writing Svelte. If a required action is absent, add it at the application boundary with domain tests. Do not import an adapter into a screen.

If approved production workout content remains absent, use repository fixtures for acceptance tests. Do not invent launch content. Phase 9 drafts `/privacy.html`, and the human release owner approves it. Do not invent other legal claims in product screens.

## 4. In scope and out of scope

### In scope

- Authenticated Choose Workout, Workout Overview, Active Workout, Workout Summary, Workout History, Exercise History, and Settings.
- Anonymous landing integration from Phase 7.
- All result entry controls, status paths, notes, units, attempts, sides, scores, incomplete/skip flows, and history links.
- Debounce/blur/pagehide save controllers.
- Raw export, diagnostic download/clear, exercise units, delete-all, sign-out, switch, disconnect, and revocation fallback UI.
- Product-level accessibility and Kindle-oriented layout tests.

Primary requirement IDs: 9.1-9.9 presentation, 10.1-10.17 presentation, 11.1-11.24 UI, 12.3-12.12 UI, 15.1-15.2, 17.1-17.6, 18.1-18.2, 19.1-19.10, 20.1-20.5, and 21.1-21.7. Requirement 3.9 keeps user-created workouts out of scope.

### Out of scope

- Workout/exercise authoring, analytics, social, coaching, charts, gamification, and aggregate workout volume.
- A conflict-resolution or duplicate-repair screen.
- Timestamp editing.
- Service worker, Web Share, Wake Lock, custom keyboard, gestures, or canvas controls.
- Production release approval and manual Kindle evidence.
- Requirement 14.11 screenshots and feature callouts, which are explicitly deferred to a later release.

Phase 8 can add presentation adapters for Blob/object-URL downloads and local date formatting. These adapters must contain no domain decisions.

## 5. Required deliverables

| Deliverable | Recommended path | Architecture link | Source control |
| --- | --- | --- | --- |
| Choose screen | `src/ui/screens/ChooseWorkoutScreen.svelte` | Sections 7, 13, 17, and 19 Phase 8 | Yes |
| Overview | `src/ui/screens/WorkoutOverviewScreen.svelte` | Sections 7, 13, 17, and 20 | Yes |
| Active editor | `src/ui/screens/ActiveWorkoutScreen.svelte`, components under `src/ui/workout/` | Sections 7, 13, 17, and 20 | Yes |
| Summary | `src/ui/screens/WorkoutSummaryScreen.svelte` | Sections 13, 17, and 20 | Yes |
| Histories | `WorkoutHistoryScreen.svelte`, `ExerciseHistoryScreen.svelte` | Sections 13, 17, and 20 | Yes |
| Settings | `src/ui/screens/SettingsScreen.svelte`, components under `src/ui/settings/` | Sections 10, 15, 17, and 20 | Yes |
| Save controller | `src/ui/controllers/edit-save-controller.ts` | Sections 13, 16, and 20 | Yes |
| Download adapter | `src/ui/adapters/browser-download-adapter.ts` | Sections 14 and 15 | Yes |
| Formatting | `src/ui/formatters/*.ts` | Sections 8 and 13 | Yes |
| Acceptance tests | `tests/ui/product-screens.test.ts`, focused screen tests, and `tests/ui/product-flow.integration.test.ts` | Sections 17 and 19 Phase 8 | Yes |

Do not commit generated downloads, screenshots with personal data, or test reports. Sanitized static screenshots can be review artifacts only if the repository policy explicitly tracks them.

## 6. Ordered execution tasks

- [ ] **P8-T01 — Define screen view contracts and product acceptance fixtures**
  - **Objective:** Cover every result type, status, route, and destructive flow before screen implementation.
  - **Prerequisites:** Phases 5-7 complete.
  - **Inspect:** Facade exports, route table, schemas, and all product requirement IDs.
  - **Create or edit:** `tests/fixtures/product/`, `tests/ui/product-screens.test.ts`, and screen view-model types if needed.
  - **Steps:** Build sanitized fixtures for nested workouts, prescriptions, all measurements, effort, attempts, unilateral results, AMRAP, EMOM, complex scores, notes, skips, incomplete work, three session statuses, tombstones, and sync copies.
  - **Edge cases:** Deep tree, no history, deprecated omission, current-tree terminal addition, missing optional data, and future-file blocked state.
  - **Tests or fixtures:** Use deterministic dates, clocks, UUIDs, and facades. No real user data.
  - **Validation:** `bun test tests/ui/product-screens.test.ts`; `bun run check`.
  - **Acceptance:** A traceability table in test names or fixtures reaches every Phase 8 requirement. Fixtures pass schema and semantic validation.

- [ ] **P8-T02 — Implement Choose Workout**
  - **Objective:** Show available workouts, all active sessions, and five recent terminal sessions.
  - **Prerequisites:** P8-T01.
  - **Inspect:** Requirements 17 and authoritative navigation rules.
  - **Create or edit:** `src/ui/screens/ChooseWorkoutScreen.svelte` and focused tests.
  - **Steps:** Use the tab-root shell. List nondeprecated workouts with title and latest completion date. Put all in-progress sessions above Recent, newest `updatedAtUtc` first. Show today time or prior date. Resume active entries. Add five through `Load older` where applicable.
  - **Edge cases:** No workouts, deprecated workout, no history, several active shards, equal timestamps, abandoned recent, and unavailable older data.
  - **Tests or fixtures:** Assert ordering, labels, target semantics, and five-record increments.
  - **Validation:** `bun test tests/ui/choose-workout-screen.test.ts`; `bun run check`.
  - **Acceptance:** Every active session appears. Deprecated workouts cannot start. The screen uses no mockup thumbnails or remote assets.

- [ ] **P8-T03 — Implement Workout Overview and durable start**
  - **Objective:** Show the programmed tree and start one locally durable session.
  - **Prerequisites:** P8-T02.
  - **Inspect:** Requirements 18 and Phase 6 session facade.
  - **Create or edit:** `src/ui/screens/WorkoutOverviewScreen.svelte`, shared read-only tree components, and tests.
  - **Steps:** Use compact Back header. Render structure, strategies, prescriptions, notes, and scored rules read-only. On Start, call the facade once, wait for local commit, then navigate to active route.
  - **Edge cases:** Deprecated workout, secure-random failure, storage failure, repeated activation, slow save, and deep tree.
  - **Tests or fixtures:** Add save barrier and double-action prevention tests.
  - **Validation:** `bun test tests/ui/workout-overview-screen.test.ts`; `bun run check`.
  - **Acceptance:** Navigation cannot occur before durable creation. Failure keeps the overview and shows a safe recovery action.

- [ ] **P8-T04 — Build the active workout hierarchy and core result controls**
  - **Objective:** Render one vertical editor for nested work and all measurement types.
  - **Prerequisites:** P8-T03.
  - **Inspect:** Requirements 19.1-19.10, design brief Active Workout, and Phase 7 components.
  - **Create or edit:** `src/ui/screens/ActiveWorkoutScreen.svelte`, components under `src/ui/workout/`, and tests.
  - **Steps:** Use compact Back header with no tabs. Style first three levels distinctly. Show deeper named paths. Render native labeled controls for reps, weight, duration, distance, calories, effort, reasons, attempts, EMOM, sides, and notes. Put Finish at document end.
  - **Edge cases:** Empty optional name, very deep path, keyboard input, no touch, long notes, alternating odd reps, added attempt, and control font failure.
  - **Tests or fixtures:** Assert semantic labels, input modes, keyboard use, focus order, and no custom controls.
  - **Validation:** `bun test tests/ui/active-workout-screen.test.ts`; `bun run check`; `bun run build`; `bun run check:compat`.
  - **Acceptance:** Every schema-supported result and notes scope has a usable control. Core use does not depend on glyphs, touch, hover, Grid, or animation.

- [ ] **P8-T05 — Connect local save timing and truthful status**
  - **Objective:** Debounce normal edits and save immediately at durability boundaries.
  - **Prerequisites:** P8-T04.
  - **Inspect:** Requirements 4.1-4.4, Architecture exact status meanings, and Phase 6 save facade.
  - **Create or edit:** `src/ui/controllers/edit-save-controller.ts`, Active screen integration, and tests.
  - **Steps:** Keep temporary text until a save action. Debounce normal updates. Save on blur and before route changes. Start the permitted local flush on pagehide without promising completion. Show `Saving`, `Saved`, sync pending detail, and `Sync failed` accurately.
  - **Edge cases:** Rapid input, blur during debounce, route during save, storage quota, sync error after local success, pagehide, and retry.
  - **Tests or fixtures:** Use fake clocks and save barriers. Assert no `Saved` before local transaction completion.
  - **Validation:** `bun test tests/ui/edit-save-controller.test.ts tests/ui/active-workout-screen.test.ts`; `bun run check`.
  - **Acceptance:** Local failure keeps text and shows recovery. Drive failure never discards locally durable edits.

- [ ] **P8-T06 — Add Last Time, units, and scored-container interactions**
  - **Objective:** Integrate compact history, unit conversion, and AMRAP/EMOM/complex entry.
  - **Prerequisites:** P8-T04 and P8-T05.
  - **Inspect:** Requirements 12.4-12.7 and 19.3-19.9.
  - **Create or edit:** Active components for Last Time, unit pills, score controls, and tests.
  - **Steps:** Show latest completed values/units or `No history`. Link badge to Exercise History. Toggle only compatible units and persist preference. Keep full precision through the facade. Add a large AMRAP `+` round control, partial rounds, optional detail expansion, EMOM intervals, and complex cycles.
  - **Edge cases:** Active latest occurrence, abandoned latest, no completed history, small conversion shown `0.0`, score expansion, invalid progression, detail-only deprecated container, and sync failure.
  - **Tests or fixtures:** Assert completed-only lookup, link route, conversion drift behavior, score recomputation, and `Detailed` label.
  - **Validation:** `bun test tests/ui/active-workout-score.test.ts tests/ui/active-workout-history.test.ts`; `bun run check`.
  - **Acceptance:** Last Time ignores the active session. Unit and score interactions produce validated local saves through facades.

- [ ] **P8-T07 — Implement finish, incomplete, abandon, delete, and terminal editing**
  - **Objective:** Complete every session lifecycle action with explicit destructive choices.
  - **Prerequisites:** P8-T05 and P8-T06.
  - **Inspect:** Requirements 11.9-11.24 and Architecture Workout-Session Lifecycle.
  - **Create or edit:** Active screen action panels/dialog alternatives, confirmation components, and tests.
  - **Steps:** On missing work, offer exact `Return to workout` and `Finish as incomplete` actions. Finish or abandon through the facade. Keep Back as `in_progress`. Confirm deletion, then tombstone. For terminal routes, reuse the editor, label state, preserve status/timestamps, and show current-tree blank additions.
  - **Edge cases:** No missing work, storage failure, repeated action, sync copy, abandoned edit, delete either copy, recorded deprecated path, and route after deletion.
  - **Tests or fixtures:** Add all lifecycle transitions and negative confirmations.
  - **Validation:** `bun test tests/ui/session-lifecycle-screen.test.ts`; `bun run check`.
  - **Acceptance:** No timestamp edit control exists. Terminal saves do not change status or persisted workout times. Delete uses the normal path for original and sync-copy IDs.

- [ ] **P8-T08 — Implement Workout Summary**
  - **Objective:** Show all actual work, scores, units, attempts, notes, and final status.
  - **Prerequisites:** P8-T07.
  - **Inspect:** Requirements 20.3 and summary mockup only as guidance.
  - **Create or edit:** `src/ui/screens/WorkoutSummaryScreen.svelte` and tests.
  - **Steps:** Use compact Back header. Render recorded results only, including zero, attempts, unilateral derived text, incomplete/skipped reasons, scores, `Detailed`, notes, abandoned status, and sync-copy label.
  - **Edge cases:** Sparse session, no results, aggregate-only container, detailed nonstandard, missing current node handled by typed error, and no end time for invalid input.
  - **Tests or fixtures:** Use every result fixture from P8-T01.
  - **Validation:** `bun test tests/ui/workout-summary-screen.test.ts`; `bun run check`.
  - **Acceptance:** Summary shows no invented defaults and no aggregate workout-volume metric.

- [ ] **P8-T09 — Implement Workout History and Exercise History**
  - **Objective:** Provide bounded chronological lists and normal routes for every session copy.
  - **Prerequisites:** P8-T08.
  - **Inspect:** Requirements 20.1-20.5 and Architecture loading rules.
  - **Create or edit:** Both history screens and tests.
  - **Steps:** Workout History uses tab-root shell and includes completed, in-progress, and abandoned labels. Exercise History uses compact Back header and actual values. Sort newest first. Add five per `Load older`. Include year outside current year. Label sync copies.
  - **Edge cases:** Empty history, sparse months, offline older load, equal timestamps, cross-year dates, tombstoned session, and blocked older shard.
  - **Tests or fixtures:** Use fake clocks for year formatting and delayed history facade pages.
  - **Validation:** `bun test tests/ui/workout-history-screen.test.ts tests/ui/exercise-history-screen.test.ts`; `bun run check`.
  - **Acceptance:** Lists remain bounded and accessible. No chart, analytics, volume, or reconciliation UI appears.

- [ ] **P8-T10 — Implement Settings units, exports, and diagnostics**
  - **Objective:** Expose preference mappings and user-controlled downloads through facades.
  - **Prerequisites:** P8-T09.
  - **Inspect:** Requirements 12.3, 12.10-12.12, 21.1-21.2 and Architecture export rules.
  - **Create or edit:** `src/ui/screens/SettingsScreen.svelte`, `src/ui/adapters/browser-download-adapter.ts`, settings components, and tests.
  - **Steps:** List exercise-to-unit mappings. Add raw appData export, diagnostic privacy notice/download, and clear action. Use Blob, object URL, and download attribute. Revoke object URLs. Show exact non-commercial licensing text.
  - **Edge cases:** Duplicate raw names, unsafe names already sanitized by facade, unknown file bytes, partial export failure, no diagnostics, download API error, and object URL cleanup.
  - **Tests or fixtures:** Assert raw export and diagnostics remain separate. Assert no network call for diagnostic download.
  - **Validation:** `bun test tests/ui/settings-screen.test.ts tests/ui/browser-download-adapter.test.ts`; `bun run check`; `bun run check:compat`.
  - **Acceptance:** Settings shows both required sections and exact licensing text. Diagnostics never enter Drive export or a network request.

- [ ] **P8-T11 — Implement Delete All User Data and disconnect UI**
  - **Objective:** Present separate, accurate destructive flows with safe partial-failure behavior.
  - **Prerequisites:** P8-T10.
  - **Inspect:** Requirements 21.3-21.7 and Architecture Section 10.
  - **Create or edit:** Settings destructive components and `tests/ui/settings-destructive.test.ts`.
  - **Steps:** Require exact typed phrase before delete. Reauthorize if facade requests it. Show progress and partial deletion without clearing UI state. Keep OAuth grant unless separately disconnected. Expose tested sign-out and account-switch actions through the auth facade. For disconnect, explain scope, call revocation facade, clear after confirmation, and show Google Account connections fallback on failure.
  - **Edge cases:** Wrong phrase, expired token, partial remote delete, unknown files, local clear failure, offline revocation, timeout, repeated action, and account switch during flow.
  - **Tests or fixtures:** Use account-data and auth fakes with every failure stage.
  - **Validation:** `bun test tests/ui/settings-destructive.test.ts`; `bun run check`.
  - **Acceptance:** Delete and disconnect remain separate. Neither flow claims success early. Unknown appData files survive delete.

- [ ] **P8-T12 — Run complete product-flow and accessibility regression**
  - **Objective:** Exercise all screens as one route sequence with reloads and failures.
  - **Prerequisites:** P8-T01 through P8-T11.
  - **Inspect:** Architecture Sections 17, 19 Phase 8, 20, and full diff.
  - **Create or edit:** `tests/ui/product-flow.integration.test.ts` and accessibility tests.
  - **Steps:** Choose, start, enter every type, blur-save, reload active, finish incomplete, edit terminal, view summary/history, export, inspect sync copy, delete, and disconnect. Repeat keyboard-only. Inject storage and sync failures.
  - **Edge cases:** Direct route reload, offline warm cache, account expiry, long deep workout, multiple active sessions, and icon/font failure.
  - **Tests or fixtures:** Deterministic facades, clocks, UUIDs, Drive/storage fakes, and local asset failure modes.
  - **Validation:** `bun test tests/ui/product-flow.integration.test.ts`, `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run build`, `bun run check:compat`.
  - **Acceptance:** Every required screen and destructive flow has automated acceptance evidence. Broad regressions pass.

## 7. Testing matrix

| Requirement or invariant | Level | Success, malformed, recovery, reload, and concurrency cases |
| --- | --- | --- |
| Choose/overview | Component/flow | Active ordering, recent five, deprecated, durable start failure |
| Active result controls | Component/domain integration | Every dimension, effort, attempt, side, notes, blank, zero |
| Save timing/status | Fake-clock integration | Debounce, blur, route, pagehide, quota, sync failure, retry |
| Last Time | Component/query | Completed latest, active ignored, abandoned ignored, none |
| Units | Component/domain | Toggle, full precision, `0.0`, edit versus unedited, sync pending |
| Scores | Component/domain | AMRAP `+`, partial, expansion, EMOM, complex, `Detailed` |
| Lifecycle | Flow | Back, finish, incomplete, abandon, terminal edit, delete, fork |
| Summary/history | Component/loading | All statuses, five older, cross-year, sparse/offline, no volume |
| Export/diagnostics | Service/UI | Unknown files, duplicate names, no network, clear, download failure |
| Delete/disconnect | Flow | Exact phrase, partial delete, reauth, confirmed revoke, fallback |
| Accessibility | Component/flow | Heading order, labels, names, focus, keyboard, target, no color-only |
| Kindle implication | Deferred physical | Numeric density, blur, long scroll, download, destructive text entry |

Use deterministic clocks, UUIDs, storage fakes, and Drive/auth facades. Component tests cannot depend on network or real browser accounts.

## 8. Commands and gates

```text
bun install --frozen-lockfile
bun test tests/ui/product-screens.test.ts
bun test tests/ui/choose-workout-screen.test.ts tests/ui/workout-overview-screen.test.ts tests/ui/active-workout-screen.test.ts
bun test tests/ui/session-lifecycle-screen.test.ts tests/ui/workout-summary-screen.test.ts
bun test tests/ui/workout-history-screen.test.ts tests/ui/exercise-history-screen.test.ts
bun test tests/ui/settings-screen.test.ts tests/ui/settings-destructive.test.ts
bun test tests/ui/product-flow.integration.test.ts
bun run check
bun run test
bun run validate:schemas
bun run validate:static:fixtures
bun run build
bun run check:compat
```

All commands must succeed. Product flows must use facades only. Bundle compatibility and Phase 0 authorization checks remain release prerequisites.

## 9. Judge checklist

- Inspect the diff for UI calls to `fetch`, Drive, IndexedDB, repositories, or domain mutation internals.
- Confirm every required screen and canonical route has an owner and test.
- Compare behavior against requirements before mockups.
- Search for mockup-only `Forge`, workout volume, remote assets, fixed active navigation, and similar-workout Last Time.
- Review every result type, status, sync copy, notes scope, unit, score, and omission fixture.
- Confirm status text reflects local durability and separate sync state.
- Confirm active Back, incomplete finish, abandon, delete, and terminal preservation behavior.
- Confirm no timestamp edit or reconciliation UI exists.
- Confirm raw export includes unknown files and delete excludes them.
- Confirm exact delete phrase and licensing text.
- Review keyboard, focus, labels, headings, targets, and no color-only meaning.
- Run all prior regressions and inspect the built bundle.
- Treat missing physical Kindle or legal evidence as external.
- Treat direct adapter access, lost edits, false destructive success, or missing required control as implementation defects.
- Confirm Section 18 gates 1, 2, 4-6, 9, and 12 remain covered.
- Confirm each Section 20 UI-facing row has screen-level evidence.

## 10. Completion report format

```text
Phase 8 completion report
Completed task IDs:
Files changed:
Commands run and results:
Acceptance criteria satisfied:
Remaining risks or blockers:
Manual evidence still required:
```

List every screen and destructive flow. Separate automated browser evidence from physical Kindle and legal evidence.

## 11. External and manual gates

Do not fabricate physical Kindle usability, Google account, OAuth consent, privacy, legal, production-domain, or deployment evidence. Do not claim that automated accessibility tests prove complete accessibility.

Phase 9 owns release-candidate Kindle, conventional browser, legal, privacy, security-response, OAuth, and deployment gates.
