# Phase 6 execution plan: indexes and session domain

## 1. Mission

Build pure workout-session behavior, bounded runtime indexes, and application query facades. Keep active plans frozen and terminal edits based on the current retained tree.

The phase is complete when several active sessions reload correctly. Session lifecycle, UTC sharding, units, prescriptions, scores, Last Time, recent lists, and `Load older` pass deterministic tests. Terminal edits preserve status and workout timestamps.

## 2. Authority and required reading

Read these sources before editing:

- `AGENTS.md`.
- `docs/REQUIREMENTS.md`, Sections 3, 6, and 9 through 20.
- `docs/ARCHITECTURE.md`, Sections 2, 4, 6 through 9, 11 through 14, 16 through 20, and 19 Phase 6.
- `specs/rep-jot-json-schema-spec.md`, workouts, preferences, results, reference relationships, and all invariants.
- `specs/storage-and-lookup.md`, Stored Result Identity, In-Memory Read Model, Loading Policy, and Monthly Shards.
- `specs/schema-versioning.md`, static identity and historical reference rules.
- `specs/Day-of Workout Execution UI — Design Brief.md`, data entry and hierarchy guidance only.
- Phase 5 facades, repositories, validated models, and tests.

Apply Architecture Section 2 precedence. Requirements override brief language about similar workouts, routing, or defaults.

Binding decisions:

- Domain code imports no Svelte, DOM, OAuth, Drive, or IndexedDB module.
- Session IDs use secure random UUID v4 and fail safely without `crypto.getRandomValues`.
- Every persisted time ends in `Z`. UTC, not local time, selects the shard.
- Active sessions keep frozen effective `executionPlan` values.
- Terminal sessions store no plan. Their editor reconstructs the current retained tree.
- New current-tree nodes appear blank. Recorded deprecated paths remain visible.
- Terminal corrections preserve status, `startedAtUtc`, and `endedAtUtc`.
- Untouched work remains absent. Zero repetitions is actual data.
- A programmed default becomes data on blur, not on render.
- Deprecated omission changes affected scored ancestors to detail-only.
- Unit conversion keeps full precision. Editable display uses nearest `0.1`, exact halves upward.
- Last Time uses the latest completed exercise occurrence and ignores active or abandoned sessions.
- `Load older` adds five records. Recent shows five completed or abandoned sessions.

Use Bun and TypeScript only. Keep Svelte/Vite, static `dist/`, ES2019, and Kindle support. Use native `Map`, `Set`, and sorted arrays. Use no SQLite, WebAssembly, optional chaining, or nullish coalescing in the bundle. Use `REP JOT` in visible text.

## 3. Starting-state contract

Expected outputs:

- Validated current models from Phase 2.
- Local-first pending repository ports from Phase 3.
- Authentication and Drive are behind ports from Phase 4.
- Phase 5 provides synchronization, account-data, and diagnostics facades.

Run all prior tests and inspect actual interfaces. Confirm that a domain save can call a pending repository port without importing IndexedDB.

If merge or pending behavior is incomplete, stop and report the missing task. Do not build an alternate persistence path. If approved static production data is still absent, use valid Phase 1 fixtures for domain tests and report content as a Phase 9 blocker.

## 4. In scope and out of scope

### In scope

- Secure UUID and UTC/shard services.
- Prescription resolution for nested repeated containers.
- Effective-plan freezing and deprecated omission.
- Temporary terminal edit-plan reconstruction.
- Session create, edit, complete, abandon, delete, and sync-copy handling.
- Result omission, blur activation, notes, attempts, unilateral values, and reason codes.
- Unit preference selection, conversion, rounding, and drift prevention.
- AMRAP/EMOM/complex expansion, score derivation, and `nonstandard` behavior.
- Native indexes, bounded summaries, recent-first shard loading, and query facades.
- Multiple active sessions and Last Time.

Primary requirement IDs: 3.3-3.7, 6.5-6.12, 9.1-9.9, 10.1-10.17, 11.1-11.24, 12.2 and 12.4-12.9, 17.1-17.6 query rules, 18.1-18.2 domain behavior, 19.1-19.10 domain behavior, and 20.1-20.5 query behavior.

### Out of scope

- Svelte controls, routing, visual tree rendering, and dialogs.
- Drive reconciliation internals.
- Timestamp editing.
- Persisted runtime indexes, charts, analytics, or aggregate workout volume.
- Wake Lock, timers that promise background accuracy, or a service worker.

Expose `SessionFacade`, `WorkoutQueryFacade`, `HistoryQueryFacade`, and immutable view models for Phases 7-8. Those facades own application orchestration. Screens must not call repositories.

