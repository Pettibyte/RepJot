# Bundled icons

Local SVG files for REP JOT. Reference them with:

```svelte
<Icon kind="svg" name="kettlebell" label="Kettlebell" />
```

`Icon` builds the path `./icons/<name>.svg`, so the file name must match the `name`
prop.

## Material glyphs are not here

Material Symbols render through `src/ui/icons/manifest.json`, which stores SVG
path data extracted from the Material Symbols Outlined set. `Icon` renders that
path inline. The application ships no icon font.

Add a Material glyph by adding its codepoint name to `REVIEWED_GLYPHS` in
`scripts/build-icon-manifest.ts`, then run `bun run icons:build`.

## Review rules for a local SVG

1. One `<path>` element, no `<g>` wrappers, no embedded raster image.
2. 24 by 24 viewBox, or set `width` and `height` to match the grid.
3. `fill="currentColor"`. Never a hard-coded color.
4. No stroke thinner than 2px at the 24px grid, so the glyph survives on e-ink.
5. The glyph never carries meaning alone. Pass a `label`, or set `decorative` when
   visible text already names the thing.
6. Record the license in this file before committing.

## License

Material Symbols: Apache 2.0, Google (`google/material-design-icons`).
Local SVG files: record each author and license here when added.
