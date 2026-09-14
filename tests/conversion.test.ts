// Unit conversion, the 0.1 display rule, and the exercise default unit.
// Phase 13. REQUIREMENTS 12.4, 12.5, 12.6, 12.7. SPEC rep-jot-json-schema-spec §4.

import { describe, expect, test } from 'bun:test';
import { AppError } from '../src/domain/errors';
import type { Exercise, Quantity } from '../src/domain/types';
import {
  convert,
  defaultUnit,
  formatEditable,
  isCompatible,
  isKnownUnit,
  nextCompatibleUnit,
  roundDisplay,
  unitsFor
} from '../src/units/conversion';
import { exercises } from './fixtures/semantic';

/** The fixture exercise list, indexed the way the app indexes it. */
const byId = new Map(exercises().map((exercise) => [exercise.id, exercise]));
const backSquat = byId.get('back-squat') as Exercise;
const row = byId.get('row') as Exercise;

/** Read the `AppError` kind a call threw, or `null` when it did not throw. */
function kindOf(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof AppError ? error.kind : 'non-app-error';
  }
}

describe('the rounding rule', () => {
  test('an exact half rounds upward', () => {
    expect(roundDisplay(2.35)).toBe(2.4);
    expect(roundDisplay(0.25)).toBe(0.3);
    expect(roundDisplay(1.15)).toBe(1.2);
  });

  test('a value below the half rounds down', () => {
    expect(roundDisplay(2.34)).toBe(2.3);
    expect(roundDisplay(0.24)).toBe(0.2);
  });

  test('a value above the half rounds up', () => {
    expect(roundDisplay(2.36)).toBe(2.4);
  });

  test('an exact step value is unchanged', () => {
    expect(roundDisplay(2.3)).toBe(2.3);
    expect(roundDisplay(0)).toBe(0);
  });

  test('a caller-supplied step rounds to that step', () => {
    expect(roundDisplay(2.34, 0.25)).toBe(2.25);
    expect(roundDisplay(2.4, 0.5)).toBe(2.5);
    expect(roundDisplay(7, 5)).toBe(5);
  });

  test('a zero or negative step is refused', () => {
    expect(kindOf(() => roundDisplay(1, 0))).toBe('invalid_document');
    expect(kindOf(() => roundDisplay(1, -0.1))).toBe('invalid_document');
  });

  test('an exact half rounds toward positive infinity, not away from zero', () => {
    // Pins the rule the comment now states. An away-from-zero rule would give
    // -2.4 for -2.35 and -2.3 for -2.25. The domain of measurement values is
    // non-negative, which is what makes the two agree in practice.
    expect(roundDisplay(-2.35)).toBe(-2.3);
    expect(roundDisplay(-2.25)).toBe(-2.2);
    expect(roundDisplay(-0.25)).toBe(-0.2);
  });
});

describe('weight conversion', () => {
  test('100 kg converts to about 220.462 lb and displays 220.5', () => {
    const converted = convert({ value: 100, unit: 'kg' }, 'lb');
    expect(converted.unit).toBe('lb');
    expect(converted.value).toBeCloseTo(220.46226218487757, 9);
    expect(formatEditable(converted)).toBe('220.5');
  });

  test('the stored value keeps the full precision the display drops', () => {
    const converted = convert({ value: 100, unit: 'kg' }, 'lb');
    // The display shows one decimal. The value behind it holds many more, so
    // REQUIREMENTS 12.6 does not lose digits at the display boundary.
    expect(formatEditable(converted)).toBe('220.5');
    expect(converted.value).not.toBe(220.5);
    expect(converted.value.toPrecision(12)).toBe('220.462262185');
  });

  test('one pound is exactly 0.45359237 kg', () => {
    expect(convert({ value: 1, unit: 'lb' }, 'kg').value).toBe(0.45359237);
  });
});

describe('distance and duration conversion', () => {
  test('5 km displays 3.1 mi', () => {
    const converted = convert({ value: 5, unit: 'km' }, 'mi');
    expect(converted.unit).toBe('mi');
    expect(formatEditable(converted)).toBe('3.1');
  });

  test('90 seconds displays 1.5 minute', () => {
    const converted = convert({ value: 90, unit: 'second' }, 'minute');
    expect(converted.value).toBe(1.5);
    expect(formatEditable(converted)).toBe('1.5');
  });

  test('1 second in minutes displays 0.0 and the stored value stays positive', () => {
    const stored: Quantity = { value: 1, unit: 'second' };
    const converted = convert(stored, 'minute');
    expect(formatEditable(converted)).toBe('0.0');
    // The rounded display is zero. The value is not, and the source object
    // is untouched, so nothing here can zero a recorded duration.
    expect(converted.value).toBeGreaterThan(0);
    expect(converted.value).toBeCloseTo(1 / 60, 12);
    expect(stored).toEqual({ value: 1, unit: 'second' });
  });

  test('feet and metres use the exact 0.3048 factor', () => {
    expect(convert({ value: 1, unit: 'ft' }, 'm').value).toBe(0.3048);
    expect(convert({ value: 1, unit: 'mi' }, 'm').value).toBe(1609.344);
  });
});