## 5. Required deliverables

| Deliverable | Recommended path | Architecture link | Source control |
| --- | --- | --- | --- |
| Clock/UUID ports | `src/ports/clock.ts`, `src/ports/uuid-source.ts` | Sections 7, 14, 17, and 20 | Yes |
| UTC/shard helpers | `src/domain/time.ts`, `src/domain/shards.ts` | Sections 8, 17, and 20 | Yes |
| Prescription resolver | `src/sessions/prescription-resolver.ts` | Sections 13, 17, and 20 | Yes |
| Execution plans | `src/sessions/execution-plan.ts` | Sections 7, 13, 17, and 20 | Yes |
| Score service | `src/sessions/score-service.ts` | Sections 13, 17, and 20 | Yes |
| Unit conversion | `src/units/conversion.ts`, `src/units/editable-quantity.ts` | Sections 7, 13, 17, and 20 | Yes |
| Session service | `src/sessions/session-service.ts` | Sections 7, 13, and 19 Phase 6 | Yes |
| Index builder | `src/indexes/index-builder.ts` | Sections 7, 11, 17, and 20 | Yes |
| Lookup service | `src/indexes/lookup-service.ts` | Sections 7, 13, 17, and 20 | Yes |
| History loader | `src/application/history-loader.ts` | Sections 9, 11, and 20 | Yes |
| Facades | `src/application/session-facade.ts`, `workout-query-facade.ts`, `history-query-facade.ts` | Sections 7 and 20 | Yes |
| Tests | Focused files under `tests/` for each module | Sections 17 and 19 Phase 6 | Yes |

Runtime indexes and generated view models do not belong in source control. Deterministic fixtures and fake clocks/UUIDs do.

## 6. Ordered execution tasks

- [ ] **P6-T01 — Implement secure session IDs and UTC shard selection**
  - **Objective:** Create valid session IDs and UTC timestamps without local-calendar influence.
  - **Prerequisites:** Phase 5 complete.
  - **Inspect:** Existing `src/random-uuid.ts`, C-10/C-11, results schema, and capability report.
  - **Create or edit:** `src/ports/clock.ts`, `src/ports/uuid-source.ts`, `src/domain/time.ts`, `src/domain/shards.ts`, and tests.
  - **Steps:** Implement RFC 4122 v4 bit layout with injected secure bytes. Prefix session IDs with `session-`. Convert clock instants to ISO `Z` strings. Select `results-YYYY-MM.json` from `startedAtUtc.slice(0, 7)` after validation.
  - **Edge cases:** Secure random unavailable, all-zero bytes, UTC month/year boundary, leap day, invalid offset input, clock before epoch, and local-zone changes.
  - **Tests or fixtures:** Fixed byte arrays and UTC boundary cases. Prove no `Math.random` session fallback.
  - **Validation:** `bun test tests/session-id.test.ts tests/shards.test.ts`; `bun run check`; `bun run check:compat`.
  - **Acceptance:** IDs match the schema. One instant selects one shard in every display zone. Failure creates no session.

- [ ] **P6-T02 — Resolve prescriptions through nested iterations**
  - **Objective:** Produce effective fields for each one-based execution path.
  - **Prerequisites:** P6-T01.
  - **Inspect:** Requirements 10.2-10.5 and Architecture ADR-021.
  - **Create or edit:** `src/sessions/prescription-resolver.ts`, `tests/prescription-resolver.test.ts`.
  - **Steps:** Start with top-level fields. Overlay only fields present in the matching nearest repeated-container iteration. Preserve absent fields. Reject duplicate numbers and finite out-of-range overrides through semantic preconditions.
  - **Edge cases:** Nested rounds, EMOM cycle, no override, override adds a field, override omits a field, `null`, duplicate number, and no finite bound.
  - **Tests or fixtures:** Use the approved 5/80, 3/100, 8/100 example plus nested cases.
  - **Validation:** `bun test tests/prescription-resolver.test.ts`; `bun run check`.
  - **Acceptance:** Results are independent of iteration-array order. Omitted fields inherit. No resolver invents a value.

