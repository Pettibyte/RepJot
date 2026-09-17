# Growing the Curated Exercise Set

"Must be in the curated set" does not mean "must already exist". It means the ID
must be in `src/public/data/exercises.json`. That file is generated. You add to
it through the allowlist.

## The pipeline

```
free-exercise-db (hundreds of exercises, one pinned commit)
        │  scripts/seed-config.json pins repo + commit + path
        ▼
scripts/exercise-allowlist.json     ← the only author-written input
        │  bun run seed  (scripts/seed-exercises.ts)
        ▼
src/public/data/exercises.json     ← generated. Never hand-edit.
```

Rules that come from `specs/exercise-seeding.md`:

- The seed is the only writer of `src/public/data/exercises.json`.
- An allowlist ID that is absent from the pinned source fails the seed.
- The same source commit plus the same allowlist always produce the same output.
- `bun run build` runs `seed:check`. A stale generated file fails the build.

The source is cached at `scripts/.cache/free-exercise-db/`. A warm checkout
needs no network. A cold one needs `bun run seed` with network access.

## What the seed copies, and what you must decide

Copied from the source, unchanged: `id`, `name`, `instructions`, `category`,
`force`, `mechanic`, `level`, `primaryMuscles`, `secondaryMuscles`.

Not in the source. You supply these, or take the default:

| Field | Default | You must choose |
|---|---|---|
| `laterality` | `bilateral` | `unilateral` when one side works at a time. |
| `movementPattern` | `none` | Always choose. `none` is a shrug. |
| `loadSemantics` | `total` | Choose from the load table below. |
| `measurements` | reps only | Choose the dimensions the app should record. |
| `equipment` | source value | Override only when the source is wrong. |

A bare string allowlist entry takes every default. That gives you an exercise that
records reps and nothing else. Do not use a bare entry unless that is what you
want.

## The four judgment calls

### 1. `movementPattern`

One of: `squat`, `hinge`, `horizontal_push`, `vertical_push`, `horizontal_pull`,
`vertical_pull`, `carry`, `locomotion`, `rotation`, `anti_rotation`, `flexion`,
`extension`, `other`, `none`.

| Movement | Pattern |
|---|---|
| Squat variants | `squat` |
| Deadlift, swing, RDL | `hinge` |
| Bench, push-up, fly | `horizontal_push` |
| Overhead press, push press | `vertical_push` |
| Barbell row, dumbbell row, cable row | `horizontal_pull` |
| Pull-up, lat pulldown | `vertical_pull` |
| Farmer carry | `carry` |
| Row, ski, run, jump rope | `locomotion` |
| Halo, woodchop | `rotation` |
| Plank, Pallof press | `anti_rotation` |
| Curl, leg extension | `flexion` |
| Triceps extension, kickback | `extension` |

### 2. `laterality`

`unilateral` when one limb works at a time, including alternating work.
`bilateral` otherwise. This drives how the app shows the set.

### 3. `loadSemantics`

| Value | Use when | Prescription key |
|---|---|---|
| `total` | One load for the whole movement: barbell, machine, bodyweight. | `weight` |
| `per_implement` | One dumbbell or kettlebell per hand. | `weight` |
| `added` | Extra load on a bodyweight movement: weighted pull-ups, a vest. | `addedWeight` |
| `assisted` | The load is removed, not added: band-assisted pull-ups. | `assistedWeight` |

`loadSemantics` and `measurements` must agree. The exercise schema enforces it:
an `addedWeight` dimension forces `loadSemantics: "added"`.

### 4. `measurements`

List only what the app should record. Each dimension carries its units.

| Dimension | Units |
|---|---|
| `reps` | `reps` |
| `weight`, `addedWeight`, `assistedWeight` | `kg`, `lb` |
| `distance` | `m`, `km`, `ft`, `mi` |
| `duration` | `second`, `minute` |
| `calories` | `kcal` |

A hold or timed exercise needs `duration`. Without it you cannot write a 30-second
hold in a workout. A timed hold with no `reps` dimension is fine.

## Equipment

The vocabulary is closed and lives in
`schemas/exercises/v1.schema.json#/$defs/equipmentValue`:

`band`, `barbell`, `cable`, `dumbbell`, `e-z curl bar`, `exercise ball`,
`foam roll`, `kettlebell`, `machine`, `medicine ball`, `other`.

The seed folds the source spelling into that list. Source `Kettlebells` writes
`kettlebell`. Source `body only` writes `null`. A value that will not fold fails
the seed and names the raw value.

Do not add a value to the vocabulary to make one exercise fit. Use `other`.

## Adding one exercise

Search the source:

```bash
bun .pi/skills/workout-authoring/scripts/lookup-source.ts "dumbbell preacher curl"
```

Preview the entry and the exercise it generates. Nothing is written yet:

```bash
bun .pi/skills/workout-authoring/scripts/add-exercise.ts One_Arm_Dumbbell_Preacher_Curl \
  --movement-pattern flexion --laterality unilateral --load-semantics per_implement \
  --measurements reps,weight
```

Add it:

```bash
bun .pi/skills/workout-authoring/scripts/add-exercise.ts One_Arm_Dumbbell_Preacher_Curl \
  --movement-pattern flexion --laterality unilateral --load-semantics per_implement \
  --measurements reps,weight --apply
```

`--apply` appends to `scripts/exercise-allowlist.json` and runs the seed. The
seed validates everything before it writes, and refuses on any problem.

No confirmation prompt stands between you and the write. The seed gate and git are
the safety net. Run the checks below after every add, and report what changed.

Add one exercise at a time, so a seed failure names one entry instead of twelve.

## Verify after every add

```bash
bun run check:schemas && bun run check:static
bun .pi/skills/workout-authoring/scripts/lookup-exercise.ts "<new name>"
```

Then read the diff. Two files change: `scripts/exercise-allowlist.json` and
`src/public/data/exercises.json`. Both belong in the same commit.

## Rollback

```bash
git checkout scripts/exercise-allowlist.json src/public/data/exercises.json
```

Never revert one without the other. The allowlist and the generated file must
match, or `seed:check` fails the build.

## When the source has nothing

`lookup-source.ts` exits 1. The movement is not in free-exercise-db. Do not
invent an ID and do not hand-write an exercise object. Tell the user, and ask
for a different movement.
