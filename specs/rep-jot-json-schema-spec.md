# Fitness Tracker JSON Schema Specification

## Purpose

This document defines the JSON data model for a single-user fitness tracker.

The application stores all persistent data in three JSON files, separated by expected edit frequency:

1. `exercises.json` — rarely edited reference facts about exercises and equipment.
2. `programming.json` — occasionally edited workout definitions and programmed prescriptions.
3. `results.json` — frequently edited records of workouts actually performed.

There is no database in this revision. All three files must be independently loadable as JSON in a browser.

Identifiers are stable strings. References between files use those identifiers rather than embedding duplicate copies of referenced entities.

---

# 1. `exercises.json`

## Purpose

`exercises.json` contains relatively stable facts about:

- exercises
- equipment
- movement patterns
- muscle groups
- laterality
- modality

This file describes what an exercise **is**, not how it is programmed in a particular workout and not what the user actually performed.

## Top-Level Structure

```json
{
  "schemaVersion": 1,
  "equipment": [],
  "exercises": []
}
```

---

## Equipment

Equipment is stored as a fact table.

An exercise may require zero or more equipment entries.

Zero required equipment means the exercise can be performed using bodyweight alone. There is no special `"bodyweight"` equipment entity.

### Equipment Schema

```json
{
  "id": "barbell",
  "name": "Barbell",
  "description": "Standard loaded barbell."
}
```

### Fields

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | yes | Stable unique identifier. |
| `name` | string | yes | Human-readable equipment name. |
| `description` | string | no | Optional explanatory text. |

### Example Equipment Directory

```json
[
  {
    "id": "barbell",
    "name": "Barbell"
  },
  {
    "id": "squat-rack",
    "name": "Squat Rack"
  },
  {
    "id": "kettlebell",
    "name": "Kettlebell"
  },
  {
    "id": "dumbbell",
    "name": "Dumbbell"
  },
  {
    "id": "bench",
    "name": "Bench"
  },
  {
    "id": "pull-up-bar",
    "name": "Pull-up Bar"
  },
  {
    "id": "rowing-machine",
    "name": "Rowing Machine"
  }
]
```

---

# Exercise

An exercise is a reusable entry in the exercise directory.

The exercise record contains coarse semantic information sufficient to describe the movement and support future exercise substitution without attempting to model detailed kinesiology.

## Exercise Schema

```json
{
  "id": "back-squat",
  "name": "Back Squat",
  "description": "Barbell back squat performed from a rack.",
  "equipmentIds": [
    "barbell",
    "squat-rack"
  ],
  "movementPattern": "squat",
  "primaryMuscleGroups": [
    "quads",
    "glutes"
  ],
  "secondaryMuscleGroups": [
    "hamstrings",
    "core"
  ],
  "laterality": "bilateral",
  "modality": "compound",
  "measurements": [
    {
      "name": "reps",
      "unit": "rep"
    },
    {
      "name": "weight",
      "unit": "lb"
    }
  ]
}
```

## Fields

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | yes | Stable unique identifier. |
| `name` | string | yes | Human-readable exercise name. |
| `description` | string | no | Optional description. |
| `equipmentIds` | string[] | yes | Equipment required to perform the exercise. Empty array means bodyweight/no equipment. |
| `movementPattern` | enum | yes | Primary movement pattern. |
| `primaryMuscleGroups` | enum[] | yes | Coarse groups receiving the primary training load. |
| `secondaryMuscleGroups` | enum[] | yes | Coarse groups receiving meaningful secondary load. May be empty. |
| `laterality` | enum | yes | Whether the movement is normally bilateral or unilateral. |
| `modality` | enum | yes | Broad exercise modality. |
| `measurements` | object[] | yes | Measurements meaningful when prescribing or recording the exercise. |

---

## Movement Patterns

Movement pattern is intentionally constrained to a small vocabulary.

Allowed values:

```text
squat
hinge
horizontal_push
vertical_push
horizontal_pull
vertical_pull
carry
locomotion
core
other
```

Each exercise has one primary movement pattern.

Examples:

| Exercise | Movement Pattern |
|---|---|
| Back Squat | `squat` |
| Goblet Squat | `squat` |
| Romanian Deadlift | `hinge` |
| Bench Press | `horizontal_push` |
| Push-up | `horizontal_push` |
| Overhead Press | `vertical_push` |
| Barbell Row | `horizontal_pull` |
| Pull-up | `vertical_pull` |
| Farmer Carry | `carry` |
| Run | `locomotion` |
| Plank | `core` |

---

## Muscle Groups

Muscle groups are intentionally coarse.

Allowed values:

