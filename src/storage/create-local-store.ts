// The engine switch for the local storage façade.
// REQUIREMENTS 3.12, 3.15, 3.21.
//
// Why this file exists. The plan names two engines: IndexedDB, and the memory
// store for a browser without IndexedDB. Choosing between them needs a
// `typeof indexedDB` test, and the Phase 06 exit criterion says no module
// outside `src/storage/` may reference `indexedDB`. So the test cannot live in
// the bootstrap module. It lives here, inside the one directory that is allowed
// to know the engine, and the bootstrap module gets one call.
//
// This file names no engine of its own. It asks the IndexedDB module whether its
// API is present and falls back to the memory module when it is not. A later
// engine change edits the two engine files and leaves this choice intact.

import { assertAccountKey, type LocalStore } from './local-store';
import { createIndexedDbLocalStore } from './indexeddb-local-store';
import { createMemoryLocalStore } from './memory-local-store';

/** True when this host exposes the IndexedDB API. */
function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * Create the local store for one Drive account, on the best engine this host
 * offers.
 *
 * IndexedDB when the host has it, the memory store when it does not. A memory
 * store holds nothing across a page load, so a caller that needs durability on a
 * host without IndexedDB still gets the same interface and the same behavior
 * inside one page session.
 *
 * Rejects with `AppError('storage')` and `reason: 'invalid_account_key'` when
 * `accountKey` cannot name one account.
 */
export async function createLocalStore(accountKey: string): Promise<LocalStore> {
  assertAccountKey(accountKey);
  if (hasIndexedDb()) return createIndexedDbLocalStore(accountKey);
  return createMemoryLocalStore();
}
