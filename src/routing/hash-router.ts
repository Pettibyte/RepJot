// Hash routing with per-history-entry origins. Fragment pushes fire popstate
// in browsers too: entry metadata, not event type, identifies a traversal.
import { writable, type Readable } from 'svelte/store';
import { formatRoute, parentRoute, parseHash, type Route } from './routes';

export interface RouterEnv {
  getHash(): string;
  setHash(hash: string): string | void;
  replaceHash?(hash: string): void;
  onHashChange(listener: () => void): () => void;
  /** Raw popstate, including events caused by new fragment links. */
  onPopState?(listener: () => void): () => void;
  getHistoryState?(): unknown;
  replaceHistoryState?(state: unknown): void;
  /** A declared state API can still be unavailable on a legacy browser. */
  canWriteHistoryState?(): boolean;
  getSavedScroll?(entryId: string): number | null;
  setSavedScroll?(entryId: string, y: number): void;
  back?(): void;
}

export interface NavigationInfo {
  readonly from: Route | null;
  readonly to: Route;
  readonly traversed: boolean;
  readonly entryId: string;
  readonly fromEntryId: string | null;
  /** Destination offset at acceptance, before its async hook completes. */
  readonly scrollY: number | null;
}

export interface NavigateOptions {
  readonly replace?: boolean;
}

