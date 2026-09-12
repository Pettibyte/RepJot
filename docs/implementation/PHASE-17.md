# Phase 17 — Active Workout execution screen

Build the day-of workout screen: the editable tree, per-exercise inputs, unit pills,
Last Time badges, AMRAP quick add, and Finish Workout.

## Prerequisites

- Phase 14 session service and tree resolver.
- Phase 13 units and preferences.
- Phase 12 lookup for Last Time.
- Phase 15 shell with the compact back header.

## Goals

1. Render the tree with clear styling for the first three levels and a compact path
   beyond that.
2. Capture actual values with the right control per dimension.
3. Show Last Time and the exercise history link on every exercise.
4. Support AMRAP quick round add, partial rounds, attempts, and container scores.
5. Save locally on blur and on route change.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/ui/screens/ActiveWorkoutScreen.svelte` | Screen container and save orchestration. |
| `src/ui/components/WorkoutTreeEditable.svelte` | Editable tree with depth styling. |
| `src/ui/components/ExerciseRow.svelte` | One exercise with its inputs. |
| `src/ui/components/ValueInput.svelte` | Dimension-aware numeric input with unit pill. |
| `src/ui/components/UnitPill.svelte` | Toggles the preferred unit. |
| `src/ui/components/LastTimeBadge.svelte` | Last completed values, links to Exercise History. |
| `src/ui/components/AmrapControls.svelte` | Large `+` round control and partial-round input. |
| `src/ui/components/EmomControls.svelte` | Interval grid entry. |
| `src/ui/components/ContainerScoreEditor.svelte` | Score entry and **Detailed** indicator. |
| `src/ui/components/AggregateExpander.svelte` | Expands an aggregate into inferred drafts. |
| `src/ui/components/FinishWorkoutBar.svelte` | Finish, abandon, and the incomplete prompt. |
| `src/ui/viewmodels/activeWorkoutModel.ts` | Pure view model over the resolved tree plus results. |

### Signatures

```ts
// src/ui/viewmodels/activeWorkoutModel.ts
export interface ActiveExerciseRow {
  nodeKey: string; resultKey: string | null;
  exerciseId: string; exerciseName: string;
  prescriptionText: string;
  fields: FieldModel[];                 // one per measurement dimension
  lastTime: LastTimeModel;             // { kind: 'value' | 'none', text }
  side?: Side; startingSide?: StartingSide;
  attempt: number;
  status: ResultStatus;
  unresolved: boolean;
}
export interface FieldModel {
  dimension: Dimension; label: string;
  value: string;                        // editable display string, rounded to 0.1
  unit: string; compatibleUnits: string[];
  inputmode: 'numeric' | 'decimal';
}
export function buildActiveWorkoutModel(input: {
  workout: Workout; session: Session; staticData: LoadedStaticData;
  preferences: PreferenceService; lookup: LookupService;
}): { rows: ActiveExerciseRow[]; groups: GroupModel[] };
```

### Control rules

1. Levels 1 through 3 use visible nesting. Deeper nodes show the compact path label.
2. Every numeric input uses `inputmode="decimal"` or `"numeric"` and a visible label.
3. The unit pill shows the current unit. Tapping converts the entered value at full
   precision, displays the `0.1` rounded value, and saves the preference.
4. A blank input creates no result. Zero reps creates a completed result.
5. AMRAP shows a large `+` that calls `addAmrapRound`.
6. An aggregate-only container shows **Expand detail**, which renders draft rows
   labeled `Inferred`. Nothing saves until the user saves.
7. A saved child set shows **Detailed** when the score is `nonstandard`.
8. Last Time reads the latest completed session and ignores the active session.
9. Finish Workout offers `Return to workout` and `Finish as incomplete` when
   prescribed work is missing.
10. Back navigation flushes local edits and leaves the session `in_progress`.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 19.1, 19.2 | Depth styling for three levels plus the compact path label. |
| REQUIREMENTS 19.3–19.5 | `LastTimeBadge` with `No history` fallback and the history link. |
| REQUIREMENTS 19.6 | `UnitPill` updates the preference on tap. |
| REQUIREMENTS 19.7, 19.8 | `AmrapControls` with quick round add and partial rounds. |
| REQUIREMENTS 19.9 | `ValueInput` covers reps, weight, duration, distance, calories, effort, and extra attempts. |
| REQUIREMENTS 19.10 | `FinishWorkoutBar` at the end of the workout. |
| REQUIREMENTS 10.14–10.18 | `AggregateExpander` and the `Inferred` and `Detailed` labels. |
| REQUIREMENTS 11.2, 11.7 | Blank versus zero handling and the alternating split display. |
| REQUIREMENTS 11.11, 11.15 | Back navigation save and the Finish prompt. |
| REQUIREMENTS 12.4–12.7 | Pill conversion, display rounding, and stored precision. |
| REQUIREMENTS 16.3 | Compact back header, no tab bar. |
| ARCHITECTURE §13 | Native labeled inputs, no custom keyboard, no hover-only action. |

## Checklist

### Implementation

- [ ] Implement `buildActiveWorkoutModel` with one row per editable exercise
      occurrence and one group per container.
- [ ] Implement `ValueInput.svelte` with dimension-driven `inputmode` and unit pill.
- [ ] Implement `UnitPill.svelte` using `nextCompatibleUnit` and
      `preferences.setUnit`.
- [ ] Implement `LastTimeBadge.svelte` using `lookup.getLastTime`.
- [ ] Implement `ExerciseRow.svelte` with status control and the skip reason select.
- [ ] Implement `AmrapControls.svelte` with the large `+` and the partial-round field.
- [ ] Implement `EmomControls.svelte` with per-interval entry.
- [ ] Implement `ContainerScoreEditor.svelte` with the `Detailed` indicator for a
      `nonstandard` score.
- [ ] Implement `AggregateExpander.svelte` with the `Inferred` label on every draft
      value.
- [ ] Implement `FinishWorkoutBar.svelte` with Finish, Abandon, and the incomplete
      prompt.
- [ ] Implement `ActiveWorkoutScreen.svelte`: load, build the model, wire blur saves
      through `src/sync/debounce.ts`, and flush on route change.
- [ ] Render `DataError` inline for any unresolved row without dropping the rest of
      the tree.
- [ ] Keep the save-status indicator visible in the back header.

### Tests

- [ ] `tests/activeWorkoutModel.test.ts`: each row exposes one field per measurement
      dimension with the preferred unit.
- [ ] `tests/activeWorkoutModel.test.ts`: `lastTime` comes from the latest completed
      session and ignores the active session.
- [ ] `tests/activeWorkoutModel.test.ts`: an exercise with no completed result yields
      `lastTime.kind === 'none'`.
- [ ] `tests/activeWorkoutModel.test.ts`: a deep node carries the compact path label
      instead of a fourth nesting level.
- [ ] `tests/activeWorkoutModel.test.ts`: an unresolved row sets `unresolved` and
      keeps its stored values in the model.
- [ ] `tests/unit-pill.test.ts`: tapping the pill converts the displayed value to the
      nearest `0.1` and saves the preference.
- [ ] `tests/unit-pill.test.ts`: leaving the rounded value unchanged keeps the
      full-precision stored value.
- [ ] `tests/aggregate-expander.test.ts`: every draft row carries the `Inferred`
      label and no save occurs before the user saves.
- [ ] `tests/finish-bar.test.ts`: missing prescribed work produces both
      `Return to workout` and `Finish as incomplete` actions.

### Verification

- [ ] `bun test` passes.
- [ ] `bun run check` passes.
- [ ] `bun run build` passes.
- [ ] `bun run check:compat` passes.
- [ ] Manual in `bun run dev`: complete `strength-and-cindy` end to end, reload
      mid-workout, and confirm the session resumes with values intact.
- [ ] Physical Kindle: scroll a long workout and confirm no layout or input failure.

## Exit criteria

A user can execute and record a full workout on a Kindle, including AMRAP, EMOM,
complexes, unit toggling, and attempts.
