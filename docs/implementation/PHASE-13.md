# Phase 13 — Unit conversion and preferences

Implement full-precision conversion, the `0.1` display rounding rule, and the
per-exercise unit preference that the Active Workout pill and the Settings screen
both use.

## Prerequisites

- Phase 02 for `Quantity` and the domain types.
- Phase 10 for the coordinator that persists preference edits.
- Phase 12 for exercise lookups.

## Goals

1. Convert between compatible units at full precision.
2. Round only the editable display, never the stored value.
3. Default to the first `compatibleUnits` entry when no preference exists.
4. Provide the preference read and write API with compatibility checks.

## Interfaces

### Files

| Path | Purpose |
| --- | --- |
| `src/units/conversion.ts` | Conversion factors, conversion, and display rounding. |
| `src/units/format.ts` | Display formatting for a quantity, including the alternating split. |
| `src/preferences/preference-service.ts` | Preference read and write through the coordinator. |

### Signatures

```ts
// src/units/conversion.ts
export function isCompatible(dimension: Dimension, unit: string): boolean;
export function convert(q: Quantity, targetUnit: string): Quantity;  // full precision
export function roundDisplay(value: number, step?: number): number;  // step default 0.1, half rounds up
export function formatEditable(q: Quantity): string;                 // rounded display string
export function defaultUnit(exercise: Exercise, dimension: Dimension): string;
export function nextCompatibleUnit(
  exercise: Exercise, dimension: Dimension, current: string): string;
```

```ts
// src/preferences/preference-service.ts
export interface PreferenceService {
  getUnit(exerciseId: string, dimension: Dimension): string;
  setUnit(exerciseId: string, dimension: Dimension, unit: string): Promise<void>;
  listMappings(): Array<{ exerciseId: string; exerciseName: string;
                        dimension: Dimension; unit: string }>;
  ensureDoc(): Promise<PreferencesDoc>;
}
export function createPreferenceService(deps: {
  coordinator: Coordinator;
  staticData: LoadedStaticData;
}): PreferenceService;
```

### Conversion table

| Dimension | Units | Factor to base |
| --- | --- | --- |
| `weight`, `addedWeight`, `assistedWeight` | `kg`, `lb` | base `kg`; `1 lb = 0.45359237 kg` |
| `distance` | `m`, `km`, `ft`, `mi` | base `m`; `1 ft = 0.3048 m`, `1 mi = 1609.344 m` |
| `duration` | `second`, `minute` | base `second` |
| `reps`, `calories` | `reps`, `kcal` | no conversion |

Conversion goes base-in, base-out. No pairwise factor table.

## Requirements traceability

| Source | How this phase satisfies it |
| --- | --- |
| REQUIREMENTS 12.2, 12.3 | `getUnit` and `listMappings` serve the Settings exercise-unit list. |
| REQUIREMENTS 12.4 | `nextCompatibleUnit` supports the pill toggle. |
| REQUIREMENTS 12.5 | `convert` keeps full precision. `roundDisplay` rounds the editable display to the nearest `0.1`. |
| REQUIREMENTS 12.6 | The stored value changes only when the user edits the displayed number. |
| REQUIREMENTS 12.7 | Saved results keep their explicit value and unit until edited. |
| REQUIREMENTS 12.8, 12.9 | The keyed preference map merges by mapping. Local wins on conflict, handled by the Phase 09 merge. |
| REQUIREMENTS 11.5–11.7 | `format.ts` renders the alternating split, such as `9 total / 5 left / 4 right`. |
| SPEC rep-jot-json-schema-spec §4 | Default unit is the first `compatibleUnits` entry. Metric precedes imperial in static data. |
| SPEC rep-jot-json-schema-spec §4 rounding examples | 100 kg displays `220.5 lb`, 5 km displays `3.1 mi`, 90 s displays `1.5 min`, 1 s in minutes displays `0.0` and stays positive. |

## Checklist

### Implementation

- [ ] Create `src/units/conversion.ts` with the factor table and base-in, base-out
      `convert`.
- [ ] Implement `roundDisplay` with half-up rounding at the `0.1` step.
- [ ] Implement `defaultUnit` returning the first `compatibleUnits` entry.
- [ ] Implement `nextCompatibleUnit` cycling the compatible list.
- [ ] Create `src/units/format.ts` with quantity formatting and the alternating
      total-and-per-side rendering.
- [ ] Create `src/preferences/preference-service.ts` with the coordinator-backed
      `getUnit` and `setUnit`.
- [ ] In `setUnit`, reject a unit incompatible with the exercise and dimension. Throw
      `AppError('invalid_document')`.
- [ ] In `setUnit`, increment `revision` and set `updatedAtUtc` on the final
      candidate only.
- [ ] Keep `revision` informational. Add a comment that it never selects a migration
      and never resolves a conflict.
- [ ] Do not rewrite saved historical results when a preference changes.

### Tests

- [ ] `tests/conversion.test.ts`: 100 kg converts to about 220.462 lb and
      `formatEditable` returns `220.5`.
- [ ] `tests/conversion.test.ts`: 5 km displays `3.1 mi`.
- [ ] `tests/conversion.test.ts`: 90 seconds displays `1.5 minute`.
- [ ] `tests/conversion.test.ts`: 1 second in minutes displays `0.0` and the stored
      value stays positive.
- [ ] `tests/conversion.test.ts`: `roundDisplay` rounds an exact half upward.
- [ ] `tests/conversion.test.ts`: `convert` is identity for `reps` and `kcal`.
- [ ] `tests/conversion.test.ts`: converting to an incompatible unit throws.
- [ ] `tests/conversion.test.ts`: round-trip kg to lb to kg stays within full
      floating-point precision, not within `0.1`.
- [ ] `tests/preference-service.test.ts`: with no saved preference, `getUnit` returns
      the first `compatibleUnits` entry.
- [ ] `tests/preference-service.test.ts`: `setUnit` writes the mapping and leaves
      other mappings untouched.
- [ ] `tests/preference-service.test.ts`: `setUnit` with an incompatible unit throws
      and writes nothing.
- [ ] `tests/preference-service.test.ts`: `listMappings` returns one row per stored
      mapping with the exercise name resolved.
- [ ] `tests/preference-service.test.ts`: a preference change does not modify any
      stored result.

### Verification

- [ ] `bun test` passes.
- [ ] `bun run check` passes.
- [ ] `bun run build` passes.
- [ ] `bun run check:compat` passes.

## Exit criteria

One conversion path and one preference path exist. The pill toggle in Phase 17 and
the Settings list in Phase 19 both call them.
