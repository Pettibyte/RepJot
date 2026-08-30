# Phase 9 execution plan: compatibility, security, and release

## 1. Mission

Harden the complete application and produce a reviewable release candidate in `dist/`. Collect only real automated and manual evidence.

The phase has two distinct outcomes:

1. **Release-candidate implementation complete:** All code, bundle, automated, and documented release controls pass.
2. **Production release approved:** The human release owner completes every physical Kindle, Google, privacy, legal, security, domain, diff-review, and deployment gate.

The first outcome does not imply the second. Coding agents prepare the release candidate and handoff only. They never deploy and never run `git push`.

## 2. Authority and required reading

Read these sources before editing:

- `AGENTS.md`.
- `docs/REQUIREMENTS.md`, all sections, especially 2, 3.8, 7, 8, and 14.
- `docs/ARCHITECTURE.md`, all sections, especially 2, 4, 14, 15, 17, 18, 19 Phase 9, 20, and 21.
- `docs/CAPABILITIES-kindle-scribe.md`, in full.
- `docs/PHASE-0-AUTHORIZATION-PROOF.md`, in full.
- All three data specifications and all schemas.
- `design/DESIGN.md` and the day-of brief browser constraints.
- `package.json`, `bun.lock`, `tsconfig.json`, `vite.config.ts`, all scripts, source, tests, static assets, and generated `dist/`.
- Actual Phase 1-8 repository output and tests. Read completion reports only when they exist in the repository. Do not require transcript memory.

Apply Architecture Section 2 precedence. Do not weaken a higher-authority requirement to pass a release gate.

Binding decisions:

- The application is static Svelte/TypeScript/Vite output in `dist/`.
- Production origin is `https://repjot.com`.
- OAuth remains the Phase 0 full-page implicit redirect with exact `drive.appdata` scope and callback receipt.
- No backend, SQLite, WebAssembly, GIS, popup, tab, refresh token, telemetry, service worker, Wake Lock, or Web Share.
- Bundle parses as ES2019 classic script and has no optional chaining or nullish coalescing.
- Assets are same-origin. Runtime SVG source, remote UI assets, and CDN code are forbidden.
- CSP permits only required same-origin, Google authorization/revocation, and Drive connections.
- Build output contains no secret, token, source map, telemetry endpoint, or unexpected remote code.
- Release automation uses a frozen Bun lockfile.
- A physical Kindle smoke test remains mandatory.
- The first release has no prior canonical static bundle. Gate 7 uses an explicit blank-baseline path.
- Manual approvals cannot be replaced by test output.
- The human release owner supplies Google, legal, security, domain, bundle-diff, and deployment approvals.
- Coding agents do not deploy, publish, or run `git push`.
- Every user-facing brand reference is `REP JOT` in all caps.

Use Bun commands only. Use TypeScript for project and script source. Direct JavaScript source files in `src/public/` are obsolete prototype assets. Convert required probe behavior to TypeScript-generated output before release, then remove obsolete source files after equivalent tests pass. Generated JavaScript belongs only in `dist/`.

## 3. Starting-state contract

Expected outputs from Phases 1-8:

- Complete schema, semantic, static, blank-baseline, and future-release compatibility validators.
- Ordered document pipeline and migration framework.
- Account-scoped IndexedDB repositories and diagnostics.
- Frozen Phase 0 auth behavior and complete Drive adapters.
- Convergent synchronization with durable pending edits and stable IDs.
- Session domain, bounded indexes, and history loading.
- Hash shell, shared accessible UI, local asset pipeline, and every required screen.

Verify each output by running its focused tests and examining paths. Reconstruct status from the repository when no persisted completion report exists. Run the broad checks before any release edit. Inspect the repository diff and generated `dist/` separately.

If a prerequisite phase is incomplete, stop production-release work. Return the missing task IDs and affected gates to that phase. Phase 9 can integrate or strengthen earlier work, but it must not hide missing behavior with release scripts.

