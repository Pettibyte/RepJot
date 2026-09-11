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

The output stores `equipment` as one value from the closed vocabulary, or `null`.
`$defs.equipmentValue` in `schemas/exercises/v1.schema.json` owns that list.
Every value in the list is lower case and singular.

The script normalizes every equipment string the same way. The source value and an
allowlist override both pass through these steps:

1. Trim the value and collapse inner whitespace to one space.
2. Force lower case.
3. Take the singular form.
4. Match the result against the vocabulary.

`Kettlebells`, `KETTLEBELLS`, and `kettlebells` all write `kettlebell`.
`bands` writes `band`. `body only` becomes `null` after step 2, so the script
never writes it.

The script reads the vocabulary from the exercise schema. The validator and the
seed therefore share one list.

The script fails when the normalized value is not in the vocabulary. The error
names the raw value, the normalized value, and the schema field to edit. The
script also fails when the vocabulary holds a value that is not lower case and
singular, or lists `body only`.

The current vocabulary covers all 12 distinct source values in the pinned commit:
`band`, `barbell`, `cable`, `dumbbell`, `e-z curl bar`, `exercise ball`,
`foam roll`, `kettlebell`, `machine`, `medicine ball`, and `other`.

## Validation

The script stops with an error in these cases:

- An allowlist ID does not exist in the pinned source.
- The source `equipment` value is `null`, and the entry has no override.
- An equipment value does not fold into the closed vocabulary.
- The equipment vocabulary is not lower case and singular, or lists `body only`.
- A measurement list repeats a dimension.
- A curated override does not validate against the allowlist-entry schema.
- The normalized generated document does not validate against the exercise schema.

The script keeps the source muscle names.
It does not map them to other names.

Every equipment value reaches the normalizer, from the source and from an override
alike. The allowlist-entry schema keeps a loose shape check on `equipment` so the
normalizer still reports the raw value, the normalized value, and the field to
edit. The exercise schema still decides what can be written, so no unsafe value
reaches the output.

A measurement list holds one entry per dimension. `uniqueItems` rejects an
identical repeated entry. The seed rejects a repeated dimension name that carries
different unit lists, because `uniqueItems` cannot see that case.

The script collects every problem before it returns. One run reports all failures,
not only the first one.

## Build gate

`bun run build` runs `check:schemas` and `seed:check` before `vite build`.
A stale or invalid `src/public/data/exercises.json` fails the build instead of
reaching `dist/`. This satisfies Requirement 6.19 and Requirement 7.4 for exercise
data.

`seed:check` rebuilds the document in memory and compares it with the file on disk.
It needs the source. It reads the local cache first, so a warm checkout needs no
network.

## Determinism and source updates

The same source commit and allowlist produce identical output.
The script does not hash the output.
It does not compare the output with an earlier bundle.
It does not keep an exercise that the allowlist removes.

`bun run seed:bump` advances the pinned source commit and rewrites the output.
It does not change the allowlist.
If an override becomes invalid, the command stops and reports the exercise ID.

The bump writes nothing until every check passes. It resolves the new commit,
fetches the source, and validates the whole generated document first. It then
writes the output file and the pinned commit last. A failed bump changes neither
`scripts/seed-config.json` nor `exercises.json`.

The pin is written after the artifact it describes. A crash between the two leaves
the config claiming less than it should, and `seed:check` catches that on the next
run.

The author reviews the generated diff before commit.
REP JOT does not update the source automatically.
