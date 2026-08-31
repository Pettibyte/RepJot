# Cross-phase gates

## 1. Purpose

This file preserves the broad evidence from the former workstream plans. Each phase file contains its focused evidence.

The parent judge must apply the applicable rows after each phase. The final phase in each workstream must apply its complete section.

The rules in `docs/implementation/README.md` remain binding.

## 2. Phases 1-10: Contract and build validation

Phase 10 must apply this complete section before acceptance.

### Testing matrix

| Requirement or invariant | Level | Fixtures and cases |
| --- | --- | --- |
| Four families and v1 envelopes | Unit and schema | One valid and malformed envelope per family |
| UTC fields and `Z` values | Schema and semantic | Valid UTC, offset, invalid date, shard boundary |
| Invariants 1-20 and 22-28 | Semantic unit | Grouped positive and negative cross-file fixtures |
| Invariant 21 tombstone policy | Ownership trace | Primary implementation and tests assigned to Phase 37 |
| Iteration inheritance and uniqueness | Semantic unit | Selective override, duplicate number, finite bound |
| Deprecated scored ancestor | Semantic unit | Partial, complete, nested, and empty container |
| Stable identity | Compatibility | Delete, reuse, move, role, strategy, score, unit removal |
| Permitted correction | Compatibility | Label, instruction, note, and prescription edits |
| Static source transform | Unit and command | `body only`, `null`, missing curation, deterministic order |
| Trusted SVG | Build integration | Safe local, traversal, script, external reference, missing file |
| ES2019 and Kindle syntax | Bundle gate | Existing classic parse plus explicit prohibited-syntax scan |

Use an injected clock for report timestamps and a fake compatibility source for tests. Do not use randomness. Malformed-input tests must preserve input objects and fixture bytes. Physical Kindle execution is deferred to Phases 79-91, but this phase must not weaken its parser or loader gates.

### Commands and gates

Run only these Bun commands:

```text
bun install --frozen-lockfile
bun run check
bun run test
bun run validate:schemas
bun run validate:static:fixtures
bun run compare:production -- --fixture tests/fixtures/compatibility/compatible
bun run build
bun run check:compat
```

All listed commands must return success for repository fixtures. Negative fixture tests must prove that each command fails closed. Run `bun run validate:static` only after approved canonical files exist. For the first release, record the blank-baseline decision instead of downloading prior files.

### Additional parent judge checks

- Inspect the complete diff. It must contain no Phase 0 redesign and no unrelated prototype cleanup.
- Make sure that domain and validation modules import no Svelte, DOM, OAuth, Drive, or IndexedDB code.
- Make sure that no UI module calls the new validator as a substitute for an application service.
- Review every added dependency and lockfile change.
- Review negative tests for format assertions, external references, all static invariant groups, and compatibility failures.
- Run broad regression checks and inspect the generated bundle for the existing redirect-only authorization protections.
- Make sure that generated reports and temporary downloads are not tracked.
- Treat absent human curation approval as unavailable external evidence. Do not require prior-production files or numeric release budgets for the first release.
- Treat incorrect diagnostics, missed invariants, nondeterministic output, or weakened compatibility gates as implementation defects.
- Confirm Section 18 gate ownership: gates 1-5 and fixture gate 7 are primary here. Gate 9 remains preserved.
- Confirm Section 20 ownership for four families, UTC contracts, unit order, static identity, iteration rules, and blank-baseline or future compatibility.

### External and manual gates

Examine the real checkout at `../free-exercise-db`, but do not fabricate its state or a curation approval. Do not create a production manifest from unapproved content. Do not fabricate license review, physical Kindle results, or deployment results.

Phases 1-10 can pass with deterministic fixtures while production content remains unapproved. Phases 82 and 91 record the baseline decision and handoff. Google and human approvals are not contract implementation evidence.

## 3. Phases 11-18: Document pipeline and migrations

Phase 18 must apply this complete section before acceptance.

### Testing matrix

