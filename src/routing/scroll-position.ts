// The shell calls this controller only after the destination's content is ready.
// Native restoration can run while the outgoing (shorter) screen is still in
// the DOM, which clamps the saved offset before the workout has rendered.
import { formatRoute } from './routes';
import type { NavigationInfo } from './hash-router';

export interface ScrollEnv {
  getY(): number;
  setY(y: number): void;
}

export const windowScrollEnv: ScrollEnv = {
  getY(): number {
    if (typeof window === 'undefined') return 0;
    const y = window.scrollY ?? window.pageYOffset ?? 0;
    return Number.isFinite(y) ? y : 0;
  },
  setY(y: number): void {
    if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
      window.scrollTo(0, y);
    }
  }
};

/** Opt out of premature native restoration only on hosts that support it. */
export function manageScrollRestoration(): () => void {
  if (typeof window === 'undefined' || !('scrollRestoration' in window.history)) {
    return (): void => {};
  }
  try {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return (): void => {
      try { window.history.scrollRestoration = previous; } catch { /* Restricted host. */ }
    };
  } catch {
    // Some hosts expose the property but reject writes. Explicit restoration
    // after content readiness remains available in that case.
    return (): void => {};
  }
}

export interface ScrollController {
  /** `savedY` belongs to the destination entry, not to its URL. */
  handle(nav: NavigationInfo | null, savedY?: number | null): void;
  /** A user scroll gesture cancels this navigation's pending restoration. */
  cancel(nav: NavigationInfo | null): void;
}

export function createScrollController(env: ScrollEnv = windowScrollEnv): ScrollController {
  let handled: NavigationInfo | null = null;
  let cancelled: NavigationInfo | null = null;
  return {
    handle(nav, savedY = null): void {
      if (nav === null || nav === handled) return;
      handled = nav;
      if (nav === cancelled) return;
      // Re-publishing the current route is not a new entry or a scroll command.
      if (!nav.traversed && nav.from !== null && nav.entryId === nav.fromEntryId &&
          formatRoute(nav.from) === formatRoute(nav.to)) return;
      const restore = nav.traversed || nav.from === null;
      const target = restore && savedY !== null && Number.isFinite(savedY)
        ? Math.max(0, savedY) : 0;
      if (env.getY() !== target) env.setY(target);
    },
    cancel(nav): void {
      cancelled = nav;
    }
  };
}
