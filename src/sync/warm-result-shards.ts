// Warm the result shards into the lookup index.
// specs/storage-and-lookup.md "Loading policy", PHASE-16 step 6.
//
// The chooser answers three questions from the merged index: what is in
// progress, what finished recently, and when each workout was last done. The
// Drive catalog carries no session status, so the only way to know which shard
// holds an in-progress session is to read the shard. This module reads every
// shard the catalog lists, newest month first, and folds each one into the
// index as it arrives.
//
// Three rules shape the walk:
//
//   1. The current month loads first. Most sessions live there, so the chooser
//      fills on the first round trip.
//   2. Shards load one at a time. A parallel storm of Drive requests stalls a
//      Kindle on a slow link and buys nothing, because the index merges in
//      arrival order anyway.
//   3. One bad shard never stops the walk. A shard this build cannot read is
//      recorded and skipped, so the months the user can read still show.
//      REQUIREMENTS 6.10.
//
// Only names the catalog lists are loaded. A shard that does not exist yet is
// not created here: this walk is read-only, and `SessionService.start` creates
// the current shard when the user actually starts a workout.

import type { DriveAdapter } from '../drive/drive-interface';
import type { LookupService } from '../indexes/lookup-service';
import type { ResultsShard } from '../domain/types';
import { nowUtc, shardName } from '../domain/time';
import { recognize } from './recognized-names';
import type { Coordinator } from './sync-coordinator';

/** What `warmResultShards` reports. */
export interface WarmShardsResult {
  /** Every result shard name found in the catalog, in the order loaded. */
  shardNames: string[];
  /** Shards folded into the index. */
  loaded: string[];
  /** Shards that failed. The walk continued past each one. */
  failed: string[];
}

/** Collaborators the warm needs. */
export interface WarmShardsDeps {
  /** Used to enumerate the account's REP JOT files. */
  drive: DriveAdapter;
  /** Loads each shard through the sync layer, so a local edit is never lost. */
  coordinator: Coordinator;
  /** Receives each shard as it lands. */
  lookup: LookupService;
  /** Now, as a UTC ISO string. Defaults to the wall clock. */
  nowUtc?: string;
  /** Runs after each shard reaches the index, so the UI can repaint. */
  onShardLoaded?: (name: string) => void;
}

/**
 * The shard names to load, newest month first, current month ahead of all.
 *
 * The current month leads even when a newer-looking name sorts above it, which
 * cannot happen but costs nothing to guarantee. The rest sort by `YYYY-MM`
 * descending, so the string sort matches the calendar order.
 */
export function planShardLoad(catalogNames: readonly string[], nowUtcValue: string): string[] {
  const current = shardName(nowUtcValue);
  const months = new Map<string, string>();

  for (const name of catalogNames) {
    const recognized = recognize(name);
    if (recognized === null || recognized.kind !== 'shard') continue;
    // A duplicate name cannot exist in one folder, but a catalog that reports
    // one must not load it twice.
    if (!months.has(recognized.yearMonthUtc)) {
      months.set(recognized.yearMonthUtc, recognized.name);
    }
  }

  const ordered = [...months.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map((entry) => entry[1]);

  // The map is keyed by month, so the current file name is tested against the
  // values, not the keys.
  const present = new Set(ordered);
  const withoutCurrent = ordered.filter((name) => name !== current);
  return present.has(current) ? [current, ...withoutCurrent] : withoutCurrent;
}

/**
 * Read every result shard into the index.
 *
 * The returned promise resolves when the walk finishes. It never rejects for a
 * shard-level failure; those land in `failed`. A catalog listing that throws
 * propagates, because without the listing there is nothing to walk.
 */
export async function warmResultShards(deps: WarmShardsDeps): Promise<WarmShardsResult> {
  const nowValue = deps.nowUtc ?? nowUtc();
  const result: WarmShardsResult = { shardNames: [], loaded: [], failed: [] };

  const catalog = await deps.drive.listCatalog();
  const plan = planShardLoad(
    catalog.map((file) => file.name),
    nowValue
  );
  result.shardNames = plan;

  for (const name of plan) {
    try {
      const doc = await deps.coordinator.ensureLoaded(name);
      // A shard the coordinator reports as absent reads back as an empty
      // document, which merges as a no-op. Anything else is folded in whole.
      const shard = (doc ?? { sessions: {} }) as ResultsShard;
      deps.lookup.extendHistory([shard]);
      result.loaded.push(name);
      if (deps.onShardLoaded !== undefined) deps.onShardLoaded(name);
    } catch {
      // The coordinator reported the failure through `activeError`. Recording
      // the name here keeps the walk honest about what the chooser is missing.
      result.failed.push(name);
    }
  }

  return result;
}
