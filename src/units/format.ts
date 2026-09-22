// Display formatting for quantities and the alternating side split. Phase 13.
// REQUIREMENTS 11.5, 11.6, 11.7, 12.5. SPEC rep-jot-json-schema-spec §4.
//
// This module renders. It never converts and never decides which unit to use.
// The caller passes the quantity already in the unit the user picked, so the
// formatting path holds one rule: round the display, keep the stored value.
//
// Two jobs live here:
//   `formatQuantity`  one quantity as `220.5 lb`.
//   `formatAlternating`  one alternating set as `10 total / 5 each` or
//                     `9 total / 5 left / 4 right`.
//
// Both return text for a human. Nothing parses these strings back into a
// value; the stored `Quantity` stays the source of truth.

import type { StartingSide } from '../domain/enums';
import type { Quantity } from '../domain/types';
import { formatEditable } from './conversion';

/**
 * Compact display label per unit.
 *
 * The stored unit string is the machine name. This table is the short form
 * shown on a pill or a summary row, chosen to fit the narrow Kindle layout.
 * `second` becomes `s` and `minute` becomes `min`; the other units already
 * read as their own label.
 *
 * A `Map`, not an object literal. A bracket read on a plain object walks the
 * prototype chain, so `UNIT_LABELS['toString']` returns the inherited
 * function and the `?? unit` fallback never runs. `Map.get` returns
 * `undefined` for any key this table does not hold, so the fallback works for
 * every untrusted unit string, prototype-member names included.
 */
const UNIT_LABELS: ReadonlyMap<string, string> = new Map([
  ['reps', 'reps'],
  ['kg', 'kg'],
  ['lb', 'lb'],
  ['m', 'm'],
  ['km', 'km'],
  ['ft', 'ft'],
  ['mi', 'mi'],
  ['second', 's'],
  ['minute', 'min'],
  ['kcal', 'kcal']
]);

/**
 * The display label for a unit.
 *
 * An unknown unit falls back to the unit string itself, so a unit added to the
 * data before this table is updated still shows something readable instead of
 * a blank. The fallback also covers a unit that names an `Object.prototype`
 * member, which a plain-object lookup would render as native-code text.
 */
export function unitLabel(unit: string): string {
  const label = UNIT_LABELS.get(unit);
  return label === undefined ? unit : label;
}

/**
 * A quantity as rounded text with its unit label, such as `220.5 lb`.
 *
 * The number is the editable display value, rounded to the nearest `0.1`.
 * The stored quantity is untouched. REQUIREMENTS 12.5, 12.6.
 */
/** Format a minute value as `mm:ss`, rounded to the nearest second. */
export function formatMinuteValue(value: number): string {
  const totalSeconds = Math.round(value * 60);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export function formatQuantity(q: Quantity): string {
  const value = q.unit === 'minute' ? formatMinuteValue(q.value) : formatEditable(q);
  return `${value} ${unitLabel(q.unit)}`;
}

/**
 * The derived per-side split of one alternating set.
 *
 * An alternating result stores the total across both sides plus the side it
 * started on. REQUIREMENTS 11.6. The two sides differ by at most one rep, so
 * the starting side carries the extra rep when the total is odd.
 *
 * `left` and `right` are the counts for each side. `evenSplit` says whether
 * they are equal, which decides between `5 each` and `5 left / 4 right`.
 *
 * A negative or fractional total is not a rep count. It returns zero for both
 * sides rather than inventing a split.
 */
export function splitAlternating(
  total: number,
  startingSide: StartingSide
): { left: number; right: number; evenSplit: boolean } {
  if (!Number.isFinite(total) || !Number.isInteger(total) || total < 0) {
    return { left: 0, right: 0, evenSplit: true };
  }
  const base = Math.floor(total / 2);
  const extra = total - base * 2;
  const left = startingSide === 'left' ? base + extra : base;
  const right = startingSide === 'right' ? base + extra : base;
  return { left, right, evenSplit: extra === 0 };
}

/**
 * One alternating set as total and per-side text.
 *
 * REQUIREMENTS 11.7. An even total reads `10 total / 5 each`. An odd total
 * names both sides, `9 total / 5 left / 4 right`, with the extra rep on the
 * side the set started on.
 *
 * The starting side is named first, so the reading order follows the order
 * the work was done. A right-start set reads `5 right / 4 left`, not the
 * left-first form, because the starting side is the one fact the record
 * carries about the order.
 *
 * The total is shown first and unchanged, so the number the user recorded
 * stays visible even when the derived split is what fills the rest. That
 * promise holds on the invalid path too: a total `splitAlternating` will not
 * split still prints as the recorded total, never as the `0` the empty split
 * would add up to.
 */
export function formatAlternating(total: number, startingSide: StartingSide): string {
  const { left, right, evenSplit } = splitAlternating(total, startingSide);
  if (evenSplit) {
    return `${total} total / ${left} each`;
  }
  const startingCount = startingSide === 'left' ? left : right;
  const otherSide = startingSide === 'left' ? 'right' : 'left';
  const otherCount = startingSide === 'left' ? right : left;
  return `${total} total / ${startingCount} ${startingSide} / ${otherCount} ${otherSide}`;
}

/**
 * Show one number on a read-only line.
 *
 * `formatEditable` keeps one decimal because an editable field must show the
 * digit the user types into. A read-only line drops the trailing `.0`, so a
 * badge reads `225 lb` and not `225.0 lb`.
 */
export function formatStep(value: number, step: number): string {
  const text = formatEditable({ value, unit: '' }, step);
  return text.endsWith('.0') ? text.slice(0, -2) : text;
}

/**
 * The alternating text for one stored value, when the value carries reps.
 *
 * A convenience over `formatAlternating` for a caller holding a
 * `RepsQuantity` and a `startingSide`. A missing or unit-mismatched value
 * returns an empty string, so a screen renders nothing rather than `NaN`.
 */
export function formatAlternatingReps(
  reps: Quantity | undefined,
  startingSide: StartingSide | undefined
): string {
  if (reps === undefined || startingSide === undefined) return '';
  if (reps.unit !== 'reps') return '';
  return formatAlternating(reps.value, startingSide);
}
