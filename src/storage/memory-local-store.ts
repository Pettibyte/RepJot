// The `Map` behind the `LocalStore` façade. Same contract, no engine.
// REQUIREMENTS 3.11, 3.13, 3.14, 3.15.
//
// Two uses: tests, and a browser with no IndexedDB. The caller picks the
// implementation through `createLocalStore`, so nothing else in the app changes
// when the engine changes.
//
// Values are cloned on write and on read. That matches IndexedDB, where a stored
// value is a clone and a later mutation of the caller's object cannot reach the
// stored copy.
//
// The clone prefers the native `structuredClone`. The targeted Silk 80 browser
// has no native `structuredClone` (Chrome 80 base; the API arrived in Chrome 98),
// so the store falls back to a JSON round trip there. The fallback is exact for
// the values this façade carries, which are whole JSON documents.
// REQUIREMENTS 3.13.
//
// A `core-js` polyfill for `structuredClone` measured at about 25 KB of the
// bundle, for a path the targeted device never takes, because IndexedDB is
// present there. The fallback keeps the bundle small and the engine working.
//
// `setMany` clones every value before it writes any of them. A value that cannot
// be cloned therefore fails the whole call and leaves the map untouched, which
// matches the transactional engine. REQUIREMENTS 3.14.

import { AppError } from '../domain/errors';
import type { LocalStore, LocalStoreEntry } from './local-store';

/**
 * Clone a value, or reject with the typed `storage` error.
 *
 * The native API is used when the host has it. Otherwise the value goes through
 * a JSON round trip, so on a host without `structuredClone` a stored value must
 * be a JSON document. That is the façade contract already. REQUIREMENTS 3.13.
 *
 * A value with no JSON form, such as a function, has no clone and fails here.
 * Nothing is written for a failed clone.
 */
function clone(value: unknown): unknown {
  const native = (globalThis as { structuredClone?: (input: unknown) => unknown }).structuredClone;
  try {
    if (typeof native === 'function') return native(value);
    const text = JSON.stringify(value);
    // `JSON.stringify` returns undefined for a function, a symbol, and
    // `undefined`, so no JSON form means no clone.
    if (text === undefined) throw new TypeError('The value has no JSON form.');
    return JSON.parse(text);
  } catch (cause) {
    const name = cause instanceof Error ? cause.name : String(cause);
    throw new AppError('storage', { reason: 'not_cloneable', cause: name });
  }
}

/** Create a store that keeps records in memory only. */
export function createMemoryLocalStore(): LocalStore {
  const records = new Map<string, unknown>();
  return {
    async get(name: string): Promise<unknown | undefined> {
      if (!records.has(name)) return undefined;
      return clone(records.get(name));
    },
    async set(name: string, value: unknown): Promise<void> {
      records.set(name, clone(value));
    },
    async delete(name: string): Promise<void> {
      records.delete(name);
    },
    async setMany(entries: Array<LocalStoreEntry>): Promise<void> {
      const staged: Array<[string, unknown]> = entries.map((entry) => [entry.name, clone(entry.value)]);
      for (const [name, value] of staged) records.set(name, value);
    }
  };
}
