# Phase 7 execution plan: shell, routing, and status UI

## 1. Mission

Replace the Phase 0 prototype shell with the production application shell, hash router, startup state model, and shared accessible controls.

The phase is complete when every canonical hash route can reload through `index.html`. Anonymous and authenticated gates are correct. Shared headers, tabs, errors, save/sync status, tokens, fonts, and icon controls pass accessibility and compatibility tests.

## 2. Authority and required reading

Read these sources before editing:

- `AGENTS.md`.
- `docs/REQUIREMENTS.md`, Sections 4.3, 7, 8, 14.1, 15, and 16.
- `docs/ARCHITECTURE.md`, Sections 2, 4 through 7, 9, 10, 13 through 20, and 19 Phase 7.
- `docs/CAPABILITIES-kindle-scribe.md`, in full.
- `design/DESIGN.md`, in full.
- `specs/Day-of Workout Execution UI — Design Brief.md`, Visual Language, Browser Constraints, Responsive Layout, and Navigation. Treat it as lower authority.
- Existing `src/App.svelte`, `src/main.ts`, `src/index.html`, `src/capabilities.html`, `src/public/`, `vite.config.ts`, and compatibility script.
- Phase 4 auth facade and Phase 6 query/session facades.

Binding decisions:

- Use a small hash router with canonical routes under `/#/`.
- The server always receives the root `index.html` path.
- Tab roots use the `REP JOT` header and Workout, History, and Settings tabs.
- Detail/task routes use a compact Back header with no tab bar.
- Active Workout also uses the compact Back header.
- Back flushes a local save before navigation.
- Browser history stores route values, not domain objects.
- UI code never calls `fetch` or IndexedDB.
- Domain code remains free of Svelte and browser APIs.
- Use semantic controls, visible text, focus indicators, and no color-only meaning.
- Use zero-radius controls and no shadows, gradients, blur, animation, sticky requirement, or hover dependency.
- Bundle Inter, JetBrains Mono, and Material Symbols locally with system fallbacks.
- Do not depend on Grid, SVG controls, custom keyboards, Wake Lock, Web Share, or service workers.

Use Bun and TypeScript only. Keep Svelte/Vite, static `dist/`, ES2019, and Kindle support. Use no SQLite, WebAssembly, optional chaining, or nullish coalescing in the bundle. All user-facing branding is `REP JOT`.

## 3. Starting-state contract

Expected outputs:

- Phase 4 exposes tested auth state and actions without UI-owned OAuth logic.
- Phase 5 exposes sync and account-data status facades.
- Phase 6 exposes session and query facades with immutable view models.
- Existing compatibility checks preserve classic loading and the Phase 0 flow.

Verify all prior tests and inspect facade methods. Verify that `dist/CNAME` currently derives from `src/public/CNAME`. Record the current prototype routes and UI before replacement.

If any screen would need direct adapter access, stop and report the missing facade. Do not work around it in Svelte. `design/DESIGN.md` approves Inter, JetBrains Mono, and Material Symbols. Select official upstream files, pin exact releases and checksums, and include their licenses. Do not substitute another family without human approval.

## 4. In scope and out of scope

### In scope

- Typed route grammar, parsing, formatting, navigation, and reload resolution.
- Startup and authenticated account gates.
- Svelte context and narrow UI stores for route/startup/error/sync state.
- Anonymous landing shell and the exact privacy link `/privacy.html`.
- Authenticated shell, shared headers, tabs, loading and recovery panels.
- Shared design tokens, typography, focus, control, icon, form, status, and tree-frame components.
- Local font and Material Symbol manifests, build tasks, license-copy checks, and fallbacks.
- Typed not-found and unavailable states.
- Replacement of prototype shell imports after tests.

Primary requirement IDs: 4.3, 7.1-7.5, 8.1-8.10, 14.1, 15.1-15.2, and 16.1-16.3. This phase owns Section 20 rows for GitHub Pages navigation, semantic controls, local Material Symbols, and status labels. Phase 8 owns product-screen content.

### Out of scope

- Final product screen forms and destructive-flow UI.
- CSP and final security audit.
- Production OAuth configuration, privacy-policy approval, or deployment.
- Mockup-only cards, fixed navigation, remote assets, or `Forge` branding.

