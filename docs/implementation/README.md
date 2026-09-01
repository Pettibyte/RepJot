# Implementation plan index

## 1. Purpose

These plans replace the former nine large phases. The new sequence has 91 small phases.

Each phase has one narrow implementation or audit objective. Phase numbers are simple integers from 1 through 91.

The restart branch begins at commit `433e3a061e690e6ae3943ba9e1480511c8a26d5f`. The superseded implementation commits remain on branch `main`.

## 2. Authority

Apply the source order in `docs/ARCHITECTURE.md`, Section 2. Read `AGENTS.md` before each phase.

Read these common sources when the phase uses their contracts:

- `docs/REQUIREMENTS.md`.
- `docs/ARCHITECTURE.md`.
- `docs/CAPABILITIES-kindle-scribe.md` for browser or bundle work.
- `specs/rep-jot-json-schema-spec.md` for document and semantic work.
- `specs/storage-and-lookup.md` for persistence and synchronization work.
- `specs/schema-versioning.md` for schema, migration, and compatibility work.
- `docs/PHASE-0-AUTHORIZATION-PROOF.md` for authentication work.
- `design/DESIGN.md` for visual and local-asset work.
- The day-of design brief only for lower-authority interaction guidance.

A phase file gives its additional inspection list. Read each named source section before implementation.

Read `docs/implementation/GATES.md` for the applicable workstream evidence and manual gates.

## 3. Binding implementation rules

- Use Bun only.
- Use TypeScript only for project source.
- Preserve the Phase 0 authorization behavior.
- Keep Svelte, Vite, static `dist/`, ES2019, and Kindle support.
- Do not add SQLite or WebAssembly.
- Do not add optional chaining or nullish coalescing to executable output.
- Show the user-facing name as `REP JOT`.
- Do not fabricate production content, device evidence, Google evidence, legal approval, or deployment evidence.
- Do not deploy, publish, push, or run `git push`.

## 4. Orchestration contract

Run one implementation worker for one phase. Use a fresh worker context for each phase.

The parent orchestrator is the only judge. A worker cannot accept its own phase or mark a plan task complete.

Before each worker starts, the parent must prepare independent acceptance cases from the authoritative sources. The worker does not receive all judge cases.

The parent must examine the complete diff and run the phase commands. The parent must also apply the relevant rows from `GATES.md`.

The final phase in each workstream must apply its complete cross-phase gate section.

Use these stop conditions:

- Stop when authoritative sources conflict.
- Stop when persisted data cannot prove a required fact.
- Stop when a repair needs a new stored field or a new product decision.
- Stop when a test requires a guess about past product state.

Use these review-size targets:

- Aim for about 1,500 added lines and 20 changed files in one phase.
- Treat both values as targets, not hard limits.
- Before implementation, split a phase when its scope is clearly too large for one review.
- During implementation, preserve clear comments, readable code, and useful tests when the change exceeds a target.
- Do not rewrite or compact correct work only to meet a target.

When coherent work exceeds a target, the worker must stop and return control to the parent. The report must give the size facts and a possible split. The parent can accept the overage or request a split. An overage alone is not a reason to reject the phase.

If the judge rejects a phase, send one narrow defect family to a fresh repair worker. Do not combine unrelated repairs.

Do not start the next phase until the parent accepts the current phase.

After acceptance, keep one commit per phase. Use this commit-message format:

```text
Phase N: <one-line summary>

- <material change>
- <material change>
```

The first line must start with `Phase N:`. Do not put a conventional commit prefix before the phase. Add a blank line and a bulleted list of material changes.

## 5. Contract gate

Phase 1 is a blocking contract phase. It owns the unresolved terminal-session omission decision.

Phases 2 through 91 cannot start until the parent accepts the contract matrix and the authoritative decision.

The decision must distinguish these states without inference:

- An exercise was deprecated and omitted when the session started.
- Work existed but remained untouched before later deprecation.
- A nondeprecated node entered the workout tree after session completion.

If the current documents cannot distinguish these states, Phase 1 must define an approved storage or validation change.

Phase 1 must also resolve these contract questions:

- Define whether preference mapping deletion is valid and how merge represents it.
- Assign the serializer for two concurrent local saves to one key.
- Define the winning order for two concurrent local saves to one key.
- Cite the authoritative byte-order mark policy for document parsing.

Do not start an affected phase while its contract row is unresolved.

## 6. Evidence rules

Tests that an implementation worker writes are development evidence. They are not independent acceptance evidence.

For each phase, the parent must examine at least these cases:

- One successful case.
- One malformed or rejected case.
- One recovery case when state can fail.
- One reload or concurrency case when state persists or synchronizes.

The parent must compare the worker report with Git facts. Reject unknown task IDs, incorrect test counts, and unsupported completion claims.

## 7. Completion report

Each worker must return exactly these headings:

```text
Phase N completion report
Completed task IDs:
Files changed:
Commands run and results:
Acceptance criteria satisfied:
Remaining risks or blockers:
Manual evidence still required:
```

Replace `N` with the phase number. The only permitted task ID is the ID in that phase file.

## 8. Phase sequence

| Phase | Mission | Source mapping |
| --- | --- | --- |
| 1 | Resolve document contracts and terminal omission | New contract gate |
| 2 | Define canonical document types | Former contract task 1 |
| 3 | Build the schema registry | Former contract task 2 |
| 4 | Validate static document semantics | Former semantic task split |
| 5 | Validate result lifecycle semantics | Former semantic task split |
| 6 | Validate scores and deprecated omissions | Former semantic task split |
| 7 | Validate trusted local icons | Former icon task |
| 8 | Build the curation contract | Former curation task |
| 9 | Compare static-data compatibility | Former compatibility task |
| 10 | Integrate contract build gates | Former integration and audit tasks |
| 11 | Define pipeline stages and typed errors | Former workstream 2, task 1 |
| 12 | Parse exact bytes without application limits | Former workstream 2, task 2 |
| 13 | Recognize exact envelopes and logical names | Former workstream 2, task 3 |
| 14 | Build sequential family migration registries | Former workstream 2, task 4 |
| 15 | Enforce validation before and after every migration | Former workstream 2, task 5 |
| 16 | Record provenance and normalize disposable models | Former workstream 2, task 6 |
| 17 | Load static families in dependency order | Former workstream 2, task 7 |
| 18 | Complete migration and recovery regression coverage | Former workstream 2, task 8 |
| 19 | Define storage records and ports | Former workstream 3, task 1 |
| 20 | Open and upgrade the native database | Former workstream 3, task 2 |
| 21 | Implement account and document repositories | Former workstream 3, task 3 |
| 22 | Implement pending edits, reserved IDs, and receipts | Former workstream 3, task 4 |
| 23 | Expose truthful local save outcomes | Former workstream 3, task 5 |
| 24 | Implement account lifecycle cleanup | Former workstream 3, task 6 |
| 25 | Implement the bounded diagnostic ring | Former workstream 3, task 7 |
| 26 | Prove reload, rollback, quota, and concurrency behavior | Former workstream 3, task 8 |
| 27 | Characterize and freeze Phase 0 behavior | Former workstream 4, task 1 |
| 28 | Extract browser ports and the OAuth redirect adapter | Former workstream 4, task 2 |
| 29 | Implement auth service lifecycle and account gate | Former workstream 4, task 3 |
| 30 | Implement revocation and disconnect service behavior | Former workstream 4, task 4 |
| 31 | Define the complete Drive adapter contract | Former workstream 4, task 5 |
| 32 | Implement Drive REST transport and pagination | Former workstream 4, task 6 |
| 33 | Group recognized names and coordinate duplicate cleanup | Former workstream 4, task 7 |
| 34 | Provide deterministic Drive and browser fakes | Former workstream 4, task 8 |
| 35 | Integrate adapter boundaries and preserve prototype compatibility | Former workstream 4, task 9 |
| 36 | Define semantic diffs, canonical equality, and conflict keys | Former workstream 5, task 1 |
| 37 | Implement pure result three-way merge | Former workstream 5, task 2 |
| 38 | Implement preference merge and final revision update | Former workstream 5, task 3 |
| 39 | Reserve sync-copy and create IDs before network writes | Former workstream 5, task 4 |
| 40 | Reconcile clean cache and changed remote files | Former workstream 5, task 5 |
| 41 | Integrate safe duplicate-content consolidation | Former workstream 5, task 6 |
| 42 | Implement pending-file merge, preflight, upload, and post-read | Former workstream 5, task 7 |
| 43 | Implement retry, authorization, and serialization policy | Former workstream 5, task 8 |
| 44 | Emit bounded, allowlisted diagnostic events | Former workstream 5, task 9 |
| 45 | Implement raw export and recognized remote deletion services | Former workstream 5, task 10 |
| 46 | Prove convergence and ambiguous recovery | Former workstream 5, task 11 |
| 47 | Implement secure session IDs and UTC shard selection | Former workstream 6, task 1 |
| 48 | Resolve prescriptions through nested iterations | Former workstream 6, task 2 |
| 49 | Freeze active plans and apply deprecated omission | Former workstream 6, task 3 |
| 50 | Reconstruct terminal edit plans from the current tree | Former workstream 6, task 4 |
| 51 | Implement unit defaults, conversion, and editable rounding | Former workstream 6, task 5 |
| 52 | Implement result editing, omission, attempts, sides, and notes | Former workstream 6, task 6 |
| 53 | Implement aggregate expansion and score recomputation | Former workstream 6, task 7 |
| 54 | Implement session lifecycle with local-first saves | Former workstream 6, task 8 |
| 55 | Build bounded native indexes | Former workstream 6, task 9 |
| 56 | Implement lookups and recent-first history loading | Former workstream 6, task 10 |
| 57 | Run domain integration and memory-shape regressions | Former workstream 6, task 11 |
| 58 | Define and test canonical routes | Former workstream 7, task 1 |
| 59 | Build startup and account-gated application state | Former workstream 7, task 2 |
| 60 | Rework bootstrap without changing OAuth callback order | Former workstream 7, task 3 |
| 61 | Implement centralized e-ink design tokens and base styles | Former workstream 7, task 4 |
| 62 | Package local fonts and Material Symbols | Former workstream 7, task 5 |
| 63 | Build shared semantic shell controls | Former workstream 7, task 6 |
| 64 | Implement anonymous and authenticated shells | Former workstream 7, task 7 |
| 65 | Implement route readiness, not-found, and save-before-back | Former workstream 7, task 8 |
| 66 | Remove obsolete prototype shell only after replacement tests pass | Former workstream 7, task 9 |
| 67 | Define screen view contracts and product acceptance fixtures | Former workstream 8, task 1 |
| 68 | Implement Choose Workout | Former workstream 8, task 2 |
| 69 | Implement Workout Overview and durable start | Former workstream 8, task 3 |
| 70 | Build the active workout hierarchy and core result controls | Former workstream 8, task 4 |
| 71 | Connect local save timing and truthful status | Former workstream 8, task 5 |
| 72 | Add Last Time, units, and scored-container interactions | Former workstream 8, task 6 |
| 73 | Implement finish, incomplete, abandon, delete, and terminal editing | Former workstream 8, task 7 |
| 74 | Implement Workout Summary | Former workstream 8, task 8 |
| 75 | Implement Workout History and Exercise History | Former workstream 8, task 9 |
| 76 | Implement Settings units, exports, and diagnostics | Former workstream 8, task 10 |
| 77 | Implement Delete All User Data and disconnect UI | Former workstream 8, task 11 |
| 78 | Run complete product-flow and accessibility regression | Former workstream 8, task 12 |
| 79 | Audit prerequisite ownership and full traceability | Former workstream 9, task 1 |
| 80 | Enforce frozen install, type, test, schema, and static gates | Former workstream 9, task 2 |
| 81 | Enforce trusted SVG, glyph, font, license, and local-asset gates | Former workstream 9, task 3 |
| 82 | Record the blank first-release compatibility baseline | Former workstream 9, task 4 |
| 83 | Build with production public configuration and exclude secrets | Former workstream 9, task 5 |
| 84 | Harden ES2019 classic output and migrate probe sources | Former workstream 9, task 6 |
| 85 | Enforce CSP, endpoint, token, telemetry, and dependency policy | Former workstream 9, task 7 |
| 86 | Measure bundle size and file count without thresholds | Former workstream 9, task 8 |
| 87 | Validate CNAME, static portability, and bundle diff | Former workstream 9, task 9 |
| 88 | Run conventional browser release-candidate tests | Former workstream 9, task 10 |
| 89 | Execute and record the physical Kindle smoke gate | Former workstream 9, task 11 |
| 90 | Draft privacy policy, collect approvals, and classify release status | Former workstream 9, task 12 |
| 91 | Prepare immutable deployment handoff and stop | Former workstream 9, task 13 |

## 9. Former workstream mapping

| Former workstream | New phases | Topic |
| --- | --- | --- |
| 1 | 1-10 | Contracts, schemas, static validation, curation, and compatibility |
| 2 | 11-18 | Document pipeline and migrations |
| 3 | 19-26 | IndexedDB persistence |
| 4 | 27-35 | Authentication and Drive adapters |
| 5 | 36-46 | Merge and synchronization |
| 6 | 47-57 | Indexes and session domain |
| 7 | 58-66 | Shell, routing, and status UI |
| 8 | 67-78 | Product screens |
| 9 | 79-91 | Compatibility, security, and release |
