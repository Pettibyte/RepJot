# Phase 90: Draft privacy policy, collect approvals, and classify release status

## 1. Mission

Draft the public policy and complete Section 18 gate 15 without converting external decisions into code assertions.

## 2. Prerequisites and scope

The parent judge must accept Phase 89 before this phase starts.

This phase covers one task in the compatibility, security, and release workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P90-T01 — Draft privacy policy, collect approvals, and classify release status**
  - **Objective:** Draft the public policy and complete Section 18 gate 15 without converting external decisions into code assertions.
  - **Inspect:** Requirements 14.1-14.10, Architecture Sections 8, 10, and 15, Cloudflare proxy facts supplied by the owner, and the launch checklist.
  - **Create or edit:** `src/public/privacy.html`, `docs/release/LAUNCH-GATES.md`, evidence manifest, privacy tests, and final release report.
  - **Steps:** Draft a plain-language policy for `https://repjot.com/privacy.html`. State that REP JOT has no application backend and the operator does not receive or store fitness data, Drive files, tokens, or browser-cache content. Explain that canonical user data stays in the user's Google Drive `appDataFolder`. Explain local IndexedDB cache, pending edits, optional remembered-token storage, token expiry, export, deletion, disconnect, and browser-data loss. Explain that Google processes OAuth and Drive requests. Explain that Cloudflare proxies the site and supplies anonymized aggregate metrics. State that REP JOT adds no telemetry. Distinguish operator retention from Drive and browser retention. Add an effective date and require the human release owner to supply or approve legal identity and contact details. Record OAuth consent, separate projects, owned domain, production origins/redirect, Drive scope, data-request process, consumer-health legal review, breach-response process, security review, bundle-diff approval, and deployment authorization.
  - **Edge cases:** A claim that no data exists anywhere, omission of Drive or local storage, Cloudflare described as application telemetry, expired approval, wrong domain, test client in production, missing contact details, partial legal scope, and an absent incident owner.
  - **Tests or fixtures:** Assert the exact privacy route, local-only asset use, required topic headings, no analytics script, and no claim that clearing or disconnecting performs a different operation. Validate approval fields and evidence states only.
  - **Validation:** `bun test tests/privacy-policy.test.ts`. Then run `bun run verify:release-evidence`. Then run `bun run audit:release`. Then run `bun run test:bundle`.
  - **Acceptance:** The draft accurately separates operator, Google Drive, browser, and Cloudflare processing. The public home links to `/privacy.html`. Gate 15 passes only with real human approval references. A coding agent reports release-candidate completion only.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- The draft accurately separates operator, Google Drive, browser, and Cloudflare processing. The public home links to `/privacy.html`. Gate 15 passes only with real human approval references. A coding agent reports release-candidate completion only.

The planned validation is:

- `bun test tests/privacy-policy.test.ts`. Then run `bun run verify:release-evidence`. Then run `bun run audit:release`. Then run `bun run test:bundle`.

Only the parent can change task `P90-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P90-T01`.