- [ ] **P6-T03 — Freeze active plans and apply deprecated omission**
  - **Objective:** Build an effective immutable tree for each new active session.
  - **Prerequisites:** P6-T02.
  - **Inspect:** Requirements 6.5-6.12, Architecture ADR-019, and resolved deprecated-container case.
  - **Create or edit:** `src/sessions/execution-plan.ts`, `tests/execution-plan.test.ts`, and fixtures.
  - **Steps:** Reject deprecated workouts. Deep-copy the current tree. Omit already deprecated exercise leaves. Record relevant skipped results. Convert each affected scored ancestor to required detail and disable aggregate entry. Skip empty affected containers.
  - **Edge cases:** Nested affected ancestors, one remaining leaf, no remaining child, unscored parent, deprecated leaf in a new node, and static changes after creation.
  - **Tests or fixtures:** Add partial, complete, nested, empty, and resume-after-static-change cases.
  - **Validation:** `bun test tests/execution-plan.test.ts`; `bun run check`.
  - **Acceptance:** Active resume uses only the frozen plan. Complete remaining detail permits only `nonstandard`. Empty affected containers have deprecated skips and no score.

- [ ] **P6-T04 — Reconstruct terminal edit plans from the current tree**
  - **Objective:** Overlay historical results without storing a terminal snapshot.
  - **Prerequisites:** P6-T03.
  - **Inspect:** Requirements 11.16-11.20 and Architecture ADR-020.
  - **Create or edit:** Terminal-plan functions in `src/sessions/execution-plan.ts` and tests.
  - **Steps:** Start from the current retained workout tree. Overlay results by complete execution path. Show new nodes blank. Retain a deprecated path only when recorded. Hide unrecorded deprecated leaves. Return a temporary editor model only.
  - **Edge cases:** Added node, renamed content, moved node blocked by compatibility, recorded deprecated node, missing retained reference, sync copy, and abandoned session.
  - **Tests or fixtures:** Use the approved A/B plus added C example and nested path cases.
  - **Validation:** `bun test tests/execution-plan.test.ts`; `bun run check`.
  - **Acceptance:** Saving a terminal edit persists no `executionPlan`. The editor preserves terminal status and all workout timestamps.

- [ ] **P6-T05 — Implement unit defaults, conversion, and editable rounding**
  - **Objective:** Convert compatible values without avoidable drift or implicit history rewrites.
  - **Prerequisites:** P6-T02.
  - **Inspect:** Requirements 12.2 and 12.4-12.9 and Architecture ADR-015.
  - **Create or edit:** `src/units/conversion.ts`, `src/units/editable-quantity.ts`, and `tests/unit-conversion.test.ts`.
  - **Steps:** Define exact factors for weight, distance, and duration. Keep full internal precision. Round editable display to nearest `0.1`, exact half upward. Track whether the user edited the rounded text. Default to the first metric-first compatible unit.
  - **Edge cases:** `100 kg`, `5 km`, `90 second`, small positive shown as `0.0`, repeated toggles, explicit zero, incompatible dimension, and single-unit dimensions.
  - **Tests or fixtures:** Add drift cycles and deterministic decimal boundary cases.
  - **Validation:** `bun test tests/unit-conversion.test.ts`; `bun run check`.
  - **Acceptance:** Unedited toggles preserve full precision. Edited text becomes the saved number. Existing saved units remain until edit.

- [ ] **P6-T06 — Implement result editing, omission, attempts, sides, and notes**
  - **Objective:** Translate explicit user actions into minimal valid results.
  - **Prerequisites:** P6-T03 through P6-T05.
  - **Inspect:** Requirements 11.1-11.8 and result Save and Omission Rules.
  - **Create or edit:** `src/sessions/result-editor.ts`, tests, and result fixtures.
  - **Steps:** Keep programmed defaults as temporary state. Commit a displayed default on blur. Leave untouched work absent. Store zero reps. Support attempts, controlled reasons, effort, session/exercise/attempt/container notes, and unilateral side rules.
  - **Edge cases:** Blank versus zero, incomplete without relevance, skipped with values, alternating without starting side, bilateral side input, extra attempt, blur without text change, and storage failure.
  - **Tests or fixtures:** Add every result type and reason-code path with malformed negative cases.
  - **Validation:** `bun test tests/result-editor.test.ts`; `bun run check`.
  - **Acceptance:** Every produced result passes schema and semantic validation. A failed repository save leaves editable form state and does not report durability.

- [ ] **P6-T07 — Implement aggregate expansion and score recomputation**
  - **Objective:** Keep aggregate-only and detailed container results consistent.
  - **Prerequisites:** P6-T02, P6-T03, and P6-T06.
  - **Inspect:** Requirements 10.10-10.17, Architecture scoring cases, and Phase 1 semantic score helpers.
  - **Create or edit:** `src/sessions/score-service.ts`, shared pure score helpers only when necessary, and `tests/score-service.test.ts`.
  - **Steps:** Reuse the Phase 1 score derivation rules. Support cycles, rounds-and-reps, intervals, and nonstandard. Expand optional detail into complete ordered children from score and plan. Recompute after every child edit. Mark invalid progression `nonstandard` and display-model label `Detailed`.
  - **Edge cases:** Partial round, AMRAP `+` round, nested children, zero rounds, extra reps at sequence length, incomplete child, detail-only deprecated ancestor, and childDetail `none`.
  - **Tests or fixtures:** Add aggregate-only, valid expansion, partial, invalid progression, nested, and deprecated cases.
  - **Validation:** `bun test tests/score-service.test.ts`; `bun run check`.
  - **Acceptance:** Partial detail cannot persist. Child edits are authoritative after expansion. Semantic recomputation matches stored score.

