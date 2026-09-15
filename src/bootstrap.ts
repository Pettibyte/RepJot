// Startup sequence and mount.
// ARCHITECTURE section 9 "Startup and loading" and section 10.
//
// The eight steps, in order:
//
//   1  Load the static bundle. A failure sets `static_failed` and renders the
//      blocker. Nothing private is attempted after that.
//   2  Consume the OAuth callback. Only a matching unexpired state is accepted,
//      and the fragment is stripped before any private read.
//   3  Restore the stored token and bind it to its Drive account. No private
//      cache opens before this resolves. REQUIREMENTS 2.11.
//   4  Create the local store for the bound account and the Drive adapter.
//   5  Create the coordinator, the preference service, and the lookup service.
//   6  Warm the cache. This build warms preferences only. Result shards load
//      when a screen asks for them, through `coordinator.ensureLoaded`.
//   7  Start the router and mount the shell.
//   8  Register the `pagehide` flush. The coordinator registers its own inside
//      `createCoordinator`, so step 8 needs no line here. See the note below.
//
// Step 6 runs after the mount, not before it. A warm cache is a Drive round trip,
// and the Kindle pays for that on a slow link. The shell renders as soon as the
// static bundle and the account binding are known, then the warm runs behind it.
// A screen that needs data before the warm reaches it calls `ensureLoaded` and
// waits on the same promise, so no screen reads a hole.
//
// Test seams. `BootstrapPorts` holds the five collaborators a test needs to
// watch: the static loader, the auth bind, the store factory, the coordinator
// factory, and the mount. The default ports are the real modules. A test passes
// spies and asserts the call order, which is how the "no private read before the
// bind resolves" rule gets proved rather than asserted in a comment.

import { mount } from 'svelte';
import type { ShellAccount, ShellProps } from './app-types';
import {
  millisecondsUntilExpiry,
  restoreAndBind as restoreAndBindDefault,
  expireSession,
  type AuthSession,
  type BindDependencies
} from './auth/auth-service';
import {
  beginAuthorization,
  consumeCallback,
  hasCallbackFragment,
  peekStoredToken,
  type CallbackResult
} from './auth/oauth-redirect-adapter';
import { AppError, isAppError } from './domain/errors';
import { loadStaticData as loadStaticDataDefault, type LoadedStaticData } from './documents/static-loader';
import { createDriveRestAdapter, type AccessTokenSource } from './drive/drive-rest-adapter';
import type { DriveAdapter } from './drive/drive-interface';
import { createLookupService, type LookupService } from './indexes/lookup-service';
import { createPreferenceService, type PreferenceService } from './preferences/preference-service';
import { createRouter, type Router } from './routing/hash-router';
import { setRouter } from './routing/router-registry';
import { setServices, publishServices } from './services/registry';
import { createSessionService, type SessionService } from './sessions/session-service';
import { warmResultShards } from './sync/warm-result-shards';
import { reportError, setStartupStatus } from './state/app-state';
import { createLocalStore as createLocalStoreDefault } from './storage/create-local-store';
import type { LocalStore } from './storage/local-store';
import {
  createCoordinator as createCoordinatorDefault,
  type Coordinator,
  type SyncDeps
} from './sync/sync-coordinator';
import App from './App.svelte';

declare global {
  interface Window {
    /** Called by the mount so the page bootstrap watchdog stops counting. */
    __repjotBooted?: () => void;
  }
}

/** The collaborators `bootstrap` uses. A test replaces any of them. */
export interface BootstrapPorts {
  loadStaticData: (fetchImpl?: typeof fetch) => Promise<LoadedStaticData>;
  restoreAndBind: (deps: BindDependencies) => Promise<AuthSession | null>;
  createLocalStore: (accountKey: string) => Promise<LocalStore>;
  createCoordinator: (deps: SyncDeps) => Coordinator;
  mountApp: (props: ShellProps, target: HTMLElement) => unknown;
}

/** Mount the shell and hand the page back to the bootstrap watchdog. */
function mountDefault(props: ShellProps, target: HTMLElement): unknown {
  const app = mount(App, { target, props });
  document.getElementById('boot-status')?.remove();
  window.__repjotBooted?.();
  return app;
}

const defaultPorts: BootstrapPorts = {
  loadStaticData: loadStaticDataDefault,
  restoreAndBind: restoreAndBindDefault,
  createLocalStore: createLocalStoreDefault,
  createCoordinator: createCoordinatorDefault,
  mountApp: mountDefault
};

/** What `bootstrap` takes. */
export interface BootstrapDeps {
  /** The OAuth client id. Empty means this build cannot authorize. */
  clientId: string;
  /** Fetch override for the static bundle. Tests pass a stub. */
  fetchImpl?: typeof fetch;
  /** Mount target. Defaults to the `#app` element. */
  target?: HTMLElement | null;
  /** Collaborator overrides. Tests pass spies. */
  ports?: Partial<BootstrapPorts>;
}

