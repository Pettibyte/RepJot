// Svelte stores for startup, save, sync, and error state. Every screen reads these.
// REQUIREMENTS 4.1, 4.3, 4.20. ARCHITECTURE "State layers", section 11.
//
// The stores hold presentation state only. They are not the data layer and they
// hold no user document. A screen reads a store; the sync coordinator writes one.
//
// Internals are writable. Each export hides the write side behind a `Readable`,
// so a screen cannot set a status by accident.

import { writable, type Readable } from 'svelte/store';
import { AppError } from '../domain/errors';
import { nowUtc } from '../domain/time';

/** What the save badge shows. REQUIREMENTS 4.3. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'sync_failed';

/** What the app shows before the first screen renders. */
export type StartupStatus = 'loading_static' | 'static_failed' | 'ready' | 'blocked';

/** Hide the write side of a store behind a read-only view. */
function asReadable<T>(store: Readable<T>): Readable<T> {
  return { subscribe: store.subscribe };
}

const saveStatusStore = writable<SaveStatus>('idle');
const startupStatusStore = writable<StartupStatus>('loading_static');
const lastSavedAtStore = writable<string | null>(null);
const activeErrorStore = writable<AppError | null>(null);

/**
 * Save state for the newest user edit.
 *
 * `saving` covers the local transaction and any remote reconciliation.
 * `saved` means the local write resolved. `sync_failed` means the edit is durable
 * locally but Drive synchronization failed. REQUIREMENTS 4.20.
 */
export const saveStatus: Readable<SaveStatus> = asReadable(saveStatusStore);

/** Startup state for the static bundle and the bootstrap gate. */
export const startupStatus: Readable<StartupStatus> = asReadable(startupStatusStore);

/** When the newest edit became durable locally, or `null` before the first save. */
export const lastSavedAtUtc: Readable<string | null> = asReadable(lastSavedAtStore);

/** The last reported error, or `null` when nothing is outstanding. */
export const activeError: Readable<AppError | null> = asReadable(activeErrorStore);

/**
 * Set the save status.
 *
 * `saved` means the newest edit is durable in IndexedDB. It does **not** mean
 * synchronized with Drive. The caller sets `saved` only after the IndexedDB
 * transaction resolves. ARCHITECTURE "State layers", REQUIREMENTS 4.1.
 *
 * A move to `saved` also stamps `lastSavedAtUtc` with the current UTC instant.
 */
export function setSaveStatus(status: SaveStatus): void {
  if (status === 'saved') lastSavedAtStore.set(nowUtc());
  saveStatusStore.set(status);
}

/** Set the startup status. */
export function setStartupStatus(status: StartupStatus): void {
  startupStatusStore.set(status);
}

/** Report an error for the UI to show. Replaces any earlier error. */
export function reportError(error: AppError): void {
  activeErrorStore.set(error);
}

/** Clear the reported error, for example after the user dismisses it. */
export function clearError(): void {
  activeErrorStore.set(null);
}