Use placeholder route screen components only where Phase 8 will supply content. Placeholders must use real facades for route readiness and must not duplicate domain behavior.

## 5. Required deliverables

| Deliverable | Recommended path | Architecture link | Source control |
| --- | --- | --- | --- |
| Hash router | `src/routing/hash-router.ts`, `src/routing/routes.ts` | Sections 7, 13, 17, and 20 | Yes |
| App state | `src/state/app-state.ts`, `src/state/app-context.ts` | Sections 7, 9, 16, and 20 | Yes |
| Bootstrap | `src/bootstrap.ts`, updated `src/main.ts` | Sections 7, 9, 14, and 19 Phase 7 | Yes |
| Shells | `src/ui/shell/AnonymousShell.svelte`, `AuthenticatedShell.svelte` | Sections 7, 13, and 20 | Yes |
| Shared controls | `src/ui/components/*.svelte` | Sections 7, 13, 17, and 20 | Yes |
| Design tokens | `src/ui/styles/tokens.css`, `base.css`, `components.css` | Sections 14 and 20 | Yes |
| Icon manifest/component | `src/ui/icons/material-symbols.ts`, `Icon.svelte` | Sections 14, 17, 18 gate 6, and 20 | Yes |
| Font task/assets | `scripts/build-fonts.ts`, pinned source/manifest/license paths under `assets/fonts/` and publishable files under `src/public/fonts/` | Sections 14 and 18 gate 6 | Yes, for pinned sources allowed by license and generated release assets |
| Shell tests | `tests/hash-router.test.ts`, `tests/app-state.test.ts`, component tests under `tests/ui/` | Sections 17 and 19 Phase 7 | Yes |

Do not commit temporary downloaded fonts, visual snapshots with personal data, or test reports. Commit reviewed licenses, checksums, manifests, and release font assets when their licenses permit it.

## 6. Ordered execution tasks

- [ ] **P7-T01 — Define and test canonical routes**
  - **Objective:** Parse and format every Architecture Section 13 route without a routing dependency.
  - **Prerequisites:** Phases 4-6 complete.
  - **Inspect:** Architecture route table and navigation rules.
  - **Create or edit:** `src/routing/routes.ts`, `src/routing/hash-router.ts`, and `tests/hash-router.test.ts`.
  - **Steps:** Define root, workout overview, active session, summary, history, exercise history, and settings routes. Encode/decode one path segment per ID. Normalize empty/invalid hashes to typed results. Preserve browser back semantics.
  - **Edge cases:** Cover malformed escapes, extra segments, query-like text, empty IDs, unsafe IDs, unknown route, direct reload, and auth return routes.
  - **Tests or fixtures:** Round-trip every valid route and reject malformed variants.
  - **Validation:** `bun test tests/hash-router.test.ts`; `bun run check`.
  - **Acceptance:** Formatting then parsing preserves route values. The router stores no domain object and makes no data request.

- [ ] **P7-T02 — Build startup and account-gated application state**
  - **Objective:** Model anonymous, loading, warm, stale, offline, blocked-file, and fatal-static states.
  - **Prerequisites:** P7-T01.
  - **Inspect:** Architecture Section 9 startup table and Phase 4-6 facade states.
  - **Create or edit:** `src/state/app-state.ts`, `src/state/app-context.ts`, and `tests/app-state.test.ts`.
  - **Steps:** Compose static-loader, auth, account gate, cache, and sync states. Permit warm/stale local use. Block empty-cache workout starts until reconciliation. Keep unrelated files usable after one blocked document.
  - **Edge cases:** Invalid static bundle, expired token, account-binding failure, warm offline cache, empty offline cache, future shard, corrupt remote, and account switch.
  - **Tests or fixtures:** Use facade fakes with deterministic transition order.
  - **Validation:** `bun test tests/app-state.test.ts`; `bun run check`.
  - **Acceptance:** Private state never appears before account binding. Every startup table row maps to one visible model and allowed-action set.

