// One configured `jsondiffpatch` instance and the deep clone the merge needs.
// ARCHITECTURE ADR-011, REQUIREMENTS 22.4.
//
// REP JOT stores every concurrently edited collection as a keyed map, so this
// instance carries no `objectHash` and no `matchByPosition`. An array `matchBy`
// workaround is forbidden by REQUIREMENTS 22.4.3: the keyed map removes index
// drift instead of compensating for it. REQUIREMENTS 22.4.1, 22.4.2.
//
// Text diffing stays out of the bundle. The text differ lives in
// `jsondiffpatch/with-text-diffs`, which nothing imports, so a changed string
// produces one replacement value instead of a text delta. REQUIREMENTS 4.7 keeps
// the conflict unit whole, so a line-level string merge is never wanted.
//
// `cloneDiffValues` makes a delta independent of the documents it came from.
// Without it, a delta holds live references into the caller's document, and a
// merged document could alias the caller's remote copy and change it later.

import { DiffPatcher } from 'jsondiffpatch';

/**
 * The shared differ and patcher.
 *
 * One instance serves every merge so the library initializes once.
 */
export const patcher = new DiffPatcher({
  cloneDiffValues: true
});

/**
 * Deep copy a JSON value.
 *
 * The merge clones the base before it patches, and clones every unit value it
 * copies into the merged document, so no two documents share a mutable node.
 *
 * A JSON round trip is the clone REP JOT needs: every document family is JSON,
 * and every timestamp is an RFC 3339 string, never a `Date`. `structuredClone`
 * is deliberately absent because the targeted Kindle browser does not provide it.
 * The capability matrix in `docs/CAPABILITIES-kindle-scribe.md` records the
 * engine's limits, including no optional chaining. App code and this module use
 * no post-ES2019 runtime call, and `bun run check:compat` proves it for the
 * merge module.
 */
export function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
