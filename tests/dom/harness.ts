// Shared setup for the client-mode harness.
//
// Every file here mounts real components over the real coordinator, preference
// service, and `FakeDrive`, then taps them the way a person would. The point is
// to see what the SSR suite cannot: what happens after the first render.
//
// Run from this directory with `bun test`, or from the repo root with
// `bun run test:dom`.

import { clearServices, setServices } from '../../src/services/registry';
import { clearRawPayloads } from '../../src/state/raw-payload-store';
import { clearError, setStartupStatus } from '../../src/state/app-state';
import { resetDiagnosticLog } from '../../src/diagnostics/diagnostic-log';
import { restoreAndBind, signOut } from '../../src/auth/auth-service';
import { clearAllAuthState, saveToken, type TokenRecord } from '../../src/auth/oauth-redirect-adapter';
import { createMemoryLocalStore } from '../../src/storage/memory-local-store';
import { createCoordinator, type Coordinator } from '../../src/sync/sync-coordinator';
import { createPreferenceService, type PreferenceService } from '../../src/preferences/preference-service';
import { createLookupService, type LookupService } from '../../src/indexes/lookup-service';
import type { LoadedStaticData } from '../../src/documents/static-loader';
import { FakeDrive } from '../fakes/fake-drive';
import { frozenTimers, loadedStaticData } from '../fixtures/sync';
import { mount, flushSync, settle } from './runtime';

export { flushSync, settle } from './runtime';
export { FakeDrive } from '../fakes/fake-drive';
export { frozenTimers, loadedStaticData } from '../fixtures/sync';

/** The wired world one test runs against. */
export interface Harness {
  drive: FakeDrive;
  store: Awaited<ReturnType<typeof createMemoryLocalStore>>;
  coordinator: Coordinator;
  preferences: PreferenceService;
  lookup: LookupService;
  staticData: LoadedStaticData;
  timers: ReturnType<typeof frozenTimers>;
}

/**
 * Build a signed-in stack and publish it to the service registry.
 *
 * The timers are frozen, so nothing uploads until the test says so. Pass
 * `autoRunTimers` when the test wants the upload path to actually move.
 */
export async function signIn(
  seed: Array<{ name: string; text: string }> = []
): Promise<Harness> {
  const drive = new FakeDrive();
  for (const file of seed) drive.addFile(file.name, file.text);

  const store = await createMemoryLocalStore();
  const staticData = loadedStaticData();
  const timers = frozenTimers();
  const coordinator = createCoordinator({
    store,
    drive,
    staticData,
    accountKey: 'acct-1',
    pagehideTarget: null,
    timers: timers.timers
  });
  const preferences = createPreferenceService({ coordinator, staticData });
  const lookup = createLookupService({ staticData });

  setServices({
    lookup,
    preferences,
    coordinator,
    staticData,
    drive,
    store,
    accountKey: 'acct-1'
  });

  return { drive, store, coordinator, preferences, lookup, staticData, timers };
}

/**
 * Mount a component into a fresh detached element and flush the first render.
 *
 * The target is appended to `document.body` because Svelte's client runtime
 * wants a connected node for transitions and lifecycle.
 */
export function mountTo(
  component: unknown,
  props: Record<string, unknown> = {}
): { target: HTMLElement; app: unknown } {
  const target = document.createElement('div');
  document.body.appendChild(target);
  const app = mount(component as any, { target, props: props as any } as any);
  flushSync();
  return { target, app };
}

/** Tear the world down. Call from `afterEach`. */
export function teardown(): void {
  clearServices();
  clearRawPayloads();
  clearError();
  setStartupStatus('loading_static');
  resetDiagnosticLog();
  // Sign out of the auth module too. It holds a module-level session, and a
  // leftover token makes the next test's `disconnect()` take a path its own
  // setup never asked for.
  signOut();
  clearAllAuthState();
  document.body.innerHTML = '';
}

/**
 * Bind a real session so `disconnect()` has a token to revoke.
 *
 * `disconnect()` returns `revoked` without calling the revoke thunk when no
 * token is stored. A test that wants the `revoke_failed` path must therefore
 * put a token in place first, or it silently exercises the success path.
 */
export async function bindTestSession(): Promise<void> {
  const token: TokenRecord = {
    accessToken: 'test-access-token',
    expiresAtUtc: new Date(Date.now() + 3_600_000).toISOString(),
    grantedScope: 'https://www.googleapis.com/auth/drive.appdata',
    accountKey: 'acct-1'
  };
  saveToken(token, false);
  await restoreAndBind({
    bind: async (): Promise<unknown> => ({ accountKey: 'acct-1', displayName: 'Test User' })
  });
}

/** Make every revoke fail the way an unreachable endpoint fails. */
export function makeRevokeFail(drive: FakeDrive): void {
  // No HTTP status. `disconnect()` maps a 401 to "already revoked", so a
  // status-bearing error would take the success path instead.
  drive.revokeToken = async (): Promise<void> => {
    throw new Error('The revocation endpoint is unreachable.');
  };
}

/**
 * Run the pending debounce timers and let the resulting work settle.
 *
 * A unit change queues an upload. This drains the queue so a test can assert
 * on the Drive calls the change actually produced, rather than on the state
 * of a queue that has not run yet.
 *
 * The real-time `setTimeout` is not decoration. The coordinator's upload
 * chain yields through the event loop between the catalog read and the write.
 * Draining the fake timers alone runs that chain faster than its own awaits
 * can complete, and the write lands after the test has already looked. The
 * Phase 19 audit hit exactly this and called the result a vacuous green.
 */
export async function drainTimers(timers: ReturnType<typeof frozenTimers>): Promise<void> {
  for (let round = 0; round < 8; round += 1) {
    timers.runAll();
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (timers.pending() === 0) break;
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
}

/** Find a button in a subtree by the text it shows. */
export function buttonWithText(
  root: HTMLElement,
  text: string
): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll('button')).find((button: Element) =>
    (button.textContent ?? '').trim().includes(text)
  ) as HTMLButtonElement | undefined;
}

/** Click and flush. The smallest thing that makes a tap real. */
export function tap(element: HTMLElement): void {
  element.click();
  flushSync();
}

/** A preferences document with the given `exerciseUnits` map. */
export function prefsDoc(units: unknown = {}): string {
  return JSON.stringify({
    format: 'repjot/preferences',
    schemaVersion: 1,
    revision: 0,
    updatedAtUtc: '2026-08-01T00:00:00Z',
    exerciseUnits: units
  });
}