describe('no-conversion dimensions', () => {
  test('convert is identity for reps and kcal', () => {
    expect(convert({ value: 12, unit: 'reps' }, 'reps')).toEqual({ value: 12, unit: 'reps' });
    expect(convert({ value: 340, unit: 'kcal' }, 'kcal')).toEqual({
      value: 340,
      unit: 'kcal'
    });
  });

  test('reps and kcal never convert to another family', () => {
    expect(kindOf(() => convert({ value: 12, unit: 'reps' }, 'kg'))).toBe('invalid_document');
    expect(kindOf(() => convert({ value: 1, unit: 'kcal' }, 'minute'))).toBe('invalid_document');
  });

  test('the identity copy does not alias the argument', () => {
    const source: Quantity = { value: 5, unit: 'reps' };
    const result = convert(source, 'reps');
    result.value = 9;
    expect(source.value).toBe(5);
  });
});

describe('incompatible units', () => {
  test('converting across families throws invalid_document', () => {
    expect(kindOf(() => convert({ value: 10, unit: 'kg' }, 'm'))).toBe('invalid_document');
    expect(kindOf(() => convert({ value: 10, unit: 'mi' }, 'lb'))).toBe('invalid_document');
    expect(kindOf(() => convert({ value: 10, unit: 'minute' }, 'km'))).toBe('invalid_document');
  });

  test('an unknown unit throws invalid_document', () => {
    expect(kindOf(() => convert({ value: 1, unit: 'stone' }, 'kg'))).toBe('invalid_document');
    expect(kindOf(() => convert({ value: 1, unit: 'kg' }, 'stone'))).toBe('invalid_document');
  });

  test('the thrown error names the units and carries no value', () => {
    try {
      convert({ value: 10, unit: 'kg' }, 'm');
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const detail = (error as AppError).detail;
      expect(detail.from).toBe('kg');
      expect(detail.to).toBe('m');
      // A measurement is not error context. SPEC 15.6 keeps values out of errors.
      expect(detail.value).toBeUndefined();
    }
  });
});

describe('full-precision round trip', () => {
  test('kg to lb to kg stays within floating-point precision, not within 0.1', () => {
    const original = 100;
    const there = convert({ value: original, unit: 'kg' }, 'lb');
    const back = convert(there, 'kg');
    const drift = Math.abs(back.value - original);
    // Full floating-point precision, so the drift is far below one ulp of a
    // 0.1 display step rather than of the rounding size itself.
    expect(drift).toBeLessThan(1e-9);
    expect(drift).toBeLessThan(Number.EPSILON * 1000);
  });

  test('a repeated toggle does not accumulate drift', () => {
    let q: Quantity = { value: 100, unit: 'kg' };
    for (let i = 0; i < 50; i += 1) {
      q = convert(q, q.unit === 'kg' ? 'lb' : 'kg');
    }
    expect(Math.abs(q.value - 100)).toBeLessThan(1e-9);
  });

  test('rounding the display each hop would drift, which is what this design avoids', () => {
    // The contrast case for REQUIREMENTS 12.6. Rounding at every hop moves
    // 2.25 kg to 2.3 kg and parks it there, so the app rounds only the
    // editable display and never the value that gets stored.
    let rounded = 2.25;
    for (let i = 0; i < 4; i += 1) {
      const inLb = roundDisplay(convert({ value: rounded, unit: 'kg' }, 'lb').value);
      rounded = roundDisplay(convert({ value: inLb, unit: 'lb' }, 'kg').value);
    }
    expect(Math.abs(rounded - 2.25)).toBeGreaterThan(0.01);
  });
});

describe('isCompatible and isKnownUnit', () => {
  test('each dimension accepts its own units only', () => {
    expect(isCompatible('weight', 'kg')).toBe(true);
    expect(isCompatible('weight', 'lb')).toBe(true);
    expect(isCompatible('weight', 'm')).toBe(false);
    expect(isCompatible('addedWeight', 'lb')).toBe(true);
    expect(isCompatible('assistedWeight', 'kg')).toBe(true);
    expect(isCompatible('distance', 'ft')).toBe(true);
    expect(isCompatible('distance', 'mi')).toBe(true);
    expect(isCompatible('duration', 'second')).toBe(true);
    expect(isCompatible('duration', 'minute')).toBe(true);
    expect(isCompatible('reps', 'reps')).toBe(true);
    expect(isCompatible('calories', 'kcal')).toBe(true);
    expect(isCompatible('calories', 'kg')).toBe(false);
  });

  test('an unknown dimension or unit is not compatible', () => {
    expect(isCompatible('speed' as never, 'kg')).toBe(false);
    expect(isCompatible('weight', 'stone')).toBe(false);
  });

  test('isKnownUnit covers the whole vocabulary', () => {
    for (const unit of ['kg', 'lb', 'm', 'km', 'ft', 'mi', 'second', 'minute', 'reps', 'kcal']) {
      expect(isKnownUnit(unit)).toBe(true);
    }
    expect(isKnownUnit('furlong')).toBe(false);
  });
});

