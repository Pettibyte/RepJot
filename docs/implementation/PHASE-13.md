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
export type Dimension = MeasurementDimension;

export function isCompatible(dimension: Dimension, unit: string): boolean;
export function convert(q: Quantity, targetUnit: string): Quantity;  // full precision
export function roundDisplay(value: number, step?: number): number;  // step default 0.1, half rounds up
export function formatEditable(q: Quantity): string;                 // rounded number, no unit
export function defaultUnit(exercise: Exercise | undefined, dimension: Dimension): string | undefined;
export function nextCompatibleUnit(
  exercise: Exercise | undefined, dimension: Dimension, current: string): string | undefined;
```

```ts
// src/units/format.ts
export function unitLabel(unit: string): string;                     // compact token, `min`
export function formatQuantity(q: Quantity): string;                 // `220.5 lb`
export function splitAlternating(total: number, startingSide: StartingSide):
  { left: number; right: number; evenSplit: boolean };
export function formatAlternating(total: number, startingSide: StartingSide): string;
export function formatAlternatingReps(
  reps: Quantity | undefined, startingSide: StartingSide | undefined): string;
```

```ts
// src/preferences/preference-service.ts
export interface ExerciseUnitMapping {
  exerciseId: string; exerciseName: string;
  dimension: Dimension; unit: string;
}
export interface PreferenceService {
  getUnit(exerciseId: string, dimension: Dimension): string | undefined;
  setUnit(exerciseId: string, dimension: Dimension, unit: string): Promise<void>;
  listMappings(): ExerciseUnitMapping[];
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

### Resolved decisions

The builder raised six ambiguities. The user chose these, and the code follows them.

1. **Who stamps `revision` and `updatedAtUtc`.** The coordinator owns the stamp, in
   `bumpPreferences` on the upload candidate. `setUnit` writes the mapping only, so
   one toggle advances the counter once, not twice.
2. **Unit labels.** Compact tokens: `kg`, `lb`, `m`, `km`, `ft`, `mi`, `s`, `min`,
   `kcal`, `reps`. Ninety seconds renders `1.5 min`.
3. **`formatEditable` shape.** Number only, `220.5`. `formatQuantity` in `format.ts`
   adds the label, `220.5 lb`. This matches the Phase 17 `FieldModel`, which keeps
   `value` and `unit` as separate fields.
4. **Missing exercise or dimension.** `getUnit` and `defaultUnit` return
   `string | undefined` instead of a string. A screen that cannot resolve a unit has
   a broken reference and shows the data-error path rather than an invented unit.
   This widens the signature above.
5. **Alternating split input.** `formatAlternating(total, startingSide)`. The split
   is derived: an even total splits evenly, an odd total gives the extra rep to the
   starting side, which is the side named first.
6. **`listMappings` order.** Exercise name A-Z, then the fixed dimension order in
   `DIMENSION_ORDER`. Never the keyed-map key order.

### Implementation

- [x] Create `src/units/conversion.ts` with the factor table and base-in, base-out
      `convert`.
- [x] Implement `roundDisplay` with half-up rounding at the `0.1` step.
- [x] Implement `defaultUnit` returning the first `compatibleUnits` entry.
- [x] Implement `nextCompatibleUnit` cycling the compatible list.
- [x] Create `src/units/format.ts` with quantity formatting and the alternating
      total-and-per-side rendering.
- [x] Create `src/preferences/preference-service.ts` with the coordinator-backed
      `getUnit` and `setUnit`.
- [x] In `setUnit`, reject a unit incompatible with the exercise and dimension. Throw
      `AppError('invalid_document')`.
- [x] Stamp `revision` and `updatedAtUtc` on the final candidate only. The
      coordinator's `bumpPreferences` does this, so `setUnit` does not stamp again.
      See decision 1.
- [x] Keep `revision` informational. Add a comment that it never selects a migration
      and never resolves a conflict.
- [x] Do not rewrite saved historical results when a preference changes.
- [x] Read every unit, dimension, and exercise-ID table through a `Map` or an
      own-property check. A bracket read on a plain object walks the prototype
      chain, so a key like `toString` or `__proto__` passes an `=== undefined`
      guard and the inherited member is used as data.
- [x] In `setUnit`, build the `exerciseUnits` map through a `Map` and serialize
      with `Object.fromEntries`. A direct `map[exerciseId] =` write of the ID
      `__proto__` sets the object's prototype, so the mapping serializes away:
      accepted, never stored, no error raised.
- [x] `formatAlternating` prints the total the caller passed, including on the
      path where `splitAlternating` refuses to split. Printing `left + right`
      showed `0 total` and dropped the recorded number.
- [x] `roundDisplay` documents its rule as toward positive infinity. The value
      domain is non-negative, which is what makes that and away-from-zero agree.
- [x] Add `scripts/check-units-compat.ts`. It builds the three new modules at
      `target: 'es2019'`, minified, and parses each with acorn `ecmaVersion:
      2019`. Nothing imports these modules into `dist/app.js` yet, so
      `check-browser-compat.ts` cannot see them. Wired into `check:compat`.

### Tests

- [x] `tests/conversion.test.ts`: 100 kg converts to about 220.462 lb and
      `formatEditable` returns `220.5`.
- [x] `tests/conversion.test.ts`: 5 km displays `3.1 mi`.
- [x] `tests/conversion.test.ts`: 90 seconds displays `1.5 minute`. The label is
      `min`, so the rendered string is `1.5 min`.
- [x] `tests/conversion.test.ts`: 1 second in minutes displays `0.0` and the stored
      value stays positive.
- [x] `tests/conversion.test.ts`: `roundDisplay` rounds an exact half upward.
- [x] `tests/conversion.test.ts`: `convert` is identity for `reps` and `kcal`.
- [x] `tests/conversion.test.ts`: converting to an incompatible unit throws.
- [x] `tests/conversion.test.ts`: round-trip kg to lb to kg stays within full
      floating-point precision, not within `0.1`.
- [x] `tests/preference-service.test.ts`: with no saved preference, `getUnit` returns
      the first `compatibleUnits` entry.
- [x] `tests/preference-service.test.ts`: `setUnit` writes the mapping and leaves
      other mappings untouched.
- [x] `tests/preference-service.test.ts`: `setUnit` with an incompatible unit throws
      and writes nothing.
- [x] `tests/preference-service.test.ts`: `listMappings` returns one row per stored
      mapping with the exercise name resolved.
- [x] `tests/preference-service.test.ts`: a preference change does not modify any
      stored result.
- [x] `tests/format.test.ts`: unit labels, `formatQuantity`, and the alternating
      split for every total from 0 through 30.

### Verification

- [x] `bun test` passes. 803 pass, 0 fail.
- [x] `bun run check` passes. 0 errors, 0 warnings.
- [x] `bun run build` passes.
- [x] `bun run check:compat` passes. It now runs `check-units-compat.ts`, so
      the ES2019 claim for the new modules is gated, not just asserted.
- [x] `.agent-work/phase-13/repro-1-prototype-chain-unit.ts` prints `PASS` and
      exits 0. Before the fix it reported 15 failures.

## Exit criteria

One conversion path and one preference path exist. The pill toggle in Phase 17 and
the Settings list in Phase 19 both call them.
