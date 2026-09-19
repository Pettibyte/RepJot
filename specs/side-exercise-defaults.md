# Exercise Side Defaults

## Status

This specification defines the implemented default side for a new exercise
result, and which exercises expose a side choice. `docs/REQUIREMENTS.md` remains
authoritative where it differs from this file.

## Two separate rules

The default side and the side choice answer different questions.

| Question | Driven by | Requirement |
| --- | --- | --- |
| What side does a new row start on? | `laterality` | 9.10 |
| Can the user pick another side at all? | `laterality` **or** `loadSemantics` | 9.11 |

Keeping them apart lets a bilateral exercise keep a `both` default and still let
the user switch to `alternating` for one set.

## Default rule

REP JOT derives the default result side from the exercise's existing
`laterality` field:

| Exercise laterality | New unsaved result side |
| --- | --- |
| `unilateral` | `alternating` |
| `bilateral` | `both` |

The application uses this rule only when the row has no saved result. A saved
result always uses its stored `side` and, for an alternating result, its stored
`startingSide`.

An alternating new row starts on `left`. This is an existing UI default. It is
not exercise data.

## Capability rule

The side control shows when either shape holds:

| laterality | loadSemantics | Side control | Why |
| --- | --- | --- | --- |
| `unilateral` | any | shown | One side works at a time. |
| `bilateral` | `per_implement` | shown | Each side carries its own weight, so the sides can be worked apart. |
| `bilateral` | `total` | hidden | One shared load has no per-side story. |

An exercise the bundle does not hold shows no control.

`sideSelectable()` in `src/ui/viewmodels/activeWorkoutModel.ts` owns this rule.
`sidesForRow()` reads it. The default side does not.

### Why `loadSemantics` opens the control but never sets the default

`loadSemantics` describes how a recorded weight relates to the implement. It
carries no information about how the body moves, so it cannot choose between
`both` and `alternating`.

It does answer whether the sides can be separated, which is the visibility
question. A `per_implement` exercise holds one weight per side by definition.

`laterality` alone cannot drive visibility: a bilateral `per_implement` exercise
such as a two-dumbbell row is normally done together, and a user may still
alternate it.

## Result meaning

The rules do not change result semantics:

- `both` repetitions are simultaneous repetitions for the set.
- `alternating` repetitions are the total across both sides.
- `left` and `right` remain valid user-selected result sides. Their repetitions
  are for that side.

For example, 8 dumbbell curls on each side record as `alternating` with 16
repetitions. The UI shows `16 total / 8 each`. Eight barbell curls record as
`both` with 8 repetitions.

## Boundaries

The defaults do not alter workout prescriptions, iteration overrides, result
keys, or stored history. The user can select another valid side before saving
and can change a saved side afterward. Changing a saved side continues to move
one result between its existing keys:

```text
<path>|<side>|<attempt>
```

The default and the capability are both derived at runtime. The allowlist,
generated `exercises.json`, exercise schema, and seed-allowlist schema contain
no `defaultRepSide` field and no `sideSelectable` field. Both come from the
curated `laterality` and `loadSemantics`.

## Required tests

A change to this area must verify that:

1. a new unilateral row starts as `alternating` with starting side `left`;
2. a new bilateral or unresolved row starts as `both`;
3. a saved result keeps its stored side when the model rebuilds;
4. 16 alternating repetitions display as `16 total / 8 each`;
5. a changed side moves one result key rather than creating a second result;
6. a bilateral `per_implement` row shows the side control and keeps its `both`
   default; and
7. a bilateral `total` row shows no side control.
