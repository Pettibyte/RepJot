# Bundled fonts

Same-origin font files for REP JOT. `src/ui/styles/fonts.css` declares the
`@font-face` rules. No request for a font leaves the origin.

## Files

| File | Family | Source | SHA-256 |
| --- | --- | --- | --- |
| `inter-latin.woff2` | Inter | Google Fonts, `s/inter/v20`, latin subset | `3100e775e8616cd2611beecfa23a4263d7037586789b43f035236a2e6fbd4c62` |
| `inter-latin-ext.woff2` | Inter | Google Fonts, `s/inter/v20`, latin-ext subset | `34b9c504cab7a73e37b746343a449132e56cf7b5481af2cb81dc74dcff25c956` |
| `jetbrains-mono-latin.woff2` | JetBrains Mono | Google Fonts, `s/jetbrainsmono/v24`, latin subset | `83c005d49d8a6a50474c73a5a36ac0468076e9c4a29da7bdb14995d80560a5be` |
| `jetbrains-mono-latin-ext.woff2` | JetBrains Mono | Google Fonts, `s/jetbrainsmono/v24`, latin-ext subset | `db5ff4db83e580426280e9337a58dc57d3a83784a1b03ad80914651594441d52` |

Both families are variable fonts. Each file carries the whole weight axis, so one
file per subset serves every weight the application requests. `fonts.css` declares
`font-weight: 400 800` for Inter and `font-weight: 500 700` for JetBrains Mono.

## License

Both families are licensed under the SIL Open Font License 1.1. The license text
ships beside the fonts:

- `LICENSE-inter.txt` — Copyright (c) 2016 The Inter Project Authors.
- `LICENSE-jetbrains-mono.txt` — Copyright 2020 The JetBrains Mono Project Authors.

## Refresh procedure

1. Request the CSS from the Google Fonts API with a modern user agent:
   `curl -H "User-Agent: <Chrome UA>" "https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap"`.
2. Download the `latin` and `latin-ext` `woff2` files.
3. Replace the files above and update each SHA-256 in this table.
4. Run `bun run check:styles` and `bun run build`.
