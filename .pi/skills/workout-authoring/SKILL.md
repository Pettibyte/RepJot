---
name: workout-authoring
description: Turns a plain-English description of a workout into REP JOT workouts JSON. Maps named movements to the curated exercise library, and when a movement is missing, finds it in the pinned free-exercise-db source and adds it to the curated set through the seed allowlist. Resolves ambiguous exercise names and workout nesting with ask_user, and validates the result against the shipped JSON Schema plus the app semantic checks. Use when the user describes a workout, session, WOD, or program in prose and wants JSON, or asks to add a workout or an exercise to the bundle.
---

# REP JOT Workout Authoring

Convert prose into a `repjot/workouts` document. Never guess an exercise ID. Never
ship JSON that fails validation.

Read [references/authoring-rules.md](references/authoring-rules.md) before you
write any JSON. Read [references/ambiguity.md](references/ambiguity.md) before
you ask the user anything. Read
[references/curated-set-expansion.md](references/curated-set-expansion.md)
before you add an exercise.

Run all scripts from the repo root with `bun`.

## Step 1 — Read the curated library

The curated set is small. A workout MAY reference only the IDs in
`src/public/data/exercises.json`.

```bash
bun .pi/skills/workout-authoring/scripts/lookup-exercise.ts --all
```

The script reads the generated file at run time. Do not rely on memory for the
list.

## Step 2 — Resolve every exercise name

For each movement the user named, search the curated set first:

```bash
bun .pi/skills/workout-authoring/scripts/lookup-exercise.ts "back squat"
```

Read the last line:

| Output | Action |
|---|---|
| `CLEAR: one leading match.` | Use that ID. |
| `AMBIGUOUS: N close matches.` | Ask the user. Do not pick silently. |
| `NO MATCH` | Go to Step 2b. The curated set can grow. |

Add a filter when the user gave equipment or a body part:

```bash
bun .pi/skills/workout-authoring/scripts/lookup-exercise.ts "row" --equipment kettlebell
bun .pi/skills/workout-authoring/scripts/lookup-exercise.ts --bodyweight --pattern hinge
```

Use `--json` when you need the fields in a machine-readable form.

### Step 2b — A missing movement is an add, not a dead end

The curated set is a curated slice of an 876-exercise source. Search the source:

```bash
bun .pi/skills/workout-authoring/scripts/lookup-source.ts "dumbbell preacher curl"
bun .pi/skills/workout-authoring/scripts/lookup-source.ts "rear delt" --equipment dumbbell
```

The table shows each candidate's source ID and whether it is already curated.

- **Found.** Propose the allowlist entry, get the user's approval in Step 3, then
  add it. See [references/curated-set-expansion.md](references/curated-set-expansion.md).
- **Not found.** `lookup-source.ts` exits 1. The movement is not in
  free-exercise-db. Ask the user for a different movement. Never invent an ID
  and never hand-write an exercise object.

Preview the entry and the exercise it would generate. Nothing is written yet:

```bash
bun .pi/skills/workout-authoring/scripts/add-exercise.ts One_Arm_Dumbbell_Preacher_Curl \
  --movement-pattern flexion --laterality unilateral --load-semantics per_implement \
  --measurements reps,weight
```

Apply only after the user approves, in Step 3b.

The four fields you must choose for a new exercise are `movementPattern`,
`laterality`, `loadSemantics`, and `measurements`. They decide what the app can
record later. Do not leave them on defaults. The tables live in
[references/curated-set-expansion.md](references/curated-set-expansion.md).

A timed hold needs a `duration` dimension. Without it, a 30-second hold cannot
be written into a workout.

## Step 3 — Ask about every open question in one batch

Collect all unknowns first, then call `ask_user` once. Do not ask one question at
a time.

Cover the classes from
[references/ambiguity.md](references/ambiguity.md):

1. **Exercise identity.** Options carry the candidate names plus equipment, so
   the user can tell them apart.