```text
quads
hamstrings
glutes
calves
chest
back
shoulders
biceps
triceps
forearms
core
full_body
```

An exercise may have multiple primary and secondary muscle groups.

The schema intentionally does not represent individual muscles, muscle heads, anatomical regions, or activation percentages.

Example:

```json
{
  "primaryMuscleGroups": [
    "chest"
  ],
  "secondaryMuscleGroups": [
    "triceps",
    "shoulders"
  ]
}
```

---

## Laterality

Allowed values:

```text
bilateral
unilateral
```

Examples:

| Exercise | Laterality |
|---|---|
| Back Squat | `bilateral` |
| Goblet Squat | `bilateral` |
| Bulgarian Split Squat | `unilateral` |
| Walking Lunge | `unilateral` |
| Bench Press | `bilateral` |
| Single-arm Dumbbell Row | `unilateral` |

Laterality describes the normal execution of the exercise, not necessarily every possible variation.

---

## Modality

Allowed values:

```text
compound
isolation
cardio
mobility
```

Examples:

| Exercise | Modality |
|---|---|
| Back Squat | `compound` |
| Bench Press | `compound` |
| Biceps Curl | `isolation` |
| Triceps Extension | `isolation` |
| Run | `cardio` |
| Row | `cardio` |
| Hip Flexor Stretch | `mobility` |

---

## Measurements

Measurements describe the dimensions that may be prescribed or recorded for an exercise.

Typical measurement names include:

```text
reps
weight
addedWeight
distance
duration
calories
```

Example strength exercise:

```json
{
  "measurements": [
    {
      "name": "reps",
      "unit": "rep"
    },
    {
      "name": "weight",
      "unit": "lb"
    }
  ]
}
```

Example run:

```json
{
  "measurements": [
    {
      "name": "distance",
      "unit": "m"
    },
    {
      "name": "duration",
      "unit": "second"
    }
  ]
}
```

Example weighted pull-up:

```json
{
  "measurements": [
    {
      "name": "reps",
      "unit": "rep"
    },
    {
      "name": "addedWeight",
      "unit": "lb"
    }
  ]
}
```

---

## Complete `exercises.json` Example

```json
{
  "schemaVersion": 1,
  "equipment": [
    {
      "id": "barbell",
      "name": "Barbell"
    },
    {
      "id": "squat-rack",
      "name": "Squat Rack"
    },
    {
      "id": "kettlebell",
      "name": "Kettlebell"
    },
    {
      "id": "pull-up-bar",
      "name": "Pull-up Bar"
    }
  ],
  "exercises": [
    {
      "id": "air-squat",
      "name": "Air Squat",
      "equipmentIds": [],
      "movementPattern": "squat",
      "primaryMuscleGroups": [
        "quads",
        "glutes"
      ],
      "secondaryMuscleGroups": [
        "hamstrings",
        "core"
      ],
      "laterality": "bilateral",
      "modality": "compound",
      "measurements": [
        {
          "name": "reps",
          "unit": "rep"
        }
      ]
    },
    {
      "id": "back-squat",
      "name": "Back Squat",
      "equipmentIds": [
        "barbell",
        "squat-rack"
      ],
      "movementPattern": "squat",
      "primaryMuscleGroups": [
        "quads",
        "glutes"
      ],
      "secondaryMuscleGroups": [
        "hamstrings",
        "core"
      ],
      "laterality": "bilateral",
      "modality": "compound",
      "measurements": [
        {
          "name": "reps",
          "unit": "rep"
        },
        {
          "name": "weight",
          "unit": "lb"
        }
      ]
    },
    {
      "id": "kettlebell-swing",
      "name": "Kettlebell Swing",
      "equipmentIds": [
        "kettlebell"
      ],
      "movementPattern": "hinge",
      "primaryMuscleGroups": [
        "glutes",
        "hamstrings"
      ],
      "secondaryMuscleGroups": [
        "back",
        "core",
        "forearms"
      ],
      "laterality": "bilateral",
      "modality": "compound",
      "measurements": [
        {
          "name": "reps",
          "unit": "rep"
        },
        {
          "name": "weight",
          "unit": "lb"
        }
      ]
    },
    {
      "id": "pull-up",
      "name": "Pull-up",
      "equipmentIds": [
        "pull-up-bar"
      ],
      "movementPattern": "vertical_pull",
      "primaryMuscleGroups": [
        "back"
      ],
      "secondaryMuscleGroups": [
        "biceps",
        "forearms"
      ],
      "laterality": "bilateral",
      "modality": "compound",
      "measurements": [
        {
          "name": "reps",
          "unit": "rep"
        }
      ]
    }
  ]
}
```

