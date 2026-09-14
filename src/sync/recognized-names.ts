// Recognition of the file names REP JOT owns in the Drive app-data folder.
// Phase 11. ARCHITECTURE section 11 "Catalog and duplicate files".
//
// Two shapes are recognized: the single `preferences.json` file and the monthly
// `results-YYYY-MM.json` shards. Every other name is unknown. An unknown file is
// never consolidated, never rewritten, and never deleted, so a file a person put
// in the folder by hand stays exactly where they put it. REQUIREMENTS 4.22.
//
// Recognition is the single rule the whole sync layer shares. The duplicate
// grouping in `consolidate-duplicates.ts` and the coordinator's own name check
// both read it here, so the two can never disagree about what a REP JOT file is.

/** The one preferences file name. */
export const PREFERENCES_FILE_NAME = 'preferences.json';

/**
 * A recognized Drive file name.
 *
 * `null` means the name is not a REP JOT file. Callers must treat `null` as
 * "leave it alone", never as "treat it as empty".
 */
export type RecognizedName =
  | { kind: 'preferences'; name: 'preferences.json' }
  | { kind: 'shard'; name: string; yearMonthUtc: string }
  | null;

/**
 * The monthly shard name shape.
 *
 * The month is constrained to `01` through `12`. A file named
 * `results-2026-13.json` is not a shard: no UTC month can carry that number, so
 * the name is unknown and the file is left untouched rather than merged into a
 * shard that cannot exist.
 */
const SHARD_PATTERN = /^results-(\d{4})-(0[1-9]|1[0-2])\.json$/;

/**
 * Recognize one Drive file name.
 *
 * @param name The `name` field of a Drive file, with no path.
 * @returns The recognized name, or `null` when REP JOT does not own it.
 */
export function recognize(name: string): RecognizedName {
  if (name === PREFERENCES_FILE_NAME) {
    return { kind: 'preferences', name };
  }

  const match = SHARD_PATTERN.exec(name);
  if (match === null) {
    return null;
  }

  return { kind: 'shard', name, yearMonthUtc: `${match[1]}-${match[2]}` };
}

/** True when REP JOT owns this Drive file name. */
export function isRecognizedName(name: string): boolean {
  return recognize(name) !== null;
}

/**
 * The document family one recognized name carries.
 *
 * `null` for an unknown name, so a caller that has only a file name can reach
 * the family without a second rule.
 */
export function familyForName(name: string): 'repjot/preferences' | 'repjot/results' | null {
  const recognized = recognize(name);
  if (recognized === null) {
    return null;
  }
  return recognized.kind === 'preferences' ? 'repjot/preferences' : 'repjot/results';
}
