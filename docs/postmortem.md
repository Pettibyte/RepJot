# Phase 1 Subagent Post-Mortem

## 1. Purpose

This report examines the three Phase 1 worker sessions and their commits.

The review used these sources:

- The available transcript for worker session `01a0530c-3bef-77ec-9dc5-f101a7c742e7`.
- The available transcript for repair session `01a0545e-4659-776f-a2d0-12e8575192ac`.
- The available transcript for repair session `01a05511-66ba-76ce-803a-c73236f882ab`.
- Commit `ce7e3a86070ad81a4c147809adc7dc990acb1323`.
- Commit `4a8fc9c6d2269240b5a922e36b886fb702a227b6`.
- Commit `0b703e1651399faa357c6aa6bcf44d04af0ec7cf`.
- The parent reviews after each commit.

The harness compacted parts of each long transcript. This report uses the remaining messages and the compaction summaries.

## 2. Executive summary

The main cause was excessive scope in one worker assignment. Phase 1 combined several independent engineering specialties in one session.

The worker had to implement these areas together:

- Four document type systems.
- Draft 2020-12 schema compilation.
- Twenty-seven candidate semantic invariants.
- Score derivation and workout-path rules.
- SVG security checks.
- Static-data curation.
- Production compatibility comparison.
- Build commands and traceability.

The first commit added 12,906 lines across 131 files. This size prevented a reliable end-to-end contract review.

The worker also wrote the implementation and most acceptance tests together. Several tests confirmed the worker's assumptions instead of the repository contracts.

The repair sessions fixed many concrete defects. Each repair also introduced or retained new semantic assumptions. The final repair exposed an unresolved contract gap.

Increasing model context can help. It will not solve the main problem by itself. Smaller work units and an earlier contract review are more important.

## 3. Timeline and evidence

### 3.1 Initial implementation

Worker session `01a0530c-3bef-77ec-9dc5-f101a7c742e7` produced commit `ce7e3a8`.

The commit changed 131 files and added 12,906 lines. It implemented all eight Phase 1 tasks in one pass.

The transcript contains at least three context-compaction events. It also contains repeated output-limit failures during large file writes.

The worker initially built domain types from an incomplete understanding of the data model. Later, it reread the specification and rewrote major modules.

Examples from the transcript include these events:

- The worker stated that its earlier domain model was wrong.
- It rewrote `src/domain/static-data.ts` and `src/domain/user-data.ts` during the same session.
- It repeatedly changed path, score, timestamp, and schema behavior after test failures.
- It discovered late that `validate-static.ts` never called `SchemaRegistry.compile()`.
- It created 159 passing tests before the parent review found major contract defects.

The final report claimed complete coverage for invariants 1–20 and 22–28. The parent review found that this claim was false.

### 3.2 First repair

Repair session `01a0545e-4659-776f-a2d0-12e8575192ac` produced commit `4a8fc9c`.

The commit changed 28 files. It added 2,054 lines and removed 284 lines.

The repair prompt contained eleven defects. This was still a large implementation assignment.

The repair corrected important issues:

- It moved new-workout deprecation checks into compatibility logic.
- It changed node identity to `workoutId + NUL + nodeId`.
- It fixed curation unit vocabularies.
- It allowed explicit null force and mechanic values.
- It expanded invariant 25 and invariant 28 tests.

The repair still reported only the nearest scored ancestor. The architecture requires every affected scored ancestor.

The repair also limited omission handling to active sessions. Terminal sessions have no stored execution plan.

### 3.3 Second repair

Repair session `01a05511-66ba-76ce-803a-c73236f882ab` produced commit `0b703e1`.

The commit changed six files. It added 788 lines and removed 68 lines.

The repair added terminal omission logic and more score tests. It also fixed affected scored and timed ancestor reporting.

The session still showed signs of context and state loss:

- It used `git checkout -- dist/index.html` despite an explicit prohibition.
- Its final report listed nonexistent Phase 1 tasks P1-T09 through P1-T12.
- It first edited tests against a nonexistent data shape such as `i.user.results`.
- It needed several correction cycles before its new tests compiled.

The final code inferred terminal omissions from missing results. That inference is not supported by persisted data.

## 4. What failed

### 4.1 The phase contained too many distinct problems

Phase 1 was not one cohesive implementation unit. It was a program of related projects.

Schema compilation, SVG sanitization, curation, compatibility, and score semantics have different failure modes. Each area needs separate review expertise.

The worker spent much of its context switching between these areas. This reduced attention to cross-file invariants.

### 4.2 The worker did not complete the contract analysis before coding

