// Unit conversion at full precision. Phase 13.
// REQUIREMENTS 12.5, 12.6, 12.7. SPEC rep-jot-json-schema-spec §4.
//
// One conversion path serves every screen. Each unit carries a factor to its
// family base unit, so a conversion is two multiplications through that base.
// There is no pairwise table, so adding a unit means adding one factor instead
// of one row per partner.
//
// `convert` never rounds. It returns the full double-precision result, because
// REQUIREMENTS 12.6 keeps the stored value at full precision and rounds only
// the editable display. A toggle that converts there and back therefore lands
// on the value it started from, within floating-point error, not within 0.1.
//
// `roundDisplay` is the only rounding rule in the app: nearest step, exact
// halves upward. It lives here so the input field, the pill, and the summary
// view all round the same way.

import { AppError } from '../domain/errors';
import type { MeasurementDimension } from '../domain/enums';
import type { Exercise, Quantity } from '../domain/types';

/**
 * Measurement dimension.
 *
 * The Phase 13 signatures name the type `Dimension`. It is the same set the
 * domain already defines, aliased here so callers import one name.
 */
export type Dimension = MeasurementDimension;

/** Default display step. REQUIREMENTS 12.5 fixes the editable display at 0.1. */
export const DEFAULT_DISPLAY_STEP = 0.1;

/**
 * One group of units that convert to each other.
 *
 * `baseUnit` is the unit the factors are measured against. `toBase` maps every
 * member unit to the number of base units it holds. Conversion goes base-in,
 * base-out: `value * factor(from) / factor(to)`.
 *
 * `toBase` is a `Map`, not an object literal. A bracket read against a plain
 * object walks the prototype chain, so a key like `toString` or `__proto__`
 * resolves to the inherited member and passes an `=== undefined` guard. A
 * `Map.get` sees only the keys this table actually holds.
 */
interface ConversionFamily {
  readonly baseUnit: string;
  readonly toBase: ReadonlyMap<string, number>;
}

/**
 * The factor table. SPEC §4 "Conversion table".
 *
 * `1 lb = 0.45359237 kg` is the exact international avoirdupois pound, so
 * the factor is exact and the rounding happens only in the display.
 *
 * `reps` and `kcal` are their own families with one member each. They convert
 * only to themselves, which is how "no conversion" is expressed without a
 * special case in `convert`.
 */
const FAMILIES: readonly ConversionFamily[] = [
  { baseUnit: 'kg', toBase: new Map([['kg', 1], ['lb', 0.45359237]]) },
  {
    baseUnit: 'm',
    toBase: new Map([
      ['m', 1],
      ['km', 1000],
      ['ft', 0.3048],
      ['mi', 1609.344]
    ])
  },
  { baseUnit: 'second', toBase: new Map([['second', 1], ['minute', 60]]) },
  { baseUnit: 'reps', toBase: new Map([['reps', 1]]) },
  { baseUnit: 'kcal', toBase: new Map([['kcal', 1]]) }
];

/**
 * Units each dimension accepts, independent of any exercise. SPEC §4 item 7.
 *
 * A `Map` for the same reason `toBase` is one: a dimension arriving from a
 * stored document is untrusted input, and `DIMENSION_UNITS['toString']` on an
 * object literal would hand back the inherited function.
 */
const DIMENSION_UNITS: ReadonlyMap<Dimension, readonly string[]> = new Map<
  Dimension,
  readonly string[]
>([
  ['reps', ['reps']],
  ['weight', ['kg', 'lb']],
  ['addedWeight', ['kg', 'lb']],
  ['assistedWeight', ['kg', 'lb']],
  ['distance', ['m', 'km', 'ft', 'mi']],
  ['duration', ['second', 'minute']],
  ['calories', ['kcal']]
]);

/** Fixed dimension order. Used for stable list rendering. */
export const DIMENSION_ORDER: readonly Dimension[] = [
  'reps',
  'weight',
  'addedWeight',
  'assistedWeight',
  'distance',
  'duration',
  'calories'
];