---

# 2. `programming.json`

## Purpose

`programming.json` contains workouts as they are intended to be performed.

A workout is represented as an ordered tree.

Container nodes define execution behavior such as:

- sequence
- fixed rounds
- AMRAP
- EMOM

Exercise nodes reference the exercise directory and contain the prescription for that specific occurrence of the exercise.

Programming data is distinct from both exercise facts and actual execution results.

## Top-Level Structure

```json
{
  "schemaVersion": 1,
  "workouts": []
}
```

---

# Workout

```json
{
  "id": "squat-day-a",
  "name": "Squat Day A",
  "root": {}
}
```

## Fields

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | yes | Stable workout identifier. |
| `name` | string | yes | Human-readable workout name. |
| `description` | string | no | Optional description. |
| `root` | node | yes | Root of the programmed workout tree. |

---

# Nodes

There are two node types:

```text
container
exercise
```

Every node has a stable `id`.

The ID is important because actual results refer back to the programmed node that produced them.

---

# Container Node

A container controls how its ordered children are executed.

## Schema

```json
{
  "id": "warmup",
  "type": "container",
  "name": "Warmup",
  "strategy": "rounds",
  "strategyConfig": {
    "rounds": 5
  },
  "children": []
}
```

## Fields

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | yes | Stable node identifier within the workout. |
| `type` | `"container"` | yes | Node type. |
| `name` | string | no | Human-readable section name. |
| `strategy` | enum | yes | Execution semantics for the children. |
| `strategyConfig` | object | yes | Parameters specific to the strategy. |
| `children` | node[] | yes | Ordered child nodes. |
| `benchmark` | object | no | Machine-readable identity for a named benchmark implemented by this container. Contains `name` and optional `organization`. The children remain the authoritative workout definition. |

---

## Container Strategies

### Sequence

Execute each child once in order.

```json
{
  "strategy": "sequence",
  "strategyConfig": {}
}
```

### Rounds

Execute all children in order a fixed number of times.

```json
{
  "strategy": "rounds",
  "strategyConfig": {
    "rounds": 5
  }
}
```

### AMRAP

Repeat all children in order until the specified duration expires.

```json
{
  "strategy": "amrap",
  "strategyConfig": {
    "duration": {
      "value": 20,
      "unit": "minute"
    }
  }
}
```

### EMOM

Execute children on fixed timed intervals.

Children are selected sequentially and cycle as necessary.

```json
{
  "strategy": "emom",
  "strategyConfig": {
    "rounds": 6,
    "interval": {
      "value": 1,
      "unit": "minute"
    }
  }
}
```

A two-child EMOM with six rounds therefore produces twelve timed intervals.

## Benchmark Metadata

A named workout is metadata on the container whose strategy and children implement it:

```json
{
  "benchmark": {
    "name": "Cindy",
    "organization": "CrossFit"
  }
}
```

`name` is required and `organization` is optional. Applications may search or group by this metadata, but must execute the container's strategy and children rather than infer work from the benchmark name.

---

# Exercise Node

An exercise node references an exercise in `exercises.json`.

It contains only information specific to this occurrence in the workout.

## Schema

```json
{
  "id": "heavy-squat",
  "type": "exercise",
  "exerciseId": "back-squat",
  "stimulus": "strength",
  "setType": "working",
  "prescription": {
    "reps": 5,
    "weight": {
      "value": 225,
      "unit": "lb"
    }
  }
}
```

## Fields

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | yes | Stable node identifier within the workout. |
| `type` | `"exercise"` | yes | Node type. |
| `exerciseId` | string | yes | Reference to `exercises.json`. |
| `stimulus` | enum | yes | Intended training stimulus for this programmed occurrence. |
| `setType` | enum | no | Role of the set: `warmup` or `working`. This is distinct from the training stimulus. |
| `prescription` | object | yes | Target work to perform. |
| `notes` | string | no | Optional unstructured programming notes. Notes must not be used in place of the structured prescription fields below. |

---

# Stimulus

Stimulus belongs to the programmed exercise, not the exercise directory.

The same exercise may be programmed with different stimuli.

Allowed values:

```text
strength
hypertrophy
power
conditioning
mobility
```

For example, both of these refer to the same Back Squat exercise:

```json
{
  "exerciseId": "back-squat",
  "stimulus": "strength",
  "prescription": {
    "reps": 3,
    "weight": {
      "value": 315,
      "unit": "lb"
    }
  }
}
```

```json
{
  "exerciseId": "back-squat",
  "stimulus": "hypertrophy",
  "prescription": {
    "reps": 12,
    "weight": {
      "value": 185,
      "unit": "lb"
    }
  }
}
```

