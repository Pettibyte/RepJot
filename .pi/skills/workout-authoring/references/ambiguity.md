# Ambiguity Catalog and `ask_user` Patterns

Ask once. Collect every open question, then call `ask_user` with them all. Do not
send a second round for something you could have asked in the first.

Each question: 2-4 options, a short label, and detail that carries the numbers or
the shape. The UI adds a free-text choice, so never add "Other" yourself.

Skip a question when the user already answered it in prose.

## Class 1 — Exercise identity

Trigger: `lookup-exercise.ts` prints `AMBIGUOUS`, or the user named a movement
loosely.

```json
{
  "id": "squat-variant",
  "question": "Which squat does \"squats\" mean here?",
  "detail": "3 sets of 10 in the first block.",
  "options": [
    { "value": "Barbell_Squat", "label": "Barbell Squat", "detail": "Barbell, quad-dominant, records weight." },
    { "value": "Bodyweight_Squat", "label": "Bodyweight Squat", "detail": "No equipment, reps only." }
  ]
}
```

Rules:

- `value` is the exercise ID. Never a display name.
- Put the differentiator in `detail`: equipment, load, or body position.
- Do not list more than four candidates. Drop the weakest and let free-text cover
  the rest.

## Class 2 — Movement not in the curated set

Trigger: `lookup-exercise.ts` exits 1.

First search the source. Do not ask this question until you know whether an add
is even possible:

```bash
bun .pi/skills/workout-authoring/scripts/lookup-source.ts "preacher curl"
```

### 2a — The source has it

Ask to add it. Carry the four curated fields in the detail, so the user sees
what they are approving.

```json
{
  "id": "add_preacher_curl",
  "question": "\"One Arm Dumbbell Preacher Curl\" is not curated. Add it to the exercise library?",
  "detail": "Found in free-exercise-db. Proposed: movementPattern flexion, laterality unilateral, loadSemantics per_implement, records reps + weight. Adds one entry to the seed allowlist and regenerates the exercise file.",
  "options": [
    { "value": "add", "label": "Add it", "detail": "Curated set grows by one exercise." },
    { "value": "add_kettlebell", "label": "Add the kettlebell variant instead", "detail": "Only if the user has no dumbbells." },
    { "value": "substitute", "label": "Do not add; use a curated exercise", "detail": "Pick from the 22 already curated." },
    { "value": "drop", "label": "Drop the movement" }
  ]
}
```

Never run `add-exercise.ts --apply` without an explicit yes. The dry run is the
default for a reason.

When the four curated fields are genuinely unclear, ask about them as their own
question rather than guessing. `loadSemantics` and `measurements` decide what
the app can record later, and a wrong choice is invisible until someone tries to
log a set.

### 2b — The source does not have it either

`lookup-source.ts` exits 1. Never invent an ID. Never hand-write an exercise
object. Ask for a different movement.

```json
{
  "id": "wall_sit_missing",
  "question": "\"Wall sit\" is not in free-exercise-db. What should replace it?",
  "detail": "A timed isometric squat hold.",
  "options": [
    { "value": "Bodyweight_Squat", "label": "Bodyweight Squat", "detail": "Records reps, not a hold." },
    { "value": "Worlds_Greatest_Stretch", "label": "World's Greatest Stretch", "detail": "Records duration, different intent." },
    { "value": "drop", "label": "Drop the movement" }
  ]
}
```

## Class 3 — Nesting confusion

The most common failure. Show both readings as indented text. Do not describe
them in prose.

Trigger: "3 rounds of 10 push-ups and 10 squats" — the count could sit inside or
outside the round.

```json
{
  "id": "pushup-squat-nesting",
  "question": "How do the 3 rounds wrap the two movements?",
  "options": [
    {
      "value": "outer",
      "label": "3 rounds of both",
      "detail": "Round 1: 10 push-ups, 10 squats. Round 2: same. Round 3: same. 30 of each."
    },
    {
      "value": "inner",
      "label": "3 sets each, one after the other",
      "detail": "3 x 10 push-ups, then 3 x 10 squats. 30 of each, but not interleaved."
    }
  ]
}
```

Other nesting triggers:

- "Superset A with B, 3 rounds" — one `rounds` container with two children.
  Confirm only when the round count could belong to one movement.
- "Finisher: AMRAP 20 with a warmup first" — confirm the warmup sits outside the
  AMRAP container.
- "Complex of A+B+C, 5 rounds" — `complex` with `cycles: 5`, not `rounds: 5`.
  Ask if the user said "rounds" but named a complex.
- "5 rounds, each round 3 rounds of 5 squats" — nested repeated containers.
  Confirm before you build it.

## Class 4 — Missing numbers

Ask for what the workout needs, not for every field that exists.

```json
{
  "id": "squat-load",
  "question": "What load for the squat sets?",
  "options": [
    { "value": "self_selected", "label": "Self-selected", "detail": "No fixed weight recorded." },
    { "value": "ascending", "label": "Ascending each set", "detail": "Weight rises set to set." }
  ]
}
```

For a fixed load, the free-text choice carries the number. Ask the unit in the
same question: "Ascending each set" with detail "Tell us the starting weight and
unit."

Triggers worth asking about:

- Rounds or sets with no count.
- AMRAP with no time cap.
- A working set with no reps and no effort target.
- A stretch hold with no duration.

Triggers not worth asking about:

- Missing `notes`. Add a short one yourself.
- Missing `setType` on an obvious working set.

## Class 5 — Units

Trigger: a bare number. `225` reads as pounds in most gyms and as kilograms on
many platforms.

```json
{
  "id": "squat-weight-unit",
  "question": "\"225\" for the squat — which unit?",
  "options": [
    { "value": "lb", "label": "225 lb", "detail": "About 102 kg." },
    { "value": "kg", "label": "225 kg", "detail": "About 496 lb." }
  ]
}
```

Ask once per workout when the same unit carries every weight. Do not ask per set.

Distance and time get the same treatment: "400" on a row could be meters or feet.
"10" on a hold could be seconds or minutes.

## Class 6 — Load semantics

Trigger: the exercise records load in a specific way and the user described
another.

Weighted pull-ups use `addedWeight`. Band-assisted pull-ups use `assistedWeight`.
A barbell uses `weight`. If the user says "add 20 lb to your pull-ups", confirm
`addedWeight` and not a plain `weight`.

Usually resolve this without asking: the exercise `loadSemantics` field decides
the key. Ask only when the user described a load the exercise cannot record, such
as a weight on a bodyweight movement.

## Class 7 — Stimulus

Pick the stimulus from the intent, not from the movement.

| The user says | `stimulus` |
|---|---|
| "heavy", "triples", "top set" | `strength` |
| "volume", "feel the muscle", "8-12" | `hypertrophy` |
| "explosive", "speed", "jumps" | `power` |
| "metcon", "conditioning", "get gassed" | `conditioning` |
| "stretch", "mobility", "warm-up flow" | `mobility` |

Ask only when the intent is unclear and the choice changes the block. The
validator warns when a stimulus fights the exercise category.

## Order of questions

Put them in the order the user reads the workout:

1. Exercise identity, first movement first.
2. Nesting, right after the movements it touches.
3. Numbers and units.
4. Stimulus and effort, last.

Keep the whole set under 20 questions. If you pass that, the description needs a
conversation, not a form.

## After the answers arrive

1. Restate each decision in one line in your final report.
2. Re-run the validator.
3. If an answer created a new unknown, ask once more. Never guess to close a gap.
