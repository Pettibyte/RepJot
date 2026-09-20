# REP JOT JSON Schema Specification

## Purpose

This document defines the persistent JSON data model for REP JOT.

The application uses these files:

1. `exercises.json` stores exercise reference data, including each exercise's required equipment.
2. `workouts.json` stores workout definitions and prescriptions.
3. `preferences.json` stores versioned user preferences.
4. `results-YYYY-MM.json` stores workout sessions for one UTC calendar month.

There is no database in this revision. Each file must load independently as JSON in a browser.

All files contain `format` and `schemaVersion`. References use stable IDs instead of copies of referenced entities.

This specification follows `../docs/REQUIREMENTS.md` (v4). Where the two differ, `REQUIREMENTS.md` wins. Removed from the earlier revision: frozen execution plans, session tombstones, sync copies, the `deprecated` flag, and the prior-production-bundle comparison. See `../docs/REQUIREMENTS.md` Section 22.0.

See [Exercise Seeding](./exercise-seeding.md) for the process that generates `exercises.json`.

---

# 1. Shared Rules

## Document Envelopes

Each file declares its family and a positive integer schema version:

```json
{
  "format": "repjot/exercises",
  "schemaVersion": 1
}
```

The formats are `repjot/exercises`, `repjot/workouts`, `repjot/preferences`, and `repjot/results`. An incompatible structure change increments the family version.

## UTC Timestamps

Every persisted application timestamp uses a field name ending in `Utc`. Each value is
an RFC 3339 date-time string that ends in `Z`. Numeric UTC offsets are not canonical.
The JSON Schemas declare both `format: "date-time"` and the `Z` suffix.
REP JOT configures its Draft 2020-12 validator to assert formats rather than treat them as annotations.

The application converts browser-local input to UTC before persistence. It converts UTC
timestamps to local dates and times only for display. Locale and local offset never
select a result shard.

Drive-owned metadata such as `modifiedTime` is external data. It retains the field name
and timestamp representation defined by the Drive API.

## Stable IDs and Static Data Change

An exercise ID is the `id` string from `free-exercise-db`. REP JOT does not mint, register, reserve, or renumber exercise IDs. A workout ID and a workout-node ID are short strings that the author writes by hand in `workouts.json`.

IDs are plain strings. REP JOT stores no content hash, checksum, digest, provenance record, or snapshot reference for any static entity.

REP JOT treats published exercise and workout data as editable facts. It is not an immutable ledger. Any release may add, rename, re-parent, re-spec, or remove an exercise, a workout, or a workout node. The build does not download a prior production bundle. It does not diff IDs. It enforces no immutability rule and no backwards-compatibility rule.

REP JOT has no `deprecated` flag on any entity. An exercise appears in selection when the seed allowlist lists it. A workout appears in the chooser when `workouts.json` lists it.

### ID character rule

An ID segment must not contain `/`, `|`, or `:`. These characters carry structure in the composite result key. The JSON Schemas enforce this rule on every exercise, workout, node, and non-null equipment value.

A `Record` key must never be integer-like. JavaScript iterates integer-like keys first, in ascending numeric order, ahead of string keys. REP JOT IDs carry a non-numeric prefix or a descriptive slug for this reason.

### Unresolved references

When a stored result references static data that no longer resolves, the loader marks that result unresolved. The UI shows an error card with a **View Raw JSON** action. This covers an unknown exercise ID, an unknown workout ID, a broken execution path, and a path that resolves to a node whose exercise differs from the recorded `exerciseId`.

REP JOT never auto-migrates a result, never substitutes a similar exercise, and never rewrites a stored result to repair a reference. One unresolved reference must not break its page, its list, the sync loop, or any other result.

Recorded work still renders from the result's stored values and units. The error card identifies the unresolved reference and provides the raw JSON; it does not replace or hide those recorded values. When the current workout tree cannot order the result, the UI sorts it by the encoded `executionPath` string.

## Keyed Maps

Every collection that two devices can change uses a keyed map, not an array. `jsondiffpatch` diffs arrays by index. A concurrent insert or delete shifts indexes, so an index-based delta can land on the wrong element after a merge. Keyed maps produce deltas that are independent of position.

| Collection | Shape |
| --- | --- |
| Shard sessions | `Record<sessionId, Session>` |
| Session exercise results | `Record<compositeKey, ExerciseResult>` |
| Session container results | `Record<compositeKey, ContainerResult>` |
| Preference unit map | `Record<exerciseId, Record<dimension, unit>>` |

Do not add array `matchBy` workarounds. Keyed maps remove the problem instead of patching it.

Arrays remain correct in `workouts.json`. Prescriptive sequence is a property of the workout definition, and only the author changes it, at build time. A session stores no sequence. Result order comes from `executionPath` resolved against the workout tree.

### Composite result key

A session stores its results in two maps, one per result kind.

```text
exerciseResults  key = <path>|<side>|<attempt>
containerResults key = <path>|<attempt>
```

Path encoding inside a key joins segments with `/`. A repeated-container segment carries `:<iteration>`, one-based. The field separator is `|`. `side` defaults to `both` and `attempt` defaults to `1`. The application always writes both fields into the key, even at their defaults, so a key never changes shape later.

```text
root/squat-sets:3/back-squat-set|both|1
root/cindy|1
```