- [ ] **P7-T03 — Rework bootstrap without changing OAuth callback order**
  - **Objective:** Install polyfills, consume the callback, clear fragments, validate static data, and mount one shell in the correct order.
  - **Prerequisites:** P7-T02 and Phase 4 callback tests.
  - **Inspect:** Existing `src/main.ts`, `src/polyfills.ts`, `src/index.html`, and call-order tests.
  - **Create or edit:** `src/bootstrap.ts`, `src/main.ts`, and bootstrap tests.
  - **Steps:** Keep required polyfills first. Consume OAuth response before mount. Make sure that the adapter removes the fragment before diagnostics or private loads. Start static validation. Mount the shell and signal the classic loader.
  - **Edge cases:** Callback error, unrelated hash route, missing app target, static-load failure, repeated callback execution, and boot timeout.
  - **Tests or fixtures:** Add a bootstrap call-order fake. Preserve all Phase 0 tests.
  - **Validation:** `bun test tests/bootstrap.test.ts tests/google-identity.test.ts`; `bun run build`; `bun run check:compat`.
  - **Acceptance:** One callback consumer runs. No token fragment reaches Svelte state or diagnostics. Classic loader behavior remains intact.

- [ ] **P7-T04 — Implement centralized e-ink design tokens and base styles**
  - **Objective:** Encode the authoritative monochrome, zero-radius, accessible visual system once.
  - **Prerequisites:** P7-T03.
  - **Inspect:** Requirements 8, `design/DESIGN.md`, and Kindle constraints.
  - **Create or edit:** `src/ui/styles/tokens.css`, `base.css`, `components.css`, and style tests.
  - **Steps:** Define black/white/middle-gray colors, typography, spacing, borders, target heights, content width, and 4px focus outline. Use block flow and simple flex rows. Add system font fallbacks. Avoid transitions and large repaint effects.
  - **Edge cases:** Font failure, 600px width, 930px Kindle width, long labels, zoom, forced colors where practical, and print/download content.
  - **Tests or fixtures:** Add static CSS assertions for prohibited effects and visible focus tokens.
  - **Validation:** `bun test tests/ui/styles.test.ts`; `bun run build`; `bun run check:compat`.
  - **Acceptance:** Shared CSS owns reusable styling. Components do not scatter page-level colors, radii, effects, or focus rules.

- [ ] **P7-T05 — Package local fonts and Material Symbols**
  - **Objective:** Provide reviewed same-origin fonts without making controls depend on glyph rendering.
  - **Prerequisites:** P7-T04.
  - **Inspect:** Architecture Local Material Symbols Packaging and gate 6.
  - **Create or edit:** `scripts/build-fonts.ts`, font manifests/licenses/checksums, `src/ui/icons/material-symbols.ts`, `src/ui/components/Icon.svelte`, and tests.
  - **Steps:** Select official upstream releases for the families approved in `design/DESIGN.md`. Pin exact versions, source URLs, checksums, and upstream licenses. Subset only used outlined/filled ligatures and needed Inter/JetBrains Mono weights. Copy licenses to publishable assets. Restrict icon props to manifest names. Mark decorative glyphs hidden. Require labels on icon-only buttons.
  - **Edge cases:** Unofficial source, checksum mismatch, unknown glyph, font load failure, stale subset, duplicate ligature, missing license, and large output.
  - **Tests or fixtures:** Add manifest/type tests, glyph inventory tests, fallback rendering structure tests, and license assertions.
  - **Validation:** `bun run build:fonts`; `bun test tests/ui/icon.test.ts tests/ui/fonts.test.ts`; `bun run build`.
  - **Acceptance:** Gate 6 passes in fixture/reviewed-asset mode. Primary/destructive actions retain visible text. Missing assets fail the build.

- [ ] **P7-T06 — Build shared semantic shell controls**
  - **Objective:** Create accessible headers, tabs, actions, fields, statuses, and recovery panels.
  - **Prerequisites:** P7-T04 and P7-T05.
  - **Inspect:** Architecture Sections 13, 14, and 16 and Requirements 8.
  - **Create or edit:** Shared Svelte components under `src/ui/components/` and component tests.
  - **Steps:** Implement `BrandHeader`, `BackHeader`, `TabNav`, `ActionButton`, `LabeledInput`, `SaveStatus`, `SyncStatus`, `ErrorPanel`, `LoadingPanel`, and simple workout-tree framing. Use props/events only. Keep names and visible labels.
  - **Edge cases:** Keyboard-only use, icon font failure, long safe error, status without color, disabled action, live-region chatter, and focus return.
  - **Tests or fixtures:** Assert roles, headings, labels, accessible names, focus order, and exact status meanings.
  - **Validation:** `bun test tests/ui/shared-components.test.ts`; `bun run check`.
  - **Acceptance:** Controls use semantic HTML. No component calls `fetch`, IndexedDB, or a repository.