- [ ] **P6-T08 — Implement session lifecycle with local-first saves**
  - **Objective:** Create, save, complete, abandon, delete, and edit sessions through repository ports.
  - **Prerequisites:** P6-T01 through P6-T07.
  - **Inspect:** Requirements 11.9-11.24 and Architecture Workout-Session Lifecycle.
  - **Create or edit:** `src/sessions/session-service.ts`, `src/application/session-facade.ts`, and `tests/session-service.test.ts`.
  - **Steps:** Create and persist before active-route navigation. Debounce normal edit requests at facade level. Flush on blur, route change, and pagehide request. Complete with missing-work decision. Remove plan on terminal state. Abandon similarly. Delete live session and add permanent tombstone in its original shard.
  - **Edge cases:** Several active sessions, cross-month completion, back navigation, missing work, finish incomplete, storage failure, sync copy edit/delete, repeated delete, and terminal correction.
  - **Tests or fixtures:** Use fixed clocks, UUIDs, in-memory repository, and save barriers.
  - **Validation:** `bun test tests/session-service.test.ts`; `bun run check`.
  - **Acceptance:** Start is durable before navigation. Back keeps `in_progress`. Terminal edit changes only results/notes and `updatedAtUtc`. Delete writes a tombstone.

- [ ] **P6-T09 — Build bounded native indexes**
  - **Objective:** Build compact read models without persisting duplicate data.
  - **Prerequisites:** P6-T08.
  - **Inspect:** Storage spec In-Memory Read Model and Architecture ADR-011/ADR-016.
  - **Create or edit:** `src/indexes/index-builder.ts`, `tests/index-builder.test.ts`.
  - **Steps:** Build exercise/workout/node maps, muscle sets, active summaries, recent session summaries, exercise occurrences, and container summaries. Use `workoutId + NUL + nodeId` keys. Sort UTC timestamps deterministically with ID tie-breakers.
  - **Edge cases:** Duplicate paths already rejected, equal timestamps, sync copies, abandoned sessions, unloaded older shards, deprecated entities, and account reset.
  - **Tests or fixtures:** Add deep-tree, multiple-shard, equal-time, and bounded-list fixtures.
  - **Validation:** `bun test tests/index-builder.test.ts`; `bun run check`.
  - **Acceptance:** Indexes use native structures and compact summaries. No index enters IndexedDB. Rebuild affects only changed shard data.

- [ ] **P6-T10 — Implement lookups and recent-first history loading**
  - **Objective:** Answer chooser, active, recent, Last Time, workout history, and exercise history queries.
  - **Prerequisites:** P6-T09.
  - **Inspect:** Requirements 17, 19.3-19.5, 20 and Architecture loading policy.
  - **Create or edit:** `src/indexes/lookup-service.ts`, `src/application/history-loader.ts`, query facades, and tests.
  - **Steps:** Return all active sessions sorted by `updatedAtUtc`. Return five recent terminal sessions. Compute latest completion per workout. Compute Last Time from latest completed exercise occurrence only. Add five per `Load older`. Read older shards newest first on demand.
  - **Edge cases:** No history, active-only history, abandoned latest, sync copy, event outside current year, sparse months, first empty-cache all-shard scan, and offline cached older shard.
  - **Tests or fixtures:** Use a fake shard source with request recording and bounded summaries.
  - **Validation:** `bun test tests/lookup-service.test.ts tests/history-loader.test.ts`; `bun run check`.
  - **Acceptance:** Active session never appears as Last Time. Every load action adds at most five visible records. First reconciliation can find all active sessions one shard at a time.

