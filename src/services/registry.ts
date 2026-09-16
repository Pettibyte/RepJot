// The app service registry.
// ARCHITECTURE section 4: "UI code calls no `fetch` or IndexedDB directly. It
// calls services."
//
// Bootstrap builds the services and publishes them here. Screens read them from
// here. This keeps the wiring in one place and keeps screens free of the
// construction order, the Drive adapter, and the local store.
//
// The registry mirrors `src/routing/router-registry.ts`. It adds a store
// because the warm-up fills the index after the first paint, so a screen must
// re-render when a service arrives rather than read a value once at mount.
//
// A screen must handle a null service. The services are absent before bootstrap
// publishes them, and they are absent forever for an anonymous visitor, who has
// no Drive adapter and therefore no coordinator.

import { writable, type Readable } from 'svelte/store';

import type { LoadedStaticData } from '../documents/static-loader';
import type { DriveAdapter } from '../drive/drive-interface';
import type { LookupService } from '../indexes/lookup-service';
import type { PreferenceService } from '../preferences/preference-service';
import type { SessionService } from '../sessions/session-service';
import type { LocalStore } from '../storage/local-store';
import type { Coordinator } from '../sync/sync-coordinator';

/** The services a signed-in session needs. Each is null until bootstrap sets it. */
export interface AppServices {
  /** Read-side queries over the merged index. */
  lookup: LookupService | null;
  /** Start, complete, and abandon operations. Null without a signed-in account. */
  sessionService: SessionService | null;
  /** Unit preferences. Null without a signed-in account. */
  preferences: PreferenceService | null;
  /** The sync coordinator behind every read and write. */
  coordinator: Coordinator | null;
  /** The bundled exercise directory and workout definitions. */
  staticData: LoadedStaticData | null;
  /**
   * The Drive adapter for the bound account.
   *
   * Settings needs it for two things the coordinator does not expose: a raw
   * file read for export, and a delete by file ID. Both are user-requested
   * reads and removals of whole files, not merged documents, so they bypass
   * the sync layer on purpose. ARCHITECTURE §10.
   */
  drive: DriveAdapter | null;
  /**
   * The local store for the bound account.
   *
   * Delete-all and disconnect clear the account's local rows. Only the store
   * can do that, so Settings reads it here.
   */
  store: LocalStore | null;
  /**
   * The bound account key, or `null` while anonymous.
   *
   * A screen reads this to tell "no account yet" from "account with no data",
   * which the service fields alone cannot distinguish.
   */
  accountKey: string | null;
}

/** The registry before bootstrap publishes anything. */
function emptyServices(): AppServices {
  return {
    lookup: null,
    sessionService: null,
    preferences: null,
    coordinator: null,
    staticData: null,
    drive: null,
    store: null,
    accountKey: null
  };
}

/**
 * The current registry, held outside the store so a non-reactive caller can read
 * it synchronously. Every write goes through `setServices`, so the two copies
 * cannot drift.
 */
let current: AppServices = emptyServices();

const store = writable<AppServices>(current);

/** Reactive view of the registry. Use `$services` in a component. */
export const services: Readable<AppServices> = {
  subscribe: store.subscribe
};

/**
 * Publish services, replacing only the named fields.
 *
 * Bootstrap calls this once with the static data and lookup, then again after it
 * builds the coordinator, the session service, and the preference service. A
 * partial patch keeps the warm-up progressive: the chooser shows the workout
 * list before the session history arrives.
 */
export function setServices(patch: Partial<AppServices>): void {
  current = { ...current, ...patch };
  store.set(current);
}

/**
 * Re-publish the current services so readers re-render.
 *
 * A service can grow without being replaced: the warm folds shards into the
 * lookup index the registry already holds. The store cannot see that, so the
 * writer calls this to say the contents moved. The published object is new,
 * so every subscriber re-evaluates.
 */
export function publishServices(): void {
  current = { ...current };
  store.set(current);
}

/** Synchronous read, for code that runs outside a component. */
export function getServices(): AppServices {
  return current;
}

/** Drop every service. Used on sign-out and between tests. */
export function clearServices(): void {
  current = emptyServices();
  store.set(current);
}
