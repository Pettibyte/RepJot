# Exercise Side Defaults

## Status

This specification defines the implemented default side for a new exercise
result. `docs/REQUIREMENTS.md` remains authoritative where it differs from this
file.

## Rule

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

## Result meaning

The rule does not change result semantics:

- `both` repetitions are simultaneous repetitions for the set.
- `alternating` repetitions are the total across both sides.
- `left` and `right` remain valid user-selected result sides. Their repetitions
  are for that side.

For example, 8 dumbbell curls on each side record as `alternating` with 16
repetitions. The UI shows `16 total / 8 each`. Eight barbell curls record as
`both` with 8 repetitions.

## Boundaries

The default does not alter workout prescriptions, iteration overrides, result
keys, or stored history. The user can select another valid side before saving.
Changing a saved side continues to move the result between its existing keys:

```text
<path>|<side>|<attempt>
```

The default is derived at runtime. The allowlist, generated `exercises.json`,
exercise schema, seed-allowlist schema, and seed script contain no
`defaultRepSide` field.

## Required tests

A future change must verify that:

1. a new unilateral row starts as `alternating` with starting side `left`;
2. a new bilateral or unresolved row starts as `both`;
3. a saved result keeps its stored side when the model rebuilds;
4. 16 alternating repetitions display as `16 total / 8 each`; and
5. a changed side moves one result key rather than creating a second result.
