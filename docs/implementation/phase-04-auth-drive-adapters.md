# Phase 4 execution plan: authentication and Drive adapters

## 1. Mission

Move the proven Phase 0 authorization flow behind production adapter interfaces. Add a complete typed Drive REST adapter and deterministic catalog fakes.

The phase is complete when the redirect lifecycle remains behaviorally identical to Phase 0. Only `drive.appdata` is requested. Account binding gates private storage. Drive pagination, stable IDs, errors, revocation, and duplicate-catalog coordination pass deterministic tests.

## 2. Authority and required reading

Read these sources before editing:

- `AGENTS.md`.
- `docs/PHASE-0-AUTHORIZATION-PROOF.md`, in full. Treat its flow as frozen evidence.
- `docs/REQUIREMENTS.md`, Sections 2, 3.2, 4, 14, and 21.5-21.7.
- `docs/ARCHITECTURE.md`, Sections 2, 4 through 7, 8 Account Lifecycle, 9 through 11, 14 through 20, and 19 Phase 4.
- `specs/storage-and-lookup.md`, Drive Catalog, Synchronization, User Data Deletion, and Failure and Recovery.
- Phase 3 account and repository ports.
- Existing `src/google-identity.ts`, `src/google-drive.ts`, `src/App.svelte`, `src/main.ts`, `tests/google-identity.test.ts`, `scripts/check-browser-compat.ts`, and `vite.config.ts`.

Apply Architecture Section 2 precedence. Architecture resolves the older GIS and popup language. The production flow is the tested full-page implicit redirect.

Do not reinterpret these decisions:

- Do not introduce GIS, authorization codes, PKCE, popups, tabs, `window.open`, refresh tokens, or a backend token exchange.
- Request only `https://www.googleapis.com/auth/drive.appdata`.
- Keep secure 30-minute state in both browser stores.
- Keep the 60-second credential-free callback receipt and exact-token duplicate check.
- Remove the fragment before Svelte mounts, private data opens, or diagnostics run.
- Store unremembered tokens in `sessionStorage`. Store remembered tokens in `localStorage` until exact expiry.
- Call Drive `about.get` for account binding before selecting an IndexedDB namespace.
- Use hidden form and iframe revocation plus Drive `401` confirmation.
- Preserve stable Drive file IDs and complete catalog pagination.

Use Bun and TypeScript only. Keep Svelte/Vite, static `dist/`, ES2019, and Kindle support. Use no SQLite, WebAssembly, optional chaining, or nullish coalescing in the bundle. Use `REP JOT` in visible text.

## 3. Starting-state contract

Expected prerequisites:

- Phase 0 tests and proof remain present and passing.
- Phase 3 provides account selection and storage ports.
- Phase 2 provides the document pipeline used to classify downloaded copies.

Verify the frozen authorization tests first. Run `bun test tests/google-identity.test.ts` and `bun run check:compat`. Inspect the bundle gate for `window.open` and the exact scope. Run Phase 3 tests.

If a Phase 0 case fails, stop. Restore behavior from the existing tested source and proof. Do not redesign the flow. If the Phase 3 account gate is absent, report the missing prerequisite. Do not open a private namespace directly from an OAuth callback.

The existing `src/google-drive.ts` is a hello-world prototype. The existing `App.svelte` depends on it. Build production adapters beside the prototype. Remove prototype UI only in Phase 7 after replacement behavior has tests.

## 4. In scope and out of scope

### In scope

- Auth service, OAuth browser adapter, redirect callback bootstrap, and token expiry.
- Account binding, switch, sign-out, disconnect, and revocation fallback contracts.
- Drive adapter interface and REST implementation for list, content, create, update, metadata, delete, generate IDs, and about.
- Complete pagination and recognized-name grouping.
- Stable error categories, retry metadata, and authorization transitions.
- Duplicate-catalog orchestration with an injected content consolidator.
- Deterministic browser, fetch, clock, storage, and Drive fakes.

Primary requirement IDs: 2.1-2.15, 3.2, 4.5, 14.2-14.4, and 21.5-21.7 at service level. This phase owns the Section 20 redirect-only OAuth and Drive adapter rows. It owns catalog mechanics for stable IDs and duplicates. Phase 5 owns merge content and end-to-end consolidation.

### Out of scope

- Three-way merge, tombstone rules, retries, and full synchronization state machine.
- Product Settings UI or destructive confirmation.
- Broad Drive scopes, profile/email scopes, or refresh behavior.
- Changes API.
- Claims from a new physical Kindle test.

Introduce `DriveAdapter`, `OAuthRedirectAdapter`, `TokenStore`, `BrowserLocation`, `DriveAbout`, and `DuplicateContentConsolidator` interfaces. Phase 5 supplies the real duplicate-content implementation.

