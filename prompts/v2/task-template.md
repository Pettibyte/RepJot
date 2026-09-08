# Phase N — TASK-ID

<!-- Copy to .agent-work/phase-N/task.md. Replace placeholders before dispatch.
This file stores current facts, not a chronological transcript.
The orchestrator owns scope and stage. Each active role updates only its assigned evidence.
Retain each defect's original reproduction and before/after results. Link long output in logs/. -->

## Scope — orchestrator

- Stage: PREPARE | BUILD | DISCOVER | FIX | CONFIRM | ADVERSARY | ACCEPTED | BLOCKED
- Phase file and task:
- Prerequisite acceptance:
- Base commit and initial dirty-file ownership:
- Current snapshot manifest and environment:
- Allowed areas and prohibited changes:
- Supported actor, workflow, inputs, concurrency, and exclusions:
- Output type: user data, canonical data, or regenerable artifact
- Risk: ROUTINE | HIGH, with requirement-backed reason
- Approved adversarial risk rows, or NONE:
- Expected external blockers and manual evidence:
- Models: from MODEL ROUTING in `prompts/v2/orchestrator.md`, one per role, recorded in the dispatch ledger below
- Invocation budget used: judge 0/2 routine or 0/3 high-risk, adversary 0/1
- Budget exception or process override: NONE unless explicitly authorized

### Dispatch ledger — orchestrator

<!-- One row per child session, written at spawn. A session keeps one role for its whole life:
     before every continuation, read the row and send only work for the role in the row. To change
     role, spawn a new row. Record every dispatch mistake here with the time and whether it touched
     any file. -->

| Role | Exact model | Session ID | Stage |
| --- | --- | --- | --- |

## Requirements and coverage — builder, then judge

<!-- Add one row per authoritative invariant or existing traceability row.
R-IDs are local references. They cannot create requirements.
Record PASS, FAIL, NOT_RUN, or N/A with a reason. -->

| ID | Source section and supporting quote | Owning phase / required behavior | Implementation / development tests | Independent cases and result |
| --- | --- | --- | --- | --- |

## Commands — active role

<!-- Copy the exact phase and gate commands. State expected failure for negative probes.
The parent still runs every required parent gate at final acceptance. -->

| Command / purpose | Expected result | Runner / snapshot / environment | Exit / relevant output / log |
| --- | --- | --- | --- |

## Findings — discoverer, then fixer, then judge

<!-- Use stable D001-style IDs. Follow protocol.md's complete repair packet fields.
No separate report or private ledger. Keep rejected findings with their authority reason.
For each accepted defect, retain proof, diagnosis, repair advice, and verification evidence here. -->

No findings yet.

## Attack table — adversary, high-risk only

| Requirement and source | Supported actor and boundary | Failure hypothesis | Probe / expected / actual result |
| --- | --- | --- | --- |

## Handoff — active role

- Role, mode, and status:
- Snapshot and changed areas:
- Findings requiring action:
- Untested requirements or unresolved decisions:
- Next bounded action:

## Acceptance — judge, then orchestrator

- Judge recommendation and snapshot:
- Coverage gaps: NONE required for acceptance
- Open or blocked defects: NONE required for acceptance
- Adversarial outcome: passing evidence or NOT REQUIRED
- Final parent diff inspection and gate evidence:
- External blockers and manual evidence still required:
- Actual judge/adversary invocation counts and any authorized exception:
- Accepted commit and task completion:
