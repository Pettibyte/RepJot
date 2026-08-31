# Phase 85: Enforce CSP, endpoint, token, telemetry, and dependency policy

## 1. Mission

Complete Section 18 gate 10 and Architecture Section 15 controls.

## 2. Prerequisites and scope

The parent judge must accept Phase 84 before this phase starts.

This phase covers one task in the compatibility, security, and release workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P85-T01 — Enforce CSP, endpoint, token, telemetry, and dependency policy**
  - **Objective:** Complete Section 18 gate 10 and Architecture Section 15 controls.
  - **Inspect:** All network endpoints, CSP, dependencies, bundle strings, generated HTML, and licenses.
  - **Create or edit:** CSP meta policy, `scripts/audit-release.ts`, `tests/security-policy.test.ts`, and security runbook sections.
  - **Steps:** Allow same-origin assets, top-level Google authorization, exact revocation form/frame origin, and Drive HTTPS only. Scan for GIS, unexpected remote code, telemetry, ad/analytics endpoints, tokens, client secrets, raw source maps, unsafe HTML, and service-worker registration. Review dependency licenses and vulnerabilities without auto-ignoring findings.
  - **Edge cases:** URL hidden in minified strings, source map comment, inline loader hash mismatch, broad wildcard CSP, `innerHTML`, remote SVG, and diagnostic upload path.
  - **Tests or fixtures:** Add bad endpoint, secret, source-map, telemetry, and CSP fixtures.
  - **Validation:** `bun run audit:release`. Then run `bun test tests/security-policy.test.ts`. Then run `bun run test:bundle`.
  - **Acceptance:** Gate 10 passes with no unexpected endpoint, secret, token, telemetry, source map, or remote code. GitHub Pages header limits remain documented as R-06.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Gate 10 passes with no unexpected endpoint, secret, token, telemetry, source map, or remote code. GitHub Pages header limits remain documented as R-06.

The planned validation is:

- `bun run audit:release`. Then run `bun test tests/security-policy.test.ts`. Then run `bun run test:bundle`.

Only the parent can change task `P85-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P85-T01`.
