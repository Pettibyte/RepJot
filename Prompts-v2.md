# REP JOT Multi-Agent Prompts, Version 2

## 1. Purpose

This document defines the phase-work process and explains the runtime prompts.

Do not send this complete document to child sessions. Each child receives one rendered role template from `prompts/phase-work/`.

The process aims to improve first-pass correctness and reduce review rounds. It does not optimize active inference time.

## 2. Quick start

The user copies only this prompt into the parent session:

- [`prompts/phase-work/orchestrator.md`](prompts/phase-work/orchestrator.md)

Before use, replace these values:

- `${PHASE}`
- `${PHASE_PADDED}`
- `${TASK_ID}`
- `${NEXT_PHASE}`

The orchestrator then selects and renders the small child templates as needed.

### Runtime files

| File | Reader | Purpose |
|---|---|---|
| [`orchestrator.md`](prompts/phase-work/orchestrator.md) | Parent only | Complete phase-control prompt. |
| [`builder.md`](prompts/phase-work/builder.md) | Orchestrator, then rendered into child prompt | Initial implementation. |
| [`judge.md`](prompts/phase-work/judge.md) | Orchestrator, then rendered into child prompt | Independent contract review. |
| [`adversarial-reviewer.md`](prompts/phase-work/adversarial-reviewer.md) | Orchestrator, then rendered into child prompt | High-risk hostile review. |
| [`logic-fixer.md`](prompts/phase-work/logic-fixer.md) | Orchestrator, then rendered into child prompt | Local production-logic repair. |
| [`mechanical-fixer.md`](prompts/phase-work/mechanical-fixer.md) | Orchestrator, then rendered into child prompt | Exact low-risk repair. |
| [`repair-builder.md`](prompts/phase-work/repair-builder.md) | Orchestrator, then rendered into child prompt | Coherent cross-module repair. |
| [`root-cause-analyst.md`](prompts/phase-work/root-cause-analyst.md) | Orchestrator, then rendered into child prompt | Read-only analysis after repeated failure. |
| [`ledger-template.md`](prompts/phase-work/ledger-template.md) | Orchestrator only | Durable local phase state. |

## 3. How the orchestrator passes a prompt

A child must not read this handbook or the runtime prompt directory.

The orchestrator uses this procedure:

1. Read one required runtime template.
2. Replace all `${...}` placeholders.
3. Add the phase packet, review packet, or defect packet.
4. Pass the complete rendered text in the `spawn_subsession` prompt argument.
5. Pass the recommended model in the `spawn_subsession` model argument.

Conceptual example:

```text
spawn_subsession({
  model: "lemonade/Qwen3.8-27B-GGUF-UD-Q4_K_XL",
  prompt: "<rendered builder.md plus the Phase 8 packet>"
})
```

The child reads only the rendered assignment and the named project authority.

## 4. Role separation

### 4.1 Orchestrator

The orchestrator owns process state, child selection, acceptance, and the final commit.

The orchestrator does not implement or repair production code. It remains the only acceptance authority.

### 4.2 Builder

The builder owns one coherent initial implementation. It tests all public acceptance categories and reports unresolved risks.

A builder cannot accept its own work or mark the phase complete.

### 4.3 Contract judge

The contract judge independently examines authority, behavior, architecture, scope, evidence, and regressions.

The judge recommends a verdict. The parent makes the acceptance decision.

### 4.4 Narrow fixer

A fixer receives one complete root-cause family and all known reproductions.

A fixer must not receive only one symptom when related symptoms are already known. It can report only `FIXED_UNVERIFIED`.

### 4.5 Adversarial reviewer

The adversarial reviewer attacks trust boundaries and alternate representations. It does not duplicate the complete contract review.

Use this separate role for:

- Authentication and authorization.
- Parsing, encoding, schemas, and migrations.
- Files, paths, links, XML, SVG, and active content.
- Persistence, synchronization, merge, concurrency, and recovery.
- User-controlled input and remote data.
- Security and release gates.
- Deep or cyclic structures with resource risks.

One contract judge is sufficient for routine documentation or isolated pure logic.

## 5. Model assignments and guardrails

| Role | Recommended model | Guardrail |
|---|---|---|
| Orchestrator | `openai-codex/gpt-5.6-sol` | Must not implement production code. |
| Initial builder | `lemonade/Qwen3.8-27B-GGUF-UD-Q4_K_XL` | Default for coherent phase work. Independent review is mandatory. |
| Small initial builder | `openai-codex/gpt-5.6-luna` | Use only for one local behavior with exact cases and no design ambiguity. |
| Contract judge | `openai-codex/gpt-5.6-sol` | Use a fresh context after a changed review tree. |
| Adversarial reviewer | `openai-codex/gpt-5.6-sol` | Use a fresh attack-oriented context. |
| Logic fixer | `openai-codex/gpt-5.6-luna` | Use for local production logic with exact reproductions. |
| Mechanical fixer | `llama/unsloth/Qwen3.8-Flash-Next-GGUF:UD-IQ4_XS` | Use only for exact low-risk changes. |
| Large repair builder | `lemonade/Qwen3.8-27B-GGUF-UD-Q4_K_XL` | Use when one root cause requires coherent cross-module work. |

Do not use Qwen Flash for:

- Security boundaries.
- Timestamps and calendar rules.
- Synchronization and merge policy.
- Authentication.
- Parser behavior.
- Schema ownership.
- Product-policy interpretation.