/** Unit to its family. Built once at module load. */
const FAMILY_BY_UNIT: Map<string, ConversionFamily> = (() => {
  const map = new Map<string, ConversionFamily>();
  for (const family of FAMILIES) {
    for (const unit of family.toBase.keys()) {
      map.set(unit, family);
    }
  }
  return map;
})();

/** True when `unit` is a unit this build knows how to convert. */
export function isKnownUnit(unit: string): boolean {
  return FAMILY_BY_UNIT.has(unit);
}

/**
 * True when `unit` is a legal unit for `dimension`.
 *
 * The check is against the global vocabulary, not against one exercise's
 * declared list. An exercise narrows the set further; see `unitsFor`.
 */
export function isCompatible(dimension: Dimension, unit: string): boolean {
  const units = DIMENSION_UNITS.get(dimension);
  return units !== undefined && units.indexOf(unit) >= 0;
}

/**
 * The units one exercise declares for one dimension.
 *
 * An empty array means the exercise does not measure that dimension, or the
 * exercise itself is missing. Both read the same way here: nothing to offer.
 */
export function unitsFor(exercise: Exercise | undefined, dimension: Dimension): string[] {
  if (exercise === undefined) return [];
  for (const support of exercise.measurements) {
    if (support.dimension === dimension) return [...support.compatibleUnits];
  }
  return [];
}

/**
 * Convert a quantity to another unit at full precision.
 *
 * The result keeps every digit the double can hold. Nothing here rounds, so
 * the caller decides what a human sees. REQUIREMENTS 12.5.
 *
 * @throws AppError `invalid_document` when either unit is unknown, or when the
 *         two units sit in different families and so cannot convert. A mismatch
 *         means a stored value or a static file disagrees with the vocabulary.
 */
export function convert(q: Quantity, targetUnit: string): Quantity {
  const from = FAMILY_BY_UNIT.get(q.unit);
  if (from === undefined) {
    throw new AppError(
      'invalid_document',
      { reason: 'unknown_unit', unit: q.unit },
      'This unit is not in the conversion vocabulary.'
    );
  }
  // The factor lookup goes through the Map, so a `targetUnit` that names an
  // `Object.prototype` member reads as missing and throws instead of
  // returning a `NaN` that would reach the editable field and a stored value.
  const toFactor = from.toBase.get(targetUnit);
  if (toFactor === undefined) {
    throw new AppError(
      'invalid_document',
      { reason: 'incompatible_unit', from: q.unit, to: targetUnit },
      'These two units are not convertible.'
    );
  }
  if (q.unit === targetUnit) {
    // Identity returns the value untouched. Routing it through the factors
    // would still be exact, and a copy keeps the caller's object safe.
    return { value: q.value, unit: targetUnit };
  }
  // `FAMILY_BY_UNIT` is built from these same tables, so the source unit is
  // always present here. The guard keeps the lookup total.
  const fromFactor = from.toBase.get(q.unit);
  if (fromFactor === undefined) {
    throw new AppError(
      'invalid_document',
      { reason: 'unknown_unit', unit: q.unit },
      'This unit is not in the conversion vocabulary.'
    );
  }
  const base = q.value * fromFactor;
  return { value: base / toFactor, unit: targetUnit };
}

/**
 * Decimal places a step implies. `0.1` gives 1, `0.25` gives 2, `1` gives 0.
 *
 * Read from the step's own decimal text, so the caller never passes a place
 * count that disagrees with the step it rounded with.
 */
function decimalsForStep(step: number): number {
  const text = String(step);
  const exponent = text.indexOf('e');
  const plain = exponent === -1 ? text : text.slice(0, exponent);
  const dot = plain.indexOf('.');
  return dot === -1 ? 0 : plain.length - dot - 1;
}

/**
 * Move a value's decimal point without binary multiplication error.
 *
 * `value * 10` on a double can turn an exact half into `23.499999999999996`,
 * and `Math.round` then sends it down instead of up. Shifting the decimal text
 * keeps the half a half, so the rounding decision is the one the spec asks for.
 */
function shiftDecimal(value: number, places: number): number {
  if (places === 0) return value;
  const [mantissa, exponent] = value.toExponential().split('e');
  return Number(`${mantissa}e${Number(exponent) + places}`);
}