## 5. Required deliverables

| Deliverable | Recommended path | Architecture link | Source control |
| --- | --- | --- | --- |
| Auth service | `src/auth/auth-service.ts` | Sections 7, 10, 17, and 20 | Yes |
| OAuth adapter | `src/auth/oauth-redirect-adapter.ts` | Sections 7, 10, 14, and 19 Phase 4 | Yes |
| Auth ports | `src/ports/oauth.ts`, `src/ports/token-store.ts` | Section 7 dependency direction | Yes |
| Drive interface | `src/drive/drive-interface.ts` or `src/ports/drive.ts` | Sections 7 and 20 | Yes |
| REST adapter | `src/drive/drive-rest-adapter.ts` | Sections 7, 11, and 17 | Yes |
| Catalog service | `src/drive/drive-catalog.ts`, `src/drive/duplicate-coordinator.ts` | Sections 11, 17, and 20 | Yes |
| Typed Google errors | `src/drive/drive-errors.ts` | Section 16 | Yes |
| Fakes | `tests/fakes/fake-drive.ts`, `fake-browser.ts`, `fake-token-store.ts` | Section 17 | Yes |
| Tests | `tests/auth-service.test.ts`, `oauth-redirect-adapter.test.ts`, `drive-rest-adapter.test.ts`, `drive-catalog.test.ts` | Sections 17 and 19 Phase 4 | Yes |

Do not commit access tokens, client secrets, account IDs, recorded Google payloads with identifiers, or manual test captures. Sanitized protocol fixtures belong in source control.

## 6. Ordered execution tasks

- [ ] **P4-T01 — Characterize and freeze Phase 0 behavior**
  - **Objective:** Convert every Phase 0 behavior into deterministic regression cases before moving code.
  - **Prerequisites:** Phases 0-3 verified.
  - **Inspect:** Phase 0 proof, `src/google-identity.ts`, existing tests, and callback bootstrap order.
  - **Create or edit:** `tests/oauth-redirect-adapter.test.ts`, `tests/fakes/fake-browser.ts`, and existing auth tests.
  - **Steps:** Cover checked and unchecked continuity, lost session state, expiry, denial, invalid state, exact-token replay, replay expiry, account switch, sign-out, revocation, and fallback. Assert fragment removal order.
  - **Edge cases:** Cover a different replay token, malformed stored token, missing returned denial state, unsupported token type, missing scope, unavailable secure random, and invalid return route.
  - **Tests or fixtures:** Use fixed clocks and deterministic secure bytes. Do not weaken secure-random production behavior.
  - **Validation:** `bun test tests/google-identity.test.ts tests/oauth-redirect-adapter.test.ts`; `bun run check:compat`.
  - **Acceptance:** Every P0-01 through P0-08 behavior has an automated regression. No test opens a secondary browsing context.

- [ ] **P4-T02 — Extract browser ports and the OAuth redirect adapter**
  - **Objective:** Preserve behavior while isolating location, history, storage, form, iframe, timer, and crypto APIs.
  - **Prerequisites:** P4-T01.
  - **Inspect:** `src/google-identity.ts`, `src/main.ts`, and Architecture Section 10.
  - **Create or edit:** `src/ports/oauth.ts`, `src/auth/oauth-redirect-adapter.ts`, and auth tests.
  - **Steps:** Move pure parsing and state rules behind injected browser ports. Keep `location.replace`. Keep dual-store pending state. Remove the fragment before returning accepted authorization. Retain receipt semantics exactly.
  - **Edge cases:** Cover `history.replaceState` absence, storage exceptions, repeated callback document execution, malformed fragment encoding, and a fragment unrelated to OAuth.
  - **Tests or fixtures:** Add call-order assertions for fragment cleanup, token save, account bind request, and UI mount handoff.
  - **Validation:** `bun test tests/oauth-redirect-adapter.test.ts`; `bun run check`; `bun run check:compat`.
  - **Acceptance:** The adapter never calls `window.open`. The request URL has one exact scope and `response_type=token`.

- [ ] **P4-T03 — Implement auth service lifecycle and account gate**
  - **Objective:** Coordinate restored/new tokens, exact expiry, Drive binding, and selected storage namespace.
  - **Prerequisites:** P4-T02 and Phase 3 account port.
  - **Inspect:** Architecture Sections 8-10 and Phase 3 account repository.
  - **Create or edit:** `src/auth/auth-service.ts`, `src/ports/token-store.ts`, and `tests/auth-service.test.ts`.
  - **Steps:** Bind every token with Drive about. Select the namespace only after success. Clear expired or malformed records. Enter `reauthorization_required` on expiry or authorization errors without deleting pending edits. Preserve prior hash route.
  - **Edge cases:** Cover restored token bound to another account, about failure, `401`, authorization `403`, account switch, timer limit, sign-out, and same-account reauthorization.
  - **Tests or fixtures:** Use fixed clocks, two accounts, a fake about adapter, and a spy repository gate.
  - **Validation:** `bun test tests/auth-service.test.ts`; `bun run check`.
  - **Acceptance:** No private repository read occurs before successful token-to-account binding. Sign-out keeps cached data inaccessible.