- [ ] **P7-T07 — Implement anonymous and authenticated shells**
  - **Objective:** Compose auth, startup, navigation, status, and route outlets.
  - **Prerequisites:** P7-T02, P7-T03, and P7-T06.
  - **Inspect:** Requirements 14.1 and 16 and Architecture startup states.
  - **Create or edit:** `src/ui/shell/AnonymousShell.svelte`, `AuthenticatedShell.svelte`, route outlet files, and shell tests.
  - **Steps:** Show a public REP JOT description, a link to `/privacy.html`, remember choice, and Google action. Show account-gated tab roots and compact detail headers. Render loading and recovery actions from state. Restore prior route after reauthorization.
  - **Edge cases:** Unconfigured client ID in development, denial, offline warm/empty state, invalid route, account switch, and expired token on detail route.
  - **Tests or fixtures:** Test each startup-state row and each header/tab rule.
  - **Validation:** `bun test tests/ui/shell.test.ts`; `bun run check`; `bun run build`; `bun run check:compat`.
  - **Acceptance:** Branding is always `REP JOT`. No private content leaks anonymously. Active/detail routes never show tabs.

- [ ] **P7-T08 — Implement route readiness, not-found, and save-before-back**
  - **Objective:** Resolve IDs after required data loads and make navigation preserve local intent.
  - **Prerequisites:** P7-T07.
  - **Inspect:** Phase 6 query/session facades and Architecture Navigation Rules.
  - **Create or edit:** Route controller modules, route outlet components, and tests.
  - **Steps:** Wait for account binding and required shard load. Resolve IDs through query facades. Show typed not-found with safe tab-root action. Before Back, request local flush and await commit. For active sessions, keep `in_progress`.
  - **Edge cases:** Direct reload, missing workout, missing session shard, blocked future shard, flush failure, browser back, and stale route after account switch.
  - **Tests or fixtures:** Use delayed facade fakes and save barriers.
  - **Validation:** `bun test tests/ui/routing.integration.test.ts tests/hash-router.test.ts`; `bun run check`.
  - **Acceptance:** Every canonical route reloads from root HTML. Navigation never loses a committed or pending form save silently.

- [ ] **P7-T09 — Remove obsolete prototype shell only after replacement tests pass**
  - **Objective:** Delete hello-world UI paths without removing proven authorization behavior.
  - **Prerequisites:** P7-T01 through P7-T08.
  - **Inspect:** All references to `src/google-drive.ts`, compatibility exports, and prototype copy.
  - **Create or edit:** `src/App.svelte`, obsolete prototype modules, imports, and tests.
  - **Steps:** Replace `App.svelte` with production shell composition. Remove hello-world Drive calls and prototype controls. Remove obsolete compatibility exports only if no production or test import needs them. Keep Phase 4 adapters and Phase 0 tests.
  - **Edge cases:** Hidden stale imports, duplicate callback consumption, unused broad Drive methods, and compatibility script scope checks.
  - **Tests or fixtures:** Add an import graph or bundle-string regression for prototype text.
  - **Validation:** `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run build`, `bun run check:compat`.
  - **Acceptance:** No hello-world behavior remains in the product shell. All replacement shell and authorization tests pass.

## 7. Testing matrix

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

Use deterministic facade states and save barriers. Component tests must not require network access. Physical contrast and glyph quality remain manual Phase 9 evidence.

## 8. Commands and gates

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

## 9. Judge checklist

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

## 10. Completion report format

```text
Phase 7 completion report
Completed task IDs:
Files changed:
Commands run and results:
Acceptance criteria satisfied:
Remaining risks or blockers:
Manual evidence still required:
```

List every route and shell state exercised. Name unavailable official font files, checksum failures, or missing licenses without inventing replacements.

## 11. External and manual gates

The approved font families come from `design/DESIGN.md`. Do not fabricate upstream version data, checksums, license text, physical Kindle rendering, Google OAuth behavior, production-domain behavior, or deployment evidence.

Phase 9 must test fonts, focus, route reloads, and OAuth return routes on the release-candidate Kindle build. The human release owner supplies legal, privacy, OAuth consent, security-response, and deployment approvals.
