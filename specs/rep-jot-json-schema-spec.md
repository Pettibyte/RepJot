# REP JOT JSON Schema Specification

## Purpose

This document defines the persistent JSON data model for REP JOT.

The application uses these files:

1. `exercises.json` stores exercise and equipment reference data.
2. `workouts.json` stores workout definitions and prescriptions.
3. `preferences.json` stores versioned user preferences.
4. `results-YYYY-MM.json` stores workout sessions for one UTC calendar month.

There is no database in this revision. Each file must load independently as JSON in a browser.

All files contain `format` and `schemaVersion`. References use stable IDs instead of copies of referenced entities.

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

## Stable IDs and Deprecation

Published equipment, exercise, workout, and workout-node IDs must never be deleted or reused. Corrections to labels, instructions, and prescriptions can retain the same ID and apply to historical views.

An ID must not represent a different entity or node role later. A published workout node must keep its parent because historical execution paths include its ancestry.

An optional `deprecated: true` flag marks an exercise or workout as unavailable for new use. Deprecated items remain resolvable for historical results.

A deprecated exercise cannot appear in a new workout. A new session from an existing workout omits exercises deprecated at its start. Each scored ancestor affected by an omission becomes detail-only in the effective plan. It requires remaining child detail and uses `nonstandard` instead of an aggregate score. If no executable child remains, the container is skipped with `reasonCode: "deprecated"`. An in-progress session keeps its frozen plan. A deprecated workout is hidden from the chooser and cannot start.

The build compares the current bundle with the prior production bundle. It fails when a published ID disappears or is reused in another namespace.

The comparison also preserves each node's type, parent, exercise reference, container strategy, and result-capture contract. Previously published measurement dimensions and compatible units cannot be removed. New dimensions and units can be added.

