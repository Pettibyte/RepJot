# Phase 61: Implement centralized e-ink design tokens and base styles

## 1. Mission

Encode the authoritative monochrome, zero-radius, accessible visual system once.

## 2. Prerequisites and scope

The parent judge must accept Phase 60 before this phase starts.

This phase covers one task in the shell, routing, and status ui workstream. Do not implement later tasks.

The phase has one task. Keep the change within 1,500 added lines and 20 changed files.

## 3. Required reading

Read `docs/implementation/README.md` and its common authority list. Read every source in the task inspection list.

## 4. Ordered task

- [ ] **P61-T01 — Implement centralized e-ink design tokens and base styles**
  - **Objective:** Encode the authoritative monochrome, zero-radius, accessible visual system once.
  - **Inspect:** Requirements 8, `design/DESIGN.md`, and Kindle constraints.
  - **Create or edit:** `src/ui/styles/tokens.css`, `base.css`, `components.css`, and style tests.
  - **Steps:** Define black/white/middle-gray colors, typography, spacing, borders, target heights, content width, and 4px focus outline. Use block flow and simple flex rows. Add system font fallbacks. Avoid transitions and large repaint effects.
  - **Edge cases:** Font failure, 600px width, 930px Kindle width, long labels, zoom, forced colors where practical, and print/download content.
  - **Tests or fixtures:** Add static CSS assertions for prohibited effects and visible focus tokens.
  - **Validation:** `bun test tests/ui/styles.test.ts`. Then run `bun run build`. Then run `bun run check:compat`.
  - **Acceptance:** Shared CSS owns reusable styling. Components do not scatter page-level colors, radii, effects, or focus rules.

## 5. Parent judge gate

The parent judge must complete these actions:

1. Inspect the complete diff and its import direction.
2. Apply independent positive and negative acceptance cases.
3. Run the phase validation commands.
4. Run affected regression gates from accepted phases.
5. Compare the completion report with Git and command facts.
6. Reject scope growth, invented contracts, or unsupported evidence.

The phase acceptance criterion is:

- Shared CSS owns reusable styling. Components do not scatter page-level colors, radii, effects, or focus rules.

The planned validation is:

- `bun test tests/ui/styles.test.ts`. Then run `bun run build`. Then run `bun run check:compat`.

Only the parent can change task `P61-T01` to completed.

## 6. Completion report

Return the report format from `docs/implementation/README.md`. Use only task ID `P61-T01`.