---

# Prescription

A prescription contains values meaningful to the referenced exercise.

Example:

```json
{
  "reps": 5,
  "weight": {
    "value": 225,
    "unit": "lb"
  }
}
```

Another example:

```json
{
  "distance": {
    "value": 400,
    "unit": "m"
  }
}
```

The exercise directory's `measurements` field defines which dimensions normally apply.

---

## Repetition Targets

A numeric `reps` value is exact. Approximate or ranged targets use an object:

```json
{
  "reps": {
    "target": 8,
    "qualifier": "approximate"
  }
}
```

Supported forms are:

```json
[
  { "reps": 8 },
  { "reps": { "target": 8, "qualifier": "approximate" } },
  { "reps": { "min": 6, "max": 8 } }
]
```

`qualifier`, when present, is `approximate`. A range is inclusive. Actual repetitions in `results.json` are always recorded as an integer, not as a target object.

## Effort Targets

`effort` describes the intended endpoint of a set. It is not a measurement and does not belong in the exercise directory.

```json
{
  "effort": {
    "type": "failure"
  }
}
```

Supported effort types are:

- `failure` — continue until another repetition cannot be completed with the prescribed technique;
- `rir` — stop at a target repetitions-in-reserve value, using `target`;
- `rpe` — stop at a target rate of perceived exertion, using `target`.

Examples:

```json
[
  { "effort": { "type": "failure" } },
  { "effort": { "type": "rir", "target": 2 } },
  { "effort": { "type": "rpe", "target": 8 } }
]
```

Failure here means that failure is the endpoint of a completed set. It is different from recording zero completed repetitions for an unsuccessful attempt.

## Load Strategies

`loadStrategy` describes how load is selected across iterations of the immediately enclosing repeated container. It is used when exact weights are intentionally not known in advance.

```json
{
  "loadStrategy": {
    "type": "descending",
    "firstIteration": "maximal_for_prescription",
    "adjustment": "decrease_to_repeat_effort"
  }
}
```

Supported strategy types are `fixed`, `ascending`, `descending`, and `self_selected`. A `descending` strategy with the heaviest work first is commonly called a reverse pyramid.

- `firstIteration: "maximal_for_prescription"` means the greatest safe load consistent with the other prescription fields (for example, approximately eight reps to failure), not an absolute one-repetition maximum.
- `adjustment: "decrease_to_repeat_effort"` means reduce load on later iterations as needed to reproduce the prescribed repetition and effort target.

A concrete `weight` may be combined with a strategy when the initial or all iteration loads are known. Otherwise, actual weights are captured in `results.json`.

# Iteration-Specific Prescriptions

An exercise inside a repeated container may prescribe different work on different iterations.

For example:

```text
Round 1: 5 reps @ 225 lb
Round 2: 3 reps @ 245 lb
Round 3: 1 rep @ 265 lb
```

Represent this using `iterations`:

```json
{
  "iterations": [
    {
      "iteration": 1,
      "reps": 5,
      "weight": {
        "value": 225,
        "unit": "lb"
      }
    },
    {
      "iteration": 2,
      "reps": 3,
      "weight": {
        "value": 245,
        "unit": "lb"
      }
    },
    {
      "iteration": 3,
      "reps": 1,
      "weight": {
        "value": 265,
        "unit": "lb"
      }
    }
  ]
}
```

`iteration` is one-based.

The iteration applies to the immediately enclosing repeating container.

---

# Complete `programming.json` Example

```json
{
  "schemaVersion": 1,
  "workouts": [
    {
      "id": "squat-day-a",
      "name": "Squat Day A",
      "root": {
        "id": "root",
        "type": "container",
        "strategy": "sequence",
        "strategyConfig": {},
        "children": [
          {
            "id": "warmup",
            "type": "container",
            "name": "Warmup",
            "strategy": "rounds",
            "strategyConfig": {
              "rounds": 5
            },
            "children": [
              {
                "id": "warmup-air-squat",
                "type": "exercise",
                "exerciseId": "air-squat",
                "stimulus": "mobility",
                "prescription": {
                  "reps": 10
                }
              },
              {
                "id": "warmup-kb-swing",
                "type": "exercise",
                "exerciseId": "kettlebell-swing",
                "stimulus": "conditioning",
                "prescription": {
                  "reps": 10,
                  "weight": {
                    "value": 35,
                    "unit": "lb"
                  }
                }
              }
            ]
          },
          {
            "id": "heavy-work",
            "type": "container",
            "name": "Heavy Sets",
            "strategy": "rounds",
            "strategyConfig": {
              "rounds": 3
            },
            "children": [
              {
                "id": "heavy-back-squat",
                "type": "exercise",
                "exerciseId": "back-squat",
                "stimulus": "strength",
                "prescription": {
                  "iterations": [
                    {
                      "iteration": 1,
                      "reps": 5,
                      "weight": {
                        "value": 225,
                        "unit": "lb"
                      }
                    },
                    {
                      "iteration": 2,
                      "reps": 3,
                      "weight": {
                        "value": 245,
                        "unit": "lb"
                      }
                    },
                    {
                      "iteration": 3,
                      "reps": 1,
                      "weight": {
                        "value": 265,
                        "unit": "lb"
                      }
                    }
                  ]
                }
              },
              {
                "id": "heavy-pullups",
                "type": "exercise",
                "exerciseId": "pull-up",
                "stimulus": "strength",
                "prescription": {
                  "reps": 5
                }
              }
            ]
          }
        ]
      }
    }
  ]
}
```