The build does not compare complete content hashes, labels, instructions, notes, or prescriptions. A workout and node found in the prior production bundle are existing. A node added to an existing workout is new and cannot reference a deprecated exercise.

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
  "equipment": [],
  "exercises": []
}
```

## Equipment

Equipment is a reference entity. An empty `equipmentIds` array means that an exercise needs no equipment. Unknown source equipment must be curated before publication.

```json
{
  "id": "barbell",
  "name": "Barbell",
  "icon": { "type": "material_symbol", "name": "fitness_center" }
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | yes | Stable equipment ID. |
| `name` | string | yes | Display name. |
| `icon` | icon | no | Material Symbol or local SVG. |

## Exercise

An exercise contains classification, instructions, and supported measurements.

```json
{
  "id": "back-squat",
  "name": "Back Squat",
  "instructions": [
    "Position the bar across the upper back.",
    "Descend until the hip crease is below the top of the knee.",
    "Stand and fully extend the hips and knees."
  ],
  "icon": { "type": "local_svg", "path": "icons/exercises/back-squat.svg" },
  "equipmentIds": ["barbell", "squat-rack"],
  "force": "push",
  "mechanic": "compound",
  "category": "strength",
  "movementPattern": "squat",
  "primaryMuscles": ["quadriceps", "glutes"],
  "secondaryMuscles": ["hamstrings", "lower back"],
  "laterality": "bilateral",
  "measurements": [
    { "dimension": "reps", "compatibleUnits": ["rep"] },
    { "dimension": "weight", "compatibleUnits": ["kg", "lb"] }
  ],
  "loadSemantics": "total"
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | yes | Stable exercise ID. |
| `name` | string | yes | Display name. |
| `instructions` | string[] | yes | Ordered execution instructions. The array can be empty. |
| `icon` | icon | no | Material Symbol or local SVG. |
| `equipmentIds` | string[] | yes | References to equipment. An empty array means no equipment. |
| `force` | enum or null | yes | General force direction. |
| `mechanic` | enum or null | yes | Compound or isolation classification. |
| `category` | enum | yes | General free-exercise-db category. |
| `movementPattern` | enum | yes | REP JOT movement pattern. |
| `primaryMuscles` | enum[] | yes | Primary muscles. |
| `secondaryMuscles` | enum[] | yes | Secondary muscles. The array can be empty. |
| `laterality` | enum | yes | Normal bilateral or unilateral execution. |
| `measurements` | measurement support[] | yes | Dimensions that prescriptions and results can use. |
| `loadSemantics` | enum | conditional | Meaning of recorded load. Required when a load dimension exists. |
| `deprecated` | boolean | no | Prevents use in new workouts while preserving existing references. |

An exercise has no free-form description field. Use `instructions` only for ordered execution instructions.

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
```

Each exercise has one primary movement pattern.

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
| `reps` | `rep` | Non-negative integer. |
| `weight` | `lb`, `kg` | Non-negative number. |
| `addedWeight` | `lb`, `kg` | Non-negative number. |
| `assistedWeight` | `lb`, `kg` | Non-negative number. |
| `distance` | `m`, `km`, `ft`, `mi` | Non-negative number. |
| `duration` | `second`, `minute` | Non-negative number. |
| `calories` | `kcal` | Non-negative number. |

An exercise lists only applicable dimensions. Each listed unit must be compatible with its dimension.

A prescription or result must use a listed dimension and compatible unit. `reps` remains a plain integer in prescriptions and results.

Load semantics are:

```text
total
per_implement
added
assisted
```

For example, a 50 lb Dumbbell Bench Press with `per_implement` means one 50 lb dumbbell in each hand. Barbell load normally uses `total`. The `addedWeight` and `assistedWeight` dimensions use `added` and `assisted` respectively.

The exercise directory does not select the user's preferred unit. `preferences.json` owns that selection.

## Exercise Directory Example

```json
{
  "format": "repjot/exercises",
  "schemaVersion": 1,
  "equipment": [
    { "id": "barbell", "name": "Barbell" },
    { "id": "squat-rack", "name": "Squat Rack" },
    { "id": "pull-up-bar", "name": "Pull-up Bar" }
  ],
  "exercises": [
    {
      "id": "back-squat",
      "name": "Back Squat",
      "instructions": [
        "Position the bar across the upper back.",
        "Squat to the prescribed depth.",
        "Stand and fully extend the hips and knees."
      ],
      "equipmentIds": ["barbell", "squat-rack"],
      "force": "push",
      "mechanic": "compound",
      "category": "strength",
      "movementPattern": "squat",
      "primaryMuscles": ["quadriceps", "glutes"],
      "secondaryMuscles": ["hamstrings", "lower back"],
      "laterality": "bilateral",
      "measurements": [
        { "dimension": "reps", "compatibleUnits": ["rep"] },
        { "dimension": "weight", "compatibleUnits": ["kg", "lb"] }
      ],
      "loadSemantics": "total"
    },
    {
      "id": "pull-up",
      "name": "Pull-up",
      "instructions": [
        "Hang from the bar with extended arms.",
        "Pull until the chin passes the bar.",
        "Lower with control to extended arms."
      ],
      "equipmentIds": ["pull-up-bar"],
      "force": "pull",
      "mechanic": "compound",
      "category": "strength",
      "movementPattern": "vertical_pull",
      "primaryMuscles": ["lats"],
      "secondaryMuscles": ["biceps", "forearms", "middle back"],
      "laterality": "bilateral",
      "measurements": [
        { "dimension": "reps", "compatibleUnits": ["rep"] },
        { "dimension": "addedWeight", "compatibleUnits": ["kg", "lb"] }
      ],
      "loadSemantics": "added"
    }
  ]
}
```

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
| `deprecated` | boolean | no | Hides the workout from the chooser and prevents new sessions. |

Each node ID is unique within its workout. Published node IDs must remain present and must not be reused.

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
required
```

A scored AMRAP, EMOM, or complex stores one container score. It can also store child exercise results when `childDetail` permits them.

With no child results, the score is authoritative. When the user expands optional detail, the application creates the complete child-result set from the score and workout order. Child results then become authoritative, and each edit recomputes the stored container score.

A result must not contain partial child detail. `childDetail: "required"` always requires the complete child-result set. `childDetail: "none"` forbids it.

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
  "exerciseId": "back-squat",
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

A range is inclusive. An actual repetition result is always a non-negative integer.

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
                "exerciseId": "back-squat",
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
              { "id": "cindy-pull-ups", "type": "exercise", "exerciseId": "pull-up", "stimulus": "conditioning", "prescription": { "reps": 5 } },
              { "id": "cindy-push-ups", "type": "exercise", "exerciseId": "push-up", "stimulus": "conditioning", "prescription": { "reps": 10 } },
              { "id": "cindy-squats", "type": "exercise", "exerciseId": "air-squat", "stimulus": "conditioning", "prescription": { "reps": 15 } }
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
    "back-squat": {
      "weight": "lb"
    },
    "pull-up": {
      "addedWeight": "kg"
    }
  }
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `format` | `"repjot/preferences"` | yes | Document family. |
| `schemaVersion` | integer | yes | Structure version. |
| `revision` | integer | yes | Monotonic file revision. Increment after each successful preference save. |
| `updatedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | yes | UTC time of the latest saved revision. |
| `exerciseUnits` | object | yes | Preferred unit by exercise ID and measurement dimension. |

## Exercise-Level Unit Preferences

A unit preference belongs to one exercise and one dimension. The selected unit must appear in that exercise's `compatibleUnits`.

The weight-entry pill displays the selected `lb` or `kg` value for that exercise. Activating the pill switches between supported units.

The application saves the new selection to `preferences.json`. It then uses that selection for new prescriptions and results for the exercise.

Synchronization merges mappings by exercise ID and dimension. If the same mapping changed locally and remotely, the pending value from the client performing the later synchronization wins. REP JOT does not prompt for preference conflicts.

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
  "sessions": [],
  "sessionTombstones": []
}
```

`yearMonthUtc` must match the `YYYY-MM` part of the file name and the UTC year and month of each session's `startedAtUtc`.

## Session Tombstone

Deleting a session removes it from `sessions` and adds a permanent tombstone to its original monthly shard:

```json
{
  "sessionId": "session-550e8400-e29b-41d4-a716-446655440000",
  "deletedAtUtc": "2026-08-20T17:00:00Z"
}
```

A tombstone wins over a session with the same ID during synchronization. REP JOT does not automatically remove tombstones because an unobserved stale device could restore the session. Delete All User Data physically deletes the complete shard.

## Workout Session

```json
{
  "id": "session-550e8400-e29b-41d4-a716-446655440000",
  "workoutId": "strength-and-cindy",
  "status": "completed",
  "startedAtUtc": "2026-08-15T14:30:00Z",
  "endedAtUtc": "2026-08-15T15:25:00Z",
  "updatedAtUtc": "2026-08-15T15:25:00Z",
  "results": []
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | yes | Globally stable `session-` prefixed UUID. |
| `workoutId` | string | yes | Direct reference to the retained workout. |
| `status` | enum | yes | `in_progress`, `completed`, or `abandoned`. |
| `startedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | yes | UTC session start time and shard source. |
| `endedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | conditional | Required for `completed` and `abandoned`. Forbidden for `in_progress`. |
| `updatedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | yes | UTC time of the latest saved session change. |
| `conflictOfSessionId` | string | no | Original session ID when this session is a synchronization copy. |
| `executionPlan` | object | conditional | Required for `in_progress`. Frozen effective workout tree. |
| `results` | result[] | yes | Exercise and scored-container results. |
| `notes` | string | no | Session notes. |

`completed` means that the user intentionally completed the session. It does not mean that every prescribed item has a result.

`abandoned` means that the user intentionally ended an unfinished session. `endedAtUtc` records when either terminal status occurred. Several sessions can have `in_progress` status.

New session IDs use a collision-resistant UUID and do not encode `startedAtUtc`.

Completed and abandoned sessions remain terminal while the Active Workout editor changes their results. The editor starts from the current retained workout tree and overlays recorded results by execution path. New current-tree nodes appear with blank results. A deprecated exercise appears when the session already records its path; an unrecorded deprecated leaf stays hidden. Terminal sessions do not store `executionPlan`. Editing preserves `status`, `startedAtUtc`, and `endedAtUtc`. Release one does not permit timestamp edits. This reuses the editor without mislabeling historical sessions as active.

## Session Sync Copy

If the same live session changed locally and remotely, the remote session keeps the original ID. REP JOT saves the pending local version under a new UUID and sets `conflictOfSessionId` to the original ID. It preserves the local version's status and timestamps. History labels the new session `Sync copy`. The user can inspect, edit, or delete either session with the normal session screens; REP JOT does not provide a separate reconciliation UI.

The client stores the generated copy ID in its pending edit before upload. Retries reuse that ID and cannot create additional copies for the same detected conflict. Tombstones still win over stale live sessions and do not create sync copies.

## Frozen Execution Plan

At session start, `executionPlan` copies the effective workout root, including node IDs, exercise references, strategies, scoring rules, and prescriptions. Exercises deprecated before the start are absent. REP JOT creates a skipped result with `reasonCode: "deprecated"` for each omitted exercise.

For each scored container affected by an omission, the effective plan changes
`childDetail` to `required`. The UI removes aggregate score entry and shows the remaining
child inputs. Complete detail stores `{ "type": "nonstandard" }`. Structurally complete
detail with incomplete results can leave the container score absent. If no executable
child remains, the container is skipped with `reasonCode: "deprecated"` and has no score.

For this rule, complete detail means all remaining leaves in each observed cycle or
block that the user creates. It does not mean every cycle that time could permit. The UI
does not create future AMRAP cycles. Once the user creates an observed cycle, its
remaining leaves use completed, incomplete, or skipped results as applicable.

An in-progress session executes this snapshot after reload or deployment. Later corrections and deprecations do not change it. When a session becomes `completed` or `abandoned`, REP JOT removes `executionPlan`; historical editing uses the current retained workout tree and overlays recorded results by execution path.

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

An exercise result stores both its programmed path and direct exercise reference:

```json
{
  "type": "exercise",
  "workoutId": "strength-and-cindy",
  "executionPath": [
    { "nodeId": "root" },
    { "nodeId": "squat-sets", "iteration": 3 },
    { "nodeId": "back-squat-set" }
  ],
  "exerciseId": "back-squat",
  "attempt": 1,
  "status": "completed",
  "values": {
    "reps": 1,
    "weight": { "value": 255, "unit": "lb" }
  }
}
```

| Field | Type | Required | Description |
|---|---|---:|---|
| `type` | `"exercise"` | yes | Result discriminator. |
| `workoutId` | string | yes | Direct workout reference. It must match the containing session. |
| `executionPath` | path segment[] | yes | Full path to the programmed exercise node. |
| `exerciseId` | string | yes | Direct reference to the retained exercise. |
| `attempt` | integer | no | One-based attempt number. The default is `1`. |
| `side` | enum | no | `left`, `right`, `both`, or `alternating`. |
| `startingSide` | enum | conditional | `left` or `right`. Required only when `side` is `alternating`. |
| `status` | enum | yes | `completed`, `incomplete`, or `skipped`. |
| `values` | object | conditional | Actual values. Required when measured data exists. |
| `effort` | object | no | Observed `failure`, `rir`, or `rpe` outcome. |
| `startedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | no | UTC result start time. |
| `endedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | no | UTC result end time. |
| `reasonCode` | enum | no | Controlled reason for an incomplete or skipped item. |
| `notes` | string | no | Optional free-text detail. |

The direct `exerciseId` preserves exercise identity without traversing the workout tree. It must match the exercise node at the end of `executionPath`.

A zero-repetition attempt is measured data. It is not a skipped result. `side` is normally absent for bilateral work and required when unilateral actuals are recorded.

`left` and `right` store repetitions for one side. `both` stores simultaneous repetitions. `alternating` stores total repetitions across sides and requires the actual `startingSide`. The UI shows the derived split, such as `10 total / 5 each` or `9 total / 5 left / 4 right`.

Supported reason codes are:

```text
deprecated
user_skipped
not_completed
equipment_unavailable
physical_limitation
time_constraint
unsuccessful_attempt
other
```

## Scored Container Result

A scored container result uses the score type configured on the workout container:

```json
{
  "type": "container",
  "workoutId": "strength-and-cindy",
  "executionPath": [
    { "nodeId": "root" },
    { "nodeId": "cindy" }
  ],
  "status": "completed",
  "score": {
    "type": "rounds_and_reps",
    "completedRounds": 12,
    "additionalReps": 7
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
| `type` | `"container"` | yes | Result discriminator. |
| `workoutId` | string | yes | Direct workout reference. It must match the containing session. |
| `executionPath` | path segment[] | yes | Full path to the scored workout container. |
| `status` | enum | yes | `completed`, `incomplete`, or `skipped`. |
| `score` | score | conditional | Score defined by the container's `resultCapture.scoreType`. |
| `startedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | no | UTC container start time. |
| `endedAtUtc` | RFC 3339 UTC timestamp ending in `Z` | no | UTC container end time. |
| `reasonCode` | enum | no | Controlled reason for an incomplete or skipped container. |
| `notes` | string | no | Optional free-text detail. |

A completed scored container has a `score`. An incomplete container can have the observed partial score. A skipped container has no score.

Child detail uses separate exercise results beneath the scored container. It is either absent or complete. When valid ordered work can produce the configured score, semantic validation derives and matches it.

If complete detail does not follow valid round or interval progression, the score is `{ "type": "nonstandard" }`. The child results remain authoritative, and the UI displays `Detailed` instead of a misleading aggregate.

## Save and Omission Rules

The application saves an `in_progress` session when the user enters data or changes a data-relevant session field. Later saves update the same session ID.

The application saves terminal status and `endedAtUtc` when the user completes or abandons the session.

REP JOT does not create placeholder results for untouched work. Absence means that no data-relevant result was recorded.

The application stores `incomplete` only when partial values, timing, a reason code, or notes are relevant. It stores `skipped` only when the skip itself is relevant.

A skipped result normally has no `values`. An incomplete result can contain partial `values`.

These rules prevent large result files that contain only default or inferred state.

## Complete Monthly Example

```json
{
  "format": "repjot/results",
  "schemaVersion": 1,
  "yearMonthUtc": "2026-08",
  "sessions": [
    {
      "id": "session-550e8400-e29b-41d4-a716-446655440000",
      "workoutId": "strength-and-cindy",
      "status": "completed",
      "startedAtUtc": "2026-08-15T14:30:00Z",
      "endedAtUtc": "2026-08-15T15:25:00Z",
      "updatedAtUtc": "2026-08-15T15:25:00Z",
      "results": [
        {
          "type": "exercise",
          "workoutId": "strength-and-cindy",
          "executionPath": [
            { "nodeId": "root" },
            { "nodeId": "squat-sets", "iteration": 1 },
            { "nodeId": "back-squat-set" }
          ],
          "exerciseId": "back-squat",
          "status": "completed",
          "values": {
            "reps": 5,
            "weight": { "value": 225, "unit": "lb" }
          }
        },
        {
          "type": "exercise",
          "workoutId": "strength-and-cindy",
          "executionPath": [
            { "nodeId": "root" },
            { "nodeId": "squat-sets", "iteration": 3 },
            { "nodeId": "back-squat-set" }
          ],
          "exerciseId": "back-squat",
          "attempt": 1,
          "status": "incomplete",
          "values": {
            "reps": 0,
            "weight": { "value": 265, "unit": "lb" }
          },
          "reasonCode": "unsuccessful_attempt"
        },
        {
          "type": "exercise",
          "workoutId": "strength-and-cindy",
          "executionPath": [
            { "nodeId": "root" },
            { "nodeId": "squat-sets", "iteration": 3 },
            { "nodeId": "back-squat-set" }
          ],
          "exerciseId": "back-squat",
          "attempt": 2,
          "status": "completed",
          "values": {
            "reps": 1,
            "weight": { "value": 255, "unit": "lb" }
          }
        },
        {
          "type": "container",
          "workoutId": "strength-and-cindy",
          "executionPath": [
            { "nodeId": "root" },
            { "nodeId": "cindy" }
          ],
          "status": "completed",
          "score": {
            "type": "rounds_and_reps",
            "completedRounds": 12,
            "additionalReps": 7
          }
        }
      ]
    }
  ],
  "sessionTombstones": []
}
```

This example uses aggregate-only Cindy entry, so it has no child results. If the user expands Cindy, REP JOT creates the complete child-result set and derives this score from it.

---

# 6. Reference Relationships

```text
exercises.json
    equipment ← exercise.equipmentIds
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

Owns retained exercise and equipment facts:

```text
name
instructions
icon
equipment
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
session deletion tombstones with `deletedAtUtc`
workout execution paths
direct exercise references
attempts and measured values
container scores
optional child detail
actual effort
relevant incomplete or skipped state
reason codes and notes
```

No result changes an exercise or programmed prescription.

---

# 8. Validation Invariants

Implementations must enforce these cross-file rules:

1. An `equipmentId` resolves to retained equipment.
2. A workout `exerciseId` resolves to a retained, non-deprecated exercise when the workout is new.
3. A session `workoutId` resolves to the retained workout used for that session.
4. Each result `workoutId` matches its session and resolves to that same workout.
5. Each result path resolves from that workout's root to its terminal node.
6. An exercise result's direct `exerciseId` matches its terminal workout node.
7. A measurement dimension appears in the referenced exercise's `measurements`.
8. A quantity unit is compatible with its dimension and load semantics.
9. A preferred unit is compatible with its exercise and dimension.
10. A container score matches the workout container's `scoreType`, or it is `nonstandard` with complete authoritative child detail.
11. Child detail obeys the workout container's `childDetail` rule and is absent or complete.
12. Complete child detail derives exactly the stored container score.
13. A session has at most one container result per execution path.
14. Exercise results are unique by workout, execution path, side, and attempt.
15. An alternating exercise result has `startingSide`; other results do not.
16. Every session has `updatedAtUtc` and a `session-` prefixed UUID.
17. An `in_progress` session has `executionPlan` and no `endedAtUtc`.
18. A `completed` or `abandoned` session has `endedAtUtc` and no `executionPlan`.
19. A monthly file name, `yearMonthUtc`, and each session `startedAtUtc` UTC month agree.
20. A tombstone and live session do not share an ID in one merged document.
21. Tombstones win over stale sessions with the same ID during synchronization.
22. A sync copy references a different session ID in the same shard.
23. Published equipment, exercise, workout, and node IDs remain present and are not reused.
24. Deprecated entities remain available for historical references.
25. `rounds_and_reps` containers resolve only to deterministic repetition-based leaf sequences.
26. Every persisted `*Utc` timestamp is a valid RFC 3339 date-time that ends in `Z`.
27. Iteration overrides inherit omitted top-level fields, and each iteration number appears at most once in a prescription.
28. A scored container affected by a deprecated omission is detail-only and uses `nonstandard` only with complete remaining detail.
