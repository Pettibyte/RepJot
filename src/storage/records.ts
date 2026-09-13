// Shapes for the three records the sync coordinator keeps per logical Drive file.
// REQUIREMENTS 3.13, 3.14, 4.5, 4.15. ARCHITECTURE ADR-007, "State layers".
//
// Each record is a whole value. The façade stores it as-is and reads it back
// as-is. Nothing here holds a partial field path or a derived index.
// REQUIREMENTS 3.13, 3.16.
//
// The coordinator writes all three for one save with one `setMany` call, so a
// local edit becomes durable in one step. REQUIREMENTS 3.14.

/**
 * The cached copy of one logical Drive file.
 *
 * The coordinator writes this record after a remote read or a confirmed write.
 * The cache is disposable: losing it costs a re-download, never user intent.
 * ARCHITECTURE "State layers".
 */
export interface CachedDocRecord {
  /** Logical file name, such as `'preferences.json'` or `'results-2026-09.json'`. */
  logicalName: string;
  /** Stable Drive file ID, or `null` before the file exists remotely. */
  driveFileId: string | null;
  /**
   * Remote version marker: an ETag, a `modifiedTime`, or an `md5Checksum`.
   * `null` when the remote side reported no marker.
   */
  remoteEtag: string | null;
  /** Exact bytes as last read from Drive or last written to Drive. */
  contentText: string;
  /** Schema version the cached text declares. */
  schemaVersion: number;
  /** When this cache row was written, RFC 3339 UTC. */
  cachedAtUtc: string;
}

/**
 * The base copy: the content from the last successful synchronization.
 *
 * The merge in REQUIREMENTS 4.9 needs this baseline. A local edit that never
 * synchronized must not overwrite the base. REQUIREMENTS 4.5.
 */
export interface BaseRecord {
  /** Content that was last known to match Drive. */
  contentText: string;
  /** Drive file ID the base came from, or `null` before the file exists. */
  driveFileId: string | null;
}

/**
 * The pending local delta that has not committed to Drive.
 *
 * A reload reads this record so a merge can finish after the reload.
 * REQUIREMENTS 4.15. The coordinator clears it after the commit.
 *
 * `delta` stays `unknown` here on purpose. This phase carries the envelope; the
 * sync coordinator gives it a type.
 */
export interface PendingRecord {
  /** The pending delta payload. */
  delta: unknown;
  /** When the local edit was recorded, RFC 3339 UTC. */
  updatedAtUtc: string;
}
