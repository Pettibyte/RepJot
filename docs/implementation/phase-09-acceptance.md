# Phase 9 mandatory acceptance categories

Task `P9-T01`. These public categories guide builders and fixers. Judge-only exact inputs remain in the local review ledger.

## Operating model

One engineer runs an isolated compatibility tool in a trusted local workspace. First-release mode explicitly accepts the absence of a prior production bundle and performs no network request or baseline write. Future comparison consumes supplied current and prior data. A separate approval-bound action records a digest only after explicit human approval. Persistence and concurrency are not applicable.

## Required categories

- Blank first release: succeeds without a prior bundle, network request, fabricated digest, or baseline write.
- Future compatible release: unchanged data and reordered arrays succeed; labels, instructions, notes, and prescriptions may change.
- Forbidden identity changes: deletion, namespace reuse, node movement, role change, exercise-reference change, container-strategy change, score-contract change, dimension removal, and previously supported unit removal fail with stable diagnostic codes.
- Additions and lifecycle: new IDs are accepted; newly deprecated exercises remain resolvable and report affected workouts and scored/timed containers. Deprecation does not authorize deletion or reuse.
- Approval boundary: baseline recording is separate from comparison, requires exact explicit human approval, rejects missing, stale, malformed, or mismatched approval, and preserves the target on failure.
- Determinism and safety: equivalent inputs produce deterministic results; fixture mode performs no network access; canonical production files remain unchanged.

## Required commands

```text
bun test tests/compatibility.test.ts
bun scripts/compare-production.ts --fixture tests/fixtures/compatibility/compatible
```

Builders and fixers must also run affected repository checks required by the rendered parent prompt. This file does not establish human approval or prior-production evidence.