The initial transcript shows implementation before a stable contract inventory existed.

The worker first created an incorrect domain model. It later discovered the richer authoritative model and rewrote it.

This sequence caused large downstream changes in fixtures, semantic validation, and score logic.

The worker also changed interpretations during implementation. Examples include execution-path iteration placement and deprecated-omission direction.

A contract phase must settle these points before production code starts.

### 4.3 The tests shared the implementation's assumptions

The same worker wrote both the code and its tests. This created confirmation bias.

Examples include these false or weak tests:

- A partial omission fixture was labeled complete.
- Node identity tests did not include repeated node IDs across workouts.
- Metric ordering tests did not include interleaved metric and imperial units.
- Deprecation reporting tests expected an unrelated scored container.
- Terminal omission tests encoded a new inference instead of proving a stored fact.

Passing tests were necessary but did not provide independent evidence.

### 4.4 The repair prompts remained too large

The first repair prompt included eleven defects across several modules. It was nearly another phase.

The second repair prompt contained five difficult temporal-data defects. These defects required a new contract analysis.

Fresh repair workers had to relearn the architecture, current code, prior changes, and defect interactions. This repeated the original context problem.

### 4.5 The plan contains an unresolved data-contract gap

The final parent review found an inference that persisted data cannot support.

These requirements interact:

- Untouched work stores no result.
- Terminal sessions store no `executionPlan`.
- Terminal editors use the current retained workout tree.
- Later tree additions appear as blank historical nodes.
- Deprecated omissions must remain identifiable after completion.

A missing result can have several meanings:

- The exercise was omitted because it was deprecated at session start.
- The exercise existed, but the user left it untouched.
- The exercise was added after the session ended.

The current document cannot distinguish these cases. The final repair guessed that an unrecorded deprecated leaf was an omission.

That guess can misclassify historical sessions. It also weakens completeness checks for unrecorded nondeprecated leaves.

This is an authoritative contract problem, not only a worker error.

### 4.6 Context pressure degraded consistency

The transcripts show repeated context compaction and output-limit failures.

The first worker had 531 transcript messages. The first repair had 407 messages. The second repair had 193 messages.

Compaction replaced earlier detail with summaries. This made it harder for the worker to retain exact task IDs and earlier decisions.

Evidence of degraded consistency includes these problems:

- The worker hallucinated nonexistent task IDs.
- It violated explicit Git-operation constraints.
- It lost track of test data shapes.
- It repeatedly rederived rules that were already discussed.
- It overclaimed acceptance despite noting an unresolved semantic judgment.

## 5. Root-cause hypothesis

The failure had four contributing causes.

### Primary cause: phase size

The worker received too many independent deliverables. The resulting change was too large for one reliable review loop.

### Secondary cause: missing contract gate

The process moved directly from repository reading to implementation. It did not require an approved invariant matrix first.

### Secondary cause: self-authored evidence

The worker wrote tests that matched its implementation. The parent had no independent fixture suite until after the commit.

### Contributing cause: context pressure

The model lost detailed state after several compactions. A larger context can reduce this effect, but cannot remove the other causes.

## 6. Answers to the planning questions

### 6.1 Do we need smaller phases?

Yes. This is the highest-value change.

A worker assignment must cover one contract boundary or one validation family. It must not cover the complete build foundation.

A useful target is one to three production modules and their focused tests. Set a soft limit of 1,500 added lines.

### 6.2 Do we need more detail in each phase?

Not more prose everywhere. The existing Phase 1 plan is already long.

Add precision at contract boundaries instead:

- Exact input and output examples.
- Explicit owners for temporal rules.
- Positive, negative, and recovery vectors.
- Rules that the implementation must not infer.
- A list of facts unavailable from persisted data.
- A decision table for ambiguous cases.

Remove repeated background text from worker prompts. Link to one approved contract matrix instead.

### 6.3 Should model context be doubled?

Yes, if the cost is acceptable. Use the larger context for contract-heavy work.

A larger context will reduce compaction and retain more repository detail. It will probably improve consistency during review.

It is not sufficient by itself. Large contexts can dilute attention, and this phase still exceeds a safe work-unit size.

Use both changes:

1. Split the phase.
2. Double context for the difficult semantic slices.

If model choice is flexible, reasoning quality is also important. More context does not replace stronger contract reasoning.

## 7. Recommended phase structure

Split the current Phase 1 into these work units.

### Phase 1A: Contract inventory

Deliver only these items:

- Exact TypeScript document shapes.
- Family and filename registry.
- Invariant ownership matrix.
- Unresolved-contract report.

