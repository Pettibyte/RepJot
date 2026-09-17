# REP JOT Workout JSON — Authoring Rules

Source of truth: `schemas/workouts/v1.schema.json` and
`specs/rep-jot-json-schema-spec.md`. This file is the short form. When the two
disagree, the schema wins.

## Envelope

Every workouts document carries the same three top-level keys.

```json
{
  "format": "repjot/workouts",
  "schemaVersion": 1,
  "workouts": []
}
```

`additionalProperties: false` everywhere. A key the schema does not list is an
error, not a warning. Spelling counts.

## Workout

```json
{
  "id": "strength-and-cindy",
  "name": "Strength and Cindy",
  "notes": "Heavy triples, then the Cindy benchmark AMRAP.",
  "root": { "...": "container node" }
}
```

Required: `id`, `name`, `root`. Optional: `notes`.

The `root` is a container. Use `strategy: "sequence"` unless the whole session
is one repeated block.

## Identifier rules

An ID MUST NOT:

- be empty
- contain `/`, `|`, or `:` — these separate composite result keys
- be all digits — JavaScript reorders integer-like object keys

`back-squat-block` passes. `0501` fails. `a/b` fails.

Node IDs are unique inside one workout. The same node ID MAY appear in two
different workouts.

Convention: kebab-case, named for the role, not for the date. `warmup`,
`press-block`, `kb-complex`.

## Container node

Required: `id`, `type: "container"`, `strategy`, `strategyConfig`, `children`.
Optional: `name`, `resultCapture`, `benchmark`.

### Strategies and their strategyConfig

| `strategy` | `strategyConfig` | Meaning |
|---|---|---|
| `sequence` | `{}` | Runs once, in order. |
| `rounds` | `{ "rounds": 3 }` | Repeats the whole child list 3 times. |
| `amrap` | `{ "duration": { "value": 20, "unit": "minute" } }` | As many rounds as possible in the time. |
| `emom` | `{ "cycles": 12, "interval": { "value": 1, "unit": "minute" } }` | One cycle starts on every interval. |
| `complex` | `{ "cycles": 5 }` | Linked movements, repeated for the cycle count. |

`strategyConfig` accepts no other keys. A `rest` key is not part of the schema.

A repeated container is any container whose strategy is not `sequence`. That
matters for `iterations`, below.

### resultCapture

Add this to a scored block so the app records a score.

```json
"resultCapture": {
  "mode": "scored",
  "scoreType": "rounds_and_reps",
  "childDetail": "optional"
}
```

- `scoreType`: `cycles`, `rounds_and_reps`, or `intervals`.
- `childDetail`: `none` forbids child exercise results. `optional` allows
  absent, partial, or complete detail.

Use `rounds_and_reps` for an AMRAP over repetitions. Use `intervals` for a
timed or distance block. Use `cycles` when only the cycle count matters.

### benchmark

Marks a named test.

```json
"benchmark": { "name": "Cindy", "organization": "CrossFit" }
```

Put it on the timed container that carries the benchmark.

## Exercise node

Required: `id`, `type: "exercise"`, `exerciseId`, `stimulus`, `prescription`.
Optional: `setType`, `notes`.

- `exerciseId` — one ID from the curated library. Nothing else.
- `stimulus` — `strength`, `hypertrophy`, `power`, `conditioning`, `mobility`.
- `setType` — `warmup` or `working`. Omit when it adds nothing.

## Prescription

A prescription carries at least one field. The top-level fields apply to every
iteration.

### reps

Three forms:

```json
"reps": 8
"reps": { "target": 8, "qualifier": "approximate" }
"reps": { "min": 6, "max": 10 }
```

Use the range form for a rep window. Use `approximate` for "about 8".

### Quantities

| Key | Units |
|---|---|
| `weight` | `lb`, `kg` |
| `addedWeight` | `lb`, `kg` |
| `assistedWeight` | `lb`, `kg` |
| `distance` | `m`, `km`, `ft`, `mi` |
| `duration` | `second`, `minute` |
| `calories` | `kcal` |

`duration` and `calories` are not units of each other. Do not mix them.

Pick the key from the exercise's `loadSemantics`:

| `loadSemantics` | Key to use | Typical case |
|---|---|---|
| `total` | `weight` | Barbell work. |
| `per_implement` | `weight` | One dumbbell or kettlebell per hand. |
| `added` | `addedWeight` | Weighted pull-ups. |
| `assisted` | `assistedWeight` | Band-assisted pull-ups. |

A prescription may only use a dimension the exercise declares. `Pushups`
declares `reps` only. A `weight` or `duration` on a push-up node fails
validation.

### effort

```json
"effort": { "type": "failure" }
"effort": { "type": "rir", "target": 2 }
"effort": { "type": "rpe", "target": 8 }
```

`rir` is reps in reserve. `rpe` runs 1 to 10.

### loadStrategy

```json
"loadStrategy": { "type": "ascending" }
```

Types: `fixed`, `ascending`, `descending`, `self_selected`.

Two optional keys exist for ladder semantics:
`firstIteration: "maximal_for_prescription"` and
`adjustment: "decrease_to_repeat_effort"`. Use them only when the user described
that model.

### iterations

Per-set overrides for the nearest repeated container above the node.

```json
"prescription": {
  "reps": 3,
  "loadStrategy": { "type": "ascending" },
  "iterations": [
    { "iteration": 1, "reps": 5, "weight": { "value": 80, "unit": "kg" } },
    { "iteration": 2, "weight": { "value": 90, "unit": "kg" } },
    { "iteration": 3, "weight": { "value": 100, "unit": "kg" } }
  ]
}
```

Rules:

- `iteration` is one-based.
- Each iteration number appears at most once per prescription.
- The number must not exceed the nearest repeated container's count. An AMRAP
  has no ceiling.
- An override inherits every field you leave out.
- An `iterations` array with no repeated container above it is an error.
- Give the prescription a base value too. Overrides alone leave unlisted sets
  with nothing.

## Plain-English to structure

| The user says | Build |
|---|---|
| "3 sets of 10 push-ups" | `rounds: 3` container, one exercise node, `reps: 10`. |
| "3 rounds: 10 push-ups, 10 squats" | `rounds: 3` container with two exercise children. |
| "AMRAP 20 for max rounds: 5 pull-ups, 10 push-ups" | `amrap` 20 min, `resultCapture` `rounds_and_reps`, two children. |
| "EMOM 12, 10 kettlebell swings" | `emom`, `cycles: 12`, `interval: 1 minute`, one child. |
| "5 rounds of the A-B-C complex" | `complex`, `cycles: 5`, three children. |
| "Warm up, then work up to a heavy triple" | A `sequence` root, a warmup container, then a `rounds` block with `setType: "working"`. |
| "Do 4 sets, last set to failure" | `rounds: 4` plus `iterations: [{ "iteration": 4, "effort": { "type": "failure" } }]`. |
| "Rest 90 seconds between sets" | No rest field exists. Say so. Put it in `notes`. |

## Nesting rules of thumb

- One workout, one root. The root is a `sequence` unless the whole session is
  one block.
- Give each block its own container with a `name`. The outline reads better and
  the user can confirm it.
- Do not nest a repeated block inside a repeated block unless the user described
  that. Ask first. See [ambiguity.md](ambiguity.md).
- Keep depth shallow. Two levels below the root covers most sessions.
