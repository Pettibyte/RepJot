# Phase 1 execution plan: contracts and build validation

## 1. Mission

Build the typed document contracts and the build-time validation foundation for REP JOT. Do not change Phase 0 authorization behavior.

The phase is complete when all four v1 schemas compile under Draft 2020-12. Static test fixtures pass schema and semantic validation. Incompatible compatibility fixtures fail with stable diagnostics. Curation and first-release baseline processes work without creating production data. The required Bun scripts run from a fresh frozen install.

## 2. Authority and required reading

Read these sources before editing:

- `AGENTS.md`, especially Technical Requirements and Branding.
- `docs/REQUIREMENTS.md`, Sections 1, 3, 5 through 10, 13, and 14.
- `docs/ARCHITECTURE.md`, Sections 2, 4, 6 through 8, 12, 14, 17, 18, 19 Phase 1, and 20.
- `specs/rep-jot-json-schema-spec.md`, all sections and all 28 invariants in Section 8.
- `specs/storage-and-lookup.md`, Document Envelopes, Static Bundle Rules, Data Ownership, and Failure and Recovery.
- `specs/schema-versioning.md`, Document Envelope, Static Bundle Compatibility, Versioned Schemas, and Tests.
- `design/DESIGN.md`, only for icon-path and local-asset constraints.
- Every file under `schemas/`.
- `package.json`, `tsconfig.json`, `vite.config.ts`, `scripts/check-browser-compat.ts`, and the current `src/`, `tests/`, and `src/public/` trees.

Apply the authority order in Architecture Section 2. Mockups and the day-of brief cannot change a contract from a higher source.

Do not reinterpret these decisions:

- The four families are exercises, workouts, preferences, and monthly results.
- Every application timestamp field ends in `Utc`. Every value ends in `Z`.
- The UTC month of `startedAtUtc` selects a result shard.
- JSON Schema validation and semantic validation are separate stages.
- Published IDs and identity-bearing relationships remain stable.
- Candidate validation covers invariants 1-20 and 22-28. Phase 5 owns synchronization-policy invariant 21.
- The application uses no SQLite or WebAssembly.

Use Bun only. Use TypeScript only. Use Svelte and Vite for the static `dist/` build. Keep ES2019 output. The browser bundle must contain no optional chaining or nullish coalescing. Respect the Kindle limits in the capability report. Show the product name as `REP JOT` in user-facing text.

## 3. Starting-state contract

Phase 0 is complete. Its tested redirect flow, dual-store request state, exact expiry, account binding, form revocation, and 60-second callback receipt are frozen.

The current repository is a Phase 0 prototype. It has four v1 schemas, one authorization test file, an ES2019 Vite target, and a compatibility script. It does not have canonical `exercises.json` or `workouts.json`, a schema-validator dependency, semantic validators, contract fixtures, or the new build scripts.

Before work starts:

1. Run the current checks from an unchanged worktree.
2. Inspect the repository diff and preserve unrelated user changes.
3. Make sure that `docs/PHASE-0-AUTHORIZATION-PROOF.md` still says Phase 0 is complete.
4. Make sure that all four schema files exist and retain version 1.
5. Record current failures as baseline evidence.

No implementation phase is a prerequisite. If a Phase 0 test fails, stop. Report the regression without redesigning authorization. If a schema or named specification is missing, stop and report the missing path.

## 4. In scope and out of scope

### In scope

- Domain document types and family/version constants.
- A Draft 2020-12 schema registry with asserted `date-time` formats.
- Stable validation diagnostics with JSON Pointer paths.
- Cross-file semantic validation for every invariant that describes one candidate document and its validated context.
- Static source transformation and curation contracts.
- Static identity comparison, a blank first-release baseline process, and future-release compatibility comparison.
- Validation fixtures and Bun scripts.
- Build gates 1 through 5 and 7 at fixture level. Preserve gate 9.

Primary requirement IDs: 1.1-1.4, 2.16, 3.1, 3.10, 5.1, 6.1-6.10, 6.12-6.17, 7.2-7.5, 9.1-9.9, 10.1-10.17 contract validation, 11.1-11.24 contract validation, 12.1-12.2 contract validation, and 13.1-13.5.

