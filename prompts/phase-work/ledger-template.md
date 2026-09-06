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

## Operating model

Intended actor and workflow: ${WORKFLOW}
Supported concurrency: ${CONCURRENCY_OR_NONE}
Trusted inputs and environment: ${TRUST_MODEL}
Excluded threats and failure modes: ${EXCLUSION}
Output classification: ${USER_DATA_CANONICAL_OR_REGENERABLE}

Do not convert an excluded scenario into a defect without new authority.

## Public acceptance matrix

| Contract area | Positive category | Negative category | Recovery category | Persistence or concurrency category |
|---|---|---|---|---|
| ${AREA} | ${CATEGORY} | ${CATEGORY} | ${CATEGORY} | ${CATEGORY_OR_NA} |

## Private acceptance cases

Mandatory acceptance cases live in the worker-readable `docs/implementation/phase-${PHASE_PADDED}-acceptance.md`. Keep additional judge-only probe inputs private in this ledger and do not send them to builders or fixers.

| Case | Authority | Expected result | Last result | Review revision |
|---|---|---|---|---|
| A-001 | ${SOURCE} | ${EXPECTED} | NOT_RUN | R0 |

## Defects

### P${PHASE_PADDED}-D001 — ${TITLE}

State: OPEN
Severity: blocker | major | minor
Finding classification: CONTRACT_DEFECT | IMPLEMENTATION_CREATED_OBLIGATION
Root-cause family: ${FAMILY}
Requirement origin and exact authority: ${SOURCE}
Supported workflow affected: ${WORKFLOW}
Reproduction assumptions: ${ASSUMPTIONS}
Expected behavior: ${EXPECTED}
Observed behavior: ${OBSERVED}
Concrete consequence: ${CONSEQUENCE}
Reproduction: ${REPRODUCTION}
Simplest compliant resolution: ${SIMPLEST_RESOLUTION}
Reason simplification was rejected: ${REASON_OR_NOT_REJECTED}
Affected area: ${AREA}
Found by session: ${SESSION_ID}
Introduced or exposed at revision: ${REVISION}
Repair session: NONE
Repair evidence: NONE
Verification session: NONE
Verification evidence: NONE
Notes and rejected interpretations: NONE

## Nonblocking review findings

| Finding | Classification | Authority assessment | Disposition |
|---|---|---|---|
| ${FINDING} | OPTIONAL_HARDENING | Not required by ${SOURCE} | DEFERRED |
| ${FINDING} | EXCLUDED_SCENARIO | Outside `${WORKFLOW}` | REJECTED_INTERPRETATION |

## Child sessions

Record every spawned child, its model, revision range, report file path, and result. No-output attempts are recorded as NO_OUTPUT and not counted as completed reviews.

| Role | Session ID | Model | Revision | Report file | Result |
|---|---|---|---|---|---|
| ${ROLE} | ${SESSION_ID} | ${MODEL} | ${REVISION_RANGE} | ${REPORT_FILE_OR_NONE} | ${RESULT} |

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