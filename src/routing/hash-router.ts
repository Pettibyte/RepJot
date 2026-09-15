// The hand-written hash router.
// ARCHITECTURE ADR-001: no routing dependency.
//
// The router owns one thing: a readable store of the current `Route`, kept in
// step with the address bar. It reads the hash through an injected `RouterEnv`,
// so a test drives it with an in-memory environment and no browser.
//
// The `beforeRouteChange` hook is where the shell carries a pending save ahead of
// a route change. REQUIREMENTS 11.11 says a back navigation flushes the
// coordinator first. A native link click cannot be blocked, so the router runs
// the hook before it publishes the new route. The screen for the old route
// therefore never renders after its edits went unpersisted. A hook that rejects
// does not stop the navigation; it reports and lets the route through, because
// trapping the user on a screen is worse than a lost flush.

import { writable, type Readable } from 'svelte/store';
import { formatRoute, parseHash, type Route } from './routes';

/** The browser surface the router needs. */
export interface RouterEnv {
  /** The current location hash, `''` when the address holds none. */
  getHash(): string;
  /** Write a new hash. This is what creates the history entry. */
  setHash(hash: string): string | void;
  /** Subscribe to hash changes. Returns the unsubscribe function. */
  onHashChange(listener: () => void): () => void;
}

/** The real environment. Every read guards for a host with no `window`. */
export const windowRouterEnv: RouterEnv = {
  getHash(): string {
    return typeof window === 'undefined' ? '' : window.location.hash;
  },
  setHash(hash: string): void {
    if (typeof window !== 'undefined') {
      window.location.hash = hash;
    }
  },
  onHashChange(listener: () => void): () => void {
    // A host with no event API gets a live router that simply never fires, rather
    // than a throw during startup. Every read still works.
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return (): void => {};
    }
    window.addEventListener('hashchange', listener);
    return (): void => {
      window.removeEventListener('hashchange', listener);
    };
  }
};

/** Options for `createRouter`. */
export interface RouterOptions {
  /** Browser surface. Defaults to `windowRouterEnv`. */
  env?: RouterEnv;
  /** Runs before the router publishes a new route. May return a promise. */
  beforeRouteChange?: (next: Route) => void | Promise<void>;
}

/** The router surface. */
export interface Router {
  /** The current route. The same store object on every call. */
  current(): Readable<Route>;
  /** Push a route onto the address bar and publish it. */
  navigate(route: Route): void;
  /** Start following the address bar. Idempotent. */
  start(): void;
  /** Stop following the address bar. */
  stop(): void;
}

/** Hide the write side of a store behind a read-only view. */
function asReadable<T>(store: Readable<T>): Readable<T> {
  return { subscribe: store.subscribe };
}

/**
 * Create the router.
 *
 * The store starts at the hash the environment reports, so a subscriber that
 * reads before `start()` sees the real route rather than a default. `start()`
 * then republishes, which also picks up an address that changed between module
 * load and mount.
 */
export function createRouter(options: RouterOptions = {}): Router {
  const env: RouterEnv = options.env ?? windowRouterEnv;
  const store = writable<Route>(parseHash(env.getHash()));
  const routeStore: Readable<Route> = asReadable(store);

  let unsubscribe: (() => void) | null = null;

  /** Run the pre-navigation hook, then publish. A hook failure never blocks. */
  function publish(next: Route): void {
    const hook = options.beforeRouteChange;
    if (hook === undefined) {
      store.set(next);
      return;
    }
    // The hook may be synchronous. Wrapping keeps one code path for both, and
    // the `catch` covers a rejected promise so a failed flush cannot strand
    // the route.
    void Promise.resolve()
      .then((): unknown => hook(next))
      .then(
        (): void => {
          store.set(next);
        },
        (): void => {
          store.set(next);
        }
      );
  }

  return {
    current(): Readable<Route> {
      return routeStore;
    },
    navigate(route: Route): void {
      const hash = formatRoute(route);
      // Setting an identical hash fires no `hashchange`, so publish directly in
      // that case. A different hash publishes through the listener, which is
      // the same path a user link click takes.
      if (env.getHash() === hash) {
        publish(route);
        return;
      }
      env.setHash(hash);
    },
    start(): void {
      if (unsubscribe !== null) return;
      unsubscribe = env.onHashChange((): void => {
        publish(parseHash(env.getHash()));
      });
      publish(parseHash(env.getHash()));
    },
    stop(): void {
      if (unsubscribe === null) return;
      unsubscribe();
      unsubscribe = null;
    }
  };
}
