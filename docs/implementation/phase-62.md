# Phase 62: Package local fonts and Material Symbols

## 1. Mission

Provide reviewed same-origin fonts without making controls depend on glyph rendering.

## 2. Prerequisites and scope

The parent judge must accept Phase 61 before this phase starts.

This phase covers one task in the shell, routing, and status ui workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P62-T01 — Package local fonts and Material Symbols**
  - **Objective:** Provide reviewed same-origin fonts without making controls depend on glyph rendering.
  - **Inspect:** Architecture Local Material Symbols Packaging and gate 6.
  - **Create or edit:** `scripts/build-fonts.ts`, font manifests/licenses/checksums, `src/ui/icons/material-symbols.ts`, `src/ui/components/Icon.svelte`, and tests.
  - **Steps:** Select official upstream releases for the families approved in `design/DESIGN.md`. Pin exact versions, source URLs, checksums, and upstream licenses. Subset only used outlined/filled ligatures and needed Inter/JetBrains Mono weights. Copy licenses to publishable assets. Restrict icon props to manifest names. Mark decorative glyphs hidden. Require labels on icon-only buttons.
  - **Edge cases:** Unofficial source, checksum mismatch, unknown glyph, font load failure, stale subset, duplicate ligature, missing license, and large output.
  - **Tests or fixtures:** Add manifest/type tests, glyph inventory tests, fallback rendering structure tests, and license assertions.
  - **Validation:** `bun run build:fonts`. Then run `bun test tests/ui/icon.test.ts tests/ui/fonts.test.ts`. Then run `bun run build`.
  - **Acceptance:** Gate 6 passes in fixture/reviewed-asset mode. Primary/destructive actions retain visible text. Missing assets fail the build.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Gate 6 passes in fixture/reviewed-asset mode. Primary/destructive actions retain visible text. Missing assets fail the build.

The planned validation is:

- `bun run build:fonts`. Then run `bun test tests/ui/icon.test.ts tests/ui/fonts.test.ts`. Then run `bun run build`.

Only the parent can change task `P62-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P62-T01`.
