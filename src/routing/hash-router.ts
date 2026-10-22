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
//
// Where the user came from. The route table maps each screen to one static
// parent, so the in-app Back control cannot tell that Exercise History was
// opened from a session under edit. The router keeps two things a route cannot
// carry:
//
//   origins    The route the user last left to reach each screen name. The
//              shell reads this through `originFor`, and falls back to
//              `parentRoute` when the map holds nothing, so a bookmarked
//              address still lands on the static parent.
//
//   traversed  Whether the browser's own back or forward caused the change.
//              `popstate` marks a traversal and does not fire on an anchor
//              click. Without this signal a back step would overwrite the origin
//              of the screen it returns to, and the in-app Back would then
//              bounce between those two screens forever.
//
// Both are captured synchronously in the `hashchange` handler. `publish` defers
// the store write behind `beforeRouteChange`, and a second traversal can land
// inside that window.

import { writable, type Readable } from 'svelte/store';
import { formatRoute, parentRoute, parseHash, type Route } from './routes';

/** The browser surface the router needs. */
export interface RouterEnv {
  /** The current location hash, `''` when the address holds none. */
  getHash(): string;
  /** Write a new hash. This is what creates the history entry. */
  setHash(hash: string): string | void;
  /**
   * Replace the current history entry with one that carries `hash`.
   *
   * Absent means this environment cannot replace, and `navigate` falls back to
   * `setHash`, which adds an entry instead. Optional so an existing fake keeps
   * compiling unchanged.
   */
  replaceHash?(hash: string): void;
  /** Subscribe to hash changes. Returns the unsubscribe function. */
  onHashChange(listener: () => void): () => void;
  /**
   * Subscribe to browser back and forward traversal.
   *
   * `popstate` fires on a traversal and does not fire on an anchor click. That
   * difference is the whole reason for this member. Optional so a fake that
   * models only forward navigation keeps compiling. A host with no `popstate`
   * gets no signal, and every navigation then reads as forward.
   */
  onPopState?(listener: () => void): () => void;
}

/** What one publish did, as an immutable snapshot. */
export interface NavigationInfo {
  /**
   * The route that was current before this publish.
   *
   * `null` on the first publish after load, when the app has no origin to give.
   */
  readonly from: Route | null;
  /** The route this publish made current. */
  readonly to: Route;
  /** True when a browser back or forward traversal caused this publish. */
  readonly traversed: boolean;
}

/** Options for `Router.navigate`. */
export interface NavigateOptions {
  /**
   * Replace the current history entry instead of adding one.
   *
   * Use this when the screen being left must not come back under the Back
   * control. Finishing a workout is that case: the editor is done, so Back
   * should return to the workout overview and not to the finished session.
   */
  readonly replace?: boolean;
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
  replaceHash(hash: string): void {
    if (typeof window === 'undefined') return;
    const url = `${window.location.pathname}${window.location.search}${hash}`;
    // `history.replaceState` rewrites the address without adding an entry. It
    // fires no `hashchange`, so the replace path in `navigate` publishes
    // directly instead of waiting for a listener that will never come. This is
    // the same shape `replaceFragment` uses in the OAuth adapter.
    if (typeof window.history.replaceState === 'function') {
      window.history.replaceState(null, document.title, url);
      return;
    }
    window.location.replace(url);
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
  },
  onPopState(listener: () => void): () => void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') {
      return (): void => {};
    }
    window.addEventListener('popstate', listener);
    return (): void => {
      window.removeEventListener('popstate', listener);
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
  navigate(route: Route, options?: NavigateOptions): void;
  /**
   * The route the user last left to reach this screen name.
   *
   * Keyed by screen name, not by the full route, because the value carries the
   * params. A full-route key would lose the origin when the user opens a second
   * exercise's history: that is a different key with no entry, and Back would
   * fall back to the static parent instead of where the user actually came from.
   *
   * `null` when the map holds nothing, which is the case on a fresh load. The
   * caller falls back to `parentRoute`.
   */
  originFor(route: Route): Route | null;
  /** The snapshot for the most recent publish, or `null` before the first. */
  lastNavigation(): NavigationInfo | null;
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
  let unsubscribePopState: (() => void) | null = null;

  /** The route the last publish made current. `null` before the first publish. */
  let previous: Route | null = null;
  /** Set by `popstate`, read and cleared by the next `hashchange`. */
  let traversing = false;
  /** Snapshot of the most recent publish. */
  let lastNav: NavigationInfo | null = null;
  /** Where the user last left each screen name, keyed by screen name. */
  const origins = new Map<string, Route>();

  /** Run the pre-navigation hook, then publish. A hook failure never blocks. */
  function publish(next: Route): void {
    previous = next;
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

  /**
   * Record where a forward navigation came from.
   *
   * A same-screen navigation records nothing, because the user did not leave the
   * screen. That also covers `navigate` to the hash already in the address bar.
   */
  function recordOrigin(from: Route | null, to: Route): void {
    if (from === null || from.name === to.name) return;
    origins.set(to.name, from);
  }

  /**
   * Give a replacing navigation the origin of the entry it destroyed.
   *
   * The replaced screen is gone from history, so the new screen inherits its
   * place. Before a finish the map holds `session-active -> workout-overview`;
   * after the replace it holds `session-summary -> workout-overview`. The
   * in-app Back then matches browser Back exactly.
   */
  function inheritOrigin(from: Route | null, to: Route): void {
    if (from === null || from.name === to.name) return;
    origins.set(to.name, origins.get(from.name) ?? parentRoute(from));
  }

  return {
    current(): Readable<Route> {
      return routeStore;
    },
    navigate(route: Route, navigateOptions: NavigateOptions = {}): void {
      const hash = formatRoute(route);
      if (navigateOptions.replace === true) {
        const from = previous;
        if (env.replaceHash !== undefined) {
          env.replaceHash(hash);
        } else {
          env.setHash(hash);
        }
        // `replaceState` fires no `hashchange`, so this path publishes itself.
        inheritOrigin(from, route);
        lastNav = { from, to: route, traversed: false };
        publish(route);
        return;
      }
      // Setting an identical hash fires no `hashchange`, so publish directly in
      // that case. A different hash publishes through the listener, which is
      // the same path a user link click takes.
      if (env.getHash() === hash) {
        lastNav = { from: previous, to: route, traversed: false };
        publish(route);
        return;
      }
      env.setHash(hash);
    },
    originFor(route: Route): Route | null {
      return origins.get(route.name) ?? null;
    },
    lastNavigation(): NavigationInfo | null {
      return lastNav;
    },
    start(): void {
      if (unsubscribe !== null) return;
      if (env.onPopState !== undefined) {
        unsubscribePopState = env.onPopState((): void => {
          traversing = true;
        });
      }
      unsubscribe = env.onHashChange((): void => {
        // Capture before `publish` defers the store write. A second traversal
        // can land while `beforeRouteChange` is still running.
        const traversed = traversing;
        traversing = false;
        const from = previous;
        const next = parseHash(env.getHash());
        if (!traversed) recordOrigin(from, next);
        lastNav = { from, to: next, traversed };
        publish(next);
      });
      const initial = parseHash(env.getHash());
      lastNav = { from: previous, to: initial, traversed: false };
      publish(initial);
    },
    stop(): void {
      if (unsubscribePopState !== null) {
        unsubscribePopState();
        unsubscribePopState = null;
      }
      if (unsubscribe === null) return;
      unsubscribe();
      unsubscribe = null;
    }
  };
}