## 4. In scope and out of scope

### In scope

- Final ES2019, prohibited-syntax, classic-loader, dependency, endpoint, secret, source-map, and telemetry scans.
- CSP meta policy and static-host security review.
- Local asset, SVG, font, license, CNAME, size-measurement, and file-count measurement gates.
- Blank first-release baseline handling and future-release comparison tooling.
- Production OAuth public configuration injection and secret exclusion.
- Conventional browser automation and manual smoke procedure.
- Physical Kindle release-candidate procedure and evidence template.
- Human-only deployment handoff instructions and a production-bundle diff.
- A draft privacy policy at `https://repjot.com/privacy.html`.
- Privacy, OAuth consent, owned-domain, security-response, legal, and deployment gate tracking.
- Release evidence manifest with `PASS`, `FAIL`, or `NOT PROVIDED` states.

Primary requirement IDs: 2.1-2.14 release regression, 3.8, 7.1-7.5, 8.1-8.10 bundle integration, 14.1-14.10, and all prior requirements as release regressions. Requirement 14.11 remains a permitted later-release item with no first-release gate. This phase integrates every Section 20 row. It owns all Section 18 build gates and the deployment-handoff controls.

### Out of scope

- Redesigning product behavior or Phase 0.
- Creating or approving production exercise or workout content.
- Giving legal approval to the drafted privacy policy.
- Claiming production approval from automated evidence.
- Moving hosts unless a documented GitHub Pages security blocker triggers Architecture risk R-06 review.
- Adding telemetry to measure release behavior.

### Resolved decisions and manual owners

- The source checkout is `../free-exercise-db`. Workers create curation processes and synthetic test data only.
- A human must approve curated production content before canonical files are written or released.
- No prior canonical static release exists. Gate 7 starts from a blank baseline.
- `design/DESIGN.md` approves Inter, JetBrains Mono, and Material Symbols. Workers pin official releases, checksums, and licenses.
- Release one has unlimited application-level parser size, nesting, and node counts. Later Kindle stress testing can support reviewed limits.
- Bundle size and file count are unlimited. Gate 11 measures and reports them but has no threshold.
- The privacy URL is `https://repjot.com/privacy.html`. This phase drafts the policy from the binding facts in this plan.
- REP JOT has no application backend. The operator does not receive or store workout records, preferences, Drive files, access tokens, or browser-cache content.
- The browser stores local cache and pending edits. Google Drive stores canonical user data in `appDataFolder`.
- Cloudflare proxies the static site and supplies anonymized aggregate metrics. REP JOT adds no application telemetry.
- The human release owner supplies and approves Google configuration, consent, domain evidence, legal review, security procedures, bundle diff, and deployment.
- Coding agents must stop after handoff. They must never deploy, publish, or run `git push`.

Missing human evidence remains `NOT PROVIDED`. It blocks production approval, not implementation.

### Privacy policy draft

Use this draft as the source text for `src/public/privacy.html`. The human release owner must approve it and replace bracketed fields before release.