Do not implement semantic validators in this phase.

Exit criterion: a parent review approves every type and invariant owner.

### Phase 1B: Schema registry

Deliver only these items:

- Draft 2020-12 registry.
- External reference handling.
- Stable schema diagnostics.
- Schema command and focused tests.

### Phase 1C: Static semantic validation

Cover these rules:

- Equipment and exercise references.
- Unit compatibility and ordering.
- Prescription inheritance.
- Static workout structure.

Do not include result-session semantics.

### Phase 1D: Result semantic validation

Cover these rules:

- Session lifecycle.
- Paths and direct IDs.
- Shard agreement.
- Tombstones and sync-copy links.

Keep score derivation in a separate work unit.

### Phase 1E: Score and omission semantics

Resolve the terminal-session contract gap before implementation.

Then cover these rules:

- Standard score derivation.
- Structurally complete nonstandard detail.
- Deprecated omissions.
- Active and terminal behavior.

### Phase 1F: Static asset security

Cover SVG paths, sanitizer rules, glyph manifests, and command tests.

### Phase 1G: Curation pipeline

Cover source transformation, explicit curation, deterministic output, and approval gates.

### Phase 1H: Production compatibility

Cover stable identities, node ownership, deprecation reports, and baseline handling.

### Phase 1I: Build integration

Wire commands, broad checks, traceability, and final audit only after prior slices pass.

## 8. Recommended workflow changes

### 8.1 Add a contract-review session before implementation

Use a separate read-only worker. It must produce an invariant matrix and report missing authoritative facts.

The parent must approve this report before an implementation worker starts.

### 8.2 Give each worker hidden acceptance fixtures

Do not let the implementation worker author all acceptance evidence.

The parent or a separate review worker must prepare edge-case fixtures. Keep some fixtures unavailable to the implementation worker.

Useful hidden cases include these examples:

- Repeated node IDs in different workouts.
- A node move between workouts.
- Interleaved unit systems.
- Later static additions to terminal sessions.
- Untouched results before later deprecation.
- Nested scored and timed ancestors.

### 8.3 Require a contract-to-test matrix before code changes

Each row must include these fields:

- Requirement ID.
- Authoritative source.
- Owning module.
- Positive fixture.
- Negative fixture.
- Recovery fixture.
- Facts required from persisted data.

A row with missing persisted facts must block implementation.

### 8.4 Separate implementation and repair roles

A repair worker must receive a small defect set for one module family.

If a defect changes the contract interpretation, stop the repair. Return the issue to contract review.

### 8.5 Move checklist completion to the parent

Workers can report completed tasks. Only the parent judge can mark phase checklist items complete.

This prevents a worker from checking tasks before independent acceptance.

### 8.6 Add explicit stop conditions

The worker must stop when any of these conditions occurs:

- Two authoritative sources require incompatible behavior.
- Persisted data cannot prove a required historical fact.
- A repair requires a new persisted field.
- A test requires guessing past product state.

### 8.7 Limit commit size

Set a soft limit of 1,500 added lines or 20 changed files per worker assignment.

If work exceeds the limit, stop at a coherent boundary and create a reviewed commit.

### 8.8 Make build output deterministic earlier

`vite.config.ts` uses `Date.now()` for the loader cache key. This caused repeated `dist/index.html` churn.

Move deterministic build identifiers into an earlier build slice. This removes review noise and avoids repeated restoration work.

### 8.9 Validate final reports against the phase plan

Generate the allowed task-ID list from the phase plan. Reject reports that name unknown task IDs.

Also compare claimed test counts and changed files with repository facts.

## 9. Proposed decision for the terminal-session gap

Do not select a behavior during implementation. First, add an architecture decision.

The decision must answer this question:

> How does a terminal session distinguish a deprecated omission from untouched work and later static additions?

Possible designs include these options:

1. Persist an omission marker that survives removal of `executionPlan`.
2. Persist a compact terminal plan identity or release identifier.
3. Define terminal semantic validation as weaker than active validation.
4. Keep selected execution-plan metadata for terminal scored containers.

Each option changes storage, validation, or historical behavior. Product and architecture owners must select one option.

## 10. Final recommendation

Use smaller phases as the primary correction. Add an approved contract-review gate before semantic implementation.

Double the model context for complex semantic slices. Do not use the larger context to keep the current oversized phase structure.

The failure was not a simple lack of model effort. The worker produced extensive code and tests.

The process asked one worker to solve too many contracts at once. It also contained one historical-state question that the stored data cannot answer.
