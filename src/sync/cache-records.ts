// Typed read and write helpers for the three records the coordinator keeps for
// one logical Drive file. Phase 10, over the Phase 06 key scheme.
// REQUIREMENTS 3.13, 3.14, 4.5, 4.15. ARCHITECTURE ADR-007, section 11.
//
// The Phase 06 façade stores whole JSON values under string keys and runs no
// query. This module is the only place that knows what those values mean. It
// reads a value, proves the shape, and hands back a typed record or `null`, so
// the coordinator never casts a stored value by hand.
//
// A stored value that fails its shape check is treated as absent, never
// repaired. A corrupt cache row costs a re-download, never user intent, so a
// half-readable row must not reach the merge. REQUIREMENTS 4.4.
//
// Clearing the pending delta is a write of `null`, not a `delete`. The
// coordinator commits confirmed content as working and base and clears pending
// in ONE `setMany` call, so the three keys cannot be seen in a mixed state.
// A `delete` would be a second transaction. REQUIREMENTS 3.14.

import { AppError } from '../domain/errors';
import type { DriveFileMeta } from '../drive/drive-interface';
import { baseKey, cacheKey, pendingKey, type LocalStore } from '../storage/local-store';
import type { BaseRecord, CachedDocRecord, PendingRecord } from '../storage/records';

/** Clearing the pending delta is a write of `null`, not a `delete`. The
 * coordinator commits confirmed content as working and base and clears
 * pending in ONE `setMany` call, so the three keys cannot be seen in a
 * mixed state. A `delete` would be a second transaction. REQUIREMENTS 3.14. */

/** The pending delta for one logical file, in a self-describing envelope.
 *
 * `patch` carries a `jsondiffpatch` delta from the base document to the local
 * document. `replace` carries a whole document, used when no base exists yet:
 * a first save has nothing to diff against, and a delta with no base cannot be
 * replayed after a reload.
 */
export type PendingDelta =
  | { kind: 'patch'; delta: unknown }
  | { kind: 'replace'; document: unknown };