| Requirement or invariant | Level | Cases |
| --- | --- | --- |
| Unlimited parsing policy | Unit and stress | Malformed encoding or JSON fails. Generated large or deep valid inputs have no project-threshold rejection. |
| Exact envelope | Unit | Missing, inherited, wrong family, noninteger, unsupported, future |
| Ordered migration | Unit | Zero-step current, synthetic multi-step, gap, wrong next version |
| Validation-before-migration | Spy and fixture | Invalid source never invokes migration |
| Validation-after-migration | Spy and fixture | Invalid intermediate and final outputs stop |
| Immutability | Unit | Frozen object, byte snapshot, repeated load |
| Context order | Integration with fake source | Exercises, workouts, preferences, newest result first |
| Recovery | Integration | Bad cache model rebuild signal, source retained, unaffected family usable |
| Serialization | Unit | Serialize, parse, schema, semantic revalidation |
| Kindle and ES2019 | Bundle | Broad compatibility command, no new syntax or large eager fixture import |

Use deterministic digest fakes and immutable fixtures. No clock or UUID is required for migrations. If provenance timestamps exist, inject a deterministic clock and keep them outside canonical models.

### Commands and gates

```text
bun install --frozen-lockfile
bun run check
bun test tests/document-pipeline.test.ts tests/migration-registry.test.ts tests/static-loader.test.ts
bun run test
bun run validate:schemas
bun run validate:static:fixtures
bun run build
bun run check:compat
```

All commands must succeed. Negative tests must prove distinct failure kinds and unchanged source bytes. Phases 1-10 and 79-91 own compatibility gates.

### Additional parent judge checks

- Inspect the diff for a second schema validator, shape inference, or migration write-back.
- Confirm that every migration path is pure and imports no DOM, clock, locale, random, Svelte, Drive, or IndexedDB module.
- Confirm that schema validation occurs before migration and after every transition.
- Confirm that semantic validation occurs before normalization succeeds.
- Inspect malformed, unsupported-old, future, mutation, and recovery tests.
- Confirm that no real `v0` or speculative legacy migration was invented.
- Confirm that static loading uses an interface and that only a later infrastructure adapter can call `fetch`.
- Run all Phase 0 and Phases 1-10 regression checks.
- Treat missing approved historical versions as unavailable external evidence, not a defect.
- Treat changed source bytes, bypassed stages, unsafe errors, or inferred identity as implementation defects.
- Confirm Section 18 gates 1-4 and 9 still pass.
- Confirm Section 20 rows for four families, UTC contracts, ordered migration, and future-data protection have tests.

### External and manual gates

Do not fabricate historical production documents, migration defects, prior-release bytes, physical Kindle results, Drive behavior, or deployment evidence. Do not convert desktop stress results into a Kindle limit.

This workstream needs no Google Cloud or legal approval. Phase 89 records later physical Kindle stress evidence. Other human approvals remain external.

## 4. Phases 19-26: IndexedDB persistence

Phase 26 must apply this complete section before acceptance.

### Testing matrix

| Requirement or invariant | Level | Cases |
| --- | --- | --- |
| Account-scoped keys | Integration | Same names in A/B, switch, sign-out, clear A |
| Layout upgrades | Integration | Fresh, old version, blocked, aborted, versionchange |
| Local-first save | Integration | Saving, commit, reload, blur caller contract |
| Failed save truth | Negative integration | Quota, abort-after-request, close, retry |
| Pending recovery | Reload integration | Queued, uploading, ambiguous, failed, null base |
| Receipt atomicity | Integration | Known commit, abort, stale digest |
| Remote deletion cache rule | Integration | Clean removed, pending retained |
| Diagnostic ring | Unit/integration | Age, count, bytes, clear, export, append failure |
| Redaction | Negative | Tokens, notes, values, raw IDs, stack, URL query |
| Concurrency | Barrier integration | Same key serialized by caller contract, separate keys isolated |
| Kindle implication | Deferred physical | Open/write, pressure, pagehide/reload, blocked upgrade messaging |

Every test uses deterministic clocks and IDs. Storage tests use a fresh fake database name or full cleanup. No test depends on execution order.

### Commands and gates

```text
bun install --frozen-lockfile
bun run check
bun test tests/idb-database.test.ts tests/account-repository.test.ts tests/pending-repository.test.ts tests/diagnostic-repository.test.ts
bun run test
bun run validate:schemas
bun run validate:static:fixtures
bun run build
bun run check:compat
```

All commands must succeed. Quota and rollback tests must fail the operation without losing prior state. The bundle must remain ES2019-compatible.

### Additional parent judge checks