- [ ] **P4-T04 — Implement revocation and disconnect service behavior**
  - **Objective:** Preserve hidden-form revocation, Drive rejection confirmation, cleanup timing, and fallback.
  - **Prerequisites:** P4-T03.
  - **Inspect:** Phase 0 P0-07/P0-08, Requirements 2.13 and 21.5-21.7.
  - **Create or edit:** OAuth adapter revocation code, auth service disconnect flow, and tests.
  - **Steps:** Submit the token in a transient hidden form to the exact Google endpoint. Target a hidden iframe. Poll Drive about until `401` or timeout. Clear selected local account only after confirmation. Retain local state and expose the account-connections URL on failure.
  - **Edge cases:** Cover expired token requiring reauthorization, network loss, non-401 response, submit error, timeout, repeated disconnect, and cleanup after completion.
  - **Tests or fixtures:** Add deterministic timers and DOM fakes. Assert no visible secondary window.
  - **Validation:** `bun test tests/auth-service.test.ts tests/oauth-redirect-adapter.test.ts`; `bun run check:compat`.
  - **Acceptance:** Failed revocation never reports success or clears local data. Confirmed revocation clears authorization and only the selected namespace.

- [ ] **P4-T05 — Define the complete Drive adapter contract**
  - **Objective:** Give application services stable typed operations without exposing `fetch`.
  - **Prerequisites:** P4-T03.
  - **Inspect:** Architecture Section 11 requests and metadata fields.
  - **Create or edit:** `src/drive/drive-interface.ts`, `src/drive/drive-errors.ts`, and contract tests.
  - **Steps:** Define list pages, read bytes, metadata read, generated IDs, create with supplied ID, update, delete, and about. Include response metadata and retry headers. Classify authentication, rate, quota, retryable server, network, timeout, malformed, and ambiguous errors.
  - **Edge cases:** Keep missing file distinct from malformed response. Preserve optional checksum/version/size fields. Never expose raw response bodies in safe errors.
  - **Tests or fixtures:** Add type-level fixtures and redaction assertions.
  - **Validation:** `bun test tests/drive-rest-adapter.test.ts`; `bun run check`.
  - **Acceptance:** Application and domain code can use the interface without importing Fetch or DOM types.

- [ ] **P4-T06 — Implement Drive REST transport and pagination**
  - **Objective:** Implement exact appDataFolder requests and complete page traversal.
  - **Prerequisites:** P4-T05.
  - **Inspect:** Existing `src/google-drive.ts`, Architecture Section 11, and storage spec Drive Catalog.
  - **Create or edit:** `src/drive/drive-rest-adapter.ts`, `tests/drive-rest-adapter.test.ts`, and fetch fixtures.
  - **Steps:** Send bearer tokens only in HTTPS headers. Use exact catalog fields, `spaces=appDataFolder`, `trashed=false`, and page size 1000. Implement content, metadata, generate-ID, create-with-ID, update-in-place, delete, and about requests.
  - **Edge cases:** Cover multiple pages, empty pages with token, token loops, malformed JSON, `204`, `404`, `401`, authorization `403`, quota `403`, `429`, retryable `5xx`, timeout, and unreadable response.
  - **Tests or fixtures:** Use a request-recording fetch fake. Assert no token enters URL, error, or diagnostics.
  - **Validation:** `bun test tests/drive-rest-adapter.test.ts`; `bun run check`; `bun run check:compat`.
  - **Acceptance:** Every page is followed once. Normal updates retain file IDs. Creates accept a reserved generated ID.

- [ ] **P4-T07 — Group recognized names and coordinate duplicate cleanup**
  - **Objective:** Own catalog classification and safe cleanup mechanics while deferring content merge policy to Phase 5.
  - **Prerequisites:** P4-T06 and Phase 2 pipeline.
  - **Inspect:** Architecture Section 11 Duplicate Consolidation and conflict requirements.
  - **Create or edit:** `src/drive/drive-catalog.ts`, `src/drive/duplicate-coordinator.ts`, `src/ports/duplicate-content-consolidator.ts`, and `tests/drive-catalog.test.ts`.
  - **Steps:** Recognize exact canonical names. Preserve unknown entries. Group duplicates. Select the lexicographically smallest file ID only as primary. Download and validate every copy through the pipeline. Invoke an injected consolidator. Preflight every metadata record. Update/read primary, delete unchanged redundant IDs, then relist.
  - **Edge cases:** Block corrupt, unsupported, family-mismatched, repeatedly changing, or deletion-raced groups. Never delete an unknown file. Never treat primary selection as content selection.
  - **Tests or fixtures:** Use a fake consolidator that proves all valid inputs reach it. Add metadata-change barriers and partial-delete cases.
  - **Validation:** `bun test tests/drive-catalog.test.ts tests/drive-rest-adapter.test.ts`; `bun run check`.
  - **Acceptance:** Catalog mechanics preserve every input until a validated consolidated primary exists. Unsafe groups return `DuplicateDriveFileError`.

