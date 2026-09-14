// Display formatting: quantity labels and the alternating side split.
// Phase 13. REQUIREMENTS 11.5, 11.6, 11.7, 12.5.

import { describe, expect, test } from 'bun:test';
import type { Quantity } from '../src/domain/types';
import {
  formatAlternating,
  formatAlternatingReps,
  formatQuantity,
  splitAlternating,
  unitLabel
} from '../src/units/format';

describe('unitLabel', () => {
  test('every vocabulary unit has a compact label', () => {
    expect(unitLabel('kg')).toBe('kg');
    expect(unitLabel('lb')).toBe('lb');
    expect(unitLabel('m')).toBe('m');
    expect(unitLabel('km')).toBe('km');
    expect(unitLabel('ft')).toBe('ft');
    expect(unitLabel('mi')).toBe('mi');
    expect(unitLabel('second')).toBe('s');
    expect(unitLabel('minute')).toBe('min');
    expect(unitLabel('kcal')).toBe('kcal');
    expect(unitLabel('reps')).toBe('reps');
  });

  test('an unknown unit falls back to its own text', () => {
    expect(unitLabel('stone')).toBe('stone');
  });

  test('a prototype-key unit falls back to its own text, not the inherited member', () => {
    // `UNIT_LABELS[unit] ?? unit` on a plain object returns the inherited
    // function for these keys, which renders as native-code text on screen.
    for (const key of ['toString', 'valueOf', 'constructor', 'hasOwnProperty', '__proto__']) {
      expect(unitLabel(key)).toBe(key);
    }
  });

  test('formatQuantity never renders a prototype member', () => {
    expect(formatQuantity({ value: 1, unit: 'toString' })).toBe('1.0 toString');
    expect(formatQuantity({ value: 1, unit: '__proto__' })).toBe('1.0 __proto__');
  });
});

describe('formatQuantity', () => {
  test('renders the rounded value with the unit label', () => {
    expect(formatQuantity({ value: 220.46226218487757, unit: 'lb' })).toBe('220.5 lb');
    expect(formatQuantity({ value: 3.1068559675852835, unit: 'mi' })).toBe('3.1 mi');
    expect(formatQuantity({ value: 1.5, unit: 'minute' })).toBe('1.5 min');
    expect(formatQuantity({ value: 45, unit: 'second' })).toBe('45.0 s');
    expect(formatQuantity({ value: 12, unit: 'reps' })).toBe('12.0 reps');
  });

  test('a small positive conversion renders 0.0 without changing the value', () => {
    const oneSecondInMinutes: Quantity = { value: 1 / 60, unit: 'minute' };
    expect(formatQuantity(oneSecondInMinutes)).toBe('0.0 min');
    expect(oneSecondInMinutes.value).toBeGreaterThan(0);
  });
});

describe('splitAlternating', () => {
  test('an even total splits evenly', () => {
    expect(splitAlternating(10, 'left')).toEqual({ left: 5, right: 5, evenSplit: true });
    expect(splitAlternating(10, 'right')).toEqual({ left: 5, right: 5, evenSplit: true });
    expect(splitAlternating(0, 'left')).toEqual({ left: 0, right: 0, evenSplit: true });
  });

  test('an odd total gives the extra rep to the starting side', () => {
    expect(splitAlternating(9, 'left')).toEqual({ left: 5, right: 4, evenSplit: false });
    expect(splitAlternating(9, 'right')).toEqual({ left: 4, right: 5, evenSplit: false });
    expect(splitAlternating(1, 'right')).toEqual({ left: 0, right: 1, evenSplit: false });
  });

  test('both sides always add back to the total', () => {
    for (let total = 0; total <= 30; total += 1) {
      for (const side of ['left', 'right'] as const) {
        const split = splitAlternating(total, side);
        expect(split.left + split.right).toBe(total);
      }
    }
  });

  test('a fractional or negative total yields no split', () => {
    expect(splitAlternating(9.5, 'left')).toEqual({ left: 0, right: 0, evenSplit: true });
    expect(splitAlternating(-2, 'left')).toEqual({ left: 0, right: 0, evenSplit: true });
    expect(splitAlternating(Number.NaN, 'left')).toEqual({ left: 0, right: 0, evenSplit: true });
  });
});

describe('formatAlternating', () => {
  test('an even total reads as each', () => {
    expect(formatAlternating(10, 'left')).toBe('10 total / 5 each');
    expect(formatAlternating(8, 'right')).toBe('8 total / 4 each');
  });

  test('an odd total names both sides', () => {
    expect(formatAlternating(9, 'left')).toBe('9 total / 5 left / 4 right');
    expect(formatAlternating(9, 'right')).toBe('9 total / 5 right / 4 left');
  });

  test('the total shown first is the total recorded', () => {
    for (let total = 0; total <= 20; total += 1) {
      const text = formatAlternating(total, 'left');
      expect(text.startsWith(`${total} total /`)).toBe(true);
    }
  });

  test('a total that will not split still prints as the recorded total', () => {
    // The docstring promises the recorded number stays visible. On the
    // invalid path the derived split is zero, so printing `left + right`
    // showed `0 total` and dropped what the user recorded.
    expect(formatAlternating(9.5, 'left')).toBe('9.5 total / 0 each');
    expect(formatAlternating(-2, 'right')).toBe('-2 total / 0 each');
    expect(formatAlternatingReps({ value: 9.5, unit: 'reps' }, 'left')).toBe(
      '9.5 total / 0 each'
    );
  });
});

describe('formatAlternatingReps', () => {
  test('renders a reps quantity with its starting side', () => {
    expect(formatAlternatingReps({ value: 9, unit: 'reps' }, 'left')).toBe(
      '9 total / 5 left / 4 right'
    );
    expect(formatAlternatingReps({ value: 10, unit: 'reps' }, 'right')).toBe('10 total / 5 each');
  });

  test('a missing value or starting side renders nothing', () => {
    expect(formatAlternatingReps(undefined, 'left')).toBe('');
    expect(formatAlternatingReps({ value: 9, unit: 'reps' }, undefined)).toBe('');
  });

  test('a non-reps quantity renders nothing rather than a wrong label', () => {
    expect(formatAlternatingReps({ value: 9, unit: 'kg' }, 'left')).toBe('');
  });
});
