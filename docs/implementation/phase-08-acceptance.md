# Phase 8 mandatory acceptance cases

Task `P8-T01`. These are the mandatory acceptance cases for the static exercise curation pipeline. Builders and fixers run them before returning control; the parent orchestrator reruns them after every repair and at final acceptance. Judge-only probe inputs beyond these cases stay private in the review ledger.

## Operating model

One engineer runs the tool in a trusted local workspace. Generation writes one deterministic git-ignored review artifact to `.curation-staging` (or an external isolated test directory) and never writes canonical data. Promotion is a separate command that validates the artifact, its candidate-derived review metadata, schema and semantics, and exact approval before replacing the canonical file as one whole file. Same-path concurrency and hostile filesystem mutation are excluded.

## Cases

| Case | Authority | Required result |
|---|---|---|
| A-001 | Requirements 13.1-13.5; phase acceptance | At one fixed temporary root, source IDs `Alpha_Body` (`equipment: "body only"`) and `Zulu_Bar` (`equipment: "barbell"`) are stored first as `z-last.json`/`a-first.json`, then with filenames and JSON key order permuted. Reverse curation exercise/equipment order too. Both generation runs must emit byte-identical review artifacts; embedded `alpha-body.equipmentIds` is `[]`. |
| A-002 | Exercise schema muscle enum; phase edge cases plus user recovery decision | After one valid artifact exists, source ID `Private_Deltoid_Case` with primary muscle token `deltoids` fails with a diagnostic naming that source or file, writes no canonical file or partial temp, and leaves the prior complete artifact byte-identical. |
| A-003 | Requirements 13.5; phase edge cases | Allowlisted source ID `Null_Rower` with `equipment: null` and no `equipmentIds` override fails with `Null_Rower`; adding explicit `equipmentIds: ["rowing-machine"]` plus its declared registry makes a fresh artifact generation succeed. |
| A-004 | Requirements 13.2; phase edge cases plus separate-promotion decision | Source ID `Omitted_Curl` omitted from curation fails closed with that exact ID, leaves a prior complete review artifact byte-identical, and cannot alter sentinel canonical bytes `PRIVATE-SENTINEL`. |
| A-005 | Phase approval boundary plus user decision | Generate artifact X for `Approval_One`, approve X's candidate digest, then change only its instruction to generate artifact Y. Generation must never alter sentinel canonical bytes. Separate promotion of Y with approval X must fail and preserve the sentinel. Separate promotion with approval Y can write only a temporary canonical target. |
| A-006 | Phase edge cases | Source IDs `A_B` and `A-B` in files with reversed lexical names derive the same REP JOT ID and must fail deterministically while naming both identities or the collision; no artifact or canonical output is written. |
| A-007 | Static hosting and no-network scope | A complete local fixture for source ID `Offline_Carry` succeeds when `globalThis.fetch` is replaced with a throwing function in an imported-process probe; the artifact contains no `http:`, `https:`, or protocol-relative references. |

## How to run

All cases are implemented in `tests/static-transform.test.ts`. Run:

```text
bun test tests/static-transform.test.ts
```

A case is satisfied only when its named behavior holds, not merely when the suite passes. Fixers must record each case result in their report; a NOT_RUN case requires a reason.
