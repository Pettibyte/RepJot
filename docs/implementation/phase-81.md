# Phase 81: Enforce trusted SVG, glyph, font, license, and local-asset gates

## 1. Mission

Implement Section 18 gates 5-6 with the font families approved in `design/DESIGN.md`.

## 2. Prerequisites and scope

The parent judge must accept Phase 80 before this phase starts.

This phase covers one task in the compatibility, security, and release workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P81-T01 — Enforce trusted SVG, glyph, font, license, and local-asset gates**
  - **Objective:** Implement Section 18 gates 5-6 with the font families approved in `design/DESIGN.md`.
  - **Inspect:** `design/DESIGN.md`, official font sources, the static icon validator, font task, manifests, checksums, licenses, UI icon references, and `dist/` assets.
  - **Create or edit:** Asset audit code/tests and release runbook.
  - **Steps:** Select and pin official Inter, JetBrains Mono, and Material Symbols releases. Record source URLs and checksums. Include upstream licenses. Sanitize and resolve every SVG. Scan component glyph names against the manifest. Rebuild local subsets. Assert same-origin references, fallback text/names, checksums, font bytes, and copied licenses.
  - **Edge cases:** Unofficial source, checksum mismatch, missing glyph, stale manifest, remote CSS URL, data URL icon, malicious SVG, missing license, and font generation drift.
  - **Tests or fixtures:** Add hostile SVG and missing-glyph failures plus font-failure component coverage.
  - **Validation:** `bun run build:fonts`, `bun run validate:static:fixtures`, `bun test tests/ui/fonts.test.ts tests/ui/icon.test.ts tests/security-policy.test.ts`.
  - **Acceptance:** Asset tooling and fixture gates pass. Gate 5 also requires human-approved canonical icon references. Gate 6 passes when official pinned files, checksums, and licenses pass the audit. Runtime loads no remote font or UI asset. Font failure cannot hide an action.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Asset tooling and fixture gates pass. Gate 5 also requires human-approved canonical icon references. Gate 6 passes when official pinned files, checksums, and licenses pass the audit. Runtime loads no remote font or UI asset. Font failure cannot hide an action.

The planned validation is:

- `bun run build:fonts`, `bun run validate:static:fixtures`, `bun test tests/ui/fonts.test.ts tests/ui/icon.test.ts tests/security-policy.test.ts`.

Only the parent can change task `P81-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P81-T01`.