> **REP JOT Privacy Policy**
>
> **Effective date:** [Human release owner inserts the approved date.]
>
> REP JOT is a static fitness journal operated by Pettibyte LLC. REP JOT has no application backend. Pettibyte LLC does not receive or store your workout results, exercise preferences, Google Drive files, Google access token, or browser cache.
>
> **Google Drive data.** If you connect Google, REP JOT requests only permission to use its private Google Drive `appDataFolder`. REP JOT stores your preferences and workout results there. Google stores and processes this data under your Google account and Google's terms. REP JOT does not request access to your other Drive files, email, or profile data.
>
> **Data on your device.** REP JOT uses browser storage for authorization state, short-lived access tokens, an account-scoped cache, pending edits, and local diagnostic events. The remember option stores the token in local browser storage until its exact expiry. Otherwise, REP JOT stores it for the browser session. Local diagnostics stay on your device unless you choose to download them. Clearing browser data can erase unsynchronized edits.
>
> **Site delivery and aggregate metrics.** Cloudflare proxies `repjot.com` and can process ordinary request metadata needed to deliver and protect the site. Pettibyte LLC receives anonymized aggregate metrics from Cloudflare. REP JOT adds no application telemetry, advertising, behavioral analytics, or automatic diagnostic upload.
>
> **How REP JOT uses data.** The application uses your data only to provide workout entry, history, preferences, synchronization, export, deletion, and account actions. Pettibyte LLC does not sell your fitness data or use it for advertising or profiling. Google receives OAuth and Drive requests when you use connected features.
>
> **Export, deletion, and disconnect.** Settings lets you export raw files from the Google Drive `appDataFolder`. Diagnostic export is a separate local action. Delete All User Data removes recognized REP JOT files after confirmation. Disconnect Google Account revokes access and clears the selected local account data, but it does not delete Drive data. These are separate actions.
>
> **Retention and security.** Pettibyte LLC retains no application copy because REP JOT has no backend. Google Drive data remains until you delete it. Browser data remains until REP JOT or the browser clears it. Access tokens expire automatically. Browser storage has browser-profile protection only and is not encrypted by REP JOT. REP JOT uses HTTPS and limits Google access to `drive.appdata`.
>
> **Your choices.** You can use export, deletion, disconnect, and sign-out controls in Settings. [Human release owner inserts the approved process for privacy or data-access requests.]
>
> **Changes to this policy.** Pettibyte LLC can update this policy when REP JOT behavior or legal requirements change. The policy will show a new effective date.
>
> **Contact.** [Human release owner inserts the approved privacy contact details.]

The final HTML must use local styles and no script, tracker, remote font, or third-party policy widget.

## 5. Required deliverables

| Deliverable | Recommended path | Architecture link | Source control |
| --- | --- | --- | --- |
| Bundle audit | `scripts/test-bundle.ts` | Sections 14, 15, 18 gates 9-12, and 20 | Yes |
| Dependency/license audit | `scripts/audit-release.ts` | Sections 15 and 18 gates 10-11 | Yes |
| CSP and policy | `src/index.html` plus tested policy helper if needed | Sections 15 and 18 | Yes |
| Capability probe build | TypeScript sources under `scripts/` or `src/capabilities/`, generated only into `dist/` | Sections 14 and 18 gate 14 | Yes for TypeScript source, no direct JavaScript source |
| Release manifest | `release/release-evidence.json` or typed equivalent without secrets | Sections 18-20 | Yes for template and approved evidence references |
| Release runbook and human-only handoff | `docs/RELEASE.md` | Sections 18 and 19 Phase 9 | Yes |
| Privacy policy draft | `src/public/privacy.html` | Requirements 14.1, 14.5-14.7 and Sections 15, 18, 20 | Yes |
| Kindle checklist | `docs/release/KINDLE-SMOKE.md` | Sections 14, 17, and 18 gate 14 | Yes |
| Security/privacy checklist | `docs/release/LAUNCH-GATES.md` | Sections 15, 18 gate 15, and 20 | Yes |
| Blank first-release marker and future baseline manifest | Approved Phase 1 path | Sections 18 gate 7 and 20 | Yes, after human content approval |
| Release candidate | `dist/**` | Sections 18 and 20 | Yes only under established generated-output policy |
| Tests | `tests/bundle.test.ts`, `tests/security-policy.test.ts`, `tests/release-gates.test.ts` | Sections 17-20 | Yes |

Do not commit secrets, tokens, personal account IDs, raw diagnostic files, unredacted screenshots, or private legal documents. Commit the public privacy draft and evidence references when repository policy permits them. Do not commit unapproved production fitness data.

## 6. Ordered execution tasks

