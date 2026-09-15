// The History screens' month and shard-name arithmetic.
// Phase 18. REQUIREMENTS 3.3, 3.4, 20.1, 20.4.
//
// A result shard is one month of sessions, named `results-YYYY-MM.json`.
// Reading history backwards means naming the month before a month, so both
// History screens need the same arithmetic. The month label is one-based:
// `01` is January and `12` is December.
//
// Both screens used to carry their own copy of this arithmetic, and both
// copies were wrong the same way. They subtracted one to reach a zero-based
// index, then added one back when they formatted, so the two adjustments
// cancelled and the function returned the month it was given. Keeping one
// copy here means one place to be right.

import { shardName } from '../../domain/time';

/** A `YYYY-MM` month label. */
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

/**
 * The `YYYY-MM` one calendar month before the given month.
 *
 * The month is one-based, so one is subtracted once. `2026-03` gives
 * `2026-02`. January wraps to December of the year before, so `2026-01`
 * gives `2025-12`. A label that is not `YYYY-MM` comes back unchanged, so a
 * caller walking months stops rather than wandering.
 */
export function previousMonth(month: string): string {
  const parts = MONTH_PATTERN.exec(month);
  if (parts === null) return month;
  const year = Number(parts[1]);
  const oneBased = Number(parts[2]);
  if (!Number.isInteger(oneBased) || oneBased < 1 || oneBased > 12) return month;
  if (oneBased === 1) return `${year - 1}-12`;
  return `${year}-${String(oneBased - 1).padStart(2, '0')}`;
}

/**
 * The monthly shard file name that holds one `YYYY-MM` month.
 *
 * `shardName` reads a full UTC stamp, so the month is anchored at its first
 * day. Every instant inside the month names the same shard.
 */
export function shardNameForMonth(month: string): string {
  return shardName(`${month}-01T00:00:00.000Z`);
}

/**
 * The `YYYY-MM` a stored UTC stamp falls in.
 *
 * Returns the empty string when the stamp carries no usable month, so a
 * caller can treat "unknown month" as "cannot walk older".
 */
export function monthOfUtc(utc: string | undefined): string {
  if (typeof utc !== 'string') return '';
  const month = utc.slice(0, 7);
  return MONTH_PATTERN.test(month) ? month : '';
}