---

# Full Example: Warmup, Reverse-Pyramid Strength, and Cindy

The following examples include every referenced exercise and expand Cindy into its actual movements. `benchmark` preserves “Cindy” as queryable metadata; it does not replace the executable AMRAP tree.

### Relevant `exercises.json`

```json
{
  "schemaVersion": 1,
  "equipment": [
    { "id": "barbell", "name": "Barbell" },
    { "id": "squat-rack", "name": "Squat Rack" },
    { "id": "pull-up-bar", "name": "Pull-up Bar" }
  ],
  "exercises": [
    {
      "id": "dead-hang", "name": "Dead Hang",
      "equipmentIds": ["pull-up-bar"], "movementPattern": "vertical_pull",
      "primaryMuscleGroups": ["forearms"], "secondaryMuscleGroups": ["back", "shoulders"],
      "laterality": "bilateral", "modality": "mobility",
      "measurements": [{ "name": "duration", "unit": "second" }]
    },
    {
      "id": "tabletop", "name": "Tabletop",
      "equipmentIds": [], "movementPattern": "core",
      "primaryMuscleGroups": ["core"], "secondaryMuscleGroups": ["glutes", "shoulders"],
      "laterality": "bilateral", "modality": "mobility",
      "measurements": [{ "name": "duration", "unit": "second" }]
    },
    {
      "id": "deep-squat-stretch", "name": "Deep Squat Stretch",
      "equipmentIds": [], "movementPattern": "squat",
      "primaryMuscleGroups": ["quads", "glutes"], "secondaryMuscleGroups": ["hamstrings"],
      "laterality": "bilateral", "modality": "mobility",
      "measurements": [{ "name": "duration", "unit": "second" }]
    },
    {
      "id": "90-90-hip-stretch", "name": "90-90 Hip Stretch",
      "equipmentIds": [], "movementPattern": "other",
      "primaryMuscleGroups": ["glutes"], "secondaryMuscleGroups": [],
      "laterality": "bilateral", "modality": "mobility",
      "measurements": [{ "name": "duration", "unit": "second" }]
    },
    {
      "id": "back-squat", "name": "Back Squat",
      "equipmentIds": ["barbell", "squat-rack"], "movementPattern": "squat",
      "primaryMuscleGroups": ["quads", "glutes"], "secondaryMuscleGroups": ["hamstrings", "core"],
      "laterality": "bilateral", "modality": "compound",
      "measurements": [{ "name": "reps", "unit": "rep" }, { "name": "weight", "unit": "lb" }]
    },
    {
      "id": "romanian-deadlift", "name": "Romanian Deadlift",
      "equipmentIds": ["barbell"], "movementPattern": "hinge",
      "primaryMuscleGroups": ["hamstrings", "glutes"], "secondaryMuscleGroups": ["back", "core", "forearms"],
      "laterality": "bilateral", "modality": "compound",
      "measurements": [{ "name": "reps", "unit": "rep" }, { "name": "weight", "unit": "lb" }]
    },
    {
      "id": "pull-up", "name": "Pull-up",
      "equipmentIds": ["pull-up-bar"], "movementPattern": "vertical_pull",
      "primaryMuscleGroups": ["back"], "secondaryMuscleGroups": ["biceps", "forearms"],
      "laterality": "bilateral", "modality": "compound",
      "measurements": [{ "name": "reps", "unit": "rep" }]
    },
    {
      "id": "push-up", "name": "Push-up",
      "equipmentIds": [], "movementPattern": "horizontal_push",
      "primaryMuscleGroups": ["chest"], "secondaryMuscleGroups": ["triceps", "shoulders", "core"],
      "laterality": "bilateral", "modality": "compound",
      "measurements": [{ "name": "reps", "unit": "rep" }]
    },
    {
      "id": "air-squat", "name": "Air Squat",
      "equipmentIds": [], "movementPattern": "squat",
      "primaryMuscleGroups": ["quads", "glutes"], "secondaryMuscleGroups": ["hamstrings", "core"],
      "laterality": "bilateral", "modality": "compound",
      "measurements": [{ "name": "reps", "unit": "rep" }]
    }
  ]
}
```