- [ ] **P9-T01 — Audit prerequisite ownership and full traceability**
  - **Objective:** Map every Section 20 row and every requirement to implemented code and evidence.
  - **Prerequisites:** Phases 1-8 complete.
  - **Inspect:** Architecture Sections 18-20, all completion reports, actual tests, and the full diff.
  - **Create or edit:** `release/release-evidence.json`, `tests/release-gates.test.ts`, and missing traceability notes.
  - **Steps:** Parse every numbered requirement ID from `docs/REQUIREMENTS.md`. Give each ID a primary phase/task, implementation path, automated evidence, manual evidence if required, and state. Also map every Section 20 row and every Section 18 gate. Mark absent evidence `NOT PROVIDED`.
  - **Edge cases:** A passing unit test cannot replace a physical/device/legal gate. A file path without a passing test is not evidence. Requirement 14.11 must be marked as an explicit later-release permission, not silently omitted.
  - **Tests or fixtures:** Validate evidence schema, allowed states, required owner, nonempty command references, and exact requirement-ID set equality with `docs/REQUIREMENTS.md`.
  - **Validation:** `bun test tests/release-gates.test.ts`, `bun run check`.
  - **Acceptance:** Every numbered requirement, traceability row, and build gate is mapped. No unavailable evidence is marked passed.

- [ ] **P9-T02 — Enforce frozen install, type, test, schema, and static gates**
  - **Objective:** Make Section 18 gates 1-4 reproducible from a clean dependency state.
  - **Prerequisites:** P9-T01.
  - **Inspect:** `package.json`, `bun.lock`, all validation commands, and static source inputs.
  - **Create or edit:** Package scripts, release audit tests, and runbook.
  - **Steps:** Require frozen install. Run strict Svelte/TypeScript checks. Run all unit/integration tests. Validate every schema and repository fixture. When approved static data exists, run canonical schema/semantic validation separately. Missing approved content changes only gate 4 evidence.
  - **Edge cases:** Lock drift, unavailable local source checkout, stale generated static files, skipped test, schema warning, and missing canonical file.
  - **Tests or fixtures:** Add command orchestration tests without bypass flags. Keep fixture and canonical results distinct.
  - **Validation:** `bun install --frozen-lockfile`, `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`.
  - **Acceptance:** Gates 1-3 pass. Gate 4 passes only after `bun run validate:static` succeeds on approved canonical inputs. Otherwise gate 4 is `NOT PROVIDED` or `FAIL`, and later release-tool tasks continue.

- [ ] **P9-T03 — Enforce trusted SVG, glyph, font, license, and local-asset gates**
  - **Objective:** Implement Section 18 gates 5-6 with the font families approved in `design/DESIGN.md`.
  - **Prerequisites:** P9-T01 and P9-T02 tooling. Missing gate 4 evidence does not block this task.
  - **Inspect:** `design/DESIGN.md`, official font sources, the static icon validator, font task, manifests, checksums, licenses, UI icon references, and `dist/` assets.
  - **Create or edit:** Asset audit code/tests and release runbook.
  - **Steps:** Select and pin official Inter, JetBrains Mono, and Material Symbols releases. Record source URLs and checksums. Include upstream licenses. Sanitize and resolve every SVG. Scan component glyph names against the manifest. Rebuild local subsets. Assert same-origin references, fallback text/names, checksums, font bytes, and copied licenses.
  - **Edge cases:** Unofficial source, checksum mismatch, missing glyph, stale manifest, remote CSS URL, data URL icon, malicious SVG, missing license, and font generation drift.
  - **Tests or fixtures:** Add hostile SVG and missing-glyph failures plus font-failure component coverage.
  - **Validation:** `bun run build:fonts`, `bun run validate:static:fixtures`, `bun test tests/ui/fonts.test.ts tests/ui/icon.test.ts tests/security-policy.test.ts`.
  - **Acceptance:** Asset tooling and fixture gates pass. Gate 5 also requires human-approved canonical icon references. Gate 6 passes when official pinned files, checksums, and licenses pass the audit. Runtime loads no remote font or UI asset. Font failure cannot hide an action.