- Inspect the diff for direct IndexedDB use outside `src/storage/` infrastructure.
- Confirm that repository ports expose no browser types.
- Confirm all compound keys begin with `accountKey` where applicable.
- Inspect upgrade code. It must change structure only, not canonical JSON meaning.
- Review negative tests for request-success/transaction-abort, quota, blocked upgrades, and corrupt cache.
- Confirm that local `Saved` follows transaction completion only.
- Confirm that diagnostics use a separate transaction and never synchronize.
- Confirm that account A cleanup cannot touch account B.
- Run Phase 0 and Phases 1-18 regression and compatibility checks.
- Treat physical Kindle storage pressure as unavailable external evidence.
- Treat cross-account reads, lost pending edits, false `Saved`, or leaked diagnostics as implementation defects.
- Confirm Section 18 gates 1, 2, and 9 remain active.
- Confirm Section 20 account-cache and diagnostic rows have primary evidence.

### External and manual gates

Do not fabricate physical Kindle IndexedDB behavior, storage-pressure limits, browser cleanup, Google account behavior, Drive outcomes, or deployment evidence.

Physical open/write, quota-pressure, pagehide, and reload tests remain Phases 79-91 gates. OAuth consent, privacy, legal, production-domain, and deployment approvals also remain external gates.

## 5. Phases 27-35: Authentication and Drive adapters

Phase 35 must apply this complete section before acceptance.

### Testing matrix

| Requirement or invariant | Level | Cases |
| --- | --- | --- |
| Redirect-only OAuth | Unit and bundle | Current-window replace, no open, exact endpoint |
| State and receipt | Unit | Dual-store loss, mismatch, expiry, exact replay, different token |
| Remember choice | Unit and reload | Session store, local store, exact expiry cleanup |
| Account binding | Service integration | New, restored, switch, about error, mismatched account |
| Revocation | Adapter/service | Confirmed `401`, timeout, offline, fallback, cleanup |
| Scope | Request and bundle | Exact `drive.appdata`, no broader scope |
| Pagination | Adapter | Empty, one page, many pages, malformed token loop |
| Stable IDs | Adapter | Update retained ID, create supplied generated ID |
| Duplicate mechanics | Integration fake | Valid group, corrupt copy, changed metadata, partial delete, relist |
| Typed errors | Unit | `401`, `403`, quota, `429`, `5xx`, malformed, ambiguous |
| Kindle | Deferred physical | Redirect, callback replay, remembered reload, revocation |

Use deterministic clocks, secure-byte sources, timers, storage fakes, and Drive fakes. Never place real tokens or account IDs in fixtures.

### Commands and gates

```text
bun install --frozen-lockfile
bun test tests/google-identity.test.ts tests/oauth-redirect-adapter.test.ts tests/auth-service.test.ts
bun test tests/drive-rest-adapter.test.ts tests/drive-catalog.test.ts tests/fakes/fake-drive.test.ts
bun run check
bun run test
bun run validate:schemas
bun run validate:static:fixtures
bun run build
bun run check:compat
```

All commands must succeed. The compatibility command must prove ES2019 parsing, exact app-data scope, classic loading, and no `window.open` call.

### Additional parent judge checks

- Inspect the diff against Phase 0 source and proof. Reject any unapproved flow change.
- Confirm no GIS script, code flow, PKCE, popup, tab, refresh token, or broader scope exists.
- Confirm fragment removal precedes private data access and UI mount.
- Confirm every restored token repeats account binding.
- Confirm UI and domain modules do not call `fetch`.
- Inspect request fixtures for token leakage in URLs and errors.
- Review negative tests for replay, expiry, malformed storage, authorization errors, pagination, and duplicate races.
- Confirm stable update IDs and generated create IDs.
- Confirm Phases 27-35 duplicate work owns catalog mechanics. Phases 36-46 still owns content merge and end-to-end convergence.
- Do not require prototype deletion while `App.svelte` imports it. Reject new hello-world features.
- Treat new physical Kindle evidence as unavailable unless a tester supplies it.
- Treat scope expansion, early cache access, token leakage, incomplete pagination, or unsafe deletion as implementation defects.
- Confirm Section 18 gates 1, 2, 8 fixture configuration, and 9 remain covered.
- Confirm Section 20 OAuth, Drive appData, and stable catalog rows have tests.

### External and manual gates

Do not fabricate Google Cloud configuration, consent-screen approval, production OAuth IDs, domain verification, live account results, revocation behavior, or physical Kindle evidence.

Phase 0 fixes the required behavior, but its results table lacks device, build, tester, and evidence metadata. Do not use its blank PASS rows as release evidence. Phases 79-91 requires a documented regression against the exact release candidate. Privacy, legal, security-response, production-domain, and deployment approvals remain external.

