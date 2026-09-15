// The History paging state machine.
// Phase 18. REQUIREMENTS 20.1, 20.4. ARCHITECTURE section 9 loading policy.
//
// Both History screens read one page, then reach past the loaded index by
// pulling older monthly shards. The two screens held the same loop and got
// two things wrong: one flag carried two opposite meanings, and a page read
// on the way into the shard walk was thrown away. The state machine lives
// here instead, so the screens hold no paging rule at all and the whole walk
// is proved without a browser.
//
// Two flags, and they mean two different things.
//
//   indexExhausted   The index holds no more rows past the current offset.
//                    Common, and it says nothing about older months.
//   noOlderShards    The shard walk ran and found nothing older. This is
//                    the only state that hides the `Load older` control.
//
// Conflating them hid the control for every account with one page of
// history, which is most accounts.

import { monthOfUtc, previousMonth } from './historyShards';

/** One page read from the index. Mirrors `PageResult` without the noise. */
export interface PagerPage<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

/** Read one page of rows at `offset`. */
export type ReadPage<T> = (offset: number, limit: number) => PagerPage<T>;

/**
 * Pull one older month into the index.
 *
 * Resolves true when the month landed, false when the account holds no such
 * shard or the read failed. Both answers end the walk.
 */
export type LoadOlderShard = (month: string) => Promise<boolean>;

/** A row the pager can walk backwards from. */
export interface PagedRow {
  /** The stored UTC stamp the walk reads the month from. */
  startedAtUtc: string;
}

/** Everything the pager knows about one list. */
export interface PagerState<T> {
  /** Rows already shown. The list grows in place and never resets. */
  rows: T[];
  /** Index offset `rows` covers. */
  offset: number;
  /** The index holds no more rows past `offset`. */
  indexExhausted: boolean;
  /** The shard walk confirmed there is nothing older. */
  noOlderShards: boolean;
}

/** How many older months one `Load older` press may ask for. */
export const MAX_SHARD_STEPS = 60;

/** A pager with nothing loaded. */
export function emptyPager<T>(): PagerState<T> {
  return { rows: [], offset: 0, indexExhausted: false, noOlderShards: false };
}

/**
 * Read one page at the current offset and append it.
 *
 * Appending rows clears `noOlderShards`, because new rows mean an earlier
 * "nothing older" answer has gone stale.
 */
export function appendPage<T extends PagedRow>(
  state: PagerState<T>,
  read: ReadPage<T>,
  limit: number
): PagerState<T> {
  const page = read(state.offset, limit);
  if (page.items.length === 0) {
    return { ...state, indexExhausted: !page.hasMore };
  }
  return {
    rows: [...state.rows, ...page.items],
    offset: state.offset + page.items.length,
    indexExhausted: !page.hasMore,
    noOlderShards: false
  };
}

/**
 * Ask for the next older page.
 *
 * The page at the current offset is appended first, whether or not the index
 * holds more past it. A page that was read and then dropped took its rows
 * with it for good, which is the defect this order removes.
 *
 * Once the index is spent the walk names older months, loads them, and
 * appends whatever they bring. A month that does not land ends the walk: the
 * shard list comes from the account's own files, so an absent month means
 * no older work.
 */
export async function loadOlder<T extends PagedRow>(
  state: PagerState<T>,
  read: ReadPage<T>,
  loadShard: LoadOlderShard,
  limit: number
): Promise<PagerState<T>> {
  if (state.noOlderShards) return state;

  let next = appendPage(state, read, limit);
  if (!next.indexExhausted) return next;

  const oldest = next.rows.length > 0 ? next.rows[next.rows.length - 1] : undefined;
  if (oldest === undefined) {
    // Nothing on screen, so no month to walk back from.
    return { ...next, noOlderShards: true };
  }

  let month = monthOfUtc(oldest.startedAtUtc);
  if (month === '') return { ...next, noOlderShards: true };

  for (let step = 0; step < MAX_SHARD_STEPS; step += 1) {
    const target = previousMonth(month);
    if (target === month) break;
    const landed = await loadShard(target);
    if (!landed) break;

    const after = read(next.offset, limit);
    if (after.items.length > 0) {
      next = appendPage(next, read, limit);
      return next;
    }
    month = target;
  }

  return { ...next, noOlderShards: true };
}

/**
 * Whether the `Load older` control still has a job.
 *
 * Only the confirmed end of the shard walk hides it. A spent index does not,
 * because the walk has not been asked yet.
 */
export function hasOlder<T>(state: PagerState<T>): boolean {
  return !state.noOlderShards;
}
