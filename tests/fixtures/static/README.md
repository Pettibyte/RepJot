# Static fixture sets

Input data only. Each subdirectory of this root is one complete static fixture set, selected by
`bun run validate:static:fixtures` (`scripts/validate-static.ts --fixtures-root`). Passing against
these sets is development evidence, not independent acceptance (`docs/implementation/README.md`
Section 6).

## Set layout

| Path | Role |
| --- | --- |
| `<set>/exercises.json` | Exercises directory (family `repjot/exercises`, v1 envelope). |
| `<set>/workouts.json` | Workout directory (family `repjot/workouts`, v1 envelope). |
| `<set>/material-symbols.json` | Reviewed Material Symbol manifest: an array of non-empty glyph names. |
| `<set>/public/icons/...` | Trusted local SVG assets, addressed bundle-relative from `public/`. |

## Sets

| Set | Role |
| --- | --- |
| `valid` | The positive repository fixture set (P7-T01): one material-symbol icon and one trusted local SVG. It is the reference layout for canonical inputs published under `src/public/`. |

The command validates every subdirectory in sorted order and fails closed when the root is
missing, empty, or any set fails schema, semantic, manifest, or trusted-SVG validation. Canonical
mode (`bun run validate:static`) selects the approved inputs under `src/public/` only; while no
approved content has been published it reports the explicit `canonical-content-missing` blocker
instead of passing.