2. **New exercise approval.** For each movement that needs an add, show the
   source name and the four curated fields you chose. Ask whether to add it.
   Never apply an allowlist change the user has not approved.
3. **Nesting.** Show the two readings as indented text inside the question
   detail. Ask which one the user means.
4. **Missing numbers.** Reps, load, rounds, time, rest.
5. **Units.** `225` is pounds in most gyms and kilograms on many platforms.
   Ask when the user did not say.

Give 2-4 options. The UI adds a free-text choice, so do not add an "Other"
option yourself. Leave a question out when the answer is already clear from the
text.

Do not write the final JSON until the answers arrive.

### Step 3b — Apply the approved adds

Only after the user approves, and one exercise at a time:

```bash
bun .pi/skills/workout-authoring/scripts/add-exercise.ts <SourceId> \
  --movement-pattern <p> --laterality <l> --load-semantics <s> \
  --measurements <list> --apply
```

Then confirm the curated lookup finds it, and run the repo gates:

```bash
bun .pi/skills/workout-authoring/scripts/lookup-exercise.ts "<new name>"
bun run check:schemas && bun run check:static
```

Two files change: `scripts/exercise-allowlist.json` and
`src/public/data/exercises.json`. They belong in the same commit. Never revert
one without the other, or `seed:check` fails the build.

## Step 4 — Draft the JSON

Follow the shapes in [references/authoring-rules.md](references/authoring-rules.md).

Rules that cause the most failures:

- Every node carries `id`, and IDs are unique inside one workout.
- IDs reject `/`, `|`, `:` and reject an all-digit value. `2024-05-01` passes,
  `0501` does not.
- A container carries `strategy` and a `strategyConfig` that matches it.
  `sequence` takes `{}`. `rounds` takes `{ "rounds": n }`. `amrap` takes
  `{ "duration": {...} }`. `emom` takes `{ "cycles": n, "interval": {...} }`.
  `complex` takes `{ "cycles": n }`.
- An exercise node carries `exerciseId`, `stimulus`, and `prescription`.
- `prescription.iterations` overrides the nearest repeated container. It needs
  that container above it, and each iteration number appears once.
- A prescription may only use a dimension the exercise declares. `Pushups`
  declares `reps` only, so a `duration` on a push-up node is an error.

Write the draft to a scratch file, for example `/tmp/candidate.json`.

## Step 5 — Validate

```bash
bun .pi/skills/workout-authoring/scripts/validate-workout.ts /tmp/candidate.json
```

The script prints an outline first. Read it out loud against what the user asked.
It is the fastest check on nesting.

Exit codes: `0` clean or warnings only, `1` errors, `2` usage or unreadable
input.

Fix every error, then re-run. Repeat until exit `0`.

Treat warnings as real. Each one carries a hint. Fix them, or tell the user why
the warning does not apply. Use `--strict` when you want warnings to fail the
run.

## Step 6 — Report, then install on request

Show the user:

1. The outline the validator printed.
2. The final JSON.
3. Each assumption you made, including every answer from Step 3.

Do not write into `src/public/data/workouts.json` until the user says to.

When you install:

1. Merge the workout into the `workouts` array. Keep the envelope
   (`format`, `schemaVersion`) intact. Add one workout, not a second document.
2. Run the repo gates:

```bash
bun run check:schemas && bun run check:static
```

3. Report the diff.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/lookup-exercise.ts` | Search the curated set. Exit 1 means no match. |
| `scripts/lookup-source.ts` | Search the pinned free-exercise-db source. Exit 1 means not there either. |
| `scripts/add-exercise.ts` | Add one source exercise to the allowlist and re-seed. Dry run by default. |
| `scripts/validate-workout.ts` | Schema plus semantic plus lint. Prints an outline. |

`lookup-exercise.ts` and `validate-workout.ts` accept `--exercises <path>` to
point at another library file. `validate-workout.ts` also accepts `-` for stdin,
`--json` for a machine report, and `--bundle <path>` to change the ID collision
source. `lookup-source.ts` accepts `--source <path>` and `--no-fetch`.