/** What `bootstrap` returns. Every field is `null` until that step succeeds. */
export interface BootstrapResult {
  staticData: LoadedStaticData | null;
  account: ShellAccount | null;
  coordinator: Coordinator | null;
  preferences: PreferenceService | null;
  lookup: LookupService | null;
  /** Null for an anonymous visitor, who has no Drive folder to write to. */
  sessionService: SessionService | null;
  router: Router | null;
  /** True when the shell reached a mount target. */
  mounted: boolean;
}

/** Turn any throw into an `AppError` the shell can report. */
function toAppError(error: unknown, stage: string): AppError {
  if (isAppError(error)) return error;
  return new AppError(
    'storage',
    { stage, reason: 'unexpected_throw' },
    'REP JOT hit an unexpected failure during startup.'
  );
}

/** Resolve the mount target without assuming a document exists. */
function resolveTarget(target: HTMLElement | null | undefined): HTMLElement | null {
  if (target !== undefined && target !== null) return target;
  if (typeof document === 'undefined') return null;
  return document.getElementById('app');
}

/**
 * Read the OAuth callback and strip the fragment.
 *
 * The strip runs in a `finally` block. `consumeCallback` already removes the
 * fragment on every path it handles, but a throw before that point would leave
 * an access token sitting in the address bar while the app went on to read
 * private data. The extra strip closes that window. REQUIREMENTS 2.6 and 2.7.
 */
function takeCallback(): CallbackResult | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!hasCallbackFragment()) return null;
    return consumeCallback();
  } catch {
    return { kind: 'error', error: 'callback_failed' };
  } finally {
    stripCallbackFragment();
  }
}

/** Remove the URL fragment with `history.replaceState`. */
function stripCallbackFragment(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!hasCallbackFragment()) return;
  const clean = `${window.location.pathname}${window.location.search}`;
  if (typeof window.history.replaceState === 'function') {
    window.history.replaceState(null, document.title, clean);
    return;
  }
  window.location.hash = '';
}

/** The account shape the shell shows, from a bound session. */
function toShellAccount(session: AuthSession): ShellAccount {
  return {
    accountKey: session.accountKey,
    ...(session.displayName === undefined ? {} : { displayName: session.displayName })
  };
}

/**
 * Run the startup sequence and mount the shell.
 *
 * The function never rejects. Every failure path reports through `activeError`
 * and still mounts something, because a blank page tells the user nothing.
 */