### Out of scope

- Migration sequencing beyond interfaces for Phase 2.
- IndexedDB, OAuth changes, Drive synchronization, and session services.
- Product screens and design-system implementation.
- Production deployment, production curation approval, or release publication.
- Invented exercises, workouts, curation values, licenses, or release evidence.

Introduce pure interfaces for schema validation, semantic validation context, static source input, clocks used by reports, and compatibility-source retrieval. Later phases must consume these interfaces instead of importing build scripts.

### Resolved planning decisions

- The source checkout is `../free-exercise-db` relative to this repository.
- This phase creates curation processes, schemas, allowlists, reports, and synthetic test data only.
- A human must review and approve curated content before a worker writes or releases production static data.
- No prior REP JOT canonical static release exists. The compatibility baseline starts blank.
- The first human-approved release records its digests as the baseline for later releases.
- Bundle size and file count have no rejection limit. Phase 9 measures and reports both values.

These decisions do not authorize production curation or release.

## 5. Required deliverables

| Deliverable | Recommended path | Contract and architecture link | Source control |
| --- | --- | --- | --- |
| Canonical domain types | `src/domain/documents.ts`, `src/domain/static-data.ts`, `src/domain/user-data.ts` | Sections 7 and 20: four families and UTC fields | Yes |
| Family registry | `src/validation/schema-registry.ts` | Sections 7, 12, and 19 Phase 1 | Yes |
| Schema validator | `src/validation/schema-validator.ts` | Sections 7 and 17: Draft 2020-12 and diagnostics | Yes |
| Semantic validator | `src/validation/semantic-validator.ts` and focused modules under `src/validation/semantic/` | Sections 7, 12, 17, and 20 | Yes |
| Canonical static documents | `src/public/exercises.json`, `src/public/workouts.json` | Sections 8, 18 gate 4, and 20 static ownership | Yes, after content approval |
| Static validator command | `scripts/validate-static.ts` | Section 18 gates 4 and 5 | Yes |
| Schema validator command | `scripts/validate-schemas.ts` | Section 18 gate 3 | Yes |
| Curation transform | `scripts/build-static-data.ts` plus typed curation input under `data/curation/` | Requirements 13.1-13.5 and Section 20 static ownership | Yes |
| Compatibility comparator | `src/compatibility/compare-static-data.ts`, `scripts/compare-production.ts` | Sections 17, 18 gate 7, and 20 | Yes |
| Compatibility baseline format | `data/production-manifest.json` or a documented equivalent | Section 18 gate 7 | Yes, only after human approval of first-release content |
| Fixtures | `tests/fixtures/schemas/`, `tests/fixtures/static/`, `tests/fixtures/compatibility/` | Section 17 fixture harness | Yes |
| Tests | `tests/schema-validator.test.ts`, `tests/semantic-validator.test.ts`, `tests/compatibility.test.ts`, `tests/static-transform.test.ts` | Sections 17 and 19 Phase 1 | Yes |
| Bun scripts and lockfile | `package.json`, `bun.lock` | Section 18 command design | Yes |

Do not commit generated reports or downloaded temporary production files. Commit curated source data, fixture data, schemas, manifest digests, and canonical static JSON when approved. Vite-generated files belong in `dist/` only under the repository's established release policy.

## 6. Ordered execution tasks

- [ ] **P1-T01 — Freeze the contract inventory and test harness**
  - **Objective:** Create one typed list of families, versions, filenames, and shared test factories.
  - **Prerequisites:** None.
  - **Inspect:** `schemas/**`, the three data specifications, `package.json`, `tsconfig.json`, and current tests.
  - **Create or edit:** `src/domain/documents.ts`, `tests/helpers/document-builders.ts`, `package.json`, and `bun.lock`.
  - **Steps:** Define discriminated document types from the approved v1 contracts. Define family/version constants and logical-name recognition. Add only the smallest reviewed Draft 2020-12 validator dependency. Keep test factories deterministic and explicit.
  - **Edge cases:** Reject unknown families, nonpositive versions, malformed result names, offset timestamps, and a result filename that disagrees with `yearMonthUtc`.
  - **Tests or fixtures:** Add one minimal valid document for each family and malformed envelope variants.
  - **Validation:** `bun install --frozen-lockfile`, `bun run check`, `bun test tests/google-identity.test.ts`.
  - **Acceptance:** Types compile strictly. No runtime type assertion makes unvalidated input trusted. Existing Phase 0 tests still pass.

- [ ] **P1-T02 — Build the schema registry and schema self-validation**
  - **Objective:** Compile every supported schema once and resolve the workouts reference used by results.
  - **Prerequisites:** P1-T01.
  - **Inspect:** All four schemas and JSON Schema external-reference rules.
  - **Create or edit:** `src/validation/schema-registry.ts`, `src/validation/schema-validator.ts`, `scripts/validate-schemas.ts`, and `tests/schema-validator.test.ts`.
  - **Steps:** Register schemas by exact `$id`, family, and version. Enable Draft 2020-12 format assertions. Normalize validator errors into document, version, keyword, JSON Pointer, and safe message fields. Add `validate:schemas`.
  - **Edge cases:** Cover an unresolved `$ref`, duplicate `$id`, invalid schema, numeric offset, invalid calendar date, and unknown version.
  - **Tests or fixtures:** Add valid `Z` timestamps and invalid offset/date fixtures for preferences and results.
  - **Validation:** `bun run validate:schemas`; `bun test tests/schema-validator.test.ts`; `bun run check`.
  - **Acceptance:** All repository schemas compile. Each bad fixture fails with a stable path and keyword. Format checks are not annotations only.

- [ ] **P1-T03 — Implement candidate-document semantic validation**
  - **Objective:** Enforce semantic invariants that describe one candidate document and its validated cross-file context.
  - **Prerequisites:** P1-T02.
  - **Inspect:** JSON specification Section 8 and Requirements 6, 9 through 12.
  - **Create or edit:** `src/validation/semantic-validator.ts`, focused files under `src/validation/semantic/`, and `tests/semantic-validator.test.ts`.
  - **Steps:** Build local `Map` and `Set` indexes. Enforce invariants 1-20 and 22-28 as candidate-state rules. Cover identity, references, paths, direct IDs, dimensions, units, scores, detail, uniqueness, sides, lifecycle, shard agreement, sync-copy links, UTC values, prescriptions, and deprecated detail-only state. Export pure score/path helpers for Phase 6 reuse. Define invariant 21 as a synchronization policy owned by P5-T02, not as single-document validation.
  - **Edge cases:** Cover nested repeated containers, finite iteration bounds, deprecated references, duplicate dimensions, invalid unit order, wrong direct IDs, duplicate path tuples, partial detail, score mismatch, live/tombstone collision, wrong shard, and an invalid sync-copy link.
  - **Tests or fixtures:** Add one valid contextual set of all four families. Add positive and negative fixtures for invariants 1-20 and 22-28. Add a traceability assertion that assigns invariant 21 to P5-T02.
  - **Validation:** `bun test tests/semantic-validator.test.ts`, `bun run check`.
  - **Acceptance:** Every invariant has one primary owner. Candidate-state invariants have validation evidence. Invariant 21 has explicit Phase 5 ownership. Validation stays pure and imports no browser or Svelte module.

- [ ] **P1-T04 — Validate trusted local icon contracts**
  - **Objective:** Prevent remote, traversal, missing, and unsafe SVG references before build output.
  - **Prerequisites:** P1-T03.
  - **Inspect:** Requirements 8.5-8.9, schema icon patterns, Architecture Sections 14 and 15, and current assets.
  - **Create or edit:** `src/validation/semantic/icon-validation.ts`, `scripts/validate-static.ts`, icon fixtures, and SVG sanitizer tests.
  - **Steps:** Validate material ligature names against an injectable manifest. Resolve local SVG paths inside the static root. Parse and sanitize trusted SVG files at build time. Do not insert SVG source at runtime.
  - **Edge cases:** Reject schemes, absolute paths, traversal, symlinks outside the root, scripts, event attributes, external references, and missing files.
  - **Tests or fixtures:** Add safe and hostile local SVG fixtures. Keep hostile fixtures outside publishable assets.
  - **Validation:** `bun test tests/semantic-validator.test.ts`, `bun scripts/validate-static.ts --fixture tests/fixtures/static/valid`.
  - **Acceptance:** Gate 5 passes for valid fixtures and fails for every hostile fixture reason.

- [ ] **P1-T05 — Implement the curated static-data transform contract**
  - **Objective:** Produce deterministic REP JOT exercise data from approved local source data and explicit curation.
  - **Prerequisites:** P1-T03.
  - **Inspect:** Requirements 13.1-13.5, exercise schema classifications, and the source checkout at `../free-exercise-db`.
  - **Create or edit:** `scripts/build-static-data.ts`, typed files under `src/curation/`, process templates under `data/curation/`, and `tests/static-transform.test.ts`. Do not create production `src/public/exercises.json` or `src/public/workouts.json` in this phase without recorded human approval.
  - **Steps:** Default the source path to `../free-exercise-db` and permit an explicit test override. Map source fields without network fetches. Treat `body only` as no equipment. Require explicit curation for `null` equipment, laterality, movement pattern, measurements, and unresolved values. Produce review reports and candidate output in an ignored staging location. Sort output deterministically. Add a separate human-approval input before canonical output can be written.
  - **Edge cases:** Reject a missing source checkout, duplicate source IDs, missing allowlist entries, unknown muscle values, unresolved `null` equipment, absent approval, and unstable output order.
  - **Tests or fixtures:** Use small repository-owned synthetic fixtures. Do not copy fixture data into production static files. Do not treat generated candidates as approved curation.
  - **Validation:** `bun test tests/static-transform.test.ts`, `bun scripts/validate-static.ts --fixture tests/fixtures/static/valid`, `bun run check`.
  - **Acceptance:** The same inputs produce byte-identical candidate JSON and a deterministic review report. Missing curation fails with an actionable ID. Production paths remain unchanged until a human records approval.

- [ ] **P1-T06 — Implement blank-baseline and future compatibility comparison**
  - **Objective:** Support a blank first release and detect forbidden identity changes after the first approved baseline exists.
  - **Prerequisites:** P1-T03.
  - **Inspect:** Requirements 6.1-6.17, Architecture Section 18, and schema-versioning Static Bundle Compatibility.
  - **Create or edit:** `src/compatibility/compare-static-data.ts`, `scripts/compare-production.ts`, `tests/compatibility.test.ts`, and `tests/fixtures/compatibility/**`.
  - **Steps:** Add an explicit first-release mode that requires no prior files and writes no baseline by itself. Add a future-release comparison mode for equipment, exercise, workout, and node namespaces. Preserve parent, role, exercise reference, strategy, score contract, dimensions, and old units. Report newly deprecated impact. Permit labels, instructions, notes, and prescriptions to change. Require a human approval record before a separate command records first-release digests.
  - **Edge cases:** Cover an absent baseline, an unexpected existing baseline, ID deletion, namespace reuse, node movement, role change, unit removal, node addition, deprecation, reordered arrays, and an attempt to record unapproved digests.
  - **Tests or fixtures:** Add a blank-baseline fixture and one fixture pair per permitted and forbidden future change.
  - **Validation:** `bun test tests/compatibility.test.ts`, `bun scripts/compare-production.ts --fixture tests/fixtures/compatibility/compatible`.
  - **Acceptance:** Blank-baseline mode passes without a network request or fabricated digest. Every forbidden future fixture fails for its expected stable code. Only a human-approved first release can establish the baseline.

