# Phase 87: Validate CNAME, static portability, and bundle diff

## 1. Mission

Complete Section 18 gates 12-13 before human release handoff.

## 2. Prerequisites and scope

The parent judge must accept Phase 86 before this phase starts.

This phase covers one task in the compatibility, security, and release workstream. Do not implement later tasks.

The phase has one task. Use the review-size targets in `docs/implementation/README.md`, Section 4.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P87-T01 — Validate CNAME, static portability, and bundle diff**
  - **Objective:** Complete Section 18 gates 12-13 before human release handoff.
  - **Inspect:** `src/public/CNAME`, `dist/CNAME`, relative asset paths, prior `dist/`, and deployment process.
  - **Create or edit:** Bundle audit, `docs/RELEASE.md`, and evidence references.
  - **Steps:** Assert exact `repjot.com` CNAME. Assert no GitHub runtime API dependency or path tied to the default Pages host. Generate a production-bundle diff and file manifest. Give both to the human release owner. Do not publish or run `git push`.
  - **Edge cases:** Trailing whitespace in CNAME, absolute asset URL, missing file, unexpected deletion, generated cache key noise, and unreviewed binary change.
  - **Tests or fixtures:** Add CNAME and portability failures. Keep review result external until supplied.
  - **Validation:** `bun run build`. Then run `bun run test:bundle`. Then run `bun run audit:release`.
  - **Acceptance:** Gate 12 is automated. Gate 13 stays `NOT PROVIDED` until an authorized reviewer records approval.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Gate 12 is automated. Gate 13 stays `NOT PROVIDED` until an authorized reviewer records approval.

The planned validation is:

- `bun run build`. Then run `bun run test:bundle`. Then run `bun run audit:release`.

Only the parent can change task `P87-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P87-T01`.