- [ ] **P9-T04 — Record the blank first-release compatibility baseline**
  - **Objective:** Complete Section 18 gate 7 for a first release with no prior canonical static files.
  - **Prerequisites:** P9-T02 tooling. Human-approved current content is required only to record baseline digests.
  - **Inspect:** Phase 1 blank-baseline behavior, compatibility fixtures, candidate static files if approved, and the evidence schema.
  - **Create or edit:** A first-release marker, evidence record, and the future baseline manifest after human content approval.
  - **Steps:** Run explicit first-release mode without a network request. Record that no prior canonical release exists. Run all compatible and incompatible comparison fixtures. If the human approves current production content, record its exact digests as the baseline for the next release. Do not create baseline digests from test data or an unapproved candidate.
  - **Edge cases:** An unexpected existing manifest, an accidental network request, approved-content digest drift, test data at canonical paths, and an attempt to overwrite an approved baseline.
  - **Tests or fixtures:** Keep the blank-baseline fixture and all deterministic future comparison fixtures.
  - **Validation:** `bun run compare:production -- --first-release`.
  - **Acceptance:** Gate 7 passes when the blank first-release decision and fixture suite are recorded. The future baseline remains absent until a human approves canonical content.

- [ ] **P9-T05 — Build with production public configuration and exclude secrets**
  - **Objective:** Complete Section 18 gate 8 without placing a client secret in source, environment output, or `dist/`.
  - **Prerequisites:** P9-T03. P9-T04 evidence is independent and cannot block this tooling.
  - **Inspect:** Vite environment handling, `.env.example`, production client-ID source, and build output.
  - **Create or edit:** Typed environment validation, `vite.config.ts`, build tests, and runbook.
  - **Steps:** Require a syntactically valid public production web client ID. Refuse placeholder values. Keep test and production project IDs separate. Replace time-based build identifiers with an injected deterministic release ID. Add a release-fixture build mode with a fake public ID for tooling tests. Build relative static assets to `dist/`. Scan all output for secret-like config keys and known test IDs.
  - **Edge cases:** Missing ID, test ID in production mode, client secret variable, environment dump, time-based cache key, absolute development URL, and source map.
  - **Tests or fixtures:** Use fake public IDs only in explicit fixture mode. Never commit a secret.
  - **Validation:** `bun run build:release-fixture`, `bun test tests/bundle.test.ts`.
  - **Acceptance:** Build tooling completes without external credentials. Gate 8 is `NOT PROVIDED` until the real production public ID builds successfully. Repeated fixture and production builds from identical inputs are byte-identical. No secret or environment dump enters output.

- [ ] **P9-T06 — Harden ES2019 classic output and migrate probe sources**
  - **Objective:** Complete Section 18 gate 9 and remove direct JavaScript source from the repository source tree.
  - **Prerequisites:** P9-T05.
  - **Inspect:** `scripts/check-browser-compat.ts`, Vite output, inline loader, capability probe HTML/scripts, and `src/public/*.js`.
  - **Create or edit:** `scripts/test-bundle.ts`, TypeScript capability sources/build path, compatibility tests, and obsolete probe assets.
  - **Steps:** Parse every executable output as ES2019 with correct script mode. Scan for optional chaining and nullish coalescing. Assert classic loader definition/order and cache key. Convert required capability probe scripts to TypeScript-built output. Delete old direct JavaScript sources only after equivalent tests pass.
  - **Edge cases:** Inline executable script, dynamically generated chunk, module tag, deferred classic regression, duplicate `app.js`, prohibited syntax in dependency, and source map.
  - **Tests or fixtures:** Add deliberately invalid syntax fixtures and classic-loader order failures.
  - **Validation:** `bun run check:compat`; `bun run test:bundle`; `bun test tests/bundle.test.ts`.
  - **Acceptance:** Gate 9 passes for every executable file. Source contains no new direct JavaScript files. Generated JavaScript exists only in `dist/`.