### `programming.json`

```json
{
  "schemaVersion": 1,
  "workouts": [{
    "id": "reverse-pyramid-cindy-day",
    "name": "Reverse Pyramid Strength and Cindy",
    "root": {
      "id": "root", "type": "container", "strategy": "sequence", "strategyConfig": {},
      "children": [
        {
          "id": "warmup", "type": "container", "name": "Warmup",
          "strategy": "rounds", "strategyConfig": { "rounds": 4 },
          "children": [
            { "id": "warmup-dead-hang", "type": "exercise", "exerciseId": "dead-hang", "stimulus": "mobility", "prescription": { "duration": { "value": 30, "unit": "second" } } },
            { "id": "warmup-tabletop", "type": "exercise", "exerciseId": "tabletop", "stimulus": "mobility", "prescription": { "duration": { "value": 30, "unit": "second" } } },
            { "id": "warmup-deep-squat", "type": "exercise", "exerciseId": "deep-squat-stretch", "stimulus": "mobility", "prescription": { "duration": { "value": 30, "unit": "second" } } },
            { "id": "warmup-90-90", "type": "exercise", "exerciseId": "90-90-hip-stretch", "stimulus": "mobility", "prescription": { "duration": { "value": 30, "unit": "second" } } }
          ]
        },
        {
          "id": "back-squat-block", "type": "container", "name": "Back Squat",
          "strategy": "sequence", "strategyConfig": {},
          "children": [
            {
              "id": "back-squat-warmups", "type": "container", "strategy": "rounds", "strategyConfig": { "rounds": 2 },
              "children": [{ "id": "back-squat-warmup-set", "type": "exercise", "exerciseId": "back-squat", "stimulus": "strength", "setType": "warmup", "prescription": { "reps": 12 } }]
            },
            {
              "id": "back-squat-working-sets", "type": "container", "strategy": "rounds", "strategyConfig": { "rounds": 3 },
              "children": [{
                "id": "back-squat-working-set", "type": "exercise", "exerciseId": "back-squat", "stimulus": "strength", "setType": "working",
                "prescription": {
                  "reps": { "target": 8, "qualifier": "approximate" },
                  "effort": { "type": "failure" },
                  "loadStrategy": { "type": "descending", "firstIteration": "maximal_for_prescription", "adjustment": "decrease_to_repeat_effort" }
                }
              }]
            }
          ]
        },
        {
          "id": "rdl-block", "type": "container", "name": "Romanian Deadlift",
          "strategy": "sequence", "strategyConfig": {},
          "children": [
            {
              "id": "rdl-warmups", "type": "container", "strategy": "rounds", "strategyConfig": { "rounds": 2 },
              "children": [{ "id": "rdl-warmup-set", "type": "exercise", "exerciseId": "romanian-deadlift", "stimulus": "strength", "setType": "warmup", "prescription": { "reps": 12 } }]
            },
            {
              "id": "rdl-working-sets", "type": "container", "strategy": "rounds", "strategyConfig": { "rounds": 3 },
              "children": [{
                "id": "rdl-working-set", "type": "exercise", "exerciseId": "romanian-deadlift", "stimulus": "strength", "setType": "working",
                "prescription": {
                  "reps": { "target": 8, "qualifier": "approximate" },
                  "effort": { "type": "failure" },
                  "loadStrategy": { "type": "descending", "firstIteration": "maximal_for_prescription", "adjustment": "decrease_to_repeat_effort" }
                }
              }]
            }
          ]
        },
        {
          "id": "cindy", "type": "container", "name": "Conditioning",
          "benchmark": { "name": "Cindy", "organization": "CrossFit" },
          "strategy": "amrap", "strategyConfig": { "duration": { "value": 20, "unit": "minute" } },
          "children": [
            { "id": "cindy-pull-ups", "type": "exercise", "exerciseId": "pull-up", "stimulus": "conditioning", "prescription": { "reps": 5 } },
            { "id": "cindy-push-ups", "type": "exercise", "exerciseId": "push-up", "stimulus": "conditioning", "prescription": { "reps": 10 } },
            { "id": "cindy-air-squats", "type": "exercise", "exerciseId": "air-squat", "stimulus": "conditioning", "prescription": { "reps": 15 } }
          ]
        }
      ]
    }
  }]
}
```