- [ ] **P4-T08 — Provide deterministic Drive and browser fakes**
  - **Objective:** Give Phase 5 controllable concurrency, ambiguity, and reload behavior.
  - **Prerequisites:** P4-T01 through P4-T07.
  - **Inspect:** Architecture Section 17 fake Drive requirements.
  - **Create or edit:** `tests/fakes/fake-drive.ts`, fake browser/token store files, and fake self-tests.
  - **Steps:** Model stable IDs, duplicate names, pages, metadata versions, request barriers, response drops before and after commit, and account about results. Record requests without tokens.
  - **Edge cases:** Cover create ambiguity, update ambiguity, post-read overwrite, metadata races, pagination, and unknown files.
  - **Tests or fixtures:** Add fake contract tests so Phase 5 does not rely on fake bugs.
  - **Validation:** `bun test tests/fakes/fake-drive.test.ts`; `bun run check`.
  - **Acceptance:** Tests can pause preflight, update, and post-read independently. The same fake state survives a simulated application reload.

- [ ] **P4-T09 — Integrate adapter boundaries and preserve prototype compatibility**
  - **Objective:** Export production services without forcing Phase 4 to implement product screens.
  - **Prerequisites:** P4-T01 through P4-T08.
  - **Inspect:** All imports of `google-identity` and `google-drive`, plus the full diff.
  - **Create or edit:** Thin compatibility exports only where current prototype compilation requires them. Do not extend hello-world behavior.
  - **Steps:** Route tested auth behavior to new modules. Keep the prototype compiling until Phase 7 replaces `App.svelte`. Mark prototype Drive functions obsolete in source comments if necessary. Do not delete them while imported.
  - **Edge cases:** Avoid two token stores or two callback consumers. Bootstrap must call exactly one callback path.
  - **Tests or fixtures:** Run old and new authorization tests together. Add an import-boundary test.
  - **Validation:** `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run build`, `bun run check:compat`.
  - **Acceptance:** Broad checks pass. One auth implementation owns storage. Product code has typed Drive ports ready for Phase 5.

## 7. Testing matrix

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

## 8. Commands and gates

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

## 9. Judge checklist

- Inspect the diff against Phase 0 source and proof. Reject any unapproved flow change.
- Confirm no GIS script, code flow, PKCE, popup, tab, refresh token, or broader scope exists.
- Confirm fragment removal precedes private data access and UI mount.
- Confirm every restored token repeats account binding.
- Confirm UI and domain modules do not call `fetch`.
- Inspect request fixtures for token leakage in URLs and errors.
- Review negative tests for replay, expiry, malformed storage, authorization errors, pagination, and duplicate races.
- Confirm stable update IDs and generated create IDs.
- Confirm Phase 4 duplicate work owns catalog mechanics. Phase 5 still owns content merge and end-to-end convergence.
- Do not require prototype deletion while `App.svelte` imports it. Reject new hello-world features.
- Treat new physical Kindle evidence as unavailable unless a tester supplies it.
- Treat scope expansion, early cache access, token leakage, incomplete pagination, or unsafe deletion as implementation defects.
- Confirm Section 18 gates 1, 2, 8 fixture configuration, and 9 remain covered.
- Confirm Section 20 OAuth, Drive appData, and stable catalog rows have tests.

## 10. Completion report format

```text
Phase 4 completion report
Completed task IDs:
Files changed:
Commands run and results:
Acceptance criteria satisfied:
Remaining risks or blockers:
Manual evidence still required:
```

List preserved Phase 0 cases. State whether physical Kindle evidence is old Phase 0 evidence or a new run.

## 11. External and manual gates

Do not fabricate Google Cloud configuration, consent-screen approval, production OAuth IDs, domain verification, live account results, revocation behavior, or physical Kindle evidence.

Phase 0 fixes the required behavior, but its results table lacks device, build, tester, and evidence metadata. Do not use its blank PASS rows as release evidence. Phase 9 requires a documented regression against the exact release candidate. Privacy, legal, security-response, production-domain, and deployment approvals remain external.
