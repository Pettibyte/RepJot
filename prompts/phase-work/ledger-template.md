# Runtime phase-review ledger template

The orchestrator copies this template to `.agent-work/phase-${PHASE}-review.md`.

```markdown
# Phase ${PHASE} review ledger

Status: BUILDING | INITIAL_REVIEW | REPAIR | FINAL_REVIEW | ACCEPTED | BLOCKED
Task ID: ${TASK_ID}
Baseline commit: ${BASELINE_COMMIT}
Current review revision: R0
Current tree description: ${TREE_DESCRIPTION}
Judge sessions used: 0
Adversarial sessions used: 0

## Authority and scope

Primary sources:
- ${SOURCE}

Applicable gates:
- ${GATE}

Allowed areas:
- ${AREA}

Prohibited changes:
- ${PROHIBITION}

Stop conditions:
- ${STOP_CONDITION}

## Public acceptance matrix

| Contract area | Positive category | Negative category | Recovery category | Persistence or concurrency category |
|---|---|---|---|---|
| ${AREA} | ${CATEGORY} | ${CATEGORY} | ${CATEGORY} | ${CATEGORY_OR_NA} |

## Private acceptance cases

Do not send exact private inputs to builders or fixers.

| Case | Authority | Expected result | Last result | Review revision |
|---|---|---|---|---|
| A-001 | ${SOURCE} | ${EXPECTED} | NOT_RUN | R0 |

## Defects

### P${PHASE_PADDED}-D001 — ${TITLE}

State: OPEN
Severity: blocker | major | minor
Root-cause family: ${FAMILY}
Authority: ${SOURCE}
Expected behavior: ${EXPECTED}
Observed behavior: ${OBSERVED}
Reproduction: ${REPRODUCTION}
Affected area: ${AREA}
Found by session: ${SESSION_ID}
Introduced or exposed at revision: ${REVISION}
Repair session: NONE
Repair evidence: NONE
Verification session: NONE
Verification evidence: NONE
Notes and rejected interpretations: NONE

## Review history

| Revision | Tree changed by | Contract judge | Adversarial reviewer | Result |
|---|---|---|---|---|
| R0 | ${BUILDER_SESSION} | NOT_RUN | NOT_RUN | BUILDING |

## Final acceptance

Final judge session: NONE
Final judge recommendation: NONE
Parent gate evidence: NONE
Accepted commit: NONE
```

Allowed defect states:

- `OPEN`
- `IN_REPAIR`
- `FIXED_UNVERIFIED`
- `VERIFIED`
- `BLOCKED_POLICY`
- `REJECTED_INTERPRETATION`

Only the orchestrator edits this ledger. A fresh judge supplies evidence for `VERIFIED`.