- [ ] **P9-T07 — Enforce CSP, endpoint, token, telemetry, and dependency policy**
  - **Objective:** Complete Section 18 gate 10 and Architecture Section 15 controls.
  - **Prerequisites:** P9-T06.
  - **Inspect:** All network endpoints, CSP, dependencies, bundle strings, generated HTML, and licenses.
  - **Create or edit:** CSP meta policy, `scripts/audit-release.ts`, `tests/security-policy.test.ts`, and security runbook sections.
  - **Steps:** Allow same-origin assets, top-level Google authorization, exact revocation form/frame origin, and Drive HTTPS only. Scan for GIS, unexpected remote code, telemetry, ad/analytics endpoints, tokens, client secrets, raw source maps, unsafe HTML, and service-worker registration. Review dependency licenses and vulnerabilities without auto-ignoring findings.
  - **Edge cases:** URL hidden in minified strings, source map comment, inline loader hash mismatch, broad wildcard CSP, `innerHTML`, remote SVG, and diagnostic upload path.
  - **Tests or fixtures:** Add bad endpoint, secret, source-map, telemetry, and CSP fixtures.
  - **Validation:** `bun run audit:release`; `bun test tests/security-policy.test.ts`; `bun run test:bundle`.
  - **Acceptance:** Gate 10 passes with no unexpected endpoint, secret, token, telemetry, source map, or remote code. GitHub Pages header limits remain documented as R-06.

- [ ] **P9-T08 — Measure bundle size and file count without thresholds**
  - **Objective:** Complete Section 18 gate 11 under the approved unlimited budget decision.
  - **Prerequisites:** P9-T07.
  - **Inspect:** `dist/`, font assets, duplicate chunks, and Architecture risk R-04.
  - **Create or edit:** Size and file-count report code, release audit tests, and evidence.
  - **Steps:** Measure each output file, each major asset class, total uncompressed bytes, total compressed bytes where deterministic, and file count. Compare against the current candidate and any later baseline for information only. Do not reject output because of byte size or file count. Keep failures for forbidden files, duplicate chunks, source maps, and other independent gates.
  - **Edge cases:** Compression ambiguity, font growth, duplicate app chunks, source maps, a missing baseline, zero-byte assets, and nondeterministic output.
  - **Tests or fixtures:** Add deterministic report-shape, duplicate-file, forbidden-file, and zero-byte tests. Do not add one-byte-over budget tests.
  - **Validation:** `bun run audit:release`; `bun run test:bundle`.
  - **Acceptance:** Gate 11 passes when measurements are complete and reproducible. The report states `unlimited` for size and file-count thresholds. It makes no Kindle memory claim.

- [ ] **P9-T09 — Validate CNAME, static portability, and bundle diff**
  - **Objective:** Complete Section 18 gates 12-13 before human release handoff.
  - **Prerequisites:** P9-T07. P9-T08 budget evidence is independent.
  - **Inspect:** `src/public/CNAME`, `dist/CNAME`, relative asset paths, prior `dist/`, and deployment process.
  - **Create or edit:** Bundle audit, `docs/RELEASE.md`, and evidence references.
  - **Steps:** Assert exact `repjot.com` CNAME. Assert no GitHub runtime API dependency or path tied to the default Pages host. Generate a production-bundle diff and file manifest. Give both to the human release owner. Do not publish or run `git push`.
  - **Edge cases:** Trailing whitespace in CNAME, absolute asset URL, missing file, unexpected deletion, generated cache key noise, and unreviewed binary change.
  - **Tests or fixtures:** Add CNAME and portability failures. Keep review result external until supplied.
  - **Validation:** `bun run build`; `bun run test:bundle`; `bun run audit:release`.
  - **Acceptance:** Gate 12 is automated. Gate 13 stays `NOT PROVIDED` until an authorized reviewer records approval.

- [ ] **P9-T10 — Run conventional browser release-candidate tests**
  - **Objective:** Complete the conventional-browser part of Section 18 gate 14.
  - **Prerequisites:** P9-T06, P9-T07, and P9-T09. Human content approval and the informational size report do not block smoke-tool implementation.
  - **Inspect:** Product flow tests, release candidate, and launch routes.
  - **Create or edit:** Browser smoke harness in TypeScript and `docs/RELEASE.md`.
  - **Steps:** Serve the exact release candidate with a Bun-driven test harness. Exercise anonymous landing, route reloads, fake-auth account gates where automation permits, local save/reload, histories, exports, and accessibility smoke. Record browser/version and artifact digest.
  - **Edge cases:** Direct hash URL, offline warm state, storage denial, font failure, long workout, object URL cleanup, and no service worker.
  - **Tests or fixtures:** Keep network/account operations fake unless an approved test project is used.
  - **Validation:** `bun run test:browser`; `bun run test:bundle`.
  - **Acceptance:** Automated conventional-browser smoke passes against the exact candidate digest. It does not satisfy the Kindle half of gate 14.

- [ ] **P9-T11 — Execute and record the physical Kindle smoke gate**
  - **Objective:** Complete the Kindle half of Section 18 gate 14 with real device evidence.
  - **Prerequisites:** P9-T10 and an authorized tester/device/test OAuth project.
  - **Inspect:** Capability report, Phase 0 proof, risk register, and `docs/release/KINDLE-SMOKE.md`.
  - **Create or edit:** Kindle checklist and evidence references only. Do not put secrets or raw identifiers in them.
  - **Steps:** Test full-page authorization, callback replay, checked/unchecked reload, account binding, IndexedDB save, programmed-default blur, pagehide/reload, offline pending edit, sync, duplicate-safe fixture if permitted, export, route reload, font glyphs, focus, numeric entry, and long workout scroll.
  - **Edge cases:** Expiry, denial, switch, sign-out, revocation fallback, storage pressure where safely testable, and network interruption.
  - **Tests or fixtures:** Record candidate digest, Kindle model, Silk version, timestamps, tester, result, and evidence reference.
  - **Validation:** `bun run verify:release-evidence`.
  - **Acceptance:** Gate 14 passes only when conventional and physical Kindle evidence both reference the exact candidate. Missing device evidence is `NOT PROVIDED`.

- [ ] **P9-T12 — Draft privacy policy, collect approvals, and classify release status**
  - **Objective:** Draft the public policy and complete Section 18 gate 15 without converting external decisions into code assertions.
  - **Prerequisites:** P9-T01 through P9-T11 tooling and all available evidence. Missing external evidence yields `NOT PROVIDED`; it does not block checklist implementation.
  - **Inspect:** Requirements 14.1-14.10, Architecture Sections 8, 10, and 15, Cloudflare proxy facts supplied by the owner, and the launch checklist.
  - **Create or edit:** `src/public/privacy.html`, `docs/release/LAUNCH-GATES.md`, evidence manifest, privacy tests, and final release report.
  - **Steps:** Draft a plain-language policy for `https://repjot.com/privacy.html`. State that REP JOT has no application backend and the operator does not receive or store fitness data, Drive files, tokens, or browser-cache content. Explain that canonical user data stays in the user's Google Drive `appDataFolder`. Explain local IndexedDB cache, pending edits, optional remembered-token storage, token expiry, export, deletion, disconnect, and browser-data loss. Explain that Google processes OAuth and Drive requests. Explain that Cloudflare proxies the site and supplies anonymized aggregate metrics. State that REP JOT adds no telemetry. Distinguish operator retention from Drive and browser retention. Add an effective date and require the human release owner to supply or approve legal identity and contact details. Record OAuth consent, separate projects, owned domain, production origins/redirect, Drive scope, data-request process, consumer-health legal review, breach-response process, security review, bundle-diff approval, and deployment authorization.
  - **Edge cases:** A claim that no data exists anywhere, omission of Drive or local storage, Cloudflare described as application telemetry, expired approval, wrong domain, test client in production, missing contact details, partial legal scope, and an absent incident owner.
  - **Tests or fixtures:** Assert the exact privacy route, local-only asset use, required topic headings, no analytics script, and no claim that clearing or disconnecting performs a different operation. Validate approval fields and evidence states only.
  - **Validation:** `bun test tests/privacy-policy.test.ts`; `bun run verify:release-evidence`; `bun run audit:release`; `bun run test:bundle`.
  - **Acceptance:** The draft accurately separates operator, Google Drive, browser, and Cloudflare processing. The public home links to `/privacy.html`. Gate 15 passes only with real human approval references. A coding agent reports release-candidate completion only.