The result value keeps its structured `executionPath` array. The key is derived from that array. Loader and build validation reject a key that does not match the value it maps to. The structured path stays in the document because the user reads raw JSON to debug.

See `../docs/REQUIREMENTS.md` Section 22.4 for the merge rationale.

## Icon

An entity can have one discriminated `icon`. REP JOT supports these forms:

```json
{ "type": "material_symbol", "name": "fitness_center" }
```

```json
{ "type": "local_svg", "path": "icons/exercises/back-squat.svg" }
```

A `material_symbol` contains a valid Material Symbols name. A `local_svg` contains a bundle-relative path to a trusted local SVG file.

Remote icon URLs and inline SVG source are not permitted.

---

# 2. `exercises.json`

## Purpose

`exercises.json` describes what an exercise is. It does not define a workout prescription or record performed work.

## Top-Level Structure

```json
{
  "format": "repjot/exercises",
  "schemaVersion": 1,
  "exercises": []
}
```

## Exercise

An exercise contains classification, instructions, and supported measurements.

```json
{
  "id": "Balance_Board",
  "name": "Balance Board",
  "instructions": [
    "Place a balance board in front of you.",
    "Stand up on it and try to balance yourself.",
    "Hold the balance for as long as desired."
  ],
  "equipment": "other",
  "force": null,
  "mechanic": "compound",
  "category": "strength",
  "level": "beginner",
  "movementPattern": "none",
  "primaryMuscles": ["calves"],
  "secondaryMuscles": ["hamstrings", "quadriceps"],
  "laterality": "bilateral",
  "measurements": [
    { "dimension": "reps", "compatibleUnits": ["reps"] }
  ],
  "loadSemantics": "total"
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | yes | Stable exercise ID. The ID is the free-exercise-db source ID. See Requirement 6.1. |
| `name` | string | yes | Display name. |
| `instructions` | string[] | yes | Ordered execution instructions. The array can be empty. |
| `icon` | icon | no | Material Symbol or local SVG. |
| `equipment` | vocabulary value or null | yes | Required equipment. One value from the closed vocabulary in `$defs.equipmentValue`, normalized by the seed. `null` means no equipment. |
| `force` | enum or null | yes | General force direction. |
| `mechanic` | enum or null | yes | Compound or isolation classification. |
| `category` | enum | yes | General free-exercise-db category. |
| `level` | enum | yes | Difficulty copied from the source. One of `beginner`, `intermediate`, `expert`. The seed copies it verbatim. See Requirement 13.4. |
| `movementPattern` | enum | yes | REP JOT movement pattern. |
| `primaryMuscles` | enum[] | yes | Primary muscles. |
| `secondaryMuscles` | enum[] | yes | Secondary muscles. The array can be empty. |
| `laterality` | enum | yes | Normal bilateral or unilateral execution. A new result defaults to `alternating` for unilateral and `both` for bilateral. Also opens the side control; see `loadSemantics`. |
| `measurements` | nonempty measurement support[] | yes | One or more unique dimensions that prescriptions and results can use. Each entry has at least one compatible unit. |
| `loadSemantics` | enum | yes | Meaning of recorded load. A bare allowlist entry defaults to `total`. A `per_implement` load also makes the exercise side-selectable, because each side carries its own weight. |

An exercise has no free-form description field. Use `instructions` only for ordered execution instructions. REP JOT has no `deprecated` flag. Selection follows the seed allowlist.

## Classification Enums

The classification fields are separate. They must not be combined into one modality field.

### Force

The values generally follow free-exercise-db:

```text
push
pull
static
```

Use `null` when force does not apply or reliable source data is unavailable.

### Mechanic

The values generally follow free-exercise-db:

```text
compound
isolation
```

Use `null` when mechanic does not apply or reliable source data is unavailable.

### Category

The values follow free-exercise-db:

```text
strength
stretching
plyometrics
strongman
powerlifting
cardio
olympic weightlifting
```

### Level

The values follow free-exercise-db. The seed copies the source value verbatim. See Requirement 13.4.

```text
beginner
intermediate
expert
```

REP JOT does not re-rate a level. REP JOT does not map a level to a display label beyond the source word.

### Movement Pattern

Movement pattern is a separate REP JOT classification:

```text
squat
hinge
horizontal_push
vertical_push
horizontal_pull
vertical_pull
carry
locomotion
rotation
anti_rotation
flexion
extension
other
none
```

Each exercise has one primary movement pattern. `none` means REP JOT has no movement pattern for the exercise. The seed assigns `none` to a bare allowlist entry that names no pattern. See Requirement 13.16.

### Muscle

The muscle fields use free-exercise-db's 17-value muscle enum:

```text
abdominals
abductors
adductors
biceps
calves
chest
forearms
glutes
hamstrings
lats
lower back
middle back
neck
quadriceps
shoulders
traps
triceps
```

### Laterality

```text
bilateral
unilateral
```

Laterality describes normal execution. It does not describe every possible variation.

### Equipment

The equipment vocabulary is closed. `$defs.equipmentValue` owns the list.

```text
band
barbell
cable
dumbbell
e-z curl bar
exercise ball
foam roll
kettlebell
machine
medicine ball
other
```

Every value is lower case and singular. The seed normalizes input into this list and
fails on any value outside it. `body only` is not a value. The seed maps it to
`null`. See [Exercise Seeding](./exercise-seeding.md).

## Measurements and Units

A measurement support entry declares one controlled dimension and its compatible units:

```json
{
  "dimension": "weight",
  "compatibleUnits": ["kg", "lb"]
}
```

The allowed dimensions and units are:

| Dimension | Compatible units | Value rule |
|---|---|---|
| `reps` | `reps` | Prescriptions use a non-negative integer. Results use `{ value: <non-negative integer>, unit: "reps" }`. |
| `weight` | `lb`, `kg` | Non-negative number. |
| `addedWeight` | `lb`, `kg` | Non-negative number. |
| `assistedWeight` | `lb`, `kg` | Non-negative number. |
| `distance` | `m`, `km`, `ft`, `mi` | Non-negative number. |
| `duration` | `second`, `minute` | Non-negative number. |
| `calories` | `kcal` | Non-negative number. |

An exercise lists only applicable dimensions. Each listed unit must be compatible with its dimension.

A prescription or result must use a listed dimension and compatible unit. `reps` is a plain integer only in prescriptions. A result stores the explicit `reps` quantity.

Load semantics are:

```text
total
per_implement
added
assisted
```

For example, a 50 lb Dumbbell Bench Press with `per_implement` means one 50 lb dumbbell in each hand. Barbell load normally uses `total`. The `addedWeight` and `assistedWeight` dimensions use `added` and `assisted` respectively.

The exercise directory does not select the user's preferred unit. `preferences.json` owns that selection.

---

# 3. `workouts.json`

## Purpose

`workouts.json` contains workout definitions. A workout is an ordered tree of container and exercise nodes.

Containers define execution and result scoring. Exercise nodes reference exercises and define prescriptions.

## Top-Level Structure

```json
{
  "format": "repjot/workouts",
  "schemaVersion": 1,
  "workouts": []
}
```

## Workout

```json
{
  "id": "squat-day-a",
  "name": "Squat Day A",
  "root": {}
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | yes | Stable workout ID. |
| `name` | string | yes | Display name. |
| `notes` | string | no | Author notes about the workout. |
| `root` | container node | yes | Root of the workout tree. |

Each node ID is unique within its workout. The same node ID MAY appear in two different workouts. REP JOT has no `deprecated` flag. The chooser lists what `workouts.json` lists.

## Container Node

A container controls its ordered children.

```json
{
  "id": "conditioning",
  "type": "container",
  "name": "Conditioning",
  "strategy": "amrap",
  "strategyConfig": {
    "duration": { "value": 20, "unit": "minute" }
  },
  "resultCapture": {
    "mode": "scored",
    "scoreType": "rounds_and_reps",
    "childDetail": "optional"
  },
  "children": []
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | yes | Stable node ID within the workout. |
| `type` | `"container"` | yes | Node discriminator. |
| `name` | string | no | Display name. |
| `strategy` | enum | yes | Execution strategy. |
| `strategyConfig` | object | yes | Strategy-specific values. |
| `resultCapture` | object | no | Container score and child-detail rules. |
| `benchmark` | object | no | Named benchmark metadata. |
| `children` | node[] | yes | Ordered child nodes. |

### Sequence

A sequence executes each child once in order:

```json
{
  "strategy": "sequence",
  "strategyConfig": {}
}
```

### Rounds

A rounds container executes all children in order for a fixed count:

```json
{
  "strategy": "rounds",
  "strategyConfig": { "rounds": 5 }
}
```

`rounds` remains the term for an ordinary fixed-round container.

### AMRAP

An AMRAP repeats its children until its duration expires:

```json
{
  "strategy": "amrap",
  "strategyConfig": {
    "duration": { "value": 20, "unit": "minute" }
  },
  "resultCapture": {
    "mode": "scored",
    "scoreType": "rounds_and_reps",
    "childDetail": "optional"
  }
}
```

A completed cycle contains all children. Extra repetitions belong to the next incomplete cycle. `rounds_and_reps` is valid only when the container resolves to a deterministic ordered sequence of repetition-based leaf exercises.

### EMOM

An EMOM assigns one child to each timed interval. The children repeat in order for each cycle.

```json
{
  "strategy": "emom",
  "strategyConfig": {
    "cycles": 6,
    "interval": { "value": 1, "unit": "minute" }
  },
  "resultCapture": {
    "mode": "scored",
    "scoreType": "intervals",
    "childDetail": "optional"
  }
}
```

`cycles` replaces the ambiguous EMOM field `rounds`. One cycle traverses every child once.

Each interval starts at the configured interval boundary. A two-child EMOM with six cycles contains 12 intervals.

### Complex

A complex performs its children consecutively as one unit. Its configuration defines the prescribed cycle count.

```json
{
  "strategy": "complex",
  "strategyConfig": { "cycles": 5 },
  "resultCapture": {
    "mode": "scored",
    "scoreType": "cycles",
    "childDetail": "none"
  }
}
```

Complex score capture belongs to the workout container. It must not appear in an exercise definition. `childDetail: "none"` makes the complex score authoritative and does not create results for its component exercises.

### Result Capture

`resultCapture.mode` is `scored`. Supported score types are:

```text
cycles
rounds_and_reps
intervals
```

`childDetail` controls exercise-result capture:

```text
none
optional
```

A scored AMRAP, EMOM, or complex stores one container score. It can also store child exercise results when `childDetail` is `optional`.

With no child results, the score is authoritative. When the user expands optional detail, the application produces a **draft** child set inferred from the score and the workout prescription. A draft value is not recorded actual work. The UI labels every draft value `Inferred` before the user saves. A draft value becomes recorded actual work only when the user saves it, with the explicit value and unit the user saw.

Saved child detail can be partial while the user progressively enters work. If the saved detail follows valid progression and derives the aggregate exactly, each edit recomputes the standard container score. Otherwise, the container uses a `nonstandard` score and the UI displays `Detailed`. `childDetail: "none"` forbids child results.

### Benchmark Metadata

A named benchmark is metadata on its implementing container:

```json
{
  "benchmark": {
    "name": "Cindy",
    "organization": "CrossFit"
  }
}
```

`name` is required. `organization` is optional. Applications must execute the container tree instead of inferring work from the benchmark name.

## Exercise Node

An exercise node defines one occurrence of an exercise in a workout.

```json
{
  "id": "heavy-squat",
  "type": "exercise",
  "exerciseId": "Barbell_Squat",
  "stimulus": "strength",
  "setType": "working",
  "prescription": {
    "reps": 5,
    "weight": { "value": 225, "unit": "lb" }
  }
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | yes | Stable node ID within the workout. |
| `type` | `"exercise"` | yes | Node discriminator. |
| `exerciseId` | string | yes | Reference to `exercises.json`. |
| `stimulus` | enum | yes | Intended stimulus for this occurrence. |
| `setType` | enum | no | `warmup` or `working`. |
| `prescription` | object | yes | Target work. |
| `notes` | string | no | Unstructured workout notes. |

Supported stimuli are:

```text
strength
hypertrophy
power
conditioning
mobility
```

An exercise node does not configure complex or scored result capture. A parent workout container owns that configuration.

## Prescription

A prescription uses dimensions supported by the referenced exercise:

```json
{
  "reps": 5,
  "weight": { "value": 225, "unit": "lb" }
}
```

A numeric `reps` value is exact. Approximate and ranged targets use these forms:

```json
[
  { "reps": 8 },
  { "reps": { "target": 8, "qualifier": "approximate" } },
  { "reps": { "min": 6, "max": 8 } }
]
```

A range is inclusive. An actual repetition result is a quantity with a non-negative integer `value` and the explicit unit `reps`. Prescription repetitions remain bare integers because they are not stored results.

### Effort Targets

`effort` defines the intended endpoint of a set:

```json
[
  { "effort": { "type": "failure" } },
  { "effort": { "type": "rir", "target": 2 } },
  { "effort": { "type": "rpe", "target": 8 } }
]
```

The supported types are `failure`, `rir`, and `rpe`. Effort is not an exercise measurement dimension.

### Load Strategies

`loadStrategy` defines load selection across iterations of the nearest repeated container:

```json
{
  "loadStrategy": {
    "type": "descending",
    "firstIteration": "maximal_for_prescription",
    "adjustment": "decrease_to_repeat_effort"
  }
}
```

Supported strategy types are `fixed`, `ascending`, `descending`, and `self_selected`.

### Iteration-Specific Prescriptions

An exercise in a repeated container can define different work by iteration:

```json
{
  "iterations": [
    { "iteration": 1, "reps": 5, "weight": { "value": 225, "unit": "lb" } },
    { "iteration": 2, "reps": 3, "weight": { "value": 245, "unit": "lb" } },
    { "iteration": 3, "reps": 1, "weight": { "value": 265, "unit": "lb" } }
  ]
}
```

`iteration` is one-based and applies to the nearest repeated container.

Top-level fields are the base prescription for every iteration. An entry in
`iterations` overrides only the fields that it contains. Fields omitted from the entry
inherit their top-level values.

For this three-round prescription, the effective values are:

1. Iteration 1: 5 reps at 80 kg.
2. Iteration 2: 3 reps at 100 kg. The entry overrides `reps` and inherits `weight`.
3. Iteration 3: 8 reps at 100 kg because it has no override entry.

```json
{
  "reps": 8,
  "weight": { "value": 100, "unit": "kg" },
  "iterations": [
    {
      "iteration": 1,
      "reps": 5,
      "weight": { "value": 80, "unit": "kg" }
    },
    {
      "iteration": 2,
      "reps": 3
    }
  ]
}
```

An iteration can also add a field that has no top-level value. If a field exists in
neither place, that iteration has no prescription for the field. `null` cannot remove an
inherited field.

Each iteration number can appear only once. This complete example is invalid because it
defines two conflicting overrides for iteration 2:

```json
{
  "reps": 8,
  "weight": { "value": 100, "unit": "kg" },
  "iterations": [
    {
      "iteration": 2,
      "weight": { "value": 90, "unit": "kg" }
    },
    {
      "iteration": 2,
      "weight": { "value": 80, "unit": "kg" }
    }
  ]
}
```

REP JOT rejects duplicate iteration numbers instead of using array order as precedence.
An iteration number is one-based. For a finite repeated container, it cannot exceed that
container's configured iteration count.

## Workout Example

```json
{
  "format": "repjot/workouts",
  "schemaVersion": 1,
  "workouts": [
    {
      "id": "strength-and-cindy",
      "name": "Strength and Cindy",
      "root": {
        "id": "root",
        "type": "container",
        "strategy": "sequence",
        "strategyConfig": {},
        "children": [
          {
            "id": "squat-sets",
            "type": "container",
            "strategy": "rounds",
            "strategyConfig": { "rounds": 3 },
            "children": [
              {
                "id": "back-squat-set",
                "type": "exercise",
                "exerciseId": "Barbell_Squat",
                "stimulus": "strength",
                "setType": "working",
                "prescription": {
                  "iterations": [
                    { "iteration": 1, "reps": 5, "weight": { "value": 225, "unit": "lb" } },
                    { "iteration": 2, "reps": 3, "weight": { "value": 245, "unit": "lb" } },
                    { "iteration": 3, "reps": 1, "weight": { "value": 265, "unit": "lb" } }
                  ]
                }
              }
            ]
          },
          {
            "id": "cindy",
            "type": "container",
            "name": "Cindy",
            "strategy": "amrap",
            "strategyConfig": { "duration": { "value": 20, "unit": "minute" } },
            "resultCapture": {
              "mode": "scored",
              "scoreType": "rounds_and_reps",
              "childDetail": "optional"
            },
            "benchmark": { "name": "Cindy", "organization": "CrossFit" },
            "children": [
              { "id": "cindy-pull-ups", "type": "exercise", "exerciseId": "Pullups", "stimulus": "conditioning", "prescription": { "reps": 5 } },
              { "id": "cindy-push-ups", "type": "exercise", "exerciseId": "Pushups", "stimulus": "conditioning", "prescription": { "reps": 10 } },
              { "id": "cindy-squats", "type": "exercise", "exerciseId": "Bodyweight_Squat", "stimulus": "conditioning", "prescription": { "reps": 15 } }
            ]
          }
        ]
      }
    }
  ]
}
```

---

# 4. `preferences.json`

## Purpose

`preferences.json` stores user choices separately from reference and workout data.

The file is versioned for schema migration and write-conflict handling:

```json
{
  "format": "repjot/preferences",
  "schemaVersion": 1,
  "revision": 12,
  "updatedAtUtc": "2026-08-15T15:25:00Z",
  "exerciseUnits": {
    "Barbell_Squat": {
      "weight": "lb"
    },
    "Pullups": {
      "addedWeight": "kg"
    }
  }
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `format` | `"repjot/preferences"` | yes | Document family. |
| `schemaVersion` | integer | yes | Structure version. |
| `revision` | integer | yes | Informational counter only. It never selects a migration and never resolves a conflict. |
| `updatedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | yes | UTC time of the latest saved revision. |
| `exerciseUnits` | `Record<exerciseId, Record<dimension, unit>>` | yes | Preferred unit by exercise ID and measurement dimension. |

`exerciseUnits` is a keyed map. It is not an array. Each exercise key maps one dimension to one unit. This shape keeps `jsondiffpatch` deltas independent of position, so two devices that change different exercises never conflict.

Synchronization merges mappings by exercise ID and dimension. The conflict unit is one exercise-and-dimension mapping. If the same mapping changed locally and remotely, the pending value from the client performing the later synchronization wins. REP JOT does not prompt for preference conflicts.

Changing the preference does not rewrite saved historical prescriptions or results. If the user toggles a unit while editing an entered value, REP JOT converts that value with full internal precision. The editable display rounds the converted value to the nearest `0.1` in the selected unit. An exact half rounds upward because all measurement values are non-negative.

For example, 100 kg converts internally to approximately 220.462 lb and displays as 220.5 lb. Five km displays as 3.1 mi. Ninety seconds displays as 1.5 minutes. The rule is the same for weight, distance, and duration.

Display rounding does not immediately replace the full-precision converted value. If the user leaves the displayed number unchanged, the saved quantity keeps the full-precision value and its explicit unit. If the user edits the displayed number, REP JOT saves the number that the user enters. This prevents repeated unit toggles from accumulating avoidable conversion drift.

This rule can display a small positive conversion as `0.0`, such as one second shown in minutes. The saved value remains positive unless the user explicitly edits it to zero. Static exercise data should list unit combinations appropriate for the exercise so this case remains uncommon.

If an exercise has no saved preference, the first `compatibleUnits` entry is the default. Static data lists metric units before imperial units. The application saves the first explicit user selection.

---

# 5. `results-YYYY-MM.json`

## Purpose

Each monthly results file records actual workout sessions. For example, `results-2026-08.json` contains sessions whose persisted UTC start is in August 2026.

The UTC month in `startedAtUtc` selects the file. The application converts a local start to UTC before it selects the shard. A session that crosses a UTC month boundary remains in its UTC start-month file.

For example, a local start at `2026-08-31T23:30:00-07:00` persists as
`2026-09-01T06:30:00Z`. That session belongs in `results-2026-09.json` with
`yearMonthUtc: "2026-09"`. The local value is display input only and is not canonical.

## Top-Level Structure

```json
{
  "format": "repjot/results",
  "schemaVersion": 1,
  "yearMonthUtc": "2026-08",
  "sessions": {}
}
```

`yearMonthUtc` must match the `YYYY-MM` part of the file name and the UTC year and month of each session's `startedAtUtc`.

`sessions` is a `Record<sessionId, Session>`. It is not an array. The session ID is the key and also appears as the session `id`. REP JOT stores no `sessionTombstones` field. Deleting a session removes its key from the map.

## Session

```json
{
  "id": "session-550e8400-e29b-41d4-a716-446655440000",
  "workoutId": "strength-and-cindy",
  "status": "completed",
  "startedAtUtc": "2026-08-15T14:30:00Z",
  "completedAtUtc": "2026-08-15T15:25:00Z",
  "updatedAtUtc": "2026-08-15T15:25:00Z",
  "exerciseResults": {},
  "containerResults": {}
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | yes | `session-` prefixed UUID v4. Matches the key in `sessions`. |
| `workoutId` | string | yes | Direct reference to the workout used for that session. |
| `status` | enum | yes | `in_progress`, `completed`, or `abandoned`. |
| `startedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | yes | UTC session start time and shard source. Immutable after it is written. |
| `completedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | conditional | Required for `completed` and `abandoned`. Forbidden for `in_progress`. Immutable after it is written. Records the terminal instant for either terminal status. |
| `updatedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | yes | System-managed. The application sets it on every saved write. The user cannot edit it. |
| `exerciseResults` | `Record<compositeKey, ExerciseResult>` | yes | Exercise results keyed by composite key. |
| `containerResults` | `Record<compositeKey, ContainerResult>` | yes | Scored-container results keyed by composite key. |
| `notes` | string | no | Session notes. |

`completed` means that the user intentionally completed the session. It does not mean that every prescribed item has a result.

`abandoned` means that the user intentionally ended an unfinished session. `completedAtUtc` records when either terminal status occurred. The name follows Requirement 11.20. It marks the terminal instant, not a `completed` status. Several sessions can have `in_progress` status.

New session IDs use the prefix `session-` followed by a collision-resistant UUID v4. The prefix is required so the key can never be integer-like. The ID does not encode `startedAtUtc`.

No session stores an `executionPlan`, in progress or terminal. An in-progress session resolves its tree from the current bundle on each load. A deploy during an active workout can change that workout. The user restarts the session or edits the result afterward.

Completed and abandoned sessions remain terminal while the Active Workout editor changes their results. The editor starts from the current workout tree and overlays recorded results by execution path. New current-tree nodes appear with blank results. Ordinary result editing preserves `status`, `startedAtUtc`, and `completedAtUtc`. The editor can reclassify a completed session as abandoned, or an abandoned session as completed; reclassification preserves `startedAtUtc` and `completedAtUtc`. Release one does not permit edits to workout timestamps.

REP JOT creates no sync copy. A merge conflict resolves by the last-syncer-wins rule without a new session ID and without a label. History shows one entry per session ID. No session carries a `conflictOfSessionId` field.

A local edit beats a remote delete. When one device deletes a session and another device holds an unsynced edit to that session, the edit wins and the session returns. The user deletes it again on the device that still shows it.

## Execution Path

Each result contains a nested `executionPath`. The path starts at the workout root and ends at the result's programmed node.

```json
[
  { "nodeId": "root" },
  { "nodeId": "squat-sets", "iteration": 3 },
  { "nodeId": "back-squat-set" }
]
```

Each repeated container path segment has a one-based `iteration`. For EMOM containers, `iteration` is the one-based cycle.

Nested repeated containers each contribute their own path segment and iteration. This removes the ambiguity of one flat `iteration` field.

## Exercise Result

A session stores exercise results in `exerciseResults`, a `Record<compositeKey, ExerciseResult>`. The key is `<path>|<side>|<attempt>`. The value stores its programmed path and its direct exercise reference:

```json
{
  "root/squat-sets:3/back-squat-set|both|1": {
    "workoutId": "strength-and-cindy",
    "executionPath": [
      { "nodeId": "root" },
      { "nodeId": "squat-sets", "iteration": 3 },
      { "nodeId": "back-squat-set" }
    ],
    "exerciseId": "Barbell_Squat",
    "side": "both",
    "attempt": 1,
    "status": "completed",
    "values": {
      "reps": { "value": 1, "unit": "reps" },
      "weight": { "value": 255, "unit": "lb" }
    }
  }
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `workoutId` | string | yes | Direct workout reference. It must match the containing session. |
| `executionPath` | path segment[] | yes | Full path to the programmed exercise node. The map key derives from it. |
| `exerciseId` | string | yes | Direct reference to the exercise. |
| `side` | enum | no | `left`, `right`, `both`, or `alternating`. The key derives from it. Default `both`. |
| `attempt` | integer | no | One-based attempt number. The key derives from it. Default `1`. |
| `startingSide` | enum | conditional | `left` or `right`. Required only when `side` is `alternating`. It is not part of the key. |
| `status` | enum | yes | `completed`, `incomplete`, or `skipped`. |
| `values` | object | conditional | Actual values. Required when measured data exists. |
| `effort` | object | no | Observed `failure`, `rir`, or `rpe` outcome. |
| `startedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | no | UTC result start time. |
| `endedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | no | UTC result end time. |
| `reasonCode` | enum | conditional | Required for an incomplete or skipped item; forbidden for a completed item. |
| `notes` | string | no | Optional free-text detail. |

There is no `type` field. The map name carries the kind. Validation rejects a key that does not match the `executionPath`, `side`, and `attempt` in the value it maps to.

The direct `exerciseId` preserves exercise identity without traversing the workout tree. It must match the exercise node at the end of `executionPath`. When it does not, the result is unresolved and the UI shows the error card.

A repetition result uses `{ "value": <non-negative integer>, "unit": "reps" }`. A zero-repetition attempt is measured data. It is not a skipped result. `side` is normally absent for bilateral work and required when unilateral actuals are recorded.

`left` and `right` store repetitions for one side. `both` stores simultaneous repetitions. `alternating` stores total repetitions across sides and requires the actual `startingSide`. The UI shows the derived split, such as `10 total / 5 each` or `9 total / 5 left / 4 right`.

Supported reason codes are:

```text
user_skipped
not_completed
equipment_unavailable
physical_limitation
time_constraint
unsuccessful_attempt
other
```

## Scored Container Result

A session stores container results in `containerResults`, a `Record<compositeKey, ContainerResult>`. The key is `<path>|<attempt>`. The result uses the score type configured on the workout container:

```json
{
  "root/cindy|1": {
    "workoutId": "strength-and-cindy",
    "executionPath": [
      { "nodeId": "root" },
      { "nodeId": "cindy" }
    ],
    "attempt": 1,
    "status": "completed",
    "score": {
      "type": "rounds_and_reps",
      "completedRounds": 12,
      "additionalReps": 7
    }
  }
}
```

Supported score shapes are:

```json
[
  {
    "type": "cycles",
    "completedCycles": 5
  },
  {
    "type": "rounds_and_reps",
    "completedRounds": 12,
    "additionalReps": 7
  },
  {
    "type": "intervals",
    "completedIntervals": 11,
    "totalIntervals": 12
  },
  {
    "type": "nonstandard"
  }
]
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `workoutId` | string | yes | Direct workout reference. It must match the containing session. |
| `executionPath` | path segment[] | yes | Full path to the scored workout container. The map key derives from it. |
| `attempt` | integer | no | One-based attempt number. The key derives from it. Default `1`. |
| `status` | enum | yes | `completed`, `incomplete`, or `skipped`. |
| `score` | score | conditional | Score defined by the container's `resultCapture.scoreType`. |
| `startedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | no | UTC container start time. |
| `endedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | no | UTC container end time. |
| `reasonCode` | enum | conditional | Required for an incomplete or skipped container; forbidden for a completed container. |
| `notes` | string | no | Optional free-text detail. |

A completed scored container has a `score`. An incomplete container can have the observed partial score. A skipped container has no score.

Child detail uses separate exercise results beneath the scored container. It can be absent, partial, or complete. When complete valid ordered work can produce the configured score, semantic validation derives and matches it.

If detail does not follow valid round or interval progression, or cannot derive an exact aggregate, the score is `{ "type": "nonstandard" }`. The recorded child results remain authoritative, and the UI displays `Detailed` instead of a misleading aggregate.

## Save and Omission Rules

The application saves an `in_progress` session when the user enters data or changes a data-relevant session field. Later saves update the same session ID.

The application saves terminal status and `completedAtUtc` when the user completes or abandons the session.

REP JOT does not create placeholder results for untouched work. Absence means that no data-relevant result was recorded.

The application stores `incomplete` only when partial values, timing, or notes are relevant. It stores `skipped` only when the skip itself is relevant. Both statuses require a controlled `reasonCode`; free text belongs in `notes`.

A skipped result normally has no `values`. An incomplete result can contain partial `values`. A `completed` result must contain recorded data, such as values, effort, or timing. A blank input creates no result.

These rules prevent large result files that contain only default or inferred state.

## Complete Monthly Example

```json
{
  "format": "repjot/results",
  "schemaVersion": 1,
  "yearMonthUtc": "2026-08",
  "sessions": {
    "session-550e8400-e29b-41d4-a716-446655440000": {
      "id": "session-550e8400-e29b-41d4-a716-446655440000",
      "workoutId": "strength-and-cindy",
      "status": "completed",
      "startedAtUtc": "2026-08-15T14:30:00Z",
      "completedAtUtc": "2026-08-15T15:25:00Z",
      "updatedAtUtc": "2026-08-15T15:25:00Z",
      "exerciseResults": {
        "root/squat-sets:1/back-squat-set|both|1": {
          "workoutId": "strength-and-cindy",
          "executionPath": [
            { "nodeId": "root" },
            { "nodeId": "squat-sets", "iteration": 1 },
            { "nodeId": "back-squat-set" }
          ],
          "exerciseId": "Barbell_Squat",
          "side": "both",
          "attempt": 1,
          "status": "completed",
          "values": {
            "reps": { "value": 5, "unit": "reps" },
            "weight": { "value": 225, "unit": "lb" }
          }
        },
        "root/squat-sets:3/back-squat-set|both|1": {
          "workoutId": "strength-and-cindy",
          "executionPath": [
            { "nodeId": "root" },
            { "nodeId": "squat-sets", "iteration": 3 },
            { "nodeId": "back-squat-set" }
          ],
          "exerciseId": "Barbell_Squat",
          "side": "both",
          "attempt": 1,
          "status": "incomplete",
          "values": {
            "reps": { "value": 0, "unit": "reps" },
            "weight": { "value": 265, "unit": "lb" }
          },
          "reasonCode": "unsuccessful_attempt"
        },
        "root/squat-sets:3/back-squat-set|both|2": {
          "workoutId": "strength-and-cindy",
          "executionPath": [
            { "nodeId": "root" },
            { "nodeId": "squat-sets", "iteration": 3 },
            { "nodeId": "back-squat-set" }
          ],
          "exerciseId": "Barbell_Squat",
          "side": "both",
          "attempt": 2,
          "status": "completed",
          "values": {
            "reps": { "value": 1, "unit": "reps" },
            "weight": { "value": 255, "unit": "lb" }
          }
        }
      },
      "containerResults": {
        "root/cindy|1": {
          "workoutId": "strength-and-cindy",
          "executionPath": [
            { "nodeId": "root" },
            { "nodeId": "cindy" }
          ],
          "attempt": 1,
          "status": "completed",
          "score": {
            "type": "rounds_and_reps",
            "completedRounds": 12,
            "additionalReps": 7
          }
        }
      }
    }
  }
}
```

This example uses aggregate-only Cindy entry, so it has no child results. If the user expands Cindy, REP JOT produces a draft child set inferred from the score and the prescription. Those draft values are not recorded actual work until the user saves them. The user can save part of that detail. If the saved detail cannot derive an exact aggregate, the container score is `nonstandard` and the UI displays `Detailed`.

---

# 6. Reference Relationships

```text
exercises.json
    exercises include required equipment
    exercises
         ↑
         │ workout exerciseNode.exerciseId
         │ result.exerciseId
         │ preferences.exerciseUnits keys
         │
workouts.json
    workouts
         ↑
         │ session.workoutId
         │ result.workoutId
         │ result.executionPath nodeIds
         │
results-YYYY-MM.json
    sessions and results
```

`workouts.json` does not duplicate exercise classification or instructions.

A result stores `exerciseId` deliberately. This direct reference preserves historical identity and supports exercise-level queries.

The session and each result store `workoutId`. A result's value must match its session, and its `executionPath` resolves within that workout.

---

# 7. Data Ownership Summary

## `exercises.json`

Owns exercise facts:

```text
name
instructions
icon
required equipment
force
mechanic
category
movement pattern
muscles
laterality
supported measurement dimensions and units
```

## `workouts.json`

Owns intended work:

```text
workout structure and order
container strategies
rounds and EMOM cycles
interval timing
complex definitions
container result-capture rules
exercise selection
stimulus and set type
prescriptions
effort and load targets
benchmark metadata
```

## `preferences.json`

Owns mutable user choices:

```text
file revision and `updatedAtUtc`
exercise-level unit selection
```

## `results-YYYY-MM.json`

Owns actual execution:

```text
session status and UTC times
workout execution paths
direct exercise references
attempts and measured values
container scores
optional child detail
actual effort
relevant incomplete or skipped state
reason codes and notes
```

Sessions, exercise results, and container results are keyed maps. No array. REP JOT stores no session tombstones and no frozen execution plan.

No result changes an exercise or programmed prescription.

---

# 8. Validation Invariants

Implementations must enforce these rules. Resolution failures in items 2 through 6 are nonfatal diagnostics for stored results, not schema-validation failures. They show the error card while preserving recorded-value display and synchronization.

1. Every workout node `exerciseId` resolves in `exercises.json` during static build validation.
2. A session `workoutId` resolves to the workout used for that session when the current bundle still contains it.
3. Each result `workoutId` always matches its containing session. It resolves to that same workout when the current bundle contains the workout.
4. Each result path resolves from that workout's root to its terminal node when the current tree still contains the path.
5. An exercise result's direct `exerciseId` matches its terminal workout node when that node resolves.
6. A result with a failure under items 2 through 5 is marked unresolved; it is not rejected or rewritten.
7. Every result quantity has a recognized dimension and stores an explicit compatible unit.
8. If current exercise measurements differ from a stored result, the loader marks a nonfatal unresolved-reference diagnostic. It does not reject the result.
9. A preferred unit is compatible with its current exercise and dimension.
10. A container score matches the workout container's `scoreType`, or it is `nonstandard` when detail cannot derive an exact valid aggregate.
11. Child detail obeys the workout container's `childDetail` rule and can be absent, partial, or complete when optional.
12. Standard child detail derives exactly the stored container score and follows valid progression.
13. A session has at most one container result per execution path and attempt.
14. Every exercise result key equals the `<path>|<side>|<attempt>` string derived from its own `executionPath`, `side`, and `attempt`.
15. Every container result key equals the `<path>|<attempt>` string derived from its own `executionPath` and `attempt`.
16. An alternating exercise result has `startingSide`; other results do not.
17. Every key in `sessions` equals the `id` of the session it maps to, and every session `id` uses the `session-` prefix.
18. An `in_progress` session has no `completedAtUtc`. A `completed` or `abandoned` session has `completedAtUtc`.
19. No session contains an `executionPlan` field, in any status.
20. A monthly file name, `yearMonthUtc`, and each session `startedAtUtc` UTC month agree.
21. No exercise, workout, node, or non-null equipment value contains `/`, `|`, or `:`.
22. No key in a synchronized document is integer-like.
23. Every collection that two devices can change is a keyed map. None is an array.
24. `rounds_and_reps` containers resolve only to deterministic repetition-based leaf sequences.
25. Every persisted `*Utc` timestamp is a valid RFC 3339 date-time that ends in `Z`.
26. Iteration overrides inherit omitted top-level fields, and each iteration number appears at most once in a prescription.