## 6. Phases 36-46: Merge and synchronization

Phase 46 must apply this complete section before acceptance.

### Testing matrix

| Requirement or invariant | Level | Success, failure, recovery, and concurrency cases |
| --- | --- | --- |
| Different IDs merge | Pure and property | Two/three clients, every order, idempotence |
| Same live ID conflict | Pure/integration | Remote original, local fork, status/timestamps preserved |
| Tombstones | Pure/property | Either side, both sides, stale live, no fork |
| Preference arrival order | Pure/property | Different keys, same key, retries, revision once |
| Stable file IDs | Adapter/integration | Update in place, reserved create, ambiguous create reload |
| Duplicate names | Integration | Valid copies, three versions, corrupt, future, metadata race, partial delete |
| Preflight/post-read | Barrier integration | Change before upload, response drop, overwrite after read |
| Pending recovery | Reload integration | queued, uploading, ambiguous, failed, known remote commit |
| Retry | Fake-clock integration | network, `429`, `5xx`, `Retry-After`, `401`, quota, exhaustion |
| Diagnostics | Unit/integration | Every decision stage, redaction, ring failure, no network |
| Export/delete | Service integration | Unknown export, duplicate suffix, partial delete, relist |
| Kindle implication | Deferred physical | Long sync, offline save, reload, ambiguous recovery |

All concurrency tests use deterministic fake Drive barriers. All generated identities, clocks, jitter, and schedulers are injectable. Keep seeds in failure output.

### Commands and gates

```text
bun install --frozen-lockfile
bun test tests/merge-results.test.ts tests/merge-preferences.test.ts
bun test tests/sync-coordinator.test.ts tests/duplicate-consolidation.test.ts tests/sync-convergence.test.ts
bun test tests/diagnostic-service.test.ts tests/account-data-service.test.ts
bun run check
bun run test
bun run validate:schemas
bun run validate:static:fixtures
bun run build
bun run check:compat
```

All commands must succeed. Negative suites must prove that blocked data is never overwritten and pending edits survive. The bundle must retain Phase 0 and ES2019 gates.

### Additional parent judge checks

- Inspect the diff for direct `fetch` or IndexedDB calls outside adapters.
- Confirm dependency direction from application services to ports to infrastructure.
- Confirm merge modules are pure and import no browser APIs.
- Review every result truth-table case and property invariant.
- Confirm tombstones run before live merge and never create sync copies.
- Confirm reserved IDs commit before candidate construction and survive reload.
- Confirm create uses a reserved Drive ID and update retains the discovered ID.
- Confirm metadata preflight and post-read are present without a CAS claim.
- Review duplicate cleanup ordering and negative metadata-race tests.
- Confirm invalid/future data remains blocked and unchanged.
- Confirm export includes unknown files while delete excludes them.
- Confirm diagnostics contain no tokens, raw IDs, notes, measurements, content, raw errors, or query strings.
- Run all earlier regressions.
- Treat final-write race elimination as unavailable platform capability, not an implementation requirement.
- Treat lost intent, duplicate forks, unsafe delete, false commit, or diagnostic leaks as implementation defects.
- Confirm Section 18 gates 1, 2, 4, and 9 remain active.
- Confirm all Section 20 sync, merge, tombstone, fork, preference, diagnostic, and no-reconciliation rows have evidence.

### External and manual gates

Do not fabricate live Drive race behavior, Google quota behavior, network ambiguity, production account data, physical Kindle sync evidence, or deployment evidence.

Deterministic fakes are valid implementation evidence. Physical Kindle, Google Cloud, OAuth consent, privacy, legal, production-domain, security-response, and deployment approvals remain Phases 79-91 external gates.

## 7. Phases 47-57: Indexes and session domain

Phase 57 must apply this complete section before acceptance.

### Testing matrix

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

### Commands and gates

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

All commands must succeed. Domain outputs must pass the Phases 1-10 schema and semantic validators. The broad bundle gate must remain ES2019-compatible.

### Additional parent judge checks

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

### External and manual gates

Do not fabricate physical Kindle memory, scroll, input, pagehide, or storage results. Do not fabricate production workout content or health-data examples from users.

Phase 89 owns physical Kindle evidence. Phases 79-91 own release evidence. Google and human approvals remain external.

## 8. Phases 58-66: Shell, routing, and status UI

Phase 66 must apply this complete section before acceptance.