- [ ] **P9-T13 — Prepare immutable deployment handoff and stop**
  - **Objective:** Give the human release owner an exact reviewed candidate without deploying it.
  - **Prerequisites:** P9-T12 tooling and all available release evidence.
  - **Inspect:** `docs/RELEASE.md`, `README.md`, `.pi-web/tasks.json`, all package scripts, the exact candidate diff, the candidate digest, and human-only deployment requirements.
  - **Create or edit:** Human handoff instructions, the final evidence manifest, and existing automation that exposes a coding-agent deployment action. Do not add an automated push or deployment script.
  - **Steps:** Remove or disable coding-agent deployment tasks, including the current subtree-push task. Mark existing deployment instructions as human-only. Rerun every available automated gate without source changes. Compare the candidate digest with reviewed evidence. Package the `dist/` manifest, diff, checks, unresolved manual gates, and rollback notes for the human release owner. Put a prominent instruction in the runbook that coding agents must never deploy, publish, or run `git push`. Stop after handoff.
  - **Edge cases:** Source change after review, CNAME drift, cache-key drift, a failed gate, missing approval, and a request for the coding agent to push.
  - **Tests or fixtures:** Assert that project release scripts contain no push or deployment action. Validate the handoff manifest and candidate digest.
  - **Validation:** `bun install --frozen-lockfile`; `bun run check`; `bun run test`; `bun run validate:schemas`; `bun run validate:static:fixtures`; `bun run compare:production -- --first-release`; `bun run build`; `bun run check:compat`; `bun run test:bundle`; `bun run audit:release`; `bun run verify:release-evidence`.
  - **Acceptance:** The human receives a reproducible candidate and evidence package. The coding agent performs no deployment, publication, remote Git operation, or live-domain verification.

## 7. Testing matrix

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

## 8. Commands and gates

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

## 9. Judge checklist

- Inspect source and generated `dist/` diffs separately.
- Confirm all Section 18 gates 1-15 map to P9-T01 through P9-T13 and evidence states.
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

## 10. Completion report format

Return exactly:

```text
Phase 9 completion report
Release classification: release-candidate implementation complete | production release approved | blocked
Completed task IDs:
Files changed:
Commands run and results:
Section 18 gate results (1-15):
Section 20 traceability gaps:
Acceptance criteria satisfied:
Remaining risks or blockers:
Manual evidence still required:
Release-candidate digest:
Human deployment reference, if later supplied:
```

Use `NOT PROVIDED` for missing external evidence. Never convert it to `PASS` based on expectation.

## 11. External and manual gates

Never fabricate:

- Physical Kindle model, Silk version, tester, result, screenshot, or device behavior.
- Google Cloud project separation, production client ID, OAuth consent, scope approval, domain verification, or revocation evidence.
- Privacy-policy approval, consumer-health legal review, data-request process, security review, or breach-response procedure.
- Production-content approval, production-diff approval, deployment authorization, DNS state, published commit, or live-domain result.

`design/DESIGN.md` is the font-family approval. The unlimited parser and bundle decisions need no numeric approval. The human release owner supplies the remaining manual evidence.

A complete implementation with missing manual evidence is a release candidate only. A coding agent always stops after handoff. Production release approval and deployment remain human actions.