This models each lift as its own sequence so all squat sets finish before RDL sets begin. The `rounds` containers give each result an unambiguous iteration number.

---

# 3. `results.json`

## Purpose

`results.json` records what the user actually performed.

Results never modify the programmed prescription.

A session references:

- the programmed workout
- the programmed exercise node
- the iteration that was being performed
- the actual values achieved

This allows programmed and actual performance to diverge.

## Top-Level Structure

```json
{
  "schemaVersion": 1,
  "sessions": []
}
```

---

# Workout Session

```json
{
  "id": "2026-08-15-squat-day-a",
  "workoutId": "squat-day-a",
  "startedAt": "2026-08-15T07:30:00-07:00",
  "finishedAt": "2026-08-15T08:25:00-07:00",
  "results": []
}
```

## Fields

| Field | Type | Required | Description |
|---|---|---:|---|
| `id` | string | yes | Stable session identifier. |
| `workoutId` | string | yes | Reference to a workout in `programming.json`. |
| `startedAt` | ISO 8601 timestamp | yes | Session start. |
| `finishedAt` | ISO 8601 timestamp | no | Session completion. |
| `results` | result[] | yes | Actual exercise performances. |
| `notes` | string | no | Session-level notes. |

---

# Exercise Result

Each result represents one attempt at one programmed exercise node.

## Schema

```json
{
  "nodeId": "heavy-back-squat",
  "iteration": 1,
  "attempt": 1,
  "values": {
    "reps": 5,
    "weight": {
      "value": 225,
      "unit": "lb"
    }
  }
}
```

## Fields

| Field | Type | Required | Description |
|---|---|---:|---|
| `nodeId` | string | yes | Reference to the exercise node in the programmed workout. |
| `iteration` | integer | no | One-based iteration of the immediately enclosing repeated container. |
| `attempt` | integer | no | One-based attempt number when multiple attempts occur for the same programmed work. Defaults conceptually to `1`. |
| `values` | object | yes | Measured values actually performed. Repetitions are recorded as an integer. |
| `effort` | object | no | Actual effort outcome. Uses `type` (`failure`, `rir`, or `rpe`), the observed `value` for RIR/RPE, or `achieved` for a failure target. |
| `startedAt` | ISO 8601 timestamp | no | Optional start time for this result. |
| `finishedAt` | ISO 8601 timestamp | no | Optional completion time. |
| `notes` | string | no | Result-specific notes. |

---

For example, a set prescribed to failure that ended at eight repetitions is recorded independently of the target:

```json
{
  "nodeId": "back-squat-working-set",
  "iteration": 1,
  "values": {
    "reps": 8,
    "weight": { "value": 225, "unit": "lb" }
  },
  "effort": {
    "type": "failure",
    "achieved": true
  }
}
```

# Divergence From Programming

Suppose the programmed squat is:

```text
Iteration 1: 225 × 5
Iteration 2: 245 × 3
Iteration 3: 265 × 1
```

The user actually performs:

```text
Iteration 1: 225 × 5
Iteration 2: 245 × 3
Iteration 3, attempt 1: 265 × 0
Iteration 3, attempt 2: 255 × 1
```

The result is represented as:

```json
[
  {
    "nodeId": "heavy-back-squat",
    "iteration": 1,
    "attempt": 1,
    "values": {
      "reps": 5,
      "weight": {
        "value": 225,
        "unit": "lb"
      }
    }
  },
  {
    "nodeId": "heavy-back-squat",
    "iteration": 2,
    "attempt": 1,
    "values": {
      "reps": 3,
      "weight": {
        "value": 245,
        "unit": "lb"
      }
    }
  },
  {
    "nodeId": "heavy-back-squat",
    "iteration": 3,
    "attempt": 1,
    "values": {
      "reps": 0,
      "weight": {
        "value": 265,
        "unit": "lb"
      }
    }
  },
  {
    "nodeId": "heavy-back-squat",
    "iteration": 3,
    "attempt": 2,
    "values": {
      "reps": 1,
      "weight": {
        "value": 255,
        "unit": "lb"
      }
    }
  }
]
```

---

# Complete `results.json` Example

