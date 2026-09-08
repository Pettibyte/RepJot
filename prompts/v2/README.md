# V2: one discovery pass, evidence-based repair

These are new prompts. They do not change the active sessions, existing templates, or product requirements.
See [STRATEGY.md](STRATEGY.md) for the audit and rationale.

## Normal path

```text
Builder -> Judge DISCOVER -> Fixer batch -> same Judge CONFIRM -> parent acceptance
```

For explicitly approved high-risk work:

```text
Contract confirmation -> Adversary -> Fixer batch -> same Judge CONFIRM -> parent acceptance
```

Empty repair stages disappear. Routine work uses at most two judge invocations. High-risk work uses at most three and one adversary.
A failed confirmation stops the automatic pipeline. It does not produce false sign-off or another silent retry.
The user can authorize a bounded exception from the preserved evidence.

A perfect single pass is a target, not a guarantee. The enforceable promises are complete handoffs, fixed scope, and bounded automatic spending.

## Files

| File | Purpose |
| --- | --- |
| `orchestrator.md` | Scope, dispatch, budgets, and final acceptance |
| `builder.md` | One implementation pass |
| `judge.md` | Independent discovery, then repair confirmation |
| `fixer.md` | One complete defect batch |
| `adversarial-reviewer.md` | One approved risk-specific attack pass |
| `protocol.md` | Shared authority, proof, and handoff rules |
| `task-template.md` | Current task state and shared evidence index |

There is no supervisor, root-cause analyst, mechanical fixer, repair-builder, private ledger, or separate role report.
Each role reads its prompt, the shared protocol, the task, and relevant authority. It does not read this whole directory.

## Start a new phase

Use this instruction with the desired phase and task:

```text
Use prompts/v2/orchestrator.md for Phase <N>, task <ID>. Stop before the next phase.
I approve the v2 procedural replacements described in prompts/v2/README.md.
Use the current model unless I specify exact models for individual roles.
```

The orchestrator sends children the role path and task path directly. It also supplies the mode and assigned IDs or sections.
These are repository instructions, not automatically registered slash commands. No template installation or extension is required.

### Procedural replacements

Adoption replaces these process rules in `prompts/phase-work/` and `docs/implementation/README.md`, Section 4:

- Reuse the same judge and fixer across changed snapshots within one phase.
- Repair unrelated accepted families in one fixer session, with separate causal changes and tests.
- Permit reviewers to add regression tests and fixtures.
- Share all defect evidence instead of withholding private cases from fixers.
- Replace full rediscovery after repairs with confirmation of changes and affected invariants.
- Replace reset sessions and automatic retries with an explicit invocation budget.
- Replace per-role reports and the private ledger with shared task evidence.

The initial builder still does not receive every independent acceptance input when the plan requires this separation.
Every discovered failure becomes shared evidence before repair.
Product authority, phase ownership, parent acceptance, mandatory gates, prerequisites, and human approvals remain unchanged.
If another binding process rule conflicts, stop for a specific decision. Do not silently override it.

## Rescue Phase 10 without restarting it

1. Stop dispatch from the old orchestrator before starting another writer.
2. Preserve the current dirty tree and all existing regression tests.
3. Create the v2 task file with the current snapshot and actual file ownership.
4. Import each unresolved defect's requirement, complete proof, diagnosis, and owner from existing reports.
5. Reject unsupported expectations explicitly. Do not discard a supported failure because it arrived late.
6. Separate prior-phase repairs from Phase 10 integration and audit work.
7. Obtain explicit authorization for any cross-phase repair before editing that phase's code.
8. Reuse existing tests and current evidence wherever their inputs still match.
9. Assign only missing discovery coverage or complete repair packets, not another unrestricted phase audit.
10. Record the remaining invocation budget before dispatch.

Existing review activity does not disappear from reported totals. A rescue budget is an explicit exception, not a renamed restart.

## What counts as a useful finding?

A useful finding lets the fixer run the defect immediately, understand its cause, and know exactly how closure works.
It includes a requirement quote, an expected-result explanation, a persistent failing test, a passing control, causal code references, and equivalent failures.
Manual or integration evidence replaces a unit test when that boundary needs it. The reviewer must explain the choice.

A copied command without its input is not a reproduction. A failing assertion without product authority is not a contract defect.
An unexplained symptom is not a complete handoff. A hypothesis is not an observed cause.

## Tracking and cost

Use `.agent-work/phase-N/task.md` as the single shared index. Keep regression tests in the normal test suite.
Keep large logs and snapshot manifests in the locally excluded task directory.
Each active role updates its evidence. The orchestrator controls scope and stage transitions.
Tests preserve the defect. The task file preserves its authority and diagnosis. Neither needs a separate chronological ledger.

Measure judge invocations, adversary invocations, repair batches, late review misses, incomplete handoffs, and repeated command executions.
Record model-reported cost and elapsed time when available. Do not estimate token savings from word counts alone.
The target is zero incomplete handoffs and zero rediscovery of known causes. A missed real defect remains reportable.

## Validation before dispatch

- Verify that every blocking expected result follows from its cited requirement.
- Verify that the snapshot includes dirty and untracked implementation inputs.
- Verify that every repair packet contains runnable evidence or a justified manual alternative.
- Verify that every discovery row has evidence or an explicit gap.
- Verify that confirmation covers repair changes without reopening unrelated discovery.
- Verify that a failed confirmation stops, rather than triggering another session chain.
- Verify that final parent gates still run on the accepted snapshot.

These prompts need operational evaluation on real work. Static inspection cannot prove lower cost or better defect detection.
