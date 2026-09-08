# Shared protocol

Read your role prompt, the task file, and relevant authority. Do not load other role prompts.

## Contract

Obey `AGENTS.md`, the phase, its named authorities, and applicable gates.
Tie each blocking expected result to a source section, supporting quote, supported workflow, and concrete consequence.
Explain the link. A broad citation, test, comment, reviewer opinion, or optional improvement does not establish a requirement.
Do not infer complete language analysis or universal input acceptance from a fail-closed requirement.
If authority conflicts, return `BLOCKED` with the conflict. Do not invent policy or silently repair another phase's behavior.
Prefer removing unnecessary mechanisms. Never weaken required behavior to obtain a pass.

## Evidence

Use one shared task file. Update only assigned sections. Link large logs instead of duplicating reports.
Record commands, exit codes, relevant output, environment, and tested snapshot.
Identify snapshots with the base commit and a content-hash manifest of relevant tracked and untracked inputs.
Include source, tests, dependencies, configuration, and artifacts. Exclude task notes and logs. HEAD alone cannot identify dirty work.
Reuse evidence only for unchanged relevant inputs and environment. Mark invalidated evidence `NOT_RUN`.
Preserve unrelated user changes. Use Bun and TypeScript in the devcontainer. Do not push, deploy, or change product authority.
Workers cannot commit, complete phase tasks, or spawn children.

## Mandatory repair packet

The discovering reviewer writes each packet in the task file:

- **ID / authority:** Stable defect ID, requirement reference, owning phase, source quote, and why it requires this result.
- **Failure:** Supported workflow, assumptions, exact input, expected result, observed result, and consequence.
- **Proof:** Persistent reproduction path, exact command, snapshot, exit code, and relevant failure output.
- **Diagnosis:** File and symbol, causal explanation, affected paths, and all known equivalent cases. Separate facts from hypotheses.
- **Repair:** Simplest compliant approach, permitted files, adjacent invariants, and exact closure tests.
- **State:** `OPEN`, `FIXED_UNVERIFIED`, `VERIFIED`, `REJECTED`, or `BLOCKED`, with evidence.

Share everything needed to repair. The fixer must not reconstruct discarded probes or rediscover known causes.
If the cause is unknown, state that limitation. Supply a deterministic reproduction and bounded investigation target.
Prefer a regression test in the existing suite. Prove the stated failure and include a passing valid control.
Reject unconditional failures and tests that copy the implementation's answer. Do not substitute implementation-text matching for behavior evidence.
For command defects, exercise the real command. For browser defects, use browser evidence when available.
If automation is unsuitable, preserve exact manual inputs, steps, expected output, actual output, and the reason.
Unexecuted tests are not reproduction evidence. Return incomplete packets to their reviewer, not a fixer.
Reviewers can add tests and fixtures, but cannot edit production code. Distinguish test additions from the reviewed snapshot.
Retain all accepted counterexamples through repair and final acceptance. Do not hide or delete reviewer probes.

## Stopping rule

Discovery covers the assigned requirement matrix once and returns all findings together. Group equivalent failures under one causal ID.
Confirmation replays closure tests and examines repair changes plus directly affected invariants. It is not another full audit.
Report late defects with complete packets. Classify each as an incomplete fix, repair regression, or earlier review miss.
Never conceal a real defect to meet the budget. Stop automatic cycling instead.
Sign-off means the agreed scope and evidence pass, not that bugs are impossible.