export async function bootstrap(deps: BootstrapDeps): Promise<BootstrapResult> {
  const ports: BootstrapPorts = { ...defaultPorts, ...(deps.ports ?? {}) };
  const result: BootstrapResult = {
    staticData: null,
    account: null,
    coordinator: null,
    preferences: null,
    lookup: null,
    sessionService: null,
    router: null,
    mounted: false
  };
  const target = resolveTarget(deps.target);

  // Step 1. The static bundle gates everything. A screen cannot answer a single
  // question without it, so a failure stops here and renders the blocker.
  setStartupStatus('loading_static');
  let staticData: LoadedStaticData;
  try {
    staticData = await ports.loadStaticData(deps.fetchImpl);
  } catch (error: unknown) {
    setStartupStatus('static_failed');
    reportError(toAppError(error, 'static_data'));
    // The blocker still needs a live router, because the card inside it offers
    // **View Raw JSON** and that action navigates. REQUIREMENTS 6.9. The router
    // reads and writes the address bar only, so this keeps the rule that no
    // private store or coordinator opens after a static failure.
    const router = createRouter();
    result.router = router;
    setRouter(router);
    router.start();
    if (target !== null) {
      ports.mountApp(
        {
          route: router.current(),
          account: null,
          clientId: deps.clientId,
          onSignIn: (): void => {}
        },
        target
      );
      result.mounted = true;
    }
    return result;
  }
  result.staticData = staticData;
  // The gate opens here, not after the account work. The shell renders as soon
  // as the bundle is good, which is what lets an anonymous start and a signed-in
  // start paint at the same moment.
  setStartupStatus('ready');

  // Step 2. The callback runs before any private read, and the fragment leaves
  // the address bar on the way out.
  const callback: CallbackResult | null = takeCallback();

  // Step 3. Bind the token to its account. The adapter reads the live session
  // on every call, so nothing here holds a copy of the token.
  const tokenSource: AccessTokenSource = (): string | null =>
    peekStoredToken()?.accessToken ?? null;
  const drive: DriveAdapter = createDriveRestAdapter(tokenSource);

  let session: AuthSession | null = null;
  try {
    session = await ports.restoreAndBind({ bind: () => drive.getAccountProfile() });
  } catch (error: unknown) {
    // `restoreAndBind` reports and returns `null` on every path it handles. This
    // catch keeps an unexpected throw from escaping the startup sequence.
    reportError(toAppError(error, 'bind'));
    session = null;
  }

  if (session === null && callback !== null && callback.kind !== 'accepted') {
    // A rejected callback matters only when nothing restored. A stored token
    // that still binds makes the denial moot. REQUIREMENTS 2.10.
    reportError(
      new AppError(
        'authentication',
        { stage: 'callback', reason: callback.kind },
        'Google did not complete the sign-in.'
      )
    );
  }

  if (session === null) {
    // Anonymous. The lookup service still answers static questions, so the
    // shell renders the chooser with no history.
    result.lookup = createLookupService({ staticData });
    // Publish what an anonymous visitor can reach: the bundle and the static
    // lookups. No session service and no coordinator, so every write path reads
    // as unavailable instead of failing later. REQUIREMENTS 2.11.
    setServices({ lookup: result.lookup, staticData });
    finishMount(ports, result, target, deps.clientId);
    return result;
  }

  // Step 4. The account namespace opens only now, after the bind resolved.
  // REQUIREMENTS 2.11 and 3.21.
  result.account = toShellAccount(session);
  scheduleExpiryWatch();

  let store: LocalStore;
  try {
    store = await ports.createLocalStore(session.accountKey);
  } catch (error: unknown) {
    reportError(toAppError(error, 'local_store'));
    // The bundle loaded, so the static half of the registry can serve reads.
    // Publishing it keeps the overview on the programmed tree instead of
    // denying a workout the app is holding. No session service and no
    // coordinator means every write path reads as unavailable, which is the
    // truth. REQUIREMENTS 18.1.
    result.lookup = createLookupService({ staticData });
    setServices({ lookup: result.lookup, staticData });
    finishMount(ports, result, target, deps.clientId);
    return result;
  }

  // Step 5. The coordinator, the preference service, and the lookup service.
  let coordinator: Coordinator;
  try {
    coordinator = ports.createCoordinator({
      store,
      drive,
      staticData,
      accountKey: session.accountKey
    });
  } catch (error: unknown) {
    reportError(toAppError(error, 'coordinator'));
    // Same rule as the local-store failure above: the bundle is good, so the
    // static half of the registry publishes and the screens keep their
    // programmed tree. REQUIREMENTS 18.1.
    result.lookup = createLookupService({ staticData });
    setServices({ lookup: result.lookup, staticData });
    finishMount(ports, result, target, deps.clientId);
    return result;
  }

  result.coordinator = coordinator;
  result.preferences = createPreferenceService({ coordinator, staticData });
  result.lookup = createLookupService({ staticData });

  result.sessionService = createSessionService({
    coordinator,
    staticData,
    preferences: result.preferences,
    lookup: result.lookup
  });

  // Publish the signed-in services before the mount, so the chooser draws from
  // the real registry on its first render rather than waiting one tick.
  setServices({
    lookup: result.lookup,
    sessionService: result.sessionService,
    preferences: result.preferences,
    coordinator,
    staticData
  });

  finishMount(ports, result, target, deps.clientId, coordinator);

  // Step 6. Warm the cache behind the mounted shell. Preferences go first,
  // because every unit pill reads them and the chooser needs nothing else to
  // draw its workout list.
  void result.preferences.ensureDoc().catch((): void => {
    // The coordinator already reported the failure through `activeError`. The
    // catch exists so a rejected warm never becomes an unhandled rejection.
  });

  // Result shards follow. The Drive catalog carries no session status, so the
  // only way to find an in-progress session is to read the shards that could
  // hold one. Each shard reaches the index as it lands, and the registry
  // republishes so the chooser fills progressively instead of waiting for the
  // last month. specs/storage-and-lookup.md "Loading policy".
  void warmResultShards({
    drive,
    coordinator,
    lookup: result.lookup,
    onShardLoaded: (): void => {
      publishServices();
    }
  }).catch((): void => {
    // A catalog that will not list leaves the chooser showing workouts with no
    // history. The startup error banner already carries the report.
  });

  return result;
}

/**
 * Start the router and mount the shell.
 *
 * The router carries the coordinator flush ahead of each route change, so a
 * back navigation from an active workout cannot leave an edit unpersisted.
 * REQUIREMENTS 11.11. The wait covers the local flush; an upload already in
 * flight settles before the new route publishes.
 */
function finishMount(
  ports: BootstrapPorts,
  result: BootstrapResult,
  target: HTMLElement | null,
  clientId: string,
  coordinator: Coordinator | null = null
): void {
  const router = createRouter({
    beforeRouteChange: async (): Promise<void> => {
      if (coordinator === null) return;
      await coordinator.flush();
    }
  });
  result.router = router;
  setRouter(router);
  router.start();

  if (target === null) return;

  ports.mountApp(
    {
      route: router.current(),
      account: result.account,
      clientId,
      onSignIn: (options: { remember: boolean }): void => {
        if (typeof window === 'undefined') return;
        beginAuthorization(clientId, {
          remember: options.remember,
          returnRoute: window.location.hash
        });
      }
    },
    target
  );
  result.mounted = true;
}

/**
 * Drop the session when its token expires.
 *
 * The prototype page owned this timer. It lives in the startup sequence now, so
 * the shell carries no auth logic and an expired token still stops being used.
 * REQUIREMENTS 2.14.
 */
function scheduleExpiryWatch(): void {
  if (typeof window === 'undefined') return;
  const delay = millisecondsUntilExpiry();
  if (delay === 0) {
    expireSession('expired');
    return;
  }
  window.setTimeout((): void => {
    expireSession('expired');
  }, delay);
}