describe('prototype-chain keys are unknown, never inherited data', () => {
  // A unit or dimension arriving from a stored document is untrusted input.
  // A table read that walks `Object.prototype` hands back the inherited member
  // instead of `undefined`, so the unknown-unit guard behind it never fires.
  // Every table here is a `Map`, so these keys read as missing.
  const PROTO_KEYS = [
    'toString',
    'valueOf',
    'constructor',
    'hasOwnProperty',
    'isPrototypeOf',
    'propertyIsEnumerable',
    'toLocaleString',
    '__proto__'
  ];

  test('isCompatible is false for a prototype-key dimension', () => {
    for (const key of PROTO_KEYS) {
      expect(isCompatible(key as never, 'kg')).toBe(false);
    }
  });

  test('isCompatible is false for a prototype-key unit', () => {
    for (const key of PROTO_KEYS) {
      expect(isCompatible('weight', key)).toBe(false);
      expect(isCompatible('distance', key)).toBe(false);
      expect(isCompatible('reps', key)).toBe(false);
    }
  });

  test('isKnownUnit is false for a prototype-key unit', () => {
    for (const key of PROTO_KEYS) {
      expect(isKnownUnit(key)).toBe(false);
    }
  });

  test('convert throws rather than returning a NaN for a prototype-key target', () => {
    // The NaN is the dangerous half: `convert` feeds the Phase 17 editable
    // field, so a NaN that clears the guard becomes a stored result value.
    for (const key of PROTO_KEYS) {
      expect(kindOf(() => convert({ value: 100, unit: 'kg' }, key))).toBe('invalid_document');
    }
  });

  test('convert throws for a prototype-key source unit', () => {
    for (const key of PROTO_KEYS) {
      expect(kindOf(() => convert({ value: 100, unit: key }, 'kg'))).toBe('invalid_document');
    }
  });

  test('the thrown error still names the prototype-key units', () => {
    try {
      convert({ value: 100, unit: 'kg' }, '__proto__');
      throw new Error('expected a throw');
    } catch (error) {
      const detail = (error as AppError).detail;
      expect(detail.reason).toBe('incompatible_unit');
      expect(detail.from).toBe('kg');
      expect(detail.to).toBe('__proto__');
    }
  });

  test('a real unit still converts after the prototype keys are exercised', () => {
    // Guards that reject everything are worthless. The vocabulary still works.
    expect(convert({ value: 1, unit: 'lb' }, 'kg').value).toBe(0.45359237);
    expect(isCompatible('weight', 'kg')).toBe(true);
    expect(isKnownUnit('kcal')).toBe(true);
  });
});

describe('defaultUnit and nextCompatibleUnit', () => {
  test('the default is the first compatibleUnits entry', () => {
    expect(defaultUnit(backSquat, 'weight')).toBe('lb');
    expect(defaultUnit(row, 'distance')).toBe('m');
    expect(defaultUnit(row, 'duration')).toBe('second');
  });

  test('a missing exercise or dimension has no default', () => {
    expect(defaultUnit(undefined, 'weight')).toBeUndefined();
    expect(defaultUnit(backSquat, 'distance')).toBeUndefined();
  });

  test('nextCompatibleUnit cycles the list and wraps to the first', () => {
    expect(nextCompatibleUnit(backSquat, 'weight', 'lb')).toBe('kg');
    expect(nextCompatibleUnit(backSquat, 'weight', 'kg')).toBe('lb');
  });

  test('a four-unit list cycles through all four', () => {
    const wide: Exercise = {
      ...backSquat,
      measurements: [{ dimension: 'distance', compatibleUnits: ['m', 'km', 'ft', 'mi'] }]
    };
    expect(nextCompatibleUnit(wide, 'distance', 'm')).toBe('km');
    expect(nextCompatibleUnit(wide, 'distance', 'km')).toBe('ft');
    expect(nextCompatibleUnit(wide, 'distance', 'ft')).toBe('mi');
    expect(nextCompatibleUnit(wide, 'distance', 'mi')).toBe('m');
  });

  test('a current unit the exercise does not list resets to the default', () => {
    expect(nextCompatibleUnit(backSquat, 'weight', 'stone')).toBe('lb');
  });

  test('a single-unit list never moves off that unit', () => {
    expect(nextCompatibleUnit(byId.get('kb-press') as Exercise, 'weight', 'kg')).toBe('kg');
    expect(nextCompatibleUnit(byId.get('jump-rope') as Exercise, 'reps', 'reps')).toBe('reps');
  });

  test('a dimension the exercise lacks has no next unit', () => {
    expect(nextCompatibleUnit(backSquat, 'calories', 'kcal')).toBeUndefined();
    expect(nextCompatibleUnit(undefined, 'weight', 'kg')).toBeUndefined();
  });

  test('unitsFor copies the list so a caller cannot mutate the exercise', () => {
    const units = unitsFor(backSquat, 'weight');
    units.push('stone');
    expect(unitsFor(backSquat, 'weight')).toEqual(['lb', 'kg']);
  });
});