### Testing matrix

| Requirement or invariant | Level | Cases |
| --- | --- | --- |
| Hash routes | Unit/integration | Round trip, invalid, direct reload, browser back, auth return |
| Startup states | State unit | Anonymous, warm, empty, stale, offline, future, corrupt, fatal static |
| Account gate | Integration | Restored token, bind delay/failure, switch, expiry |
| Save status | Component/integration | Saving, local Saved, sync pending, Sync failed, storage error |
| Headers/tabs | Component | Tab roots, details, active route, compact Back |
| Accessibility | Component/static | Names, labels, headings, focus order, keyboard, no color-only status |
| E-ink styles | Static/bundle | No effects/animation dependency, block flow, 600px, fallback fonts |
| Local fonts/icons | Build/component | Manifest, subset, license, missing glyph, fallback, visible text |
| Prototype cleanup | Regression | No hello-world UI, auth tests unchanged |
| Kindle implication | Deferred physical | Route reload, focus, font glyphs, long scroll, history interaction |

Use deterministic facade states and save barriers. Component tests must not require network access. Physical contrast and glyph quality remain manual Phases 79-91 evidence.

### Commands and gates

```text
bun install --frozen-lockfile
bun run build:fonts
bun test tests/hash-router.test.ts tests/app-state.test.ts tests/bootstrap.test.ts
bun test tests/ui/shared-components.test.ts tests/ui/shell.test.ts tests/ui/routing.integration.test.ts
bun run check
bun run test
bun run validate:schemas
bun run validate:static:fixtures
bun run build
bun run check:compat
```

All commands must succeed. The font command must fail on missing reviewed inputs, ligatures, or licenses. The built app must load as an ES2019 classic script.

### Additional parent judge checks

- Inspect the diff for direct UI `fetch`, IndexedDB, repository, or Drive adapter calls.
- Confirm route/controller/application/domain dependency direction.
- Confirm all seven canonical routes parse, reload, and show correct shell chrome.
- Confirm active/detail routes have no tab bar.
- Review save-before-back failure behavior.
- Confirm fragment cleanup order and Phase 0 regressions.
- Search visible copy for incorrect brand spellings and prototype `Forge` text.
- Review semantic controls, focus, labels, large targets, and no color-only states.
- Review CSS for radii, shadows, gradients, blur, animation, sticky dependency, Grid dependency, and hover-only actions.
- Confirm font sources, checksums, licenses, glyph manifest, fallback, and source-control policy.
- Confirm prototype cleanup happened only after replacement tests.
- Treat a missing official font source, checksum mismatch, or omitted license as an implementation or supply-chain failure. The font families already have design approval.
- Treat direct adapter access, route reload failure, hidden actions, or branding errors as implementation defects.
- Confirm Section 18 gates 1, 2, 5, 6, 9, and 12 remain covered.
- Confirm Section 20 routing, controls, fonts, and status rows have primary evidence.

### External and manual gates

The approved font families come from `design/DESIGN.md`. Do not fabricate upstream version data, checksums, license text, physical Kindle rendering, Google OAuth behavior, production-domain behavior, or deployment evidence.

Phases 79-91 must test fonts, focus, route reloads, and OAuth return routes on the release-candidate Kindle build. The human release owner supplies legal, privacy, OAuth consent, security-response, and deployment approvals.

## 9. Phases 67-78: Product screens

Phase 78 must apply this complete section before acceptance.

### Testing matrix

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

### Commands and gates

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

### Additional parent judge checks

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

### External and manual gates

Do not fabricate physical Kindle usability, Google account, OAuth consent, privacy, legal, production-domain, or deployment evidence. Do not claim that automated accessibility tests prove complete accessibility.

Phases 79-91 own release-candidate and human approval gates.

## 10. Phases 79-91: Compatibility, security, and release

Phase 91 must apply this complete section before acceptance.

### Testing matrix