/**
 * Round to the nearest step, with an exact half rounding toward positive
 * infinity.
 *
 * REQUIREMENTS 12.5 and SPEC §4. `Math.floor(ticks + 0.5)` sends an exact
 * half up the number line, so `-2.35` at one decimal becomes `-2.3`, not the
 * `-2.4` an away-from-zero rule would give. The two rules agree on every
 * non-negative value, and measurement values are non-negative, so no call in
 * this app can tell them apart. The domain is what makes the choice safe; the
 * rule itself is toward positive infinity.
 *
 * The work happens in whole ticks. A step of `0.1` is one tick at one decimal
 * place, and a step of `0.25` is 25 ticks at two, so the nearest-step choice
 * is an integer comparison. The result is rebuilt by one division, which lands
 * on the same double the decimal literal names.
 *
 * The decimal point is moved through the value's exponential text, never by
 * multiplying by 10. `2.35 * 10` is `23.499999999999996` on a double, and
 * rounding that sends the half down instead of up.
 *
 * `roundDisplay(2.35)` is `2.4`, not `2.3`. `roundDisplay(1 / 60)` is `0`,
 * which is the small-positive case SPEC §4 allows the display to show.
 */
export function roundDisplay(value: number, step: number = DEFAULT_DISPLAY_STEP): number {
  if (!(step > 0) || !Number.isFinite(step)) {
    throw new AppError(
      'invalid_document',
      { reason: 'bad_rounding_step' },
      'The rounding step must be a positive finite number.'
    );
  }
  if (!Number.isFinite(value)) return value;
  const decimals = decimalsForStep(step);
  const stepTicks = Math.round(shiftDecimal(step, decimals));
  if (stepTicks < 1) {
    throw new AppError(
      'invalid_document',
      { reason: 'bad_rounding_step' },
      'The rounding step is too small to resolve.'
    );
  }
  const ticks = shiftDecimal(value, decimals) / stepTicks;
  // Half toward positive infinity: the halfway point always crosses to the
  // higher tick on the number line.
  const roundedTicks = Math.floor(ticks + 0.5);
  return shiftDecimal(roundedTicks * stepTicks, -decimals);
}

/**
 * The rounded display string for a quantity, with no unit.
 *
 * Phase 17 puts this in the editable field and shows the unit beside it in
 * the pill, so the string carries the number only. `formatQuantity` in
 * `format.ts` adds the label.
 *
 * One second in minutes renders `0.0`. The stored value stays positive,
 * because this function reads it and never writes it back. SPEC §4.
 */
export function formatEditable(q: Quantity, step: number = DEFAULT_DISPLAY_STEP): string {
  const decimals = decimalsForStep(step);
  return roundDisplay(q.value, step).toFixed(decimals);
}

/**
 * The unit an exercise uses when the user has chosen none.
 *
 * The first `compatibleUnits` entry wins. Static data lists metric before
 * imperial, so the app defaults to metric. SPEC §4.
 *
 * Returns `undefined` when the exercise is absent or does not measure the
 * dimension. A caller that cannot resolve a unit has a broken reference and
 * shows the data-error path rather than inventing a unit.
 */
export function defaultUnit(exercise: Exercise | undefined, dimension: Dimension): string | undefined {
  const units = unitsFor(exercise, dimension);
  return units.length > 0 ? units[0] : undefined;
}

/**
 * The unit that follows `current` in the exercise's compatible list.
 *
 * The unit pill calls this on each tap, so the list cycles: the last entry
 * wraps to the first. A `current` the exercise does not list returns the
 * default, which puts the pill back on a legal unit instead of throwing at a
 * tap.
 *
 * Returns `undefined` when no unit can be resolved for that dimension.
 */
export function nextCompatibleUnit(
  exercise: Exercise | undefined,
  dimension: Dimension,
  current: string
): string | undefined {
  const units = unitsFor(exercise, dimension);
  if (units.length === 0) return undefined;
  const index = units.indexOf(current);
  if (index < 0) return units[0];
  return units[(index + 1) % units.length];
}
