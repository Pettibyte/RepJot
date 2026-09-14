// IndexedDB behind the `LocalStore` façade. The only store module that touches
// IndexedDB objects. REQUIREMENTS 3.12, 3.14, 3.15. ARCHITECTURE ADR-006, ADR-007.
//
// One database per account, one object store named `docs`, keyed by string.
// One transaction per façade call. `setMany` puts every entry inside that one
// `readwrite` transaction, so all writes land together or none do.
// REQUIREMENTS 3.14.
//
// Opening, caching, and releasing the connection lives in `idb-connection.ts`.
// Mapping a failure to `AppError('storage')` lives in `storage-error.ts`. This
// file holds the transaction rule and the four façade methods.

import { assertAccountKey, type LocalStore, type LocalStoreEntry } from './local-store';
import { connectionFor, STORE_NAME } from './idb-connection';
import { storageError } from './storage-error';

/**
 * Run `run` against the `docs` store inside one transaction.
 *
 * A throw from `run` aborts the transaction. A request error aborts it too,
 * because no handler calls `preventDefault`. Either way the promise rejects and
 * no write from this transaction survives. REQUIREMENTS 3.14.
 */
function withStore<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let tx: IDBTransaction | undefined;
    try {
      tx = db.transaction(STORE_NAME, mode);
      const result = run(tx.objectStore(STORE_NAME));
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(storageError(tx?.error));
    } catch (cause) {
      try {
        tx?.abort();
      } catch {
        // Already aborted. The caught cause still describes the failure.
      }
      reject(storageError(cause));
    }
  });
}

/**
 * Create the IndexedDB store for one Drive account.
 *
 * `accountKey` must be stable for one account and different for every other
 * account, because it names the database. Two accounts never share a record.
 * A key that cannot name one account rejects with `reason: 'invalid_account_key'`.
 * A host with no IndexedDB rejects with `reason: 'no_indexeddb'`.
 */
export async function createIndexedDbLocalStore(accountKey: string): Promise<LocalStore> {
  assertAccountKey(accountKey);
  const { db } = await connectionFor(accountKey);
  const write = (run: (store: IDBObjectStore) => void): Promise<void> => withStore(db, 'readwrite', run);
  return {
    async get(name: string): Promise<unknown | undefined> {
      let value: unknown;
      await withStore(db, 'readonly', (store) => {
        const request = store.get(name);
        request.onsuccess = () => {
          value = request.result;
        };
      });
      return value;
    },
    set: (name: string, value: unknown): Promise<void> =>
      write((store) => {
        store.put(value, name);
      }),
    delete: (name: string): Promise<void> =>
      write((store) => {
        store.delete(name);
      }),
    setMany: (entries: Array<LocalStoreEntry>): Promise<void> =>
      write((store) => {
        for (const entry of entries) store.put(entry.value, entry.name);
      }),
    async listKeys(prefix: string): Promise<string[]> {
      let keys: string[] = [];
      await withStore(db, 'readonly', (store) => {
        // One range read, not a full cursor walk. `getAllKeys` returns keys in
        // the store's own ascending order, so the sort below is a no-op for
        // IndexedDB and keeps the contract explicit for other engines.
        const request = store.getAllKeys(IDBKeyRange.lowerBound(prefix));
        request.onsuccess = () => {
          keys = request.result
            .filter((key): key is string => typeof key === 'string' && key.startsWith(prefix))
            .sort();
        };
      });
      return keys;
    }
  };
}