- [ ] **P1-T07 — Wire static validation and build commands**
  - **Objective:** Make schema, static, compatibility, type, test, build, and Kindle checks available as Bun scripts.
  - **Prerequisites:** P1-T02 through P1-T06.
  - **Inspect:** `package.json`, `vite.config.ts`, `scripts/check-browser-compat.ts`, and Architecture Section 18.
  - **Create or edit:** `package.json`, `bun.lock`, validation scripts, and test configuration files in TypeScript only.
  - **Steps:** Add `validate:schemas`, `validate:static`, `validate:static:fixtures`, and `compare:production`. Keep `check`, `test`, `build`, and `check:compat`. Include all TypeScript scripts and tests in strict type checks. Make scripts fail closed. Do not add JavaScript source files. Make `validate:static` require canonical inputs. Make `validate:static:fixtures` require the repository fixture set.
  - **Edge cases:** A missing selected input, failed download, absent manifest, schema compile error, or incompatible fixture must return a nonzero result.
  - **Tests or fixtures:** Add command-level tests for canonical and fixture modes.
  - **Validation:** `bun install --frozen-lockfile`, `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run build`, `bun run check:compat`.
  - **Acceptance:** Section 18 gates 1-5 pass against repository fixtures. Canonical validation reports a content blocker until approved files exist. Gate 7 passes in fixture mode. Existing ES2019 and authorization gates remain active.

- [ ] **P1-T08 — Audit phase traceability and unresolved content**
  - **Objective:** Prove that Phase 1 owns each listed contract and does not claim unavailable production evidence.
  - **Prerequisites:** P1-T07.
  - **Inspect:** Architecture Sections 17, 18, 19 Phase 1, 20, and the complete diff.
  - **Create or edit:** Tests and fixture notes only if an ownership gap exists.
  - **Steps:** Map each Phase 1 requirement to a passing or failing fixture. Inspect imports for architecture direction. Record missing approved static content and live manifest as blockers, not passes.
  - **Edge cases:** A test that validates only its own generated types is insufficient. A first-release candidate is not a baseline until a human approves it.
  - **Tests or fixtures:** Add a negative test for each uncovered invariant.
  - **Validation:** `bun run check`, `bun run test`, `bun run validate:schemas`, `bun run validate:static:fixtures`, `bun run compare:production -- --fixture tests/fixtures/compatibility/compatible`, `bun run check:compat`.
  - **Acceptance:** Every Phase 1 traceability row has objective evidence. No Phase 0 behavior changed. External content gaps remain explicit.

## 7. Testing matrix

| Requirement or invariant | Level | Fixtures and cases |
| --- | --- | --- |
| Four families and v1 envelopes | Unit and schema | One valid and malformed envelope per family |
| UTC fields and `Z` values | Schema and semantic | Valid UTC, offset, invalid date, shard boundary |
| Invariants 1-20 and 22-28 | Semantic unit | Grouped positive and negative cross-file fixtures |
| Invariant 21 tombstone policy | Ownership trace | Primary implementation and tests assigned to P5-T02 |
| Iteration inheritance and uniqueness | Semantic unit | Selective override, duplicate number, finite bound |
| Deprecated scored ancestor | Semantic unit | Partial, complete, nested, and empty container |
| Stable identity | Compatibility | Delete, reuse, move, role, strategy, score, unit removal |
| Permitted correction | Compatibility | Label, instruction, note, and prescription edits |
| Static source transform | Unit and command | `body only`, `null`, missing curation, deterministic order |
| Trusted SVG | Build integration | Safe local, traversal, script, external reference, missing file |
| ES2019 and Kindle syntax | Bundle gate | Existing classic parse plus explicit prohibited-syntax scan |

Use an injected clock for report timestamps and a fake compatibility source for tests. Do not use randomness. Malformed-input tests must preserve input objects and fixture bytes. Physical Kindle execution is deferred to Phase 9, but this phase must not weaken its parser or loader gates.

## 8. Commands and gates

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

## 9. Judge checklist

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

## 10. Completion report format

Return exactly these headings:

```text
Phase 1 completion report
Completed task IDs:
Files changed:
Commands run and results:
Acceptance criteria satisfied:
Remaining risks or blockers:
Manual evidence still required:
```

List each task ID separately. For each command, include its result. Name missing human curation approval and first-release baseline evidence explicitly.

## 11. External and manual gates

Examine the real checkout at `../free-exercise-db`, but do not fabricate its state or a curation approval. Do not create a production manifest from unapproved content. Do not fabricate license review, physical Kindle results, or deployment results.

Phase 1 can pass with deterministic fixtures and completed curation processes while production content remains unapproved. Phase 9 records the blank first-release decision and later baseline handoff. Google Cloud, OAuth consent, privacy, legal, production-domain, and deployment evidence are not Phase 1 implementation evidence.