Do not use `llama-laguna/unsloth/Laguna-S-2.1-GGUF:UD-Q4_K_XL`. The reviewed sessions did not deliver completed work.

Do not use `openai-codex/gpt-5.6-terra` by default. Its Phase 5 process reached sign-off but used too many rounds.

Do not silently substitute a model. Ask the user for one replacement decision when a required model is unavailable.

## 6. `spawn_subsession` and `continue_subsession`

### Use `spawn_subsession`

Use a fresh child for:

- Each phase builder.
- Each changed repository revision that needs review.
- Each repair after judge findings.
- Each adversarial review.
- Each role change.
- Each root-cause reset.

Fresh sessions protect role independence and remove stale assumptions.

### Use `continue_subsession`

Continue only when the role, scope, and repository tree are unchanged.

Permitted uses are:

- Request missing command output.
- Clarify an ambiguous report.
- Resume an interrupted unchanged assignment.
- Supply a human answer before the worker changes code.

Do not continue after:

- Repository changes.
- A role or phase change.
- Context compaction or transcript summarization.
- Repeated quota or connection failures.
- One failed repair attempt for the same family.

A continued judge cannot provide an independent review of repaired code.

## 7. Durable defect ledger

Use one local ledger per phase:

```text
/workspaces/RepJot/.agent-work/phase-${PHASE}-review.md
```

The orchestrator creates it from [`ledger-template.md`](prompts/phase-work/ledger-template.md).

The orchestrator is the only ledger writer. Children return structured evidence instead of editing shared state.

This single-writer rule prevents concurrent edits and unauthorized defect closure.

### Stable identifiers

Use IDs such as `P08-D001`.

Apply these rules:

- Never renumber or reuse an ID.
- Keep closed and rejected findings.
- Reuse the ID when the same behavior recurs.
- Let reviewers label new candidates `NEW-1`, `NEW-2`, and higher.
- Let the orchestrator assign permanent IDs during consolidation.

### Defect states

Use only these states:

- `OPEN`
- `IN_REPAIR`
- `FIXED_UNVERIFIED`
- `VERIFIED`
- `BLOCKED_POLICY`
- `REJECTED_INTERPRETATION`

Only a fresh judge supplies verification evidence. Only the orchestrator changes ledger state.

### Information sent to each role

| Role | State supplied |
|---|---|
| Builder | Public phase packet only. No private cases or ledger. |
| Logic or mechanical fixer | Assigned defect-family extract only. |
| Repair builder | Assigned family, architecture context, and all known reproductions. |
| Contract judge | Complete current ledger and private acceptance cases. |
| Adversarial reviewer | Relevant open defects, trust-boundary packet, and hostile categories. |
| Root-cause analyst | History of the failed family and related review evidence. |

## 8. Review flow with fewer rounds

### 8.1 Prepare before implementation

The orchestrator reads all authority and prepares the public and private acceptance matrices.

The builder receives all acceptance categories. The orchestrator withholds selected exact inputs to preserve independent evidence.

### 8.2 Front-load defect discovery

After the initial build, freeze the review revision.

For a routine phase, spawn one broad contract judge.

For a high-risk phase, spawn a contract judge and adversarial reviewer against the same tree. The read-only reviews can run in parallel.

Do not repair until all initial reviews return. Each reviewer must search the complete boundary and not stop after the first defect.

### 8.3 Group by root cause

The orchestrator removes duplicate findings and assigns stable IDs.

One fixer receives all symptoms and reproductions from one root-cause family. Unrelated families remain separate.

Run fixers sequentially. Parallel fixes can invalidate other fixes and their evidence.

Do not run a judge after every fixer while known families remain. Complete the planned repair set first.

### 8.4 Run one complete final review

After all known defects become `FIXED_UNVERIFIED`, spawn one fresh contract judge.

The final judge examines the complete diff, every ledger defect, private cases, gates, and regressions.

For high-risk work, the final judge reruns the adversarial matrix. Add another adversarial session only when a repair changed the trust boundary.

The target is two review stages:

1. One broad initial stage.
2. One fresh final stage.

### 8.5 Reset after repeated failure

If the final judge reopens a family, do not repeat the same fixer prompt.

Spawn the root-cause analyst. Then select a fresh fixer and run one more fresh final judge.

If the same family fails twice after the reset, stop and reassess phase scope or authority.

Ask the user only for a real product decision, a new persisted fact, or a source-precedence decision.

## 9. Acceptance rules

The parent accepts only when all these statements are true:

- The task ID matches the phase file.
- The ledger lists every child session.
- Defect identifiers stayed stable.
- No defect remains `OPEN`, `IN_REPAIR`, or `FIXED_UNVERIFIED`.
- No worker report contains an unresolved acceptance risk.
- A fresh final judge reviewed the current tree.
- The final judge returned detailed evidence, not a bare verdict.
- Private cases passed against the final tree.
- Phase commands, applicable gates, and affected regressions passed.
- Git facts match worker reports.
- No generated churn, secret, unrelated edit, or unsupported dependency remains.
- `git diff --check` passed.
- Human evidence was not fabricated.
- The commit contains only accepted phase work.

## 10. Why this layout is smaller

The handbook explains policy once. Runtime prompts contain only role instructions.

The orchestrator reads one small template before each spawn. A child receives one rendered assignment and its relevant state slice.

This structure avoids sending model-selection policy, unrelated role prompts, and private cases to every child.