```json
{
  "schemaVersion": 1,
  "sessions": [
    {
      "id": "2026-08-15-squat-day-a",
      "workoutId": "squat-day-a",
      "startedAt": "2026-08-15T07:30:00-07:00",
      "finishedAt": "2026-08-15T08:25:00-07:00",
      "results": [
        {
          "nodeId": "warmup-air-squat",
          "iteration": 1,
          "values": {
            "reps": 10
          }
        },
        {
          "nodeId": "warmup-kb-swing",
          "iteration": 1,
          "values": {
            "reps": 10,
            "weight": {
              "value": 35,
              "unit": "lb"
            }
          }
        },
        {
          "nodeId": "heavy-back-squat",
          "iteration": 1,
          "values": {
            "reps": 5,
            "weight": {
              "value": 225,
              "unit": "lb"
            }
          }
        },
        {
          "nodeId": "heavy-back-squat",
          "iteration": 2,
          "values": {
            "reps": 3,
            "weight": {
              "value": 245,
              "unit": "lb"
            }
          }
        },
        {
          "nodeId": "heavy-back-squat",
          "iteration": 3,
          "attempt": 1,
          "values": {
            "reps": 0,
            "weight": {
              "value": 265,
              "unit": "lb"
            }
          }
        },
        {
          "nodeId": "heavy-back-squat",
          "iteration": 3,
          "attempt": 2,
          "values": {
            "reps": 1,
            "weight": {
              "value": 255,
              "unit": "lb"
            }
          }
        }
      ]
    }
  ]
}
```

---

# Reference Relationships

The three files form the following reference graph:

```text
exercises.json
    equipment
        ↑
        │ equipmentIds
        │
    exercises
        ↑
        │ exerciseId
        │
programming.json
    workouts
        └── nodes
             └── exercise nodes
                    ↑
                    │ nodeId
                    │
results.json
    sessions
        └── results
```

References always point from more frequently edited data toward less frequently edited data.

`results.json` does not duplicate exercise metadata or prescriptions.

`programming.json` does not duplicate exercise metadata.

---

# Data Ownership

## `exercises.json`

Owns stable exercise facts:

```text
exercise name
required equipment
movement pattern
primary muscle groups
secondary muscle groups
bilateral/unilateral
modality
supported measurements
```

It does not own:

```text
sets
reps for a workout
weight for a workout
training stimulus
actual performance
```

## `programming.json`

Owns intended work:

```text
workout structure
ordering
rounds
timing strategies
exercise selection
stimulus
prescribed reps
prescribed weight
prescribed distance
prescribed duration
iteration-specific prescriptions
approximate and ranged repetition targets
effort targets (failure, RIR, and RPE)
load-selection strategies across sets
set roles (warmup or working)
named benchmark metadata
```

It does not own:

```text
exercise anatomy/classification
actual performance
```

## `results.json`

Owns actual execution:

```text
session date/time
exercise attempts
actual reps
actual weight
actual distance
actual duration
actual effort outcomes
unsuccessful attempts
additional attempts
session notes
```

It does not redefine either the exercise or the programmed prescription.

---

# Versioning

Each file contains:

```json
{
  "schemaVersion": 1
}
```

`schemaVersion` identifies the structure of the JSON file, not the version of an individual workout or exercise.

Future incompatible schema changes increment this value.

---

# Identifier Requirements

All IDs are strings.

IDs must:

- be unique within the entity namespace they identify;
- remain stable after creation;
- not depend on array position;
- be usable as references across files.

Human-readable slug-style identifiers are appropriate for stable facts:

```text
back-squat
barbell
pull-up-bar
```

Workout and session identifiers may similarly use application-generated stable strings.

Node IDs need only be unique within their workout, because a result identifies the workout through `workoutId` and the exercise occurrence through `nodeId`.

---

# Schema Summary

```text
exercises.json
├── schemaVersion
├── equipment[]
│   ├── id
│   ├── name
│   └── description?
│
└── exercises[]
    ├── id
    ├── name
    ├── description?
    ├── equipmentIds[]
    ├── movementPattern
    ├── primaryMuscleGroups[]
    ├── secondaryMuscleGroups[]
    ├── laterality
    ├── modality
    └── measurements[]


programming.json
├── schemaVersion
└── workouts[]
    ├── id
    ├── name
    ├── description?
    └── root
        └── node
            ├── container
            │   ├── id
            │   ├── name?
            │   ├── strategy
            │   ├── strategyConfig
            │   ├── benchmark?
            │   └── children[]
            │
            └── exercise
                ├── id
                ├── exerciseId
                ├── stimulus
                ├── setType?
                ├── prescription
                │   ├── effort?
                │   └── loadStrategy?
                └── notes?


results.json
├── schemaVersion
└── sessions[]
    ├── id
    ├── workoutId
    ├── startedAt
    ├── finishedAt?
    ├── notes?
    └── results[]
        ├── nodeId
        ├── iteration?
        ├── attempt?
        ├── values
        ├── effort?
        ├── startedAt?
        ├── finishedAt?
        └── notes?
```