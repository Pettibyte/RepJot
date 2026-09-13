// One small key-to-value façade over the local storage engine.
// REQUIREMENTS 3.11, 3.12, 3.13, 3.14, 3.15, 3.16, 3.21.
// ARCHITECTURE ADR-006, ADR-007, section 7 "Local storage façade".
//
// The façade stores whole JSON documents under a string key. It runs no query,
// builds no index, and applies no partial update. A caller writes one value and
// reads one value back. REQUIREMENTS 3.13.
//
// `setMany` is a requirement, not a convenience. One user save writes a cached
// document, its base copy, and its pending delta, and those three writes must land
// together or not at all. REQUIREMENTS 3.14.
//
// Only this directory knows the engine. A move from IndexedDB to another key-value
// store replaces one implementation file and changes no sync code.
// REQUIREMENTS 3.15.
//
// Authentication state stays outside this façade. The `sessionStorage` and
// `localStorage` use that OAuth bootstrap needs stays direct.
// REQUIREMENTS 3.21.

import { AppError } from '../domain/errors';

/** One name-and-value pair for a transactional write. */
export interface LocalStoreEntry {
  name: string;
  value: unknown;
}

/**
 * The whole local-storage surface the app uses.
 *
 * Keys are strings. Values are whole JSON documents. A value must survive a
 * structured clone, because the IndexedDB engine clones it.
 */
export interface LocalStore {
  /** Read one value. Resolves `undefined` when the key is absent. */
  get(name: string): Promise<unknown | undefined>;
  /** Write one value, replacing any value already under the key. */
  set(name: string, value: unknown): Promise<void>;
  /** Remove one key. Removing an absent key is not an error. */
  delete(name: string): Promise<void>;
  /**
   * Write every entry in one transaction. All entries land, or none do.
   * REQUIREMENTS 3.14.
   */
  setMany(entries: Array<LocalStoreEntry>): Promise<void>;
}

/** Prefix for a cached document record. */
const CACHE_PREFIX = 'doc:';

/** Prefix for a base copy record. */
const BASE_PREFIX = 'base:';

/** Prefix for a pending delta record. */
const PENDING_PREFIX = 'pending:';

/**
 * Key for the cached copy of one logical Drive file.
 * `cacheKey('preferences.json')` gives `'doc:preferences.json'`.
 */
export function cacheKey(logicalName: string): string {
  return `${CACHE_PREFIX}${logicalName}`;
}

/** Key for the base copy of one logical Drive file. See `cacheKey`. */
export function baseKey(logicalName: string): string {
  return `${BASE_PREFIX}${logicalName}`;
}

/** Key for the pending delta of one logical Drive file. See `cacheKey`. */
export function pendingKey(logicalName: string): string {
  return `${PENDING_PREFIX}${logicalName}`;
}

/**
 * Accepted shape for an account key.
 *
 * The key names a database, so it must be non-empty and free of characters a
 * storage engine could treat as a path separator. A blank key would collapse two
 * accounts into one shared namespace, so it is refused instead.
 * REQUIREMENTS 3.11, Goal 3 of the Phase 06 plan.
 */
const ACCOUNT_KEY_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Throw `AppError('storage')` with `reason: 'invalid_account_key'` when
 * `accountKey` cannot name one account. Call this inside an `async` function so
 * the throw reaches the caller as a rejected promise.
 */
export function assertAccountKey(accountKey: string): void {
  if (!ACCOUNT_KEY_PATTERN.test(accountKey)) {
    throw new AppError('storage', { reason: 'invalid_account_key' }, 'The account key is not usable.');
  }
}
