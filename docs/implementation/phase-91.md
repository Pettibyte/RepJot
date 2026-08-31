# Phase 91: Prepare immutable deployment handoff and stop

## 1. Mission

Give the human release owner an exact reviewed candidate without deploying it.

## 2. Prerequisites and scope

The parent judge must accept Phase 90 before this phase starts.

This phase covers one task in the compatibility, security, and release workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P91-T01 — Prepare immutable deployment handoff and stop**
  - **Objective:** Give the human release owner an exact reviewed candidate without deploying it.
  - **Inspect:** `docs/RELEASE.md`, `README.md`, `.pi-web/tasks.json`, all package scripts, the exact candidate diff, the candidate digest, and human-only deployment requirements.
  - **Create or edit:** Human handoff instructions, the final evidence manifest, and existing automation that exposes a coding-agent deployment action. Do not add an automated push or deployment script.
  - **Steps:** Remove or disable coding-agent deployment tasks, including the current subtree-push task. Mark existing deployment instructions as human-only. Rerun every available automated gate without source changes. Compare the candidate digest with reviewed evidence. Package the `dist/` manifest, diff, checks, unresolved manual gates, and rollback notes for the human release owner. Put a prominent instruction in the runbook that coding agents must never deploy, publish, or run `git push`. Stop after handoff.
  - **Edge cases:** Source change after review, CNAME drift, cache-key drift, a failed gate, missing approval, and a request for the coding agent to push.
  - **Tests or fixtures:** Assert that project release scripts contain no push or deployment action. Validate the handoff manifest and candidate digest.
  - **Validation:** `bun install --frozen-lockfile`. Then run `bun run check`. Then run `bun run test`. Then run `bun run validate:schemas`. Then run `bun run validate:static:fixtures`. Then run `bun run compare:production -- --first-release`. Then run `bun run build`. Then run `bun run check:compat`. Then run `bun run test:bundle`. Then run `bun run audit:release`. Then run `bun run verify:release-evidence`.
  - **Acceptance:** The human receives a reproducible candidate and evidence package. The coding agent performs no deployment, publication, remote Git operation, or live-domain verification.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- The human receives a reproducible candidate and evidence package. The coding agent performs no deployment, publication, remote Git operation, or live-domain verification.

The planned validation is:

- `bun install --frozen-lockfile`. Then run `bun run check`. Then run `bun run test`. Then run `bun run validate:schemas`. Then run `bun run validate:static:fixtures`. Then run `bun run compare:production -- --first-release`. Then run `bun run build`. Then run `bun run check:compat`. Then run `bun run test:bundle`. Then run `bun run audit:release`. Then run `bun run verify:release-evidence`.

Only the parent can change task `P91-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P91-T01`.