- [ ] **P6-T11 — Run domain integration and memory-shape regressions**
  - **Objective:** Prove end-to-end domain behavior without UI or infrastructure imports.
  - **Prerequisites:** P6-T01 through P6-T10.
  - **Inspect:** Architecture Sections 17, 19 Phase 6, 20, and the complete diff.
  - **Create or edit:** `tests/session-domain.integration.test.ts` and fixtures.
  - **Steps:** Start several sessions, reload from repositories, apply static changes, edit terminal history, convert units, expand AMRAP, delete one copy, and query history. Inspect retained index fields for accidental full-document duplication.
  - **Edge cases:** Deep trees, detailed AMRAP, cross-month active sessions, secure-random failure, and unavailable older shard.
  - **Tests or fixtures:** Use deterministic clocks, UUIDs, storage fakes, and shard fakes.
  - **Validation:** `bun test tests/session-domain.integration.test.ts`; `bun run test`; `bun run check`; `bun run build`; `bun run check:compat`.
  - **Acceptance:** Multiple active sessions survive reload. Frozen and terminal-plan rules hold. Broad regressions pass within bounded fixture behavior.

## 7. Testing matrix

| Requirement or invariant | Level | Cases |
| --- | --- | --- |
| Secure UUID and UTC shard | Pure | Missing crypto, v4 bits, UTC boundary, local display zone |
| Prescriptions | Pure | Inheritance, add field, duplicate, bounds, nested repeats |
| Frozen plan | Pure/integration | Static change resume, deprecated partial/nested/empty |
| Terminal edit | Pure/integration | Added node, recorded deprecated path, status/timestamps |
| Omission/zero/default blur | Domain | Untouched, blank, zero, incomplete, skipped, blur |
| Sides and attempts | Domain | Left/right/both/alternating, odd total, starting side, attempts |
| Units | Pure/property | Full precision, `0.1`, exact half, small positive, drift |
| Scores | Pure/semantic | Aggregate, expansion, child edit, nonstandard, detail-only |
| Lifecycle | Service | Create, reload, back, complete, incomplete, abandon, delete, fork |
| Indexes/lookups | Unit | Ordering, bounded lists, all active, Last Time, no history |
| History loading | Integration | Warm cache, empty scan, sparse months, offline, concurrency |
| Kindle implication | Deferred physical | Deep scroll, dense inputs, reload, memory behavior |

Every test uses deterministic clocks and UUIDs. Repository and shard fakes must expose reload and failure behavior. No domain test imports Svelte or browser globals.

## 8. Commands and gates

```text
bun install --frozen-lockfile
bun test tests/session-id.test.ts tests/shards.test.ts tests/prescription-resolver.test.ts
bun test tests/execution-plan.test.ts tests/unit-conversion.test.ts tests/result-editor.test.ts tests/score-service.test.ts
bun test tests/session-service.test.ts tests/index-builder.test.ts tests/lookup-service.test.ts tests/history-loader.test.ts
bun test tests/session-domain.integration.test.ts
bun run check
bun run test
bun run validate:schemas
bun run validate:static:fixtures
bun run build
bun run check:compat
```

All commands must succeed. Domain outputs must pass the Phase 1 schema and semantic validators. The broad bundle gate must remain ES2019-compatible.

## 9. Judge checklist

- Inspect imports. Domain code must not import Svelte, DOM, OAuth, Drive, IndexedDB, or infrastructure adapters.
- Confirm application facades depend on repository and sync interfaces.
- Review secure UUID tests and reject any session `Math.random` fallback.
- Confirm UTC shard tests cross local-zone and month boundaries.
- Review frozen-plan and current-tree terminal-edit fixtures.
- Confirm terminal saves preserve status and timestamps and omit `executionPlan`.
- Review zero, omission, blur-default, notes, attempts, and unilateral negative tests.
- Confirm conversion drift and exact rounding tests.
- Confirm detailed child edits recompute score and invalid progression becomes `nonstandard`.
- Confirm all active sessions, Last Time, and five-record loading rules.
- Inspect indexes for persisted or duplicated full documents.
- Run prior-phase regressions.
- Treat physical Kindle memory measurements as unavailable external evidence.
- Treat lost precision, mutable active plans, timestamp movement, or active Last Time results as implementation defects.
- Confirm Section 18 gates 1, 2, 4, and 9 remain active.
- Confirm Section 20 UUID, sessions, plans, terminal edits, omission, AMRAP, and active-session rows have evidence.

## 10. Completion report format

```text
Phase 6 completion report
Completed task IDs:
Files changed:
Commands run and results:
Acceptance criteria satisfied:
Remaining risks or blockers:
Manual evidence still required:
```

Name the deepest fixture and largest loaded-history fixture. Do not convert those fixtures into a claimed Kindle memory budget.

## 11. External and manual gates

Do not fabricate physical Kindle memory, scroll, input, pagehide, or storage results. Do not fabricate production workout content or health-data examples from users.

Phase 9 owns physical Kindle and release evidence. Google Cloud, OAuth consent, privacy, legal, security-response, production-domain, and deployment approvals remain external.
