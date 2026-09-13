// One IndexedDB connection per account, opened once and released on upgrade.
// REQUIREMENTS 3.12, 3.15. ARCHITECTURE ADR-006.
//
// The store factory calls `connectionFor` instead of opening a database of its
// own. Two reasons:
//
// 1. A re-auth, an account switch, or a component remount must not add a
//    connection each time. The target device has 0.5 GiB of memory.
// 2. A held connection blocks a later schema-version bump. `onversionchange`
//    releases the connection so the upgrade can proceed instead of leaving
//    every later open rejected with `reason: 'blocked'`.
//
// The connection itself stays inside this module. The store factory gets a
// handle and never caches one, so no caller can hand out a closed database.

import { AppError } from '../domain/errors';
import { storageError } from './storage-error';

/** Database name prefix. One database holds one account's records. */
const DB_PREFIX = 'repjot-';

/** The one object store. Keyed by string, values are whole documents. */
export const STORE_NAME = 'docs';

/** Schema version for the `docs` object store. */
const DB_VERSION = 1;

/** One open connection, plus the flag that says we may still use it. */
interface CachedConnection {
  db: IDBDatabase;
  closed: boolean;
}

/** Open connections by account key. One entry per account key. */
const connections = new Map<string, Promise<CachedConnection>>();

/** Open the account database and create the `docs` store on first run. */
function openDatabase(accountKey: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    // A host with no IndexedDB must fail as a typed storage error, not as a raw
    // `ReferenceError`, so a caller that switches on `error.kind` still sees it.
    if (typeof indexedDB === 'undefined') {
      reject(new AppError('storage', { reason: 'no_indexeddb' }, 'This host has no IndexedDB.'));
      return;
    }
    const request = indexedDB.open(`${DB_PREFIX}${accountKey}`, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error));
    request.onblocked = () => reject(new AppError('storage', { reason: 'blocked' }));
  });
}

/** Drop the map entry only when it still points at `pending`. */
function forget(accountKey: string, pending: Promise<CachedConnection>): void {
  if (connections.get(accountKey) === pending) connections.delete(accountKey);
}

/** Open one connection and register the release handlers on it. */
function openConnection(accountKey: string): Promise<CachedConnection> {
  const pending: Promise<CachedConnection> = openDatabase(accountKey).then((db) => {
    const cached: CachedConnection = { db, closed: false };
    const release = (): void => {
      cached.closed = true;
      try {
        db.close();
      } catch {
        // Already closed. Dropping the map entry is what matters.
      }
      forget(accountKey, pending);
    };
    // A version bump reaches here. Releasing lets the upgrade proceed.
    db.onversionchange = release;
    // Fires when the engine closes the connection from under us, for example
    // when the user clears site data.
    db.onclose = release;
    return cached;
  });
  connections.set(accountKey, pending);
  // A failed open must not stay cached, or every later call returns the same error.
  pending.catch(() => forget(accountKey, pending));
  return pending;
}

/**
 * Return a usable open connection for one account key.
 *
 * Opens one only when the cache holds nothing usable. A closed entry is worse
 * than no entry, so it is dropped and a fresh connection is opened.
 */
export function connectionFor(accountKey: string): Promise<CachedConnection> {
  const cached = connections.get(accountKey);
  if (cached === undefined) return openConnection(accountKey);
  return cached.then(
    (entry) => {
      if (!entry.closed) return entry;
      forget(accountKey, cached);
      return openConnection(accountKey);
    },
    () => openConnection(accountKey)
  );
}