/** Only this field belongs to the router; preserve every other state field. */
export const ROUTER_HISTORY_STATE_KEY = '__repjotRouter';
const SCROLL_STORAGE_PREFIX = '__repjotRouter.scroll.';
interface EntryRef {
  id: string;
  hash: string;
}
interface Entry extends EntryRef {
  version: 1;
  predecessor: EntryRef | null;
  scrollY: number | null;
}
let nextId = 0;
function newId(): string {
  return `${Date.now().toString(36)}-${(++nextId).toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function canonical(hash: string): string {
  return formatRoute(parseHash(hash));
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function isRef(value: unknown): value is EntryRef {
  return isRecord(value) && typeof value.id === 'string' && value.id.length > 0 &&
    typeof value.hash === 'string' && canonical(value.hash) === value.hash;
}
function readEntry(state: unknown): Entry | null {
  const value = isRecord(state) ? state[ROUTER_HISTORY_STATE_KEY] : null;
  if (!isRef(value) || !isRecord(value) || value.version !== 1 ||
      !(value.predecessor === null || isRef(value.predecessor)) ||
      !(value.scrollY === null || (typeof value.scrollY === 'number' &&
        Number.isFinite(value.scrollY) && value.scrollY >= 0))) return null;
  if (value.predecessor !== null && value.predecessor.id === value.id) return null;
  return {
    version: 1, id: value.id, hash: value.hash,
    predecessor: value.predecessor === null ? null : {
      id: value.predecessor.id, hash: value.predecessor.hash
    },
    scrollY: value.scrollY
  };
}

export const windowRouterEnv: RouterEnv = {
  getHash(): string {
    return typeof window === 'undefined' ? '' : window.location.hash;
  },
  setHash(hash: string): void {
    if (typeof window !== 'undefined') window.location.hash = hash;
  },
  replaceHash(hash: string): void {
    if (typeof window === 'undefined') return;
    const url = `${window.location.pathname}${window.location.search}${hash}`;
    if (typeof window.history.replaceState === 'function') {
      window.history.replaceState(window.history.state, document.title, url);
    } else {
      window.location.replace(url);
    }
  },
  getHistoryState(): unknown {
    return typeof window === 'undefined' ? null : window.history.state;
  },
  canWriteHistoryState(): boolean {
    return typeof window !== 'undefined' && typeof window.history.replaceState === 'function';
  },
  replaceHistoryState(state: unknown): void {
    if (typeof window !== 'undefined' && typeof window.history.replaceState === 'function') {
      window.history.replaceState(state, document.title);
    }
  },
  getSavedScroll(entryId: string): number | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = window.sessionStorage.getItem(`${SCROLL_STORAGE_PREFIX}${entryId}`);
      if (raw === null || raw.trim() === '') return null;
      const y = Number(raw);
      return Number.isFinite(y) && y >= 0 ? y : null;
    } catch {
      // Storage can be unavailable in private browsing; history state and the
      // in-memory entry cache still work.
      return null;
    }
  },
  setSavedScroll(entryId: string, y: number): void {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(`${SCROLL_STORAGE_PREFIX}${entryId}`, String(y));
    } catch {
      // A quota/storage failure must not block navigation.
    }
  },
  back(): void {
    if (typeof window !== 'undefined') window.history.back();
  },
  onHashChange(listener: () => void): () => void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
    window.addEventListener('hashchange', listener);
    return () => window.removeEventListener('hashchange', listener);
  },
  onPopState(listener: () => void): () => void {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {};
    window.addEventListener('popstate', listener);
    return () => window.removeEventListener('popstate', listener);
  }
};

export interface RouterOptions {
  env?: RouterEnv;
  beforeRouteChange?: (next: Route) => void | Promise<void>;
}

export interface Router {
  current(): Readable<Route>;
  navigate(route: Route, options?: NavigateOptions): void;
  /** Traverse to a known app predecessor, otherwise replace with the parent. */
  back(): void;
  /** The current entry's predecessor, or null for another route/deep link. */
  originFor(route: Route): Route | null;
  lastNavigation(): NavigationInfo | null;
  /** Save the rendered entry, not a destination awaiting its async hook. */
  saveScroll(y: number, entryId?: string): void;
  /** Saved offset of the rendered entry. See lastNavigation().scrollY for a pending target. */
  scrollForCurrent(): number | null;
  start(): void;
  stop(): void;
}

export function createRouter(options: RouterOptions = {}): Router {
  const env = options.env ?? windowRouterEnv;
  const store = writable<Route>(parseHash(env.getHash()));
  const routeStore: Readable<Route> = { subscribe: store.subscribe };
  const entries = new Map<string, Entry>();
  let entry: Entry | null = null;
  let renderedEntryId: string | null = null;
  let previous: Route | null = null;
  let lastNav: NavigationInfo | null = null;
  let unsubscribe: (() => void) | null = null;
  let unsubscribePopState: (() => void) | null = null;
  let generation = 0;

  function persist(): void {
    if (entry === null) return;
    entries.set(entry.id, entry);
    const state = env.getHistoryState?.();
    env.replaceHistoryState?.({ ...(isRecord(state) ? state : {}), [ROUTER_HISTORY_STATE_KEY]: entry });
  }
  function replaceAddress(hash: string): void {
    if (env.getHash() === hash) return;
    // Browser environments support replaceState. A minimal injected environment
    // may only implement setHash; its event is deduplicated against entry.
    if (env.replaceHash !== undefined) env.replaceHash(hash);
    else env.setHash(hash);
  }
  function makeEntry(hash: string, predecessor: EntryRef | null): Entry {
    return { version: 1, id: newId(), hash, predecessor, scrollY: null };
  }
  function restoreScroll(saved: Entry): Entry {
    const y = env.getSavedScroll?.(saved.id);
    return typeof y === 'number' && Number.isFinite(y) && y >= 0 ? { ...saved, scrollY: y } : saved;
  }
  function initialize(): Entry {
    if (entry !== null) return entry;
    const hash = canonical(env.getHash());
    const restored = readEntry(env.getHistoryState?.());
    entry = restored?.hash === hash ? restoreScroll(restored) : makeEntry(hash, null);
    // The initial store already holds this route, even before its first hook.
    renderedEntryId = entry.id;
    persist();
    replaceAddress(hash);
    return entry;
  }
  function publish(next: Route, fromEntryId: string | null, traversed: boolean): void {
    const current = entry!;
    lastNav = {
      from: previous, to: next, traversed, entryId: current.id, fromEntryId,
      scrollY: current.scrollY
    };
    previous = next;
    const token = ++generation;
    const hook = options.beforeRouteChange;
    if (hook === undefined) {
      renderedEntryId = current.id;
      store.set(next);
      return;
    }
    // Save failures must not strand the user. A superseded flush must not put
    // an old route back on screen after a newer navigation has completed.
    const finish = (): void => {
      if (token === generation) {
        renderedEntryId = current.id;
        store.set(next);
      }
    };
    void Promise.resolve().then(() => hook(next)).then(finish, finish);
  }
  function acceptAddress(popstate: boolean): void {
    const hash = canonical(env.getHash());
    let incoming = readEntry(env.getHistoryState?.());
    // Compatibility for injected environments without history state. Such
    // environments must report traversal only through onPopState.
    if (env.getHistoryState === undefined && popstate) {
      incoming = [...entries.values()].reverse().find((item) => item.hash === hash) ?? null;
    }
    const writableState = env.canWriteHistoryState?.() ??
      (env.getHistoryState !== undefined && env.replaceHistoryState !== undefined);
    if (entry !== null && entry.hash === hash &&
        (incoming?.id === entry.id || env.getHistoryState === undefined ||
          (incoming === null && env.getHash() === hash && (!popstate || !writableState)))) {
      // Markerless hashchange can be the second half of fragment navigation.
      // A raw popstate with writable state can instead expose an unmarked,
      // distinct same-hash entry (e.g. one pushed by another history consumer).
      // Legacy hosts without writable state can only deduplicate by hash.
      replaceAddress(hash);
      return;
    }
    const fromEntryId = entry?.id ?? null;
    const restoredEntry = incoming !== null && incoming.hash === hash;
    // Assign identity on first encountering an external same-URL pushState
    // entry. Unlike a fragment push, this same-hash popstate is traversal.
    const unknownSameHashTraversal = popstate && writableState && incoming === null &&
      entry?.hash === hash && env.getHash() === hash;
    const traversed = restoredEntry || unknownSameHashTraversal;
    if (restoredEntry) {
      // A save for a departing entry can arrive after traversal while the shell
      // still displays it. Prefer that newer in-memory scroll snapshot.
      entry = entries.get(incoming!.id) ?? restoreScroll(incoming!);
    } else {
      const predecessor = entry === null ? null : { id: entry.id, hash: entry.hash };
      entry = makeEntry(hash, predecessor);
    }
    persist();
    replaceAddress(hash);
    publish(parseHash(hash), fromEntryId, traversed);
  }
  function replace(route: Route): void {
    const current = initialize();
    const hash = canonical(formatRoute(route));
    if (current.predecessor?.hash === hash && env.back !== undefined) {
      env.back();
      return;
    }
    entry = {
      ...current, hash,
      id: current.hash === hash ? current.id : newId(),
      scrollY: current.hash === hash ? current.scrollY : null
    };
    // Write metadata before the address: synchronous test environments can fire
    // hashchange inside replaceAddress, and must see the replacement entry.
    persist();
    replaceAddress(hash);
    publish(parseHash(hash), current.id, false);
  }

  return {
    current: () => routeStore,
    navigate(route, navigateOptions = {}): void {
      if (navigateOptions.replace === true) {
        replace(route);
        return;
      }
      const current = initialize();
      const hash = canonical(formatRoute(route));
      if (current.hash === hash && canonical(env.getHash()) === hash) {
        replaceAddress(hash);
        publish(parseHash(hash), current.id, false);
      } else {
        env.setHash(hash);
        // Stamp each programmatic push immediately. Two navigate calls can run
        // before the browser delivers either hashchange; neither entry may be
        // left unmarked or lose its predecessor. Later events are deduplicated.
        acceptAddress(false);
      }
    },
    back(): void {
      const current = initialize();
      if (current.predecessor !== null && env.back !== undefined) env.back();
      else replace(parentRoute(parseHash(current.hash)));
    },
    originFor(route): Route | null {
      if (entry === null || canonical(formatRoute(route)) !== entry.hash || entry.predecessor === null) return null;
      return parseHash(entry.predecessor.hash);
    },
    lastNavigation: () => lastNav,
    saveScroll(y, entryId): void {
      if (!Number.isFinite(y) || y < 0) return;
      const id = entryId ?? renderedEntryId;
      const saved = id === null ? undefined : entries.get(id);
      if (saved === undefined || saved.scrollY === y) return;
      const updated = { ...saved, scrollY: y };
      entries.set(updated.id, updated);
      env.setSavedScroll?.(updated.id, y);
      // Scroll can fire at frame rate. Never call replaceState here: browsers
      // rate-limit History API writes. Session storage preserves snapshots even
      // when the address bar already belongs to another entry; history state
      // remains a fallback snapshot written only during navigation.
      if (entry?.id === updated.id) entry = updated;
    },
    scrollForCurrent: () => renderedEntryId === null ? null : entries.get(renderedEntryId)?.scrollY ?? null,
    start(): void {
      if (unsubscribe !== null) return;
      const existing = entry;
      const current = initialize();
      unsubscribePopState = env.onPopState?.(() => acceptAddress(true)) ?? null;
      unsubscribe = env.onHashChange(() => acceptAddress(false));
      const restored = readEntry(env.getHistoryState?.());
      if (existing !== null && (canonical(env.getHash()) !== current.hash ||
          (restored !== null && restored.id !== current.id))) {
        acceptAddress(false);
      } else {
        publish(parseHash(current.hash), previous === null ? null : current.id, false);
      }
    },
    stop(): void {
      unsubscribePopState?.();
      unsubscribePopState = null;
      unsubscribe?.();
      unsubscribe = null;
      ++generation;
    }
  };
}