| Requirement or invariant | Level | Cases and evidence |
| --- | --- | --- |
| Static Svelte app | Build/bundle | Relative files in `dist/`, no backend, exact CNAME |
| No SQLite/WebAssembly | Dependency/bundle | Import, package, and byte scans with negative fixtures |
| OAuth flow/scope | Unit/bundle/manual | Phase 0 regressions, no open/GIS, exact scope, Kindle redirect |
| Account cache/local save | Integration/manual | Account separation, reload, quota, Kindle IndexedDB |
| Validation/migration | Unit/build | All schemas/static, malformed/future unchanged, blank baseline and future fixtures |
| Synchronization | Property/integration/manual | Convergence, ambiguity, duplicate cleanup, Kindle network interruption |
| Session domain | Unit/product flow/manual | UUID, UTC, plans, terminal edits, scores, long scroll |
| Accessibility/e-ink | Component/browser/manual | Keyboard, focus, names, contrast review, font failure, Kindle |
| ES2019 | Parse/scan/device | Every executable output, bad syntax fixtures, physical load |
| Local assets | Build/bundle/manual | SVG, glyph, font, license, same-origin, visual glyph review |
| Security/privacy | Static review/manual | CSP, endpoint/secret/telemetry scans, approvals |
| Export/delete/disconnect | Integration/browser/manual | Unknown export, partial delete, revoke fallback, privacy review |
| Recovery | Integration/manual | Offline warm/empty, corrupt/future, storage error, ambiguous upload |
| Human deployment handoff | Diff/manual | Reviewed digest, manifest, approvals, rollback notes, and no agent push action |

All automated tests use deterministic clocks, UUIDs, storage fakes, and Drive fakes where applicable. Manual evidence must identify the exact release-candidate digest.

### Commands and gates

Run the full release sequence with Bun:

```text
bun install --frozen-lockfile
bun run check
bun run test
bun run validate:schemas
bun run validate:static
bun run compare:production -- --first-release
bun run build:fonts
bun run build
bun run check:compat
bun run test:bundle
bun run audit:release
bun run test:browser
bun run verify:release-evidence
```

Expected outcome:

- Automated tooling for gates 1-12 passes. Gates that need approved canonical content remain `NOT PROVIDED` until human review.
- Gate 7 records the blank first-release decision. It makes no prior-release network request.
- Gate 11 reports measured size and file count with unlimited thresholds.
- Gate 13 requires recorded human diff review.
- Gate 14 requires conventional browser and physical Kindle evidence.
- Gate 15 requires real privacy, OAuth, domain, security-response, and legal approvals.
- The coding agent stops after handoff and performs no deployment or `git push`.

A `NOT PROVIDED` manual gate is not a command failure. It is a production-release blocker.

### Additional parent judge checks

- Inspect source and generated `dist/` diffs separately.
- Confirm all Section 18 gates 1-15 map to Phase 79 through Phase 91 and evidence states.
- Confirm every Section 20 row has implementation, automated test, and manual gate where applicable.
- Confirm no Phase 0 redesign, GIS, popup, tab, refresh token, broader scope, or backend exists.
- Confirm no UI direct `fetch`/IndexedDB and no domain infrastructure imports.
- Review malformed, negative, recovery, reload, ambiguity, and concurrency tests from all phases.
- Confirm no SQLite, WebAssembly, telemetry, service worker, remote UI code, source map, token, or secret in output.
- Confirm every executable parses as ES2019 and lacks prohibited syntax.
- Confirm fonts, glyphs, SVGs, licenses, CNAME, unlimited-budget measurements, the blank first-release marker, and future comparison fixtures.
- Confirm production config uses a public client ID only.
- Confirm bundle diff approval and manual evidence reference the exact artifact digest.
- Distinguish defects from external evidence:
  - An unsafe bundle, failed test, leaked data, wrong route, or missing required flow is an implementation defect.
  - A missing Kindle tester, legal approval, OAuth approval, domain proof, content approval, or deployment authorization is unavailable external evidence.
- Reject the phrase `production release approved` unless the human release owner supplies every required approval.
- Permit `release-candidate implementation complete` only when code and automated gates pass and blockers are listed.
- Inspect release scripts and instructions. Reject any coding-agent deployment, publication, remote push, or `git push` action.

### External and manual gates

Never fabricate:

- Physical Kindle model, Silk version, tester, result, screenshot, or device behavior.
- Google Cloud project separation, production client ID, OAuth consent, scope approval, domain verification, or revocation evidence.
- Privacy-policy approval, consumer-health legal review, data-request process, security review, or breach-response procedure.
- Production-content approval, production-diff approval, deployment authorization, DNS state, published commit, or live-domain result.

`design/DESIGN.md` is the font-family approval. The unlimited parser and bundle decisions need no numeric approval. The human release owner supplies the remaining manual evidence.

A complete implementation with missing manual evidence is a release candidate only. A coding agent always stops after handoff. Production release approval and deployment remain human actions.
