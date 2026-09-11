# Exercise Seeding

## Status

This specification defines the only process that writes `src/public/data/exercises.json`.
It follows `../docs/REQUIREMENTS.md` Section 13.0.
Where the documents differ, `REQUIREMENTS.md` wins.

## Inputs and output

The source is `dist/exercises.json` from `yuhonas/free-exercise-db`.
The seed configuration pins the source to one Git commit.
The source contains one flat array of 876 exercise objects.

`scripts/exercise-allowlist.json` is the only author-written input.
Each entry is a source ID or an object with a source ID and curated overrides.

`bun run seed` reads the pinned source and the allowlist.
It writes `src/public/data/exercises.json`.
No other process writes this output file.

## Copied fields

The script copies these source fields without changes:

- `id`
- `name`
- `instructions`
- `category`
- `force`
- `mechanic`
- `level`
- `primaryMuscles`
- `secondaryMuscles`

The script drops all other source fields, including `images`.
The script handles `equipment` as specified in the next section.

## Curated fields and defaults

The script adds these curated fields:

| Field | Default |
| --- | --- |
| `laterality` | `bilateral` |
| `movementPattern` | `none` |
| `loadSemantics` | `total` |
| `measurements` | `[{ "dimension": "reps", "units": ["reps"] }]` |
| `icon` | Absent |

A string allowlist entry receives all defaults.
An object entry can replace each default.
All overrides stay in the allowlist and use the source ID as their key.
In the allowlist, a measurement entry uses `units`.
In `exercises.json`, the script writes that list as `compatibleUnits`.

The output stores `equipment` as a string or `null` on each exercise.
By default, the script copies the source `equipment` string.
The source value `body only` becomes `null`.
A curated `equipment` override replaces the source value.

## Validation

The script stops with an error in these cases:

- An allowlist ID does not exist in the pinned source.
- The source `equipment` value is `null`, and the entry has no override.
- A curated override does not validate against the allowlist-entry schema.
- The normalized generated document does not validate against the exercise schema.

The script keeps the source muscle names.
It does not map them to other names.

## Determinism and source updates

The same source commit and allowlist produce identical output.
The script does not hash the output.
It does not compare the output with an earlier bundle.
It does not keep an exercise that the allowlist removes.

`bun run seed:bump` advances the pinned source commit and rewrites the output.
It does not change the allowlist.
If an override becomes invalid, the command stops and reports the exercise ID.

The author reviews the generated diff before commit.
REP JOT does not update the source automatically.
