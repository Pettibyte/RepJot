# Phase 01 — Styling foundation and design tokens

Build the single styling system that every later screen consumes. No feature code in
this phase.

## Prerequisites

- None. This phase is the first build phase after the Phase 0 authorization proof.
- Font files for Inter, JetBrains Mono, and Material Symbols Outlined are available
  for local bundling, with their licenses.

## Goals

1. Turn `design/DESIGN.md` into machine-usable CSS custom properties.
2. Provide the shared component primitives that screens compose instead of styling
   themselves.
3. Bundle fonts and icons as same-origin assets.
4. Add a build-time guard that stops scattered or off-system styling.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/ui/styles/tokens.css` | All design tokens as CSS custom properties. The only file that may contain hex color literals. |
| `src/ui/styles/fonts.css` | `@font-face` rules for local Inter and JetBrains Mono. No remote `url()`. |
| `src/ui/styles/base.css` | Reset, body, headings, links, focus rings, form-control resets. |
| `src/ui/styles/components.css` | Class layer for every shared primitive: `.btn`, `.card`, `.field`, `.tabs`, `.bar`. |
| `src/ui/styles/index.css` | Imports `tokens`, `fonts`, `base`, `components` in that order. The only stylesheet entry point. |
| `src/public/fonts/` | `inter-*.woff2`, `jetbrains-mono-*.woff2`, plus `LICENSE-*.txt`. |
| `src/public/icons/` | Reviewed local SVGs for fitness taxonomy. |
| `src/ui/icons/manifest.json` | Reviewed Material Symbols glyph names. The build reads it. |
| `src/ui/components/Icon.svelte` | Renders a Material Symbol glyph or a local SVG. Takes `name`, `label`, `decorative`. |
| `src/ui/components/Button.svelte` | Primary, secondary, and destructive variants. Renders `<button>` or `<a>`. |
| `src/ui/components/Card.svelte` | 2px outline block. No shadow. |
| `src/ui/components/Field.svelte` | Label above control, `inputmode` and `autocomplete` pass-through. |
| `src/ui/components/Tabs.svelte` | Workout / History / Settings tab bar. Renders `<nav>` with links. |
| `src/ui/components/AppHeader.svelte` | Tab-root header. Shows the `REP JOT` wordmark and the save-status slot. |
| `src/ui/components/BackHeader.svelte` | Compact back header for detail and task routes. No tab bar. |
| `src/ui/components/ProgressBar.svelte` | Horizontal solid-fill bar. No circular loader. |
| `scripts/check-styles.ts` | Style guard. Registered as `bun run check:styles`. |
| `package.json` | Adds `check:styles` and adds it to the `build` chain. |

### Token names

`tokens.css` declares the `design/DESIGN.md` palette and scale. Later code uses the
token, never the raw value.

```css
:root {
  --color-bg: #fbf9f9;
  --color-on-bg: #1b1c1c;
  --color-primary: #000000;
  --color-on-primary: #ffffff;
  --color-outline: #7e7576;
  --color-outline-variant: #cfc4c5;
  --color-surface-raised: #ffffff;
  --color-surface-sunken: #efeded;
  --color-disabled: #cfc4c5;

  --space-1: 4px;  --space-2: 8px;  --space-3: 16px;
  --space-4: 24px; --space-5: 48px; --space-gutter: 20px; --space-stack: 32px;

  --radius: 0px;
  --border-weight: 2px;
  --tap-target-min: 56px;

  --font-ui: "Inter", system-ui, sans-serif;
  --font-data: "JetBrains Mono", ui-monospace, monospace;
  --text-body: 16px; --text-body-lg: 18px;
  --text-headline-sm: 24px; --text-headline-md: 20px; --text-headline-lg: 32px;
  --text-data-lg: 36px; --text-label: 14px;
}
```

### Guard rules

`scripts/check-styles.ts` fails the build on any of these outside `tokens.css`:

1. A hex color literal, `rgb(`, `rgba(`, `hsl(`, or named color in a color property.
2. `box-shadow`, `text-shadow`, `linear-gradient`, `radial-gradient`, or `filter: blur`.
3. `border-radius` with a value other than `0` or `var(--radius)`.
4. `display: grid` or `display: inline-grid` in `src/ui/**`.
5. `position: sticky` or `position: fixed` in `src/ui/**`.
6. Any `url(http`, `@import` of a remote URL, or CDN reference in CSS.
7. A `.svelte` file with a `style="..."` attribute that sets color, shadow, or radius.
   Each declaration in the attribute is tested on its own, so a legal `width` does
   not shield a following `color`.
8. A component that defines a `<style>` block containing a rule already present in
   `components.css` for the same class name.

Rules 2, 4, 5, and 7 match ASCII case-insensitively, because CSS keywords and
function names are case-insensitive. `position: STICKY` fails the guard exactly as
`position: sticky` does.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 8.1 | Wordmark component renders `REP JOT` in caps only. |
| REQUIREMENTS 8.2, 8.4 | Monochrome tokens, `--radius: 0`, no shadow or gradient rules, guard blocks them. |
| REQUIREMENTS 8.3 | One token file, one component class layer, one entry point. Guard enforces it. |
| REQUIREMENTS 8.5, 8.6 | `Icon.svelte` supports Material Symbols and local SVG only. |
| REQUIREMENTS 8.7 | Primitives wrap native `<button>`, `<a>`, `<input>`, `<select>`. No control library. |
| REQUIREMENTS 8.8, 8.9 | `Icon` requires `label` unless `decorative` is set. Primitives forward `aria-*`. |
| REQUIREMENTS 8.10, design/DESIGN.md | Token values transcribed from the design front matter. |
| ARCHITECTURE C-04, C-05 | Local fonts bundled. Core layout avoids Grid, sticky, and glyph-only actions. |
| ARCHITECTURE §13 | Guard rejects grid, sticky, shadow, gradient, blur, and remote assets. |
| ARCHITECTURE ADR-019 | Local font and reviewed icon subset; primary actions keep visible text. |

## Checklist

### Implementation

- [x] Create `src/ui/styles/tokens.css` with every color, spacing, type, radius, and
      border token from `design/DESIGN.md`.
- [x] Create `src/ui/styles/fonts.css` with `@font-face` for Inter (400, 700, 800)
      and JetBrains Mono (500, 700) from `src/public/fonts/`.
- [x] Copy the font binaries and their license files into `src/public/fonts/`.
- [x] Create `src/ui/styles/base.css`: reset, `body` color and font, heading scale,
      link style, `:focus-visible` 4px offset outline, native control resets with
      `border-radius: var(--radius)`.
- [x] Create `src/ui/styles/components.css` with `.btn`, `.btn--primary`,
      `.btn--secondary`, `.btn--danger`, `.card`, `.field`, `.field__label`,
      `.tabs`, `.tabs__item`, `.tabs__item--current`, `.bar`, `.bar__fill`,
      `.pill`, `.badge`, `.screen`, `.stack`.
- [x] Create `src/ui/styles/index.css` that imports the four files in order.
- [x] Import `./ui/styles/index.css` from `src/main.ts` so Vite emits one stylesheet
      (`cssCodeSplit: false` is already set).
- [x] Create `src/ui/components/Icon.svelte` with props `name`, `label`,
      `decorative`, `kind: 'material' | 'svg'`.
- [x] Create `src/ui/icons/manifest.json` listing the reviewed Material Symbols glyph
      names used by the application.
- [x] Create `Button.svelte`, `Card.svelte`, `Field.svelte`, `Tabs.svelte`,
      `AppHeader.svelte`, `BackHeader.svelte`, `ProgressBar.svelte`.
- [x] Write `scripts/check-styles.ts` implementing the eight guard rules above.
- [x] Add `"check:styles": "bun scripts/check-styles.ts"` to `package.json` and add
      `bun run check:styles` to the `build` script chain.

### Tests

- [x] `tests/styles.test.ts`: the guard passes on the current tree.
- [x] `tests/styles.test.ts`: the guard fails on a fixture that uses a hex color in
      `components.css`.
- [x] `tests/styles.test.ts`: the guard fails on a fixture with `box-shadow` and on
      one with `border-radius: 8px`.
- [x] `tests/styles.test.ts`: the guard fails on `display: grid` and on
      `position: sticky` under `src/ui/`.
- [x] `tests/styles.test.ts`: the guard fails on a remote `url(https://...)` in CSS.
- [x] Component tests for `Icon.svelte`: a decorative icon renders `aria-hidden="true"`;
      a non-decorative icon without a `label` throws.
- [x] Component test for `Button.svelte`: renders `<a>` when `href` is set and
      `<button type="button">` otherwise.

### Verification

- [x] `bun run check` passes with no new errors.
- [x] `bun test` passes.
- [x] `bun run check:styles` passes.
- [x] `bun run build` produces one CSS asset under `dist/` and no font request
      leaves the origin.
- [x] `bun run check:compat` passes.
- [ ] Manual: open `bun run dev`, confirm headings, buttons, fields, and tabs render
      with local fonts and zero radius. The dev server serves the page and the
      compiled stylesheet, and `/fonts/*.woff2` returns 200. A person still needs
      to look at it.

## Notes on this build

Deviations from the plan, and why.

1. **Fonts are variable, not three static weights.** Google Fonts serves one
   variable file per subset. `src/public/fonts/` holds `inter-latin.woff2`,
   `inter-latin-ext.woff2`, `jetbrains-mono-latin.woff2`, and
   `jetbrains-mono-latin-ext.woff2` — 176 KB total, against about 350 KB for five
   static files. `fonts.css` declares `font-weight: 400 800` for Inter and
   `font-weight: 500 700` for JetBrains Mono. Provenance and SHA-256 values are in
   `src/public/fonts/README.md`.
2. **Material Symbols ship as inline SVG path data, not as a font.**
   `src/ui/icons/manifest.json` holds the reviewed glyph list. `Icon.svelte`
   renders the path inline. The Material Symbols Outlined font is about 3 MB, and
   ARCHITECTURE C-04 says a core control must not depend on a font glyph.
   `scripts/build-icon-manifest.ts` regenerates the manifest from
   `@iconify-json/material-symbols` (Apache 2.0). Add a glyph by adding its
   codepoint name to `REVIEWED_GLYPHS` and running `bun run icons:build`.
3. **Token set is the full design palette plus the plan's semantic aliases.**
   Every color in `design/DESIGN.md` front matter is declared as `--color-<name>`,
   and the plan's nine names alias those tokens. `--text-headline-sm` is the design
   `headline-lg-mobile` step. Line-height, tracking, and weight tokens were added
   so no component needs a raw number.
4. **Guard rule 9 was added: no `gap` under `src/ui/`.** Kindle Silk 80 reports as
   Chrome 80, and flexbox `gap` landed in Chrome 84. A `gap` declaration would
   pass every other rule and silently collapse spacing on the target device. Use
   margins.
5. **`src/capabilities.html` is exempt from the guard.** It is the diagnostic page.
   It renders a standalone report whose CSS is generated as a string in
   JavaScript, and it is not part of the design system. The exemption list lives in
   `EXEMPT` at the top of `scripts/check-styles.ts`.
6. **`.btn--danger` stays monochrome.** REQUIREMENTS 8.2 limits the UI to black,
   white, and middle gray, so severity reads through a 4px border instead of red.
   The label must name the destructive action.
7. **Component tests render through the Svelte server renderer.** `bunfig.toml`
   preloads `tests/support/svelte-ssr.ts`, which compiles `.svelte` files for
   `bun test`. No DOM library was added.
8. **Header classes were added to `components.css`** (`.app-header`,
   `.back-header`, and their children). The plan listed the primitives but not
   their layout classes, and rule 8 keeps component `<style>` blocks from owning
   shared class names.

## Exit criteria

A later screen can build a full page from tokens and primitives without writing a
single style rule. The guard fails the build when a screen tries.