/** The three records for one logical file, as read from the store. */
export interface RecordSet {
  cached: CachedDocRecord | null;
  base: BaseRecord | null;
  pending: PendingRecord | null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** True when `value` is a well-formed `CachedDocRecord`. */
export function isCachedRecord(value: unknown): value is CachedDocRecord {
  if (!isPlainObject(value)) return false;
  return (
    isString(value.logicalName) &&
    (value.driveFileId === null || isString(value.driveFileId)) &&
    (value.remoteEtag === null || isString(value.remoteEtag)) &&
    isString(value.contentText) &&
    isNumber(value.schemaVersion) &&
    isString(value.cachedAtUtc)
  );
}

/** True when `value` is a well-formed `BaseRecord`. */
export function isBaseRecord(value: unknown): value is BaseRecord {
  if (!isPlainObject(value)) return false;
  return isString(value.contentText) && (value.driveFileId === null || isString(value.driveFileId));
}

/** True when `value` is a well-formed `PendingRecord`. */
export function isPendingRecord(value: unknown): value is PendingRecord {
  if (!isPlainObject(value)) return false;
  if (!isString(value.updatedAtUtc)) return false;
  return isPendingDelta(value.delta);
}

/** True when `value` is a well-formed `PendingDelta` envelope. */
export function isPendingDelta(value: unknown): value is PendingDelta {
  if (!isPlainObject(value)) return false;
  if (value.kind === 'patch') return true;
  if (value.kind === 'replace') return true;
  return false;
}

/** Read one record, or `null` when absent or malformed. */
async function readRecord<T>(
  store: LocalStore,
  key: string,
  guard: (value: unknown) => value is T
): Promise<T | null> {
  const raw = await store.get(key);
  // `null` is a written value, not a missing one. Both read as absent here, so
  // a cleared pending row and a never-written row behave the same way.
  if (raw === undefined || raw === null) return null;
  return guard(raw) ? raw : null;
}

/** Read the cached copy of one logical file. */
export function readCached(store: LocalStore, logicalName: string): Promise<CachedDocRecord | null> {
  return readRecord(store, cacheKey(logicalName), isCachedRecord);
}

/** Read the base copy of one logical file. */
export function readBase(store: LocalStore, logicalName: string): Promise<BaseRecord | null> {
  return readRecord(store, baseKey(logicalName), isBaseRecord);
}

/** Read the pending delta of one logical file. */
export function readPending(store: LocalStore, logicalName: string): Promise<PendingRecord | null> {
  return readRecord(store, pendingKey(logicalName), isPendingRecord);
}

/** Read all three records for one logical file in one pass. */
export async function readRecords(store: LocalStore, logicalName: string): Promise<RecordSet> {
  const [cached, base, pending] = await Promise.all([
    readCached(store, logicalName),
    readBase(store, logicalName),
    readPending(store, logicalName)
  ]);
  return { cached, base, pending };
}

/**
 * Build a cached record.
 *
 * The caller passes the marker it already holds, because the working row can
 * describe a document that was never read from Drive: a local edit sits in
 * this row before any upload, and its `remoteEtag` is the marker of the last
 * confirmed remote state, not of the local text.
 */
export function makeCachedRecord(
  logicalName: string,
  driveFileId: string | null,
  remoteEtag: string | null,
  contentText: string,
  schemaVersion: number,
  cachedAtUtc: string
): CachedDocRecord {
  return { logicalName, driveFileId, remoteEtag, contentText, schemaVersion, cachedAtUtc };
}

/** Build a base record. */
export function makeBaseRecord(contentText: string, driveFileId: string | null): BaseRecord {
  return { contentText, driveFileId };
}

/** Build a pending record. */
export function makePendingRecord(delta: PendingDelta, updatedAtUtc: string): PendingRecord {
  return { delta, updatedAtUtc };
}

/**
 * The value that stands in for this file's remote version.
 *
 * `md5Checksum` is preferred because it changes only with content. `version`
 * is the fallback. `modifiedTime` is never used as the marker, because two
 * writes inside one second would look unchanged.
 */
export function remoteMarker(meta: DriveFileMeta): string {
  return meta.md5Checksum !== null ? meta.md5Checksum : meta.version;
}

/**
 * Compute the pending delta from base to local.
 *
 * Returns `null` when the two documents are equal, so a no-op edit writes no
 * pending row. The caller passes parsed documents, never text, because the
 * delta is a structural diff.
 */
export function computePendingDelta(baseDoc: unknown, localDoc: unknown, diff: DiffFn): PendingDelta | null {
  if (baseDoc === undefined || baseDoc === null) {
    return { kind: 'replace', document: localDoc };
  }
  const delta = diff(baseDoc, localDoc);
  if (delta === undefined || delta === null) return null;
  return { kind: 'patch', delta };
}

/** A structural diff. Supplied by the caller so this module stays pure. */
export type DiffFn = (base: unknown, local: unknown) => unknown;

/**
 * Rebuild the local document from a base document and a pending delta.
 *
 * This is the reload path. After a page reload the in-memory working document
 * is gone, and the merge needs it back. A `replace` envelope needs no base.
 * A `patch` envelope is applied to a clone of the base, so the caller's base
 * value is never touched.
 */
export function applyPendingDelta(
  baseDoc: unknown,
  pending: PendingRecord,
  patch: (base: unknown, delta: unknown) => unknown,
  clone: (value: unknown) => unknown
): unknown {
  const envelope = pending.delta;
  if (!isPendingDelta(envelope)) {
    throw new AppError(
      'storage',
      { reason: 'pending_envelope_unknown' },
      'The stored pending record has no readable delta envelope.'
    );
  }
  if (envelope.kind === 'replace') return envelope.document;
  if (baseDoc === undefined || baseDoc === null) return undefined;
  return patch(clone(baseDoc), envelope.delta);
}

/** Strip a record key down to its logical name. `null` when the prefix is absent. */
function nameFromKey(key: string, prefix: string): string | null {
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

/**
 * Every logical name that holds local state.
 *
 * The union of the cached, base, and pending prefixes. A name appears here
 * when any of its three rows exists, which is exactly the set `syncAll` must
 * reconcile after a reload. REQUIREMENTS 4.15.
 *
 * Names found only in the Drive catalog are not included. The coordinator
 * adds those itself, because recognition of a Drive name is Phase 11's rule.
 */
export async function listLocalLogicalNames(store: LocalStore): Promise<string[]> {
  const [cachedKeys, baseKeys, pendingKeys] = await Promise.all([
    store.listKeys('doc:'),
    store.listKeys('base:'),
    store.listKeys('pending:')
  ]);
  const names = new Set<string>();
  const add = (keys: string[], prefix: string): void => {
    for (const key of keys) {
      const name = nameFromKey(key, prefix);
      if (name !== null && name.length > 0) names.add(name);
    }
  };
  add(cachedKeys, 'doc:');
  add(baseKeys, 'base:');
  add(pendingKeys, 'pending:');
  return Array.from(names).sort();
}
